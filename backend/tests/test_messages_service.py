from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from app.messages.service import (
    CategoryNotFoundError,
    MessageListResult,
    MessageNotFoundError,
    MessageService,
    MessageSort,
)
from app.models import Category, Message, Tag


class _FakeScalarResult:
    def __init__(self, values: list[Any]) -> None:
        self._values = values

    def __iter__(self):
        return iter(self._values)


class _FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.scalars_values: list[list[Any]] = []
        self.get_values: dict[tuple[type[Any], int], Any] = {}
        self.scalar_calls: list[Any] = []
        self.scalars_calls: list[Any] = []
        self.delete_calls: list[Any] = []
        self.commit_calls = 0

    async def scalar(self, statement: Any) -> Any:
        self.scalar_calls.append(statement)
        if not self.scalar_values:
            return None
        return self.scalar_values.pop(0)

    async def scalars(self, statement: Any) -> _FakeScalarResult:
        self.scalars_calls.append(statement)
        values = self.scalars_values.pop(0) if self.scalars_values else []
        return _FakeScalarResult(values)

    async def get(self, model: type[Any], item_id: int) -> Any:
        return self.get_values.get((model, item_id))

    async def delete(self, item: Any) -> None:
        self.delete_calls.append(item)

    async def commit(self) -> None:
        self.commit_calls += 1


def _build_message(
    *,
    message_id: int = 1,
    telegram_id: int = 1001,
    category_id: int = 1,
    content: str | None = "hello",
) -> Message:
    timestamp = datetime(2026, 2, 1, 12, 0, tzinfo=UTC)
    category = Category(
        id=category_id,
        name=f"Category {category_id}",
        slug=f"cat-{category_id}",
        icon="archive",
        color="#64748B",
        position=category_id,
        is_default=False,
    )
    tag = Tag(id=1, name="important", color="#22C55E")
    message = Message(
        id=message_id,
        telegram_id=telegram_id,
        content=content,
        media_type=None,
        file_name=None,
        file_size=None,
        mime_type=None,
        url=None,
        sender_name=None,
        date=timestamp,
        category_id=category_id,
        raw_data={"id": telegram_id},
        created_at=timestamp,
        updated_at=timestamp,
    )
    message.category = category
    message.tags = [tag]
    return message


@pytest.mark.asyncio
async def test_list_messages_returns_paginated_items() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [7]
    session.scalars_values = [[message]]

    service = MessageService(session=session)  # type: ignore[arg-type]
    result = await service.list_messages(page=2, per_page=1, sort=MessageSort.DATE_ASC)

    assert isinstance(result, MessageListResult)
    assert result.total == 7
    assert result.page == 2
    assert result.per_page == 1
    assert result.items == [message]
    assert "ORDER BY messages.date ASC" in str(session.scalars_calls[0])


@pytest.mark.asyncio
async def test_list_messages_applies_category_tag_and_search_filters() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [1]
    session.scalars_values = [[message]]

    service = MessageService(session=session)  # type: ignore[arg-type]
    await service.list_messages(
        category_slug=" links ",
        tag_names=["read-later", "read-later", " urgent "],
        search=" alice ",
    )

    list_statement = str(session.scalars_calls[0])
    total_statement = str(session.scalar_calls[0])

    assert "WHERE" in list_statement
    assert "categories.slug" in list_statement
    assert "tags.name IN" in list_statement
    assert "LIKE" in list_statement
    assert "categories.slug" in total_statement


@pytest.mark.asyncio
async def test_list_messages_ignores_blank_filters() -> None:
    session = _FakeSession()
    session.scalar_values = [0]
    service = MessageService(session=session)  # type: ignore[arg-type]

    await service.list_messages(category_slug="   ", tag_names=["", "   "], search="   ")

    list_statement = str(session.scalars_calls[0])

    assert "WHERE" not in list_statement
    assert "EXISTS" not in list_statement


@pytest.mark.asyncio
async def test_get_message_raises_when_not_found() -> None:
    session = _FakeSession()
    session.scalar_values = [None]
    service = MessageService(session=session)  # type: ignore[arg-type]

    with pytest.raises(MessageNotFoundError, match="Message 99 was not found."):
        await service.get_message(message_id=99)


@pytest.mark.asyncio
async def test_update_message_changes_fields_and_commits() -> None:
    session = _FakeSession()
    message = _build_message(content="before")
    updated_category = Category(
        id=2,
        name="Category 2",
        slug="cat-2",
        icon="archive",
        color="#0EA5E9",
        position=2,
        is_default=False,
    )
    session.scalar_values = [message, message]
    session.get_values[(Category, 2)] = updated_category
    service = MessageService(session=session)  # type: ignore[arg-type]

    updated = await service.update_message(
        message_id=message.id,
        updates={"category_id": 2, "content": "after"},
    )

    assert updated is message
    assert message.category_id == 2
    assert message.content == "after"
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_update_message_raises_when_category_missing() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [message]
    service = MessageService(session=session)  # type: ignore[arg-type]

    with pytest.raises(CategoryNotFoundError, match="Category 99 was not found."):
        await service.update_message(message_id=message.id, updates={"category_id": 99})

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_delete_message_removes_item_and_commits() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [message]
    service = MessageService(session=session)  # type: ignore[arg-type]

    await service.delete_message(message_id=message.id)

    assert session.delete_calls == [message]
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_update_message_rejects_empty_update_payload() -> None:
    session = _FakeSession()
    service = MessageService(session=session)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="At least one update field must be provided."):
        await service.update_message(message_id=1, updates={})
