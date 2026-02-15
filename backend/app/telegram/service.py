"""Service layer for scan lifecycle management."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Protocol

from app.telegram.client import telegram_client_manager
from app.telegram.scanner import (
    ScanAlreadyRunningError,
    ScanProgress,
    SavedMessagesScanner,
    TelegramScannerClientProtocol,
)


class TelegramClientNotConnectedError(RuntimeError):
    """Raised when scan endpoints are used before Telegram is connected."""


class TelegramScanManagerProtocol(Protocol):
    """Telegram client manager methods required by scan service."""

    def get_connected_client(self) -> TelegramScannerClientProtocol | None: ...


@dataclass(slots=True)
class TelegramScanService:
    """Runs Saved Messages scans in the background and exposes progress state."""

    manager: TelegramScanManagerProtocol = telegram_client_manager
    scanner: SavedMessagesScanner = field(default_factory=SavedMessagesScanner)
    _task: asyncio.Task[None] | None = field(default=None, init=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False)

    async def start(self, *, page_size: int = 100) -> ScanProgress:
        """Start an asynchronous scan and return the initial progress snapshot."""

        client = self.manager.get_connected_client()
        if client is None:
            raise TelegramClientNotConnectedError(
                "Telegram client is not connected. Connect first before scanning."
            )

        async with self._lock:
            if self._task is not None and not self._task.done():
                raise ScanAlreadyRunningError("A scan is already running.")
            self._task = asyncio.create_task(
                self._run_scan(client=client, page_size=page_size),
            )

        return await self._wait_for_started_state()

    async def stop(self) -> ScanProgress:
        """Request a graceful stop for an in-progress scan."""

        progress = await self.scanner.get_progress()
        if not progress.is_running:
            return progress

        await self.scanner.request_stop()
        return await self.scanner.get_progress()

    async def status(self) -> ScanProgress:
        """Return the latest scan progress snapshot."""

        return await self.scanner.get_progress()

    async def _run_scan(
        self,
        *,
        client: TelegramScannerClientProtocol,
        page_size: int,
    ) -> None:
        try:
            await self.scanner.scan(client=client, page_size=page_size)
        except Exception:
            # Scanner progress stores the latest error state for status polling.
            return
        finally:
            async with self._lock:
                if self._task is asyncio.current_task():
                    self._task = None

    async def _wait_for_started_state(self) -> ScanProgress:
        for _ in range(20):
            progress = await self.scanner.get_progress()
            if progress.is_running or progress.is_complete or progress.error is not None:
                return progress
            await asyncio.sleep(0)
        return await self.scanner.get_progress()
