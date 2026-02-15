"""API routes for Saved Messages scan lifecycle."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.telegram.scanner import ScanAlreadyRunningError
from app.telegram.schemas import ScanStatusResponse
from app.telegram.service import TelegramClientNotConnectedError, TelegramScanService

router = APIRouter(prefix="/scan", tags=["scan"])
scan_service = TelegramScanService()


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


@router.post("/stop", response_model=ScanStatusResponse)
async def stop_scan(service: TelegramScanService = Depends(get_scan_service)) -> ScanStatusResponse:
    progress = await service.stop()
    return ScanStatusResponse.from_progress(progress)
