import pytest
from httpx import ASGITransport, AsyncClient

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
    assert response.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert response.headers["cache-control"] == "no-store"
