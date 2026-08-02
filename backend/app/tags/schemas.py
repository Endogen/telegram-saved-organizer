"""Pydantic schemas for tag endpoints."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

HEX_COLOR_REGEX = r"^#[0-9A-Fa-f]{6}$"
PositiveIdentifier = Annotated[int, Field(gt=0, strict=True)]


class TagResponse(BaseModel):
    """Tag payload returned by read/create endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str | None


class TagCreateRequest(BaseModel):
    """Request payload for creating tags."""

    name: Annotated[str, Field(min_length=1, max_length=100)]
    color: Annotated[str, Field(pattern=HEX_COLOR_REGEX)] | None = None


class TagDeleteResponse(BaseModel):
    """Deletion confirmation payload."""

    deleted: bool = True


class MessageTagsUpdateRequest(BaseModel):
    """Request payload for adding tags to a message."""

    tag_ids: list[PositiveIdentifier] = Field(min_length=1, max_length=100)


class MessageTagsResponse(BaseModel):
    """Message payload containing attached tags."""

    message_id: PositiveIdentifier
    tags: list[TagResponse]
