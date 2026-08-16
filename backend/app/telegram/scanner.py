"""Saved Messages scanning with pagination and progress tracking."""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable, Protocol

URL_PATTERN = re.compile(r"(?:https?://|www\.)[^\s]+", re.IGNORECASE)
SIMPLE_URL_TRAILING_PUNCTUATION = frozenset(".,!?;:\"'")
URL_CLOSING_PAIRS = {")": "(", "]": "[", "}": "{"}
MIN_DB_BIGINT = -(2**63)
MAX_DB_BIGINT = 2**63 - 1
MAX_FILE_NAME_LENGTH = 255
MAX_MIME_TYPE_LENGTH = 100
MAX_SENDER_NAME_LENGTH = 255
MAX_URL_LENGTH = 2048
MEDIA_PERSISTENCE_RESERVE_SECONDS = 2.0
RENDERABLE_IMAGE_MIME_TYPES = frozenset(
    {
        "image/avif",
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
    }
)
PLAYABLE_AUDIO_MIME_TYPES = frozenset(
    {
        "audio/aac",
        "audio/flac",
        "audio/mp4",
        "audio/mp3",
        "audio/mpeg",
        "audio/ogg",
        "audio/wav",
        "audio/webm",
        "audio/x-opus+ogg",
        "audio/x-wav",
    }
)
SOURCE_EXHAUSTED = "source_exhausted"
MESSAGE_LIMIT_REACHED = "message_limit_reached"
RUNTIME_LIMIT_REACHED = "runtime_limit_reached"
STOPPED_BY_USER = "stopped_by_user"
SLICE_PAGE_LIMIT = "slice_page_limit"
SLICE_TIME_LIMIT = "slice_time_limit"
TERMINAL_COMPLETION_REASONS = frozenset((SOURCE_EXHAUSTED, MESSAGE_LIMIT_REACHED))
logger = logging.getLogger(__name__)


def _trim_url_punctuation(value: str) -> str:
    normalized = value.strip()
    while normalized:
        final_character = normalized[-1]
        if final_character in SIMPLE_URL_TRAILING_PUNCTUATION:
            normalized = normalized[:-1]
            continue

        opening_character = URL_CLOSING_PAIRS.get(final_character)
        if opening_character is not None and normalized.count(
            final_character
        ) > normalized.count(opening_character):
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
    cached_media: bytes | None = None
    cached_media_mime_type: str | None = None


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
    completion_reason: str | None = None


