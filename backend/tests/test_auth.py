from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from telethon.errors import PhoneCodeInvalidError, SessionPasswordNeededError

from app.auth import service as auth_service_module
from app.auth.schemas import VerifyRequest
from app.auth.router import get_auth_service
from app.auth.service import TelegramAuthService, VerificationCodeRequiredError, _save_credentials
from app.main import create_app
from app.telegram.client import TelegramClientCredentialsMismatchError


@dataclass(slots=True)
class _SentCode:
    phone_code_hash: str | None


class _FakeTelethonClient:
    def __init__(self) -> None:
        self.authorized = False
        self.code_hash: str | None = "hash-123"
        self.send_code_calls: list[str] = []
        self.sign_in_calls: list[dict[str, Any]] = []
        self.send_code_error: Exception | None = None
        self.require_password_on_code = False
        self.authorize_on_code = True
        self.authorize_on_password = True

    async def send_code_request(self, phone: str) -> _SentCode:
        if self.send_code_error is not None:
            raise self.send_code_error
        self.send_code_calls.append(phone)
        return _SentCode(phone_code_hash=self.code_hash)

    async def sign_in(
        self,
        *,
        phone: str | None = None,
        code: str | None = None,
        phone_code_hash: str | None = None,
        password: str | None = None,
    ) -> None:
        self.sign_in_calls.append(
            {
                "phone": phone,
                "code": code,
                "phone_code_hash": phone_code_hash,
                "password": password,
            }
        )
        if password:
            if self.authorize_on_password:
                self.authorized = True
            return
        if self.require_password_on_code:
            raise SessionPasswordNeededError(request=None)
        if code == "00000":
            raise PhoneCodeInvalidError(request=None)
        if self.authorize_on_code:
            self.authorized = True

    async def is_user_authorized(self) -> bool:
        return self.authorized


class _FakeTelegramManager:
    def __init__(self) -> None:
        self.client = _FakeTelethonClient()
        self.connected = False
        self.session = False
        self.connect_calls: list[tuple[int, str]] = []
        self.reset_calls = 0
        self.raise_mismatch = False

    async def connect(self, *, api_id: int, api_hash: str) -> _FakeTelethonClient:
        if self.raise_mismatch:
            raise TelegramClientCredentialsMismatchError("Credentials mismatch")
        self.connect_calls.append((api_id, api_hash))
        self.connected = True
        self.session = True
        return self.client

    async def reset_session(self) -> None:
        self.reset_calls += 1
        self.connected = False
        self.session = False
        self.client.authorized = False

    def is_connected(self) -> bool:
        return self.connected

    def has_session(self) -> bool:
        return self.session

    def get_connected_client(self) -> _FakeTelethonClient | None:
        return self.client if self.connected else None


@pytest.fixture
def auth_context() -> tuple[Any, _FakeTelegramManager]:
    manager = _FakeTelegramManager()
    service = TelegramAuthService(manager=manager)
    app = create_app(api_token=None)

    async def override_auth_service() -> TelegramAuthService:
        return service

    app.dependency_overrides[get_auth_service] = override_auth_service
    yield app, manager
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_connect_endpoint_starts_verification_flow(
    auth_context: tuple[Any, _FakeTelegramManager],
) -> None:
    app, manager = auth_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/auth/connect",
            json={"api_id": 12345, "api_hash": "abc123", "phone": "+15550001111"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "connected": True,
        "authorized": False,
        "has_session": True,
        "verification_required": True,
        "password_required": False,
    }
    assert manager.client.send_code_calls == ["+15550001111"]
    assert manager.connect_calls == [(12345, "abc123")]


@pytest.mark.asyncio
async def test_connect_endpoint_returns_authorized_if_user_already_signed_in(
    auth_context: tuple[Any, _FakeTelegramManager],
) -> None:
    app, manager = auth_context
    manager.client.authorized = True
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/auth/connect",
            json={"api_id": 12345, "api_hash": "abc123", "phone": "+15550001111"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "connected": True,
        "authorized": True,
        "has_session": True,
        "verification_required": False,
        "password_required": False,
    }
    assert manager.client.send_code_calls == []


@pytest.mark.asyncio
async def test_connect_endpoint_returns_bad_request_for_rpc_error(
    auth_context: tuple[Any, _FakeTelegramManager],
) -> None:
    app, manager = auth_context
    manager.client.send_code_error = PhoneCodeInvalidError(request=None)
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/auth/connect",
            json={"api_id": 12345, "api_hash": "abc123", "phone": "+15550001111"},
        )

    assert response.status_code == 400
    assert "phone code" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_verify_endpoint_completes_authorization(
    auth_context: tuple[Any, _FakeTelegramManager],
) -> None:
    app, manager = auth_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        connect_response = await client.post(
            "/api/auth/connect",
            json={"api_id": 12345, "api_hash": "abc123", "phone": "+15550001111"},
        )
        verify_response = await client.post("/api/auth/verify", json={"code": "12345"})

    assert connect_response.status_code == 200
    assert verify_response.status_code == 200
    assert verify_response.json()["authorized"] is True
    assert verify_response.json()["verification_required"] is False
    assert manager.client.sign_in_calls == [
        {
            "phone": "+15550001111",
            "code": "12345",
            "phone_code_hash": "hash-123",
            "password": None,
        }
    ]


