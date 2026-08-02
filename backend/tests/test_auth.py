from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from app.auth import service as service_module
from app.auth.schemas import TelegramConnectionState, TelegramVerifyRequest
from app.auth.router import router
from app.auth.service import TelegramAuthService
from app.security import SecretDecryptionError


class _FakeSession:
    def __init__(self, connection: object | None) -> None:
        self.connection = connection
        self.added: list[object] = []
        self.execute_calls: list[object] = []
        self.commit_calls = 0

    async def scalar(self, _statement: object) -> object | None:
        if "WHERE telegram_connections.telegram_user_id" in str(_statement):
            return None
        return self.connection

    def add(self, value: object) -> None:
        self.added.append(value)
        self.connection = value

    async def flush(self) -> None:
        return None

    async def execute(self, _statement: object) -> SimpleNamespace:
        self.execute_calls.append(_statement)
        return SimpleNamespace(rowcount=0)

    async def commit(self) -> None:
        self.commit_calls += 1

    async def rollback(self) -> None:
        return None


class _ClientSession:
    def save(self) -> str:
        return "saved-string-session"


class _FakeClient:
    def __init__(self, *, authorized: bool = False) -> None:
        self.session = _ClientSession()
        self.authorized = authorized
        self.sent_phone: str | None = None
        self.sign_in_kwargs: dict[str, Any] | None = None
        self.telegram_user_id = 123
        self.logged_out = False

    async def is_user_authorized(self) -> bool:
        return self.authorized

    async def send_code_request(self, phone: str) -> object:
        self.sent_phone = phone
        return SimpleNamespace(phone_code_hash="code-hash")

    async def sign_in(self, **kwargs: Any) -> None:
        self.sign_in_kwargs = kwargs
        self.authorized = True

    async def get_me(self) -> SimpleNamespace:
        return SimpleNamespace(id=self.telegram_user_id)

    async def log_out(self) -> None:
        self.logged_out = True


def _connection(**overrides: Any) -> SimpleNamespace:
    values = {
        "user_id": "user-a",
        "telegram_user_id": None,
        "phone_encrypted": None,
        "session_encrypted": None,
        "state": "disconnected",
        "pending_phone_code_hash_encrypted": None,
        "pending_expires_at": None,
        "password_required": False,
        "generation": 0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_verify_schema_accepts_exactly_one_ephemeral_secret() -> None:
    assert TelegramVerifyRequest(code=" 12345 ").code == "12345"
    assert TelegramVerifyRequest(password="  keep whitespace  ").password == "  keep whitespace  "
    with pytest.raises(ValidationError):
        TelegramVerifyRequest()
    with pytest.raises(ValidationError):
        TelegramVerifyRequest(code="123", password="secret")


def test_connection_router_exposes_the_user_scoped_contract() -> None:
    operations = {
        (route.path, next(iter(route.methods or set())))
        for route in router.routes
    }
    assert ("/telegram/connection", "GET") in operations
    assert ("/telegram/connection", "POST") in operations
    assert ("/telegram/connection", "DELETE") in operations
    assert ("/telegram/connection/verify", "POST") in operations


@pytest.mark.asyncio
async def test_status_maps_persisted_pending_state_without_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        service_module,
        "decrypt_secret",
        lambda value, *, context: "session",
    )
    session = _FakeSession(
        _connection(
            state="pending",
            session_encrypted="cipher",
            pending_expires_at=datetime.now(tz=UTC) + timedelta(minutes=5),
            password_required=True,
        )
    )
    service = TelegramAuthService(session=session, user_id="user-a")  # type: ignore[arg-type]
    assert await service.status() is TelegramConnectionState.PASSWORD_REQUIRED


