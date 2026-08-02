from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.abuse import (
    AbuseRateLimitBucket,
    DatabaseRateLimiter,
    RateLimitCheck,
    RateLimitExceeded,
    RateLimitRule,
    phone_subject,
)
from app.accounts.dependencies import get_auth_context, get_current_user
from app.auth.schemas import TelegramConnectionState
from app.database import _configure_sqlite_connection, get_session
from app.main import create_app
from app.models import Base, TelegramConnection, User
from app.security import encrypt_secret


@asynccontextmanager
async def memory_sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
    )
    event.listen(engine.sync_engine, "connect", _configure_sqlite_connection)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_fixed_window_is_not_renewed_and_counter_is_capped() -> None:
    rule = RateLimitRule("test_fixed", 2, timedelta(minutes=1))
    base = datetime(2026, 8, 2, 12, 0, 30, tzinfo=UTC)

    async with memory_sessions() as session_factory:
        async with session_factory() as session:
            limiter = DatabaseRateLimiter(session=session, secret="test-secret")
            await limiter.consume(
                [RateLimitCheck(rule, "person@example.com")], now=base
            )
            await limiter.consume(
                [RateLimitCheck(rule, "person@example.com")], now=base
            )

            with pytest.raises(RateLimitExceeded) as rejected:
                await limiter.consume(
                    [RateLimitCheck(rule, "person@example.com")],
                    now=base + timedelta(seconds=29, milliseconds=500),
                )
            assert rejected.value.retry_after == 1

            with pytest.raises(RateLimitExceeded) as rejected_again:
                await limiter.consume(
                    [RateLimitCheck(rule, "person@example.com")],
                    now=base + timedelta(seconds=29, milliseconds=900),
                )
            assert rejected_again.value.retry_after == 1

            bucket = await session.scalar(select(AbuseRateLimitBucket))
            assert bucket is not None
            assert bucket.hit_count == rule.limit + 1

            # The blocked attempts did not move the boundary. At 12:01 the old
            # row is pruned and the same subject immediately gets a fresh quota.
            await limiter.consume(
                [RateLimitCheck(rule, "person@example.com")],
                now=datetime(2026, 8, 2, 12, 1, tzinfo=UTC),
            )
            buckets = list(await session.scalars(select(AbuseRateLimitBucket)))
            assert len(buckets) == 1
            assert buckets[0].hit_count == 1


@pytest.mark.asyncio
async def test_subjects_are_keyed_and_expired_storage_is_prunable() -> None:
    rule = RateLimitRule("test_private", 5, timedelta(minutes=5))
    now = datetime(2026, 8, 2, 12, 0, tzinfo=UTC)

    async with memory_sessions() as session_factory:
        async with session_factory() as session:
            limiter = DatabaseRateLimiter(session=session, secret="test-secret")
            await limiter.consume([RateLimitCheck(rule, "+49123456789")], now=now)
            bucket = await session.scalar(select(AbuseRateLimitBucket))
            assert bucket is not None
            assert bucket.subject_hash != "+49123456789"
            assert len(bucket.subject_hash) == 64

            assert await limiter.prune(now=now + timedelta(minutes=4)) == 0
            assert await limiter.prune(now=now + timedelta(minutes=5)) == 1
            assert (
                await session.scalar(
                    select(func.count()).select_from(AbuseRateLimitBucket)
                )
                == 0
            )


def test_phone_subject_collapses_common_display_variants() -> None:
    assert phone_subject("+49 (123) 456-789") == "+49123456789"
    assert phone_subject("0049 123 456 789") == "+49123456789"


@pytest.mark.asyncio
async def test_blocked_ip_cannot_create_rotating_identity_buckets() -> None:
    ip_rule = RateLimitRule("test_ip", 1, timedelta(minutes=5))
    identity_rule = RateLimitRule("test_identity", 100, timedelta(minutes=5))
    now = datetime(2026, 8, 2, 12, 0, tzinfo=UTC)

    async with memory_sessions() as session_factory:
        async with session_factory() as session:
            limiter = DatabaseRateLimiter(session=session, secret="test-secret")
            await limiter.consume(
                [
                    RateLimitCheck(ip_rule, "192.0.2.1"),
                    RateLimitCheck(identity_rule, "first@example.com"),
                ],
                now=now,
            )

            for identity in ("second@example.com", "third@example.com"):
                with pytest.raises(RateLimitExceeded):
                    await limiter.consume(
                        [
                            RateLimitCheck(ip_rule, "192.0.2.1"),
                            RateLimitCheck(identity_rule, identity),
                        ],
                        now=now,
                    )

            scopes = list(
                await session.scalars(
                    select(AbuseRateLimitBucket.scope).order_by(
                        AbuseRateLimitBucket.scope
                    )
                )
            )
            assert scopes == ["test_identity", "test_ip"]


