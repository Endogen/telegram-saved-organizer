from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.requests import Request

from app.models import Base, ScanStreamSlot, User
from app.telegram import router as router_module
from app.telegram import streams as streams_module
from app.telegram.router import scan_status_stream
from app.telegram.streams import (
    claim_scan_stream,
    release_scan_stream,
    renew_scan_stream,
)


@pytest.mark.asyncio
async def test_stream_slots_cap_concurrency_and_reclaim_expired_lease(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'streams.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        session.add(
            User(
                id="user-a",
                email="user-a@example.com",
                normalized_email="user-a@example.com",
                display_name="User A",
                password_hash="hash",
            )
        )
        await session.commit()

    monkeypatch.setattr(streams_module, "SessionLocal", sessions)
    monkeypatch.setattr(
        streams_module,
        "settings",
        SimpleNamespace(scan_max_streams_per_user=2),
    )
    try:
        first, second = await asyncio.gather(
            claim_scan_stream(user_id="user-a"),
            claim_scan_stream(user_id="user-a"),
        )
        assert first is not None
        assert second is not None
        assert {first.slot, second.slot} == {0, 1}
        assert await claim_scan_stream(user_id="user-a") is None

        assert await renew_scan_stream(lease=first) is True
        await release_scan_stream(lease=first)
        replacement = await claim_scan_stream(user_id="user-a")
        assert replacement is not None
        assert replacement.slot == first.slot

        async with sessions() as session:
            await session.execute(
                update(ScanStreamSlot)
                .where(
                    ScanStreamSlot.user_id == "user-a",
                    ScanStreamSlot.slot == second.slot,
                )
                .values(
                    lease_expires_at=datetime.now(tz=UTC) - timedelta(seconds=1)
                )
            )
            await session.commit()

        reclaimed = await claim_scan_stream(user_id="user-a")
        assert reclaimed is not None
        assert reclaimed.slot == second.slot
        async with sessions() as session:
            slots = list(
                await session.scalars(
                    select(ScanStreamSlot).where(ScanStreamSlot.user_id == "user-a")
                )
            )
            assert len(slots) <= 2
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_stream_endpoint_returns_429_when_user_slots_are_full(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_slot(**_: object) -> None:
        return None

    monkeypatch.setattr(router_module, "claim_scan_stream", no_slot)
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/scan/stream",
            "headers": [],
        }
    )

    with pytest.raises(HTTPException) as caught:
        await scan_status_stream(
            request=request,
            user=SimpleNamespace(id="user-a"),
            max_events=None,
        )

    assert caught.value.status_code == 429
    assert caught.value.detail == "scan_stream_limit_reached"
