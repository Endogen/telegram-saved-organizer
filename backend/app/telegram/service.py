"""Durable, leased, per-user Telegram scan lifecycle."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TypeVar
from uuid import uuid4

from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import SessionLocal
from app.models import Category, Message, MessageTag, ScanJob, TelegramConnection, User
from app.security import SecretDecryptionError, decrypt_secret, encrypt_secret
from app.telegram.categorizer import categorize_scanned_message
from app.telegram.client import TelegramClientNotConnectedError, short_lived_client
from app.telegram.scanner import (
    MESSAGE_LIMIT_REACHED,
    RUNTIME_LIMIT_REACHED,
    SLICE_PAGE_LIMIT,
    SLICE_TIME_LIMIT,
    SOURCE_EXHAUSTED,
    STOPPED_BY_USER,
    ScanAlreadyRunningError,
    ScanPage,
    ScanProgress,
    SavedMessagesScanner,
)
from app.telegram.schemas import SCAN_FAILURE_MESSAGE

logger = logging.getLogger(__name__)

ACTIVE_SCAN_STATES = ("pending", "running", "stopping")
TERMINAL_SCAN_STATES = ("completed", "failed", "cancelled")
SCAN_LEASE_SECONDS = 90
SCAN_HEARTBEAT_SECONDS = 20
SCAN_CLAIM_RETRY_LIMIT = 3

_ResultT = TypeVar("_ResultT")


class ScanPersistenceError(RuntimeError):
    """Raised when a page cannot be persisted for its owning user."""


class ScanLeaseLostError(RuntimeError):
    """Raised when a worker no longer owns the durable scan lease."""


@dataclass(frozen=True, slots=True)
class ScanLease:
    job_id: str
    user_id: str
    page_size: int
    telegram_user_id: int
    connection_generation: int
    messages_scanned: int
    last_message_id: int | None
    max_messages: int
    max_runtime_seconds: int
    started_at: datetime
    owner: str
    replace_existing: bool = False


class TelegramScanService:
    """Creates and reads durable scan jobs for one authenticated user."""

    def __init__(self, *, session: AsyncSession, user_id: str) -> None:
        self._session = session
        self._user_id = str(user_id)

    async def start(
        self, *, page_size: int = 100, clear_existing: bool = False
    ) -> ScanJob:
        if page_size <= 0:
            raise ValueError("page_size must be a positive integer.")

        await self._session.scalar(
            select(User).where(User.id == self._user_id).with_for_update()
        )
        active_job = await self._session.scalar(
            select(ScanJob)
            .where(
                ScanJob.user_id == self._user_id,
                ScanJob.state.in_(ACTIVE_SCAN_STATES),
            )
            .order_by(ScanJob.created_at.desc())
        )
        if active_job is not None:
            now = _utcnow()
            if active_job.state == "pending" or (
                active_job.state == "running" and _lease_is_expired(active_job, now=now)
            ):
                if bool(getattr(active_job, "replace_existing", False)) != bool(
                    clear_existing
                ):
                    raise ScanAlreadyRunningError(
                        "An active scan has a different replacement mode."
                    )
                # Re-scheduling is safe: every processor still has to win the
                # fenced atomic claim below.
                return active_job
            if active_job.state == "stopping" and _lease_is_expired(
                active_job, now=now
            ):
                active_job.state = "cancelled"
                active_job.completion_reason = STOPPED_BY_USER
                active_job.finished_at = now
                _clear_lease(active_job)
                if bool(getattr(active_job, "replace_existing", False)):
                    await self._session.execute(
                        update(Message)
                        .where(
                            Message.user_id == self._user_id,
                            Message.last_seen_replacement_job_id == active_job.id,
                        )
                        .values(last_seen_replacement_job_id=None)
                    )
                await self._session.commit()
            else:
                raise ScanAlreadyRunningError("A scan is already active for this user.")

        connection = await self._validate_authorized_connection()
        if connection.telegram_user_id is None:
            raise TelegramClientNotConnectedError(
                "Telegram identity is unavailable for this connection."
            )
        if clear_existing:
            # A terminal job should never leave a marker behind, but clearing
            # stale markers here makes replacement scans self-healing after an
            # abrupt process or authorization interruption.
            await self._session.execute(
                update(Message)
                .where(Message.user_id == self._user_id)
                .values(last_seen_replacement_job_id=None)
            )
        job = ScanJob(
            user_id=self._user_id,
            state="pending",
            replace_existing=clear_existing,
            page_size=page_size,
            telegram_user_id=connection.telegram_user_id,
            connection_generation=connection.generation,
            max_messages=settings.scan_max_messages,
            max_runtime_seconds=settings.scan_max_runtime_seconds,
        )
        self._session.add(job)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ScanAlreadyRunningError(
                "A scan is already active for this user."
            ) from exc
        await self._session.refresh(job)
        return job

    async def status(self) -> ScanJob | None:
        return await self._session.scalar(
            select(ScanJob)
            .where(ScanJob.user_id == self._user_id)
            .order_by(ScanJob.created_at.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )

    async def stop(self) -> ScanJob | None:
        job = await self._session.scalar(
            select(ScanJob)
            .where(
                ScanJob.user_id == self._user_id,
                ScanJob.state.in_(ACTIVE_SCAN_STATES),
            )
            .order_by(ScanJob.created_at.desc())
            .with_for_update()
        )
        if job is None:
            return await self.status()

        now = _utcnow()
        job.stop_requested = True
        if job.state == "pending" or _lease_is_expired(job, now=now):
            job.state = "cancelled"
            job.completion_reason = STOPPED_BY_USER
            job.finished_at = now
            _clear_lease(job)
            if bool(getattr(job, "replace_existing", False)):
                await self._session.execute(
                    update(Message)
                    .where(
                        Message.user_id == self._user_id,
                        Message.last_seen_replacement_job_id == job.id,
                    )
                    .values(last_seen_replacement_job_id=None)
                )
        else:
            job.state = "stopping"
        await self._session.commit()
        await self._session.refresh(job)
        return job

    async def _validate_authorized_connection(self) -> TelegramConnection:
        connection = await self._session.scalar(
            select(TelegramConnection)
            .where(TelegramConnection.user_id == self._user_id)
            .with_for_update()
        )
        if (
            connection is None
            or connection.state != "connected"
            or not connection.session_encrypted
        ):
            raise TelegramClientNotConnectedError("Connect Telegram before scanning.")

        try:
            session_string = decrypt_secret(
                connection.session_encrypted,
                context=f"telegram:{self._user_id}:session",
            )
        except SecretDecryptionError as exc:
            connection.state = "error"
            connection.telegram_user_id = None
            connection.generation += 1
            connection.phone_encrypted = None
            connection.session_encrypted = None
            connection.password_required = False
            connection.pending_phone_code_hash_encrypted = None
            connection.pending_expires_at = None
            await self._session.commit()
            raise TelegramClientNotConnectedError(
                "The saved Telegram authorization could not be opened."
            ) from exc
        async with short_lived_client(session_string=session_string) as client:
            authorized = await client.is_user_authorized()
            identity = await client.get_me() if authorized else None
            connection.session_encrypted = encrypt_secret(
                client.session.save(),
                context=f"telegram:{self._user_id}:session",
            )
        if not authorized:
            connection.state = "disconnected"
            connection.telegram_user_id = None
            connection.generation += 1
            connection.phone_encrypted = None
            connection.session_encrypted = None
            connection.password_required = False
            connection.pending_phone_code_hash_encrypted = None
            connection.pending_expires_at = None
            await self._session.commit()
            raise TelegramClientNotConnectedError(
                "Telegram authorization is no longer valid."
            )
        actual_telegram_user_id = getattr(identity, "id", None)
        if isinstance(actual_telegram_user_id, bool) or not isinstance(
            actual_telegram_user_id, int
        ):
            connection.state = "error"
            connection.telegram_user_id = None
            connection.generation += 1
            connection.phone_encrypted = None
            connection.session_encrypted = None
            await self._session.commit()
            raise TelegramClientNotConnectedError(
                "Telegram identity could not be verified."
            )
        if connection.telegram_user_id is None:
            connection.telegram_user_id = actual_telegram_user_id
            connection.generation += 1
        elif connection.telegram_user_id != actual_telegram_user_id:
            connection.telegram_user_id = None
            connection.state = "error"
            connection.generation += 1
            connection.phone_encrypted = None
            connection.session_encrypted = None
            await self._session.commit()
            raise TelegramClientNotConnectedError(
                "The saved Telegram identity does not match its authorization."
            )
        return connection


async def process_scan_job(job_id: str) -> bool:
    """Atomically claim or reclaim and process one persisted scan job."""

    lease = await _claim_scan_job(job_id=job_id)
    if lease is None:
        return False

    try:
        progress = await _run_with_lease_heartbeat(
            lease=lease,
            operation=_execute_bounded_scan_slice(lease=lease),
        )
        completion_reason = progress.completion_reason
        if progress.stop_requested:
            final_state = "cancelled"
            completion_reason = STOPPED_BY_USER
        elif completion_reason in (
            SOURCE_EXHAUSTED,
            MESSAGE_LIMIT_REACHED,
            RUNTIME_LIMIT_REACHED,
        ):
            final_state = "completed"
        elif _remaining_runtime_seconds(lease=lease) <= 0:
            final_state = "completed"
            completion_reason = RUNTIME_LIMIT_REACHED
        elif completion_reason in (SLICE_PAGE_LIMIT, SLICE_TIME_LIMIT):
            if not await _requeue_scan_job(lease=lease):
                raise ScanLeaseLostError(
                    "Scan lease was lost before the slice requeued."
                )
            return True
        else:
            raise RuntimeError("Scan slice ended without a completion disposition.")

        if not await _finalize_scan_job(
            lease=lease,
            state=final_state,
            error=None,
            completion_reason=completion_reason,
        ):
            raise ScanLeaseLostError("Scan lease was lost before terminalization.")
        return True
    except ScanLeaseLostError:
        logger.warning("Scan job %s lost lease ownership", job_id)
        return True
    except asyncio.CancelledError:
        await _release_interrupted_scan(lease=lease)
        raise
    except Exception:
        logger.exception("Telegram scan job %s failed", job_id)
        finalized = await _finalize_scan_job(
            lease=lease,
            state="failed",
            error=SCAN_FAILURE_MESSAGE,
            completion_reason=None,
        )
        if not finalized:
            logger.warning(
                "Scan job %s lost lease ownership before failure terminalization",
                job_id,
            )
        return True


async def process_next_scan_job() -> bool:
    """Process the oldest claimable job without sleeping on claim contention."""

    await _terminalize_expired_stopping_jobs()
    for _ in range(SCAN_CLAIM_RETRY_LIMIT):
        now = _utcnow()
        async with SessionLocal() as session:
            job_id = await session.scalar(
                select(ScanJob.id)
                .where(
                    or_(
                        ScanJob.state == "pending",
                        (
                            (ScanJob.state == "running")
                            & or_(
                                ScanJob.lease_expires_at.is_(None),
                                ScanJob.lease_expires_at <= now,
                            )
                        ),
                    )
                )
                .order_by(
                    func.coalesce(ScanJob.heartbeat_at, ScanJob.created_at).asc(),
                    ScanJob.created_at.asc(),
                )
                .limit(1)
            )
        if job_id is None:
            return False
        if await process_scan_job(job_id):
            return True
        # Another worker won the fenced claim after our read. Yield so its
        # transaction becomes visible, then select another queued job promptly.
        await asyncio.sleep(0)

    # Contention is not an empty queue. Tell the worker to try again immediately
    # rather than applying its idle sleep while work may still be waiting.
    return True


async def process_scan_queue() -> None:
    """Drain claimable slices fairly for development's in-API worker mode."""

    while await process_next_scan_job():
        await asyncio.sleep(0)


