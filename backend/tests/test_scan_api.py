from __future__ import annotations

import json
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.telegram.router import get_scan_service
from app.telegram.scanner import ScanAlreadyRunningError, ScanProgress
from app.telegram.service import TelegramClientNotConnectedError


class _FakeScanService:
    def __init__(self) -> None:
        self.start_calls: list[int] = []
        self.stop_calls = 0
        self.status_calls = 0
        self.status_sequence: list[ScanProgress] = []
        self.start_error: Exception | None = None
        self.start_progress = ScanProgress(is_running=True, page_size=100)
        self.status_progress = ScanProgress(
            is_running=False,
            is_complete=True,
            stop_requested=False,
            messages_scanned=42,
            pages_scanned=3,
            page_size=100,
            last_message_id=123,
        )
        self.stop_progress = ScanProgress(
            is_running=True,
            is_complete=False,
            stop_requested=True,
            messages_scanned=7,
            pages_scanned=1,
            page_size=25,
            last_message_id=55,
        )

    async def start(self, *, page_size: int = 100) -> ScanProgress:
        self.start_calls.append(page_size)
        if self.start_error is not None:
            raise self.start_error
        return self.start_progress

    async def status(self) -> ScanProgress:
        self.status_calls += 1
        if self.status_sequence:
            self.status_progress = self.status_sequence.pop(0)
        return self.status_progress

    async def stop(self) -> ScanProgress:
        self.stop_calls += 1
        return self.stop_progress


@pytest.fixture
def scan_context() -> tuple[Any, _FakeScanService]:
    service = _FakeScanService()
    app = create_app(api_token=None)

    async def override_scan_service() -> _FakeScanService:
        return service

    app.dependency_overrides[get_scan_service] = override_scan_service
    yield app, service
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_start_scan_endpoint_starts_with_custom_page_size(
    scan_context: tuple[Any, _FakeScanService],
) -> None:
    app, service = scan_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/scan/start?page_size=25")

    assert response.status_code == 202
    assert response.json() == {
        "is_running": True,
        "is_complete": False,
        "stop_requested": False,
        "messages_scanned": 0,
        "pages_scanned": 0,
        "page_size": 100,
        "last_message_id": None,
        "started_at": None,
        "finished_at": None,
        "error": None,
    }
    assert service.start_calls == [25]


@pytest.mark.asyncio
async def test_start_scan_endpoint_requires_connected_client(
    scan_context: tuple[Any, _FakeScanService],
) -> None:
    app, service = scan_context
    service.start_error = TelegramClientNotConnectedError("Connect first")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/scan/start")

    assert response.status_code == 400
    assert response.json()["detail"] == "Connect first"


@pytest.mark.asyncio
async def test_start_scan_endpoint_returns_conflict_when_scan_running(
    scan_context: tuple[Any, _FakeScanService],
) -> None:
    app, service = scan_context
    service.start_error = ScanAlreadyRunningError("A scan is already running.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/scan/start")

    assert response.status_code == 409
    assert response.json()["detail"] == "A scan is already running."


@pytest.mark.asyncio
async def test_scan_status_endpoint_returns_progress(
    scan_context: tuple[Any, _FakeScanService],
) -> None:
    app, service = scan_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/scan/status")

    assert response.status_code == 200
    assert response.json() == {
        "is_running": False,
        "is_complete": True,
        "stop_requested": False,
        "messages_scanned": 42,
        "pages_scanned": 3,
        "page_size": 100,
        "last_message_id": 123,
        "started_at": None,
        "finished_at": None,
        "error": None,
    }
    assert service.status_calls == 1


@pytest.mark.asyncio
async def test_stop_scan_endpoint_requests_graceful_stop(
    scan_context: tuple[Any, _FakeScanService],
) -> None:
    app, service = scan_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/scan/stop")

    assert response.status_code == 200
    assert response.json() == {
        "is_running": True,
        "is_complete": False,
        "stop_requested": True,
        "messages_scanned": 7,
        "pages_scanned": 1,
        "page_size": 25,
        "last_message_id": 55,
        "started_at": None,
        "finished_at": None,
        "error": None,
    }
    assert service.stop_calls == 1


@pytest.mark.asyncio
async def test_scan_stream_endpoint_emits_status_updates(
    scan_context: tuple[Any, _FakeScanService],
) -> None:
    app, service = scan_context
    service.status_sequence = [
        ScanProgress(
            is_running=True,
            is_complete=False,
            stop_requested=False,
            messages_scanned=4,
            pages_scanned=1,
            page_size=50,
            last_message_id=999,
        ),
        ScanProgress(
            is_running=False,
            is_complete=True,
            stop_requested=False,
            messages_scanned=9,
            pages_scanned=2,
            page_size=50,
            last_message_id=850,
        ),
    ]

    transport = ASGITransport(app=app)
    events: list[dict[str, Any]] = []
    async with AsyncClient(transport=transport, base_url="http://testserver", timeout=5.0) as client:
        response = await client.get("/api/scan/stream?max_events=2")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    for line in response.text.splitlines():
        if not line.startswith("data: "):
            continue
        events.append(json.loads(line[6:]))

    assert events == [
        {
            "is_running": True,
            "is_complete": False,
            "stop_requested": False,
            "messages_scanned": 4,
            "pages_scanned": 1,
            "page_size": 50,
            "last_message_id": 999,
            "started_at": None,
            "finished_at": None,
            "error": None,
        },
        {
            "is_running": False,
            "is_complete": True,
            "stop_requested": False,
            "messages_scanned": 9,
            "pages_scanned": 2,
            "page_size": 50,
            "last_message_id": 850,
            "started_at": None,
            "finished_at": None,
            "error": None,
        },
    ]
    assert service.status_calls >= 2
