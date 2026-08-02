from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Message, Tag
from app.tags.service import (
    MessageNotFoundError,
    TagAssignmentNotFoundError,
    TagConflictError,
    TagNotFoundError,
    TagService,
)

USER_ID = "00000000-0000-0000-0000-000000000001"


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
        self.add_calls: list[Any] = []
        self.delete_calls: list[Any] = []
        self.execute_calls: list[Any] = []
        self.commit_calls = 0
        self.rollback_calls = 0
        self.commit_error: Exception | None = None

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

    def add(self, item: Any) -> None:
        self.add_calls.append(item)

    async def delete(self, item: Any) -> None:
        self.delete_calls.append(item)

    async def execute(self, statement: Any) -> None:
        self.execute_calls.append(statement)

    async def commit(self) -> None:
        if self.commit_error is not None:
            raise self.commit_error
        self.commit_calls += 1

    async def rollback(self) -> None:
        self.rollback_calls += 1


def _build_tag(*, tag_id: int = 1, name: str = "Read Later", color: str | None = "#22C55E") -> Tag:
    return Tag(
        id=tag_id,
        user_id=USER_ID,
        name=name,
        normalized_name=name.casefold(),
        color=color,
    )


def _build_message(*, message_id: int = 1, tag_ids: tuple[int, ...] = (1,)) -> Message:
    timestamp = datetime(2026, 2, 1, 10, 0, tzinfo=UTC)
    message = Message(
        id=message_id,
        user_id=USER_ID,
        telegram_id=1000 + message_id,
        content="hello",
        media_type=None,
        file_name=None,
        file_size=None,
        mime_type=None,
        url=None,
        sender_name=None,
        date=timestamp,
        category_id=8,
        raw_data={"id": 1000 + message_id},
        created_at=timestamp,
        updated_at=timestamp,
    )
    message.tags = [_build_tag(tag_id=tag_id, name=f"tag-{tag_id}", color="#22C55E") for tag_id in tag_ids]
    return message


@pytest.mark.asyncio
async def test_list_tags_returns_name_ordered_tags() -> None:
    session = _FakeSession()
    session.scalars_values = [[_build_tag(tag_id=2, name="b"), _build_tag(tag_id=1, name="a")]]

    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]
    result = await service.list_tags()

    assert [tag.name for tag in result] == ["b", "a"]
    statement = str(session.scalars_calls[0])
    assert "WHERE tags.user_id =" in statement
    assert "ORDER BY tags.normalized_name ASC, tags.id ASC" in statement


@pytest.mark.asyncio
async def test_create_tag_normalizes_fields_and_commits() -> None:
    session = _FakeSession()
    session.scalar_values = [None]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    tag = await service.create_tag(name="  Read Later  ", color=" #22c55e ")

    assert tag.name == "Read Later"
    assert tag.color == "#22C55E"
    assert session.add_calls == [tag]
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_create_tag_allows_blank_color_and_stores_null() -> None:
    session = _FakeSession()
    session.scalar_values = [None]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    tag = await service.create_tag(name="Archive", color="   ")

    assert tag.color is None
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_create_tag_raises_conflict_when_name_exists() -> None:
    session = _FakeSession()
    session.scalar_values = [_build_tag(tag_id=9, name="Read Later")]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(TagConflictError, match="already exists"):
        await service.create_tag(name="Read Later", color="#22C55E")

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_delete_tag_removes_tag_and_commits() -> None:
    session = _FakeSession()
    tag = _build_tag(tag_id=3, name="urgent")
    session.scalar_values = [tag]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    await service.delete_tag(tag_id=3)

    assert session.delete_calls == [tag]
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_delete_tag_raises_when_not_found() -> None:
    session = _FakeSession()
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(TagNotFoundError, match="Tag 77 was not found."):
        await service.delete_tag(tag_id=77)

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_add_tags_to_message_appends_missing_tags_and_commits() -> None:
    session = _FakeSession()
    message = _build_message(message_id=7, tag_ids=(1,))
    session.scalar_values = [message]
    first_tag = _build_tag(tag_id=1, name="tag-1")
    second_tag = _build_tag(tag_id=2, name="tag-2")
    session.scalars_values = [[first_tag, second_tag], [1], [first_tag, second_tag]]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    tags = await service.add_tags_to_message(message_id=7, tag_ids=[1, 2, 2])

    assert [tag.id for tag in tags] == [1, 2]
    assert [(link.user_id, link.message_id, link.tag_id) for link in session.add_calls] == [
        (USER_ID, 7, 2)
    ]
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_add_tags_to_message_raises_when_message_missing() -> None:
    session = _FakeSession()
    session.scalar_values = [None]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(MessageNotFoundError, match="Message 404 was not found."):
        await service.add_tags_to_message(message_id=404, tag_ids=[1])

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_add_tags_to_message_raises_when_any_tag_missing() -> None:
    session = _FakeSession()
    session.scalar_values = [_build_message(message_id=4, tag_ids=())]
    session.scalars_values = [[_build_tag(tag_id=3, name="x")]]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(TagNotFoundError, match="Tag 9 was not found."):
        await service.add_tags_to_message(message_id=4, tag_ids=[3, 9])

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_remove_tag_from_message_updates_assignments_and_commits() -> None:
    session = _FakeSession()
    message = _build_message(message_id=8, tag_ids=(2, 5))
    remaining_tag = _build_tag(tag_id=2, name="tag-2")
    session.scalar_values = [message, _build_tag(tag_id=5, name="tag-5"), object()]
    session.scalars_values = [[remaining_tag]]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    tags = await service.remove_tag_from_message(message_id=8, tag_id=5)

    assert [tag.id for tag in tags] == [2]
    assert len(session.execute_calls) == 1
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_remove_tag_from_message_raises_when_assignment_missing() -> None:
    session = _FakeSession()
    message = _build_message(message_id=8, tag_ids=(2,))
    session.scalar_values = [message, _build_tag(tag_id=9, name="tag-9"), None]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(TagAssignmentNotFoundError, match="is not assigned"):
        await service.remove_tag_from_message(message_id=8, tag_id=9)

    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_add_tags_to_message_rejects_invalid_tag_ids() -> None:
    session = _FakeSession()
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="tag_ids must contain at least one id."):
        await service.add_tags_to_message(message_id=1, tag_ids=[])

    with pytest.raises(ValueError, match="tag_ids must be a positive integer."):
        await service.add_tags_to_message(message_id=1, tag_ids=[0])


