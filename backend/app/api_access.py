"""Local API access token and browser session handling."""

from __future__ import annotations

import hashlib
import hmac
from typing import Annotated

from fastapi import APIRouter, Body, Request, Response, status
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse

from app.config import settings

SESSION_COOKIE_NAME = "tso_session"
SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
SESSION_CONTEXT = b"telegram-saved-organizer/browser-session/v1"

router = APIRouter(prefix="/session", tags=["session"])


class SessionStatus(BaseModel):
    """Whether this browser has unlocked the local API."""

    authenticated: bool


class SessionUnlockRequest(BaseModel):
    """Long-lived local API token supplied once to unlock the browser."""

    token: Annotated[str, Field(min_length=32, max_length=512)]


def _session_cookie_value(api_token: str) -> str:
    return hmac.new(api_token.encode("utf-8"), SESSION_CONTEXT, hashlib.sha256).hexdigest()


def _bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization")
    if authorization is None:
        return None

    scheme, separator, credentials = authorization.partition(" ")
    if separator == "" or scheme.lower() != "bearer" or credentials.strip() == "":
        return None
    return credentials.strip()


def request_is_authenticated(request: Request, api_token: str | None) -> bool:
    """Accept either the local bearer token or its derived HttpOnly session cookie."""

    if api_token is None:
        return True

    bearer_token = _bearer_token(request)
    if bearer_token is not None and hmac.compare_digest(bearer_token, api_token):
        return True

    session_cookie = request.cookies.get(SESSION_COOKIE_NAME)
    return session_cookie is not None and hmac.compare_digest(
        session_cookie,
        _session_cookie_value(api_token),
    )


def authentication_required_response() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={"detail": "api_authentication_required"},
        headers={
            "Cache-Control": "no-store",
            "WWW-Authenticate": "Bearer",
        },
    )


@router.get("", response_model=SessionStatus)
async def get_session_status(request: Request, response: Response) -> SessionStatus:
    response.headers["Cache-Control"] = "no-store"
    return SessionStatus(
        authenticated=request_is_authenticated(request, request.app.state.api_token),
    )


@router.post("", response_model=SessionStatus)
async def unlock_session(
    request: Request,
    response: Response,
    payload: Annotated[SessionUnlockRequest, Body()],
) -> SessionStatus | JSONResponse:
    api_token: str | None = request.app.state.api_token
    if api_token is None or not hmac.compare_digest(payload.token, api_token):
        return authentication_required_response()

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=_session_cookie_value(api_token),
        max_age=SESSION_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        path="/api",
    )
    response.headers["Cache-Control"] = "no-store"
    return SessionStatus(authenticated=True)


@router.delete("", response_model=SessionStatus)
async def lock_session(response: Response) -> SessionStatus:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=False,
        samesite="strict",
        path="/api",
    )
    response.headers["Cache-Control"] = "no-store"
    return SessionStatus(authenticated=False)


def main() -> None:
    """Print the configured token for an explicit local unlock action."""

    print(settings.api_token)


if __name__ == "__main__":
    main()
