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
from sqlalchemy.orm import undefer

from app.models import (
    Base,
    Category,
    Message,
    MessageTag,
    ScanJob,
    Tag,
    TelegramConnection,
    User,
)
from app.security import SecretDecryptionError, decrypt_secret, encrypt_secret
from app.telegram import service as service_module
from app.telegram.client import TelegramClientNotConnectedError
from app.telegram.scanner import (
    MESSAGE_LIMIT_REACHED,
    RUNTIME_LIMIT_REACHED,
    SLICE_PAGE_LIMIT,
    SOURCE_EXHAUSTED,
    ScanAlreadyRunningError,
    ScanPage,
    ScanProgress,
    ScannedMessage,
)
from app.telegram.schemas import SCAN_FAILURE_MESSAGE
from app.telegram.service import (
    ScanLease,
    ScanLeaseLostError,
    TelegramScanService,
    _claim_scan_job,
    _execute_claimed_scan,
    _finalize_scan_job,
    _persist_refreshed_session,
    _persist_scan_page,
    _release_interrupted_scan,
    _requeue_scan_job,
    _renew_scan_lease,
    _run_with_lease_heartbeat,
    process_scan_job,
    process_next_scan_job,
)

TELEGRAM_USER_ID = 101
CONNECTION_GENERATION = 3
TEST_API_HASH = "0123456789abcdef0123456789abcdef"


@pytest.fixture(autouse=True)
def _stub_user_api_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        service_module,
        "decrypt_telegram_api_credentials",
        lambda **_: (123456, TEST_API_HASH),
    )


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
    replace_existing: bool = False,
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
        replace_existing=replace_existing,
    )


@pytest.mark.asyncio
async def test_start_rejects_existing_active_job_for_same_user() -> None:
    active = SimpleNamespace(state="running", lease_expires_at=_future_lease())
    session = _FakeSession([SimpleNamespace(id="user-a"), active])
    service = TelegramScanService(session=session, user_id="user-a")  # type: ignore[arg-type]

    with pytest.raises(ScanAlreadyRunningError):
        await service.start(page_size=25)


