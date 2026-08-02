"""Pydantic models for durable per-user scan endpoints."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel

from app.models import ScanJob

SCAN_FAILURE_MESSAGE = "The scan could not be completed. Please try again."


class ScanState(StrEnum):
    IDLE = "idle"
    PENDING = "pending"
    RUNNING = "running"
    STOPPING = "stopping"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ScanCompletionReason(StrEnum):
    SOURCE_EXHAUSTED = "source_exhausted"
    MESSAGE_LIMIT_REACHED = "message_limit_reached"
    RUNTIME_LIMIT_REACHED = "runtime_limit_reached"
    STOPPED_BY_USER = "stopped_by_user"


class ScanStatusResponse(BaseModel):
    """Latest durable scan state for the authenticated user."""

    job_id: str | None = None
    state: ScanState = ScanState.IDLE
    stop_requested: bool = False
    messages_scanned: int = 0
    pages_scanned: int = 0
    page_size: int = 100
    max_messages: int | None = None
    max_runtime_seconds: int | None = None
    last_message_id: int | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    completion_reason: ScanCompletionReason | None = None

    @classmethod
    def from_job(cls, job: ScanJob | None) -> "ScanStatusResponse":
        if job is None:
            return cls()
        return cls(
            job_id=job.id,
            state=ScanState(job.state),
            stop_requested=job.stop_requested,
            messages_scanned=job.messages_scanned,
            pages_scanned=job.pages_scanned,
            page_size=job.page_size,
            max_messages=job.max_messages,
            max_runtime_seconds=job.max_runtime_seconds,
            last_message_id=job.last_message_id,
            started_at=job.started_at,
            finished_at=job.finished_at,
            error=SCAN_FAILURE_MESSAGE if job.state == ScanState.FAILED else None,
            completion_reason=(
                ScanCompletionReason(job.completion_reason)
                if job.completion_reason is not None
                else None
            ),
        )
