import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


@pytest.mark.asyncio
async def test_health_endpoint_returns_ok() -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_unsafe_requests_enforce_browser_same_origin() -> None:
    app = create_app()

    @app.post("/unsafe-probe")
    async def unsafe_probe() -> dict[str, bool]:
        return {"accepted": True}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        cross_origin = await client.post(
            "/unsafe-probe",
            headers={"Origin": "https://attacker.example"},
        )
        same_origin = await client.post(
            "/unsafe-probe",
            headers={"Origin": "http://testserver"},
        )
        non_browser = await client.post("/unsafe-probe")
        cross_origin_read = await client.get(
            "/api/health",
            headers={"Origin": "https://attacker.example"},
        )

    assert cross_origin.status_code == 403
    assert cross_origin.json() == {"detail": "cross_origin_request_blocked"}
    assert same_origin.status_code == 200
    assert non_browser.status_code == 200
    assert cross_origin_read.status_code == 200
