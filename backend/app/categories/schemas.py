"""Pydantic schemas for category endpoints."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.categories.service import CategoryDeleteResult, CategoryWithCount
from app.identifiers import MAX_DATABASE_INTEGER

HEX_COLOR_REGEX = r"^#[0-9A-Fa-f]{6}$"


class CategoryResponse(BaseModel):
    """Category payload returned by create and update endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    system_key: str | None = None
    icon: str
    color: str
    position: int
    is_default: bool


class CategoryWithCountResponse(CategoryResponse):
    """Category payload enriched with message count."""

    message_count: int = Field(ge=0)

    @classmethod
    def from_result(cls, result: CategoryWithCount) -> "CategoryWithCountResponse":
        category = result.category
        return cls(
            id=category.id,
            name=category.name,
            slug=category.slug,
            system_key=category.system_key,
            icon=category.icon,
            color=category.color,
            position=category.position,
            is_default=category.is_default,
            message_count=result.message_count,
        )


NameField = Annotated[str, Field(min_length=1, max_length=100)]
IconField = Annotated[str, Field(min_length=1, max_length=50)]
ColorField = Annotated[str, Field(pattern=HEX_COLOR_REGEX)]


class CategoryCreateRequest(BaseModel):
    """Request payload for creating categories."""

    name: NameField
    icon: IconField
    color: ColorField
    position: int | None = Field(
        default=None, ge=0, le=MAX_DATABASE_INTEGER, strict=True
    )


class CategoryUpdateRequest(BaseModel):
    """Request payload for updating categories."""

    # A ``None`` default makes each field optional to omit, while the non-null
    # annotation rejects an explicit JSON null for values that the database does
    # not allow to be cleared.
    name: NameField = None  # type: ignore[assignment]
    icon: IconField = None  # type: ignore[assignment]
    color: ColorField = None  # type: ignore[assignment]
    position: int = Field(  # type: ignore[arg-type]
        default=None, ge=0, le=MAX_DATABASE_INTEGER, strict=True
    )

    @model_validator(mode="after")
    def validate_has_update_fields(self) -> "CategoryUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided.")
        return self


class CategoryDeleteResponse(BaseModel):
    """Deletion confirmation payload."""

    deleted: bool = True
    moved_message_count: int = Field(ge=0)
    destination_category_id: int = Field(gt=0)

    @classmethod
    def from_result(cls, result: CategoryDeleteResult) -> "CategoryDeleteResponse":
        return cls(
            moved_message_count=result.moved_message_count,
            destination_category_id=result.destination_category_id,
        )
