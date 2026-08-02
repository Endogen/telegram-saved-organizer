from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.tags.router import get_tag_service
from app.tags.service import (
    MessageNotFoundError,
    TagAssignmentNotFoundError,
    TagConflictError,
    TagNotFoundError,
    TagService,
)


@dataclass(slots=True)
class _FakeTag:
    id: int
    name: str
    color: str | None


class _FakeTagService:
    def __init__(self) -> None:
        self.list_calls = 0
        self.create_calls: list[dict[str, Any]] = []
        self.delete_calls: list[int] = []
        self.add_calls: list[tuple[int, tuple[int, ...]]] = []
        self.remove_calls: list[tuple[int, int]] = []

        self.list_error: Exception | None = None
        self.create_error: Exception | None = None
        self.delete_error: Exception | None = None
        self.add_error: Exception | None = None
        self.remove_error: Exception | None = None

        self.tags_result = [
            _FakeTag(id=2, name="read-later", color="#22C55E"),
            _FakeTag(id=3, name="urgent", color=None),
        ]
        self.create_result = _FakeTag(id=4, name="archive", color="#14B8A6")
        self.add_result = self.tags_result
        self.remove_result = [_FakeTag(id=2, name="read-later", color="#22C55E")]

    async def list_tags(self) -> list[_FakeTag]:
        self.list_calls += 1
        if self.list_error is not None:
            raise self.list_error
        return self.tags_result

    async def create_tag(self, *, name: str, color: str | None = None) -> _FakeTag:
        self.create_calls.append({"name": name, "color": color})
        if self.create_error is not None:
            raise self.create_error
        return self.create_result

    async def delete_tag(self, *, tag_id: int) -> None:
        self.delete_calls.append(tag_id)
        if self.delete_error is not None:
            raise self.delete_error

    async def add_tags_to_message(self, *, message_id: int, tag_ids: list[int]) -> list[_FakeTag]:
        self.add_calls.append((message_id, tuple(tag_ids)))
        if self.add_error is not None:
            raise self.add_error
        return self.add_result

    async def remove_tag_from_message(self, *, message_id: int, tag_id: int) -> list[_FakeTag]:
        self.remove_calls.append((message_id, tag_id))
        if self.remove_error is not None:
            raise self.remove_error
        return self.remove_result


@pytest.fixture
def tag_context() -> tuple[Any, _FakeTagService]:
    service = _FakeTagService()
    app = create_app(api_token=None)

    async def override_tag_service() -> _FakeTagService:
        return service

    app.dependency_overrides[get_tag_service] = override_tag_service
    yield app, service
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_list_tags_endpoint_returns_tags(tag_context: tuple[Any, _FakeTagService]) -> None:
    app, service = tag_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == [
        {"id": 2, "name": "read-later", "color": "#22C55E"},
        {"id": 3, "name": "urgent", "color": None},
    ]
    assert service.list_calls == 1


@pytest.mark.asyncio
async def test_create_tag_endpoint_returns_created_tag(tag_context: tuple[Any, _FakeTagService]) -> None:
    app, service = tag_context
    service.create_result = _FakeTag(id=9, name="archive", color="#14B8A6")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/tags", json={"name": "archive", "color": "#14B8A6"})

    assert response.status_code == 201
    assert response.json() == {"id": 9, "name": "archive", "color": "#14B8A6"}
    assert service.create_calls == [{"name": "archive", "color": "#14B8A6"}]


@pytest.mark.asyncio
async def test_create_tag_endpoint_returns_conflict(tag_context: tuple[Any, _FakeTagService]) -> None:
    app, service = tag_context
    service.create_error = TagConflictError("Tag name 'archive' already exists.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/tags", json={"name": "archive"})

    assert response.status_code == 409
    assert response.json()["detail"] == "Tag name 'archive' already exists."


