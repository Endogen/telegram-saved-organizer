"""Default category seed data."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Category


@dataclass(frozen=True, slots=True)
class DefaultCategorySeed:
    """Category shape used for default data seeding."""

    name: str
    slug: str
    icon: str
    color: str
    position: int


DEFAULT_CATEGORIES: tuple[DefaultCategorySeed, ...] = (
    DefaultCategorySeed(name="Videos", slug="videos", icon="video", color="#E11D48", position=1),
    DefaultCategorySeed(name="Audio", slug="audio", icon="music", color="#2563EB", position=2),
    DefaultCategorySeed(name="Links", slug="links", icon="link", color="#0EA5E9", position=3),
    DefaultCategorySeed(
        name="Repositories",
        slug="repositories",
        icon="code",
        color="#4F46E5",
        position=4,
    ),
    DefaultCategorySeed(name="Images", slug="images", icon="image", color="#14B8A6", position=5),
    DefaultCategorySeed(
        name="Documents",
        slug="documents",
        icon="file-text",
        color="#F59E0B",
        position=6,
    ),
    DefaultCategorySeed(
        name="Text",
        slug="text",
        icon="message-square",
        color="#6B7280",
        position=7,
    ),
    DefaultCategorySeed(name="Other", slug="other", icon="archive", color="#64748B", position=8),
)


async def seed_default_categories(session: AsyncSession) -> list[Category]:
    """Insert built-in categories that are not already present."""

    default_slugs = [seed.slug for seed in DEFAULT_CATEGORIES]
    existing_categories = await session.scalars(
        select(Category).where(Category.slug.in_(default_slugs))
    )
    existing_slugs = {category.slug for category in existing_categories}

    created_categories: list[Category] = []
    for seed in DEFAULT_CATEGORIES:
        if seed.slug in existing_slugs:
            continue
        created_categories.append(
            Category(
                name=seed.name,
                slug=seed.slug,
                icon=seed.icon,
                color=seed.color,
                position=seed.position,
                is_default=True,
            )
        )

    if created_categories:
        session.add_all(created_categories)
        await session.commit()

    return created_categories
