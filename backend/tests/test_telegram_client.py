from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.security import SecretDecryptionError
from app.telegram import client as client_module
from app.models import Base, TelegramConnection, User
from app.telegram.client import (
    TelegramClientNotConnectedError,
    TelegramClientTimeoutError,
    TelegramMessageProvenanceError,
    delete_saved_messages,
    revoke_telegram_connection,
    short_lived_client,
)


class _FakeStringSession:
    def save(self) -> str:
        return "refreshed-session"


class _FakeClient:
    def __init__(self, _session: object, api_id: int, api_hash: str) -> None:
        self.credentials = (api_id, api_hash)
        self.session = _FakeStringSession()
        self.connected = False
        self.disconnected = False
        self.authorized = True
        self.deleted: list[tuple[str, list[int]]] = []
        self.logged_out = False
        self.telegram_user_id = 123

    async def connect(self) -> None:
        self.connected = True

    async def disconnect(self) -> None:
        self.disconnected = True

    async def is_user_authorized(self) -> bool:
        return self.authorized

    async def get_me(self) -> SimpleNamespace:
        return SimpleNamespace(id=self.telegram_user_id)

    async def delete_messages(self, entity: str, message_ids: list[int]) -> None:
        self.deleted.append((entity, message_ids))

    async def log_out(self) -> None:
        self.logged_out = True


class _FakeSession:
    def __init__(self, connection: object | None) -> None:
        self.connection = connection
        self.flush_calls = 0
        self.commit_calls = 0

    async def scalar(self, _statement: object) -> object | None:
        return self.connection

    async def flush(self) -> None:
        self.flush_calls += 1

    async def commit(self) -> None:
        self.commit_calls += 1

    async def execute(self, _statement: object) -> SimpleNamespace:
        return SimpleNamespace(rowcount=1)


@pytest.mark.asyncio
async def test_short_lived_client_always_disconnects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[_FakeClient] = []

    def factory(session: object, api_id: int, api_hash: str) -> _FakeClient:
        created.append(_FakeClient(session, api_id, api_hash))
        return created[-1]

    monkeypatch.setattr(
        client_module, "_telegram_api_credentials", lambda: (123, "server-hash")
    )

    with pytest.raises(RuntimeError, match="boom"):
        async with short_lived_client(
            session_string=None, client_factory=factory
        ) as client:
            assert client.connected is True
            raise RuntimeError("boom")

    assert created[0].disconnected is True
    assert created[0].credentials == (123, "server-hash")


@pytest.mark.asyncio
async def test_short_lived_client_bounds_connect_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _HangingConnectClient(_FakeClient):
        async def connect(self) -> None:
            await asyncio.Event().wait()

    created: list[_HangingConnectClient] = []

    def factory(
        session: object,
        api_id: int,
        api_hash: str,
    ) -> _HangingConnectClient:
        created.append(_HangingConnectClient(session, api_id, api_hash))
        return created[-1]

    monkeypatch.setattr(
        client_module, "_telegram_api_credentials", lambda: (123, "hash")
    )

    with pytest.raises(TelegramClientTimeoutError, match="connection timeout"):
        async with short_lived_client(
            session_string=None,
            client_factory=factory,
            connect_timeout_seconds=0.01,
            disconnect_timeout_seconds=0.01,
        ):
            pytest.fail("A timed-out Telegram connection must not yield a client.")

    assert created[0].disconnected is True


