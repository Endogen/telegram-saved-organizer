from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException, Request
from pydantic import ValidationError

from app.auth import router as router_module
from app.auth import service as service_module
from app.auth.schemas import (
    TelegramConnectionRequest,
    TelegramConnectionState,
    TelegramVerifyRequest,
)
from app.auth.router import router
from app.auth.service import TelegramAuthService
from app.security import SecretDecryptionError

API_ID = 123456
API_HASH = "0123456789abcdef0123456789abcdef"


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
        "api_id_encrypted": None,
        "api_hash_encrypted": None,
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
    assert (
        TelegramVerifyRequest(password="  keep whitespace  ").password
        == "  keep whitespace  "
    )
    with pytest.raises(ValidationError):
        TelegramVerifyRequest()
    with pytest.raises(ValidationError):
        TelegramVerifyRequest(code="123", password="secret")


def test_connection_schema_requires_each_user_to_supply_api_credentials() -> None:
    payload = TelegramConnectionRequest(
        api_id=123456,
        api_hash="0123456789abcdef0123456789abcdef",
        phone="  +491****6789  ",
    )

    assert payload.api_id == 123456
    assert payload.api_hash == "0123456789abcdef0123456789abcdef"
    assert payload.phone == "+491****6789"
    with pytest.raises(ValidationError):
        TelegramConnectionRequest(phone="+491****6789")
    with pytest.raises(ValidationError):
        TelegramConnectionRequest(api_id=0, api_hash="short", phone="+491****6789")


def test_connection_router_exposes_the_user_scoped_contract() -> None:
    operations = {
        (route.path, next(iter(route.methods or set()))) for route in router.routes
    }
    assert ("/telegram/connection", "GET") in operations
    assert ("/telegram/connection", "POST") in operations
    assert ("/telegram/connection", "DELETE") in operations
    assert ("/telegram/connection/verify", "POST") in operations


@pytest.mark.asyncio
async def test_connect_maps_phone_mismatch_to_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class MismatchService:
        async def start(
            self, *, api_id: int, api_hash: str, phone: str
        ) -> TelegramConnectionState:
            assert api_id == 123456
            assert api_hash == "0123456789abcdef0123456789abcdef"
            assert phone == "+491****6789"
            raise service_module.TelegramPhoneMismatchError("different phone")

    async def skip_rate_limits(*_: Any, **__: Any) -> None:
        return None

    monkeypatch.setattr(router_module, "_service", lambda **_: MismatchService())
    monkeypatch.setattr(router_module, "enforce_rate_limits", skip_rate_limits)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/telegram/connection",
            "headers": [],
            "query_string": b"",
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
        }
    )

    with pytest.raises(HTTPException) as rejected:
        await router_module.connect_telegram(
            TelegramConnectionRequest(
                api_id=123456,
                api_hash="0123456789abcdef0123456789abcdef",
                phone="+491****6789",
            ),
            request,
            SimpleNamespace(id="user-a"),
            object(),  # type: ignore[arg-type]
        )

    assert rejected.value.status_code == 409
    assert rejected.value.detail == "telegram_phone_mismatch"


@pytest.mark.asyncio
async def test_status_maps_persisted_pending_state_without_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        service_module,
        "decrypt_secret",
        lambda value, *, context: "123456" if context.endswith(":api_id") else API_HASH
        if context.endswith(":api_hash")
        else "session",
    )
    session = _FakeSession(
        _connection(
            state="pending",
            api_id_encrypted="api-id-cipher",
            api_hash_encrypted="api-hash-cipher",
            phone_encrypted="phone-cipher",
            session_encrypted="cipher",
            pending_phone_code_hash_encrypted="phone-code-hash-cipher",
            pending_expires_at=datetime.now(tz=UTC) + timedelta(minutes=5),
            password_required=True,
        )
    )
    service = TelegramAuthService(session=session, user_id="user-a")  # type: ignore[arg-type]
    assert await service.status() is TelegramConnectionState.PASSWORD_REQUIRED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("state", "expected"),
    [
        (
            TelegramConnectionState.CODE_REQUIRED,
            {"state": "code_required", "phone_masked": "••• ••• 0123"},
        ),
        (
            TelegramConnectionState.PASSWORD_REQUIRED,
            {"state": "password_required", "phone_masked": "••• ••• 0123"},
        ),
        (
            TelegramConnectionState.CONNECTED,
            {
                "state": "connected",
                "account": {"phone_masked": "••• ••• 0123"},
            },
        ),
    ],
)
async def test_connection_response_returns_only_masked_phone_identity(
    monkeypatch: pytest.MonkeyPatch,
    state: TelegramConnectionState,
    expected: dict[str, Any],
) -> None:
    session = _FakeSession(_connection(phone_encrypted="phone-cipher"))
    monkeypatch.setattr(
        service_module,
        "decrypt_secret",
        lambda value, *, context: "+49 170 890123",
    )
    service = TelegramAuthService(session=session, user_id="user-a")  # type: ignore[arg-type]

    response = await service.response(state=state)

    assert response.model_dump(mode="json", exclude_none=True) == expected
    assert "+49 170 890123" not in response.model_dump_json()


