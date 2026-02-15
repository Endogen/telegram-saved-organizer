"""API routes for Saved Messages scan lifecycle."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.telegram.scanner import ScanAlreadyRunningError
from app.telegram.schemas import ScanStatusResponse
from app.telegram.service import TelegramClientNotConnectedError, TelegramScanService

router = APIRouter(prefix="/scan", tags=["scan"])
scan_service = TelegramScanService()
STREAM_POLL_INTERVAL_SECONDS = 0.5
STREAM_KEEPALIVE_SECONDS = 15.0


async def get_scan_service() -> TelegramScanService:
    """Dependency provider for the scan service."""

    return scan_service


@router.post("/start", response_model=ScanStatusResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_scan(
    page_size: int = Query(default=100, ge=1, le=1000),
    service: TelegramScanService = Depends(get_scan_service),
) -> ScanStatusResponse:
    try:
        progress = await service.start(page_size=page_size)
    except TelegramClientNotConnectedError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ScanAlreadyRunningError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return ScanStatusResponse.from_progress(progress)


@router.get("/status", response_model=ScanStatusResponse)
async def scan_status(service: TelegramScanService = Depends(get_scan_service)) -> ScanStatusResponse:
    progress = await service.status()
    return ScanStatusResponse.from_progress(progress)


def _format_sse_event(*, event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


@router.get("/stream")
async def scan_status_stream(
    request: Request,
    max_events: int | None = Query(default=None, ge=1, le=500),
    service: TelegramScanService = Depends(get_scan_service),
) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        last_payload: str | None = None
        last_emitted_at = time.monotonic()
        emitted_events = 0

        while True:
            if await request.is_disconnected():
                break

            progress = await service.status()
            payload = ScanStatusResponse.from_progress(progress).model_dump_json()
            now = time.monotonic()

            if payload != last_payload:
                last_payload = payload
                last_emitted_at = now
                yield _format_sse_event(event="status", data=payload)
                emitted_events += 1
                if max_events is not None and emitted_events >= max_events:
                    break
            elif now - last_emitted_at >= STREAM_KEEPALIVE_SECONDS:
                last_emitted_at = now
                yield ": keep-alive\n\n"

            await asyncio.sleep(STREAM_POLL_INTERVAL_SECONDS)

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
async def stop_scan(service: TelegramScanService = Depends(get_scan_service)) -> ScanStatusResponse:
    progress = await service.stop()
    return ScanStatusResponse.from_progress(progress)
