from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models import Base, Category, Message, ScanJob, TelegramConnection, User
from app.security import decrypt_secret, encrypt_secret
from app.telegram import service as service_module
from app.telegram.client import TelegramClientNotConnectedError
from app.telegram.scanner import (
    RUNTIME_LIMIT_REACHED,
    SLICE_PAGE_LIMIT,
    SOURCE_EXHAUSTED,
    ScanAlreadyRunningError,
    ScanPage,
    ScanProgress,
    ScannedMessage,
)
from app.telegram.service import (
    ScanLease,
    ScanLeaseLostError,
    TelegramScanService,
    _claim_scan_job,
    _execute_claimed_scan,
    _finalize_scan_job,
    _persist_refreshed_session,
    _persist_scan_page,
    _requeue_scan_job,
    _renew_scan_lease,
    _run_with_lease_heartbeat,
    process_scan_job,
    process_next_scan_job,
)

TELEGRAM_USER_ID = 101
CONNECTION_GENERATION = 3


class _FakeSession:
    def __init__(self, scalar_values: list[object | None]) -> None:
        self.scalar_values = scalar_values
        self.added: list[object] = []
        self.commit_calls = 0

    async def scalar(self, _statement: object) -> object | None:
        return self.scalar_values.pop(0)

    def add(self, value: object) -> None:
        self.added.append(value)

    async def commit(self) -> None:
        self.commit_calls += 1

    async def refresh(self, _value: object) -> None:
        return None


