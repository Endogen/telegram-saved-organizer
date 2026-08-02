"""Async SQLAlchemy engine and session setup."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import PRIVATE_FILE_MODE, settings
from app.default_categories import seed_default_categories
from app.models import Base


def _configure_sqlite_connection(dbapi_connection: Any, _: Any) -> None:
    """Enable SQLite integrity checks that are disabled by default."""

    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


def _secure_sqlite_database_file(database_path: str | None) -> None:
    if database_path in {None, "", ":memory:"}:
        return

    path = Path(database_path)
    if path.exists():
        path.chmod(PRIVATE_FILE_MODE)


engine: AsyncEngine = create_async_engine(settings.database_url)
if engine.url.get_backend_name() == "sqlite":
    event.listen(engine.sync_engine, "connect", _configure_sqlite_connection)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def create_database() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    if engine.url.get_backend_name() == "sqlite":
        _secure_sqlite_database_file(engine.url.database)
    async with SessionLocal() as session:
        await seed_default_categories(session)


async def dispose_engine() -> None:
    await engine.dispose()
