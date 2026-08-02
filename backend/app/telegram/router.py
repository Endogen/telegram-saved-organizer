"""Authenticated routes for durable per-user Saved Messages scans."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.dependencies import get_auth_context, get_current_user
from app.accounts.service import AuthContext
from app.config import settings
from app.database import SessionLocal, get_session
from app.models import WebSession
from app.telegram.client import (
    TelegramClientNotConnectedError,
    TelegramClientTimeoutError,
)
from app.telegram.scanner import ScanAlreadyRunningError
from app.telegram.schemas import ScanState, ScanStatusResponse
from app.telegram.service import TelegramScanService, process_scan_queue
from app.telegram.streams import (
    STREAM_HEARTBEAT_SECONDS,
    claim_scan_stream,
    release_scan_stream,
    renew_scan_stream,
)

router = APIRouter(prefix="/scan", tags=["scan"])
STREAM_POLL_INTERVAL_SECONDS = 0.5
STREAM_KEEPALIVE_SECONDS = 15.0
ACTIVE_STREAM_STATES = frozenset(
    (ScanState.PENDING, ScanState.RUNNING, ScanState.STOPPING)
)


def _service(*, session: AsyncSession, user: Any) -> TelegramScanService:
    return TelegramScanService(session=session, user_id=str(user.id))


@router.post(
    "/start", response_model=ScanStatusResponse, status_code=status.HTTP_202_ACCEPTED
)
async def start_scan(
    background_tasks: BackgroundTasks,
    user: Annotated[Any, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    page_size: int = Query(default=100, ge=1, le=1000),
    clear_existing: bool = Query(default=False),
) -> ScanStatusResponse:
    try:
        job = await _service(session=session, user=user).start(
            page_size=page_size,
            clear_existing=clear_existing,
        )
    except TelegramClientNotConnectedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="telegram_not_connected"
        ) from exc
    except TelegramClientTimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="telegram_temporarily_unavailable",
        ) from exc
    except ScanAlreadyRunningError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    if settings.process_scans_in_api:
        background_tasks.add_task(process_scan_queue)
    return ScanStatusResponse.from_job(job)


@router.get("/status", response_model=ScanStatusResponse)
async def scan_status(
    user: Annotated[Any, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ScanStatusResponse:
    job = await _service(session=session, user=user).status()
    return ScanStatusResponse.from_job(job)


def _format_sse_event(*, event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


async def _stream_session_is_active(*, session_id: str, user_id: str) -> bool:
    now = datetime.now(tz=UTC)
    async with SessionLocal() as session:
        record_id = await session.scalar(
            select(WebSession.id).where(
                WebSession.id == session_id,
                WebSession.user_id == user_id,
                WebSession.revoked_at.is_(None),
                WebSession.expires_at > now,
                WebSession.idle_expires_at > now,
            )
        )
    return record_id is not None


@router.get("/stream")
async def scan_status_stream(
    request: Request,
    context: Annotated[AuthContext, Depends(get_auth_context)],
    max_events: int | None = Query(default=None, ge=1, le=500),
) -> StreamingResponse:
    user_id = str(context.user.id)
    session_id = str(context.web_session.id)
    stream_lease = await claim_scan_stream(user_id=user_id)
    if stream_lease is None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="scan_stream_limit_reached",
            headers={"Retry-After": str(STREAM_HEARTBEAT_SECONDS)},
        )

    async def event_stream() -> AsyncIterator[str]:
        last_payload: str | None = None
        last_emitted_at = time.monotonic()
        emitted_events = 0
        next_heartbeat_at = time.monotonic() + STREAM_HEARTBEAT_SECONDS

        try:
            while True:
                if await request.is_disconnected():
                    break
                now = time.monotonic()
                if now >= next_heartbeat_at:
                    if not await _stream_session_is_active(
                        session_id=session_id,
                        user_id=user_id,
                    ):
                        break
                    if not await renew_scan_stream(lease=stream_lease):
                        break
                    next_heartbeat_at = now + STREAM_HEARTBEAT_SECONDS
                async with SessionLocal() as stream_session:
                    job = await TelegramScanService(
                        session=stream_session,
                        user_id=user_id,
                    ).status()
                status_response = ScanStatusResponse.from_job(job)
                payload = status_response.model_dump_json()
                if payload != last_payload:
                    last_payload = payload
                    last_emitted_at = now
                    yield _format_sse_event(event="status", data=payload)
                    emitted_events += 1
                    if max_events is not None and emitted_events >= max_events:
                        break
                    if status_response.state not in ACTIVE_STREAM_STATES:
                        break
                elif now - last_emitted_at >= STREAM_KEEPALIVE_SECONDS:
                    last_emitted_at = now
                    yield ": keep-alive\n\n"
                await asyncio.sleep(STREAM_POLL_INTERVAL_SECONDS)
        finally:
            await release_scan_stream(lease=stream_lease)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/stop", response_model=ScanStatusResponse)
async def stop_scan(
    user: Annotated[Any, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ScanStatusResponse:
    job = await _service(session=session, user=user).stop()
    return ScanStatusResponse.from_job(job)
