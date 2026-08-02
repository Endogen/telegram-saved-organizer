import pytest
from fastapi.exceptions import RequestValidationError
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request

from app import main as main_module
from app.main import create_app


@pytest.mark.asyncio
async def test_health_endpoint_returns_ok() -> None:
    transport = ASGITransport(app=create_app(check_migrations=False))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_readiness_endpoint_returns_ready_when_database_responds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def database_is_ready() -> bool:
        return True

    monkeypatch.setattr(main_module, "database_is_ready", database_is_ready)
    transport = ASGITransport(app=create_app(check_migrations=False))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


@pytest.mark.asyncio
async def test_readiness_endpoint_returns_unavailable_without_leaking_database_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def database_is_ready() -> bool:
        return False

    monkeypatch.setattr(main_module, "database_is_ready", database_is_ready)
    transport = ASGITransport(app=create_app(check_migrations=False))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


@pytest.mark.asyncio
async def test_api_responses_include_defensive_security_headers() -> None:
    transport = ASGITransport(app=create_app(check_migrations=False))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "same-origin"
    assert response.headers["cross-origin-resource-policy"] == "same-origin"
    assert (
        response.headers["content-security-policy"]
        == "default-src 'none'; frame-ancestors 'none'"
    )
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_validation_errors_never_reflect_secret_inputs() -> None:
    secret = "invalid-api-hash-that-must-never-be-reflected"
    app = create_app(check_migrations=False)
    handler = app.exception_handlers[RequestValidationError]
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/telegram/connection",
            "headers": [],
        }
    )
    error = RequestValidationError(
        [
            {
                "type": "string_pattern_mismatch",
                "loc": ("body", "api_hash"),
                "msg": "String should match pattern",
                "input": secret,
                "ctx": {"pattern": "^[0-9a-fA-F]{32}$"},
            }
        ]
    )

    response = await handler(request, error)

    assert response.status_code == 422
    assert secret.encode() not in response.body
    assert response.body == (
        b'{"detail":[{"type":"string_pattern_mismatch","loc":["body","api_hash"],'
        b'"msg":"Invalid value."}]}'
    )
