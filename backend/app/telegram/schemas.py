"""Pydantic models for scan endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.telegram.scanner import ScanProgress


class ScanStatusResponse(BaseModel):
    """Current Saved Messages scan state."""

    is_running: bool
    is_complete: bool
    stop_requested: bool
    messages_scanned: int
    pages_scanned: int
    page_size: int
    last_message_id: int | None
    started_at: datetime | None
    finished_at: datetime | None
    error: str | None

    @classmethod
    def from_progress(cls, progress: ScanProgress) -> "ScanStatusResponse":
        return cls(
            is_running=progress.is_running,
            is_complete=progress.is_complete,
            stop_requested=progress.stop_requested,
            messages_scanned=progress.messages_scanned,
            pages_scanned=progress.pages_scanned,
            page_size=progress.page_size,
            last_message_id=progress.last_message_id,
            started_at=progress.started_at,
            finished_at=progress.finished_at,
            error=progress.error,
        )
