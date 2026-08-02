"""Short-lived, persistence-backed Telethon client operations."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime
from typing import Any, Protocol

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import RPCError
from telethon.sessions import StringSession

from app.config import settings
from app.models import ScanJob, TelegramConnection
from app.security import SecretDecryptionError, decrypt_secret, encrypt_secret

TELEGRAM_LOGOUT_TIMEOUT_SECONDS = 10.0


class TelegramConfigurationError(RuntimeError):
    """Raised when server-owned Telegram API credentials are unavailable."""


class TelegramClientNotConnectedError(RuntimeError):
    """Raised when a user has no authorized Telegram connection."""


class TelegramMessageDeleteError(RuntimeError):
    """Raised when Telegram rejects or fails a Saved Messages deletion."""


class TelegramMessageProvenanceError(RuntimeError):
    """Raised when a cached message does not belong to the active Telegram principal."""


class TelethonSessionProtocol(Protocol):
    def save(self) -> str: ...


class TelethonClientProtocol(Protocol):
    session: TelethonSessionProtocol

    async def connect(self) -> None: ...

    async def disconnect(self) -> None: ...

    async def is_user_authorized(self) -> bool: ...

    async def send_code_request(self, phone: str) -> Any: ...

    async def sign_in(self, **kwargs: Any) -> Any: ...

    async def get_me(self) -> Any: ...

    async def delete_messages(self, entity: str, message_ids: Sequence[int] | int) -> Any: ...

    async def log_out(self) -> Any: ...


def _telegram_api_credentials() -> tuple[int, str]:
    api_id = getattr(settings, "telegram_api_id", None)
    api_hash = getattr(settings, "telegram_api_hash", None)
    if not api_id or not api_hash:
        raise TelegramConfigurationError("Server Telegram API credentials are not configured.")
    return int(api_id), str(api_hash)


@asynccontextmanager
async def short_lived_client(
    *,
    session_string: str | None,
    client_factory: type[TelegramClient] = TelegramClient,
) -> AsyncIterator[TelethonClientProtocol]:
    """Create one client from StringSession and always disconnect it."""

    api_id, api_hash = _telegram_api_credentials()
    client = client_factory(StringSession(session_string), api_id, api_hash)
    try:
        await client.connect()
        yield client
    finally:
        with suppress(Exception):
            await client.disconnect()


async def delete_saved_messages(
    *,
    user_id: str,
    telegram_user_id: int,
    connection_generation: int,
    message_ids: Sequence[int],
    session: AsyncSession,
) -> None:
    """Delete Saved Messages through only the requesting user's connection.

    The caller owns the surrounding transaction. This function flushes the
    refreshed encrypted StringSession but deliberately does not commit.
    """

    normalized_ids = tuple(dict.fromkeys(int(message_id) for message_id in message_ids))
    if not normalized_ids:
        return

    normalized_user_id = str(user_id)
    connection = await session.scalar(
        select(TelegramConnection)
        .where(
            TelegramConnection.user_id == normalized_user_id,
            TelegramConnection.telegram_user_id == int(telegram_user_id),
            TelegramConnection.generation == int(connection_generation),
        )
        .with_for_update()
    )
    if (
        connection is None
        or connection.state != "connected"
        or not connection.session_encrypted
    ):
        raise TelegramMessageProvenanceError(
            "The cached message does not belong to the active Telegram connection."
        )

    try:
        session_string = decrypt_secret(
            connection.session_encrypted,
            context=f"telegram:{normalized_user_id}:session",
        )
    except SecretDecryptionError as exc:
        await _invalidate_authorization(
            user_id=normalized_user_id,
            connection=connection,
            session=session,
        )
        raise TelegramClientNotConnectedError(
            "The saved Telegram authorization could not be opened."
        ) from exc
    try:
        async with short_lived_client(session_string=session_string) as client:
            if not await client.is_user_authorized():
                await _invalidate_authorization(
                    user_id=normalized_user_id,
                    connection=connection,
                    session=session,
                )
                raise TelegramClientNotConnectedError(
                    "Telegram is not authorized for the current user."
                )
            identity = await client.get_me()
            actual_telegram_user_id = getattr(identity, "id", None)
            if actual_telegram_user_id != int(telegram_user_id):
                await _invalidate_authorization(
                    user_id=normalized_user_id,
                    connection=connection,
                    session=session,
                )
                raise TelegramMessageProvenanceError(
                    "The active Telegram session does not match the cached message provenance."
                )
            await client.delete_messages("me", list(normalized_ids))
            connection.session_encrypted = encrypt_secret(
                client.session.save(),
                context=f"telegram:{normalized_user_id}:session",
            )
    except (TelegramClientNotConnectedError, TelegramMessageProvenanceError):
        raise
    except RPCError as exc:
        raise TelegramMessageDeleteError("Telegram rejected message deletion.") from exc
    except Exception as exc:
        raise TelegramMessageDeleteError("Failed to delete Telegram message(s).") from exc

    await session.flush()


async def _invalidate_authorization(
    *,
    user_id: str,
    connection: TelegramConnection,
    session: AsyncSession,
) -> None:
    """Invalidate a verified generation and cancel every worker bound to it."""

    connection.state = "disconnected"
    connection.telegram_user_id = None
    connection.generation += 1
    connection.phone_encrypted = None
    connection.session_encrypted = None
    connection.password_required = False
    connection.pending_phone_code_hash_encrypted = None
    connection.pending_expires_at = None
    now = datetime.now(tz=UTC)
    await session.execute(
        update(ScanJob)
        .where(
            ScanJob.user_id == user_id,
            ScanJob.state.in_(("pending", "running", "stopping")),
        )
        .values(
            state="cancelled",
            stop_requested=True,
            finished_at=now,
            lease_owner=None,
            lease_expires_at=None,
        )
    )
    # Authorization invalidation must remain visible even though the caller's
    # Telegram operation fails afterward.
    await session.commit()


async def revoke_telegram_connection(*, user_id: str, session: AsyncSession) -> None:
    """Commit local crypto-erasure before a bounded best-effort Telegram logout."""

    normalized_user_id = str(user_id)
    connection = await session.scalar(
        select(TelegramConnection)
        .where(TelegramConnection.user_id == normalized_user_id)
        .with_for_update()
    )
    now = datetime.now(tz=UTC)
    await session.execute(
        update(ScanJob)
        .where(
            ScanJob.user_id == normalized_user_id,
            ScanJob.state.in_(("pending", "running", "stopping")),
        )
        .values(
            state="cancelled",
            stop_requested=True,
            finished_at=now,
            lease_owner=None,
            lease_expires_at=None,
        )
    )
    if connection is None:
        await session.commit()
        return

    serialized: str | None = None
    if connection.session_encrypted:
        try:
            serialized = decrypt_secret(
                connection.session_encrypted,
                context=f"telegram:{normalized_user_id}:session",
            )
        except Exception:
            serialized = None

    connection.telegram_user_id = None
    connection.phone_encrypted = None
    connection.session_encrypted = None
    connection.pending_phone_code_hash_encrypted = None
    connection.pending_expires_at = None
    connection.password_required = False
    connection.state = "disconnected"
    connection.generation += 1
    # A Telegram outage or process exit must never retain locally usable
    # authorization material. Account deletion continues in a second transaction.
    await session.commit()

    if serialized is None:
        return
    try:
        async with asyncio.timeout(TELEGRAM_LOGOUT_TIMEOUT_SECONDS):
            async with short_lived_client(session_string=serialized) as client:
                if await client.is_user_authorized():
                    await client.log_out()
    except Exception:
        # Remote cleanup is best effort after irreversible local crypto-erasure.
        pass
