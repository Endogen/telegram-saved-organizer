"""Database-backed abuse throttles shared by every API process."""

from __future__ import annotations

import hashlib
import hmac
import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Iterable

from fastapi import HTTPException, Request, status
from sqlalchemy import case, delete, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AbuseRateLimitBucket, TelegramConnection
from app.security import decrypt_secret


@dataclass(frozen=True, slots=True)
class RateLimitRule:
    """Maximum number of attempts allowed in one fixed window."""

    scope: str
    limit: int
    window: timedelta

    def __post_init__(self) -> None:
        if not self.scope or len(self.scope) > 48:
            raise ValueError("Rate-limit scope must contain 1 to 48 characters.")
        if self.limit <= 0:
            raise ValueError("Rate-limit quota must be positive.")
        if self.window < timedelta(seconds=1):
            raise ValueError("Rate-limit window must be at least one second.")
        if self.window != timedelta(seconds=int(self.window.total_seconds())):
            raise ValueError(
                "Rate-limit window must contain a whole number of seconds."
            )


@dataclass(frozen=True, slots=True)
class RateLimitCheck:
    rule: RateLimitRule
    subject: str


class RateLimitExceeded(RuntimeError):
    """Raised after all applicable counters are durably consumed."""

    def __init__(self, *, retry_after: int) -> None:
        super().__init__("Request quota exceeded.")
        self.retry_after = max(1, retry_after)


LOGIN_PER_IP = RateLimitRule("login_ip", 50, timedelta(minutes=15))
LOGIN_PER_IDENTITY = RateLimitRule("login_identity", 20, timedelta(minutes=15))
REGISTRATION_PER_IP = RateLimitRule("registration_ip", 5, timedelta(hours=1))
SENSITIVE_PASSWORD_PER_IP = RateLimitRule(
    "sensitive_password_ip", 30, timedelta(minutes=15)
)
SENSITIVE_PASSWORD_PER_USER = RateLimitRule(
    "sensitive_password_user", 10, timedelta(minutes=15)
)
TELEGRAM_SEND_PER_IP = RateLimitRule("telegram_send_ip", 10, timedelta(hours=1))
TELEGRAM_SEND_PER_PHONE = RateLimitRule("telegram_send_phone", 5, timedelta(hours=1))
TELEGRAM_VERIFY_PER_IP = RateLimitRule("telegram_verify_ip", 30, timedelta(minutes=15))
TELEGRAM_VERIFY_PER_PHONE = RateLimitRule(
    "telegram_verify_phone", 10, timedelta(minutes=15)
)


def client_ip_subject(request: Request) -> str:
    """Return the peer address resolved by Uvicorn's trusted-proxy handling."""

    if request.client is None or not request.client.host:
        return "unavailable"
    return request.client.host


def phone_subject(value: str) -> str:
    """Collapse common display variants of a phone number into one quota key."""

    stripped = value.strip()
    digits = "".join(
        character
        for character in stripped
        if character.isascii() and character.isdigit()
    )
    if stripped.startswith("+"):
        return f"+{digits}"
    if digits.startswith("00"):
        return f"+{digits[2:]}"
    return digits or stripped.casefold()


async def telegram_phone_subject(session: AsyncSession, *, user_id: str) -> str:
    """Resolve the encrypted pending phone for a verification quota."""

    encrypted_phone = await session.scalar(
        select(TelegramConnection.phone_encrypted).where(
            TelegramConnection.user_id == str(user_id)
        )
    )
    if not encrypted_phone:
        # There is no phone to verify. Keep the fallback tenant-specific while
        # the broad IP rule still bounds rotating application accounts.
        return f"unavailable:{user_id}"
    phone = decrypt_secret(
        encrypted_phone,
        context=f"telegram:{user_id}:phone",
    )
    return phone_subject(phone)


