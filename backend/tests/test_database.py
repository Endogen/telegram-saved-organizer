from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import delete, event, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import _configure_sqlite_connection, _secure_sqlite_database_file
from app.models import Base, Category, Message, MessageTag, Tag


@pytest.mark.asyncio
async def test_sqlite_foreign_keys_cascade_message_tag_rows() -> None:
    test_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    event.listen(test_engine.sync_engine, "connect", _configure_sqlite_connection)

    try:
        async with test_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
            foreign_keys_enabled = await connection.scalar(text("PRAGMA foreign_keys"))

        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
        async with session_factory() as session:
            category = Category(
                name="Other",
                slug="other",
                icon="archive",
                color="#64748B",
                position=1,
                is_default=True,
            )
            tag = Tag(name="Important")
            message = Message(
                telegram_id=1001,
                content="hello",
                date=datetime.now(tz=UTC),
                category=category,
                raw_data={},
            )
            message.tags.append(tag)
            session.add(message)
            await session.commit()

            await session.execute(delete(Message))
            await session.commit()
            association_rows = list(await session.scalars(select(MessageTag)))

        assert foreign_keys_enabled == 1
        assert association_rows == []
    finally:
        await test_engine.dispose()


def test_sqlite_database_file_permissions_are_restricted(tmp_path: Path) -> None:
    database_file = tmp_path / "app.db"
    database_file.write_bytes(b"")
    database_file.chmod(0o644)

    _secure_sqlite_database_file(str(database_file))

    assert database_file.stat().st_mode & 0o777 == 0o600
