"""Service layer for message CRUD operations."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Mapping, Protocol, Sequence

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from telethon.errors import RPCError

from app.models import Category, Message, Tag
from app.telegram.client import telegram_client_manager


class MessageNotFoundError(RuntimeError):
    """Raised when a message does not exist."""


class CategoryNotFoundError(RuntimeError):
    """Raised when a category does not exist."""


class TelegramClientNotConnectedError(RuntimeError):
    """Raised when Telegram deletion is attempted without an active connection."""


class TelegramMessageDeleteError(RuntimeError):
    """Raised when Telegram message deletion fails."""


class TelegramDeleteClientProtocol(Protocol):
    """Telethon client methods used for message deletion."""

    async def delete_messages(self, entity: str, message_ids: Sequence[int] | int) -> Any: ...


class TelegramDeleteManagerProtocol(Protocol):
    """Telegram manager methods used for message deletion."""

    def get_connected_client(self) -> TelegramDeleteClientProtocol | None: ...


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
    manager: TelegramDeleteManagerProtocol = telegram_client_manager

    async def list_messages(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        sort: MessageSort = MessageSort.DATE_DESC,
        category_slug: str | None = None,
        tag_names: Sequence[str] | None = None,
        search: str | None = None,
    ) -> MessageListResult:
        """List messages with pagination and sorting."""

        if page <= 0:
            raise ValueError("page must be greater than zero.")
        if per_page <= 0:
            raise ValueError("per_page must be greater than zero.")

        normalized_category_slug = category_slug.strip() if category_slug is not None else None
        if normalized_category_slug == "":
            normalized_category_slug = None

        normalized_search = search.strip() if search is not None else None
        if normalized_search == "":
            normalized_search = None

        normalized_tag_names = tuple(
            dict.fromkeys(tag_name.strip() for tag_name in (tag_names or ()) if tag_name.strip())
        )

        order_by = Message.date.desc() if sort == MessageSort.DATE_DESC else Message.date.asc()
        offset = (page - 1) * per_page

        filtered_statement = select(Message)
        if normalized_category_slug is not None:
            filtered_statement = filtered_statement.where(
                Message.category.has(Category.slug == normalized_category_slug)
            )
        if normalized_tag_names:
            filtered_statement = filtered_statement.where(
                Message.tags.any(Tag.name.in_(normalized_tag_names))
            )
        if normalized_search is not None:
            search_pattern = f"%{normalized_search}%"
            filtered_statement = filtered_statement.where(
                or_(
                    Message.content.ilike(search_pattern),
                    Message.url.ilike(search_pattern),
                    Message.sender_name.ilike(search_pattern),
                )
            )

        total_statement = select(func.count()).select_from(filtered_statement.order_by(None).subquery())
        total = await self.session.scalar(total_statement)

        messages_statement = (
            filtered_statement
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

    async def delete_message(self, *, message_id: int, local_only: bool = False) -> None:
        """Delete a message from local storage and optionally from Telegram."""

        message = await self.get_message(message_id=message_id)
        if not local_only:
            await self._delete_telegram_messages(telegram_message_ids=(message.telegram_id,))
        await self.session.delete(message)
        await self.session.commit()

    async def bulk_delete_messages(self, *, message_ids: Sequence[int], local_only: bool = False) -> int:
        """Delete multiple messages from local storage and optionally from Telegram."""

        normalized_message_ids = self._normalize_message_ids(message_ids=message_ids)
        messages = await self._load_messages_by_ids(message_ids=normalized_message_ids)
        if not local_only:
            await self._delete_telegram_messages(
                telegram_message_ids=tuple(message.telegram_id for message in messages),
            )

        for message in messages:
            await self.session.delete(message)

        await self.session.commit()
        return len(messages)

    async def clear_all_messages(self) -> int:
        """Delete all messages from local storage only (does not touch Telegram)."""

        count_statement = select(func.count()).select_from(Message)
        total = await self.session.scalar(count_statement)
        await self.session.execute(delete(Message))
        await self.session.commit()
        return int(total or 0)

    async def bulk_move_messages(self, *, message_ids: Sequence[int], category_id: int) -> int:
        """Move multiple messages to a category."""

        if not isinstance(category_id, int) or isinstance(category_id, bool) or category_id <= 0:
            raise ValueError("category_id must be a positive integer.")

        normalized_message_ids = self._normalize_message_ids(message_ids=message_ids)
        await self._ensure_category_exists(category_id=category_id)
        messages = await self._load_messages_by_ids(message_ids=normalized_message_ids)

        for message in messages:
            message.category_id = category_id

        await self.session.commit()
        return len(messages)

    async def _load_message(self, *, message_id: int) -> Message | None:
        statement = (
            select(Message)
            .options(selectinload(Message.category), selectinload(Message.tags))
            .where(Message.id == message_id)
        )
        return await self.session.scalar(statement)

    async def _load_messages_by_ids(self, *, message_ids: Sequence[int]) -> list[Message]:
        statement = (
            select(Message)
            .options(selectinload(Message.category), selectinload(Message.tags))
            .where(Message.id.in_(message_ids))
        )
        message_rows = await self.session.scalars(statement)
        message_by_id = {message.id: message for message in message_rows}

        missing_ids = [message_id for message_id in message_ids if message_id not in message_by_id]
        if missing_ids:
            raise MessageNotFoundError(self._format_missing_message_error(missing_ids=missing_ids))

        return [message_by_id[message_id] for message_id in message_ids]

    async def _ensure_category_exists(self, *, category_id: int) -> None:
        category = await self.session.get(Category, category_id)
        if category is None:
            raise CategoryNotFoundError(f"Category {category_id} was not found.")

    async def _delete_telegram_messages(self, *, telegram_message_ids: Sequence[int]) -> None:
        client = self.manager.get_connected_client()
        if client is None:
            raise TelegramClientNotConnectedError(
                "Telegram client is not connected. Connect first before deleting messages."
            )

        try:
            await client.delete_messages("me", list(telegram_message_ids))
        except RPCError as exc:
            raise TelegramMessageDeleteError(
                "Telegram rejected message deletion request."
            ) from exc
        except Exception as exc:
            raise TelegramMessageDeleteError("Failed to delete message(s) on Telegram.") from exc

    def _normalize_message_ids(self, *, message_ids: Sequence[int]) -> tuple[int, ...]:
        if not message_ids:
            raise ValueError("message_ids must contain at least one id.")

        normalized_ids: list[int] = []
        seen_ids: set[int] = set()
        for message_id in message_ids:
            if not isinstance(message_id, int) or isinstance(message_id, bool) or message_id <= 0:
                raise ValueError("message_ids must contain only positive integers.")
            if message_id in seen_ids:
                continue
            seen_ids.add(message_id)
            normalized_ids.append(message_id)

        return tuple(normalized_ids)

    @staticmethod
    def _format_missing_message_error(*, missing_ids: Sequence[int]) -> str:
        if len(missing_ids) == 1:
            return f"Message {missing_ids[0]} was not found."

        missing_list = ", ".join(str(message_id) for message_id in missing_ids)
        return f"Messages {missing_list} were not found."
