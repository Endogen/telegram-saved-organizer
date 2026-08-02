from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

import pytest
from fastapi import Depends
from httpx import ASGITransport, AsyncClient

from app.accounts.dependencies import get_current_user
from app.categories.router import get_category_service
from app.categories.service import (
    CategoryConflictError,
    CategoryDeleteResult,
    CategoryNotFoundError,
    CategoryProtectedError,
    CategoryService,
    CategoryWithCount,
)
from app.main import create_app
from app.models import User


USER_ID = "00000000-0000-4000-8000-000000000001"


@dataclass(slots=True)
class _FakeCategory:
    id: int
    name: str
    slug: str
    icon: str
    color: str
    position: int
    is_default: bool
    system_key: str | None = None


class _FakeCategoryService:
    def __init__(self) -> None:
        self.list_calls = 0
        self.create_calls: list[dict[str, Any]] = []
        self.update_calls: list[tuple[int, dict[str, Any]]] = []
        self.delete_calls: list[int] = []

        self.list_error: Exception | None = None
        self.create_error: Exception | None = None
        self.update_error: Exception | None = None
        self.delete_error: Exception | None = None

        self.category = _build_category()
        self.list_result = [CategoryWithCount(category=self.category, message_count=4)]
        self.create_result = self.category
        self.update_result = self.category
        self.delete_result = CategoryDeleteResult(
            moved_message_count=0, destination_category_id=8
        )

    async def list_categories(self) -> list[CategoryWithCount]:
        self.list_calls += 1
        if self.list_error is not None:
            raise self.list_error
        return self.list_result

    async def create_category(
        self,
        *,
        name: str,
        icon: str,
        color: str,
        position: int | None = None,
    ) -> _FakeCategory:
        self.create_calls.append(
            {
                "name": name,
                "icon": icon,
                "color": color,
                "position": position,
            }
        )
        if self.create_error is not None:
            raise self.create_error
        return self.create_result

    async def update_category(
        self, *, category_id: int, updates: dict[str, Any]
    ) -> _FakeCategory:
        self.update_calls.append((category_id, updates))
        if self.update_error is not None:
            raise self.update_error
        return self.update_result

    async def delete_category(self, *, category_id: int) -> CategoryDeleteResult:
        self.delete_calls.append(category_id)
        if self.delete_error is not None:
            raise self.delete_error
        return self.delete_result


def _build_category() -> _FakeCategory:
    return _FakeCategory(
        id=3,
        name="Links",
        slug="links",
        icon="link",
        color="#0EA5E9",
        position=3,
        is_default=True,
        system_key="links",
    )


def _build_user() -> User:
    return User(
        id=USER_ID,
        email="owner@example.com",
        normalized_email="owner@example.com",
        display_name="Owner",
        password_hash="test-password-hash",
    )


@pytest.fixture
def category_context() -> tuple[Any, _FakeCategoryService]:
    service = _FakeCategoryService()
    user = _build_user()
    app = create_app(check_migrations=False)

    async def override_current_user() -> User:
        return user

    async def override_category_service(
        authenticated_user: Annotated[User, Depends(get_current_user)],
    ) -> _FakeCategoryService:
        assert authenticated_user.id == USER_ID
        return service

    app.dependency_overrides[get_current_user] = override_current_user
    app.dependency_overrides[get_category_service] = override_category_service
    yield app, service
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_list_categories_endpoint_returns_categories_with_counts(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/categories")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": 3,
            "name": "Links",
            "slug": "links",
            "system_key": "links",
            "icon": "link",
            "color": "#0EA5E9",
            "position": 3,
            "is_default": True,
            "message_count": 4,
        }
    ]
    assert service.list_calls == 1


