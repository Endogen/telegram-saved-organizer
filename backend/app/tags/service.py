"""Service layer for tag management."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Sequence

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Message, Tag

HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-F]{6}$")


class TagNotFoundError(RuntimeError):
    """Raised when a tag does not exist."""


class TagConflictError(RuntimeError):
    """Raised when tag uniqueness constraints are violated."""


class MessageNotFoundError(RuntimeError):
    """Raised when a message does not exist."""


class TagAssignmentNotFoundError(RuntimeError):
    """Raised when a message does not contain the requested tag."""


@dataclass(slots=True)
class TagService:
    """CRUD operations for tags and message-tag associations."""

    session: AsyncSession

    async def list_tags(self) -> list[Tag]:
        """Return all tags ordered by name."""

        statement = select(Tag).order_by(func.lower(Tag.name).asc(), Tag.id.asc())
        tag_rows = await self.session.scalars(statement)
        return list(tag_rows)

    async def create_tag(self, *, name: str, color: str | None = None) -> Tag:
        """Create a tag."""

        normalized_name = self._normalize_name(name)
        normalized_color = self._normalize_color(color)
        await self._ensure_name_available(name=normalized_name, exclude_tag_id=None)

        tag = Tag(name=normalized_name, color=normalized_color)
        self.session.add(tag)
        await self._commit_with_conflict_handling()
        return tag

    async def delete_tag(self, *, tag_id: int) -> None:
        """Delete a tag."""

        normalized_tag_id = self._normalize_positive_int(value=tag_id, field_name="tag_id")
        tag = await self._load_tag(tag_id=normalized_tag_id)
        if tag is None:
            raise TagNotFoundError(f"Tag {normalized_tag_id} was not found.")

        await self.session.delete(tag)
        await self._commit_with_conflict_handling()

    async def add_tags_to_message(self, *, message_id: int, tag_ids: Sequence[int]) -> list[Tag]:
        """Attach one or more tags to a message."""

        normalized_message_id = self._normalize_positive_int(value=message_id, field_name="message_id")
        normalized_tag_ids = self._normalize_tag_ids(tag_ids=tag_ids)

        message = await self._load_message(message_id=normalized_message_id)
        if message is None:
            raise MessageNotFoundError(f"Message {normalized_message_id} was not found.")

        tags = await self._load_tags_by_ids(tag_ids=normalized_tag_ids)
        existing_tag_ids = {tag.id for tag in message.tags}
        for tag in tags:
            if tag.id not in existing_tag_ids:
                message.tags.append(tag)

        await self._commit_with_conflict_handling()
        return sorted(message.tags, key=lambda item: item.id)

    async def remove_tag_from_message(self, *, message_id: int, tag_id: int) -> list[Tag]:
        """Remove a tag from a message."""

        normalized_message_id = self._normalize_positive_int(value=message_id, field_name="message_id")
        normalized_tag_id = self._normalize_positive_int(value=tag_id, field_name="tag_id")

        message = await self._load_message(message_id=normalized_message_id)
        if message is None:
            raise MessageNotFoundError(f"Message {normalized_message_id} was not found.")

        tag = await self._load_tag(tag_id=normalized_tag_id)
        if tag is None:
            raise TagNotFoundError(f"Tag {normalized_tag_id} was not found.")

        if not any(existing_tag.id == normalized_tag_id for existing_tag in message.tags):
            raise TagAssignmentNotFoundError(
                f"Tag {normalized_tag_id} is not assigned to message {normalized_message_id}."
            )

        message.tags = [existing_tag for existing_tag in message.tags if existing_tag.id != normalized_tag_id]
        await self._commit_with_conflict_handling()
        return sorted(message.tags, key=lambda item: item.id)

    async def _load_message(self, *, message_id: int) -> Message | None:
        statement = select(Message).options(selectinload(Message.tags)).where(Message.id == message_id)
        return await self.session.scalar(statement)

    async def _load_tag(self, *, tag_id: int) -> Tag | None:
        return await self.session.get(Tag, tag_id)

    async def _load_tags_by_ids(self, *, tag_ids: Sequence[int]) -> list[Tag]:
        statement = select(Tag).where(Tag.id.in_(tag_ids))
        tag_rows = await self.session.scalars(statement)
        tag_by_id = {tag.id: tag for tag in tag_rows}

        missing_ids = [tag_id for tag_id in tag_ids if tag_id not in tag_by_id]
        if missing_ids:
            raise TagNotFoundError(self._format_missing_tag_error(missing_ids=missing_ids))

        return [tag_by_id[tag_id] for tag_id in tag_ids]

    async def _ensure_name_available(self, *, name: str, exclude_tag_id: int | None) -> None:
        statement = select(Tag).where(func.lower(Tag.name) == name.lower())
        if exclude_tag_id is not None:
            statement = statement.where(Tag.id != exclude_tag_id)
        existing_tag = await self.session.scalar(statement)
        if existing_tag is not None:
            raise TagConflictError(f"Tag name '{name}' already exists.")

    async def _commit_with_conflict_handling(self) -> None:
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise TagConflictError("Tag name already exists.") from exc

    def _normalize_name(self, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("name must be a string.")
        normalized_name = value.strip()
        if not normalized_name:
            raise ValueError("name must not be empty.")
        return normalized_name

    def _normalize_color(self, value: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("color must be a string or null.")
        normalized_color = value.strip().upper()
        if normalized_color == "":
            return None
        if not HEX_COLOR_PATTERN.match(normalized_color):
            raise ValueError("color must be a valid hex value like #22C55E.")
        return normalized_color

    def _normalize_tag_ids(self, *, tag_ids: Sequence[int]) -> tuple[int, ...]:
        if not tag_ids:
            raise ValueError("tag_ids must contain at least one id.")

        normalized_ids: list[int] = []
        seen_ids: set[int] = set()
        for tag_id in tag_ids:
            normalized_tag_id = self._normalize_positive_int(value=tag_id, field_name="tag_ids")
            if normalized_tag_id in seen_ids:
                continue
            seen_ids.add(normalized_tag_id)
            normalized_ids.append(normalized_tag_id)
        return tuple(normalized_ids)

    def _normalize_positive_int(self, *, value: Any, field_name: str) -> int:
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise ValueError(f"{field_name} must be a positive integer.")
        return value

    @staticmethod
    def _format_missing_tag_error(*, missing_ids: Sequence[int]) -> str:
        if len(missing_ids) == 1:
            return f"Tag {missing_ids[0]} was not found."

        missing_list = ", ".join(str(tag_id) for tag_id in missing_ids)
        return f"Tags {missing_list} were not found."