@pytest.mark.asyncio
async def test_create_tag_endpoint_returns_bad_request_on_validation_error(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.create_error = ValueError("color must be a valid hex value like #22C55E.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/tags", json={"name": "archive", "color": "#14B8A6"})

    assert response.status_code == 400
    assert response.json()["detail"] == "color must be a valid hex value like #22C55E."


@pytest.mark.asyncio
async def test_delete_tag_endpoint_returns_confirmation(tag_context: tuple[Any, _FakeTagService]) -> None:
    app, service = tag_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/tags/3")

    assert response.status_code == 200
    assert response.json() == {"deleted": True}
    assert service.delete_calls == [3]


@pytest.mark.asyncio
async def test_delete_tag_endpoint_returns_not_found(tag_context: tuple[Any, _FakeTagService]) -> None:
    app, service = tag_context
    service.delete_error = TagNotFoundError("Tag 404 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/tags/404")

    assert response.status_code == 404
    assert response.json()["detail"] == "Tag 404 was not found."


@pytest.mark.asyncio
async def test_delete_tag_endpoint_returns_bad_request_on_validation_error(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.delete_error = ValueError("tag_id must be a positive integer.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/tags/3")

    assert response.status_code == 400
    assert response.json()["detail"] == "tag_id must be a positive integer."


@pytest.mark.asyncio
async def test_add_tags_to_message_endpoint_returns_updated_tags(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.add_result = [
        _FakeTag(id=2, name="read-later", color="#22C55E"),
        _FakeTag(id=4, name="archive", color=None),
    ]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/messages/12/tags", json={"tag_ids": [2, 4]})

    assert response.status_code == 200
    assert response.json() == {
        "message_id": 12,
        "tags": [
            {"id": 2, "name": "read-later", "color": "#22C55E"},
            {"id": 4, "name": "archive", "color": None},
        ],
    }
    assert service.add_calls == [(12, (2, 4))]


@pytest.mark.asyncio
async def test_add_tags_to_message_endpoint_returns_not_found_for_message(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.add_error = MessageNotFoundError("Message 999 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/messages/999/tags", json={"tag_ids": [1]})

    assert response.status_code == 404
    assert response.json()["detail"] == "Message 999 was not found."


@pytest.mark.asyncio
async def test_add_tags_to_message_endpoint_returns_not_found_for_tag(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.add_error = TagNotFoundError("Tag 6 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/messages/12/tags", json={"tag_ids": [6]})

    assert response.status_code == 404
    assert response.json()["detail"] == "Tag 6 was not found."


@pytest.mark.asyncio
async def test_add_tags_to_message_endpoint_returns_bad_request_on_validation_error(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.add_error = ValueError("tag_ids must contain only positive integers.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/messages/12/tags", json={"tag_ids": [1]})

    assert response.status_code == 400
    assert response.json()["detail"] == "tag_ids must contain only positive integers."


@pytest.mark.asyncio
async def test_add_tags_to_message_endpoint_rejects_invalid_payload(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/messages/12/tags", json={"tag_ids": []})

    assert response.status_code == 422
    assert service.add_calls == []


@pytest.mark.asyncio
async def test_remove_tag_from_message_endpoint_returns_updated_tags(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.remove_result = [_FakeTag(id=2, name="read-later", color="#22C55E")]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/messages/12/tags/4")

    assert response.status_code == 200
    assert response.json() == {
        "message_id": 12,
        "tags": [{"id": 2, "name": "read-later", "color": "#22C55E"}],
    }
    assert service.remove_calls == [(12, 4)]


@pytest.mark.asyncio
async def test_remove_tag_from_message_endpoint_returns_not_found_for_assignment(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.remove_error = TagAssignmentNotFoundError("Tag 4 is not assigned to message 12.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/messages/12/tags/4")

    assert response.status_code == 404
    assert response.json()["detail"] == "Tag 4 is not assigned to message 12."


@pytest.mark.asyncio
async def test_remove_tag_from_message_endpoint_returns_not_found_for_message(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.remove_error = MessageNotFoundError("Message 12 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/messages/12/tags/4")

    assert response.status_code == 404
    assert response.json()["detail"] == "Message 12 was not found."


@pytest.mark.asyncio
async def test_remove_tag_from_message_endpoint_returns_not_found_for_tag(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.remove_error = TagNotFoundError("Tag 4 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/messages/12/tags/4")

    assert response.status_code == 404
    assert response.json()["detail"] == "Tag 4 was not found."


@pytest.mark.asyncio
async def test_remove_tag_from_message_endpoint_returns_bad_request_on_validation_error(
    tag_context: tuple[Any, _FakeTagService],
) -> None:
    app, service = tag_context
    service.remove_error = ValueError("tag_id must be a positive integer.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/messages/12/tags/4")

    assert response.status_code == 400
    assert response.json()["detail"] == "tag_id must be a positive integer."


@pytest.mark.asyncio
async def test_get_tag_service_dependency_returns_tag_service() -> None:
    session = object()

    service = await get_tag_service(session=session)  # type: ignore[arg-type]

    assert isinstance(service, TagService)
    assert service.session is session
