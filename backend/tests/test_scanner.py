from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.telegram.scanner import (
    MESSAGE_LIMIT_REACHED,
    SLICE_PAGE_LIMIT,
    SLICE_TIME_LIMIT,
    ScanAlreadyRunningError,
    ScanPage,
    SavedMessagesScanner,
)


@dataclass(slots=True)
class _FakeDocumentAttribute:
    file_name: str


@dataclass(slots=True)
class _FakeDocument:
    mime_type: str | None
    size: int | str | bool | None
    attributes: list[_FakeDocumentAttribute] | None


@dataclass(slots=True)
class _FakeFwdFrom:
    from_name: str


@dataclass(slots=True)
class _FakeSender:
    first_name: str | None = None
    last_name: str | None = None
    username: str | None = None


@dataclass(slots=True)
class _FakeMessage:
    id: int | str | None
    date: datetime | str | None
    message: str | None = None
    text: str | None = None
    photo: bool = False
    video: bool = False
    audio: bool = False
    voice: bool = False
    document: _FakeDocument | None = None
    fwd_from: _FakeFwdFrom | None = None
    sender: _FakeSender | None = None
    to_dict_payload: Any | None = None

    def to_dict(self) -> Any:
        if self.to_dict_payload is not None:
            return self.to_dict_payload
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


class _FakeMediaClient(_FakeTelegramClient):
    def __init__(
        self,
        pages_by_offset: dict[int, list[_FakeMessage]],
        *,
        media_content: bytes,
    ) -> None:
        super().__init__(pages_by_offset)
        self.media_content = media_content
        self.download_calls: list[tuple[Any, Any]] = []

    async def download_media(
        self,
        message: Any,
        file: Any,
        **kwargs: Any,
    ) -> bytes:
        self.download_calls.append((message, kwargs.get("thumb")))
        assert file is bytes
        return self.media_content


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
            4: [
                _FakeMessage(id=3, date=now, photo=True),
                _FakeMessage(id=2, date=now, audio=True),
            ],
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
async def test_scanner_caches_a_bounded_photo_preview() -> None:
    now = datetime.now(tz=UTC)
    thumbnail = SimpleNamespace(w=1280, h=720, size=10)
    message = _FakeMessage(id=1, date=now)
    message.photo = SimpleNamespace(sizes=[thumbnail])  # type: ignore[assignment]
    client = _FakeMediaClient(
        pages_by_offset={0: [message]},
        media_content=b"jpeg-preview",
    )
    seen: list[ScanPage] = []

    async def on_page(page: ScanPage) -> None:
        seen.append(page)

    await SavedMessagesScanner().scan(
        client=client,
        page_size=2,
        on_page=on_page,
        media_cache_max_bytes=1024,
    )

    scanned = seen[0].messages[0]
    assert scanned.cached_media == b"jpeg-preview"
    assert scanned.cached_media_mime_type == "image/jpeg"
    assert client.download_calls == [(message, thumbnail)]


@pytest.mark.asyncio
async def test_preview_deadline_does_not_advance_past_uncached_messages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _DeadlineMediaClient(_FakeTelegramClient):
        async def download_media(
            self,
            message: Any,
            file: Any,
            **kwargs: Any,
        ) -> bytes:
            assert file is bytes
            if message.id == 2:
                return b"first-preview"
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

    monkeypatch.setattr(
        "app.telegram.scanner.MEDIA_PERSISTENCE_RESERVE_SECONDS",
        0,
    )
    now = datetime.now(tz=UTC)
    thumbnail = SimpleNamespace(w=320, h=240, size=10)
    first = _FakeMessage(id=2, date=now)
    first.photo = SimpleNamespace(sizes=[thumbnail])  # type: ignore[assignment]
    timed_out = _FakeMessage(id=1, date=now)
    timed_out.photo = SimpleNamespace(sizes=[thumbnail])  # type: ignore[assignment]
    client = _DeadlineMediaClient({0: [first, timed_out]})
    seen: list[ScanPage] = []

    async def on_page(page: ScanPage) -> None:
        seen.append(page)

    progress = await SavedMessagesScanner().scan(
        client=client,
        page_size=2,
        max_messages=10,
        timeout_seconds=0.05,
        media_cache_max_bytes=1024,
        on_page=on_page,
    )

    assert progress.completion_reason == SLICE_TIME_LIMIT
    assert progress.messages_scanned == 1
    assert progress.last_message_id == 2
    assert [message.telegram_id for message in seen[0].messages] == [2]
    assert seen[0].messages[0].cached_media == b"first-preview"


