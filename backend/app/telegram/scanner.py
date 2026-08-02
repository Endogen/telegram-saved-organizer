"""Saved Messages scanning with pagination and progress tracking."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable, Protocol

URL_PATTERN = re.compile(r"(?:https?://|www\.)[^\s]+", re.IGNORECASE)
SIMPLE_URL_TRAILING_PUNCTUATION = frozenset(".,!?;:\"'")
URL_CLOSING_PAIRS = {")": "(", "]": "[", "}": "{"}


def _trim_url_punctuation(value: str) -> str:
    normalized = value.strip()
    while normalized:
        final_character = normalized[-1]
        if final_character in SIMPLE_URL_TRAILING_PUNCTUATION:
            normalized = normalized[:-1]
            continue

        opening_character = URL_CLOSING_PAIRS.get(final_character)
        if opening_character is not None and normalized.count(final_character) > normalized.count(opening_character):
            normalized = normalized[:-1]
            continue
        break
    return normalized


class ScanAlreadyRunningError(RuntimeError):
    """Raised when a scan is started while another scan is still running."""


class TelegramScannerClientProtocol(Protocol):
    """Telethon client methods used by the scanner."""

    def iter_messages(
        self,
        entity: str,
        *,
        limit: int,
        offset_id: int = 0,
    ) -> Any: ...


@dataclass(slots=True, frozen=True)
class ScannedMessage:
    """Normalized Saved Message payload produced by the scanner."""

    telegram_id: int
    content: str | None
    media_type: str | None
    file_name: str | None
    file_size: int | None
    mime_type: str | None
    url: str | None
    sender_name: str | None
    date: datetime
    raw_data: dict[str, Any]


@dataclass(slots=True, frozen=True)
class ScanPage:
    """Single scanned page of normalized messages."""

    messages: tuple[ScannedMessage, ...]
    has_more: bool
    next_offset_id: int | None


@dataclass(slots=True, frozen=True)
class ScanProgress:
    """Current scanner progress snapshot."""

    is_running: bool = False
    is_complete: bool = False
    stop_requested: bool = False
    messages_scanned: int = 0
    pages_scanned: int = 0
    page_size: int = 100
    last_message_id: int | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None


OnScanPage = Callable[[ScanPage], Awaitable[None]]


@dataclass(slots=True)
class SavedMessagesScanner:
    """Scans Telegram Saved Messages in pages and tracks scan progress."""

    _progress: ScanProgress = field(default_factory=ScanProgress)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def scan(
        self,
        *,
        client: TelegramScannerClientProtocol,
        page_size: int = 100,
        on_page: OnScanPage | None = None,
    ) -> ScanProgress:
        """Scan Saved Messages using paginated Telethon iteration."""

        if page_size <= 0:
            raise ValueError("page_size must be a positive integer.")

        await self._begin_scan(page_size=page_size)

        previous_offset_id = 0

        try:
            while True:
                if await self._stop_requested():
                    break

                raw_page = await self._fetch_page(
                    client=client,
                    limit=page_size,
                    offset_id=previous_offset_id,
                )
                if not raw_page:
                    break

                page = self._build_page(raw_page=raw_page, page_size=page_size)
                if on_page is not None:
                    await on_page(page)

                await self._record_page(page=page)

                if not page.has_more or page.next_offset_id is None:
                    break
                if page.next_offset_id == previous_offset_id:
                    break
                previous_offset_id = page.next_offset_id

            return await self._finish_scan(error=None)
        except Exception as exc:
            await self._finish_scan(error=str(exc))
            raise

    async def request_stop(self) -> None:
        """Request a graceful stop for the currently running scan."""

        async with self._lock:
            self._progress = replace(self._progress, stop_requested=True)

    async def get_progress(self) -> ScanProgress:
        """Return the latest scanner progress snapshot."""

        async with self._lock:
            return self._progress

    async def _begin_scan(self, *, page_size: int) -> None:
        async with self._lock:
            if self._progress.is_running:
                raise ScanAlreadyRunningError("A scan is already running.")

            self._progress = ScanProgress(
                is_running=True,
                is_complete=False,
                stop_requested=False,
                messages_scanned=0,
                pages_scanned=0,
                page_size=page_size,
                last_message_id=None,
                started_at=datetime.now(tz=UTC),
                finished_at=None,
                error=None,
            )

    async def _record_page(self, *, page: ScanPage) -> None:
        async with self._lock:
            self._progress = replace(
                self._progress,
                messages_scanned=self._progress.messages_scanned + len(page.messages),
                pages_scanned=self._progress.pages_scanned + 1,
                last_message_id=page.next_offset_id,
            )

    async def _finish_scan(self, *, error: str | None) -> ScanProgress:
        async with self._lock:
            self._progress = replace(
                self._progress,
                is_running=False,
                is_complete=error is None and not self._progress.stop_requested,
                finished_at=datetime.now(tz=UTC),
                error=error,
            )
            return self._progress

    async def _stop_requested(self) -> bool:
        async with self._lock:
            return self._progress.stop_requested

    async def _fetch_page(
        self,
        *,
        client: TelegramScannerClientProtocol,
        limit: int,
        offset_id: int,
    ) -> list[Any]:
        page: list[Any] = []
        async for message in client.iter_messages("me", limit=limit, offset_id=offset_id):
            if message is not None:
                page.append(message)
        return page

    def _build_page(self, *, raw_page: list[Any], page_size: int) -> ScanPage:
        messages = tuple(self._normalize_message(raw_message) for raw_message in raw_page)
        next_offset_id = self._minimum_message_id(raw_page)
        has_more = len(raw_page) >= page_size and next_offset_id is not None
        return ScanPage(messages=messages, has_more=has_more, next_offset_id=next_offset_id)

    def _normalize_message(self, raw_message: Any) -> ScannedMessage:
        telegram_id = self._required_telegram_id(raw_message)
        content = self._optional_text(raw_message)
        media_type, file_name, file_size, mime_type = self._extract_media(raw_message)

        return ScannedMessage(
            telegram_id=telegram_id,
            content=content,
            media_type=media_type,
            file_name=file_name,
            file_size=file_size,
            mime_type=mime_type,
            url=self._extract_url(content),
            sender_name=self._extract_sender_name(raw_message),
            date=self._extract_date(raw_message),
            raw_data=self._extract_raw_data(raw_message, telegram_id=telegram_id, content=content),
        )

    def _extract_media(self, raw_message: Any) -> tuple[str | None, str | None, int | None, str | None]:
        if getattr(raw_message, "video", None):
            return ("video", None, None, None)
        if getattr(raw_message, "audio", None):
            return ("audio", None, None, None)
        if getattr(raw_message, "voice", None):
            return ("voice", None, None, None)
        if getattr(raw_message, "photo", None):
            return ("photo", None, None, None)

        document = getattr(raw_message, "document", None)
        if document is not None:
            return (
                "document",
                self._extract_file_name(document),
                self._coerce_int(getattr(document, "size", None)),
                self._coerce_str(getattr(document, "mime_type", None)),
            )
        return (None, None, None, None)

    def _extract_file_name(self, document: Any) -> str | None:
        attributes = getattr(document, "attributes", None)
        if not attributes:
            return None

        for attribute in attributes:
            file_name = getattr(attribute, "file_name", None)
            if file_name:
                return self._coerce_str(file_name)
        return None

    def _extract_sender_name(self, raw_message: Any) -> str | None:
        forwarded_from = getattr(raw_message, "fwd_from", None)
        if forwarded_from is not None:
            forwarded_name = self._coerce_str(getattr(forwarded_from, "from_name", None))
            if forwarded_name:
                return forwarded_name

        sender = getattr(raw_message, "sender", None)
        if sender is None:
            return None

        first_name = self._coerce_str(getattr(sender, "first_name", None))
        last_name = self._coerce_str(getattr(sender, "last_name", None))
        full_name = " ".join(part for part in (first_name, last_name) if part).strip()
        if full_name:
            return full_name

        return self._coerce_str(getattr(sender, "username", None))

    def _extract_raw_data(
        self,
        raw_message: Any,
        *,
        telegram_id: int,
        content: str | None,
    ) -> dict[str, Any]:
        raw_data_factory = getattr(raw_message, "to_dict", None)
        if callable(raw_data_factory):
            raw_data = raw_data_factory()
            if isinstance(raw_data, dict):
                return self._make_json_safe(raw_data)
        return {"id": telegram_id, "message": content}

    @staticmethod
    def _make_json_safe(obj: Any) -> Any:
        """Recursively convert non-JSON-serializable types (datetime, bytes, etc.)."""
        if isinstance(obj, dict):
            return {k: SavedMessagesScanner._make_json_safe(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [SavedMessagesScanner._make_json_safe(v) for v in obj]
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, bytes):
            return obj.hex()
        return obj

    def _extract_url(self, content: str | None) -> str | None:
        if not content:
            return None
        matched = URL_PATTERN.search(content)
        if not matched:
            return None
        extracted_url = _trim_url_punctuation(matched.group(0))
        return f"https://{extracted_url}" if extracted_url.lower().startswith("www.") else extracted_url

    def _extract_date(self, raw_message: Any) -> datetime:
        date_value = getattr(raw_message, "date", None)
        if isinstance(date_value, datetime):
            if date_value.tzinfo is None:
                return date_value.replace(tzinfo=UTC)
            return date_value
        return datetime.now(tz=UTC)

    def _minimum_message_id(self, raw_page: list[Any]) -> int | None:
        message_ids = [self._coerce_int(getattr(message, "id", None)) for message in raw_page]
        valid_message_ids = [message_id for message_id in message_ids if message_id is not None]
        if not valid_message_ids:
            return None
        return min(valid_message_ids)

    def _required_telegram_id(self, raw_message: Any) -> int:
        telegram_id = self._coerce_int(getattr(raw_message, "id", None))
        if telegram_id is None:
            raise ValueError("Encountered a Telegram message without an id.")
        return telegram_id

    def _optional_text(self, raw_message: Any) -> str | None:
        message_text = getattr(raw_message, "message", None)
        if message_text is None:
            message_text = getattr(raw_message, "text", None)
        return self._coerce_str(message_text)

    def _coerce_int(self, value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _coerce_str(self, value: Any) -> str | None:
        if value is None:
            return None
        string_value = str(value).strip()
        if not string_value:
            return None
        return string_value
