from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest

from app.telegram.scanner import ScanAlreadyRunningError, ScanProgress
from app.telegram.service import TelegramClientNotConnectedError, TelegramScanService


class _FakeManager:
    def __init__(self, client: object | None) -> None:
        self._client = client

    def get_connected_client(self) -> object | None:
        return self._client


class _FakeScanner:
    def __init__(self) -> None:
        self.progress = ScanProgress()
        self.scan_calls: list[tuple[object, int]] = []
        self.request_stop_calls = 0
        self.started = asyncio.Event()
        self.unblock = asyncio.Event()

    async def scan(self, *, client: object, page_size: int) -> ScanProgress:
        self.scan_calls.append((client, page_size))
        self.progress = replace(
            self.progress,
            is_running=True,
            is_complete=False,
            page_size=page_size,
        )
        self.started.set()
        await self.unblock.wait()
        self.progress = replace(self.progress, is_running=False, is_complete=True)
        return self.progress

    async def request_stop(self) -> None:
        self.request_stop_calls += 1
        self.progress = replace(self.progress, stop_requested=True)

    async def get_progress(self) -> ScanProgress:
        return self.progress


@pytest.mark.asyncio
async def test_start_requires_connected_client() -> None:
    service = TelegramScanService(manager=_FakeManager(client=None))

    with pytest.raises(TelegramClientNotConnectedError):
        await service.start()


@pytest.mark.asyncio
async def test_start_launches_background_scan() -> None:
    scanner = _FakeScanner()
    client = object()
    service = TelegramScanService(manager=_FakeManager(client=client), scanner=scanner)

    progress = await service.start(page_size=25)

    assert progress.is_running is True
    assert scanner.scan_calls == [(client, 25)]

    scanner.unblock.set()
    await asyncio.wait_for(scanner.started.wait(), timeout=1.0)
    for _ in range(20):
        final_progress = await service.status()
        if final_progress.is_complete:
            break
        await asyncio.sleep(0)

    assert final_progress.is_running is False
    assert final_progress.is_complete is True


@pytest.mark.asyncio
async def test_start_rejects_parallel_runs() -> None:
    scanner = _FakeScanner()
    service = TelegramScanService(manager=_FakeManager(client=object()), scanner=scanner)

    await service.start(page_size=10)
    await asyncio.wait_for(scanner.started.wait(), timeout=1.0)

    with pytest.raises(ScanAlreadyRunningError):
        await service.start(page_size=10)

    scanner.unblock.set()
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_stop_is_noop_when_idle() -> None:
    scanner = _FakeScanner()
    service = TelegramScanService(manager=_FakeManager(client=object()), scanner=scanner)

    progress = await service.stop()

    assert progress.is_running is False
    assert progress.stop_requested is False
    assert scanner.request_stop_calls == 0


@pytest.mark.asyncio
async def test_stop_requests_graceful_stop_for_running_scan() -> None:
    scanner = _FakeScanner()
    service = TelegramScanService(manager=_FakeManager(client=object()), scanner=scanner)

    await service.start(page_size=10)
    await asyncio.wait_for(scanner.started.wait(), timeout=1.0)

    progress = await service.stop()

    assert progress.stop_requested is True
    assert scanner.request_stop_calls == 1

    scanner.unblock.set()
    await asyncio.sleep(0)