class DatabaseRateLimiter:
    """Atomically consume fixed-window counters on SQLite or PostgreSQL."""

    def __init__(self, *, session: AsyncSession, secret: str | None = None) -> None:
        self._session = session
        self._secret = (secret or settings.master_key).encode("utf-8")

    async def consume(
        self,
        checks: Iterable[RateLimitCheck],
        *,
        now: datetime | None = None,
    ) -> None:
        checked_at = self._as_utc(now or datetime.now(tz=UTC))
        unique_checks = self._unique_checks(checks)
        if not unique_checks:
            return

        retry_after = 0
        try:
            # An indexed prune on each limited request gives deterministic
            # retention without an in-process scheduler or unbounded counters.
            await self._session.execute(
                delete(AbuseRateLimitBucket)
                .where(AbuseRateLimitBucket.expires_at <= checked_at)
                .execution_options(synchronize_session=False)
            )
            for check in unique_checks:
                window_start, window_end = self._window_bounds(checked_at, check.rule)
                count = await self._increment(
                    rule=check.rule,
                    subject_hash=self._subject_hash(check),
                    window_start=window_start,
                    window_end=window_end,
                )
                if count > check.rule.limit:
                    retry_after = math.ceil((window_end - checked_at).total_seconds())
                    # Callers order broad IP checks before narrow identity
                    # checks. Once the IP is blocked, do not let rotating
                    # identities create an unbounded number of bucket rows.
                    break
            # Counters for rejected attempts are intentionally committed too.
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise

        if retry_after:
            raise RateLimitExceeded(retry_after=retry_after)

    async def prune(self, *, now: datetime | None = None) -> int:
        """Remove expired buckets and return the affected row count."""

        checked_at = self._as_utc(now or datetime.now(tz=UTC))
        try:
            result = await self._session.execute(
                delete(AbuseRateLimitBucket)
                .where(AbuseRateLimitBucket.expires_at <= checked_at)
                .execution_options(synchronize_session=False)
            )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise
        return int(result.rowcount or 0)

    async def _increment(
        self,
        *,
        rule: RateLimitRule,
        subject_hash: str,
        window_start: datetime,
        window_end: datetime,
    ) -> int:
        values = {
            "scope": rule.scope,
            "subject_hash": subject_hash,
            "window_started_at": window_start,
            "hit_count": 1,
            "expires_at": window_end,
        }
        capped_increment = case(
            (
                AbuseRateLimitBucket.hit_count <= rule.limit,
                AbuseRateLimitBucket.hit_count + 1,
            ),
            else_=AbuseRateLimitBucket.hit_count,
        )
        dialect_name = self._session.get_bind().dialect.name
        if dialect_name == "sqlite":
            statement = sqlite_insert(AbuseRateLimitBucket).values(**values)
        elif dialect_name == "postgresql":
            statement = postgresql_insert(AbuseRateLimitBucket).values(**values)
        else:
            raise RuntimeError(
                f"Database-backed rate limits do not support the {dialect_name!r} dialect."
            )
        statement = statement.on_conflict_do_update(
            index_elements=[
                AbuseRateLimitBucket.scope,
                AbuseRateLimitBucket.subject_hash,
                AbuseRateLimitBucket.window_started_at,
            ],
            set_={
                "hit_count": capped_increment,
                "expires_at": window_end,
            },
        ).returning(AbuseRateLimitBucket.hit_count)
        count = await self._session.scalar(statement)
        if count is None:
            raise RuntimeError("Rate-limit counter did not return its new value.")
        return int(count)

    def _subject_hash(self, check: RateLimitCheck) -> str:
        message = f"tso-abuse-v1\0{check.rule.scope}\0{check.subject}".encode("utf-8")
        return hmac.new(self._secret, message, hashlib.sha256).hexdigest()

    @staticmethod
    def _unique_checks(checks: Iterable[RateLimitCheck]) -> list[RateLimitCheck]:
        unique: dict[tuple[str, str], RateLimitCheck] = {}
        for check in checks:
            if not check.subject:
                raise ValueError("Rate-limit subjects must not be empty.")
            identity = (check.rule.scope, check.subject)
            existing = unique.setdefault(identity, check)
            if existing.rule != check.rule:
                raise ValueError(
                    "One rate-limit scope and subject cannot use different rules."
                )
        return list(unique.values())

    @staticmethod
    def _window_bounds(now: datetime, rule: RateLimitRule) -> tuple[datetime, datetime]:
        window_seconds = int(rule.window.total_seconds())
        start_epoch = int(now.timestamp()) // window_seconds * window_seconds
        start = datetime.fromtimestamp(start_epoch, tz=UTC)
        return start, start + rule.window

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


async def enforce_rate_limits(
    session: AsyncSession,
    checks: Iterable[RateLimitCheck],
) -> None:
    """Translate an internal quota rejection into one non-enumerating API response."""

    try:
        await DatabaseRateLimiter(session=session).consume(checks)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="too_many_requests",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
