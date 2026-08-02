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
    TelegramClientNotConnectedError,
    TelegramMessageDeleteError,
    TelegramMessageProvenanceError,
)
from app.models import Category, Message, MessageTag, Tag

USER_ID = "00000000-0000-0000-0000-000000000001"
TELEGRAM_USER_ID = 424242
CONNECTION_GENERATION = 3


class _FakeScalarResult:
    def __init__(self, values: list[Any]) -> None:
        self._values = values

    def __iter__(self):
        return iter(self._values)


class _FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.scalars_values: list[list[Any]] = []
        self.scalar_calls: list[Any] = []
        self.scalars_calls: list[Any] = []
        self.execute_calls: list[Any] = []
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

    async def execute(self, statement: Any) -> None:
        self.execute_calls.append(statement)

    async def delete(self, item: Any) -> None:
        self.delete_calls.append(item)

    async def commit(self) -> None:
        self.commit_calls += 1


class _FakeTelegramDelete:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int, int, tuple[int, ...], Any]] = []
        self.delete_error: Exception | None = None

    async def __call__(
        self,
        *,
        user_id: str,
        telegram_user_id: int,
        connection_generation: int,
        message_ids: tuple[int, ...],
        session: Any,
    ) -> None:
        self.calls.append(
            (
                user_id,
                telegram_user_id,
                connection_generation,
                tuple(message_ids),
                session,
            )
        )
        if self.delete_error is not None:
            raise self.delete_error


def _build_message(
    *,
    message_id: int = 1,
    telegram_id: int = 1001,
    telegram_user_id: int | None = TELEGRAM_USER_ID,
    connection_generation: int | None = CONNECTION_GENERATION,
    category_id: int = 1,
    content: str | None = "hello",
) -> Message:
    timestamp = datetime(2026, 2, 1, 12, 0, tzinfo=UTC)
    category = Category(
        id=category_id,
        user_id=USER_ID,
        name=f"Category {category_id}",
        normalized_name=f"category {category_id}",
        slug=f"cat-{category_id}",
        icon="archive",
        color="#64748B",
        position=category_id,
        is_default=False,
    )
    tag = Tag(
        id=1,
        user_id=USER_ID,
        name="important",
        normalized_name="important",
        color="#22C55E",
    )
    message = Message(
        id=message_id,
        user_id=USER_ID,
        telegram_id=telegram_id,
        telegram_user_id=telegram_user_id,
        connection_generation=connection_generation,
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

    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]
    result = await service.list_messages(page=2, per_page=1, sort=MessageSort.DATE_ASC)

    assert isinstance(result, MessageListResult)
    assert result.total == 7
    assert result.page == 2
    assert result.per_page == 1
    assert result.items == [message]
    list_statement = str(session.scalars_calls[0])
    assert "messages.user_id" in list_statement
    assert "ORDER BY messages.date ASC" in list_statement


@pytest.mark.asyncio
async def test_clear_all_messages_removes_associations_before_messages() -> None:
    session = _FakeSession()
    session.scalar_values = [2]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    cleared_count = await service.clear_all_messages()

    assert cleared_count == 2
    assert "messages.user_id" in str(session.scalar_calls[0])
    assert len(session.execute_calls) == 2
    assert session.execute_calls[0].table.name == MessageTag.__tablename__
    assert session.execute_calls[1].table.name == Message.__tablename__
    assert "message_tags.user_id" in str(session.execute_calls[0])
    assert "messages.user_id" in str(session.execute_calls[1])
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_list_messages_applies_category_tag_and_search_filters() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [1]
    session.scalars_values = [[message]]

    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]
    await service.list_messages(
        category_slug=" links ",
        tag_names=["read-later", "read-later", " urgent "],
        search=" alice ",
    )

    list_statement = str(session.scalars_calls[0])
    total_statement = str(session.scalar_calls[0])

    assert "WHERE" in list_statement
    assert "messages.user_id" in list_statement
    assert "categories.user_id" in list_statement
    assert "categories.slug" in list_statement
    assert "tags.user_id" in list_statement
    assert "tags.normalized_name" in list_statement
    assert list_statement.count("EXISTS") >= 3
    assert "LIKE" in list_statement
    assert "categories.slug" in total_statement


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sort", "expected_ordering"),
    [
        (MessageSort.CATEGORY, "ORDER BY lower(categories.name) ASC"),
        (MessageSort.SENDER, "ORDER BY lower(coalesce(messages.sender_name"),
    ],
)
async def test_list_messages_supports_server_side_library_sorts(
    sort: MessageSort,
    expected_ordering: str,
) -> None:
    session = _FakeSession()
    session.scalar_values = [0]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    await service.list_messages(sort=sort)

    statement = str(session.scalars_calls[0])
    assert expected_ordering in statement
    assert "messages.user_id" in statement


@pytest.mark.asyncio
async def test_list_messages_ignores_blank_filters() -> None:
    session = _FakeSession()
    session.scalar_values = [0]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    await service.list_messages(category_slug="   ", tag_names=["", "   "], search="   ")

    list_statement = str(session.scalars_calls[0])

    assert "WHERE messages.user_id" in list_statement
    assert "EXISTS" not in list_statement