@pytest.mark.asyncio
async def test_scanner_discards_a_download_that_exceeds_the_cache_limit() -> None:
    now = datetime.now(tz=UTC)
    message = _FakeMessage(id=1, date=now, photo=True)
    client = _FakeMediaClient(
        pages_by_offset={0: [message]},
        media_content=b"too-large",
    )
    seen: list[ScanPage] = []

    async def on_page(page: ScanPage) -> None:
        seen.append(page)

    await SavedMessagesScanner().scan(
        client=client,
        page_size=2,
        on_page=on_page,
        media_cache_max_bytes=4,
    )

    assert seen[0].messages[0].cached_media is None
    assert seen[0].messages[0].cached_media_mime_type is None


@pytest.mark.asyncio
async def test_scanner_uses_jpeg_type_for_a_large_image_document_thumbnail() -> None:
    now = datetime.now(tz=UTC)
    thumbnail = SimpleNamespace(w=640, h=480, size=100)
    document = SimpleNamespace(
        mime_type="image/png",
        size=4096,
        attributes=[],
        thumbs=[thumbnail],
    )
    message = _FakeMessage(id=1, date=now)
    message.document = document  # type: ignore[assignment]
    client = _FakeMediaClient(
        pages_by_offset={0: [message]},
        media_content=b"jpeg-thumbnail",
    )
    seen: list[ScanPage] = []

    async def on_page(page: ScanPage) -> None:
        seen.append(page)

    await SavedMessagesScanner().scan(
        client=client,
        page_size=2,
        on_page=on_page,
        media_cache_max_bytes=1024,
    )

    assert seen[0].messages[0].cached_media == b"jpeg-thumbnail"
    assert seen[0].messages[0].cached_media_mime_type == "image/jpeg"
    assert client.download_calls == [(message, thumbnail)]


@pytest.mark.asyncio
async def test_scanner_resumes_cursor_and_yields_after_bounded_page_slice() -> None:
    now = datetime.now(tz=UTC)
    client = _FakeTelegramClient(
        pages_by_offset={
            99: [
                _FakeMessage(id=5, date=now),
                _FakeMessage(id=4, date=now),
                _FakeMessage(id=3, date=now),
            ],
            4: [
                _FakeMessage(id=3, date=now),
                _FakeMessage(id=2, date=now),
                _FakeMessage(id=1, date=now),
            ],
        }
    )
    seen: list[ScanPage] = []

    async def on_page(page: ScanPage) -> None:
        seen.append(page)

    first = await SavedMessagesScanner().scan(
        client=client,
        page_size=2,
        start_offset_id=99,
        max_messages=10,
        max_pages=1,
        on_page=on_page,
    )

    assert first.is_complete is False
    assert first.completion_reason == SLICE_PAGE_LIMIT
    assert first.last_message_id == 4
    assert [message.telegram_id for message in seen[0].messages] == [5, 4]
    assert client.calls == [("me", 3, 99)]

    second = await SavedMessagesScanner().scan(
        client=client,
        page_size=2,
        start_offset_id=first.last_message_id,
        max_messages=10,
        max_pages=1,
    )
    assert second.last_message_id == 2
    assert client.calls[-1] == ("me", 3, 4)