@pytest.mark.asyncio
async def test_concurrent_sqlite_consumers_share_one_atomic_bucket(
    tmp_path: Path,
) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'limits.db'}")
    event.listen(engine.sync_engine, "connect", _configure_sqlite_connection)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    rule = RateLimitRule("test_concurrent", 50, timedelta(minutes=1))
    now = datetime(2026, 8, 2, 12, 0, 15, tzinfo=UTC)

    async def consume_once() -> None:
        async with session_factory() as session:
            await DatabaseRateLimiter(session=session, secret="test-secret").consume(
                [RateLimitCheck(rule, "shared")],
                now=now,
            )

    try:
        await asyncio.gather(*(consume_once() for _ in range(12)))
        async with session_factory() as session:
            buckets = list(await session.scalars(select(AbuseRateLimitBucket)))
        assert len(buckets) == 1
        assert buckets[0].hit_count == 12
    finally:
        await engine.dispose()


class PostgreSQLRecordingSession:
    def __init__(self) -> None:
        self.statement: Any | None = None

    def get_bind(self) -> SimpleNamespace:
        return SimpleNamespace(dialect=postgresql.dialect())

    async def scalar(self, statement: Any) -> int:
        self.statement = statement
        return 1


@pytest.mark.asyncio
async def test_postgresql_uses_atomic_upsert_with_returning() -> None:
    session = PostgreSQLRecordingSession()
    limiter = DatabaseRateLimiter(session=session, secret="test-secret")  # type: ignore[arg-type]
    rule = RateLimitRule("test_postgres", 3, timedelta(minutes=1))
    start = datetime(2026, 8, 2, 12, 0, tzinfo=UTC)

    assert (
        await limiter._increment(  # noqa: SLF001 - verifies the dialect-specific statement
            rule=rule,
            subject_hash="a" * 64,
            window_start=start,
            window_end=start + rule.window,
        )
        == 1
    )
    assert session.statement is not None
    compiled = str(
        session.statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )
    assert "ON CONFLICT" in compiled
    assert "DO UPDATE SET" in compiled
    assert "RETURNING abuse_rate_limit_buckets.hit_count" in compiled


@pytest.mark.asyncio
async def test_account_quotas_run_before_password_verification_and_hashing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.accounts.router as account_router

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

    verify_calls = 0
    hash_calls = 0

    async def fake_verify_password(_: str | None, __: str) -> bool:
        nonlocal verify_calls
        verify_calls += 1
        return False

    async def fake_hash_password(_: str) -> str:
        nonlocal hash_calls
        hash_calls += 1
        return "test-password-hash"

    one_attempt = RateLimitRule("test_login_ip", 1, timedelta(minutes=5))
    one_registration = RateLimitRule("test_registration_ip", 1, timedelta(minutes=5))
    monkeypatch.setattr(account_router, "LOGIN_PER_IP", one_attempt)
    monkeypatch.setattr(
        account_router,
        "LOGIN_PER_IDENTITY",
        RateLimitRule("test_login_identity", 1, timedelta(minutes=5)),
    )
    monkeypatch.setattr(account_router, "REGISTRATION_PER_IP", one_registration)
    monkeypatch.setattr("app.accounts.service.verify_password", fake_verify_password)
    monkeypatch.setattr("app.accounts.service.hash_password", fake_hash_password)
    app.dependency_overrides[get_session] = override_session

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            login_payload = {"email": "missing@example.com", "password": "wrong"}
            first_login = await client.post("/api/session", json=login_payload)
            second_login = await client.post("/api/session", json=login_payload)

            registration_payload = {
                "email": "new@example.com",
                "display_name": "New",
                "password": "correct horse battery staple",
            }
            first_registration = await client.post(
                "/api/account/register", json=registration_payload
            )
            second_registration = await client.post(
                "/api/account/register",
                json={**registration_payload, "email": "another@example.com"},
            )
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()

    assert first_login.status_code == 401
    assert second_login.status_code == 429
    assert second_login.json() == {"detail": "too_many_requests"}
    assert int(second_login.headers["Retry-After"]) > 0
    assert verify_calls == 1

    assert first_registration.status_code == 204
    assert second_registration.status_code == 429
    assert second_registration.json() == {"detail": "too_many_requests"}
    assert int(second_registration.headers["Retry-After"]) > 0
    assert hash_calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "payload"),
    (
        (
            "POST",
            "/api/account/password",
            {
                "current_password": "incorrect password",
                "new_password": "a different secure password",
            },
        ),
        (
            "DELETE",
            "/api/account",
            {"password": "incorrect password", "confirmation": "DELETE"},
        ),
    ),
)
async def test_sensitive_password_quotas_precede_verification_and_are_subject_scoped(
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
    payload: dict[str, str],
) -> None:
    import app.accounts.router as account_router

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

    async def override_auth_context(request: Request) -> SimpleNamespace:
        user_id = request.headers["X-Test-User"]
        return SimpleNamespace(
            user=SimpleNamespace(id=user_id, password_hash="unused-test-hash")
        )

    verify_calls = 0

    async def fake_verify_password(_: str | None, __: str) -> bool:
        nonlocal verify_calls
        verify_calls += 1
        return False

    monkeypatch.setattr(
        account_router,
        "SENSITIVE_PASSWORD_PER_IP",
        RateLimitRule("test_sensitive_ip", 1, timedelta(minutes=5)),
    )
    monkeypatch.setattr(
        account_router,
        "SENSITIVE_PASSWORD_PER_USER",
        RateLimitRule("test_sensitive_user", 1, timedelta(minutes=5)),
    )
    monkeypatch.setattr("app.accounts.service.verify_password", fake_verify_password)
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_auth_context] = override_auth_context

    async def make_request(*, user_id: str, ip_address: str):
        async with AsyncClient(
            transport=ASGITransport(app=app, client=(ip_address, 12345)),
            base_url="http://testserver",
        ) as client:
            return await client.request(
                method,
                path,
                json=payload,
                headers={"X-Test-User": user_id},
            )

    try:
        first_attempt = await make_request(user_id="user-a", ip_address="192.0.2.1")
        blocked_user = await make_request(user_id="user-a", ip_address="192.0.2.2")
        other_user = await make_request(user_id="user-b", ip_address="192.0.2.3")
        blocked_ip = await make_request(user_id="user-c", ip_address="192.0.2.3")
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()

    assert first_attempt.status_code == 403
    assert first_attempt.json() == {"detail": "invalid_password"}

    assert blocked_user.status_code == 429
    assert blocked_user.json() == {"detail": "too_many_requests"}
    assert int(blocked_user.headers["Retry-After"]) > 0

    assert other_user.status_code == 403
    assert other_user.json() == {"detail": "invalid_password"}

    assert blocked_ip.status_code == 429
    assert blocked_ip.json() == {"detail": "too_many_requests"}
    assert int(blocked_ip.headers["Retry-After"]) > 0
    assert verify_calls == 2