@pytest.mark.asyncio
async def test_get_message_raises_when_not_found() -> None:
    session = _FakeSession()
    session.scalar_values = [None]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(MessageNotFoundError, match="Message 99 was not found."):
        await service.get_message(message_id=99)

    statement = str(session.scalar_calls[0])
    assert "messages.user_id" in statement
    assert "messages.id" in statement


@pytest.mark.asyncio
async def test_update_message_changes_fields_and_commits() -> None:
    session = _FakeSession()
    message = _build_message(content="before")
    updated_category = Category(
        id=2,
        user_id=USER_ID,
        name="Category 2",
        normalized_name="category 2",
        slug="cat-2",
        icon="archive",
        color="#0EA5E9",
        position=2,
        is_default=False,
    )
    session.scalar_values = [message, updated_category, message]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    updated = await service.update_message(
        message_id=message.id,
        updates={"category_id": 2, "content": "after"},
    )

    assert updated is message
    assert message.category_id == 2
    assert message.content == "after"
    assert "categories.user_id" in str(session.scalar_calls[1])
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_update_message_raises_when_category_missing() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [message, None]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(CategoryNotFoundError, match="Category 99 was not found."):
        await service.update_message(message_id=message.id, updates={"category_id": 99})

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_delete_message_removes_item_and_commits() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [message]
    telegram_delete = _FakeTelegramDelete()
    service = MessageService(
        session=session,  # type: ignore[arg-type]
        user_id=USER_ID,
        telegram_delete=telegram_delete,
    )

    await service.delete_message(message_id=message.id)

    assert telegram_delete.calls == [
        (USER_ID, TELEGRAM_USER_ID, CONNECTION_GENERATION, (message.telegram_id,), session)
    ]
    assert session.delete_calls == [message]
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_unprovenanced_message_rejects_remote_delete_but_allows_local_only() -> None:
    message = _build_message(telegram_user_id=None, connection_generation=None)
    telegram_delete = _FakeTelegramDelete()

    remote_session = _FakeSession()
    remote_session.scalar_values = [message]
    remote_service = MessageService(
        session=remote_session,  # type: ignore[arg-type]
        user_id=USER_ID,
        telegram_delete=telegram_delete,
    )
    with pytest.raises(TelegramMessageProvenanceError):
        await remote_service.delete_message(message_id=message.id)
    assert telegram_delete.calls == []
    assert remote_session.delete_calls == []

    local_session = _FakeSession()
    local_session.scalar_values = [message]
    local_service = MessageService(
        session=local_session,  # type: ignore[arg-type]
        user_id=USER_ID,
        telegram_delete=telegram_delete,
    )
    await local_service.delete_message(message_id=message.id, local_only=True)
    assert local_session.delete_calls == [message]
    assert local_session.commit_calls == 1


