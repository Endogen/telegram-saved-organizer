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
