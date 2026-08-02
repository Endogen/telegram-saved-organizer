"""Database-backed concurrency leases for per-user scan status streams."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.database import SessionLocal
from app.models import ScanStreamSlot

STREAM_LEASE_SECONDS = 45
STREAM_HEARTBEAT_SECONDS = 15


@dataclass(frozen=True, slots=True)
class ScanStreamLease:
    user_id: str
    slot: int
    owner: str


async def claim_scan_stream(*, user_id: str) -> ScanStreamLease | None:
    """Atomically claim one configured stream slot across all API processes."""

    now = _utcnow()
    expires_at = now + timedelta(seconds=STREAM_LEASE_SECONDS)
    owner = str(uuid4())
    for slot in range(settings.scan_max_streams_per_user):
        async with SessionLocal() as session:
            reclaimed = await session.execute(
                update(ScanStreamSlot)
                .where(
                    ScanStreamSlot.user_id == user_id,
                    ScanStreamSlot.slot == slot,
                    ScanStreamSlot.lease_expires_at <= now,
                )
                .values(owner=owner, lease_expires_at=expires_at)
            )
            if int(reclaimed.rowcount or 0) == 1:
                await session.commit()
                return ScanStreamLease(user_id=user_id, slot=slot, owner=owner)

            session.add(
                ScanStreamSlot(
                    user_id=user_id,
                    slot=slot,
                    owner=owner,
                    lease_expires_at=expires_at,
                )
            )
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                continue
            return ScanStreamLease(user_id=user_id, slot=slot, owner=owner)
    return None


async def renew_scan_stream(*, lease: ScanStreamLease) -> bool:
    now = _utcnow()
    async with SessionLocal() as session:
        result = await session.execute(
            update(ScanStreamSlot)
            .where(
                ScanStreamSlot.user_id == lease.user_id,
                ScanStreamSlot.slot == lease.slot,
                ScanStreamSlot.owner == lease.owner,
                ScanStreamSlot.lease_expires_at > now,
            )
            .values(
                lease_expires_at=now + timedelta(seconds=STREAM_LEASE_SECONDS)
            )
        )
        await session.commit()
        return int(result.rowcount or 0) == 1


async def release_scan_stream(*, lease: ScanStreamLease) -> None:
    async with SessionLocal() as session:
        await session.execute(
            delete(ScanStreamSlot).where(
                ScanStreamSlot.user_id == lease.user_id,
                ScanStreamSlot.slot == lease.slot,
                ScanStreamSlot.owner == lease.owner,
            )
        )
        await session.commit()


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)
