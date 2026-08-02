"""Dedicated worker entry point for durable Telegram scan jobs."""

from __future__ import annotations

import asyncio

from app.database import dispose_engine, verify_database_revision
from app.telegram.service import process_next_scan_job


async def run_worker(*, idle_poll_seconds: float = 1.0) -> None:
    try:
        await verify_database_revision()
        while True:
            processed = await process_next_scan_job()
            if not processed:
                await asyncio.sleep(idle_poll_seconds)
    finally:
        await dispose_engine()


def main() -> None:
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
