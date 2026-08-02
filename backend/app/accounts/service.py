"""Account lifecycle and revocable opaque-session service."""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.default_categories import seed_default_categories
from app.models import User, WebSession
from app.security import (
    hash_password,
    hash_token,
    password_needs_rehash,
    random_token,
    verify_password,
)

LOGIN_LOCK_THRESHOLD = 5
LOGIN_LOCK_MAX_SECONDS = 15 * 60
SESSION_TOUCH_INTERVAL = timedelta(minutes=5)
SESSION_HISTORY_RETENTION = timedelta(days=90)


class AccountConflictError(RuntimeError):
    """Raised when normalized account identity is already registered."""


class RegistrationDisabledError(RuntimeError):
    """Raised when public account creation is disabled."""


class AuthenticationFailedError(RuntimeError):
    """Generic authentication failure which does not reveal account existence."""


class SessionNotFoundError(RuntimeError):
    """Raised when a session is absent, expired, revoked, or otherwise invalid."""


class AccountNotFoundError(RuntimeError):
    """Raised when a tenant-owned account resource cannot be found."""


@dataclass(slots=True, frozen=True)
class SessionCredentials:
    token: str
    csrf_token: str
    record: WebSession


@dataclass(slots=True, frozen=True)
class AuthContext:
    user: User
    web_session: WebSession
    source: Literal["cookie", "bearer"]


def utc_now() -> datetime:
    return datetime.now(tz=UTC)


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def normalize_email(value: str) -> str:
    return value.strip().casefold()


