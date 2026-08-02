"""Service layer for tag management."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Message, MessageTag, Tag

HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-F]{6}$")


class TagNotFoundError(RuntimeError):
    """Raised when a tag does not exist."""


class TagConflictError(RuntimeError):
    """Raised when tag uniqueness constraints are violated."""


class MessageNotFoundError(RuntimeError):
    """Raised when a message does not exist."""


class TagAssignmentNotFoundError(RuntimeError):
    """Raised when a message does not contain the requested tag."""


@dataclass(slots=True, frozen=True)
class TagWithCount:
    """Tag paired with its number of message assignments."""

    tag: Tag
    message_count: int


@dataclass(slots=True)
class TagService:
    """CRUD operations for tags and message-tag associations."""

    session: AsyncSession
    user_id: str

    async def list_tags(self) -> list[Tag]:
        """Return all tags ordered by name."""

        statement = (
            select(Tag)
            .where(Tag.user_id == self.user_id)
            .order_by(Tag.normalized_name.asc(), Tag.id.asc())
        )
        tag_rows = await self.session.scalars(statement)
        return list(tag_rows)

    async def list_tags_with_counts(self) -> list[TagWithCount]:
        """Return all tags ordered by name with assignment counts."""

        statement = (
            select(Tag, func.count(MessageTag.message_id))
            .outerjoin(
                MessageTag,
                (MessageTag.user_id == Tag.user_id) & (MessageTag.tag_id == Tag.id),
            )
            .where(Tag.user_id == self.user_id)
            .group_by(Tag.id)
            .order_by(Tag.normalized_name.asc(), Tag.id.asc())
        )
        rows = await self.session.execute(statement)
        return [
            TagWithCount(tag=tag, message_count=int(message_count or 0))
            for tag, message_count in rows.all()
        ]

    async def create_tag(self, *, name: str, color: str | None = None) -> Tag:
        """Create a tag."""

        normalized_name = self._normalize_name(name)
        normalized_color = self._normalize_color(color)
        await self._ensure_name_available(name=normalized_name, exclude_tag_id=None)

        tag = Tag(
            user_id=self.user_id,
            name=normalized_name,
            normalized_name=normalized_name.casefold(),
            color=normalized_color,
        )
        self.session.add(tag)
        await self._commit_with_conflict_handling()
        return tag

    async def update_tag(self, *, tag_id: int, updates: Mapping[str, Any]) -> Tag:
        """Update a tag's mutable fields."""

        normalized_tag_id = self._normalize_positive_int(value=tag_id, field_name="tag_id")
        if not updates:
            raise ValueError("At least one update field must be provided.")

        unknown_fields = set(updates) - {"name", "color"}
        if unknown_fields:
            unknown_field_list = ", ".join(sorted(unknown_fields))
            raise ValueError(f"Unsupported update field(s): {unknown_field_list}.")

        tag = await self._load_tag(tag_id=normalized_tag_id)
        if tag is None:
            raise TagNotFoundError(f"Tag {normalized_tag_id} was not found.")

        if "name" in updates:
            normalized_name = self._normalize_name(updates["name"])
            await self._ensure_name_available(
                name=normalized_name,
                exclude_tag_id=normalized_tag_id,
            )
            tag.name = normalized_name
            tag.normalized_name = normalized_name.casefold()

        if "color" in updates:
            tag.color = self._normalize_color(updates["color"])

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
        existing_tag_ids = set(
            await self.session.scalars(
                select(MessageTag.tag_id).where(
                    MessageTag.user_id == self.user_id,
                    MessageTag.message_id == normalized_message_id,
                )
            )
        )
        for tag in tags:
            if tag.id not in existing_tag_ids:
                self.session.add(
                    MessageTag(
                        user_id=self.user_id,
                        message_id=normalized_message_id,
                        tag_id=tag.id,
                    )
                )

        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            # Two requests may race after both observe the assignment as
            # absent. If the competing request won, the requested final state
            # already exists and this operation is idempotently successful.
            persisted_tags = await self._load_message_tags(message_id=normalized_message_id)
            if set(normalized_tag_ids).issubset({tag.id for tag in persisted_tags}):
                return persisted_tags
            raise TagConflictError("A tag assignment changed concurrently.") from exc
        return await self._load_message_tags(message_id=normalized_message_id)

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

        assignment = await self.session.scalar(
            select(MessageTag).where(
                MessageTag.user_id == self.user_id,
                MessageTag.message_id == normalized_message_id,
                MessageTag.tag_id == normalized_tag_id,
            )
        )
        if assignment is None:
            raise TagAssignmentNotFoundError(
                f"Tag {normalized_tag_id} is not assigned to message {normalized_message_id}."
            )

        await self.session.execute(
            delete(MessageTag).where(
                MessageTag.user_id == self.user_id,
                MessageTag.message_id == normalized_message_id,
                MessageTag.tag_id == normalized_tag_id,
            )
        )
        await self._commit_with_conflict_handling()
        return await self._load_message_tags(message_id=normalized_message_id)

    async def _load_message(self, *, message_id: int) -> Message | None:
        statement = (
            select(Message)
            .where(
                Message.user_id == self.user_id,
                Message.id == message_id,
            )
        )
        return await self.session.scalar(statement)

    async def _load_message_tags(self, *, message_id: int) -> list[Tag]:
        statement = (
            select(Tag)
            .join(
                MessageTag,
                (MessageTag.user_id == Tag.user_id) & (MessageTag.tag_id == Tag.id),
            )
            .where(
                MessageTag.user_id == self.user_id,
                MessageTag.message_id == message_id,
            )
            .order_by(Tag.id.asc())
        )
        return list(await self.session.scalars(statement))

    async def _load_tag(self, *, tag_id: int) -> Tag | None:
        return await self.session.scalar(
            select(Tag).where(
                Tag.user_id == self.user_id,
                Tag.id == tag_id,
            )
        )

    async def _load_tags_by_ids(self, *, tag_ids: Sequence[int]) -> list[Tag]:
        statement = select(Tag).where(
            Tag.user_id == self.user_id,
            Tag.id.in_(tag_ids),
        )
        tag_rows = await self.session.scalars(statement)
        tag_by_id = {tag.id: tag for tag in tag_rows}

        missing_ids = [tag_id for tag_id in tag_ids if tag_id not in tag_by_id]
        if missing_ids:
            raise TagNotFoundError(self._format_missing_tag_error(missing_ids=missing_ids))

        return [tag_by_id[tag_id] for tag_id in tag_ids]

    async def _ensure_name_available(self, *, name: str, exclude_tag_id: int | None) -> None:
        statement = select(Tag).where(
            Tag.user_id == self.user_id,
            Tag.normalized_name == name.casefold(),
        )
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
        if len(tag_ids) > 100:
            raise ValueError("tag_ids must not contain more than 100 ids.")

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
