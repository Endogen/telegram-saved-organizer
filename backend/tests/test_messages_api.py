from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.messages.router import get_message_service
from app.messages.service import (
    CategoryNotFoundError,
    MessageListResult,
    MessageNotFoundError,
    MessageSort,
    TelegramClientNotConnectedError,
    TelegramMessageDeleteError,
)


@dataclass(slots=True)
class _FakeCategory:
    id: int
    name: str
    slug: str
    icon: str
    color: str


@dataclass(slots=True)
class _FakeTag:
    id: int
    name: str
    color: str | None


@dataclass(slots=True)
class _FakeMessage:
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
    category: _FakeCategory
    tags: list[_FakeTag]


class _FakeMessageService:
    def __init__(self) -> None:
        self.list_calls: list[
            tuple[int, int, MessageSort, str | None, tuple[str, ...] | None, str | None]
        ] = []
        self.get_calls: list[int] = []
        self.update_calls: list[tuple[int, dict[str, Any]]] = []
        self.delete_calls: list[int] = []
        self.bulk_delete_calls: list[tuple[int, ...]] = []
        self.bulk_move_calls: list[tuple[tuple[int, ...], int]] = []
        self.list_error: Exception | None = None
        self.get_error: Exception | None = None
        self.update_error: Exception | None = None
        self.delete_error: Exception | None = None
        self.bulk_delete_error: Exception | None = None
        self.bulk_move_error: Exception | None = None
        self.message = _build_message()
        self.list_result = MessageListResult(items=[self.message], total=1, page=1, per_page=50)
        self.get_result = self.message
        self.update_result = self.message
        self.bulk_delete_result = 0
        self.bulk_move_result = 0

    async def list_messages(
        self,
        *,
        page: int = 1,
        per_page: int = 50,
        sort: MessageSort = MessageSort.DATE_DESC,
        category_slug: str | None = None,
        tag_names: list[str] | None = None,
        search: str | None = None,
    ) -> MessageListResult:
        self.list_calls.append(
            (
                page,
                per_page,
                sort,
                category_slug,
                tuple(tag_names) if tag_names is not None else None,
                search,
            )
        )
        if self.list_error is not None:
            raise self.list_error
        return self.list_result

    async def get_message(self, *, message_id: int) -> _FakeMessage:
        self.get_calls.append(message_id)
        if self.get_error is not None:
            raise self.get_error
        return self.get_result

    async def update_message(self, *, message_id: int, updates: dict[str, Any]) -> _FakeMessage:
        self.update_calls.append((message_id, updates))
        if self.update_error is not None:
            raise self.update_error
        return self.update_result

    async def delete_message(self, *, message_id: int) -> None:
        self.delete_calls.append(message_id)
        if self.delete_error is not None:
            raise self.delete_error

    async def bulk_delete_messages(self, *, message_ids: list[int]) -> int:
        self.bulk_delete_calls.append(tuple(message_ids))
        if self.bulk_delete_error is not None:
            raise self.bulk_delete_error
        return self.bulk_delete_result

    async def bulk_move_messages(self, *, message_ids: list[int], category_id: int) -> int:
        self.bulk_move_calls.append((tuple(message_ids), category_id))
        if self.bulk_move_error is not None:
            raise self.bulk_move_error
        return self.bulk_move_result


def _build_message() -> _FakeMessage:
    timestamp = datetime(2026, 2, 1, 11, 30, tzinfo=UTC)
    category = _FakeCategory(
        id=3,
        name="Links",
        slug="links",
        icon="link",
        color="#0EA5E9",
    )
    tags = [_FakeTag(id=2, name="read-later", color="#22C55E")]
    return _FakeMessage(
        id=12,
        telegram_id=987654,
        content="https://example.com",
        media_type=None,
        file_name=None,
        file_size=None,
        mime_type=None,
        url="https://example.com",
        sender_name="Alice",
        date=timestamp,
        category_id=3,
        raw_data={"id": 987654},
        created_at=timestamp,
        updated_at=timestamp,
        category=category,
        tags=tags,
    )


