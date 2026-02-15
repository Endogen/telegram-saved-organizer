from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest

from app.telegram.scanner import ScanAlreadyRunningError, ScanPage, SavedMessagesScanner


@dataclass(slots=True)
class _FakeDocumentAttribute:
    file_name: str


@dataclass(slots=True)
class _FakeDocument:
    mime_type: str
    size: int
    attributes: list[_FakeDocumentAttribute]


@dataclass(slots=True)
class _FakeFwdFrom:
    from_name: str


@dataclass(slots=True)
class _FakeMessage:
    id: int
    date: datetime
    message: str | None = None
    photo: bool = False
    video: bool = False
    audio: bool = False
    voice: bool = False
    document: _FakeDocument | None = None
    fwd_from: _FakeFwdFrom | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "message": self.message}


class _FakeTelegramClient:
    def __init__(self, pages_by_offset: dict[int, list[_FakeMessage]]) -> None:
        self._pages_by_offset = pages_by_offset
        self.calls: list[tuple[str, int, int]] = []

    def iter_messages(self, entity: str, *, limit: int, offset_id: int = 0):
        self.calls.append((entity, limit, offset_id))
        page = list(self._pages_by_offset.get(offset_id, []))[:limit]

        async def _iterator():
            for message in page:
                yield message

        return _iterator()


@pytest.mark.asyncio
async def test_scanner_paginates_and_tracks_progress() -> None:
    scanner = SavedMessagesScanner()
    now = datetime.now(tz=UTC)
    client = _FakeTelegramClient(
        pages_by_offset={
            0: [
                _FakeMessage(
                    id=5,
                    date=now,
                    message="Read this https://example.com/article",
                    document=_FakeDocument(
                        mime_type="application/pdf",
                        size=1024,
                        attributes=[_FakeDocumentAttribute(file_name="guide.pdf")],
                    ),
                    fwd_from=_FakeFwdFrom(from_name="Dev Channel"),
                ),
                _FakeMessage(id=4, date=now, video=True),
            ],
            4: [_FakeMessage(id=3, date=now, photo=True), _FakeMessage(id=2, date=now, audio=True)],
            2: [_FakeMessage(id=1, date=now, message="No media")],
        }
    )

    seen_pages: list[ScanPage] = []

    async def on_page(page: ScanPage) -> None:
        seen_pages.append(page)

    progress = await scanner.scan(client=client, page_size=2, on_page=on_page)

    assert progress.is_running is False
    assert progress.is_complete is True
    assert progress.stop_requested is False
    assert progress.messages_scanned == 5
    assert progress.pages_scanned == 3
    assert progress.page_size == 2
    assert progress.last_message_id == 1
    assert progress.error is None
    assert progress.started_at is not None
    assert progress.finished_at is not None
    assert progress.finished_at >= progress.started_at

    first_page_first_message = seen_pages[0].messages[0]
    assert first_page_first_message.telegram_id == 5
    assert first_page_first_message.media_type == "document"
    assert first_page_first_message.file_name == "guide.pdf"
    assert first_page_first_message.file_size == 1024
    assert first_page_first_message.mime_type == "application/pdf"
    assert first_page_first_message.url == "https://example.com/article"
    assert first_page_first_message.sender_name == "Dev Channel"

    assert [message.telegram_id for message in seen_pages[0].messages] == [5, 4]
    assert [message.telegram_id for message in seen_pages[1].messages] == [3, 2]
    assert [message.telegram_id for message in seen_pages[2].messages] == [1]
    assert seen_pages[0].has_more is True
    assert seen_pages[2].has_more is False
    assert client.calls == [("me", 2, 0), ("me", 2, 4), ("me", 2, 2)]


@pytest.mark.asyncio
async def test_scanner_respects_stop_request() -> None:
    scanner = SavedMessagesScanner()
    now = datetime.now(tz=UTC)
    client = _FakeTelegramClient(
        pages_by_offset={
            0: [_FakeMessage(id=5, date=now), _FakeMessage(id=4, date=now)],
            4: [_FakeMessage(id=3, date=now), _FakeMessage(id=2, date=now)],
        }
    )

    async def on_page(_: ScanPage) -> None:
        await scanner.request_stop()

    progress = await scanner.scan(client=client, page_size=2, on_page=on_page)

    assert progress.is_complete is False
    assert progress.stop_requested is True
    assert progress.messages_scanned == 2
    assert progress.pages_scanned == 1
    assert client.calls == [("me", 2, 0)]


@pytest.mark.asyncio
async def test_scanner_rejects_parallel_runs() -> None:
    scanner = SavedMessagesScanner()
    now = datetime.now(tz=UTC)
    unblock = asyncio.Event()
    page_started = asyncio.Event()
    client = _FakeTelegramClient(
        pages_by_offset={
            0: [_FakeMessage(id=5, date=now), _FakeMessage(id=4, date=now)],
        }
    )

    async def on_page(_: ScanPage) -> None:
        page_started.set()
        await unblock.wait()

    first_scan_task = asyncio.create_task(scanner.scan(client=client, page_size=2, on_page=on_page))
    await asyncio.wait_for(page_started.wait(), timeout=1.0)

    with pytest.raises(ScanAlreadyRunningError):
        await scanner.scan(client=client, page_size=2)

    unblock.set()
    await first_scan_task