async def _claim_scan_job(*, job_id: str, owner: str | None = None) -> ScanLease | None:
    now = _utcnow()
    lease_owner = owner or str(uuid4())
    lease_expires_at = now + timedelta(seconds=SCAN_LEASE_SECONDS)
    async with SessionLocal() as session:
        await session.execute(
            update(ScanJob)
            .where(
                ScanJob.id == job_id,
                ScanJob.state.in_(ACTIVE_SCAN_STATES),
                or_(
                    ScanJob.telegram_user_id.is_(None),
                    ScanJob.connection_generation.is_(None),
                ),
            )
            .values(
                state="failed",
                error="Scan job has no Telegram provenance.",
                finished_at=now,
                completion_reason=None,
                lease_owner=None,
                lease_expires_at=None,
            )
        )
        await session.execute(
            update(ScanJob)
            .where(
                ScanJob.id == job_id,
                ScanJob.state == "stopping",
                or_(
                    ScanJob.lease_expires_at.is_(None), ScanJob.lease_expires_at <= now
                ),
            )
            .values(
                state="cancelled",
                completion_reason=STOPPED_BY_USER,
                finished_at=now,
                lease_owner=None,
                lease_expires_at=None,
            )
        )
        await session.execute(
            update(Message)
            .where(
                Message.last_seen_replacement_job_id == job_id,
                Message.last_seen_replacement_job_id.in_(
                    select(ScanJob.id).where(
                        ScanJob.id == job_id,
                        ScanJob.state.in_(("failed", "cancelled")),
                    )
                ),
            )
            .values(last_seen_replacement_job_id=None)
        )
        result = await session.execute(
            update(ScanJob)
            .where(
                ScanJob.id == job_id,
                ScanJob.telegram_user_id.is_not(None),
                ScanJob.connection_generation.is_not(None),
                or_(
                    ScanJob.state == "pending",
                    (
                        (ScanJob.state == "running")
                        & or_(
                            ScanJob.lease_expires_at.is_(None),
                            ScanJob.lease_expires_at <= now,
                        )
                    ),
                ),
            )
            .values(
                state="running",
                lease_owner=lease_owner,
                lease_expires_at=lease_expires_at,
                heartbeat_at=now,
                started_at=case(
                    (ScanJob.started_at.is_(None), now),
                    else_=ScanJob.started_at,
                ),
                finished_at=None,
                error=None,
                completion_reason=None,
            )
        )
        if int(result.rowcount or 0) != 1:
            # This also commits a stale ``stopping`` job that the first
            # statement terminalized. With no matching row, there is no claim
            # mutation to roll back.
            await session.commit()
            return None
        await session.commit()
        job = await session.get(ScanJob, job_id)
        if (
            job is None
            or job.lease_owner != lease_owner
            or job.telegram_user_id is None
            or job.connection_generation is None
        ):
            return None
        return ScanLease(
            job_id=job.id,
            user_id=job.user_id,
            page_size=job.page_size,
            telegram_user_id=job.telegram_user_id,
            connection_generation=job.connection_generation,
            messages_scanned=job.messages_scanned,
            last_message_id=job.last_message_id,
            max_messages=job.max_messages,
            max_runtime_seconds=job.max_runtime_seconds,
            started_at=_as_utc(job.started_at or now),
            owner=lease_owner,
            replace_existing=job.replace_existing,
        )


