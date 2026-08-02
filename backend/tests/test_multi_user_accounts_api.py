from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import _configure_sqlite_connection, get_session
from app.main import MAX_REQUEST_BODY_BYTES, create_app
from app.accounts.service import AccountService, AuthenticationFailedError, as_utc
from app.models import Base, Message, User, WebSession

PASSWORD = "correct horse battery staple"
TEST_ORIGIN = settings.public_origin or (
    "https://testserver" if settings.cookie_secure else "http://testserver"
)


@asynccontextmanager
async def api_database() -> AsyncIterator[
    tuple[object, async_sessionmaker[AsyncSession]]
]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
    )
    event.listen(engine.sync_engine, "connect", _configure_sqlite_connection)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    app = create_app(check_migrations=False)

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        yield app, session_factory
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


def csrf_headers(client: AsyncClient) -> dict[str, str]:
    token = client.cookies.get(settings.csrf_cookie_name)
    assert token is not None
    return {"Origin": TEST_ORIGIN, "X-CSRF-Token": token}


async def register(
    client: AsyncClient,
    *,
    email: str,
    display_name: str,
    password: str = PASSWORD,
) -> None:
    response = await client.post(
        "/api/account/register",
        json={"email": email, "display_name": display_name, "password": password},
    )
    assert response.status_code == 204, response.text
    assert response.content == b""


async def login(client: AsyncClient, *, email: str, password: str = PASSWORD) -> Response:
    response = await client.post(
        "/api/session",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200, response.text
    assert response.json()["authenticated"] is True
    return response


@pytest.mark.asyncio
async def test_chunked_request_body_limit_is_enforced() -> None:
    async with api_database() as (app, _):
        async def oversized_body() -> AsyncIterator[bytes]:
            yield b'{"email":"'
            yield b"a" * MAX_REQUEST_BODY_BYTES

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url=TEST_ORIGIN,
        ) as client:
            response = await client.post(
                "/api/account/register",
                content=oversized_body(),
                headers={"Content-Type": "application/json"},
            )

    assert response.status_code == 413, response.text
    assert response.json() == {"detail": "request_body_too_large"}


@pytest.mark.asyncio
async def test_locked_account_requests_do_not_extend_the_lockout() -> None:
    async with api_database() as (_, session_factory):
        async with session_factory() as session:
            user = User(
                email="locked@example.com",
                normalized_email="locked@example.com",
                display_name="Locked",
                password_hash="not-used-while-locked",
                failed_login_attempts=7,
                locked_until=datetime.now(tz=UTC) + timedelta(minutes=10),
            )
            session.add(user)
            await session.commit()
            original_lock = user.locked_until

            with pytest.raises(AuthenticationFailedError):
                await AccountService(session=session).login(
                    email=user.email,
                    password="any password",
                    user_agent=None,
                    ip_address=None,
                )

            await session.refresh(user)
            assert user.failed_login_attempts == 7
            assert as_utc(user.locked_until) == as_utc(original_lock)


