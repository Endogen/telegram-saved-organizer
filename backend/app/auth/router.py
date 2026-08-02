"""Authenticated, per-user Telegram connection routes."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import RPCError

from app.accounts.dependencies import get_current_user
from app.auth.schemas import (
    TelegramConnectionRequest,
    TelegramConnectionResponse,
    TelegramVerifyRequest,
)
from app.auth.service import (
    TelegramAuthService,
    TelegramChallengeExpiredError,
    TelegramConnectionNotFoundError,
    TelegramIdentityConflictError,
    TelegramVerificationError,
)
from app.abuse import (
    TELEGRAM_SEND_PER_IP,
    TELEGRAM_SEND_PER_PHONE,
    TELEGRAM_VERIFY_PER_IP,
    TELEGRAM_VERIFY_PER_PHONE,
    RateLimitCheck,
    client_ip_subject,
    enforce_rate_limits,
    phone_subject,
    telegram_phone_subject,
)
from app.database import get_session

router = APIRouter(prefix="/telegram", tags=["telegram"])


def _service(*, session: AsyncSession, user: Any) -> TelegramAuthService:
    return TelegramAuthService(session=session, user_id=str(user.id))


@router.get("/connection", response_model=TelegramConnectionResponse)
async def telegram_connection_status(
    user: Annotated[Any, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TelegramConnectionResponse:
    state = await _service(session=session, user=user).status()
    return TelegramConnectionResponse(state=state)


@router.post("/connection", response_model=TelegramConnectionResponse)
async def connect_telegram(
    payload: TelegramConnectionRequest,
    request: Request,
    user: Annotated[Any, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TelegramConnectionResponse:
    await enforce_rate_limits(
        session,
        (
            RateLimitCheck(TELEGRAM_SEND_PER_IP, client_ip_subject(request)),
            RateLimitCheck(TELEGRAM_SEND_PER_PHONE, phone_subject(payload.phone)),
        ),
    )
    try:
        state = await _service(session=session, user=user).start(phone=payload.phone)
    except TelegramIdentityConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="telegram_account_already_connected",
        ) from exc
    except (TelegramVerificationError, RPCError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="telegram_connection_failed",
        ) from exc
    return TelegramConnectionResponse(state=state)


@router.post("/connection/verify", response_model=TelegramConnectionResponse)
async def verify_telegram(
    payload: TelegramVerifyRequest,
    request: Request,
    user: Annotated[Any, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TelegramConnectionResponse:
    pending_phone = await telegram_phone_subject(session, user_id=str(user.id))
    await enforce_rate_limits(
        session,
        (
            RateLimitCheck(TELEGRAM_VERIFY_PER_IP, client_ip_subject(request)),
            RateLimitCheck(TELEGRAM_VERIFY_PER_PHONE, pending_phone),
        ),
    )
    try:
        state = await _service(session=session, user=user).verify(
            code=payload.code,
            password=payload.password,
        )
    except TelegramConnectionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="telegram_challenge_missing",
        ) from exc
    except TelegramChallengeExpiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="telegram_challenge_expired",
        ) from exc
    except TelegramIdentityConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="telegram_account_already_connected",
        ) from exc
    except (TelegramVerificationError, RPCError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="telegram_verification_failed",
        ) from exc
    return TelegramConnectionResponse(state=state)


@router.delete("/connection", response_model=TelegramConnectionResponse)
async def disconnect_telegram(
    user: Annotated[Any, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TelegramConnectionResponse:
    state = await _service(session=session, user=user).disconnect()
    return TelegramConnectionResponse(state=state)
