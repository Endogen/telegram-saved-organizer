"""Service layer for Telegram auth workflow management."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Protocol

from telethon.errors import SessionPasswordNeededError

from app.config import PRIVATE_FILE_MODE, settings as app_settings
from app.telegram.client import telegram_client_manager

logger = logging.getLogger(__name__)

CREDENTIALS_FILE = app_settings.data_dir / "credentials.json"


def _save_credentials(api_id: int, api_hash: str, phone: str) -> None:
    """Persist Telegram credentials to disk."""

    file_descriptor = os.open(
        CREDENTIALS_FILE,
        os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
        PRIVATE_FILE_MODE,
    )
    try:
        os.fchmod(file_descriptor, PRIVATE_FILE_MODE)
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as credentials_file:
            file_descriptor = -1
            json.dump({"api_id": api_id, "api_hash": api_hash, "phone": phone}, credentials_file)
    finally:
        if file_descriptor >= 0:
            os.close(file_descriptor)


def _load_credentials() -> dict[str, Any] | None:
    """Load persisted credentials if available."""
    if not CREDENTIALS_FILE.exists():
        return None
    try:
        data = json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
        if data.get("api_id") and data.get("api_hash"):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return None


def _clear_credentials() -> None:
    """Remove persisted credentials."""
    CREDENTIALS_FILE.unlink(missing_ok=True)


class VerificationNotStartedError(RuntimeError):
    """Raised when verify is called before connect."""


class VerificationCodeRequiredError(ValueError):
    """Raised when code verification is requested with no code."""


class TwoFactorPasswordRequiredError(RuntimeError):
    """Raised when Telegram requires a 2FA password."""


@dataclass(slots=True)
class AuthStatus:
    """Normalized auth state returned by the service."""

    connected: bool
    authorized: bool
    has_session: bool
    verification_required: bool
    password_required: bool


@dataclass(slots=True)
class PendingVerification:
    """In-memory state for the current verification challenge."""

    api_id: int
    api_hash: str
    phone: str
    phone_code_hash: str
    password_required: bool = False


class TelegramAuthClientProtocol(Protocol):
    """Telethon methods used by the auth service."""

    async def send_code_request(self, phone: str) -> Any: ...

    async def sign_in(
        self,
        *,
        phone: str | None = None,
        code: str | None = None,
        phone_code_hash: str | None = None,
        password: str | None = None,
    ) -> Any: ...

    async def is_user_authorized(self) -> bool: ...


class TelegramAuthManagerProtocol(Protocol):
    """Telegram manager methods used by the auth service."""

    async def connect(self, *, api_id: int, api_hash: str) -> TelegramAuthClientProtocol: ...

    async def reset_session(self) -> None: ...

    def is_connected(self) -> bool: ...

    def has_session(self) -> bool: ...

    def get_connected_client(self) -> TelegramAuthClientProtocol | None: ...


async def auto_reconnect() -> None:
    """Reconnect using saved credentials on startup if a session file exists."""
    creds = _load_credentials()
    if creds is None:
        return
    if not telegram_client_manager.has_session():
        return
    try:
        client = await telegram_client_manager.connect(
            api_id=creds["api_id"],
            api_hash=creds["api_hash"],
        )
        if await client.is_user_authorized():
            logger.info("Auto-reconnected Telegram session")
        else:
            logger.warning("Telegram session exists but is not authorized")
    except Exception:
        logger.exception("Failed to auto-reconnect Telegram")


class TelegramAuthService:
    """Coordinates connect/verify/disconnect behavior for Telegram auth."""

    def __init__(self, manager: TelegramAuthManagerProtocol = telegram_client_manager) -> None:
        self._manager = manager
        self._pending: PendingVerification | None = None
        self._lock = asyncio.Lock()

    async def start_connection(self, *, api_id: int, api_hash: str, phone: str) -> AuthStatus:
        """Connect to Telegram and request a login code for the phone number."""

        client = await self._manager.connect(api_id=api_id, api_hash=api_hash)
        if await client.is_user_authorized():
            _save_credentials(api_id, api_hash, phone)
            async with self._lock:
                self._pending = None
            return self._status(authorized_override=True)

        sent_code = await client.send_code_request(phone)
        phone_code_hash = getattr(sent_code, "phone_code_hash", None)
        if not phone_code_hash:
            raise RuntimeError("Telegram did not return a phone_code_hash.")

        async with self._lock:
            self._pending = PendingVerification(
                api_id=api_id,
                api_hash=api_hash,
                phone=phone,
                phone_code_hash=phone_code_hash,
            )

        return self._status(authorized_override=False)

    async def verify(self, *, code: str | None = None, password: str | None = None) -> AuthStatus:
        """Complete auth with code or 2FA password."""

        async with self._lock:
            pending = self._pending

        if pending is None:
            raise VerificationNotStartedError("Telegram verification has not been started.")

        client = await self._manager.connect(api_id=pending.api_id, api_hash=pending.api_hash)

        try:
            if password:
                await client.sign_in(password=password)
            else:
                if not code:
                    raise VerificationCodeRequiredError("Verification code is required.")
                await client.sign_in(
                    phone=pending.phone,
                    code=code,
                    phone_code_hash=pending.phone_code_hash,
                )
        except SessionPasswordNeededError as exc:
            async with self._lock:
                if self._pending is not None:
                    self._pending.password_required = True
            raise TwoFactorPasswordRequiredError(
                "Two-factor password is required to finish Telegram sign-in."
            ) from exc

        if not await client.is_user_authorized():
            return self._status(authorized_override=False)

        async with self._lock:
            if self._pending is not None:
                _save_credentials(self._pending.api_id, self._pending.api_hash, self._pending.phone)
            self._pending = None

        return self._status(authorized_override=True)

    async def status(self) -> AuthStatus:
        """Return current auth/session status."""

        connected_client = self._manager.get_connected_client()
        authorized = False
        if connected_client is not None:
            authorized = await connected_client.is_user_authorized()
        return self._status(authorized_override=authorized)

    async def disconnect(self) -> AuthStatus:
        """Disconnect and remove local session data."""

        await self._manager.reset_session()
        _clear_credentials()
        async with self._lock:
            self._pending = None
        return self._status(authorized_override=False)

    def _status(self, *, authorized_override: bool | None = None) -> AuthStatus:
        connected = self._manager.is_connected()
        has_session = self._manager.has_session()
        pending = self._pending
        verification_required = pending is not None
        password_required = bool(pending and pending.password_required)
        authorized = authorized_override
        if authorized is None:
            authorized = connected and has_session and not verification_required

        return AuthStatus(
            connected=connected,
            authorized=authorized,
            has_session=has_session,
            verification_required=verification_required,
            password_required=password_required,
        )
