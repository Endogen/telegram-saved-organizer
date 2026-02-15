"""FastAPI entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from app.auth.router import router as auth_router
from app.config import settings
from app.database import dispose_engine
from app.telegram.client import telegram_client_manager

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router)


@api_router.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        yield
    finally:
        await telegram_client_manager.disconnect()
        await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.include_router(api_router)
    return app


app = create_app()
