"""Service layer for scan lifecycle management."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Protocol

from sqlalchemy import select

from app.database import SessionLocal
from app.models import Category, Message
from app.telegram.categorizer import categorize_scanned_message
from app.telegram.client import telegram_client_manager
from app.telegram.scanner import (
    ScanAlreadyRunningError,
    ScanPage,
    ScanProgress,
    SavedMessagesScanner,
    TelegramScannerClientProtocol,
)

logger = logging.getLogger(__name__)


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
        # Pre-load category slug → id mapping for persistence
        category_map: dict[str, int] = {}
        try:
            async with SessionLocal() as session:
                result = await session.execute(select(Category.slug, Category.id))
                category_map = {row.slug: row.id for row in result}
        except Exception:
            logger.exception("Failed to load category map for scan")

        async def persist_page(page: ScanPage) -> None:
            if not category_map:
                return
            try:
                async with SessionLocal() as session:
                    for scanned in page.messages:
                        # Skip duplicates by telegram_id
                        existing = await session.execute(
                            select(Message.id).where(Message.telegram_id == scanned.telegram_id)
                        )
                        if existing.scalar_one_or_none() is not None:
                            continue

                        slug = categorize_scanned_message(scanned)
                        category_id = category_map.get(slug) or category_map.get("other", 1)

                        session.add(Message(
                            telegram_id=scanned.telegram_id,
                            content=scanned.content,
                            media_type=scanned.media_type,
                            file_name=scanned.file_name,
                            file_size=scanned.file_size,
                            mime_type=scanned.mime_type,
                            url=scanned.url,
                            sender_name=scanned.sender_name,
                            date=scanned.date,
                            category_id=category_id,
                            raw_data=scanned.raw_data,
                        ))
                    await session.commit()
            except Exception:
                logger.exception("Failed to persist scan page")

        try:
            await self.scanner.scan(client=client, page_size=page_size, on_page=persist_page)
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