@asynccontextmanager
async def _scan_database(
    *,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'scan.db'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    monkeypatch.setattr(service_module, "SessionLocal", session_factory)
    try:
        yield session_factory
    finally:
        await engine.dispose()


async def _seed_user(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    user_id: str = "user-a",
) -> None:
    async with session_factory() as session:
        session.add(
            User(
                id=user_id,
                email=f"{user_id}@example.com",
                normalized_email=f"{user_id}@example.com",
                display_name=user_id,
                password_hash="hash",
            )
        )
        await session.commit()


def _future_lease() -> datetime:
    return datetime.now(tz=UTC) + timedelta(minutes=5)


def _past_lease() -> datetime:
    return datetime.now(tz=UTC) - timedelta(minutes=5)


def _lease(
    *,
    owner: str,
    job_id: str = "job-a",
    user_id: str = "user-a",
    telegram_user_id: int = TELEGRAM_USER_ID,
    connection_generation: int = CONNECTION_GENERATION,
    messages_scanned: int = 0,
    last_message_id: int | None = None,
    max_messages: int = 1_000,
    max_runtime_seconds: int = 3_600,
    started_at: datetime | None = None,
) -> ScanLease:
    return ScanLease(
        job_id=job_id,
        user_id=user_id,
        page_size=100,
        telegram_user_id=telegram_user_id,
        connection_generation=connection_generation,
        messages_scanned=messages_scanned,
        last_message_id=last_message_id,
        max_messages=max_messages,
        max_runtime_seconds=max_runtime_seconds,
        started_at=started_at or datetime.now(tz=UTC),
        owner=owner,
    )


@pytest.mark.asyncio
async def test_start_rejects_existing_active_job_for_same_user() -> None:
    active = SimpleNamespace(state="running", lease_expires_at=_future_lease())
    session = _FakeSession([SimpleNamespace(id="user-a"), active])
    service = TelegramScanService(session=session, user_id="user-a")  # type: ignore[arg-type]

    with pytest.raises(ScanAlreadyRunningError):
        await service.start(page_size=25)


@pytest.mark.asyncio
async def test_status_reads_latest_durable_job() -> None:
    job = SimpleNamespace(id="job-a", user_id="user-a", state="running")
    session = _FakeSession([job])
    service = TelegramScanService(session=session, user_id="user-a")  # type: ignore[arg-type]

    assert await service.status() is job


@pytest.mark.asyncio
async def test_start_snapshots_server_resource_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _FakeSession([SimpleNamespace(id="user-a"), None])
    service = TelegramScanService(session=session, user_id="user-a")  # type: ignore[arg-type]

    async def validate() -> SimpleNamespace:
        return SimpleNamespace(
            telegram_user_id=TELEGRAM_USER_ID,
            generation=CONNECTION_GENERATION,
        )

    monkeypatch.setattr(service, "_validate_authorized_connection", validate)
    monkeypatch.setattr(
        service_module,
        "settings",
        SimpleNamespace(scan_max_messages=321, scan_max_runtime_seconds=654),
    )

    job = await service.start(page_size=25)

    assert job.max_messages == 321
    assert job.max_runtime_seconds == 654


@pytest.mark.asyncio
async def test_stop_cancels_pending_job_durably() -> None:
    job = SimpleNamespace(
        id="job-a",
        user_id="user-a",
        state="pending",
        stop_requested=False,
        finished_at=None,
        lease_owner=None,
        lease_expires_at=None,
    )
    session = _FakeSession([job])
    service = TelegramScanService(session=session, user_id="user-a")  # type: ignore[arg-type]

    result = await service.stop()

    assert result is job
    assert job.state == "cancelled"
    assert job.stop_requested is True
    assert isinstance(job.finished_at, datetime)
    assert job.finished_at.tzinfo is UTC
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_scan_validation_clears_principal_and_increments_generation_when_unauthorized(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _ClientSession:
        def save(self) -> str:
            return "refreshed"

    class _UnauthorizedClient:
        session = _ClientSession()

        async def is_user_authorized(self) -> bool:
            return False

    @asynccontextmanager
    async def fake_client(**_: object):
        yield _UnauthorizedClient()

    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        encrypted = encrypt_secret("old", context="telegram:user-a:session")
        async with sessions() as session:
            session.add(
                TelegramConnection(
                    user_id="user-a",
                    state="connected",
                    telegram_user_id=TELEGRAM_USER_ID,
                    generation=CONNECTION_GENERATION,
                    session_encrypted=encrypted,
                )
            )
            await session.commit()

        monkeypatch.setattr(service_module, "short_lived_client", fake_client)
        async with sessions() as session:
            service = TelegramScanService(session=session, user_id="user-a")
            with pytest.raises(TelegramClientNotConnectedError):
                await service.start()

        async with sessions() as session:
            connection = await session.scalar(
                select(TelegramConnection).where(TelegramConnection.user_id == "user-a")
            )
            assert connection is not None
            assert connection.state == "disconnected"
            assert connection.telegram_user_id is None
            assert connection.generation == CONNECTION_GENERATION + 1
            assert connection.session_encrypted is None


@pytest.mark.asyncio
async def test_only_one_worker_atomically_claims_pending_job(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            session.add(
                ScanJob(
                    id="job-a",
                    user_id="user-a",
                    state="pending",
                    telegram_user_id=TELEGRAM_USER_ID,
                    connection_generation=CONNECTION_GENERATION,
                )
            )
            await session.commit()

        first, second = await asyncio.gather(
            _claim_scan_job(job_id="job-a", owner="worker-a"),
            _claim_scan_job(job_id="job-a", owner="worker-b"),
        )

        claims = [lease for lease in (first, second) if lease is not None]
        assert len(claims) == 1
        async with sessions() as session:
            job = await session.get(ScanJob, "job-a")
            assert job is not None
            assert job.state == "running"
            assert job.lease_owner == claims[0].owner


@pytest.mark.asyncio
async def test_crashed_worker_job_is_reclaimed_after_lease_expiry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            session.add(
                ScanJob(
                    id="job-a",
                    user_id="user-a",
                    state="running",
                    telegram_user_id=TELEGRAM_USER_ID,
                    connection_generation=CONNECTION_GENERATION,
                    lease_owner="crashed-worker",
                    lease_expires_at=_past_lease(),
                    heartbeat_at=_past_lease(),
                    messages_scanned=50,
                    last_message_id=777,
                    max_messages=500,
                    max_runtime_seconds=900,
                )
            )
            await session.commit()

        reclaimed = await _claim_scan_job(job_id="job-a", owner="replacement-worker")
        duplicate = await _claim_scan_job(job_id="job-a", owner="other-worker")

        assert reclaimed is not None
        assert reclaimed.owner == "replacement-worker"
        assert reclaimed.messages_scanned == 50
        assert reclaimed.last_message_id == 777
        assert reclaimed.max_messages == 500
        assert reclaimed.max_runtime_seconds == 900
        assert duplicate is None
        async with sessions() as session:
            job = await session.get(ScanJob, "job-a")
            assert job is not None
            assert job.lease_owner == "replacement-worker"
            assert job.heartbeat_at is not None
            assert job.lease_expires_at is not None


@pytest.mark.asyncio
async def test_stale_stopping_job_is_terminalized_instead_of_reclaimed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            session.add(
                ScanJob(
                    id="job-a",
                    user_id="user-a",
                    state="stopping",
                    telegram_user_id=TELEGRAM_USER_ID,
                    connection_generation=CONNECTION_GENERATION,
                    stop_requested=True,
                    lease_owner="crashed-worker",
                    lease_expires_at=_past_lease(),
                )
            )
            await session.commit()

        assert await _claim_scan_job(job_id="job-a", owner="replacement-worker") is None

        async with sessions() as session:
            job = await session.get(ScanJob, "job-a")
            assert job is not None
            assert job.state == "cancelled"
            assert job.finished_at is not None
            assert job.lease_owner is None
            assert job.lease_expires_at is None


@pytest.mark.asyncio
async def test_heartbeat_and_terminalization_are_fenced_by_owner(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            session.add(
                ScanJob(
                    id="job-a",
                    user_id="user-a",
                    state="running",
                    telegram_user_id=TELEGRAM_USER_ID,
                    connection_generation=CONNECTION_GENERATION,
                    lease_owner="worker-a",
                    lease_expires_at=_future_lease(),
                    heartbeat_at=datetime.now(tz=UTC),
                )
            )
            await session.commit()

        correct = _lease(owner="worker-a")
        stale = _lease(owner="worker-b")

        assert await _renew_scan_lease(lease=stale) is False
        assert await _renew_scan_lease(lease=correct) is True
        assert await _finalize_scan_job(lease=stale, state="completed", error=None) is False
        assert await _finalize_scan_job(lease=correct, state="completed", error=None) is True

        async with sessions() as session:
            job = await session.get(ScanJob, "job-a")
            assert job is not None
            assert job.state == "completed"
            assert job.lease_owner is None
            assert job.lease_expires_at is None


@pytest.mark.asyncio
async def test_heartbeat_cancels_long_telegram_operation_when_lease_is_lost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    operation_started = asyncio.Event()
    operation_cancelled = asyncio.Event()
    lease = _lease(owner="worker-a")

    async def long_operation() -> None:
        operation_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            operation_cancelled.set()
            raise

    async def lose_lease(**_: object) -> bool:
        await operation_started.wait()
        return False

    monkeypatch.setattr(service_module, "_heartbeat_loop", lose_lease)

    with pytest.raises(ScanLeaseLostError):
        await _run_with_lease_heartbeat(lease=lease, operation=long_operation())
    assert operation_cancelled.is_set()


@pytest.mark.asyncio
async def test_process_job_logs_lease_loss_when_success_cannot_be_terminalized(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    lease = _lease(owner="worker-a")

    async def claim(**_: object) -> ScanLease:
        return lease

    async def execute(**_: object) -> ScanProgress:
        return ScanProgress(
            is_complete=True,
            completion_reason=SOURCE_EXHAUSTED,
        )

    async def run(*, operation: object, **_: object) -> ScanProgress:
        return await operation  # type: ignore[misc]

    async def fail_to_finalize(**_: object) -> bool:
        return False

    monkeypatch.setattr(service_module, "_claim_scan_job", claim)
    monkeypatch.setattr(service_module, "_execute_claimed_scan", execute)
    monkeypatch.setattr(service_module, "_run_with_lease_heartbeat", run)
    monkeypatch.setattr(service_module, "_finalize_scan_job", fail_to_finalize)

    with caplog.at_level(logging.WARNING):
        assert await process_scan_job("job-a") is True
    assert "lost lease ownership" in caplog.text


@pytest.mark.asyncio
async def test_process_job_requeues_bounded_slice_without_terminalizing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lease = _lease(owner="worker-a")
    calls: list[str] = []

    async def claim(**_: object) -> ScanLease:
        return lease

    async def execute(**_: object) -> ScanProgress:
        return ScanProgress(completion_reason=SLICE_PAGE_LIMIT)

    async def run(*, operation: object, **_: object) -> ScanProgress:
        return await operation  # type: ignore[misc]

    async def requeue(**_: object) -> bool:
        calls.append("requeue")
        return True

    async def finalize(**_: object) -> bool:
        calls.append("finalize")
        return True

    monkeypatch.setattr(service_module, "_claim_scan_job", claim)
    monkeypatch.setattr(service_module, "_execute_claimed_scan", execute)
    monkeypatch.setattr(service_module, "_run_with_lease_heartbeat", run)
    monkeypatch.setattr(service_module, "_requeue_scan_job", requeue)
    monkeypatch.setattr(service_module, "_finalize_scan_job", finalize)

    assert await process_scan_job("job-a") is True
    assert calls == ["requeue"]


@pytest.mark.asyncio
async def test_runtime_quota_terminalizes_with_explicit_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lease = _lease(owner="worker-a")
    captured: dict[str, object] = {}

    async def claim(**_: object) -> ScanLease:
        return lease

    async def execute(**_: object) -> ScanProgress:
        return ScanProgress(
            is_complete=True,
            completion_reason=RUNTIME_LIMIT_REACHED,
        )

    async def run(*, operation: object, **_: object) -> ScanProgress:
        return await operation  # type: ignore[misc]

    async def finalize(**kwargs: object) -> bool:
        captured.update(kwargs)
        return True

    monkeypatch.setattr(service_module, "_claim_scan_job", claim)
    monkeypatch.setattr(service_module, "_execute_claimed_scan", execute)
    monkeypatch.setattr(service_module, "_run_with_lease_heartbeat", run)
    monkeypatch.setattr(service_module, "_finalize_scan_job", finalize)

    assert await process_scan_job("job-a") is True
    assert captured["state"] == "completed"
    assert captured["completion_reason"] == RUNTIME_LIMIT_REACHED


@pytest.mark.asyncio
async def test_reclaimed_scan_passes_durable_cursor_and_remaining_quota_to_scanner(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class _ClientSession:
        def save(self) -> str:
            return "refreshed"

    class _Client:
        session = _ClientSession()

        async def is_user_authorized(self) -> bool:
            return True

        async def get_me(self) -> SimpleNamespace:
            return SimpleNamespace(id=TELEGRAM_USER_ID)

    class _Scanner:
        async def scan(self, **kwargs: object) -> ScanProgress:
            captured.update(kwargs)
            return ScanProgress(completion_reason=SLICE_PAGE_LIMIT)

    @asynccontextmanager
    async def client_context(**_: object):
        yield _Client()

    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        encrypted = encrypt_secret("session", context="telegram:user-a:session")
        async with sessions() as session:
            session.add_all(
                [
                    TelegramConnection(
                        user_id="user-a",
                        state="connected",
                        telegram_user_id=TELEGRAM_USER_ID,
                        generation=CONNECTION_GENERATION,
                        session_encrypted=encrypted,
                    ),
                    ScanJob(
                        id="job-a",
                        user_id="user-a",
                        state="running",
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        messages_scanned=125,
                        last_message_id=777,
                        lease_owner="worker-a",
                        lease_expires_at=_future_lease(),
                    ),
                ]
            )
            await session.commit()

        monkeypatch.setattr(service_module, "SavedMessagesScanner", _Scanner)
        monkeypatch.setattr(service_module, "short_lived_client", client_context)
        monkeypatch.setattr(
            service_module,
            "settings",
            SimpleNamespace(scan_slice_max_pages=4, scan_slice_seconds=30),
        )
        lease = _lease(
            owner="worker-a",
            messages_scanned=125,
            last_message_id=777,
            max_messages=500,
        )

        progress = await _execute_claimed_scan(lease=lease)

        assert progress.completion_reason == SLICE_PAGE_LIMIT
        assert captured["start_offset_id"] == 777
        assert captured["max_messages"] == 375
        assert captured["max_pages"] == 4


@pytest.mark.asyncio
async def test_requeue_is_fenced_and_preserves_resume_progress(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            session.add(
                ScanJob(
                    id="job-a",
                    user_id="user-a",
                    state="running",
                    telegram_user_id=TELEGRAM_USER_ID,
                    connection_generation=CONNECTION_GENERATION,
                    messages_scanned=12,
                    pages_scanned=2,
                    last_message_id=88,
                    lease_owner="worker-a",
                    lease_expires_at=_future_lease(),
                )
            )
            await session.commit()

        assert await _requeue_scan_job(lease=_lease(owner="wrong-worker")) is False
        assert await _requeue_scan_job(
            lease=_lease(
                owner="worker-a",
                connection_generation=CONNECTION_GENERATION + 1,
            )
        ) is False
        assert await _requeue_scan_job(lease=_lease(owner="worker-a")) is True

        async with sessions() as session:
            job = await session.get(ScanJob, "job-a")
            assert job is not None
            assert job.state == "pending"
            assert job.messages_scanned == 12
            assert job.pages_scanned == 2
            assert job.last_message_id == 88
            assert job.lease_owner is None
            assert job.heartbeat_at is not None


@pytest.mark.asyncio
async def test_next_job_uses_least_recently_serviced_fair_order(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        async with sessions() as session:
            for user_id, heartbeat in (
                ("user-recent", datetime.now(tz=UTC)),
                ("user-waiting", _past_lease()),
            ):
                session.add(
                    User(
                        id=user_id,
                        email=f"{user_id}@example.com",
                        normalized_email=f"{user_id}@example.com",
                        display_name=user_id,
                        password_hash="hash",
                    )
                )
                session.add(
                    ScanJob(
                        id=f"job-{user_id}",
                        user_id=user_id,
                        state="pending",
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        heartbeat_at=heartbeat,
                    )
                )
            await session.commit()

        selected: list[str] = []

        async def process(job_id: str) -> bool:
            selected.append(job_id)
            return True

        monkeypatch.setattr(service_module, "process_scan_job", process)

        assert await process_next_scan_job() is True
        assert selected == ["job-user-waiting"]


@pytest.mark.asyncio
async def test_refreshed_telegram_session_write_requires_current_lease(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        original = encrypt_secret("original", context="telegram:user-a:session")
        async with sessions() as session:
            session.add_all(
                [
                    TelegramConnection(
                        user_id="user-a",
                        state="connected",
                        telegram_user_id=TELEGRAM_USER_ID,
                        generation=CONNECTION_GENERATION,
                        session_encrypted=original,
                    ),
                    ScanJob(
                        id="job-a",
                        user_id="user-a",
                        state="running",
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        lease_owner="worker-a",
                        lease_expires_at=_future_lease(),
                    ),
                ]
            )
            await session.commit()

        stale = _lease(owner="worker-b")
        current = _lease(owner="worker-a")
        with pytest.raises(ScanLeaseLostError):
            await _persist_refreshed_session(lease=stale, session_string="stale")
        await _persist_refreshed_session(lease=current, session_string="refreshed")

        async with sessions() as session:
            connection = await session.scalar(
                select(TelegramConnection).where(TelegramConnection.user_id == "user-a")
            )
            assert connection is not None
            assert decrypt_secret(
                connection.session_encrypted,
                context="telegram:user-a:session",
            ) == "refreshed"


@pytest.mark.asyncio
async def test_reconnected_generation_rejects_stale_session_refresh(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        original = encrypt_secret("current", context="telegram:user-a:session")
        async with sessions() as session:
            session.add_all(
                [
                    TelegramConnection(
                        user_id="user-a",
                        state="connected",
                        telegram_user_id=TELEGRAM_USER_ID,
                        generation=CONNECTION_GENERATION + 1,
                        session_encrypted=original,
                    ),
                    ScanJob(
                        id="job-a",
                        user_id="user-a",
                        state="running",
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        lease_owner="worker-a",
                        lease_expires_at=_future_lease(),
                    ),
                ]
            )
            await session.commit()

        with pytest.raises(ScanLeaseLostError):
            await _persist_refreshed_session(
                lease=_lease(owner="worker-a"),
                session_string="stale-session",
            )

        async with sessions() as session:
            connection = await session.scalar(
                select(TelegramConnection).where(TelegramConnection.user_id == "user-a")
            )
            assert connection is not None
            assert decrypt_secret(
                connection.session_encrypted,
                context="telegram:user-a:session",
            ) == "current"


@pytest.mark.asyncio
async def test_scan_page_persistence_is_tenant_scoped_and_lease_fenced(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        async with sessions() as session:
            for user_id in ("user-a", "user-b"):
                telegram_user_id = 101 if user_id == "user-a" else 202
                session.add(
                    User(
                        id=user_id,
                        email=f"{user_id}@example.com",
                        normalized_email=f"{user_id}@example.com",
                        display_name=user_id,
                        password_hash="hash",
                    )
                )
                session.add(
                    Category(
                        user_id=user_id,
                        name="Other",
                        normalized_name="other",
                        slug="other",
                        system_key="other",
                        icon="archive",
                        color="#64748B",
                        position=1,
                        is_default=True,
                    )
                )
                session.add(
                    TelegramConnection(
                        user_id=user_id,
                        state="connected",
                        telegram_user_id=telegram_user_id,
                        generation=CONNECTION_GENERATION,
                        session_encrypted=f"session-{user_id}",
                    )
                )
                session.add(
                    ScanJob(
                        id=f"job-{user_id}",
                        user_id=user_id,
                        state="running",
                        telegram_user_id=telegram_user_id,
                        connection_generation=CONNECTION_GENERATION,
                        lease_owner=f"worker-{user_id}",
                        lease_expires_at=_future_lease(),
                    )
                )
            await session.commit()

        page = ScanPage(
            messages=(
                ScannedMessage(
                    telegram_id=42,
                    content="same Telegram id",
                    media_type=None,
                    file_name=None,
                    file_size=None,
                    mime_type=None,
                    url=None,
                    sender_name=None,
                    date=datetime.now(tz=UTC),
                    raw_data={"id": 42},
                ),
            ),
            has_more=False,
            next_offset_id=42,
        )
        stale = _lease(
            job_id="job-user-a",
            user_id="user-a",
            telegram_user_id=101,
            owner="stale-worker",
        )
        with pytest.raises(ScanLeaseLostError):
            await _persist_scan_page(lease=stale, page=page)

        for user_id in ("user-a", "user-b"):
            telegram_user_id = 101 if user_id == "user-a" else 202
            await _persist_scan_page(
                lease=_lease(
                    job_id=f"job-{user_id}",
                    user_id=user_id,
                    telegram_user_id=telegram_user_id,
                    owner=f"worker-{user_id}",
                ),
                page=page,
            )

        async with sessions() as session:
            rows = list(await session.scalars(select(Message).order_by(Message.user_id)))
            assert [(message.user_id, message.telegram_id) for message in rows] == [
                ("user-a", 42),
                ("user-b", 42),
            ]
            assert [message.telegram_user_id for message in rows] == [101, 202]
            jobs = list(await session.scalars(select(ScanJob).order_by(ScanJob.user_id)))
            assert [(job.user_id, job.messages_scanned) for job in jobs] == [
                ("user-a", 1),
                ("user-b", 1),
            ]


@pytest.mark.asyncio
async def test_reconnected_generation_rejects_stale_scan_page(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            session.add_all(
                [
                    Category(
                        user_id="user-a",
                        name="Other",
                        normalized_name="other",
                        slug="other",
                        system_key="other",
                        icon="archive",
                        color="#64748B",
                        position=1,
                        is_default=True,
                    ),
                    TelegramConnection(
                        user_id="user-a",
                        state="connected",
                        telegram_user_id=TELEGRAM_USER_ID,
                        generation=CONNECTION_GENERATION + 1,
                        session_encrypted="current-session",
                    ),
                    ScanJob(
                        id="job-a",
                        user_id="user-a",
                        state="running",
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        lease_owner="worker-a",
                        lease_expires_at=_future_lease(),
                    ),
                ]
            )
            await session.commit()

        page = ScanPage(
            messages=(
                ScannedMessage(
                    telegram_id=42,
                    content="stale",
                    media_type=None,
                    file_name=None,
                    file_size=None,
                    mime_type=None,
                    url=None,
                    sender_name=None,
                    date=datetime.now(tz=UTC),
                    raw_data={"id": 42},
                ),
            ),
            has_more=False,
            next_offset_id=42,
        )
        with pytest.raises(ScanLeaseLostError):
            await _persist_scan_page(lease=_lease(owner="worker-a"), page=page)

        async with sessions() as session:
            assert list(await session.scalars(select(Message))) == []