async def _renew_scan_lease(*, lease: ScanLease) -> bool:
    now = _utcnow()
    async with SessionLocal() as session:
        result = await session.execute(
            update(ScanJob)
            .where(
                ScanJob.id == lease.job_id,
                ScanJob.user_id == lease.user_id,
                ScanJob.telegram_user_id == lease.telegram_user_id,
                ScanJob.connection_generation == lease.connection_generation,
                ScanJob.lease_owner == lease.owner,
                ScanJob.state.in_(("running", "stopping")),
                ScanJob.lease_expires_at > now,
            )
            .values(
                heartbeat_at=now,
                lease_expires_at=now + timedelta(seconds=SCAN_LEASE_SECONDS),
            )
        )
        await session.commit()
        return int(result.rowcount or 0) == 1


async def _heartbeat_loop(
    *,
    lease: ScanLease,
    stop: asyncio.Event,
    interval_seconds: float = SCAN_HEARTBEAT_SECONDS,
) -> bool:
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
        except TimeoutError:
            if not await _renew_scan_lease(lease=lease):
                return False
    return True


async def _run_with_lease_heartbeat(
    *,
    lease: ScanLease,
    operation: Awaitable[_ResultT],
) -> _ResultT:
    stop = asyncio.Event()
    operation_task = asyncio.create_task(operation)
    heartbeat_task = asyncio.create_task(_heartbeat_loop(lease=lease, stop=stop))
    try:
        done, _ = await asyncio.wait(
            {operation_task, heartbeat_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if heartbeat_task in done and not heartbeat_task.result():
            operation_task.cancel()
            with suppress(asyncio.CancelledError):
                await operation_task
            raise ScanLeaseLostError("Scan lease expired or was reclaimed.")

        result = await operation_task
        stop.set()
        if not await heartbeat_task:
            raise ScanLeaseLostError(
                "Scan lease expired before the operation completed."
            )
        return result
    finally:
        stop.set()
        for task in (operation_task, heartbeat_task):
            if not task.done():
                task.cancel()
        for task in (operation_task, heartbeat_task):
            with suppress(asyncio.CancelledError, Exception):
                await task


async def _execute_claimed_scan(*, lease: ScanLease) -> ScanProgress:
    remaining_messages = lease.max_messages - lease.messages_scanned
    if remaining_messages <= 0:
        return ScanProgress(
            is_complete=True,
            completion_reason=MESSAGE_LIMIT_REACHED,
        )
    remaining_runtime = _remaining_runtime_seconds(lease=lease)
    if remaining_runtime <= 0:
        return ScanProgress(
            is_complete=True,
            completion_reason=RUNTIME_LIMIT_REACHED,
        )

    scanner = SavedMessagesScanner()
    async with SessionLocal() as connection_session:
        connection = await connection_session.scalar(
            select(TelegramConnection).where(
                TelegramConnection.user_id == lease.user_id,
                TelegramConnection.telegram_user_id == lease.telegram_user_id,
                TelegramConnection.generation == lease.connection_generation,
            )
        )
        if (
            connection is None
            or connection.state != "connected"
            or not connection.session_encrypted
        ):
            raise TelegramClientNotConnectedError(
                "Telegram is not connected for this scan."
            )
        try:
            session_string = decrypt_secret(
                connection.session_encrypted,
                context=f"telegram:{lease.user_id}:session",
            )
        except SecretDecryptionError:
            connection.state = "error"
            await connection_session.commit()
            raise

    async with short_lived_client(session_string=session_string) as client:
        if not await client.is_user_authorized():
            await _downgrade_connection(lease=lease)
            raise TelegramClientNotConnectedError(
                "Telegram authorization is no longer valid."
            )
        identity = await client.get_me()
        if getattr(identity, "id", None) != lease.telegram_user_id:
            await _downgrade_connection(lease=lease)
            raise TelegramClientNotConnectedError(
                "Telegram identity changed while the scan was running."
            )

        async def persist_page(page: ScanPage) -> None:
            await _persist_scan_page(lease=lease, page=page)

        async def should_stop() -> bool:
            return await _scan_stop_requested(lease=lease)

        progress = await scanner.scan(
            client=client,
            page_size=lease.page_size,
            on_page=persist_page,
            should_stop=should_stop,
            start_offset_id=lease.last_message_id,
            max_messages=remaining_messages,
            max_pages=settings.scan_slice_max_pages,
            timeout_seconds=min(
                float(settings.scan_slice_seconds),
                remaining_runtime,
            ),
        )
        refreshed_session = client.session.save()

    await _persist_refreshed_session(lease=lease, session_string=refreshed_session)
    return progress


async def _execute_bounded_scan_slice(*, lease: ScanLease) -> ScanProgress:
    """Bound connection, fetch, persistence, and cleanup time for one slice."""

    remaining_runtime = _remaining_runtime_seconds(lease=lease)
    if remaining_runtime <= 0:
        return ScanProgress(
            is_complete=True,
            completion_reason=RUNTIME_LIMIT_REACHED,
        )
    slice_seconds = min(float(settings.scan_slice_seconds), remaining_runtime)
    try:
        async with asyncio.timeout(slice_seconds):
            return await _execute_claimed_scan(lease=lease)
    except TimeoutError:
        reason = (
            RUNTIME_LIMIT_REACHED
            if _remaining_runtime_seconds(lease=lease) <= 0
            else SLICE_TIME_LIMIT
        )
        return ScanProgress(
            is_complete=reason == RUNTIME_LIMIT_REACHED,
            completion_reason=reason,
        )


async def _persist_refreshed_session(*, lease: ScanLease, session_string: str) -> None:
    """Persist a Telethon session only while holding the current fenced job row."""

    now = _utcnow()
    async with SessionLocal() as session:
        # Keep the same lock order as disconnect/account deletion:
        # TelegramConnection first, then ScanJob. This avoids an ABBA deadlock.
        connection = await session.scalar(
            select(TelegramConnection)
            .where(
                TelegramConnection.user_id == lease.user_id,
                TelegramConnection.telegram_user_id == lease.telegram_user_id,
                TelegramConnection.generation == lease.connection_generation,
                TelegramConnection.state == "connected",
            )
            .with_for_update()
        )
        if connection is None:
            raise ScanLeaseLostError(
                "Telegram connection changed before the refreshed session could be saved."
            )
        owned_job = await session.scalar(
            select(ScanJob)
            .where(
                ScanJob.id == lease.job_id,
                ScanJob.user_id == lease.user_id,
                ScanJob.telegram_user_id == lease.telegram_user_id,
                ScanJob.connection_generation == lease.connection_generation,
                ScanJob.lease_owner == lease.owner,
                ScanJob.state.in_(("running", "stopping")),
                ScanJob.lease_expires_at > now,
            )
            .with_for_update()
        )
        if owned_job is None:
            raise ScanLeaseLostError(
                "Scan lease was lost before the refreshed Telegram session could be saved."
            )
        connection.session_encrypted = encrypt_secret(
            session_string,
            context=f"telegram:{lease.user_id}:session",
        )
        fence = await session.execute(
            update(ScanJob)
            .where(
                ScanJob.id == lease.job_id,
                ScanJob.user_id == lease.user_id,
                ScanJob.telegram_user_id == lease.telegram_user_id,
                ScanJob.connection_generation == lease.connection_generation,
                ScanJob.lease_owner == lease.owner,
                ScanJob.state.in_(("running", "stopping")),
                ScanJob.lease_expires_at > _utcnow(),
            )
            .values(heartbeat_at=ScanJob.heartbeat_at)
            .execution_options(synchronize_session=False)
        )
        if int(fence.rowcount or 0) != 1:
            await session.rollback()
            raise ScanLeaseLostError(
                "Scan lease was lost while saving the refreshed Telegram session."
            )
        await session.commit()


async def _scan_stop_requested(*, lease: ScanLease) -> bool:
    now = _utcnow()
    async with SessionLocal() as session:
        requested = await session.scalar(
            select(ScanJob.stop_requested).where(
                ScanJob.id == lease.job_id,
                ScanJob.user_id == lease.user_id,
                ScanJob.telegram_user_id == lease.telegram_user_id,
                ScanJob.connection_generation == lease.connection_generation,
                ScanJob.lease_owner == lease.owner,
                ScanJob.lease_expires_at > now,
            )
        )
    if requested is None:
        raise ScanLeaseLostError("Scan lease is no longer owned by this worker.")
    return bool(requested)


async def _finalize_scan_job(
    *,
    lease: ScanLease,
    state: str,
    error: str | None,
    completion_reason: str | None = None,
) -> bool:
    if state not in TERMINAL_SCAN_STATES:
        raise ValueError("Scan finalization requires a terminal state.")
    now = _utcnow()
    async with SessionLocal() as session:
        result = await session.execute(
            update(ScanJob)
            .where(
                ScanJob.id == lease.job_id,
                ScanJob.user_id == lease.user_id,
                ScanJob.telegram_user_id == lease.telegram_user_id,
                ScanJob.connection_generation == lease.connection_generation,
                ScanJob.lease_owner == lease.owner,
                ScanJob.state.in_(("running", "stopping")),
                ScanJob.lease_expires_at > now,
            )
            .values(
                state=state,
                error=error,
                completion_reason=completion_reason,
                finished_at=now,
                lease_owner=None,
                lease_expires_at=None,
            )
        )
        if int(result.rowcount or 0) != 1:
            await session.rollback()
            return False

        if lease.replace_existing:
            if state == "completed" and completion_reason == SOURCE_EXHAUSTED:
                unseen_message_ids = select(Message.id).where(
                    Message.user_id == lease.user_id,
                    or_(
                        Message.last_seen_replacement_job_id.is_(None),
                        Message.last_seen_replacement_job_id != lease.job_id,
                    ),
                )
                await session.execute(
                    delete(MessageTag).where(
                        MessageTag.user_id == lease.user_id,
                        MessageTag.message_id.in_(unseen_message_ids),
                    )
                )
                await session.execute(
                    delete(Message).where(
                        Message.user_id == lease.user_id,
                        or_(
                            Message.last_seen_replacement_job_id.is_(None),
                            Message.last_seen_replacement_job_id != lease.job_id,
                        ),
                    )
                )
            await session.execute(
                update(Message)
                .where(
                    Message.user_id == lease.user_id,
                    Message.last_seen_replacement_job_id == lease.job_id,
                )
                .values(last_seen_replacement_job_id=None)
            )
        await session.commit()
        return True


async def _requeue_scan_job(*, lease: ScanLease) -> bool:
    """Yield a bounded slice while atomically honoring a concurrent stop."""

    now = _utcnow()
    async with SessionLocal() as session:
        if lease.replace_existing:
            cancelling_job_ids = select(ScanJob.id).where(
                ScanJob.id == lease.job_id,
                ScanJob.user_id == lease.user_id,
                ScanJob.telegram_user_id == lease.telegram_user_id,
                ScanJob.connection_generation == lease.connection_generation,
                ScanJob.lease_owner == lease.owner,
                ScanJob.state.in_(("running", "stopping")),
                ScanJob.lease_expires_at > now,
                or_(
                    ScanJob.stop_requested.is_(True),
                    ScanJob.state == "stopping",
                ),
            )
            await session.execute(
                update(Message)
                .where(
                    Message.user_id == lease.user_id,
                    Message.last_seen_replacement_job_id.in_(cancelling_job_ids),
                )
                .values(last_seen_replacement_job_id=None)
            )
        result = await session.execute(
            update(ScanJob)
            .where(
                ScanJob.id == lease.job_id,
                ScanJob.user_id == lease.user_id,
                ScanJob.telegram_user_id == lease.telegram_user_id,
                ScanJob.connection_generation == lease.connection_generation,
                ScanJob.lease_owner == lease.owner,
                ScanJob.state.in_(("running", "stopping")),
                ScanJob.lease_expires_at > now,
            )
            .values(
                state=case(
                    (ScanJob.stop_requested.is_(True), "cancelled"),
                    (ScanJob.state == "stopping", "cancelled"),
                    else_="pending",
                ),
                completion_reason=case(
                    (ScanJob.stop_requested.is_(True), STOPPED_BY_USER),
                    (ScanJob.state == "stopping", STOPPED_BY_USER),
                    else_=None,
                ),
                finished_at=case(
                    (ScanJob.stop_requested.is_(True), now),
                    (ScanJob.state == "stopping", now),
                    else_=None,
                ),
                heartbeat_at=now,
                lease_owner=None,
                lease_expires_at=None,
            )
        )
        await session.commit()
        return int(result.rowcount or 0) == 1


async def _release_interrupted_scan(*, lease: ScanLease) -> bool:
    now = _utcnow()
    async with SessionLocal() as session:
        if lease.replace_existing:
            cancelling_job_ids = select(ScanJob.id).where(
                ScanJob.id == lease.job_id,
                ScanJob.user_id == lease.user_id,
                ScanJob.telegram_user_id == lease.telegram_user_id,
                ScanJob.connection_generation == lease.connection_generation,
                ScanJob.lease_owner == lease.owner,
                ScanJob.state.in_(("running", "stopping")),
                or_(
                    ScanJob.stop_requested.is_(True),
                    ScanJob.state == "stopping",
                ),
            )
            await session.execute(
                update(Message)
                .where(
                    Message.user_id == lease.user_id,
                    Message.last_seen_replacement_job_id.in_(cancelling_job_ids),
                )
                .values(last_seen_replacement_job_id=None)
            )
        result = await session.execute(
            update(ScanJob)
            .where(
                ScanJob.id == lease.job_id,
                ScanJob.user_id == lease.user_id,
                ScanJob.telegram_user_id == lease.telegram_user_id,
                ScanJob.connection_generation == lease.connection_generation,
                ScanJob.lease_owner == lease.owner,
                ScanJob.state.in_(("running", "stopping")),
            )
            .values(
                state=case(
                    (ScanJob.stop_requested.is_(True), "cancelled"), else_="pending"
                ),
                finished_at=case(
                    (ScanJob.stop_requested.is_(True), now),
                    else_=None,
                ),
                completion_reason=case(
                    (ScanJob.stop_requested.is_(True), STOPPED_BY_USER),
                    else_=None,
                ),
                lease_owner=None,
                lease_expires_at=None,
            )
        )
        await session.commit()
        return int(result.rowcount or 0) == 1


async def _terminalize_expired_stopping_jobs() -> int:
    now = _utcnow()
    async with SessionLocal() as session:
        expired_job_ids = select(ScanJob.id).where(
            ScanJob.state == "stopping",
            or_(
                ScanJob.lease_expires_at.is_(None),
                ScanJob.lease_expires_at <= now,
            ),
        )
        await session.execute(
            update(Message)
            .where(Message.last_seen_replacement_job_id.in_(expired_job_ids))
            .values(last_seen_replacement_job_id=None)
        )
        result = await session.execute(
            update(ScanJob)
            .where(
                ScanJob.state == "stopping",
                or_(
                    ScanJob.lease_expires_at.is_(None), ScanJob.lease_expires_at <= now
                ),
            )
            .values(
                state="cancelled",
                stop_requested=True,
                completion_reason=STOPPED_BY_USER,
                finished_at=now,
                lease_owner=None,
                lease_expires_at=None,
            )
        )
        await session.commit()
        return int(result.rowcount or 0)


async def _downgrade_connection(*, lease: ScanLease) -> None:
    async with SessionLocal() as session:
        connection = await session.scalar(
            select(TelegramConnection)
            .where(
                TelegramConnection.user_id == lease.user_id,
                TelegramConnection.telegram_user_id == lease.telegram_user_id,
                TelegramConnection.generation == lease.connection_generation,
            )
            .with_for_update()
        )
        if connection is not None:
            now = _utcnow()
            connection.state = "disconnected"
            connection.telegram_user_id = None
            connection.generation += 1
            connection.phone_encrypted = None
            connection.session_encrypted = None
            connection.password_required = False
            connection.pending_phone_code_hash_encrypted = None
            connection.pending_expires_at = None
            active_job_ids = select(ScanJob.id).where(
                ScanJob.user_id == lease.user_id,
                ScanJob.telegram_user_id == lease.telegram_user_id,
                ScanJob.connection_generation == lease.connection_generation,
                ScanJob.state.in_(ACTIVE_SCAN_STATES),
            )
            await session.execute(
                update(Message)
                .where(
                    Message.user_id == lease.user_id,
                    Message.last_seen_replacement_job_id.in_(active_job_ids),
                )
                .values(last_seen_replacement_job_id=None)
            )
            await session.execute(
                update(ScanJob)
                .where(
                    ScanJob.user_id == lease.user_id,
                    ScanJob.telegram_user_id == lease.telegram_user_id,
                    ScanJob.connection_generation == lease.connection_generation,
                    ScanJob.state.in_(ACTIVE_SCAN_STATES),
                )
                .values(
                    state="cancelled",
                    stop_requested=True,
                    finished_at=now,
                    lease_owner=None,
                    lease_expires_at=None,
                )
            )
            await session.commit()


async def _persist_scan_page(*, lease: ScanLease, page: ScanPage) -> None:
    try:
        async with SessionLocal() as session:
            now = _utcnow()
            # Keep TelegramConnection -> ScanJob lock order consistent with
            # session refresh and disconnect so generation changes serialize
            # with page commits.
            connection_id = await session.scalar(
                select(TelegramConnection.id)
                .where(
                    TelegramConnection.user_id == lease.user_id,
                    TelegramConnection.telegram_user_id == lease.telegram_user_id,
                    TelegramConnection.generation == lease.connection_generation,
                    TelegramConnection.state == "connected",
                )
                .with_for_update()
            )
            if connection_id is None:
                raise ScanLeaseLostError(
                    "Telegram connection changed before the scanned page was persisted."
                )
            job_id = await session.scalar(
                select(ScanJob.id)
                .where(
                    ScanJob.id == lease.job_id,
                    ScanJob.user_id == lease.user_id,
                    ScanJob.telegram_user_id == lease.telegram_user_id,
                    ScanJob.connection_generation == lease.connection_generation,
                    ScanJob.lease_owner == lease.owner,
                    ScanJob.state.in_(("running", "stopping")),
                    ScanJob.lease_expires_at > now,
                )
                .with_for_update()
            )
            if job_id is None:
                raise ScanLeaseLostError(
                    "Scan page arrived after lease ownership was lost."
                )

            category_rows = await session.execute(
                select(Category.system_key, Category.slug, Category.id).where(
                    Category.user_id == lease.user_id
                )
            )
            category_map = {row.system_key or row.slug: row.id for row in category_rows}
            if "other" not in category_map:
                raise ScanPersistenceError("The user's fallback category is missing.")

            telegram_ids = tuple(message.telegram_id for message in page.messages)
            existing_messages = list(
                await session.scalars(
                    select(Message).where(
                        Message.user_id == lease.user_id,
                        Message.telegram_user_id == lease.telegram_user_id,
                        Message.telegram_id.in_(telegram_ids),
                    )
                )
            )
            existing_by_id = {
                message.telegram_id: message for message in existing_messages
            }
            seen_ids = set(existing_by_id)
            for scanned in page.messages:
                if scanned.telegram_id in seen_ids:
                    existing = existing_by_id[scanned.telegram_id]
                    existing.connection_generation = lease.connection_generation
                    existing.content = scanned.content
                    existing.media_type = scanned.media_type
                    existing.file_name = scanned.file_name
                    existing.file_size = scanned.file_size
                    existing.mime_type = scanned.mime_type
                    existing.url = scanned.url
                    existing.sender_name = scanned.sender_name
                    existing.date = scanned.date
                    existing.raw_data = scanned.raw_data
                    if lease.replace_existing:
                        existing.last_seen_replacement_job_id = lease.job_id
                    continue
                seen_ids.add(scanned.telegram_id)
                category_slug = categorize_scanned_message(scanned)
                session.add(
                    Message(
                        user_id=lease.user_id,
                        telegram_id=scanned.telegram_id,
                        telegram_user_id=lease.telegram_user_id,
                        connection_generation=lease.connection_generation,
                        content=scanned.content,
                        media_type=scanned.media_type,
                        file_name=scanned.file_name,
                        file_size=scanned.file_size,
                        mime_type=scanned.mime_type,
                        url=scanned.url,
                        sender_name=scanned.sender_name,
                        date=scanned.date,
                        category_id=category_map.get(
                            category_slug, category_map["other"]
                        ),
                        raw_data=scanned.raw_data,
                        last_seen_replacement_job_id=(
                            lease.job_id if lease.replace_existing else None
                        ),
                    )
                )

            fence = await session.execute(
                update(ScanJob)
                .where(
                    ScanJob.id == lease.job_id,
                    ScanJob.user_id == lease.user_id,
                    ScanJob.telegram_user_id == lease.telegram_user_id,
                    ScanJob.connection_generation == lease.connection_generation,
                    ScanJob.lease_owner == lease.owner,
                    ScanJob.state.in_(("running", "stopping")),
                    ScanJob.lease_expires_at > _utcnow(),
                )
                .values(
                    messages_scanned=ScanJob.messages_scanned + len(page.messages),
                    pages_scanned=ScanJob.pages_scanned + 1,
                    last_message_id=page.next_offset_id,
                )
            )
            if int(fence.rowcount or 0) != 1:
                await session.rollback()
                raise ScanLeaseLostError(
                    "Scan lease was lost while committing a scanned page."
                )
            await session.commit()
    except (ScanLeaseLostError, ScanPersistenceError):
        raise
    except Exception as exc:
        raise ScanPersistenceError("Failed to persist scanned messages.") from exc


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _remaining_runtime_seconds(
    *, lease: ScanLease, now: datetime | None = None
) -> float:
    elapsed = (_as_utc(now or _utcnow()) - _as_utc(lease.started_at)).total_seconds()
    return max(0.0, float(lease.max_runtime_seconds) - elapsed)


def _lease_is_expired(job: ScanJob, *, now: datetime) -> bool:
    expires_at = job.lease_expires_at
    if expires_at is None:
        return True
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= now


def _clear_lease(job: ScanJob) -> None:
    job.lease_owner = None
    job.lease_expires_at = None
