"""Dedicated worker entry point for durable Telegram scan jobs."""

from __future__ import annotations

import asyncio
import logging
import signal
from contextlib import suppress

from app.database import dispose_engine, verify_database_revision
from app.telegram.service import process_next_scan_job

logger = logging.getLogger(__name__)


async def _process_once_or_stop(*, shutdown_event: asyncio.Event) -> bool | None:
    """Run one queue attempt, cancelling it when shutdown is requested."""

    process_task = asyncio.create_task(process_next_scan_job())
    shutdown_task = asyncio.create_task(shutdown_event.wait())
    try:
        done, _ = await asyncio.wait(
            {process_task, shutdown_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if shutdown_task in done:
            process_task.cancel()
            try:
                await process_task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("Scan work failed while the worker was shutting down")
            return None
        return await process_task
    finally:
        for task in (process_task, shutdown_task):
            if not task.done():
                task.cancel()
        for task in (process_task, shutdown_task):
            with suppress(asyncio.CancelledError, Exception):
                await task


async def run_worker(
    *,
    idle_poll_seconds: float = 1.0,
    shutdown_event: asyncio.Event | None = None,
) -> None:
    if idle_poll_seconds <= 0:
        raise ValueError("idle_poll_seconds must be positive.")
    stop = shutdown_event or asyncio.Event()
    try:
        await verify_database_revision()
        while not stop.is_set():
            processed = await _process_once_or_stop(shutdown_event=stop)
            if processed is None:
                break
            if not processed:
                try:
                    async with asyncio.timeout(idle_poll_seconds):
                        await stop.wait()
                except TimeoutError:
                    pass
    finally:
        await dispose_engine()


async def _run_worker_with_signals() -> None:
    shutdown_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    registered_signals: list[signal.Signals] = []
    for signal_number in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(signal_number, shutdown_event.set)
        except (NotImplementedError, RuntimeError):
            logger.warning(
                "Could not install the %s worker signal handler", signal_number.name
            )
        else:
            registered_signals.append(signal_number)
    try:
        await run_worker(shutdown_event=shutdown_event)
    finally:
        for signal_number in registered_signals:
            loop.remove_signal_handler(signal_number)


def main() -> None:
    asyncio.run(_run_worker_with_signals())


if __name__ == "__main__":
    main()