@pytest.mark.asyncio
async def test_verify_endpoint_returns_bad_request_for_rpc_error(
    auth_context: tuple[Any, _FakeTelegramManager],
) -> None:
    app, _ = auth_context
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        await client.post(
            "/api/auth/connect",
            json={"api_id": 12345, "api_hash": "abc123", "phone": "+15550001111"},
        )
        response = await client.post("/api/auth/verify", json={"code": "00000"})

    assert response.status_code == 400
    assert "phone code" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_verify_endpoint_requires_connect_first(
    auth_context: tuple[Any, _FakeTelegramManager],
) -> None:
    app, _ = auth_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/auth/verify", json={"code": "12345"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Telegram verification has not been started."


@pytest.mark.asyncio
async def test_verify_endpoint_handles_password_required_flow(
    auth_context: tuple[Any, _FakeTelegramManager],
) -> None:
    app, manager = auth_context
    manager.client.require_password_on_code = True

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        await client.post(
            "/api/auth/connect",
            json={"api_id": 12345, "api_hash": "abc123", "phone": "+15550001111"},
        )
        verify_response = await client.post("/api/auth/verify", json={"code": "12345"})
        status_response = await client.get("/api/auth/status")
        password_verify_response = await client.post(
            "/api/auth/verify", json={"password": "super-secret-password"}
        )

    assert verify_response.status_code == 401
    assert status_response.status_code == 200
    assert status_response.json()["password_required"] is True
    assert password_verify_response.status_code == 200
    assert password_verify_response.json()["authorized"] is True


@pytest.mark.asyncio
async def test_verify_endpoint_maps_validation_error_for_empty_payload(
    auth_context: tuple[Any, _FakeTelegramManager],
) -> None:
    app, _ = auth_context
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/auth/verify", json={})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_connect_endpoint_returns_conflict_for_credential_mismatch(
    auth_context: tuple[Any, _FakeTelegramManager],
) -> None:
    app, manager = auth_context
    manager.raise_mismatch = True
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/auth/connect",
            json={"api_id": 12345, "api_hash": "abc123", "phone": "+15550001111"},
        )

    assert response.status_code == 409
    assert response.json()["detail"] == "Credentials mismatch"


@pytest.mark.asyncio
async def test_disconnect_endpoint_clears_session_state(
    auth_context: tuple[Any, _FakeTelegramManager],
) -> None:
    app, manager = auth_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        await client.post(
            "/api/auth/connect",
            json={"api_id": 12345, "api_hash": "abc123", "phone": "+15550001111"},
        )
        response = await client.post("/api/auth/disconnect")

    assert response.status_code == 200
    assert response.json() == {
        "connected": False,
        "authorized": False,
        "has_session": False,
        "verification_required": False,
        "password_required": False,
    }
    assert manager.reset_calls == 1


@pytest.mark.asyncio
async def test_start_connection_raises_when_phone_code_hash_missing() -> None:
    manager = _FakeTelegramManager()
    manager.client.code_hash = None
    service = TelegramAuthService(manager=manager)

    with pytest.raises(RuntimeError, match="phone_code_hash"):
        await service.start_connection(api_id=12345, api_hash="abc123", phone="+15550001111")


@pytest.mark.asyncio
async def test_verify_requires_code_or_password_when_pending() -> None:
    manager = _FakeTelegramManager()
    service = TelegramAuthService(manager=manager)

    await service.start_connection(api_id=12345, api_hash="abc123", phone="+15550001111")

    with pytest.raises(VerificationCodeRequiredError, match="Verification code is required."):
        await service.verify()


@pytest.mark.asyncio
async def test_verify_returns_not_authorized_when_telegram_rejects_sign_in() -> None:
    manager = _FakeTelegramManager()
    manager.client.authorize_on_code = False
    service = TelegramAuthService(manager=manager)

    await service.start_connection(api_id=12345, api_hash="abc123", phone="+15550001111")
    status = await service.verify(code="12345")

    assert status.authorized is False
    assert status.verification_required is True
    assert status.password_required is False


@pytest.mark.asyncio
async def test_status_does_not_treat_unauthorized_saved_session_as_authorized() -> None:
    manager = _FakeTelegramManager()
    manager.connected = True
    manager.session = True
    manager.client.authorized = False
    service = TelegramAuthService(manager=manager)

    status = await service.status()

    assert status.connected is True
    assert status.has_session is True
    assert status.authorized is False


@pytest.mark.asyncio
async def test_status_reports_connected_authorized_session() -> None:
    manager = _FakeTelegramManager()
    manager.connected = True
    manager.session = True
    manager.client.authorized = True
    service = TelegramAuthService(manager=manager)

    status = await service.status()

    assert status.connected is True
    assert status.has_session is True
    assert status.authorized is True


def test_verify_request_model_rejects_blank_code_and_password() -> None:
    with pytest.raises(ValidationError, match="Either code or password must be provided."):
        VerifyRequest(code=" ", password=" ")


def test_save_credentials_restricts_file_permissions(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    credentials_file = tmp_path / "credentials.json"
    credentials_file.write_text("stale", encoding="utf-8")
    credentials_file.chmod(0o644)
    monkeypatch.setattr(auth_service_module, "CREDENTIALS_FILE", credentials_file)

    _save_credentials(api_id=12345, api_hash="abc123", phone="+15550001111")

    assert credentials_file.stat().st_mode & 0o777 == 0o600
    assert json.loads(credentials_file.read_text(encoding="utf-8")) == {
        "api_id": 12345,
        "api_hash": "abc123",
        "phone": "+15550001111",
    }