@pytest.mark.asyncio
async def test_remove_tag_from_message_raises_when_message_missing() -> None:
    session = _FakeSession()
    session.scalar_values = [None]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(MessageNotFoundError, match="Message 12 was not found."):
        await service.remove_tag_from_message(message_id=12, tag_id=2)


@pytest.mark.asyncio
async def test_remove_tag_from_message_raises_when_tag_missing() -> None:
    session = _FakeSession()
    session.scalar_values = [_build_message(message_id=8, tag_ids=(2,))]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(TagNotFoundError, match="Tag 77 was not found."):
        await service.remove_tag_from_message(message_id=8, tag_id=77)


@pytest.mark.asyncio
async def test_add_tags_to_message_reports_multiple_missing_tags() -> None:
    session = _FakeSession()
    session.scalar_values = [_build_message(message_id=4, tag_ids=())]
    session.scalars_values = [[_build_tag(tag_id=3, name="x")]]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(TagNotFoundError, match="Tags 8, 9 were not found."):
        await service.add_tags_to_message(message_id=4, tag_ids=[3, 8, 9])


@pytest.mark.asyncio
async def test_create_tag_rolls_back_and_raises_conflict_on_integrity_error() -> None:
    session = _FakeSession()
    session.scalar_values = [None]
    session.commit_error = IntegrityError("insert", {}, Exception("duplicate"))
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(TagConflictError, match="Tag name already exists."):
        await service.create_tag(name="Archive", color="#22C55E")

    assert session.rollback_calls == 1


@pytest.mark.asyncio
async def test_create_tag_rejects_non_string_name() -> None:
    session = _FakeSession()
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="name must be a string."):
        await service.create_tag(name=123)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_create_tag_rejects_blank_name() -> None:
    session = _FakeSession()
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="name must not be empty."):
        await service.create_tag(name="   ")


@pytest.mark.asyncio
async def test_create_tag_accepts_none_color() -> None:
    session = _FakeSession()
    session.scalar_values = [None]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    tag = await service.create_tag(name="Archive")

    assert tag.color is None


@pytest.mark.asyncio
async def test_create_tag_rejects_non_string_color() -> None:
    session = _FakeSession()
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="color must be a string or null."):
        await service.create_tag(name="Archive", color=123)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_create_tag_rejects_invalid_color_pattern() -> None:
    session = _FakeSession()
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="color must be a valid hex value like #22C55E."):
        await service.create_tag(name="Archive", color="#GGGGGG")


@pytest.mark.asyncio
async def test_ensure_name_available_excludes_specific_tag_id() -> None:
    session = _FakeSession()
    session.scalar_values = [None]
    service = TagService(session=session, user_id=USER_ID)  # type: ignore[arg-type]

    await service._ensure_name_available(name="Archive", exclude_tag_id=9)

    assert "tags.id !=" in str(session.scalar_calls[0])
