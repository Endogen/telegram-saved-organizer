from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.schemas import TelegramConnectionState
from app.auth.service import TelegramAuthService, TelegramIdentityConflictError
from app.database import _configure_sqlite_connection
from app.models import Base, TelegramConnection, User
from app.security import SecretDecryptionError, decrypt_secret


class FakeTelegramSession:
    def __init__(self, client: FakeTelegramClient) -> None:
        self._client = client

    def save(self) -> str:
        return self._client.session_string or f"session::{self._client.phone}"


class FakeTelegramClient:
    def __init__(self, session_string: str | None, calls: list[dict[str, Any]]) -> None:
        self.session_string = session_string
        self.calls = calls
        self.phone: str | None = None
        self.authorized = False
        self.session = FakeTelegramSession(self)

    async def is_user_authorized(self) -> bool:
        return self.authorized

    async def send_code_request(self, phone: str) -> SimpleNamespace:
        self.phone = phone
        self.calls.append({"operation": "send_code", "phone": phone})
        return SimpleNamespace(phone_code_hash=f"hash::{phone}")

    async def sign_in(self, **kwargs: Any) -> None:
        self.calls.append({"operation": "sign_in", **kwargs})
        self.phone = kwargs.get("phone") or self.phone
        self.authorized = True

    async def get_me(self) -> SimpleNamespace:
        identity_source = self.phone or self.session_string or ""
        return SimpleNamespace(id=111 if "111" in identity_source else 222)

    async def log_out(self) -> None:
        self.authorized = False


def build_user(*, user_id: str, email: str) -> User:
    return User(
        id=user_id,
        email=email,
        normalized_email=email,
        display_name=email.split("@", maxsplit=1)[0],
        password_hash="test-password-hash",
    )


@pytest.mark.asyncio
async def test_persisted_telegram_challenges_are_isolated_by_user(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    @asynccontextmanager
    async def fake_short_lived_client(
        *, session_string: str | None
    ) -> AsyncIterator[FakeTelegramClient]:
        yield FakeTelegramClient(session_string, calls)

    monkeypatch.setattr("app.auth.service.short_lived_client", fake_short_lived_client)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    event.listen(engine.sync_engine, "connect", _configure_sqlite_connection)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session:
            first_user = build_user(
                user_id="00000000-0000-0000-0000-000000000001",
                email="one@example.com",
            )
            second_user = build_user(
                user_id="00000000-0000-0000-0000-000000000002",
                email="two@example.com",
            )
            session.add_all([first_user, second_user])
            await session.commit()

            first_service = TelegramAuthService(session=session, user_id=first_user.id)
            second_service = TelegramAuthService(session=session, user_id=second_user.id)

            assert await first_service.start(phone="+491111111") == TelegramConnectionState.CODE_REQUIRED
            assert await second_service.start(phone="+492222222") == TelegramConnectionState.CODE_REQUIRED

            rows = list(
                await session.scalars(
                    select(TelegramConnection).order_by(TelegramConnection.user_id)
                )
            )
            assert [row.user_id for row in rows] == [first_user.id, second_user.id]
            assert rows[0].session_encrypted != rows[1].session_encrypted
            assert rows[0].pending_phone_code_hash_encrypted != rows[1].pending_phone_code_hash_encrypted
            assert (
                decrypt_secret(
                    rows[0].pending_phone_code_hash_encrypted or "",
                    context=f"telegram:{first_user.id}:phone_code_hash",
                )
                == "hash::+491111111"
            )
            with pytest.raises(SecretDecryptionError):
                decrypt_secret(
                    rows[1].pending_phone_code_hash_encrypted or "",
                    context=f"telegram:{first_user.id}:phone_code_hash",
                )

            assert (
                await first_service.verify(code="11111", password=None)
                == TelegramConnectionState.CONNECTED
            )
            assert await second_service.status() == TelegramConnectionState.CODE_REQUIRED
            assert (
                await second_service.verify(code="22222", password=None)
                == TelegramConnectionState.CONNECTED
            )

            sign_ins = [call for call in calls if call["operation"] == "sign_in"]
            assert sign_ins == [
                {
                    "operation": "sign_in",
                    "phone": "+491111111",
                    "code": "11111",
                    "phone_code_hash": "hash::+491111111",
                },
                {
                    "operation": "sign_in",
                    "phone": "+492222222",
                    "code": "22222",
                    "phone_code_hash": "hash::+492222222",
                },
            ]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_same_telegram_principal_cannot_bind_to_two_application_users(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    @asynccontextmanager
    async def fake_short_lived_client(
        *, session_string: str | None
    ) -> AsyncIterator[FakeTelegramClient]:
        client = FakeTelegramClient(session_string, calls)

        async def shared_identity() -> SimpleNamespace:
            return SimpleNamespace(id=777)

        client.get_me = shared_identity  # type: ignore[method-assign]
        yield client

    monkeypatch.setattr("app.auth.service.short_lived_client", fake_short_lived_client)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    event.listen(engine.sync_engine, "connect", _configure_sqlite_connection)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session:
            first_user = build_user(user_id="user-a", email="one@example.com")
            second_user = build_user(user_id="user-b", email="two@example.com")
            session.add_all([first_user, second_user])
            await session.commit()

            first_service = TelegramAuthService(session=session, user_id=first_user.id)
            second_service = TelegramAuthService(session=session, user_id=second_user.id)
            assert await first_service.start(phone="+49111") is TelegramConnectionState.CODE_REQUIRED
            assert await first_service.verify(
                code="11111", password=None
            ) is TelegramConnectionState.CONNECTED
            assert await second_service.start(phone="+49222") is TelegramConnectionState.CODE_REQUIRED

            with pytest.raises(TelegramIdentityConflictError):
                await second_service.verify(code="22222", password=None)

            connections = list(
                await session.scalars(
                    select(TelegramConnection).order_by(TelegramConnection.user_id)
                )
            )
            assert connections[0].telegram_user_id == 777
            assert connections[1].telegram_user_id is None
    finally:
        await engine.dispose()