@pytest.mark.asyncio
async def test_session_cookies_csrf_revocation_and_logout() -> None:
    async with api_database() as (app, session_factory):
        transport = ASGITransport(app=app)
        async with (
            AsyncClient(transport=transport, base_url=TEST_ORIGIN) as first_client,
            AsyncClient(transport=transport, base_url=TEST_ORIGIN) as second_client,
        ):
            unauthenticated = await first_client.get("/api/session")
            assert unauthenticated.json() == {"authenticated": False, "user": None}

            await register(
                first_client,
                email="owner@example.com",
                display_name="Owner",
            )
            duplicate = await first_client.post(
                "/api/account/register",
                json={
                    "email": " OWNER@example.com ",
                    "display_name": "Duplicate",
                    "password": PASSWORD,
                },
            )
            assert duplicate.status_code == 204
            assert duplicate.content == b""

            first_login_response = await login(first_client, email="OWNER@example.com")
            account = first_login_response.json()["user"]
            await login(second_client, email="owner@example.com")

            set_cookie_headers = first_client.cookies.jar
            assert first_client.cookies.get(settings.session_cookie_name)
            assert first_client.cookies.get(settings.csrf_cookie_name)
            assert len(list(set_cookie_headers)) == 2

            cookie_headers = first_login_response.headers.get_list("set-cookie")
            session_header = next(
                value for value in cookie_headers if value.startswith(f"{settings.session_cookie_name}=")
            )
            csrf_header = next(
                value for value in cookie_headers if value.startswith(f"{settings.csrf_cookie_name}=")
            )
            assert "httponly" in session_header.lower()
            assert "samesite=lax" in session_header.lower()
            assert "httponly" not in csrf_header.lower()

            no_origin = await first_client.patch(
                "/api/account",
                json={"display_name": "Blocked without origin"},
                headers={"X-CSRF-Token": first_client.cookies.get(settings.csrf_cookie_name) or ""},
            )
            assert no_origin.status_code == 403
            assert no_origin.json()["detail"] == "origin_required"

            no_csrf = await first_client.patch(
                "/api/account",
                json={"display_name": "Blocked without CSRF"},
                headers={"Origin": TEST_ORIGIN},
            )
            assert no_csrf.status_code == 403
            assert no_csrf.json()["detail"] == "csrf_validation_failed"

            updated = await first_client.patch(
                "/api/account",
                json={"display_name": "Updated Owner"},
                headers=csrf_headers(first_client),
            )
            assert updated.status_code == 200
            assert updated.json()["display_name"] == "Updated Owner"

            sessions_response = await first_client.get("/api/account/sessions")
            assert sessions_response.status_code == 200
            sessions = sessions_response.json()
            assert len(sessions) == 2
            assert sum(item["current"] for item in sessions) == 1

            second_sessions = (await second_client.get("/api/account/sessions")).json()
            second_current_id = next(item["id"] for item in second_sessions if item["current"])
            revoked = await first_client.delete(
                f"/api/account/sessions/{second_current_id}",
                headers=csrf_headers(first_client),
            )
            assert revoked.status_code == 204
            assert (await second_client.get("/api/session")).json() == {
                "authenticated": False,
                "user": None,
            }

            logout = await first_client.delete(
                "/api/session",
                headers=csrf_headers(first_client),
            )
            assert logout.status_code == 204
            assert "max-age=0" in logout.headers.get("set-cookie", "").lower()
            assert (await first_client.get("/api/session")).json() == {
                "authenticated": False,
                "user": None,
            }

            async with session_factory() as session:
                revoked_count = await session.scalar(
                    select(func.count()).select_from(WebSession).where(
                        WebSession.user_id == account["id"],
                        WebSession.revoked_at.is_not(None),
                    )
                )
            assert revoked_count == 2


@pytest.mark.asyncio
async def test_successful_login_enforces_bounded_active_session_history() -> None:
    async with api_database() as (app, session_factory):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url=TEST_ORIGIN,
        ) as client:
            await register(client, email="bounded@example.com", display_name="Bounded")
            account_id: str | None = None
            for _ in range(settings.max_active_sessions + 2):
                response = await login(client, email="bounded@example.com")
                account_id = response.json()["user"]["id"]

            active_sessions = (await client.get("/api/account/sessions")).json()
            assert len(active_sessions) == settings.max_active_sessions

        assert account_id is not None
        async with session_factory() as session:
            active_count = await session.scalar(
                select(func.count()).select_from(WebSession).where(
                    WebSession.user_id == account_id,
                    WebSession.revoked_at.is_(None),
                )
            )
            revoked_count = await session.scalar(
                select(func.count()).select_from(WebSession).where(
                    WebSession.user_id == account_id,
                    WebSession.revoked_at.is_not(None),
                )
            )

        assert active_count == settings.max_active_sessions
        assert revoked_count == 2


