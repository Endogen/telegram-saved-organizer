"""FastAPI entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import APIRouter, FastAPI, Request
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from app.api_access import (
    authentication_required_response,
    request_is_authenticated,
    router as api_access_router,
)
from app.auth.router import router as auth_router
from app.categories.router import router as categories_router
from app.auth.service import auto_reconnect
from app.config import settings
from app.database import create_database, dispose_engine
from app.messages.router import router as messages_router
from app.tags.router import router as tags_router
from app.telegram.client import telegram_client_manager
from app.telegram.router import router as scan_router

api_router = APIRouter(prefix="/api")
api_router.include_router(api_access_router)
api_router.include_router(auth_router)
api_router.include_router(scan_router)
api_router.include_router(categories_router)
api_router.include_router(messages_router)
api_router.include_router(tags_router)

UNSAFE_HTTP_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
PUBLIC_API_PATHS = frozenset({"/api/health", "/api/session"})


def _normalize_origin(value: str) -> tuple[str, str, int] | None:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None

    scheme = parsed.scheme.lower()
    hostname = parsed.hostname
    if scheme not in {"http", "https"} or hostname is None:
        return None
    if parsed.username is not None or parsed.password is not None:
        return None
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        return None

    default_port = 443 if scheme == "https" else 80
    return (scheme, hostname.rstrip(".").lower(), port or default_port)


async def _enforce_same_origin_for_unsafe_requests(
    request: Request,
    call_next: RequestResponseEndpoint,
) -> Response:
    """Reject browser-originated cross-origin writes while allowing non-browser clients."""

    if request.method.upper() not in UNSAFE_HTTP_METHODS:
        return await call_next(request)

    origin = request.headers.get("origin")
    if origin is None:
        return await call_next(request)

    request_origin = f"{request.url.scheme}://{request.url.netloc}"
    if _normalize_origin(origin) == _normalize_origin(request_origin):
        return await call_next(request)

    return JSONResponse(
        status_code=403,
        content={"detail": "cross_origin_request_blocked"},
    )


async def _enforce_api_authentication(
    request: Request,
    call_next: RequestResponseEndpoint,
) -> Response:
    if (
        request.url.path.startswith("/api/")
        and request.url.path not in PUBLIC_API_PATHS
        and not request_is_authenticated(request, request.app.state.api_token)
    ):
        return authentication_required_response()
    return await call_next(request)


@api_router.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    await create_database()
    await auto_reconnect()
    try:
        yield
    finally:
        await telegram_client_manager.disconnect()
        await dispose_engine()


def create_app(*, api_token: str | None = settings.api_token) -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.state.api_token = api_token
    app.middleware("http")(_enforce_same_origin_for_unsafe_requests)
    app.middleware("http")(_enforce_api_authentication)
    app.include_router(api_router)
    return app


app = create_app()
