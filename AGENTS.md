# AGENTS.md

## Project

Telegram Saved Messages Organizer — a modern web platform to connect a Telegram account, scan Saved Messages, auto-categorize them, and manage them with search, tags, filtering, and bulk operations.

## Commands

- **Install backend**: `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"`
- **Install frontend**: `cd frontend && npm install --legacy-peer-deps`
- **Test backend**: `cd backend && .venv/bin/pytest tests/ -q --tb=short`
- **Test frontend**: `cd frontend && npx vitest run --reporter=verbose`
- **Coverage backend**: `cd backend && .venv/bin/pytest tests/ --cov=app --cov-report=term-missing`
- **Coverage frontend**: `cd frontend && npx vitest run --coverage`
- **Build frontend**: `cd frontend && npm run build`
- **Lint backend**: `cd backend && .venv/bin/ruff check . --fix`
- **Run dev**: `cd backend && .venv/bin/uvicorn app.main:app --reload --port 8500`

## Backpressure

Run after each implementation:
1. `cd backend && .venv/bin/ruff check . --fix` (if backend changes)
2. `cd backend && .venv/bin/pytest tests/ -q --tb=short` (if backend changes)
3. `cd frontend && npx tsc --noEmit` (if frontend changes)
4. `cd frontend && npm run build` (if frontend changes)

## Architecture Notes

- Backend serves frontend static files in production
- API is under `/api/` prefix
- Frontend uses Vite proxy to backend in development
- Telethon session stored in backend data directory
- SQLite database in backend data directory
- Mock Telethon in all tests — never hit real Telegram

## Human Decisions

*(none yet)*

## Learnings

- 2026-02-15: Current execution environment has no outbound package index access; `pip install -e ".[dev]"` fails when resolving dependencies.
- 2026-02-15: `openclaw gateway wake ...` fails in this environment with `uv_interface_addresses` system error, so automated notifications may not send from sandbox.
- 2026-02-15: `backend/.venv` can bootstrap `setuptools` from `/usr/share/python-wheels/setuptools-68.1.2-py3-none-any.whl`, but editable install still blocks (`bdist_wheel` missing and no index access for project/runtime dependencies).
- 2026-02-15: Existing `backend/.venv` currently has `ruff`/`pytest` and can run backend backpressure checks even though fresh dependency installation remains offline-blocked.
- 2026-02-15: `fastapi.testclient.TestClient` hangs in this environment during tests; use `httpx.AsyncClient` with `ASGITransport` for backend API tests.
- 2026-02-15: `aiosqlite.connect(...)` hangs in this sandbox (thread callbacks do not wake the asyncio loop promptly), so tests should avoid live async SQLite I/O.
- 2026-02-15: Category seed behavior can be tested with fake async-session objects (mocked `scalars`/`commit`) to avoid sandbox SQLite hangs while still validating idempotent seed logic.
- 2026-02-15: Telethon wrapper behavior can be tested with an injected fake `client_factory` so tests fully avoid real Telegram API/network usage.
- 2026-02-15: FastAPI sync dependencies can hang in this sandbox's threadpool path; prefer `async def` dependency providers (and async test overrides) for API tests.
- 2026-02-15: Saved Messages scanner pagination can be tested deterministically with fake `iter_messages(entity, limit, offset_id)` pages keyed by `offset_id`, avoiding live Telegram calls.
- 2026-02-15: Backend backpressure checks (`ruff` + `pytest`) run successfully against the existing `backend/.venv` in this sandbox.
- 2026-02-15: Message CRUD service behavior can be tested with a fake async session object (`scalar`/`scalars`/`get`/`commit`/`delete`) to avoid live async SQLite I/O in this sandbox.
- 2026-02-15: Message bulk operations can be tested reliably with fake async session objects and API dependency overrides (`httpx.ASGITransport`) without touching live SQLite.
- 2026-02-15: Category service/API behavior can be tested with fake async sessions (`execute`/`scalar`/`scalars`/`get`) and async dependency overrides, avoiding sandbox threadpool/SQLite hangs.
- 2026-02-15: Tag service/API behavior can be tested with fake async sessions (`scalar`/`scalars`/`get`) plus async dependency overrides (`httpx.ASGITransport`), avoiding live SQLite and threadpool hangs in this sandbox.
- 2026-02-15: Frontend backpressure checks (`npx tsc --noEmit` and `npm run build`) pass in this sandbox after layout component refactors.