@pytest.mark.asyncio
async def test_status_crypto_erases_an_expired_challenge() -> None:
    connection = _connection(
        state="pending",
        phone_encrypted="phone-cipher",
        session_encrypted="session-cipher",
        pending_phone_code_hash_encrypted="hash-cipher",
        pending_expires_at=datetime.now(tz=UTC) - timedelta(seconds=1),
        password_required=True,
    )
    session = _FakeSession(connection)

    state = await TelegramAuthService(session=session, user_id="user-a").status()  # type: ignore[arg-type]

    assert state is TelegramConnectionState.DISCONNECTED
    assert connection.state == "disconnected"
    assert connection.phone_encrypted is None
    assert connection.session_encrypted is None
    assert connection.pending_phone_code_hash_encrypted is None
    assert connection.pending_expires_at is None
    assert connection.password_required is False
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_status_invalidates_corrupt_connection_ciphertext(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection(
        state="connected",
        telegram_user_id=123,
        phone_encrypted="phone-cipher",
        session_encrypted="corrupt-session",
        generation=4,
    )
    session = _FakeSession(connection)
    monkeypatch.setattr(
        service_module,
        "decrypt_secret",
        lambda value, *, context: (_ for _ in ()).throw(
            SecretDecryptionError("corrupt")
        ),
    )

    state = await TelegramAuthService(session=session, user_id="user-a").status()  # type: ignore[arg-type]

    assert state is TelegramConnectionState.DISCONNECTED
    assert connection.state == "error"
    assert connection.telegram_user_id is None
    assert connection.phone_encrypted is None
    assert connection.session_encrypted is None
    assert connection.generation == 5
    assert len(session.execute_calls) == 1
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_start_persists_only_encrypted_challenge_material(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection()
    session = _FakeSession(connection)
    client = _FakeClient()

    @asynccontextmanager
    async def fake_client(**_: Any):
        yield client

    monkeypatch.setattr(service_module, "short_lived_client", fake_client)
    monkeypatch.setattr(
        service_module,
        "encrypt_secret",
        lambda value, *, context: f"cipher:{context}:{value}",
    )

    state = await TelegramAuthService(session=session, user_id="user-a").start(phone=" +49123 ")  # type: ignore[arg-type]

    assert state is TelegramConnectionState.CODE_REQUIRED
    assert connection.state == "pending"
    assert connection.phone_encrypted.endswith(":+49123")
    assert connection.pending_phone_code_hash_encrypted.endswith(":code-hash")
    assert connection.session_encrypted.endswith(":saved-string-session")
    assert connection.generation == 1
    assert "+49123" not in vars(connection).values()
    assert "code-hash" not in vars(connection).values()


@pytest.mark.asyncio
async def test_starting_new_challenge_clears_old_principal_and_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection(
        telegram_user_id=999,
        session_encrypted="old-session",
        state="connected",
        generation=7,
    )
    session = _FakeSession(connection)
    client = _FakeClient(authorized=False)

    @asynccontextmanager
    async def fake_client(**_: Any):
        yield client

    monkeypatch.setattr(service_module, "short_lived_client", fake_client)
    monkeypatch.setattr(service_module, "decrypt_secret", lambda value, *, context: "session")
    monkeypatch.setattr(service_module, "encrypt_secret", lambda value, *, context: f"cipher:{value}")

    state = await TelegramAuthService(session=session, user_id="user-a").start(  # type: ignore[arg-type]
        phone="+49123"
    )

    assert state is TelegramConnectionState.CODE_REQUIRED
    assert connection.telegram_user_id is None
    assert connection.generation == 8
    assert len(session.execute_calls) == 1
    assert "scan_jobs" in str(session.execute_calls[0])


@pytest.mark.asyncio
async def test_verify_uses_ephemeral_code_and_clears_challenge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection(
        state="pending",
        phone_encrypted="phone-cipher",
        session_encrypted="session-cipher",
        pending_phone_code_hash_encrypted="hash-cipher",
        pending_expires_at=datetime.now(tz=UTC) + timedelta(minutes=5),
    )
    session = _FakeSession(connection)
    client = _FakeClient()

    @asynccontextmanager
    async def fake_client(**_: Any):
        yield client

    plaintext = {
        "phone-cipher": "+49123",
        "session-cipher": "session-string",
        "hash-cipher": "phone-code-hash",
    }
    monkeypatch.setattr(service_module, "short_lived_client", fake_client)
    monkeypatch.setattr(service_module, "decrypt_secret", lambda value, *, context: plaintext[value])
    monkeypatch.setattr(service_module, "encrypt_secret", lambda value, *, context: f"cipher:{value}")

    state = await TelegramAuthService(session=session, user_id="user-a").verify(  # type: ignore[arg-type]
        code="12345",
        password=None,
    )

    assert state is TelegramConnectionState.CONNECTED
    assert client.sign_in_kwargs == {
        "phone": "+49123",
        "code": "12345",
        "phone_code_hash": "phone-code-hash",
    }
    assert connection.pending_phone_code_hash_encrypted is None
    assert connection.pending_expires_at is None
    assert connection.state == "connected"
    assert connection.telegram_user_id == 123


@pytest.mark.asyncio
async def test_verify_is_idempotent_after_connection_succeeds() -> None:
    connection = _connection(
        state="connected",
        telegram_user_id=123,
        session_encrypted="session-cipher",
        pending_expires_at=None,
    )
    session = _FakeSession(connection)

    state = await TelegramAuthService(session=session, user_id="user-a").verify(  # type: ignore[arg-type]
        code="12345",
        password=None,
    )

    assert state is TelegramConnectionState.CONNECTED
    assert connection.state == "connected"
    assert connection.session_encrypted == "session-cipher"
    assert session.commit_calls == 0
