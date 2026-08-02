"""Pydantic schemas for tag endpoints."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.tags.service import TagWithCount

HEX_COLOR_REGEX = r"^#[0-9A-Fa-f]{6}$"
MAX_DB_IDENTIFIER = 2**63 - 1
PositiveIdentifier = Annotated[int, Field(gt=0, le=MAX_DB_IDENTIFIER, strict=True)]


class TagResponse(BaseModel):
    """Tag payload returned by read/create endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str | None


class TagWithCountResponse(TagResponse):
    """Tag payload enriched with its number of message assignments."""

    message_count: int = Field(ge=0)

    @classmethod
    def from_result(cls, result: TagWithCount) -> "TagWithCountResponse":
        return cls(
            id=result.tag.id,
            name=result.tag.name,
            color=result.tag.color,
            message_count=result.message_count,
        )


class TagCreateRequest(BaseModel):
    """Request payload for creating tags."""

    name: Annotated[str, Field(min_length=1, max_length=100)]
    color: Annotated[str, Field(pattern=HEX_COLOR_REGEX)] | None = None


class TagUpdateRequest(BaseModel):
    """Request payload for updating tags."""

    name: Annotated[str, Field(min_length=1, max_length=100)] = None  # type: ignore[assignment]
    color: Annotated[str, Field(pattern=HEX_COLOR_REGEX)] | None = None

    @model_validator(mode="after")
    def validate_has_update_fields(self) -> "TagUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided.")
        return self


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


class MessageBulkTagRequest(BaseModel):
    """Request payload for attaching tags to several messages."""

    message_ids: list[PositiveIdentifier] = Field(min_length=1, max_length=200)
    tag_ids: list[PositiveIdentifier] = Field(min_length=1, max_length=100)

    @field_validator("message_ids", "tag_ids")
    @classmethod
    def deduplicate_ids(cls, values: list[int]) -> list[int]:
        return list(dict.fromkeys(values))


class MessageBulkTagResponse(BaseModel):
    """Compact summary of newly created tag assignments."""

    updated_count: int = Field(ge=0)
    assignment_count: int = Field(ge=0)
