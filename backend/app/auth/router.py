"""API routes for Telegram auth flow."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from telethon.errors import RPCError

from app.auth.schemas import AuthStatusResponse, ConnectRequest, VerifyRequest
from app.auth.service import (
    TelegramAuthService,
    TwoFactorPasswordRequiredError,
    VerificationCodeRequiredError,
    VerificationNotStartedError,
)
from app.telegram.client import TelegramClientCredentialsMismatchError

router = APIRouter(prefix="/auth", tags=["auth"])
auth_service = TelegramAuthService()


async def get_auth_service() -> TelegramAuthService:
    """Dependency provider for auth service."""

    return auth_service


@router.post("/connect", response_model=AuthStatusResponse)
async def connect_telegram(
    payload: ConnectRequest,
    service: TelegramAuthService = Depends(get_auth_service),
) -> AuthStatusResponse:
    try:
        auth_status = await service.start_connection(
            api_id=payload.api_id,
            api_hash=payload.api_hash,
            phone=payload.phone,
        )
    except TelegramClientCredentialsMismatchError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RPCError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return AuthStatusResponse.from_status(auth_status)


@router.post("/verify", response_model=AuthStatusResponse)
async def verify_telegram(
    payload: VerifyRequest,
    service: TelegramAuthService = Depends(get_auth_service),
) -> AuthStatusResponse:
    try:
        auth_status = await service.verify(code=payload.code, password=payload.password)
    except VerificationNotStartedError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except VerificationCodeRequiredError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except TwoFactorPasswordRequiredError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except RPCError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return AuthStatusResponse.from_status(auth_status)


@router.get("/status", response_model=AuthStatusResponse)
async def telegram_status(service: TelegramAuthService = Depends(get_auth_service)) -> AuthStatusResponse:
    auth_status = await service.status()
    return AuthStatusResponse.from_status(auth_status)


@router.post("/disconnect", response_model=AuthStatusResponse)
async def disconnect_telegram(
    service: TelegramAuthService = Depends(get_auth_service),
) -> AuthStatusResponse:
    auth_status = await service.disconnect()
    return AuthStatusResponse.from_status(auth_status)
