from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.categories.service import (
    CategoryConflictError,
    CategoryNotFoundError,
    CategoryProtectedError,
    CategoryService,
)
from app.models import Category, Message, User


USER_ID = "00000000-0000-4000-8000-000000000001"


class _FakeScalarResult:
    def __init__(self, values: list[Any]) -> None:
        self._values = values

    def __iter__(self):
        return iter(self._values)


class _FakeExecuteResult:
    def __init__(self, rows: list[tuple[Any, Any]], *, rowcount: int = 0) -> None:
        self._rows = rows
        self.rowcount = rowcount

    def all(self) -> list[tuple[Any, Any]]:
        return self._rows


class _FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.scalars_values: list[list[Any]] = []
        self.execute_values: list[list[tuple[Any, Any]]] = []
        self.execute_rowcounts: list[int] = []
        self.scalar_calls: list[Any] = []
        self.scalars_calls: list[Any] = []
        self.execute_calls: list[Any] = []
        self.add_calls: list[Any] = []
        self.delete_calls: list[Any] = []
        self.commit_calls = 0
        self.rollback_calls = 0
        self.commit_error: Exception | None = None

    async def execute(self, statement: Any) -> _FakeExecuteResult:
        self.execute_calls.append(statement)
        rows = self.execute_values.pop(0) if self.execute_values else []
        rowcount = self.execute_rowcounts.pop(0) if self.execute_rowcounts else 0
        return _FakeExecuteResult(rows, rowcount=rowcount)

    async def scalar(self, statement: Any) -> Any:
        self.scalar_calls.append(statement)
        if not self.scalar_values:
            return None
        return self.scalar_values.pop(0)

    async def scalars(self, statement: Any) -> _FakeScalarResult:
        self.scalars_calls.append(statement)
        values = self.scalars_values.pop(0) if self.scalars_values else []
        return _FakeScalarResult(values)

    def add(self, item: Any) -> None:
        self.add_calls.append(item)

    async def delete(self, item: Any) -> None:
        self.delete_calls.append(item)

    async def commit(self) -> None:
        if self.commit_error is not None:
            raise self.commit_error
        self.commit_calls += 1

    async def rollback(self) -> None:
        self.rollback_calls += 1


def _build_category(
    *,
    category_id: int | None = 1,
    name: str = "Links",
    slug: str = "links",
    position: int = 1,
    is_default: bool = False,
    user_id: str = USER_ID,
) -> Category:
    return Category(
        id=category_id,
        user_id=user_id,
        name=name,
        normalized_name=name.casefold(),
        slug=slug,
        system_key=slug if is_default else None,
        icon="link",
        color="#0EA5E9",
        position=position,
        is_default=is_default,
    )


def _build_message(*, message_id: int, category_id: int, user_id: str = USER_ID) -> Message:
    timestamp = datetime(2026, 2, 1, 9, 0, tzinfo=UTC)
    return Message(
        id=message_id,
        user_id=user_id,
        telegram_id=1000 + message_id,
        content="hello",
        media_type=None,
        file_name=None,
        file_size=None,
        mime_type=None,
        url=None,
        sender_name=None,
        date=timestamp,
        category_id=category_id,
        raw_data={"id": 1000 + message_id},
        created_at=timestamp,
        updated_at=timestamp,
    )


def _build_user() -> User:
    return User(
        id=USER_ID,
        email="owner@example.com",
        normalized_email="owner@example.com",
        display_name="Owner",
        password_hash="test-password-hash",
    )


@pytest.mark.asyncio
async def test_list_categories_returns_counts_in_position_order() -> None:
    session = _FakeSession()
    first = _build_category(category_id=3, name="Audio", slug="audio", position=2)
    second = _build_category(category_id=9, name="Other", slug="other", position=8, is_default=True)
    session.execute_values = [[(first, 5), (second, 11)]]

    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]
    result = await service.list_categories()

    assert [(item.category.slug, item.message_count) for item in result] == [("audio", 5), ("other", 11)]
    statement = session.execute_calls[0]
    assert "LEFT OUTER JOIN messages" in str(statement)
    assert "categories.user_id =" in str(statement)
    assert "messages.user_id =" in str(statement)
    assert USER_ID in statement.compile().params.values()


