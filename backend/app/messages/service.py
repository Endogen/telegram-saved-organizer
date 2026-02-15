"""Service layer for message CRUD operations."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Mapping

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Category, Message


class MessageNotFoundError(RuntimeError):
    """Raised when a message does not exist."""


class CategoryNotFoundError(RuntimeError):
    """Raised when a category does not exist."""


class MessageSort(StrEnum):
    """Supported message list sorting modes."""

    DATE_DESC = "date_desc"
    DATE_ASC = "date_asc"


@dataclass(slots=True, frozen=True)
class MessageListResult:
    """Paginated message list result."""

    items: list[Message]
    total: int
    page: int
    per_page: int


@dataclass(slots=True)
class MessageService:
    """CRUD operations for cached Telegram messages."""

    session: AsyncSession

    async def list_messages(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        sort: MessageSort = MessageSort.DATE_DESC,
    ) -> MessageListResult:
        """List messages with pagination and sorting."""

        if page <= 0:
            raise ValueError("page must be greater than zero.")
        if per_page <= 0:
            raise ValueError("per_page must be greater than zero.")

        order_by = Message.date.desc() if sort == MessageSort.DATE_DESC else Message.date.asc()
        offset = (page - 1) * per_page

        total_statement = select(func.count()).select_from(Message)
        total = await self.session.scalar(total_statement)

        messages_statement = (
            select(Message)
            .options(selectinload(Message.category), selectinload(Message.tags))
            .order_by(order_by)
            .offset(offset)
            .limit(per_page)
        )
        message_rows = await self.session.scalars(messages_statement)

        return MessageListResult(
            items=list(message_rows),
            total=int(total or 0),
            page=page,
            per_page=per_page,
        )

    async def get_message(self, *, message_id: int) -> Message:
        """Get a single message by id."""

        message = await self._load_message(message_id=message_id)
        if message is None:
            raise MessageNotFoundError(f"Message {message_id} was not found.")
        return message

    async def update_message(self, *, message_id: int, updates: Mapping[str, Any]) -> Message:
        """Update mutable message fields and return the fresh record."""

        if not updates:
            raise ValueError("At least one update field must be provided.")

        message = await self.get_message(message_id=message_id)

        unknown_fields = set(updates) - {"category_id", "content"}
        if unknown_fields:
            unknown_field_list = ", ".join(sorted(unknown_fields))
            raise ValueError(f"Unsupported update field(s): {unknown_field_list}.")

        if "category_id" in updates:
            raw_category_id = updates["category_id"]
            if not isinstance(raw_category_id, int) or raw_category_id <= 0:
                raise ValueError("category_id must be a positive integer.")
            await self._ensure_category_exists(category_id=raw_category_id)
            message.category_id = raw_category_id

        if "content" in updates:
            raw_content = updates["content"]
            if raw_content is not None and not isinstance(raw_content, str):
                raise ValueError("content must be a string or null.")
            message.content = raw_content

        await self.session.commit()
        return await self.get_message(message_id=message_id)

    async def delete_message(self, *, message_id: int) -> None:
        """Delete a message from local storage."""

        message = await self.get_message(message_id=message_id)
        await self.session.delete(message)
        await self.session.commit()

    async def _load_message(self, *, message_id: int) -> Message | None:
        statement = (
            select(Message)
            .options(selectinload(Message.category), selectinload(Message.tags))
            .where(Message.id == message_id)
        )
        return await self.session.scalar(statement)

    async def _ensure_category_exists(self, *, category_id: int) -> None:
        category = await self.session.get(Category, category_id)
        if category is None:
            raise CategoryNotFoundError(f"Category {category_id} was not found.")
