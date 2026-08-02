from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks

from app.telegram import router as router_module
from app.telegram.router import _format_sse_event, scan_status, start_scan, stop_scan
from app.telegram.schemas import SCAN_FAILURE_MESSAGE


def _job(*, state: str = "pending") -> SimpleNamespace:
    return SimpleNamespace(
        id="job-a",
        user_id="user-a",
        state=state,
        stop_requested=state == "stopping",
        messages_scanned=4,
        pages_scanned=1,
        page_size=25,
        max_messages=10_000,
        max_runtime_seconds=3_600,
        last_message_id=99,
        started_at=datetime.now(tz=UTC) if state != "pending" else None,
        finished_at=None,
        error=None,
        completion_reason=None,
    )


class _FakeService:
    def __init__(self) -> None:
        self.job = _job()
        self.started_with: int | None = None
        self.clear_existing = False

    async def start(self, *, page_size: int, clear_existing: bool = False):
        self.started_with = page_size
        self.clear_existing = clear_existing
        return self.job

    async def status(self):
        return self.job

    async def stop(self):
        self.job.state = "stopping"
        self.job.stop_requested = True
        return self.job


@pytest.mark.asyncio
async def test_start_scan_returns_persisted_job_and_schedules_processing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeService()
    monkeypatch.setattr(router_module, "_service", lambda **_: service)
    background = BackgroundTasks()

    response = await start_scan(
        background_tasks=background,
        user=SimpleNamespace(id="user-a"),
        session=object(),  # type: ignore[arg-type]
        page_size=25,
        clear_existing=False,
    )

    assert response.job_id == "job-a"
    assert response.state == "pending"
    assert service.started_with == 25
    assert len(background.tasks) == 1


@pytest.mark.asyncio
async def test_start_scan_leaves_processing_to_worker_when_in_api_processing_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeService()
    monkeypatch.setattr(router_module, "_service", lambda **_: service)
    monkeypatch.setattr(
        router_module,
        "settings",
        SimpleNamespace(process_scans_in_api=False),
    )
    background = BackgroundTasks()

    response = await start_scan(
        background_tasks=background,
        user=SimpleNamespace(id="user-a"),
        session=object(),  # type: ignore[arg-type]
        page_size=25,
        clear_existing=False,
    )

    assert response.job_id == "job-a"
    assert background.tasks == []


@pytest.mark.asyncio
async def test_scan_status_and_stop_are_service_backed(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _FakeService()
    monkeypatch.setattr(router_module, "_service", lambda **_: service)
    user = SimpleNamespace(id="user-a")

    current = await scan_status(user=user, session=object())  # type: ignore[arg-type]
    stopped = await stop_scan(user=user, session=object())  # type: ignore[arg-type]

    assert current.job_id == "job-a"
    assert stopped.state == "stopping"
    assert stopped.stop_requested is True


@pytest.mark.asyncio
async def test_failed_scan_status_serializes_only_safe_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sentinel_secret = "telegram-session-secret-should-not-be-serialized"
    service = _FakeService()
    service.job = _job(state="failed")
    service.job.error = sentinel_secret
    service.job.finished_at = datetime.now(tz=UTC)
    monkeypatch.setattr(router_module, "_service", lambda **_: service)

    response = await scan_status(
        user=SimpleNamespace(id="user-a"),
        session=object(),  # type: ignore[arg-type]
    )
    serialized = response.model_dump_json()

    assert response.error == SCAN_FAILURE_MESSAGE
    assert sentinel_secret not in serialized


def test_format_sse_event() -> None:
    assert _format_sse_event(event="status", data='{"state":"running"}') == (
        'event: status\ndata: {"state":"running"}\n\n'
    )