@pytest.mark.asyncio
async def test_create_category_normalizes_fields_and_assigns_next_position() -> None:
    session = _FakeSession()
    session.scalar_values = [7, None, None]
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    category = await service.create_category(
        name="  Read Later  ",
        icon="  bookmark  ",
        color=" #22c55e ",
        position=None,
    )

    assert category.name == "Read Later"
    assert category.normalized_name == "read later"
    assert category.slug == "read-later"
    assert category.user_id == USER_ID
    assert category.icon == "bookmark"
    assert category.color == "#22C55E"
    assert category.position == 8
    assert category.is_default is False
    assert session.add_calls == [category]
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_create_category_raises_conflict_when_name_exists() -> None:
    session = _FakeSession()
    session.scalar_values = [_build_category(name="Read Later", slug="read-later")]
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(CategoryConflictError, match="name"):
        await service.create_category(
            name="Read Later",
            icon="bookmark",
            color="#22C55E",
            position=3,
        )

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_update_category_updates_fields_and_commits() -> None:
    session = _FakeSession()
    category = _build_category(category_id=5, name="Links", slug="links", position=3)
    session.scalar_values = [category, None, None]
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    updated = await service.update_category(
        category_id=5,
        updates={
            "name": " Notes ",
            "icon": " pen ",
            "color": " #abcdef ",
            "position": 4,
        },
    )

    assert updated is category
    assert category.name == "Notes"
    assert category.normalized_name == "notes"
    assert category.slug == "notes"
    assert category.icon == "pen"
    assert category.color == "#ABCDEF"
    assert category.position == 4
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_update_category_raises_when_not_found() -> None:
    session = _FakeSession()
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(CategoryNotFoundError, match="Category 99 was not found."):
        await service.update_category(category_id=99, updates={"name": "Inbox"})


@pytest.mark.asyncio
async def test_update_category_rejects_empty_payload() -> None:
    session = _FakeSession()
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="At least one update field must be provided."):
        await service.update_category(category_id=3, updates={})


@pytest.mark.asyncio
async def test_update_category_rejects_unknown_update_fields() -> None:
    session = _FakeSession()
    category = _build_category(category_id=3, name="Links", slug="links", position=3)
    session.scalar_values = [category]
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="Unsupported update field\\(s\\): is_default."):
        await service.update_category(category_id=3, updates={"is_default": True})


@pytest.mark.asyncio
async def test_delete_category_raises_when_category_missing() -> None:
    session = _FakeSession()
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(CategoryNotFoundError, match="Category 404 was not found."):
        await service.delete_category(category_id=404)


