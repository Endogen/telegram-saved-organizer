"""Public sign-in and authenticated account-management routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.dependencies import (
    get_auth_context,
    get_current_user,
    optional_auth_context,
    validate_browser_origin,
)
from app.accounts.schemas import (
    AccountDeleteRequest,
    AccountResponse,
    AccountUpdateRequest,
    ActiveSessionResponse,
    LoginRequest,
    PasswordChangeRequest,
    RegistrationRequest,
    SessionStatusResponse,
)
from app.accounts.service import (
    AccountConflictError,
    AccountNotFoundError,
    AccountService,
    AuthContext,
    AuthenticationFailedError,
    RegistrationDisabledError,
    SessionCredentials,
)
from app.abuse import (
    LOGIN_PER_IDENTITY,
    LOGIN_PER_IP,
    REGISTRATION_PER_IP,
    RateLimitCheck,
    client_ip_subject,
    enforce_rate_limits,
)
from app.config import settings
from app.database import get_session
from app.models import User

router = APIRouter(tags=["account"])


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _set_session_cookies(response: Response, credentials: SessionCredentials) -> None:
    common = {
        "max_age": settings.session_absolute_seconds,
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "path": "/",
    }
    response.set_cookie(
        key=settings.session_cookie_name,
        value=credentials.token,
        httponly=True,
        **common,
    )
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=credentials.csrf_token,
        httponly=False,
        **common,
    )
    response.headers["Cache-Control"] = "no-store"


def _clear_session_cookies(
    response: Response, *, clear_site_data: bool = False
) -> None:
    for name, httponly in (
        (settings.session_cookie_name, True),
        (settings.csrf_cookie_name, False),
    ):
        response.delete_cookie(
            key=name,
            path="/",
            secure=settings.cookie_secure,
            httponly=httponly,
            samesite="lax",
        )
    response.headers["Cache-Control"] = "no-store"
    if clear_site_data:
        response.headers["Clear-Site-Data"] = '"cache", "cookies", "storage"'


@router.get("/session", response_model=SessionStatusResponse)
async def session_status(
    response: Response,
    context: Annotated[AuthContext | None, Depends(optional_auth_context)],
) -> SessionStatusResponse:
    response.headers["Cache-Control"] = "no-store"
    if context is None:
        return SessionStatusResponse(authenticated=False, user=None)
    return SessionStatusResponse(
        authenticated=True,
        user=AccountResponse.model_validate(context.user),
    )


@router.post("/session", response_model=SessionStatusResponse)
async def create_session(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SessionStatusResponse:
    validate_browser_origin(request, required=False)
    await enforce_rate_limits(
        session,
        (
            RateLimitCheck(LOGIN_PER_IP, client_ip_subject(request)),
            RateLimitCheck(LOGIN_PER_IDENTITY, str(payload.email).strip().casefold()),
        ),
    )
    try:
        user, credentials = await AccountService(session=session).login(
            email=str(payload.email),
            password=payload.password,
            user_agent=request.headers.get("user-agent"),
            ip_address=_client_ip(request),
        )
    except AuthenticationFailedError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_credentials",
        ) from exc
    _set_session_cookies(response, credentials)
    return SessionStatusResponse(
        authenticated=True, user=AccountResponse.model_validate(user)
    )


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    response: Response,
    context: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    await AccountService(session=session).logout(record=context.web_session)
    _clear_session_cookies(response, clear_site_data=True)


@router.post("/account/register", status_code=status.HTTP_204_NO_CONTENT)
async def register_account(
    payload: RegistrationRequest,
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    validate_browser_origin(request, required=False)
    await enforce_rate_limits(
        session,
        (RateLimitCheck(REGISTRATION_PER_IP, client_ip_subject(request)),),
    )
    try:
        await AccountService(session=session).register(
            email=str(payload.email),
            display_name=payload.display_name,
            password=payload.password,
        )
    except RegistrationDisabledError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="registration_disabled"
        ) from exc
    except AccountConflictError:
        # Registration is intentionally non-enumerating. The frontend follows
        # this response with a normal sign-in attempt, which succeeds only for
        # a newly created account or the legitimate owner of an existing one.
        pass
    response.headers["Cache-Control"] = "no-store"


@router.get("/account", response_model=AccountResponse)
async def get_account(
    user: Annotated[User, Depends(get_current_user)],
) -> AccountResponse:
    return AccountResponse.model_validate(user)


@router.patch("/account", response_model=AccountResponse)
async def update_account(
    payload: AccountUpdateRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AccountResponse:
    updated = await AccountService(session=session).update_account(
        user=user,
        display_name=payload.display_name,
    )
    return AccountResponse.model_validate(updated)


@router.post("/account/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    response: Response,
    context: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    try:
        credentials = await AccountService(session=session).change_password(
            user=context.user,
            current_password=payload.current_password,
            new_password=payload.new_password,
            user_agent=request.headers.get("user-agent"),
            ip_address=_client_ip(request),
        )
    except AuthenticationFailedError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_password"
        ) from exc
    _set_session_cookies(response, credentials)


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    payload: AccountDeleteRequest,
    response: Response,
    context: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    try:
        await AccountService(session=session).delete_account(
            user=context.user,
            password=payload.password,
        )
    except AuthenticationFailedError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_password"
        ) from exc
    _clear_session_cookies(response, clear_site_data=True)


@router.get("/account/sessions", response_model=list[ActiveSessionResponse])
async def list_active_sessions(
    context: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ActiveSessionResponse]:
    records = await AccountService(session=session).list_sessions(
        user_id=context.user.id
    )
    return [
        ActiveSessionResponse(
            id=record.id,
            created_at=record.created_at,
            last_seen_at=record.last_seen_at,
            expires_at=record.expires_at,
            current=record.id == context.web_session.id,
            user_agent=record.user_agent,
            ip_address=record.ip_address,
        )
        for record in records
    ]


@router.delete("/account/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_active_session(
    session_id: str,
    response: Response,
    context: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    try:
        await AccountService(session=session).revoke_session(
            user_id=context.user.id,
            session_id=session_id,
        )
    except AccountNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="session_not_found"
        ) from exc
    if session_id == context.web_session.id:
        _clear_session_cookies(response, clear_site_data=True)