@pytest.mark.asyncio
async def test_create_category_endpoint_returns_created_category(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    service.create_result = _FakeCategory(
        id=9,
        name="Read Later",
        slug="read-later",
        icon="bookmark",
        color="#22C55E",
        position=12,
        is_default=False,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/categories",
            json={
                "name": "Read Later",
                "icon": "bookmark",
                "color": "#22C55E",
                "position": 12,
            },
        )

    assert response.status_code == 201
    assert response.json()["id"] == 9
    assert response.json()["slug"] == "read-later"
    assert response.json()["is_default"] is False
    assert response.json()["system_key"] is None
    assert service.create_calls == [
        {
            "name": "Read Later",
            "icon": "bookmark",
            "color": "#22C55E",
            "position": 12,
        }
    ]


@pytest.mark.asyncio
async def test_create_category_endpoint_returns_conflict(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    service.create_error = CategoryConflictError(
        "Category name 'Links' already exists."
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/categories",
            json={"name": "Links", "icon": "link", "color": "#0EA5E9"},
        )

    assert response.status_code == 409
    assert response.json()["detail"] == "Category name 'Links' already exists."


@pytest.mark.asyncio
async def test_create_category_endpoint_returns_bad_request_on_validation_error(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    service.create_error = ValueError("color must be a valid hex value like #22C55E.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/categories",
            json={"name": "Links", "icon": "link", "color": "#22C55E"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "color must be a valid hex value like #22C55E."


@pytest.mark.asyncio
async def test_update_category_endpoint_returns_updated_category(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    service.update_result = _FakeCategory(
        id=3,
        name="Bookmarks",
        slug="bookmarks",
        icon="bookmark",
        color="#22C55E",
        position=5,
        is_default=False,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.patch(
            "/api/categories/3", json={"name": "Bookmarks", "position": 5}
        )

    assert response.status_code == 200
    assert response.json()["name"] == "Bookmarks"
    assert response.json()["slug"] == "bookmarks"
    assert service.update_calls == [(3, {"name": "Bookmarks", "position": 5})]


@pytest.mark.asyncio
async def test_update_category_endpoint_returns_not_found(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    service.update_error = CategoryNotFoundError("Category 404 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.patch("/api/categories/404", json={"name": "Ghost"})

    assert response.status_code == 404
    assert response.json()["detail"] == "Category 404 was not found."


@pytest.mark.asyncio
async def test_update_category_endpoint_returns_conflict(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    service.update_error = CategoryConflictError(
        "Category slug 'links' already exists."
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.patch("/api/categories/3", json={"name": "Links"})

    assert response.status_code == 409
    assert response.json()["detail"] == "Category slug 'links' already exists."


@pytest.mark.asyncio
async def test_update_category_endpoint_returns_bad_request_on_validation_error(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    service.update_error = ValueError("position must be a non-negative integer.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.patch("/api/categories/3", json={"position": 1})

    assert response.status_code == 400
    assert response.json()["detail"] == "position must be a non-negative integer."


@pytest.mark.asyncio
async def test_update_category_endpoint_rejects_empty_payload(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.patch("/api/categories/3", json={})

    assert response.status_code == 422
    assert service.update_calls == []


@pytest.mark.asyncio
async def test_delete_category_endpoint_returns_move_summary(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    service.delete_result = CategoryDeleteResult(
        moved_message_count=6, destination_category_id=8
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/categories/3")

    assert response.status_code == 200
    assert response.json() == {
        "deleted": True,
        "moved_message_count": 6,
        "destination_category_id": 8,
    }
    assert service.delete_calls == [3]


@pytest.mark.asyncio
async def test_delete_category_endpoint_rejects_protected_category(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    service.delete_error = CategoryProtectedError("Category 'other' cannot be deleted.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/categories/8")

    assert response.status_code == 400
    assert response.json()["detail"] == "Category 'other' cannot be deleted."


@pytest.mark.asyncio
async def test_delete_category_endpoint_returns_not_found(
    category_context: tuple[Any, _FakeCategoryService],
) -> None:
    app, service = category_context
    service.delete_error = CategoryNotFoundError("Category 404 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/categories/404")

    assert response.status_code == 404
    assert response.json()["detail"] == "Category 404 was not found."


@pytest.mark.asyncio
async def test_get_category_service_dependency_returns_category_service() -> None:
    session = object()
    user = _build_user()

    service = await get_category_service(session=session, user=user)  # type: ignore[arg-type]

    assert isinstance(service, CategoryService)
    assert service.session is session
    assert service.user_id == USER_ID