@pytest.mark.asyncio
async def test_delete_category_moves_messages_to_other_and_deletes() -> None:
    session = _FakeSession()
    source = _build_category(category_id=2, name="Links", slug="links", position=2)
    other = _build_category(category_id=8, name="Other", slug="other", position=8, is_default=True)
    session.scalar_values = [source, other]
    session.execute_rowcounts = [2]
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    result = await service.delete_category(category_id=2)

    assert result.moved_message_count == 2
    assert result.destination_category_id == 8
    update_statement = session.execute_calls[0]
    assert "UPDATE messages SET category_id" in str(update_statement)
    assert "messages.user_id =" in str(update_statement)
    assert USER_ID in update_statement.compile().params.values()
    assert session.delete_calls == [source]
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_delete_category_reassigns_messages_before_deleting_with_sqlite() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with engine.begin() as connection:
            await connection.run_sync(Category.metadata.create_all)

        async with session_factory() as session:
            session.add(_build_user())
            source = _build_category(category_id=None, name="Temporary", slug="temporary")
            fallback = _build_category(
                category_id=None,
                name="Other",
                slug="other",
                position=8,
                is_default=True,
            )
            session.add_all([source, fallback])
            await session.flush()
            source_id = source.id
            fallback_id = fallback.id
            session.add_all(
                [
                    _build_message(message_id=1, category_id=source_id),
                    _build_message(message_id=2, category_id=source_id),
                ]
            )
            await session.commit()

        async with session_factory() as session:
            result = await CategoryService(session=session, user_id=USER_ID).delete_category(
                category_id=source_id
            )

            assert result.moved_message_count == 2
            assert result.destination_category_id == fallback_id
            assert await session.get(Category, source_id) is None
            category_ids = await session.scalars(select(Message.category_id).order_by(Message.id))
            assert list(category_ids) == [fallback_id, fallback_id]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_delete_category_rejects_other_category() -> None:
    session = _FakeSession()
    other = _build_category(category_id=8, name="Other", slug="other", position=8, is_default=True)
    session.scalar_values = [other]
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(CategoryProtectedError, match="cannot be deleted"):
        await service.delete_category(category_id=8)

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_delete_category_rejects_every_default_category() -> None:
    session = _FakeSession()
    built_in = _build_category(category_id=2, name="Links", slug="links", position=2, is_default=True)
    session.scalar_values = [built_in]
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(CategoryProtectedError, match="Default categories cannot be deleted"):
        await service.delete_category(category_id=2)

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_delete_category_raises_when_fallback_is_missing() -> None:
    session = _FakeSession()
    source = _build_category(category_id=4, name="Temp", slug="temp", position=10)
    session.scalar_values = [source, None]
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(CategoryNotFoundError, match="Fallback category 'other' was not found."):
        await service.delete_category(category_id=4)

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_create_category_raises_conflict_when_slug_exists() -> None:
    session = _FakeSession()
    existing = _build_category(category_id=9, name="Read-Later", slug="read-later")
    session.scalar_values = [7, None, existing]
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(CategoryConflictError, match="Category slug 'read-later' already exists."):
        await service.create_category(
            name="Read Later",
            icon="bookmark",
            color="#22C55E",
            position=None,
        )


@pytest.mark.asyncio
async def test_create_category_rolls_back_and_raises_conflict_on_integrity_error() -> None:
    session = _FakeSession()
    session.scalar_values = [7, None, None]
    session.commit_error = IntegrityError("insert", {}, Exception("duplicate"))
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(CategoryConflictError, match="Category name or slug already exists."):
        await service.create_category(
            name="Read Later",
            icon="bookmark",
            color="#22C55E",
            position=None,
        )

    assert session.rollback_calls == 1


@pytest.mark.asyncio
async def test_create_category_rejects_non_string_name() -> None:
    session = _FakeSession()
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="name must be a string."):
        await service.create_category(name=123, icon="bookmark", color="#22C55E")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_create_category_rejects_blank_icon() -> None:
    session = _FakeSession()
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="icon must not be empty."):
        await service.create_category(name="Notes", icon="   ", color="#22C55E")


@pytest.mark.asyncio
async def test_create_category_rejects_non_string_color() -> None:
    session = _FakeSession()
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="color must be a string."):
        await service.create_category(name="Notes", icon="note", color=123)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_create_category_rejects_invalid_color_pattern() -> None:
    session = _FakeSession()
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="color must be a valid hex value like #22C55E."):
        await service.create_category(name="Notes", icon="note", color="#GGGGGG")


@pytest.mark.asyncio
async def test_create_category_rejects_negative_position() -> None:
    session = _FakeSession()
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="position must be a non-negative integer."):
        await service.create_category(name="Notes", icon="note", color="#22C55E", position=-1)


@pytest.mark.asyncio
async def test_create_category_rejects_name_without_alphanumeric_characters() -> None:
    session = _FakeSession()
    service = CategoryService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="name must include at least one alphanumeric character."):
        await service.create_category(name="!!!", icon="note", color="#22C55E")
