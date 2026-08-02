from __future__ import annotations

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

    monkeypatch.setattr(worker_module, "verify_database_revision", verify_database_revision)
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

    monkeypatch.setattr(worker_module, "verify_database_revision", verify_database_revision)
    monkeypatch.setattr(worker_module, "process_next_scan_job", process_next_scan_job)
    monkeypatch.setattr(worker_module, "dispose_engine", dispose_engine)

    with pytest.raises(RuntimeError, match="stale schema"):
        await worker_module.run_worker()

    assert calls == ["verify", "dispose"]
