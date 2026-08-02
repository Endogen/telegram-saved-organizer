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


class _ConnectedRequest:
    async def is_disconnected(self) -> bool:
        return False


class _SessionContext:
    async def __aenter__(self) -> object:
        return object()

    async def __aexit__(self, *_: object) -> None:
        return None


def _stream_job(*, state: str) -> SimpleNamespace:
    terminal = state in {"completed", "failed", "cancelled"}
    return SimpleNamespace(
        id="job-a",
        user_id="user-a",
        state=state,
        stop_requested=state == "stopping",
        messages_scanned=4,
        pages_scanned=1,
        page_size=25,
        max_messages=10_000,
        max_runtime_seconds=3_600,
        last_message_id=99,
        started_at=datetime.now(tz=UTC),
        finished_at=datetime.now(tz=UTC) if terminal else None,
        error=None,
        completion_reason="source_exhausted" if state == "completed" else None,
    )


async def _collect_status_stream(
    *,
    monkeypatch: pytest.MonkeyPatch,
    statuses: list[object | None],
) -> tuple[list[str], list[object]]:
    lease = SimpleNamespace(user_id="user-a", slot=0, owner="stream-a")
    released: list[object] = []

    class _FakeScanService:
        def __init__(self, **_: object) -> None:
            pass

        async def status(self) -> object | None:
            return statuses.pop(0)

    async def claim(**_: object) -> object:
        return lease

    async def release(*, lease: object) -> None:
        released.append(lease)

    monkeypatch.setattr(router_module, "claim_scan_stream", claim)
    monkeypatch.setattr(router_module, "release_scan_stream", release)
    monkeypatch.setattr(router_module, "SessionLocal", _SessionContext)
    monkeypatch.setattr(router_module, "TelegramScanService", _FakeScanService)
    monkeypatch.setattr(router_module, "STREAM_POLL_INTERVAL_SECONDS", 0)

    response = await scan_status_stream(
        request=_ConnectedRequest(),  # type: ignore[arg-type]
        context=SimpleNamespace(
            user=SimpleNamespace(id="user-a"),
            web_session=SimpleNamespace(id="session-a"),
        ),
        max_events=None,
    )
    events = [event async for event in response.body_iterator]
    return events, released


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
                .values(lease_expires_at=datetime.now(tz=UTC) - timedelta(seconds=1))
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
            context=SimpleNamespace(
                user=SimpleNamespace(id="user-a"),
                web_session=SimpleNamespace(id="session-a"),
            ),
            max_events=None,
        )

    assert caught.value.status_code == 429
    assert caught.value.detail == "scan_stream_limit_reached"


@pytest.mark.asyncio
async def test_idle_stream_emits_once_then_closes_and_releases_lease(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statuses: list[object | None] = [None]

    events, released = await _collect_status_stream(
        monkeypatch=monkeypatch,
        statuses=statuses,
    )

    assert len(events) == 1
    assert '"state":"idle"' in events[0]
    assert statuses == []
    assert len(released) == 1


@pytest.mark.asyncio
async def test_active_stream_emits_terminal_update_then_closes_and_releases_lease(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statuses: list[object | None] = [
        _stream_job(state="running"),
        _stream_job(state="completed"),
    ]

    events, released = await _collect_status_stream(
        monkeypatch=monkeypatch,
        statuses=statuses,
    )

    assert len(events) == 2
    assert '"state":"running"' in events[0]
    assert '"state":"completed"' in events[1]
    assert statuses == []
    assert len(released) == 1