@pytest.mark.asyncio
async def test_scanner_enforces_exact_message_quota_with_lookahead() -> None:
    now = datetime.now(tz=UTC)
    client = _FakeTelegramClient(
        pages_by_offset={
            0: [
                _FakeMessage(id=3, date=now),
                _FakeMessage(id=2, date=now),
                _FakeMessage(id=1, date=now),
            ]
        }
    )
    seen: list[ScanPage] = []

    async def on_page(page: ScanPage) -> None:
        seen.append(page)

    progress = await SavedMessagesScanner().scan(
        client=client,
        page_size=10,
        max_messages=2,
        on_page=on_page,
    )

    assert progress.is_complete is True
    assert progress.completion_reason == MESSAGE_LIMIT_REACHED
    assert progress.messages_scanned == 2
    assert [message.telegram_id for message in seen[0].messages] == [3, 2]
    assert seen[0].has_more is True


@pytest.mark.asyncio
async def test_scanner_time_slice_cancels_a_long_page_fetch() -> None:
    class _SlowClient:
        def iter_messages(self, *_: object, **__: object):
            async def messages():
                await asyncio.Event().wait()
                yield None

            return messages()

    progress = await SavedMessagesScanner().scan(
        client=_SlowClient(),
        page_size=10,
        max_messages=100,
        timeout_seconds=0.01,
    )

    assert progress.is_complete is False
    assert progress.completion_reason == SLICE_TIME_LIMIT
    assert progress.messages_scanned == 0


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

    first_scan_task = asyncio.create_task(
        scanner.scan(client=client, page_size=2, on_page=on_page)
    )
    await asyncio.wait_for(page_started.wait(), timeout=1.0)

    with pytest.raises(ScanAlreadyRunningError):
        await scanner.scan(client=client, page_size=2)

    unblock.set()
    await first_scan_task


@pytest.mark.asyncio
async def test_scanner_rejects_non_positive_page_size() -> None:
    scanner = SavedMessagesScanner()
    client = _FakeTelegramClient(pages_by_offset={})

    with pytest.raises(ValueError, match="page_size must be a positive integer."):
        await scanner.scan(client=client, page_size=0)


@pytest.mark.asyncio
async def test_scanner_records_failure_when_page_callback_raises() -> None:
    scanner = SavedMessagesScanner()
    now = datetime.now(tz=UTC)
    client = _FakeTelegramClient(pages_by_offset={0: [_FakeMessage(id=1, date=now)]})

    async def on_page(_: ScanPage) -> None:
        raise RuntimeError("callback failed")

    with pytest.raises(RuntimeError, match="callback failed"):
        await scanner.scan(client=client, page_size=1, on_page=on_page)

    progress = await scanner.get_progress()
    assert progress.is_running is False
    assert progress.is_complete is False
    assert progress.messages_scanned == 0
    assert progress.pages_scanned == 0
    assert progress.error == "callback failed"
    assert progress.started_at is not None
    assert progress.finished_at is not None
    assert progress.finished_at >= progress.started_at


@pytest.mark.asyncio
async def test_scanner_stops_when_offset_id_does_not_advance() -> None:
    scanner = SavedMessagesScanner()
    now = datetime.now(tz=UTC)
    client = _FakeTelegramClient(
        pages_by_offset={
            0: [_FakeMessage(id=1, date=now), _FakeMessage(id=0, date=now)],
        }
    )

    progress = await scanner.scan(client=client, page_size=2)

    assert progress.is_complete is True
    assert progress.messages_scanned == 2
    assert progress.pages_scanned == 1
    assert progress.last_message_id == 0
    assert client.calls == [("me", 2, 0)]


def test_scanner_normalizes_voice_messages_with_text_sender_and_minimal_raw_data() -> (
    None
):
    scanner = SavedMessagesScanner()
    naive_date = datetime(2026, 1, 1, 12, 0, 0)
    normalized = scanner._normalize_message(
        _FakeMessage(
            id="42",
            date=naive_date,
            text="  use text field  ",
            voice=True,
            sender=_FakeSender(first_name=" ", username="  bot_name  "),
            to_dict_payload=["not-a-dict"],
        )
    )

    assert normalized.telegram_id == 42
    assert normalized.content == "use text field"
    assert normalized.media_type == "voice"
    assert normalized.sender_name == "bot_name"
    assert normalized.url is None
    assert normalized.date.tzinfo == UTC
    assert normalized.raw_data == {"id": 42}