class AccountService:
    def __init__(self, *, session: AsyncSession) -> None:
        self.session = session

    async def register(self, *, email: str, display_name: str, password: str) -> User:
        if not settings.allow_registration:
            raise RegistrationDisabledError("Public registration is disabled.")
        normalized_email = normalize_email(email)
        password_hash = await hash_password(password)
        user = User(
            email=normalized_email,
            normalized_email=normalized_email,
            display_name=display_name.strip(),
            password_hash=password_hash,
        )
        self.session.add(user)
        try:
            await self.session.flush()
            await seed_default_categories(self.session, user_id=user.id)
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise AccountConflictError("An account with this email already exists.") from exc
        await self.session.refresh(user)
        return user

    async def login(
        self,
        *,
        email: str,
        password: str,
        user_agent: str | None,
        ip_address: str | None,
    ) -> tuple[User, SessionCredentials]:
        normalized_email = normalize_email(email)
        user = await self.session.scalar(
            select(User).where(User.normalized_email == normalized_email).with_for_update()
        )
        password_valid = await verify_password(user.password_hash if user else None, password)
        now = utc_now()
        if (
            user is not None
            and user.locked_until is not None
            and as_utc(user.locked_until) <= now
        ):
            # A completed lockout is a fresh attempt window. Otherwise one bad
            # request immediately re-applies the maximum delay forever.
            user.failed_login_attempts = 0
            user.locked_until = None
        is_locked = bool(user and user.locked_until and as_utc(user.locked_until) > now)
        if user is None or not user.is_active or is_locked or not password_valid:
            if user is not None and user.is_active and not is_locked:
                user.failed_login_attempts += 1
                if user.failed_login_attempts >= LOGIN_LOCK_THRESHOLD:
                    exponent = min(user.failed_login_attempts - LOGIN_LOCK_THRESHOLD, 5)
                    delay = min(30 * (2**exponent), LOGIN_LOCK_MAX_SECONDS)
                    user.locked_until = now + timedelta(seconds=delay)
                await self.session.commit()
            raise AuthenticationFailedError("Invalid email or password.")

        user.failed_login_attempts = 0
        user.locked_until = None
        if password_needs_rehash(user.password_hash):
            user.password_hash = await hash_password(password)
        await self._prepare_for_new_session(user_id=user.id, now=now)
        credentials = self._new_session(
            user=user,
            user_agent=user_agent,
            ip_address=ip_address,
            now=now,
        )
        await self.session.commit()
        return user, credentials

    def _new_session(
        self,
        *,
        user: User,
        user_agent: str | None,
        ip_address: str | None,
        now: datetime | None = None,
    ) -> SessionCredentials:
        issued_at = now or utc_now()
        token = random_token()
        csrf_token = random_token()
        record = WebSession(
            user_id=user.id,
            token_hash=hash_token(token),
            csrf_token_hash=hash_token(csrf_token),
            user_agent=(user_agent or "")[:512] or None,
            ip_address=(ip_address or "")[:64] or None,
            rotated_at=issued_at,
            last_seen_at=issued_at,
            idle_expires_at=issued_at + timedelta(seconds=settings.session_idle_seconds),
            expires_at=issued_at + timedelta(seconds=settings.session_absolute_seconds),
        )
        self.session.add(record)
        return SessionCredentials(token=token, csrf_token=csrf_token, record=record)

    async def _prepare_for_new_session(self, *, user_id: str, now: datetime) -> None:
        """Bound active sessions and prune expired audit rows before issuing one."""

        active_records = list(
            await self.session.scalars(
                select(WebSession)
                .where(
                    WebSession.user_id == user_id,
                    WebSession.revoked_at.is_(None),
                    WebSession.expires_at > now,
                    WebSession.idle_expires_at > now,
                )
                .order_by(WebSession.last_seen_at.desc(), WebSession.created_at.desc())
            )
        )
        # Reserve one slot for the session created immediately after this call.
        keep_count = max(settings.max_active_sessions - 1, 0)
        for record in active_records[keep_count:]:
            record.revoked_at = now

        history_cutoff = now - SESSION_HISTORY_RETENTION
        await self.session.execute(
            delete(WebSession).where(
                WebSession.user_id == user_id,
                or_(
                    WebSession.revoked_at < history_cutoff,
                    WebSession.expires_at < history_cutoff,
                ),
            ).execution_options(synchronize_session=False)
        )

    async def resolve_session(self, *, token: str, source: Literal["cookie", "bearer"]) -> AuthContext:
        now = utc_now()
        record = await self.session.scalar(
            select(WebSession)
            .options(selectinload(WebSession.user))
            .where(WebSession.token_hash == hash_token(token))
        )
        if record is None:
            raise SessionNotFoundError("Authentication required.")
        expired = as_utc(record.expires_at) <= now or as_utc(record.idle_expires_at) <= now
        if record.revoked_at is not None or expired or not record.user.is_active:
            if record.revoked_at is None:
                record.revoked_at = now
                await self.session.commit()
            raise SessionNotFoundError("Authentication required.")
        if now - as_utc(record.last_seen_at) >= SESSION_TOUCH_INTERVAL:
            record.last_seen_at = now
            record.idle_expires_at = min(
                now + timedelta(seconds=settings.session_idle_seconds),
                as_utc(record.expires_at),
            )
            await self.session.commit()
        return AuthContext(user=record.user, web_session=record, source=source)

    async def revoke_session(self, *, user_id: str, session_id: str) -> bool:
        record = await self.session.scalar(
            select(WebSession).where(
                WebSession.user_id == user_id,
                WebSession.id == session_id,
                WebSession.revoked_at.is_(None),
            )
        )
        if record is None:
            raise AccountNotFoundError("Session was not found.")
        record.revoked_at = utc_now()
        await self.session.commit()
        return True

    async def logout(self, *, record: WebSession) -> None:
        if record.revoked_at is None:
            record.revoked_at = utc_now()
            await self.session.commit()

    async def list_sessions(self, *, user_id: str) -> list[WebSession]:
        now = utc_now()
        rows = await self.session.scalars(
            select(WebSession)
            .where(
                WebSession.user_id == user_id,
                WebSession.revoked_at.is_(None),
                WebSession.expires_at > now,
                WebSession.idle_expires_at > now,
            )
            .order_by(WebSession.last_seen_at.desc())
            .limit(settings.max_active_sessions)
        )
        return list(rows)

    async def update_account(
        self,
        *,
        user: User,
        display_name: str | None,
    ) -> User:
        if display_name is not None:
            user.display_name = display_name.strip()
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def change_password(
        self,
        *,
        user: User,
        current_password: str,
        new_password: str,
        user_agent: str | None,
        ip_address: str | None,
    ) -> SessionCredentials:
        if not await verify_password(user.password_hash, current_password):
            raise AuthenticationFailedError("Current password is not valid.")
        user.password_hash = await hash_password(new_password)
        now = utc_now()
        # Preserve the session audit trail while invalidating every previously
        # issued credential before rotating the current browser to a new one.
        await self.session.execute(
            update(WebSession)
            .where(WebSession.user_id == user.id, WebSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        credentials = self._new_session(
            user=user,
            user_agent=user_agent,
            ip_address=ip_address,
            now=now,
        )
        await self.session.commit()
        return credentials

    async def delete_account(self, *, user: User, password: str) -> None:
        if not await verify_password(user.password_hash, password):
            raise AuthenticationFailedError("Password is not valid.")
        from app.telegram.client import revoke_telegram_connection

        await revoke_telegram_connection(user_id=user.id, session=self.session)
        await self.session.delete(user)
        await self.session.commit()


def csrf_matches(context: AuthContext, *, cookie_token: str | None, header_token: str | None) -> bool:
    if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
        return False
    return hmac.compare_digest(hash_token(header_token), context.web_session.csrf_token_hash)