@pytest.mark.asyncio
async def test_telegram_quotas_run_before_code_send_and_verification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.auth.router as auth_router

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
    )
    event.listen(engine.sync_engine, "connect", _configure_sqlite_connection)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = "00000000-0000-0000-0000-000000000099"
    async with session_factory() as session:
        session.add(
            User(
                id=user_id,
                email="telegram@example.com",
                normalized_email="telegram@example.com",
                display_name="Telegram",
                password_hash="test-password-hash",
            )
        )
        session.add(
            TelegramConnection(
                user_id=user_id,
                state="pending",
                phone_encrypted=encrypt_secret(
                    "+49123456789",
                    context=f"telegram:{user_id}:phone",
                ),
            )
        )
        await session.commit()

    app = create_app(check_migrations=False)

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    async def override_current_user() -> SimpleNamespace:
        return SimpleNamespace(id=user_id)

    class FakeTelegramService:
        def __init__(self) -> None:
            self.start_calls = 0
            self.verify_calls = 0

        async def start(self, *, phone: str) -> TelegramConnectionState:
            self.start_calls += 1
            return TelegramConnectionState.CODE_REQUIRED

        async def verify(
            self, *, code: str | None, password: str | None
        ) -> TelegramConnectionState:
            self.verify_calls += 1
            return TelegramConnectionState.CONNECTED

    fake_service = FakeTelegramService()
    monkeypatch.setattr(auth_router, "_service", lambda **_: fake_service)
    for name, scope in (
        ("TELEGRAM_SEND_PER_IP", "test_send_ip"),
        ("TELEGRAM_SEND_PER_PHONE", "test_send_phone"),
        ("TELEGRAM_VERIFY_PER_IP", "test_verify_ip"),
        ("TELEGRAM_VERIFY_PER_PHONE", "test_verify_phone"),
    ):
        monkeypatch.setattr(
            auth_router,
            name,
            RateLimitRule(scope, 1, timedelta(minutes=5)),
        )
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_current_user] = override_current_user

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            first_send = await client.post(
                "/api/telegram/connection", json={"phone": "+49 (123) 456-789"}
            )
            second_send = await client.post(
                "/api/telegram/connection", json={"phone": "0049 123 456 789"}
            )
            first_verify = await client.post(
                "/api/telegram/connection/verify", json={"code": "12345"}
            )
            second_verify = await client.post(
                "/api/telegram/connection/verify", json={"code": "54321"}
            )
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()

    assert first_send.status_code == 200
    assert second_send.status_code == 429
    assert second_send.json() == {"detail": "too_many_requests"}
    assert int(second_send.headers["Retry-After"]) > 0
    assert fake_service.start_calls == 1

    assert first_verify.status_code == 200
    assert second_verify.status_code == 429
    assert second_verify.json() == {"detail": "too_many_requests"}
    assert int(second_verify.headers["Retry-After"]) > 0
    assert fake_service.verify_calls == 1