@pytest.mark.asyncio
async def test_connection_response_omits_identity_when_phone_cannot_be_opened(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _FakeSession(_connection(phone_encrypted="corrupt-phone"))
    monkeypatch.setattr(
        service_module,
        "decrypt_secret",
        lambda value, *, context: (_ for _ in ()).throw(
            SecretDecryptionError("corrupt")
        ),
    )
    service = TelegramAuthService(session=session, user_id="user-a")  # type: ignore[arg-type]

    response = await service.response(state=TelegramConnectionState.CONNECTED)

    assert response.model_dump(mode="json", exclude_none=True) == {"state": "connected"}


@pytest.mark.asyncio
async def test_status_crypto_erases_an_expired_challenge() -> None:
    connection = _connection(
        state="pending",
        api_id_encrypted="api-id-cipher",
        api_hash_encrypted="api-hash-cipher",
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
        api_id_encrypted="api-id-cipher",
        api_hash_encrypted="api-hash-cipher",
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
    assert {statement.table.name for statement in session.execute_calls} == {
        "messages",
        "scan_jobs",
    }
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_status_crypto_erases_connection_with_missing_api_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection(
        state="connected",
        telegram_user_id=123,
        phone_encrypted="phone-cipher",
        session_encrypted="session-cipher",
        generation=8,
    )
    session = _FakeSession(connection)
    monkeypatch.setattr(
        service_module,
        "decrypt_secret",
        lambda value, *, context: "valid-session",
    )

    state = await TelegramAuthService(session=session, user_id="user-a").status()  # type: ignore[arg-type]

    assert state is TelegramConnectionState.DISCONNECTED
    assert connection.state == "error"
    assert connection.telegram_user_id is None
    assert connection.api_id_encrypted is None
    assert connection.api_hash_encrypted is None
    assert connection.phone_encrypted is None
    assert connection.session_encrypted is None
    assert connection.generation == 9
    assert session.commit_calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("persisted_state", ["disconnected", "error"])
async def test_status_crypto_erases_authorization_material_in_non_active_states(
    persisted_state: str,
) -> None:
    connection = _connection(
        state=persisted_state,
        telegram_user_id=123,
        api_id_encrypted="api-id-cipher",
        api_hash_encrypted="api-hash-cipher",
        phone_encrypted="phone-cipher",
        session_encrypted="session-cipher",
        generation=10,
    )
    session = _FakeSession(connection)

    state = await TelegramAuthService(session=session, user_id="user-a").status()  # type: ignore[arg-type]

    assert state is TelegramConnectionState.DISCONNECTED
    assert connection.state == "error"
    assert connection.telegram_user_id is None
    assert connection.session_encrypted is None
    assert connection.api_id_encrypted is None
    assert connection.api_hash_encrypted is None
    assert connection.generation == 11
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_status_crypto_erases_incomplete_pending_challenge() -> None:
    connection = _connection(
        state="pending",
        api_id_encrypted="api-id-cipher",
        api_hash_encrypted="api-hash-cipher",
        phone_encrypted="phone-cipher",
        session_encrypted="session-cipher",
        pending_expires_at=datetime.now(tz=UTC) + timedelta(minutes=5),
        generation=12,
    )
    session = _FakeSession(connection)

    state = await TelegramAuthService(session=session, user_id="user-a").status()  # type: ignore[arg-type]

    assert state is TelegramConnectionState.DISCONNECTED
    assert connection.state == "error"
    assert connection.session_encrypted is None
    assert connection.pending_expires_at is None
    assert connection.generation == 13
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_status_crypto_erases_connected_state_without_telegram_identity() -> None:
    connection = _connection(
        state="connected",
        api_id_encrypted="api-id-cipher",
        api_hash_encrypted="api-hash-cipher",
        phone_encrypted="phone-cipher",
        session_encrypted="session-cipher",
        generation=14,
    )
    session = _FakeSession(connection)

    state = await TelegramAuthService(session=session, user_id="user-a").status()  # type: ignore[arg-type]

    assert state is TelegramConnectionState.DISCONNECTED
    assert connection.state == "error"
    assert connection.session_encrypted is None
    assert connection.generation == 15
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

    state = await TelegramAuthService(session=session, user_id="user-a").start(
        api_id=API_ID, api_hash=API_HASH, phone=" +49123 "
    )  # type: ignore[arg-type]

    assert state is TelegramConnectionState.CODE_REQUIRED
    assert connection.state == "pending"
    assert connection.phone_encrypted.endswith(":+49123")
    assert connection.pending_phone_code_hash_encrypted.endswith(":code-hash")
    assert connection.session_encrypted.endswith(":saved-string-session")
    assert connection.generation == 1
    assert "+49123" not in vars(connection).values()
    assert "code-hash" not in vars(connection).values()


@pytest.mark.asyncio
async def test_start_never_reuses_authorization_material_from_disconnected_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection(
        state="disconnected",
        telegram_user_id=999,
        api_id_encrypted="old-api-id",
        api_hash_encrypted="old-api-hash",
        phone_encrypted="old-phone",
        session_encrypted="old-session",
        generation=3,
    )
    session = _FakeSession(connection)
    client = _FakeClient(authorized=False)
    received_session: list[str | None] = []

    @asynccontextmanager
    async def fake_client(**kwargs: Any):
        received_session.append(kwargs["session_string"])
        yield client

    monkeypatch.setattr(service_module, "short_lived_client", fake_client)
    monkeypatch.setattr(
        service_module,
        "encrypt_secret",
        lambda value, *, context: f"cipher:{context}:{value}",
    )

    state = await TelegramAuthService(session=session, user_id="user-a").start(  # type: ignore[arg-type]
        api_id=API_ID,
        api_hash=API_HASH,
        phone="+49123",
    )

    assert state is TelegramConnectionState.CODE_REQUIRED
    assert received_session == [None]
    assert connection.telegram_user_id is None
    assert connection.state == "pending"
    assert connection.generation == 5
    assert session.commit_calls == 2


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
    monkeypatch.setattr(
        service_module, "decrypt_secret", lambda value, *, context: "session"
    )
    monkeypatch.setattr(
        service_module, "encrypt_secret", lambda value, *, context: f"cipher:{value}"
    )

    state = await TelegramAuthService(session=session, user_id="user-a").start(  # type: ignore[arg-type]
        api_id=API_ID, api_hash=API_HASH, phone="+49123"
    )

    assert state is TelegramConnectionState.CODE_REQUIRED
    assert connection.telegram_user_id is None
    assert connection.generation == 8
    assert {statement.table.name for statement in session.execute_calls} == {
        "messages",
        "scan_jobs",
    }
    assert "scan_jobs" in str(session.execute_calls[0])


@pytest.mark.asyncio
async def test_start_rejects_different_phone_while_still_authorized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection(
        telegram_user_id=111,
        phone_encrypted="phone-cipher",
        session_encrypted="session-cipher",
        state="connected",
    )
    session = _FakeSession(connection)
    client = _FakeClient(authorized=True)

    @asynccontextmanager
    async def fake_client(**_: Any):
        yield client

    def fake_decrypt(_value: str, *, context: str) -> str:
        return "+491111111" if context.endswith(":phone") else "session"

    monkeypatch.setattr(service_module, "short_lived_client", fake_client)
    monkeypatch.setattr(service_module, "decrypt_secret", fake_decrypt)

    with pytest.raises(service_module.TelegramPhoneMismatchError):
        await TelegramAuthService(session=session, user_id="user-a").start(  # type: ignore[arg-type]
            api_id=API_ID, api_hash=API_HASH, phone="+492****2222"
        )

    assert connection.state == "connected"
    assert connection.telegram_user_id == 111
    assert client.sent_phone is None
    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_start_reconnects_same_phone_with_equivalent_format(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection(
        telegram_user_id=111,
        phone_encrypted="phone-cipher",
        session_encrypted="session-cipher",
        state="connected",
    )
    session = _FakeSession(connection)
    client = _FakeClient(authorized=True)
    client.telegram_user_id = 111

    @asynccontextmanager
    async def fake_client(**_: Any):
        yield client

    def fake_decrypt(_value: str, *, context: str) -> str:
        return "+49 (123) 456-789" if context.endswith(":phone") else "session"

    monkeypatch.setattr(service_module, "short_lived_client", fake_client)
    monkeypatch.setattr(service_module, "decrypt_secret", fake_decrypt)
    monkeypatch.setattr(
        service_module, "encrypt_secret", lambda value, *, context: f"cipher:{value}"
    )

    state = await TelegramAuthService(session=session, user_id="user-a").start(  # type: ignore[arg-type]
        api_id=API_ID, api_hash=API_HASH, phone="0049 123 456 789"
    )

    assert state is TelegramConnectionState.CONNECTED
    assert connection.state == "connected"
    assert client.sent_phone is None


@pytest.mark.asyncio
async def test_verify_uses_ephemeral_code_and_clears_challenge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _connection(
        state="pending",
        api_id_encrypted="api-id-cipher",
        api_hash_encrypted="api-hash-cipher",
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
        "api-id-cipher": str(API_ID),
        "api-hash-cipher": API_HASH,
        "session-cipher": "session-string",
        "hash-cipher": "phone-code-hash",
    }
    monkeypatch.setattr(service_module, "short_lived_client", fake_client)
    monkeypatch.setattr(
        service_module, "decrypt_secret", lambda value, *, context: plaintext[value]
    )
    monkeypatch.setattr(
        service_module, "encrypt_secret", lambda value, *, context: f"cipher:{value}"
    )

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