OnScanPage = Callable[[ScanPage], Awaitable[None]]
LoadCachedMedia = Callable[[ScanPage], Awaitable[ScanPage]]
ShouldStop = Callable[[], Awaitable[bool]]


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
        should_stop: ShouldStop | None = None,
        start_offset_id: int | None = None,
        max_messages: int | None = None,
        max_pages: int | None = None,
        timeout_seconds: float | None = None,
        media_cache_max_bytes: int | None = None,
        load_cached_media: LoadCachedMedia | None = None,
    ) -> ScanProgress:
        """Scan a resumable, optionally bounded Saved Messages slice."""

        if page_size <= 0:
            raise ValueError("page_size must be a positive integer.")
        if max_messages is not None and max_messages <= 0:
            raise ValueError("max_messages must be a positive integer.")
        if max_pages is not None and max_pages <= 0:
            raise ValueError("max_pages must be a positive integer.")
        if timeout_seconds is not None and timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive.")
        if media_cache_max_bytes is not None and media_cache_max_bytes <= 0:
            raise ValueError("media_cache_max_bytes must be positive.")

        await self._begin_scan(page_size=page_size, start_offset_id=start_offset_id)

        previous_offset_id = start_offset_id or 0
        deadline = (
            asyncio.get_running_loop().time() + timeout_seconds
            if timeout_seconds is not None
            else None
        )
        completion_reason: str | None = None

        try:
            while True:
                if await self._stop_requested() or (
                    should_stop is not None and await should_stop()
                ):
                    async with self._lock:
                        self._progress = replace(self._progress, stop_requested=True)
                    completion_reason = STOPPED_BY_USER
                    break

                progress = await self.get_progress()
                if (
                    max_messages is not None
                    and progress.messages_scanned >= max_messages
                ):
                    completion_reason = MESSAGE_LIMIT_REACHED
                    break
                if max_pages is not None and progress.pages_scanned >= max_pages:
                    completion_reason = SLICE_PAGE_LIMIT
                    break

                page_capacity = page_size
                if max_messages is not None:
                    page_capacity = min(
                        page_capacity,
                        max_messages - progress.messages_scanned,
                    )
                fetch_limit = (
                    page_capacity + 1 if max_messages is not None else page_capacity
                )

                try:
                    if deadline is None:
                        raw_page = await self._fetch_page(
                            client=client,
                            limit=fetch_limit,
                            offset_id=previous_offset_id,
                        )
                    else:
                        remaining_seconds = deadline - asyncio.get_running_loop().time()
                        if remaining_seconds <= 0:
                            completion_reason = SLICE_TIME_LIMIT
                            break
                        async with asyncio.timeout(remaining_seconds):
                            raw_page = await self._fetch_page(
                                client=client,
                                limit=fetch_limit,
                                offset_id=previous_offset_id,
                            )
                except TimeoutError:
                    completion_reason = SLICE_TIME_LIMIT
                    break
                if not raw_page:
                    completion_reason = SOURCE_EXHAUSTED
                    break

                has_more = (
                    len(raw_page) > page_capacity
                    if max_messages is not None
                    else len(raw_page) >= page_capacity
                )
                page = self._build_page(
                    raw_page=raw_page[:page_capacity],
                    page_size=page_capacity,
                    has_more=has_more,
                )
                if load_cached_media is not None:
                    try:
                        if deadline is None:
                            page = await load_cached_media(page)
                        else:
                            remaining_seconds = (
                                deadline - asyncio.get_running_loop().time()
                            )
                            if remaining_seconds <= 0:
                                completion_reason = SLICE_TIME_LIMIT
                                break
                            async with asyncio.timeout(remaining_seconds):
                                page = await load_cached_media(page)
                    except TimeoutError:
                        completion_reason = SLICE_TIME_LIMIT
                        break
                preview_deadline_reached = False
                if media_cache_max_bytes is not None:
                    page, preview_deadline_reached = await self._cache_media_previews(
                        client=client,
                        raw_page=raw_page[:page_capacity],
                        page=page,
                        max_bytes=media_cache_max_bytes,
                        deadline=deadline,
                    )
                if page.messages:
                    if on_page is not None:
                        await on_page(page)

                    await self._record_page(page=page)

                if preview_deadline_reached:
                    completion_reason = SLICE_TIME_LIMIT
                    break

                if not page.has_more or page.next_offset_id is None:
                    completion_reason = SOURCE_EXHAUSTED
                    break
                if page.next_offset_id == previous_offset_id:
                    completion_reason = SOURCE_EXHAUSTED
                    break
                previous_offset_id = page.next_offset_id

            return await self._finish_scan(
                error=None,
                completion_reason=completion_reason or SOURCE_EXHAUSTED,
            )
        except Exception as exc:
            await self._finish_scan(error=str(exc), completion_reason=None)
            raise

    async def request_stop(self) -> None:
        """Request a graceful stop for the currently running scan."""

        async with self._lock:
            self._progress = replace(self._progress, stop_requested=True)

    async def get_progress(self) -> ScanProgress:
        """Return the latest scanner progress snapshot."""

        async with self._lock:
            return self._progress

    async def _begin_scan(self, *, page_size: int, start_offset_id: int | None) -> None:
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
                last_message_id=start_offset_id,
                started_at=datetime.now(tz=UTC),
                finished_at=None,
                error=None,
                completion_reason=None,
            )

    async def _record_page(self, *, page: ScanPage) -> None:
        async with self._lock:
            self._progress = replace(
                self._progress,
                messages_scanned=self._progress.messages_scanned + len(page.messages),
                pages_scanned=self._progress.pages_scanned + 1,
                last_message_id=page.next_offset_id,
            )

    async def _finish_scan(
        self,
        *,
        error: str | None,
        completion_reason: str | None,
    ) -> ScanProgress:
        async with self._lock:
            self._progress = replace(
                self._progress,
                is_running=False,
                is_complete=(
                    error is None
                    and not self._progress.stop_requested
                    and completion_reason in TERMINAL_COMPLETION_REASONS
                ),
                finished_at=datetime.now(tz=UTC),
                error=error,
                completion_reason=completion_reason,
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
        async for message in client.iter_messages(
            "me", limit=limit, offset_id=offset_id
        ):
            if message is not None:
                page.append(message)
        return page

    def _build_page(
        self,
        *,
        raw_page: list[Any],
        page_size: int,
        has_more: bool | None = None,
    ) -> ScanPage:
        messages = tuple(
            self._normalize_message(raw_message) for raw_message in raw_page
        )
        next_offset_id = self._minimum_message_id(raw_page)
        page_has_more = (
            len(raw_page) >= page_size and next_offset_id is not None
            if has_more is None
            else has_more and next_offset_id is not None
        )
        return ScanPage(
            messages=messages,
            has_more=page_has_more,
            next_offset_id=next_offset_id,
        )

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
            raw_data=self._extract_raw_data(telegram_id=telegram_id),
        )

    async def _cache_media_previews(
        self,
        *,
        client: TelegramScannerClientProtocol,
        raw_page: list[Any],
        page: ScanPage,
        max_bytes: int,
        deadline: float | None,
    ) -> tuple[ScanPage, bool]:
        download_media = getattr(client, "download_media", None)
        if not callable(download_media):
            return (page, False)

        def deadline_page() -> ScanPage:
            processed_messages = tuple(enriched_messages)
            return replace(
                page,
                messages=processed_messages,
                has_more=True,
                next_offset_id=(
                    min(message.telegram_id for message in processed_messages)
                    if processed_messages
                    else None
                ),
            )

        enriched_messages: list[ScannedMessage] = []
        for raw_message, scanned in zip(raw_page, page.messages, strict=True):
            if scanned.cached_media is not None:
                enriched_messages.append(scanned)
                continue
            download_plan = self._preview_download_plan(
                raw_message=raw_message,
                scanned=scanned,
                max_bytes=max_bytes,
            )
            if download_plan is None:
                enriched_messages.append(scanned)
                continue
            download_kwargs, cached_mime_type = download_plan

            try:
                if deadline is None:
                    content = await download_media(
                        raw_message, bytes, **download_kwargs
                    )
                else:
                    remaining_seconds = (
                        deadline
                        - asyncio.get_running_loop().time()
                        - MEDIA_PERSISTENCE_RESERVE_SECONDS
                    )
                    if remaining_seconds <= 0:
                        return (deadline_page(), True)
                    async with asyncio.timeout(remaining_seconds):
                        content = await download_media(
                            raw_message, bytes, **download_kwargs
                        )
            except TimeoutError:
                return (deadline_page(), True)
            except Exception:
                logger.info(
                    "Unable to cache Telegram image preview for message %s",
                    scanned.telegram_id,
                    exc_info=True,
                )
                enriched_messages.append(scanned)
                continue

            if (
                not isinstance(content, bytes)
                or not content
                or len(content) > max_bytes
            ):
                enriched_messages.append(scanned)
                continue
            enriched_messages.append(
                replace(
                    scanned,
                    cached_media=content,
                    cached_media_mime_type=cached_mime_type,
                )
            )

        return (replace(page, messages=tuple(enriched_messages)), False)

    def _renderable_image_mime_type(self, scanned: ScannedMessage) -> str | None:
        if scanned.media_type == "photo":
            return "image/jpeg"
        normalized_mime_type = (scanned.mime_type or "").strip().lower()
        return (
            normalized_mime_type
            if normalized_mime_type in RENDERABLE_IMAGE_MIME_TYPES
            else None
        )

    def _preview_download_plan(
        self,
        *,
        raw_message: Any,
        scanned: ScannedMessage,
        max_bytes: int,
    ) -> tuple[dict[str, Any], str] | None:
        normalized_mime_type = (scanned.mime_type or "").strip().lower()
        if scanned.media_type in {"audio", "voice"} or normalized_mime_type.startswith(
            "audio/"
        ):
            if (
                normalized_mime_type in PLAYABLE_AUDIO_MIME_TYPES
                and scanned.file_size is not None
                and scanned.file_size <= max_bytes
            ):
                return ({}, normalized_mime_type)
            return None

        mime_type = self._renderable_image_mime_type(scanned)
        if mime_type is None:
            return None
        if scanned.media_type == "photo":
            thumbnail = self._largest_bounded_thumbnail(
                getattr(getattr(raw_message, "photo", None), "sizes", None),
                max_bytes=max_bytes,
            )
            kwargs = (
                {"thumb": self._telegram_thumbnail_selector(thumbnail)}
                if thumbnail is not None
                else {}
            )
            return (kwargs, "image/jpeg")

        if scanned.file_size is None or scanned.file_size <= max_bytes:
            return ({}, mime_type)

        thumbnail = self._largest_bounded_thumbnail(
            getattr(getattr(raw_message, "document", None), "thumbs", None),
            max_bytes=max_bytes,
        )
        return (
            (
                {"thumb": self._telegram_thumbnail_selector(thumbnail)},
                "image/jpeg",
            )
            if thumbnail is not None
            else None
        )

    def _telegram_thumbnail_selector(self, thumbnail: Any) -> Any:
        thumbnail_type = getattr(thumbnail, "type", None)
        return (
            thumbnail_type
            if isinstance(thumbnail_type, str) and thumbnail_type
            else thumbnail
        )

    def _largest_bounded_thumbnail(
        self,
        sizes: Any,
        *,
        max_bytes: int,
    ) -> Any | None:
        if not isinstance(sizes, (list, tuple)):
            return None

        candidates: list[tuple[int, int, Any]] = []
        for size in sizes:
            if "video" in type(size).__name__.lower():
                continue
            estimated_size = self._telegram_media_size(size)
            if estimated_size is not None and estimated_size > max_bytes:
                continue
            width = self._coerce_non_negative_int(getattr(size, "w", None)) or 0
            height = self._coerce_non_negative_int(getattr(size, "h", None)) or 0
            candidates.append((width * height, estimated_size or 0, size))

        return (
            max(candidates, key=lambda candidate: candidate[:2])[2]
            if candidates
            else None
        )

    def _telegram_media_size(self, size: Any) -> int | None:
        direct_size = self._coerce_non_negative_int(getattr(size, "size", None))
        if direct_size is not None:
            return direct_size
        progressive_sizes = getattr(size, "sizes", None)
        if not isinstance(progressive_sizes, (list, tuple)):
            return None
        normalized_sizes = [
            value
            for candidate in progressive_sizes
            if (value := self._coerce_non_negative_int(candidate)) is not None
        ]
        return max(normalized_sizes) if normalized_sizes else None

    def _extract_media(
        self, raw_message: Any
    ) -> tuple[str | None, str | None, int | None, str | None]:
        document = getattr(raw_message, "document", None)
        if getattr(raw_message, "video", None):
            return ("video", None, None, None)
        if getattr(raw_message, "audio", None):
            return self._extract_document_metadata("audio", document)
        if getattr(raw_message, "voice", None):
            return self._extract_document_metadata("voice", document)
        if getattr(raw_message, "photo", None):
            return ("photo", None, None, None)

        if document is not None:
            return self._extract_document_metadata("document", document)
        return (None, None, None, None)

    def _extract_document_metadata(
        self,
        media_type: str,
        document: Any,
    ) -> tuple[str, str | None, int | None, str | None]:
        if document is None:
            return (media_type, None, None, None)
        return (
            media_type,
            self._extract_file_name(document),
            self._coerce_db_bigint(getattr(document, "size", None), minimum=0),
            self._coerce_str(
                getattr(document, "mime_type", None),
                max_length=MAX_MIME_TYPE_LENGTH,
            ),
        )

    def _extract_file_name(self, document: Any) -> str | None:
        attributes = getattr(document, "attributes", None)
        if not attributes:
            return None

        for attribute in attributes:
            file_name = getattr(attribute, "file_name", None)
            if file_name:
                return self._coerce_str(file_name, max_length=MAX_FILE_NAME_LENGTH)
        return None

    def _extract_sender_name(self, raw_message: Any) -> str | None:
        forwarded_from = getattr(raw_message, "fwd_from", None)
        if forwarded_from is not None:
            forwarded_name = self._coerce_str(
                getattr(forwarded_from, "from_name", None),
                max_length=MAX_SENDER_NAME_LENGTH,
            )
            if forwarded_name:
                return forwarded_name

        sender = getattr(raw_message, "sender", None)
        if sender is None:
            return None

        first_name = self._coerce_str(getattr(sender, "first_name", None))
        last_name = self._coerce_str(getattr(sender, "last_name", None))
        full_name = " ".join(part for part in (first_name, last_name) if part).strip()
        if full_name:
            return full_name[:MAX_SENDER_NAME_LENGTH]

        return self._coerce_str(
            getattr(sender, "username", None),
            max_length=MAX_SENDER_NAME_LENGTH,
        )

    @staticmethod
    def _extract_raw_data(*, telegram_id: int) -> dict[str, Any]:
        """Retain only the non-secret identifier needed for diagnostics.

        Telethon's full ``to_dict`` payload includes access hashes, file
        references, peer metadata, and duplicate message content. Persisting and
        returning that object would expose substantially more Telegram account
        data than the organizer needs.
        """

        return {"id": telegram_id}

    def _extract_url(self, content: str | None) -> str | None:
        if not content:
            return None
        matched = URL_PATTERN.search(content)
        if not matched:
            return None
        extracted_url = _trim_url_punctuation(matched.group(0))
        normalized_url = (
            f"https://{extracted_url}"
            if extracted_url.lower().startswith("www.")
            else extracted_url
        )
        # Do not silently turn a long destination into a different URL. The
        # original text remains available in message content without risking a
        # bounded database column failure.
        return normalized_url if len(normalized_url) <= MAX_URL_LENGTH else None

    def _extract_date(self, raw_message: Any) -> datetime:
        date_value = getattr(raw_message, "date", None)
        if isinstance(date_value, datetime):
            if date_value.tzinfo is None:
                return date_value.replace(tzinfo=UTC)
            return date_value
        return datetime.now(tz=UTC)

    def _minimum_message_id(self, raw_page: list[Any]) -> int | None:
        message_ids = [
            self._coerce_int(getattr(message, "id", None)) for message in raw_page
        ]
        valid_message_ids = [
            message_id for message_id in message_ids if message_id is not None
        ]
        if not valid_message_ids:
            return None
        return min(valid_message_ids)

    def _required_telegram_id(self, raw_message: Any) -> int:
        telegram_id = self._coerce_db_bigint(
            getattr(raw_message, "id", None),
            minimum=MIN_DB_BIGINT,
        )
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

    def _coerce_non_negative_int(self, value: Any) -> int | None:
        integer = self._coerce_int(value)
        return integer if integer is not None and integer >= 0 else None

    def _coerce_db_bigint(self, value: Any, *, minimum: int) -> int | None:
        integer = self._coerce_int(value)
        if integer is None or integer < minimum or integer > MAX_DB_BIGINT:
            return None
        return integer

    def _coerce_str(self, value: Any, *, max_length: int | None = None) -> str | None:
        if value is None:
            return None
        string_value = str(value).strip()
        if not string_value:
            return None
        return string_value if max_length is None else string_value[:max_length]
