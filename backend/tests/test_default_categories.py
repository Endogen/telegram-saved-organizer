from __future__ import annotations

import pytest

from app.default_categories import DEFAULT_CATEGORIES, seed_default_categories
from app.models import Category


USER_ID = "00000000-0000-4000-8000-000000000001"


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
        self.flush_calls = 0
        self.scalars_calls: list[object] = []

    async def scalars(self, statement):
        self.scalars_calls.append(statement)
        return _ScalarResult(self._existing_categories)

    def add_all(self, categories: list[Category]) -> None:
        self.added_categories.extend(categories)

    async def commit(self) -> None:
        self.commit_calls += 1

    async def flush(self) -> None:
        self.flush_calls += 1


def _build_category(seed_slug: str, *, user_id: str = USER_ID) -> Category:
    seed = next(item for item in DEFAULT_CATEGORIES if item.slug == seed_slug)
    return Category(
        user_id=user_id,
        name=seed.name,
        normalized_name=seed.name.casefold(),
        slug=seed.slug,
        system_key=seed.slug,
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

    created_categories = await seed_default_categories(session, user_id=USER_ID)

    assert len(session.scalars_calls) == 1
    statement = session.scalars_calls[0]
    assert "categories.user_id =" in str(statement)
    assert USER_ID in statement.compile().params.values()
    assert session.commit_calls == 0
    assert session.flush_calls == 1
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
    assert all(category.user_id == USER_ID for category in created_categories)
    assert all(category.normalized_name == category.name.casefold() for category in created_categories)
    assert all(category.system_key == category.slug for category in created_categories)


@pytest.mark.asyncio
async def test_seed_default_categories_is_idempotent_when_defaults_exist() -> None:
    existing_categories = [_build_category(seed.slug) for seed in DEFAULT_CATEGORIES]
    session = _FakeSession(existing_categories=existing_categories)

    created_categories = await seed_default_categories(session, user_id=USER_ID)

    assert created_categories == []
    assert session.added_categories == []
    assert session.commit_calls == 0
    assert session.flush_calls == 0