@pytest.fixture
def message_context() -> tuple[Any, _FakeMessageService]:
    service = _FakeMessageService()
    app = create_app()

    async def override_message_service() -> _FakeMessageService:
        return service

    app.dependency_overrides[get_message_service] = override_message_service
    yield app, service
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_list_messages_endpoint_returns_paginated_response(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.list_result = MessageListResult(items=[service.message], total=9, page=2, per_page=10)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/messages?page=2&per_page=10&sort=date_asc")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 9
    assert body["page"] == 2
    assert body["per_page"] == 10
    assert body["items"][0]["id"] == 12
    assert body["items"][0]["category"]["slug"] == "links"
    assert body["items"][0]["tags"] == [{"id": 2, "name": "read-later", "color": "#22C55E"}]
    assert service.list_calls == [(2, 10, MessageSort.DATE_ASC, None, None, None)]


@pytest.mark.asyncio
async def test_list_messages_endpoint_forwards_search_and_filter_params(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get(
            "/api/messages?"
            "category=links&"
            "tag=read-later&"
            "tag=urgent&"
            "search=telegram&"
            "page=1&"
            "per_page=25&"
            "sort=date_desc"
        )

    assert response.status_code == 200
    assert service.list_calls == [
        (1, 25, MessageSort.DATE_DESC, "links", ("read-later", "urgent"), "telegram")
    ]


@pytest.mark.asyncio
async def test_bulk_delete_endpoint_returns_deleted_count(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.bulk_delete_result = 2
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/messages/bulk-delete", json={"message_ids": [12, 13]})

    assert response.status_code == 200
    assert response.json() == {"deleted_count": 2}
    assert service.bulk_delete_calls == [(12, 13)]


@pytest.mark.asyncio
async def test_bulk_delete_endpoint_returns_not_found(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.bulk_delete_error = MessageNotFoundError("Message 404 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/messages/bulk-delete", json={"message_ids": [404]})

    assert response.status_code == 404
    assert response.json()["detail"] == "Message 404 was not found."


@pytest.mark.asyncio
async def test_bulk_delete_endpoint_returns_bad_request_when_telegram_not_connected(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.bulk_delete_error = TelegramClientNotConnectedError(
        "Telegram client is not connected. Connect first before deleting messages."
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/messages/bulk-delete", json={"message_ids": [404]})

    assert response.status_code == 400
    assert (
        response.json()["detail"]
        == "Telegram client is not connected. Connect first before deleting messages."
    )


@pytest.mark.asyncio
async def test_bulk_delete_endpoint_returns_bad_gateway_when_telegram_delete_fails(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.bulk_delete_error = TelegramMessageDeleteError("Telegram rejected message deletion request.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/messages/bulk-delete", json={"message_ids": [404]})

    assert response.status_code == 502
    assert response.json()["detail"] == "Telegram rejected message deletion request."


@pytest.mark.asyncio
async def test_bulk_move_endpoint_returns_moved_count(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.bulk_move_result = 3
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/messages/bulk-move",
            json={"message_ids": [12, 13, 14], "category_id": 5},
        )

    assert response.status_code == 200
    assert response.json() == {"moved_count": 3, "category_id": 5}
    assert service.bulk_move_calls == [((12, 13, 14), 5)]


@pytest.mark.asyncio
async def test_bulk_move_endpoint_returns_not_found_for_missing_category(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.bulk_move_error = CategoryNotFoundError("Category 99 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/messages/bulk-move",
            json={"message_ids": [12], "category_id": 99},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "Category 99 was not found."


@pytest.mark.asyncio
async def test_bulk_move_endpoint_rejects_invalid_payload(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/messages/bulk-move",
            json={"message_ids": [], "category_id": 0},
        )

    assert response.status_code == 422
    assert service.bulk_move_calls == []


@pytest.mark.asyncio
async def test_get_message_endpoint_returns_message(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/messages/12")

    assert response.status_code == 200
    assert response.json()["telegram_id"] == service.message.telegram_id
    assert service.get_calls == [12]


@pytest.mark.asyncio
async def test_get_message_endpoint_returns_not_found(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.get_error = MessageNotFoundError("Message 999 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/messages/999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Message 999 was not found."


@pytest.mark.asyncio
async def test_update_message_endpoint_returns_updated_message(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    updated_message = _build_message()
    updated_message.content = "updated"
    service.update_result = updated_message
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.patch("/api/messages/12", json={"content": "updated"})

    assert response.status_code == 200
    assert response.json()["content"] == "updated"
    assert service.update_calls == [(12, {"content": "updated"})]


@pytest.mark.asyncio
async def test_update_message_endpoint_returns_not_found_for_missing_category(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.update_error = CategoryNotFoundError("Category 404 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.patch("/api/messages/12", json={"category_id": 404})

    assert response.status_code == 404
    assert response.json()["detail"] == "Category 404 was not found."


@pytest.mark.asyncio
async def test_update_message_endpoint_rejects_empty_payload(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.patch("/api/messages/12", json={})

    assert response.status_code == 422
    assert service.update_calls == []


@pytest.mark.asyncio
async def test_delete_message_endpoint_returns_confirmation(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/messages/12")

    assert response.status_code == 200
    assert response.json() == {"deleted": True}
    assert service.delete_calls == [12]


@pytest.mark.asyncio
async def test_delete_message_endpoint_returns_not_found(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.delete_error = MessageNotFoundError("Message 404 was not found.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/messages/404")

    assert response.status_code == 404
    assert response.json()["detail"] == "Message 404 was not found."


@pytest.mark.asyncio
async def test_delete_message_endpoint_returns_bad_request_when_telegram_not_connected(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.delete_error = TelegramClientNotConnectedError(
        "Telegram client is not connected. Connect first before deleting messages."
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/messages/12")

    assert response.status_code == 400
    assert (
        response.json()["detail"]
        == "Telegram client is not connected. Connect first before deleting messages."
    )


@pytest.mark.asyncio
async def test_delete_message_endpoint_returns_bad_gateway_when_telegram_delete_fails(
    message_context: tuple[Any, _FakeMessageService],
) -> None:
    app, service = message_context
    service.delete_error = TelegramMessageDeleteError("Telegram rejected message deletion request.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/messages/12")

    assert response.status_code == 502
    assert response.json()["detail"] == "Telegram rejected message deletion request."
