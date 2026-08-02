from __future__ import annotations

import asyncio
import signal

import pytest

from app.telegram import worker as worker_module


class WorkerStopped(RuntimeError):
    pass


@pytest.mark.asyncio
async def test_worker_verifies_migrations_before_claiming_jobs_and_disposes_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def verify_database_revision() -> None:
        calls.append("verify")

    async def process_next_scan_job() -> bool:
        calls.append("process")
        raise WorkerStopped

    async def dispose_engine() -> None:
        calls.append("dispose")

    monkeypatch.setattr(
        worker_module, "verify_database_revision", verify_database_revision
    )
    monkeypatch.setattr(worker_module, "process_next_scan_job", process_next_scan_job)
    monkeypatch.setattr(worker_module, "dispose_engine", dispose_engine)

    with pytest.raises(WorkerStopped):
        await worker_module.run_worker()

    assert calls == ["verify", "process", "dispose"]


@pytest.mark.asyncio
async def test_worker_fails_closed_and_disposes_engine_when_migrations_are_stale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def verify_database_revision() -> None:
        calls.append("verify")
        raise RuntimeError("stale schema")

    async def process_next_scan_job() -> bool:
        calls.append("process")
        return False

    async def dispose_engine() -> None:
        calls.append("dispose")

    monkeypatch.setattr(
        worker_module, "verify_database_revision", verify_database_revision
    )
    monkeypatch.setattr(worker_module, "process_next_scan_job", process_next_scan_job)
    monkeypatch.setattr(worker_module, "dispose_engine", dispose_engine)

    with pytest.raises(RuntimeError, match="stale schema"):
        await worker_module.run_worker()

    assert calls == ["verify", "dispose"]


@pytest.mark.asyncio
async def test_worker_shutdown_cancels_active_work_and_disposes_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    work_started = asyncio.Event()
    work_cancelled = asyncio.Event()
    shutdown_event = asyncio.Event()

    async def verify_database_revision() -> None:
        calls.append("verify")

    async def process_next_scan_job() -> bool:
        calls.append("process")
        work_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            work_cancelled.set()
            raise

    async def dispose_engine() -> None:
        calls.append("dispose")

    monkeypatch.setattr(
        worker_module, "verify_database_revision", verify_database_revision
    )
    monkeypatch.setattr(worker_module, "process_next_scan_job", process_next_scan_job)
    monkeypatch.setattr(worker_module, "dispose_engine", dispose_engine)

    worker = asyncio.create_task(
        worker_module.run_worker(shutdown_event=shutdown_event)
    )
    await asyncio.wait_for(work_started.wait(), timeout=1)
    shutdown_event.set()
    await asyncio.wait_for(worker, timeout=1)

    assert work_cancelled.is_set()
    assert calls == ["verify", "process", "dispose"]


@pytest.mark.asyncio
async def test_worker_idle_wait_stops_immediately_on_shutdown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_checked = asyncio.Event()
    shutdown_event = asyncio.Event()
    disposed = False

    async def verify_database_revision() -> None:
        return None

    async def process_next_scan_job() -> bool:
        work_checked.set()
        return False

    async def dispose_engine() -> None:
        nonlocal disposed
        disposed = True

    monkeypatch.setattr(
        worker_module, "verify_database_revision", verify_database_revision
    )
    monkeypatch.setattr(worker_module, "process_next_scan_job", process_next_scan_job)
    monkeypatch.setattr(worker_module, "dispose_engine", dispose_engine)

    worker = asyncio.create_task(
        worker_module.run_worker(
            idle_poll_seconds=60,
            shutdown_event=shutdown_event,
        )
    )
    await asyncio.wait_for(work_checked.wait(), timeout=1)
    shutdown_event.set()
    await asyncio.wait_for(worker, timeout=1)

    assert disposed is True


@pytest.mark.asyncio
async def test_worker_entrypoint_registers_and_removes_shutdown_signals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handlers: dict[signal.Signals, object] = {}
    removed: list[signal.Signals] = []

    class _FakeLoop:
        def add_signal_handler(
            self,
            signal_number: signal.Signals,
            callback: object,
        ) -> None:
            handlers[signal_number] = callback

        def remove_signal_handler(self, signal_number: signal.Signals) -> bool:
            removed.append(signal_number)
            return True

    async def run_worker(*, shutdown_event: asyncio.Event) -> None:
        callback = handlers[signal.SIGTERM]
        assert callable(callback)
        callback()
        assert shutdown_event.is_set()

    monkeypatch.setattr(worker_module.asyncio, "get_running_loop", lambda: _FakeLoop())
    monkeypatch.setattr(worker_module, "run_worker", run_worker)

    await worker_module._run_worker_with_signals()

    assert set(handlers) == {signal.SIGTERM, signal.SIGINT}
    assert removed == [signal.SIGTERM, signal.SIGINT]