def test_scanner_normalizes_document_sender_name_and_date_fallbacks() -> None:
    scanner = SavedMessagesScanner()
    normalized = scanner._normalize_message(
        _FakeMessage(
            id=7,
            date="not-a-datetime",
            text="  ",
            document=_FakeDocument(
                mime_type=None,
                size=True,
                attributes=[
                    _FakeDocumentAttribute(file_name=""),
                    _FakeDocumentAttribute(file_name=""),
                ],
            ),
            sender=_FakeSender(first_name="Jane", last_name="Doe", username="jane"),
        )
    )

    assert normalized.media_type == "document"
    assert normalized.content is None
    assert normalized.file_name is None
    assert normalized.file_size is None
    assert normalized.mime_type is None
    assert normalized.sender_name == "Jane Doe"
    assert normalized.date.tzinfo == UTC


def test_scanner_bounds_database_fields_without_changing_message_content() -> None:
    scanner = SavedMessagesScanner()
    long_url = f"https://example.com/{'x' * 2_100}"
    content = f"Keep the complete note {long_url}"
    normalized = scanner._normalize_message(
        _FakeMessage(
            id=7,
            date=datetime.now(tz=UTC),
            message=content,
            document=_FakeDocument(
                mime_type="x" * 150,
                size=2**63,
                attributes=[_FakeDocumentAttribute(file_name="f" * 300)],
            ),
            fwd_from=_FakeFwdFrom(from_name="Sender " * 60),
        )
    )

    assert normalized.content == content
    assert normalized.url is None
    assert normalized.file_name == "f" * 255
    assert normalized.mime_type == "x" * 100
    assert normalized.sender_name == ("Sender " * 60).strip()[:255]
    assert normalized.file_size is None


def test_scanner_extract_file_name_returns_none_without_attributes() -> None:
    scanner = SavedMessagesScanner()

    assert scanner._extract_file_name(SimpleNamespace(attributes=[])) is None
    assert scanner._extract_file_name(SimpleNamespace(attributes=None)) is None


def test_scanner_minimum_message_id_ignores_invalid_values() -> None:
    scanner = SavedMessagesScanner()
    raw_page = [
        SimpleNamespace(id=True),
        SimpleNamespace(id=None),
        SimpleNamespace(id="not-an-int"),
    ]

    assert scanner._minimum_message_id(raw_page) is None


def test_scanner_rejects_messages_without_valid_ids() -> None:
    scanner = SavedMessagesScanner()
    raw_message = SimpleNamespace(id=None, message="content", date=datetime.now(tz=UTC))

    with pytest.raises(ValueError, match="without an id"):
        scanner._normalize_message(raw_message)


@pytest.mark.parametrize("telegram_id", [-(2**63) - 1, 2**63, True])
def test_scanner_rejects_ids_outside_database_range(telegram_id: int) -> None:
    scanner = SavedMessagesScanner()
    raw_message = SimpleNamespace(
        id=telegram_id,
        message="content",
        date=datetime.now(tz=UTC),
    )

    with pytest.raises(ValueError, match="without an id"):
        scanner._normalize_message(raw_message)


@pytest.mark.parametrize(
    ("content", "expected_url"),
    [
        ("Read https://example.com/article.", "https://example.com/article"),
        ("Watch (https://youtu.be/dQw4w9WgXcQ).", "https://youtu.be/dQw4w9WgXcQ"),
        ("Docs https://example.com/guide_(draft)", "https://example.com/guide_(draft)"),
        (
            "Repository www.github.com/openai/codex",
            "https://www.github.com/openai/codex",
        ),
    ],
)
def test_scanner_trims_sentence_punctuation_from_urls(
    content: str, expected_url: str
) -> None:
    scanner = SavedMessagesScanner()

    assert scanner._extract_url(content) == expected_url