@pytest.mark.asyncio
async def test_short_lived_client_bounds_disconnect_time_without_masking_success(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    disconnect_started = asyncio.Event()

    class _HangingDisconnectClient(_FakeClient):
        async def disconnect(self) -> None:
            disconnect_started.set()
            await asyncio.Event().wait()

    def factory(
        session: object,
        api_id: int,
        api_hash: str,
    ) -> _HangingDisconnectClient:
        return _HangingDisconnectClient(session, api_id, api_hash)

    monkeypatch.setattr(
        client_module, "_telegram_api_credentials", lambda: (123, "hash")
    )

    with caplog.at_level(logging.WARNING):
        async with short_lived_client(
            session_string=None,
            client_factory=factory,
            connect_timeout_seconds=0.01,
            disconnect_timeout_seconds=0.01,
        ) as client:
            assert client.connected is True

    assert disconnect_started.is_set()
    assert "Timed out disconnecting a Telegram client" in caplog.text


@pytest.mark.asyncio
async def test_delete_saved_messages_is_user_scoped_and_refreshes_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SimpleNamespace(
        state="connected",
        session_encrypted="encrypted-old",
        password_required=False,
        pending_phone_code_hash_encrypted=None,
        pending_expires_at=None,
        telegram_user_id=123,
        generation=4,
    )
    session = _FakeSession(connection)
    telegram_client = _FakeClient(object(), 1, "hash")

    @asynccontextmanager
    async def fake_client(**_: Any):
        yield telegram_client

    monkeypatch.setattr(
        client_module, "decrypt_secret", lambda value, *, context: "plain-session"
    )
    monkeypatch.setattr(
        client_module, "encrypt_secret", lambda value, *, context: f"encrypted:{value}"
    )
    monkeypatch.setattr(client_module, "short_lived_client", fake_client)

    await delete_saved_messages(
        user_id="user-a",
        telegram_user_id=123,
        connection_generation=4,
        message_ids=[7, 7, 9],
        session=session,  # type: ignore[arg-type]
    )

    assert telegram_client.deleted == [("me", [7, 9])]
    assert connection.session_encrypted == "encrypted:refreshed-session"
    assert session.flush_calls == 1
    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_delete_crypto_erases_a_corrupt_saved_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SimpleNamespace(
        state="connected",
        session_encrypted="corrupt",
        phone_encrypted="phone",
        password_required=False,
        pending_phone_code_hash_encrypted=None,
        pending_expires_at=None,
        telegram_user_id=123,
        generation=4,
    )
    session = _FakeSession(connection)
    monkeypatch.setattr(
        client_module,
        "decrypt_secret",
        lambda value, *, context: (_ for _ in ()).throw(
            SecretDecryptionError("corrupt")
        ),
    )

    with pytest.raises(TelegramClientNotConnectedError):
        await delete_saved_messages(
            user_id="user-a",
            telegram_user_id=123,
            connection_generation=4,
            message_ids=[7],
            session=session,  # type: ignore[arg-type]
        )

    assert connection.state == "disconnected"
    assert connection.telegram_user_id is None
    assert connection.phone_encrypted is None
    assert connection.session_encrypted is None
    assert connection.generation == 5
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_delete_saved_messages_rejects_session_with_wrong_telegram_principal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SimpleNamespace(
        state="connected",
        session_encrypted="encrypted-old",
        telegram_user_id=123,
        generation=4,
        password_required=False,
        pending_phone_code_hash_encrypted=None,
        pending_expires_at=None,
    )
    session = _FakeSession(connection)
    telegram_client = _FakeClient(object(), 1, "hash")
    telegram_client.telegram_user_id = 999

    @asynccontextmanager
    async def fake_client(**_: Any):
        yield telegram_client

    monkeypatch.setattr(
        client_module, "decrypt_secret", lambda value, *, context: "plain-session"
    )
    monkeypatch.setattr(client_module, "short_lived_client", fake_client)

    with pytest.raises(TelegramMessageProvenanceError):
        await delete_saved_messages(
            user_id="user-a",
            telegram_user_id=123,
            connection_generation=4,
            message_ids=[7],
            session=session,  # type: ignore[arg-type]
        )
    assert telegram_client.deleted == []
    assert connection.state == "disconnected"
    assert connection.telegram_user_id is None
    assert connection.generation == 5
    assert connection.session_encrypted is None
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_delete_saved_messages_downgrades_revoked_authorization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SimpleNamespace(
        state="connected",
        session_encrypted="encrypted-old",
        password_required=True,
        pending_phone_code_hash_encrypted="challenge",
        pending_expires_at=object(),
        telegram_user_id=123,
        generation=4,
    )
    session = _FakeSession(connection)
    telegram_client = _FakeClient(object(), 1, "hash")
    telegram_client.authorized = False

    @asynccontextmanager
    async def fake_client(**_: Any):
        yield telegram_client

    monkeypatch.setattr(
        client_module, "decrypt_secret", lambda value, *, context: "plain-session"
    )
    monkeypatch.setattr(client_module, "short_lived_client", fake_client)

    with pytest.raises(TelegramClientNotConnectedError):
        await delete_saved_messages(
            user_id="user-a",
            telegram_user_id=123,
            connection_generation=4,
            message_ids=[7],
            session=session,  # type: ignore[arg-type]
        )

    assert connection.state == "disconnected"
    assert connection.password_required is False
    assert connection.pending_phone_code_hash_encrypted is None
    assert connection.telegram_user_id is None
    assert connection.generation == 5
    assert connection.session_encrypted is None
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_delete_saved_messages_rejects_missing_user_connection() -> None:
    session = _FakeSession(None)
    with pytest.raises(TelegramMessageProvenanceError):
        await delete_saved_messages(
            user_id="user-a",
            telegram_user_id=123,
            connection_generation=4,
            message_ids=[7],
            session=session,  # type: ignore[arg-type]
        )


@pytest.mark.asyncio
async def test_delete_saved_messages_rejects_old_connection_generation() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as session:
            session.add(
                User(
                    id="user-a",
                    email="user-a@example.com",
                    normalized_email="user-a@example.com",
                    display_name="User A",
                    password_hash="hash",
                )
            )
            session.add(
                TelegramConnection(
                    user_id="user-a",
                    telegram_user_id=123,
                    generation=5,
                    state="connected",
                    session_encrypted="current-session",
                )
            )
            await session.commit()

            with pytest.raises(TelegramMessageProvenanceError):
                await delete_saved_messages(
                    user_id="user-a",
                    telegram_user_id=123,
                    connection_generation=4,
                    message_ids=[7],
                    session=session,
                )
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_revoke_connection_crypto_erases_when_telegram_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SimpleNamespace(
        telegram_user_id=123,
        state="connected",
        phone_encrypted="phone",
        session_encrypted="session",
        password_required=True,
        pending_phone_code_hash_encrypted="challenge",
        pending_expires_at=object(),
        generation=7,
    )
    session = _FakeSession(connection)
    monkeypatch.setattr(
        client_module,
        "decrypt_secret",
        lambda value, *, context: (_ for _ in ()).throw(ValueError("corrupt")),
    )

    await revoke_telegram_connection(user_id="user-a", session=session)  # type: ignore[arg-type]

    assert connection.telegram_user_id is None
    assert connection.phone_encrypted is None
    assert connection.session_encrypted is None
    assert connection.pending_phone_code_hash_encrypted is None
    assert connection.state == "disconnected"
    assert connection.generation == 8
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_revoke_connection_commits_before_bounded_remote_logout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SimpleNamespace(
        telegram_user_id=123,
        state="connected",
        phone_encrypted="phone",
        session_encrypted="session",
        password_required=False,
        pending_phone_code_hash_encrypted=None,
        pending_expires_at=None,
        generation=7,
    )
    session = _FakeSession(connection)
    logout_started = asyncio.Event()

    class _HangingClient(_FakeClient):
        async def log_out(self) -> None:
            logout_started.set()
            await asyncio.Event().wait()

    telegram_client = _HangingClient(object(), 1, "hash")

    @asynccontextmanager
    async def fake_client(**_: Any):
        yield telegram_client

    monkeypatch.setattr(
        client_module, "decrypt_secret", lambda value, *, context: "plain-session"
    )
    monkeypatch.setattr(client_module, "short_lived_client", fake_client)
    monkeypatch.setattr(client_module, "TELEGRAM_LOGOUT_TIMEOUT_SECONDS", 0.01)

    await revoke_telegram_connection(user_id="user-a", session=session)  # type: ignore[arg-type]

    assert logout_started.is_set()
    assert session.commit_calls == 1
    assert connection.session_encrypted is None
    assert connection.state == "disconnected"
