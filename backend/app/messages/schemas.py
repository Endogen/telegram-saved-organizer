"""Pydantic schemas for message endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.messages.service import MessageListResult


class MessageCategoryResponse(BaseModel):
    """Category summary attached to a message."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    icon: str
    color: str


class MessageTagResponse(BaseModel):
    """Tag summary attached to a message."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str | None


class MessageResponse(BaseModel):
    """Message payload returned by read/update endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    telegram_id: int
    content: str | None
    media_type: str | None
    file_name: str | None
    file_size: int | None
    mime_type: str | None
    url: str | None
    sender_name: str | None
    date: datetime
    category_id: int
    raw_data: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    category: MessageCategoryResponse
    tags: list[MessageTagResponse] = Field(default_factory=list)


class MessageListResponse(BaseModel):
    """Paginated message list response."""

    items: list[MessageResponse]
    total: int
    page: int
    per_page: int

    @classmethod
    def from_result(cls, result: MessageListResult) -> "MessageListResponse":
        return cls(
            items=[MessageResponse.model_validate(message) for message in result.items],
            total=result.total,
            page=result.page,
            per_page=result.per_page,
        )


class MessageUpdateRequest(BaseModel):
    """Updatable message fields."""

    category_id: int | None = Field(default=None, gt=0)
    content: str | None = None

    @model_validator(mode="after")
    def validate_has_update_fields(self) -> "MessageUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided.")
        return self


PositiveIdentifier = Annotated[int, Field(gt=0, strict=True)]


class MessageBulkDeleteRequest(BaseModel):
    """Message id list for bulk delete operations."""

    message_ids: list[PositiveIdentifier] = Field(min_length=1)


class MessageBulkDeleteResponse(BaseModel):
    """Bulk delete summary payload."""

    deleted_count: int = Field(ge=0)


class MessageBulkMoveRequest(BaseModel):
    """Bulk category move request payload."""

    message_ids: list[PositiveIdentifier] = Field(min_length=1)
    category_id: PositiveIdentifier


class MessageBulkMoveResponse(BaseModel):
    """Bulk category move summary payload."""

    moved_count: int = Field(ge=0)
    category_id: PositiveIdentifier


class MessageDeleteResponse(BaseModel):
    """Confirmation payload for message deletion."""

    deleted: bool = True
