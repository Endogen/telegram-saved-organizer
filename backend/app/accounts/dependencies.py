"""FastAPI dependencies that resolve application identity and enforce CSRF."""

from __future__ import annotations

import hmac
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.service import AccountService, AuthContext, SessionNotFoundError, csrf_matches
from app.config import settings
from app.database import get_session
from app.models import User

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization")
    if not authorization:
        return None
    scheme, separator, credentials = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not credentials.strip():
        return None
    return credentials.strip()


def _normalized_origin(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or parsed.hostname is None:
        return None
    default_port = 443 if parsed.scheme == "https" else 80
    suffix = "" if (port or default_port) == default_port else f":{port}"
    return f"{parsed.scheme}://{parsed.hostname.lower().rstrip('.')}{suffix}"


def expected_request_origin(request: Request) -> str:
    configured = settings.public_origin
    if configured is not None:
        return configured
    return f"{request.url.scheme}://{request.url.netloc}"


def validate_browser_origin(request: Request, *, required: bool) -> None:
    """Require configured same-origin browser writes without trusting arbitrary Host in production."""

    fetch_site = request.headers.get("sec-fetch-site")
    if fetch_site and fetch_site not in {"same-origin", "none"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="cross_origin_request_blocked")

    supplied = request.headers.get("origin")
    if supplied is None:
        referer = request.headers.get("referer")
        supplied = _normalized_origin(referer) if referer else None
    else:
        supplied = _normalized_origin(supplied)
    if supplied is None:
        if required:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="origin_required")
        return
    expected = _normalized_origin(expected_request_origin(request))
    if expected is None or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="cross_origin_request_blocked")


async def optional_auth_context(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AuthContext | None:
    bearer = _bearer_token(request)
    cookie = request.cookies.get(settings.session_cookie_name)
    token = bearer or cookie
    if not token:
        return None
    try:
        return await AccountService(session=session).resolve_session(
            token=token,
            source="bearer" if bearer else "cookie",
        )
    except SessionNotFoundError:
        return None


async def get_auth_context(
    request: Request,
    context: Annotated[AuthContext | None, Depends(optional_auth_context)],
) -> AuthContext:
    if context is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication_required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if request.method.upper() in UNSAFE_METHODS and context.source == "cookie":
        validate_browser_origin(request, required=True)
        if not csrf_matches(
            context,
            cookie_token=request.cookies.get(settings.csrf_cookie_name),
            header_token=request.headers.get("x-csrf-token"),
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="csrf_validation_failed")
    return context


async def get_current_user(
    context: Annotated[AuthContext, Depends(get_auth_context)],
) -> User:
    return context.user