@pytest.mark.asyncio
async def test_start_rejects_reclaimable_job_with_different_replacement_intent() -> (
    None
):
    active = SimpleNamespace(
        state="pending",
        lease_expires_at=None,
        replace_existing=True,
    )
    session = _FakeSession([SimpleNamespace(id="user-a"), active])
    service = TelegramScanService(session=session, user_id="user-a")  # type: ignore[arg-type]

    with pytest.raises(ScanAlreadyRunningError, match="different replacement mode"):
        await service.start(page_size=25, clear_existing=False)


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
async def test_clear_and_rescan_preserves_library_until_scan_completes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            category = Category(
                user_id="user-a",
                name="Text",
                normalized_name="text",
                slug="text",
                system_key="text",
                icon="message-square",
                color="#6B7280",
                position=1,
                is_default=True,
            )
            session.add(category)
            await session.flush()
            session.add(
                Message(
                    user_id="user-a",
                    telegram_id=1,
                    telegram_user_id=TELEGRAM_USER_ID,
                    connection_generation=CONNECTION_GENERATION,
                    content="old import",
                    date=datetime.now(tz=UTC),
                    category_id=category.id,
                    raw_data={},
                )
            )
            await session.commit()

        async with sessions() as session:
            service = TelegramScanService(session=session, user_id="user-a")

            async def validate() -> SimpleNamespace:
                return SimpleNamespace(
                    telegram_user_id=TELEGRAM_USER_ID,
                    generation=CONNECTION_GENERATION,
                )

            monkeypatch.setattr(service, "_validate_authorized_connection", validate)
            job = await service.start(page_size=25, clear_existing=True)

        async with sessions() as session:
            messages = list(await session.scalars(select(Message)))
            assert len(messages) == 1
            assert messages[0].content == "old import"
            assert messages[0].last_seen_replacement_job_id is None
            persisted_job = await session.get(ScanJob, job.id)
            assert persisted_job is not None
            assert persisted_job.state == "pending"
            assert persisted_job.replace_existing is True


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
        assert (
            await _finalize_scan_job(lease=stale, state="completed", error=None)
            is False
        )
        assert (
            await _finalize_scan_job(lease=correct, state="completed", error=None)
            is True
        )

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
async def test_process_job_logs_failure_details_but_persists_safe_message(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    lease = _lease(owner="worker-a")
    sentinel_secret = "telegram-session-secret-should-not-be-persisted"
    captured: dict[str, object] = {}

    async def claim(**_: object) -> ScanLease:
        return lease

    async def fail(**_: object) -> ScanProgress:
        raise RuntimeError(sentinel_secret)

    async def run(*, operation: object, **_: object) -> ScanProgress:
        return await operation  # type: ignore[misc]

    async def finalize(**kwargs: object) -> bool:
        captured.update(kwargs)
        return True

    monkeypatch.setattr(service_module, "_claim_scan_job", claim)
    monkeypatch.setattr(service_module, "_execute_bounded_scan_slice", fail)
    monkeypatch.setattr(service_module, "_run_with_lease_heartbeat", run)
    monkeypatch.setattr(service_module, "_finalize_scan_job", finalize)

    with caplog.at_level(logging.ERROR):
        assert await process_scan_job("job-a") is True

    assert sentinel_secret in caplog.text
    assert captured["state"] == "failed"
    assert captured["error"] == SCAN_FAILURE_MESSAGE
    assert sentinel_secret not in str(captured["error"])


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
async def test_worker_crypto_erases_corrupt_user_credentials(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            session.add_all(
                [
                    TelegramConnection(
                        user_id="user-a",
                        state="connected",
                        telegram_user_id=TELEGRAM_USER_ID,
                        generation=CONNECTION_GENERATION,
                        api_id_encrypted="corrupt-api-id",
                        api_hash_encrypted="corrupt-api-hash",
                        phone_encrypted="corrupt-phone",
                        session_encrypted="corrupt-session",
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

        with pytest.raises(SecretDecryptionError):
            await _execute_claimed_scan(lease=_lease(owner="worker-a"))

        async with sessions() as session:
            connection = await session.scalar(
                select(TelegramConnection).where(TelegramConnection.user_id == "user-a")
            )
            assert connection is not None
            assert connection.state == "error"
            assert connection.telegram_user_id is None
            assert connection.generation == CONNECTION_GENERATION + 1
            assert connection.api_id_encrypted is None
            assert connection.api_hash_encrypted is None
            assert connection.phone_encrypted is None
            assert connection.session_encrypted is None


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
        assert (
            await _requeue_scan_job(
                lease=_lease(
                    owner="worker-a",
                    connection_generation=CONNECTION_GENERATION + 1,
                )
            )
            is False
        )
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
async def test_next_job_retries_immediately_after_losing_a_claim(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        async with sessions() as session:
            for user_id, heartbeat in (
                ("user-first", _past_lease()),
                ("user-second", datetime.now(tz=UTC)),
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
            if len(selected) == 1:
                # Model a concurrent worker winning this claim after our select.
                async with sessions() as session:
                    claimed_elsewhere = await session.get(ScanJob, job_id)
                    assert claimed_elsewhere is not None
                    claimed_elsewhere.state = "running"
                    claimed_elsewhere.lease_owner = "other-worker"
                    claimed_elsewhere.lease_expires_at = _future_lease()
                    await session.commit()
                return False
            return True

        monkeypatch.setattr(service_module, "process_scan_job", process)

        assert await process_next_scan_job() is True
        assert selected == ["job-user-first", "job-user-second"]


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
            assert (
                decrypt_secret(
                    connection.session_encrypted,
                    context="telegram:user-a:session",
                )
                == "refreshed"
            )


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
            assert (
                decrypt_secret(
                    connection.session_encrypted,
                    context="telegram:user-a:session",
                )
                == "current"
            )


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
            rows = list(
                await session.scalars(select(Message).order_by(Message.user_id))
            )
            assert [(message.user_id, message.telegram_id) for message in rows] == [
                ("user-a", 42),
                ("user-b", 42),
            ]
            assert [message.telegram_user_id for message in rows] == [101, 202]
            jobs = list(
                await session.scalars(select(ScanJob).order_by(ScanJob.user_id))
            )
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


@pytest.mark.asyncio
async def test_source_exhausted_replacement_prunes_only_unseen_messages(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            organized = Category(
                user_id="user-a",
                name="Keep organized",
                normalized_name="keep organized",
                slug="keep-organized",
                icon="folder",
                color="#123456",
                position=1,
                is_default=False,
            )
            fallback = Category(
                user_id="user-a",
                name="Other",
                normalized_name="other",
                slug="other",
                system_key="other",
                icon="archive",
                color="#64748B",
                position=2,
                is_default=True,
            )
            tag = Tag(
                user_id="user-a",
                name="Important",
                normalized_name="important",
                color="#ff0000",
            )
            session.add_all([organized, fallback, tag])
            await session.flush()
            seen = Message(
                user_id="user-a",
                telegram_id=1,
                telegram_user_id=TELEGRAM_USER_ID,
                connection_generation=1,
                content="stale metadata",
                date=datetime.now(tz=UTC) - timedelta(days=1),
                category_id=organized.id,
                raw_data={"stale": True},
            )
            unseen = Message(
                user_id="user-a",
                telegram_id=2,
                telegram_user_id=TELEGRAM_USER_ID,
                connection_generation=1,
                content="deleted in Telegram",
                date=datetime.now(tz=UTC) - timedelta(days=2),
                category_id=fallback.id,
                raw_data={},
            )
            session.add_all([seen, unseen])
            await session.flush()
            session.add_all(
                [
                    MessageTag(
                        user_id="user-a",
                        message_id=seen.id,
                        tag_id=tag.id,
                    ),
                    TelegramConnection(
                        user_id="user-a",
                        state="connected",
                        telegram_user_id=TELEGRAM_USER_ID,
                        generation=CONNECTION_GENERATION,
                        session_encrypted="session",
                    ),
                    ScanJob(
                        id="job-a",
                        user_id="user-a",
                        state="running",
                        replace_existing=True,
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        lease_owner="worker-a",
                        lease_expires_at=_future_lease(),
                    ),
                ]
            )
            await session.commit()

        refreshed_at = datetime.now(tz=UTC)
        page = ScanPage(
            messages=(
                ScannedMessage(
                    telegram_id=1,
                    content="fresh metadata",
                    media_type=None,
                    file_name=None,
                    file_size=None,
                    mime_type=None,
                    url="https://example.com/fresh",
                    sender_name="Saved Messages",
                    date=refreshed_at,
                    raw_data={"fresh": True},
                ),
                ScannedMessage(
                    telegram_id=3,
                    content="new message",
                    media_type=None,
                    file_name=None,
                    file_size=None,
                    mime_type=None,
                    url=None,
                    sender_name=None,
                    date=refreshed_at,
                    raw_data={"id": 3},
                ),
            ),
            has_more=False,
            next_offset_id=1,
        )
        lease = _lease(owner="worker-a", replace_existing=True)
        await _persist_scan_page(lease=lease, page=page)

        async with sessions() as session:
            staged = list(
                await session.scalars(select(Message).order_by(Message.telegram_id))
            )
            assert [message.telegram_id for message in staged] == [1, 2, 3]
            assert [message.last_seen_replacement_job_id for message in staged] == [
                "job-a",
                None,
                "job-a",
            ]

        assert await _finalize_scan_job(
            lease=lease,
            state="completed",
            error=None,
            completion_reason=SOURCE_EXHAUSTED,
        )

        async with sessions() as session:
            retained = list(
                await session.scalars(select(Message).order_by(Message.telegram_id))
            )
            assert [message.telegram_id for message in retained] == [1, 3]
            assert retained[0].content == "fresh metadata"
            assert retained[0].raw_data == {"fresh": True}
            assert retained[0].category_id == organized.id
            assert all(
                message.last_seen_replacement_job_id is None for message in retained
            )
            assignments = list(await session.scalars(select(MessageTag)))
            assert len(assignments) == 1
            assert assignments[0].message_id == retained[0].id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("state", "completion_reason"),
    [
        ("failed", None),
        ("cancelled", "stopped_by_user"),
        ("completed", RUNTIME_LIMIT_REACHED),
        ("completed", MESSAGE_LIMIT_REACHED),
    ],
)
async def test_incomplete_replacement_preserves_library_and_clears_markers(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    state: str,
    completion_reason: str | None,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            category = Category(
                user_id="user-a",
                name="Other",
                normalized_name="other",
                slug="other",
                system_key="other",
                icon="archive",
                color="#64748B",
                position=1,
                is_default=True,
            )
            session.add(category)
            await session.flush()
            session.add_all(
                [
                    Message(
                        user_id="user-a",
                        telegram_id=1,
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        content="seen",
                        date=datetime.now(tz=UTC),
                        category_id=category.id,
                        raw_data={},
                        last_seen_replacement_job_id="job-a",
                    ),
                    Message(
                        user_id="user-a",
                        telegram_id=2,
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        content="unseen",
                        date=datetime.now(tz=UTC),
                        category_id=category.id,
                        raw_data={},
                    ),
                    ScanJob(
                        id="job-a",
                        user_id="user-a",
                        state="running",
                        replace_existing=True,
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        lease_owner="worker-a",
                        lease_expires_at=_future_lease(),
                    ),
                ]
            )
            await session.commit()

        assert await _finalize_scan_job(
            lease=_lease(owner="worker-a", replace_existing=True),
            state=state,
            error=SCAN_FAILURE_MESSAGE if state == "failed" else None,
            completion_reason=completion_reason,
        )

        async with sessions() as session:
            messages = list(
                await session.scalars(select(Message).order_by(Message.telegram_id))
            )
            assert [message.telegram_id for message in messages] == [1, 2]
            assert all(
                message.last_seen_replacement_job_id is None for message in messages
            )


@pytest.mark.asyncio
async def test_interrupted_replacement_keeps_markers_for_safe_resume(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            category = Category(
                user_id="user-a",
                name="Other",
                normalized_name="other",
                slug="other",
                system_key="other",
                icon="archive",
                color="#64748B",
                position=1,
                is_default=True,
            )
            session.add(category)
            await session.flush()
            session.add_all(
                [
                    Message(
                        user_id="user-a",
                        telegram_id=1,
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        content="already scanned",
                        date=datetime.now(tz=UTC),
                        category_id=category.id,
                        raw_data={},
                        last_seen_replacement_job_id="job-a",
                    ),
                    ScanJob(
                        id="job-a",
                        user_id="user-a",
                        state="running",
                        replace_existing=True,
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        lease_owner="worker-a",
                        lease_expires_at=_future_lease(),
                    ),
                ]
            )
            await session.commit()

        assert await _release_interrupted_scan(
            lease=_lease(owner="worker-a", replace_existing=True)
        )

        async with sessions() as session:
            job = await session.get(ScanJob, "job-a")
            message = await session.scalar(select(Message))
            assert job is not None and job.state == "pending"
            assert message is not None
            assert message.last_seen_replacement_job_id == "job-a"


@pytest.mark.asyncio
async def test_incremental_scan_refreshes_source_metadata_but_preserves_organization(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with _scan_database(tmp_path=tmp_path, monkeypatch=monkeypatch) as sessions:
        await _seed_user(sessions)
        async with sessions() as session:
            organized = Category(
                user_id="user-a",
                name="My folder",
                normalized_name="my folder",
                slug="my-folder",
                icon="folder",
                color="#123456",
                position=1,
                is_default=False,
            )
            fallback = Category(
                user_id="user-a",
                name="Other",
                normalized_name="other",
                slug="other",
                system_key="other",
                icon="archive",
                color="#64748B",
                position=2,
                is_default=True,
            )
            tag = Tag(
                user_id="user-a",
                name="Keep me",
                normalized_name="keep me",
                color=None,
            )
            session.add_all([organized, fallback, tag])
            await session.flush()
            message = Message(
                user_id="user-a",
                telegram_id=1,
                telegram_user_id=TELEGRAM_USER_ID,
                connection_generation=1,
                content="stale",
                media_type="document",
                file_name="old.txt",
                file_size=1,
                mime_type="text/plain",
                url=None,
                sender_name="Old sender",
                date=datetime.now(tz=UTC) - timedelta(days=1),
                category_id=organized.id,
                raw_data={"stale": True},
            )
            session.add(message)
            await session.flush()
            session.add_all(
                [
                    MessageTag(
                        user_id="user-a",
                        message_id=message.id,
                        tag_id=tag.id,
                    ),
                    TelegramConnection(
                        user_id="user-a",
                        state="connected",
                        telegram_user_id=TELEGRAM_USER_ID,
                        generation=CONNECTION_GENERATION,
                        session_encrypted="session",
                    ),
                    ScanJob(
                        id="job-a",
                        user_id="user-a",
                        state="running",
                        replace_existing=False,
                        telegram_user_id=TELEGRAM_USER_ID,
                        connection_generation=CONNECTION_GENERATION,
                        lease_owner="worker-a",
                        lease_expires_at=_future_lease(),
                    ),
                ]
            )
            await session.commit()

        refreshed_at = datetime.now(tz=UTC)
        await _persist_scan_page(
            lease=_lease(owner="worker-a"),
            page=ScanPage(
                messages=(
                    ScannedMessage(
                        telegram_id=1,
                        content="fresh",
                        media_type="photo",
                        file_name="new.jpg",
                        file_size=42,
                        mime_type="image/jpeg",
                        url="https://example.com/new",
                        sender_name="New sender",
                        date=refreshed_at,
                        raw_data={"fresh": True},
                        cached_media=b"jpeg-preview",
                        cached_media_mime_type="image/jpeg",
                    ),
                ),
                has_more=False,
                next_offset_id=1,
            ),
        )

        async with sessions() as session:
            refreshed = await session.scalar(
                select(Message).options(undefer(Message.cached_media))
            )
            assignments = list(await session.scalars(select(MessageTag)))
            assert refreshed is not None
            assert refreshed.content == "fresh"
            assert refreshed.media_type == "photo"
            assert refreshed.file_name == "new.jpg"
            assert refreshed.file_size == 42
            assert refreshed.mime_type == "image/jpeg"
            assert refreshed.cached_media == b"jpeg-preview"
            assert refreshed.cached_media_mime_type == "image/jpeg"
            assert refreshed.media_url == f"/api/messages/{refreshed.id}/media"
            assert refreshed.url == "https://example.com/new"
            assert refreshed.sender_name == "New sender"
            assert refreshed.raw_data == {"fresh": True}
            assert refreshed.connection_generation == CONNECTION_GENERATION
            assert refreshed.category_id == organized.id
            assert refreshed.last_seen_replacement_job_id is None
            assert len(assignments) == 1
            assert assignments[0].message_id == refreshed.id
