import stat

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import _load_or_create_api_token
from app.main import create_app

TEST_TOKEN = "test-api-token-that-is-at-least-thirty-two-characters"


def _create_protected_app():
    app = create_app(api_token=TEST_TOKEN)

    @app.get("/api/protected-probe")
    async def protected_probe() -> dict[str, bool]:
        return {"accepted": True}

    return app


def test_api_token_is_generated_once_with_private_permissions(tmp_path) -> None:
    first_token, first_path = _load_or_create_api_token(tmp_path)
    second_token, second_path = _load_or_create_api_token(tmp_path)

    assert first_token == second_token
    assert first_path == second_path == tmp_path / "api-token"
    assert stat.S_IMODE((tmp_path / "api-token").stat().st_mode) == 0o600


@pytest.mark.asyncio
async def test_protected_api_requires_session_or_bearer_token() -> None:
    transport = ASGITransport(app=_create_protected_app())
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        unauthorized = await client.get("/api/protected-probe")
        invalid = await client.get(
            "/api/protected-probe",
            headers={"Authorization": "Bearer invalid-token"},
        )
        authorized = await client.get(
            "/api/protected-probe",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )

    assert unauthorized.status_code == 401
    assert unauthorized.json() == {"detail": "api_authentication_required"}
    assert unauthorized.headers["www-authenticate"] == "Bearer"
    assert invalid.status_code == 401
    assert authorized.status_code == 200
    assert authorized.json() == {"accepted": True}


@pytest.mark.asyncio
async def test_browser_can_unlock_and_lock_an_httponly_session() -> None:
    transport = ASGITransport(app=_create_protected_app())
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        initial_status = await client.get("/api/session")
        invalid_unlock = await client.post("/api/session", json={"token": "x" * 32})
        unlocked = await client.post("/api/session", json={"token": TEST_TOKEN})
        protected = await client.get("/api/protected-probe")
        locked = await client.delete("/api/session")
        protected_after_lock = await client.get("/api/protected-probe")

    assert initial_status.json() == {"authenticated": False}
    assert invalid_unlock.status_code == 401
    assert unlocked.json() == {"authenticated": True}
    assert "httponly" in unlocked.headers["set-cookie"].lower()
    assert "samesite=strict" in unlocked.headers["set-cookie"].lower()
    assert protected.status_code == 200
    assert locked.json() == {"authenticated": False}
    assert protected_after_lock.status_code == 401


@pytest.mark.asyncio
async def test_cross_origin_browser_cannot_submit_api_token() -> None:
    transport = ASGITransport(app=_create_protected_app())
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/session",
            json={"token": TEST_TOKEN},
            headers={"Origin": "https://attacker.example"},
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "cross_origin_request_blocked"}
