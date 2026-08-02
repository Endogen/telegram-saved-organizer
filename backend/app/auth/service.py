"""Per-user, persistence-backed Telegram authentication workflow."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import SessionPasswordNeededError

from app.auth.schemas import (
    TelegramAccountSummary,
    TelegramConnectionResponse,
    TelegramConnectionState,
)
from app.identifiers import normalize_phone_number
from app.models import Message, ScanJob, TelegramConnection
from app.security import SecretDecryptionError, decrypt_secret, encrypt_secret
from app.telegram.client import revoke_telegram_connection, short_lived_client

CHALLENGE_TTL = timedelta(minutes=10)


class TelegramConnectionNotFoundError(RuntimeError):
    """Raised when verification is requested without an active challenge."""


class TelegramChallengeExpiredError(RuntimeError):
    """Raised when a Telegram verification challenge has expired."""


class TelegramVerificationError(RuntimeError):
    """Raised when Telegram did not authorize a completed challenge."""


class TelegramIdentityConflictError(RuntimeError):
    """Raised when a Telegram principal is already bound to another account."""


class TelegramPhoneMismatchError(RuntimeError):
    """Raised when a still-authorized session is reused for a different phone."""


class TelegramAuthService:
    """Coordinates one user's Telegram connection using only persisted state."""

    def __init__(self, *, session: AsyncSession, user_id: str) -> None:
        self._session = session
        self._user_id = str(user_id)

    async def status(self) -> TelegramConnectionState:
        connection = await self._load_connection()
        if connection is None or not connection.session_encrypted:
            return TelegramConnectionState.DISCONNECTED
        if connection.state == "pending" and self._challenge_expired(
            connection.pending_expires_at
        ):
            self._erase_expired_challenge(connection)
            await self._session.commit()
            return TelegramConnectionState.DISCONNECTED
        try:
            self._decrypt_required(connection.session_encrypted, purpose="session")
        except SecretDecryptionError:
            await self._invalidate_corrupt_connection(connection)
            return TelegramConnectionState.DISCONNECTED
        return self._response_state(connection)

    async def start(self, *, phone: str) -> TelegramConnectionState:
        normalized_phone = normalize_phone_number(phone)
        connection = await self._load_connection(for_update=True)
        if connection is None:
            connection = TelegramConnection(
                user_id=self._user_id,
                state=TelegramConnectionState.DISCONNECTED.value,
            )
            self._session.add(connection)
            await self._session.flush()

        try:
            session_string = self._decrypt_optional(
                connection.session_encrypted,
                purpose="session",
            )
        except SecretDecryptionError:
            await self._invalidate_corrupt_connection(connection)
            session_string = None
        async with short_lived_client(session_string=session_string) as client:
            if await client.is_user_authorized():
                try:
                    existing_phone = self._decrypt_optional(
                        connection.phone_encrypted, purpose="phone"
                    )
                except SecretDecryptionError:
                    existing_phone = None
                if (
                    existing_phone is not None
                    and normalize_phone_number(existing_phone) != normalized_phone
                ):
                    raise TelegramPhoneMismatchError(
                        "Disconnect the current Telegram account before "
                        "connecting a different phone number."
                    )
                await self._bind_authorized_principal(
                    connection=connection, client=client
                )
                self._clear_challenge(connection)
                connection.state = "connected"
                self._persist_client_session(connection=connection, client=client)
                await self._commit_connection()
                return TelegramConnectionState.CONNECTED

            sent_code = await client.send_code_request(normalized_phone)
            phone_code_hash = getattr(sent_code, "phone_code_hash", None)
            if not phone_code_hash:
                raise TelegramVerificationError(
                    "Telegram did not return a verification challenge."
                )
            connection.phone_encrypted = encrypt_secret(
                normalized_phone,
                context=self._secret_context("phone"),
            )
            connection.pending_phone_code_hash_encrypted = encrypt_secret(
                str(phone_code_hash),
                context=self._secret_context("phone_code_hash"),
            )
            connection.pending_expires_at = datetime.now(tz=UTC) + CHALLENGE_TTL
            connection.password_required = False
            connection.state = "pending"
            await self._cancel_active_scans()
            connection.telegram_user_id = None
            connection.generation = int(connection.generation or 0) + 1
            self._persist_client_session(connection=connection, client=client)

        await self._commit_connection()
        return TelegramConnectionState.CODE_REQUIRED

    async def verify(
        self, *, code: str | None, password: str | None
    ) -> TelegramConnectionState:
        connection = await self._load_connection(for_update=True)
        if connection is None or not connection.session_encrypted:
            raise TelegramConnectionNotFoundError(
                "Telegram verification has not been started."
            )

        # Verification requests can be retried by browsers and reverse proxies.
        # Once the connection is complete, treat a duplicate request as an
        # idempotent success instead of interpreting the cleared challenge as
        # expired and crypto-erasing a valid Telegram session.
        if connection.state == "connected":
            return TelegramConnectionState.CONNECTED
        if connection.state != "pending":
            raise TelegramConnectionNotFoundError(
                "Telegram verification has not been started."
            )

        if self._challenge_expired(connection.pending_expires_at):
            self._erase_expired_challenge(connection)
            await self._session.commit()
            raise TelegramChallengeExpiredError(
                "Telegram verification challenge expired."
            )

        try:
            phone = self._decrypt_required(connection.phone_encrypted, purpose="phone")
            phone_code_hash = self._decrypt_required(
                connection.pending_phone_code_hash_encrypted,
                purpose="phone_code_hash",
            )
            session_string = self._decrypt_required(
                connection.session_encrypted,
                purpose="session",
            )
        except SecretDecryptionError as exc:
            await self._invalidate_corrupt_connection(connection)
            raise TelegramVerificationError(
                "The saved Telegram verification state could not be opened."
            ) from exc

        async with short_lived_client(session_string=session_string) as client:
            try:
                if password is not None:
                    await client.sign_in(password=password)
                else:
                    await client.sign_in(
                        phone=phone,
                        code=code,
                        phone_code_hash=phone_code_hash,
                    )
            except SessionPasswordNeededError:
                connection.state = "pending"
                connection.password_required = True
                self._persist_client_session(connection=connection, client=client)
                await self._session.commit()
                return TelegramConnectionState.PASSWORD_REQUIRED

            authorized = await client.is_user_authorized()
            if authorized:
                await self._bind_authorized_principal(
                    connection=connection, client=client
                )
            self._persist_client_session(connection=connection, client=client)

        if not authorized:
            await self._session.commit()
            raise TelegramVerificationError(
                "Telegram did not authorize this connection."
            )

        self._clear_challenge(connection)
        connection.state = "connected"
        await self._commit_connection()
        return TelegramConnectionState.CONNECTED

    async def disconnect(self) -> TelegramConnectionState:
        await revoke_telegram_connection(user_id=self._user_id, session=self._session)
        await self._session.commit()
        return TelegramConnectionState.DISCONNECTED

    async def response(
        self,
        *,
        state: TelegramConnectionState,
    ) -> TelegramConnectionResponse:
        """Build a UI-safe response without exposing persisted phone plaintext."""

        if state is TelegramConnectionState.DISCONNECTED:
            return TelegramConnectionResponse(state=state)

        connection = await self._load_connection()
        phone_masked: str | None = None
        if connection is not None:
            try:
                phone = self._decrypt_optional(
                    connection.phone_encrypted,
                    purpose="phone",
                )
            except SecretDecryptionError:
                phone = None
            if phone is not None:
                phone_masked = self._mask_phone(phone)

        if state is TelegramConnectionState.CONNECTED:
            account = (
                TelegramAccountSummary(phone_masked=phone_masked)
                if phone_masked is not None
                else None
            )
            return TelegramConnectionResponse(state=state, account=account)

        return TelegramConnectionResponse(state=state, phone_masked=phone_masked)

    async def _load_connection(
        self, *, for_update: bool = False
    ) -> TelegramConnection | None:
        statement = select(TelegramConnection).where(
            TelegramConnection.user_id == self._user_id
        )
        if for_update:
            statement = statement.with_for_update()
        return await self._session.scalar(statement)

    def _persist_client_session(
        self, *, connection: TelegramConnection, client: Any
    ) -> None:
        serialized = client.session.save()
        connection.session_encrypted = encrypt_secret(
            serialized,
            context=self._secret_context("session"),
        )

    async def _bind_authorized_principal(
        self,
        *,
        connection: TelegramConnection,
        client: Any,
    ) -> None:
        identity = await client.get_me()
        telegram_user_id = getattr(identity, "id", None)
        if isinstance(telegram_user_id, bool) or not isinstance(telegram_user_id, int):
            raise TelegramVerificationError(
                "Telegram did not return an account identity."
            )
        conflict = await self._session.scalar(
            select(TelegramConnection.id).where(
                TelegramConnection.telegram_user_id == telegram_user_id,
                TelegramConnection.user_id != self._user_id,
            )
        )
        if conflict is not None:
            try:
                await client.log_out()
            except Exception:
                pass
            raise TelegramIdentityConflictError(
                "This Telegram account is already connected to another application account."
            )
        if connection.telegram_user_id != telegram_user_id and (
            connection.telegram_user_id is not None or connection.state != "pending"
        ):
            await self._cancel_active_scans()
            connection.generation = int(connection.generation or 0) + 1
        connection.telegram_user_id = telegram_user_id

    async def _cancel_active_scans(self) -> None:
        active_job_ids = select(ScanJob.id).where(
            ScanJob.user_id == self._user_id,
            ScanJob.state.in_(("pending", "running", "stopping")),
        )
        await self._session.execute(
            update(Message)
            .where(
                Message.user_id == self._user_id,
                Message.last_seen_replacement_job_id.in_(active_job_ids),
            )
            .values(last_seen_replacement_job_id=None)
        )
        await self._session.execute(
            update(ScanJob)
            .where(
                ScanJob.user_id == self._user_id,
                ScanJob.state.in_(("pending", "running", "stopping")),
            )
            .values(
                state="cancelled",
                stop_requested=True,
                finished_at=datetime.now(tz=UTC),
                lease_owner=None,
                lease_expires_at=None,
            )
        )

    async def _commit_connection(self) -> None:
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise TelegramIdentityConflictError(
                "This Telegram account is already connected to another application account."
            ) from exc

    async def _invalidate_corrupt_connection(
        self,
        connection: TelegramConnection,
    ) -> None:
        """Invalidate a generation and crypto-erase unauthenticated ciphertext."""

        await self._cancel_active_scans()
        connection.telegram_user_id = None
        connection.phone_encrypted = None
        connection.session_encrypted = None
        self._clear_challenge(connection)
        connection.state = "error"
        connection.generation = int(connection.generation or 0) + 1
        await self._session.commit()

    def _decrypt_optional(self, value: str | None, *, purpose: str) -> str | None:
        if not value:
            return None
        return decrypt_secret(value, context=self._secret_context(purpose))

    def _decrypt_required(self, value: str | None, *, purpose: str) -> str:
        if not value:
            raise TelegramConnectionNotFoundError(
                "Telegram verification challenge is incomplete."
            )
        return decrypt_secret(value, context=self._secret_context(purpose))

    def _secret_context(self, purpose: str) -> str:
        return f"telegram:{self._user_id}:{purpose}"

    @staticmethod
    def _mask_phone(phone: str) -> str:
        digits = "".join(character for character in phone if character in "0123456789")
        if len(digits) <= 4:
            return "••••"
        return f"••• ••• {digits[-4:]}"

    @staticmethod
    def _challenge_expired(expires_at: datetime | None) -> bool:
        if expires_at is None:
            return True
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        return expires_at <= datetime.now(tz=UTC)

    @staticmethod
    def _response_state(connection: TelegramConnection) -> TelegramConnectionState:
        if connection.state == "connected":
            return TelegramConnectionState.CONNECTED
        if connection.state == "pending":
            if connection.password_required:
                return TelegramConnectionState.PASSWORD_REQUIRED
            return TelegramConnectionState.CODE_REQUIRED
        return TelegramConnectionState.DISCONNECTED

    @staticmethod
    def _clear_challenge(connection: TelegramConnection) -> None:
        connection.pending_phone_code_hash_encrypted = None
        connection.pending_expires_at = None
        connection.password_required = False

    @classmethod
    def _erase_expired_challenge(cls, connection: TelegramConnection) -> None:
        """Crypto-erase stale unauthorized session and phone material."""

        cls._clear_challenge(connection)
        connection.phone_encrypted = None
        connection.session_encrypted = None
        connection.telegram_user_id = None
        connection.state = "disconnected"
