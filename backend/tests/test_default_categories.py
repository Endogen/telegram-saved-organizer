from __future__ import annotations

import pytest

from app.default_categories import DEFAULT_CATEGORIES, seed_default_categories
from app.models import Category


class _ScalarResult:
    def __init__(self, rows: list[Category]) -> None:
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


class _FakeSession:
    def __init__(self, existing_categories: list[Category]) -> None:
        self._existing_categories = existing_categories
        self.added_categories: list[Category] = []
        self.commit_calls = 0
        self.scalars_calls = 0

    async def scalars(self, _statement):
        self.scalars_calls += 1
        return _ScalarResult(self._existing_categories)

    def add_all(self, categories: list[Category]) -> None:
        self.added_categories.extend(categories)

    async def commit(self) -> None:
        self.commit_calls += 1


def _build_category(seed_slug: str) -> Category:
    seed = next(item for item in DEFAULT_CATEGORIES if item.slug == seed_slug)
    return Category(
        name=seed.name,
        slug=seed.slug,
        icon=seed.icon,
        color=seed.color,
        position=seed.position,
        is_default=True,
    )


def test_default_categories_match_spec_order() -> None:
    assert [category.slug for category in DEFAULT_CATEGORIES] == [
        "videos",
        "audio",
        "links",
        "repositories",
        "images",
        "documents",
        "text",
        "other",
    ]


@pytest.mark.asyncio
async def test_seed_default_categories_only_creates_missing_entries() -> None:
    session = _FakeSession(existing_categories=[_build_category("videos"), _build_category("audio")])

    created_categories = await seed_default_categories(session)

    assert session.scalars_calls == 1
    assert session.commit_calls == 1
    assert session.added_categories == created_categories
    assert [category.slug for category in created_categories] == [
        "links",
        "repositories",
        "images",
        "documents",
        "text",
        "other",
    ]
    assert all(category.is_default for category in created_categories)


@pytest.mark.asyncio
async def test_seed_default_categories_is_idempotent_when_defaults_exist() -> None:
    existing_categories = [_build_category(seed.slug) for seed in DEFAULT_CATEGORIES]
    session = _FakeSession(existing_categories=existing_categories)

    created_categories = await seed_default_categories(session)

    assert created_categories == []
    assert session.added_categories == []
    assert session.commit_calls == 0