@pytest.mark.asyncio
async def test_bulk_delete_messages_removes_items_and_commits() -> None:
    session = _FakeSession()
    first = _build_message(message_id=1, telegram_id=1001)
    second = _build_message(message_id=2, telegram_id=1002)
    session.scalars_values = [[first, second]]
    telegram_delete = _FakeTelegramDelete()
    service = MessageService(
        session=session,  # type: ignore[arg-type]
        user_id=USER_ID,
        telegram_delete=telegram_delete,
    )

    deleted_count = await service.bulk_delete_messages(message_ids=[1, 2, 2])

    assert deleted_count == 2
    assert telegram_delete.calls == [
        (USER_ID, TELEGRAM_USER_ID, CONNECTION_GENERATION, (1001, 1002), session)
    ]
    assert "messages.user_id" in str(session.scalars_calls[0])
    assert session.delete_calls == [first, second]
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_bulk_delete_messages_raises_when_any_message_missing() -> None:
    session = _FakeSession()
    first = _build_message(message_id=1, telegram_id=1001)
    session.scalars_values = [[first]]
    telegram_delete = _FakeTelegramDelete()
    service = MessageService(
        session=session,  # type: ignore[arg-type]
        user_id=USER_ID,
        telegram_delete=telegram_delete,
    )

    with pytest.raises(MessageNotFoundError, match="Message 2 was not found."):
        await service.bulk_delete_messages(message_ids=[1, 2])

    assert telegram_delete.calls == []
    assert session.delete_calls == []
    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_delete_message_raises_when_telegram_not_connected() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [message]
    telegram_delete = _FakeTelegramDelete()
    telegram_delete.delete_error = TelegramClientNotConnectedError(
        "Telegram client is not connected."
    )
    service = MessageService(
        session=session,  # type: ignore[arg-type]
        user_id=USER_ID,
        telegram_delete=telegram_delete,
    )

    with pytest.raises(TelegramClientNotConnectedError, match="Telegram client is not connected."):
        await service.delete_message(message_id=message.id)

    assert session.delete_calls == []
    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_delete_message_raises_when_telegram_delete_fails() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [message]
    telegram_delete = _FakeTelegramDelete()
    telegram_delete.delete_error = TelegramMessageDeleteError(
        "Failed to delete Telegram message(s)."
    )
    service = MessageService(
        session=session,  # type: ignore[arg-type]
        user_id=USER_ID,
        telegram_delete=telegram_delete,
    )

    with pytest.raises(TelegramMessageDeleteError, match="Failed to delete Telegram message\\(s\\)."):
        await service.delete_message(message_id=message.id)

    assert telegram_delete.calls == [
        (USER_ID, TELEGRAM_USER_ID, CONNECTION_GENERATION, (message.telegram_id,), session)
    ]
    assert session.delete_calls == []
    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_bulk_move_messages_updates_category_and_commits() -> None:
    session = _FakeSession()
    first = _build_message(message_id=1, telegram_id=1001, category_id=1)
    second = _build_message(message_id=2, telegram_id=1002, category_id=2)
    destination = Category(
        id=3,
        user_id=USER_ID,
        name="Category 3",
        normalized_name="category 3",
        slug="cat-3",
        icon="archive",
        color="#14B8A6",
        position=3,
        is_default=False,
    )
    session.scalar_values = [destination]
    session.scalars_values = [[first, second]]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    moved_count = await service.bulk_move_messages(message_ids=[1, 2], category_id=3)

    assert moved_count == 2
    assert first.category_id == 3
    assert second.category_id == 3
    assert "categories.user_id" in str(session.scalar_calls[0])
    assert "messages.user_id" in str(session.scalars_calls[0])
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_bulk_move_messages_raises_when_any_message_missing() -> None:
    session = _FakeSession()
    first = _build_message(message_id=1, telegram_id=1001, category_id=1)
    destination = Category(
        id=2,
        user_id=USER_ID,
        name="Category 2",
        normalized_name="category 2",
        slug="cat-2",
        icon="archive",
        color="#14B8A6",
        position=2,
        is_default=False,
    )
    session.scalar_values = [destination]
    session.scalars_values = [[first]]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(MessageNotFoundError, match="Message 999 was not found."):
        await service.bulk_move_messages(message_ids=[1, 999], category_id=2)

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_bulk_operations_reject_invalid_payloads() -> None:
    session = _FakeSession()
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="message_ids must contain at least one id."):
        await service.bulk_delete_messages(message_ids=[])

    with pytest.raises(ValueError, match="category_id must be a positive integer."):
        await service.bulk_move_messages(message_ids=[1], category_id=0)


@pytest.mark.asyncio
async def test_update_message_rejects_empty_update_payload() -> None:
    session = _FakeSession()
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="At least one update field must be provided."):
        await service.update_message(message_id=1, updates={})


@pytest.mark.asyncio
async def test_list_messages_rejects_non_positive_pagination_values() -> None:
    session = _FakeSession()
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="page must be greater than zero."):
        await service.list_messages(page=0)

    with pytest.raises(ValueError, match="per_page must be greater than zero."):
        await service.list_messages(per_page=0)


@pytest.mark.asyncio
async def test_update_message_rejects_unknown_update_fields() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [message]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="Unsupported update field\\(s\\): sender_name."):
        await service.update_message(message_id=message.id, updates={"sender_name": "Alice"})

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_update_message_rejects_invalid_category_id_type() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [message]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="category_id must be a positive integer."):
        await service.update_message(message_id=message.id, updates={"category_id": 0})

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_update_message_rejects_invalid_content_type() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [message]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="content must be a string or null."):
        await service.update_message(message_id=message.id, updates={"content": 123})

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_delete_message_raises_when_telegram_rejects_delete_request() -> None:
    session = _FakeSession()
    message = _build_message()
    session.scalar_values = [message]
    telegram_delete = _FakeTelegramDelete()
    telegram_delete.delete_error = TelegramMessageDeleteError(
        "Telegram rejected message deletion request."
    )
    service = MessageService(
        session=session,  # type: ignore[arg-type]
        user_id=USER_ID,
        telegram_delete=telegram_delete,
    )

    with pytest.raises(TelegramMessageDeleteError, match="Telegram rejected message deletion request."):
        await service.delete_message(message_id=message.id)

    assert session.delete_calls == []
    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_bulk_delete_messages_rejects_non_positive_ids() -> None:
    session = _FakeSession()
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="message_ids must contain only positive integers."):
        await service.bulk_delete_messages(message_ids=[1, True])


@pytest.mark.asyncio
async def test_bulk_move_messages_reports_multiple_missing_ids() -> None:
    session = _FakeSession()
    first = _build_message(message_id=1, telegram_id=1001, category_id=1)
    destination = Category(
        id=2,
        user_id=USER_ID,
        name="Category 2",
        normalized_name="category 2",
        slug="cat-2",
        icon="archive",
        color="#14B8A6",
        position=2,
        is_default=False,
    )
    session.scalar_values = [destination]
    session.scalars_values = [[first]]
    service = MessageService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(MessageNotFoundError, match="Messages 9, 10 were not found."):
        await service.bulk_move_messages(message_ids=[1, 9, 10], category_id=2)
