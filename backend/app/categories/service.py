"""Service layer for category management."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Category, Message

OTHER_CATEGORY_SLUG = "other"
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-F]{6}$")
SLUG_SANITIZE_PATTERN = re.compile(r"[^a-z0-9]+")


class CategoryNotFoundError(RuntimeError):
    """Raised when a category does not exist."""


class CategoryConflictError(RuntimeError):
    """Raised when category uniqueness constraints are violated."""


class CategoryProtectedError(RuntimeError):
    """Raised when an operation targets a protected category."""


@dataclass(slots=True, frozen=True)
class CategoryWithCount:
    """Category paired with message count."""

    category: Category
    message_count: int


@dataclass(slots=True, frozen=True)
class CategoryDeleteResult:
    """Outcome for category deletion with message reassignment."""

    moved_message_count: int
    destination_category_id: int


@dataclass(slots=True)
class CategoryService:
    """CRUD operations for categories."""

    session: AsyncSession

    async def list_categories(self) -> list[CategoryWithCount]:
        """Return categories ordered by position with message counts."""

        statement = (
            select(Category, func.count(Message.id))
            .outerjoin(Message, Message.category_id == Category.id)
            .group_by(Category.id)
            .order_by(Category.position.asc(), Category.id.asc())
        )
        rows = await self.session.execute(statement)
        return [
            CategoryWithCount(category=category, message_count=int(message_count or 0))
            for category, message_count in rows.all()
        ]

    async def create_category(
        self,
        *,
        name: str,
        icon: str,
        color: str,
        position: int | None = None,
    ) -> Category:
        """Create a custom category."""

        normalized_name = self._normalize_name(name)
        normalized_icon = self._normalize_icon(icon)
        normalized_color = self._normalize_color(color)
        normalized_slug = self._slugify(normalized_name)
        normalized_position = await self._resolve_position(position=position)

        await self._ensure_name_available(name=normalized_name, exclude_category_id=None)
        await self._ensure_slug_available(slug=normalized_slug, exclude_category_id=None)

        category = Category(
            name=normalized_name,
            slug=normalized_slug,
            icon=normalized_icon,
            color=normalized_color,
            position=normalized_position,
            is_default=False,
        )
        self.session.add(category)
        await self._commit_with_conflict_handling()
        return category

    async def update_category(self, *, category_id: int, updates: Mapping[str, Any]) -> Category:
        """Update mutable category fields."""

        if not updates:
            raise ValueError("At least one update field must be provided.")

        category = await self._load_category(category_id=category_id)
        if category is None:
            raise CategoryNotFoundError(f"Category {category_id} was not found.")

        unknown_fields = set(updates) - {"name", "icon", "color", "position"}
        if unknown_fields:
            unknown_field_list = ", ".join(sorted(unknown_fields))
            raise ValueError(f"Unsupported update field(s): {unknown_field_list}.")

        if "name" in updates:
            normalized_name = self._normalize_name(updates["name"])
            normalized_slug = self._slugify(normalized_name)
            await self._ensure_name_available(name=normalized_name, exclude_category_id=category_id)
            await self._ensure_slug_available(slug=normalized_slug, exclude_category_id=category_id)
            category.name = normalized_name
            category.slug = normalized_slug

        if "icon" in updates:
            category.icon = self._normalize_icon(updates["icon"])

        if "color" in updates:
            category.color = self._normalize_color(updates["color"])

        if "position" in updates:
            category.position = self._normalize_position(updates["position"])

        await self._commit_with_conflict_handling()
        return category

    async def delete_category(self, *, category_id: int) -> CategoryDeleteResult:
        """Delete a category and move its messages to the fallback 'other' category."""

        category = await self._load_category(category_id=category_id)
        if category is None:
            raise CategoryNotFoundError(f"Category {category_id} was not found.")
        if category.slug == OTHER_CATEGORY_SLUG:
            raise CategoryProtectedError("Category 'other' cannot be deleted.")

        fallback_category = await self._load_fallback_category(excluded_category_id=category.id)
        if fallback_category is None:
            raise CategoryNotFoundError(
                "Fallback category 'other' was not found. Re-seed default categories before deleting."
            )

        update_result = await self.session.execute(
            update(Message)
            .where(Message.category_id == category.id)
            .values(category_id=fallback_category.id)
        )
        moved_message_count = max(int(update_result.rowcount or 0), 0)

        await self.session.delete(category)
        await self._commit_with_conflict_handling()
        return CategoryDeleteResult(
            moved_message_count=moved_message_count,
            destination_category_id=fallback_category.id,
        )

    async def _load_category(self, *, category_id: int) -> Category | None:
        return await self.session.get(Category, category_id)

    async def _load_fallback_category(self, *, excluded_category_id: int) -> Category | None:
        statement = select(Category).where(
            Category.slug == OTHER_CATEGORY_SLUG,
            Category.id != excluded_category_id,
        )
        return await self.session.scalar(statement)

    async def _ensure_name_available(self, *, name: str, exclude_category_id: int | None) -> None:
        statement = select(Category).where(func.lower(Category.name) == name.lower())
        if exclude_category_id is not None:
            statement = statement.where(Category.id != exclude_category_id)
        existing_category = await self.session.scalar(statement)
        if existing_category is not None:
            raise CategoryConflictError(f"Category name '{name}' already exists.")

    async def _ensure_slug_available(self, *, slug: str, exclude_category_id: int | None) -> None:
        statement = select(Category).where(Category.slug == slug)
        if exclude_category_id is not None:
            statement = statement.where(Category.id != exclude_category_id)
        existing_category = await self.session.scalar(statement)
        if existing_category is not None:
            raise CategoryConflictError(f"Category slug '{slug}' already exists.")

    async def _resolve_position(self, *, position: int | None) -> int:
        if position is not None:
            return self._normalize_position(position)

        max_position = await self.session.scalar(select(func.max(Category.position)))
        return int(max_position or 0) + 1

    async def _commit_with_conflict_handling(self) -> None:
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise CategoryConflictError("Category name or slug already exists.") from exc

    def _normalize_name(self, value: Any) -> str:
        return self._normalize_non_empty_string(value=value, field_name="name")

    def _normalize_icon(self, value: Any) -> str:
        return self._normalize_non_empty_string(value=value, field_name="icon")

    def _normalize_non_empty_string(self, *, value: Any, field_name: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{field_name} must be a string.")
        normalized_value = value.strip()
        if not normalized_value:
            raise ValueError(f"{field_name} must not be empty.")
        return normalized_value

    def _normalize_color(self, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("color must be a string.")
        normalized_color = value.strip().upper()
        if not HEX_COLOR_PATTERN.match(normalized_color):
            raise ValueError("color must be a valid hex value like #22C55E.")
        return normalized_color

    def _normalize_position(self, value: Any) -> int:
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError("position must be a non-negative integer.")
        return value

    def _slugify(self, value: str) -> str:
        slug = SLUG_SANITIZE_PATTERN.sub("-", value.lower()).strip("-")
        if not slug:
            raise ValueError("name must include at least one alphanumeric character.")
        return slug