@pytest.mark.asyncio
async def test_two_user_api_isolation_duplicate_values_and_clear_all() -> None:
    async with api_database() as (app, session_factory):
        transport = ASGITransport(app=app)
        async with (
            AsyncClient(transport=transport, base_url=TEST_ORIGIN) as first_client,
            AsyncClient(transport=transport, base_url=TEST_ORIGIN) as second_client,
        ):
            await register(
                first_client,
                email="one@example.com",
                display_name="One",
            )
            await register(
                second_client,
                email="two@example.com",
                display_name="Two",
            )
            first_account = (await login(first_client, email="one@example.com")).json()["user"]
            second_account = (await login(second_client, email="two@example.com")).json()["user"]

            category_payload = {
                "name": "Shared Name",
                "icon": "archive",
                "color": "#123456",
            }
            first_category_response = await first_client.post(
                "/api/categories",
                json=category_payload,
                headers=csrf_headers(first_client),
            )
            second_category_response = await second_client.post(
                "/api/categories",
                json=category_payload,
                headers=csrf_headers(second_client),
            )
            assert first_category_response.status_code == 201
            assert second_category_response.status_code == 201
            first_category = first_category_response.json()
            second_category = second_category_response.json()
            assert first_category["slug"] == second_category["slug"]

            tag_payload = {"name": "Duplicate Tag", "color": "#654321"}
            first_tag_response = await first_client.post(
                "/api/tags",
                json=tag_payload,
                headers=csrf_headers(first_client),
            )
            second_tag_response = await second_client.post(
                "/api/tags",
                json=tag_payload,
                headers=csrf_headers(second_client),
            )
            assert first_tag_response.status_code == 201
            assert second_tag_response.status_code == 201
            first_tag = first_tag_response.json()
            second_tag = second_tag_response.json()

            async with session_factory() as session:
                first_message = Message(
                    user_id=first_account["id"],
                    telegram_id=4242,
                    content="first tenant",
                    date=datetime.now(tz=UTC),
                    category_id=first_category["id"],
                    raw_data={},
                )
                second_message = Message(
                    user_id=second_account["id"],
                    telegram_id=4242,
                    content="second tenant",
                    date=datetime.now(tz=UTC),
                    category_id=second_category["id"],
                    raw_data={},
                )
                session.add_all([first_message, second_message])
                await session.commit()
                first_message_id = first_message.id
                second_message_id = second_message.id

            first_list = (await first_client.get("/api/messages")).json()
            second_list = (await second_client.get("/api/messages")).json()
            assert [item["id"] for item in first_list["items"]] == [first_message_id]
            assert [item["id"] for item in second_list["items"]] == [second_message_id]

            cross_tenant_requests = [
                await first_client.get(f"/api/messages/{second_message_id}"),
                await first_client.patch(
                    f"/api/messages/{second_message_id}",
                    json={"content": "not allowed"},
                    headers=csrf_headers(first_client),
                ),
                await first_client.delete(
                    f"/api/categories/{second_category['id']}",
                    headers=csrf_headers(first_client),
                ),
                await first_client.delete(
                    f"/api/tags/{second_tag['id']}",
                    headers=csrf_headers(first_client),
                ),
                await first_client.post(
                    f"/api/messages/{first_message_id}/tags",
                    json={"tag_ids": [second_tag["id"]]},
                    headers=csrf_headers(first_client),
                ),
                await first_client.post(
                    f"/api/messages/{second_message_id}/tags",
                    json={"tag_ids": [first_tag["id"]]},
                    headers=csrf_headers(first_client),
                ),
            ]
            assert [response.status_code for response in cross_tenant_requests] == [404] * 6

            second_session_id = next(
                item["id"]
                for item in (await second_client.get("/api/account/sessions")).json()
                if item["current"]
            )
            cross_session = await first_client.delete(
                f"/api/account/sessions/{second_session_id}",
                headers=csrf_headers(first_client),
            )
            assert cross_session.status_code == 404

            cleared = await first_client.post(
                "/api/messages/clear",
                headers=csrf_headers(first_client),
            )
            assert cleared.status_code == 200
            assert cleared.json() == {"cleared_count": 1}
            assert (await first_client.get("/api/messages")).json()["total"] == 0
            remaining = (await second_client.get("/api/messages")).json()
            assert remaining["total"] == 1
            assert remaining["items"][0]["id"] == second_message_id
