"""Async database setup and migration-revision verification."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import event, inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import PRIVATE_FILE_MODE, settings
from app.models import Base


class DatabaseMigrationError(RuntimeError):
    """Raised when the running schema is not at the application migration head."""


def _configure_sqlite_connection(dbapi_connection: Any, _: Any) -> None:
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


def build_engine(database_url: str) -> AsyncEngine:
    # SQLAlchemy includes bound values in many DBAPI exception strings by
    # default. Those values can contain private Saved Message text and Telegram
    # metadata, so keep them out of worker and API tracebacks.
    engine = create_async_engine(
        database_url,
        pool_pre_ping=True,
        hide_parameters=True,
    )
    if engine.url.get_backend_name() == "sqlite":
        event.listen(engine.sync_engine, "connect", _configure_sqlite_connection)
    return engine


engine = build_engine(settings.database_url)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

DATABASE_READINESS_TIMEOUT_SECONDS = 2.0


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def database_is_ready(
    *, timeout_seconds: float = DATABASE_READINESS_TIMEOUT_SECONDS
) -> bool:
    """Return whether the database can answer a bounded lightweight query."""

    try:
        async with asyncio.timeout(timeout_seconds):
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
    except Exception:
        return False
    return True


def _alembic_config() -> Config:
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    return config


async def verify_database_revision() -> None:
    """Fail startup when migrations have not been applied by the release step."""

    config = _alembic_config()
    expected = ScriptDirectory.from_config(config).get_current_head()
    async with engine.connect() as connection:
        current = await connection.run_sync(
            lambda sync_connection: MigrationContext.configure(sync_connection).get_current_revision()
        )
        table_names = await connection.run_sync(
            lambda sync_connection: set(inspect(sync_connection).get_table_names())
        )
    legacy_tables = {"categories", "messages", "tags", "message_tags"}
    if current is None and table_names.intersection(legacy_tables):
        raise DatabaseMigrationError(
            "This database contains the unsupported legacy single-user schema. "
            "It cannot be upgraded in place because its rows have no account owner. "
            "Export any data you need and deploy the multi-user release with a fresh database."
        )
    if current != expected:
        raise DatabaseMigrationError(
            f"Database revision is {current or 'unversioned'}, expected {expected}. "
            "Run `uv run alembic upgrade head` before starting the API."
        )
    if engine.url.get_backend_name() == "sqlite":
        _secure_sqlite_database_file(engine.url.database)


async def create_schema_for_tests(target_engine: AsyncEngine | None = None) -> None:
    """Create model metadata explicitly for isolated tests, never application startup."""

    selected = target_engine or engine
    async with selected.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def drop_schema_for_tests(target_engine: AsyncEngine | None = None) -> None:
    selected = target_engine or engine
    async with selected.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)


async def dispose_engine() -> None:
    await engine.dispose()
