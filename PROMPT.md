# Ralph BUILDING Loop

## Goal

Build a Telegram Saved Messages Organizer — a modern web platform that connects to Telegram, scans Saved Messages, auto-categorizes them, and provides a searchable, filterable card-based UI with animations.

## Context

- Read: specs/*.md for detailed requirements
- Read: IMPLEMENTATION_PLAN.md for the current task list
- Read: AGENTS.md for project context, commands, and learnings

## Rules

1. Pick the highest priority incomplete task from IMPLEMENTATION_PLAN.md
2. Investigate relevant code before changing
3. Implement the task
4. Run backpressure commands (lint, test, build) from AGENTS.md
5. If tests pass: commit with clear message, mark task done
6. If tests fail: try to fix (max 3 attempts), then notify
7. Update AGENTS.md with any operational learnings
8. Update IMPLEMENTATION_PLAN.md with progress

## Tech Stack (use EXACTLY these versions)

### Backend
- Python 3.12+, FastAPI 0.129, Telethon 1.42, SQLAlchemy 2.0.46
- SQLite (aiosqlite), pytest 9.0, pytest-cov, pytest-asyncio
- Ruff for linting

### Frontend
- React 19.2, TypeScript 5.9+, Vite 7.3, Tailwind CSS 4.1
- Framer Motion 12.34, shadcn/ui, React Router 7, Zustand 5
- Vitest + React Testing Library for tests

## Important

- ALL Telethon usage must be mocked in tests. Never call real Telegram API.
- Use async/await everywhere in the backend (async SQLAlchemy, async endpoints)
- Frontend must be fully responsive (mobile-first)
- Message cards must have Framer Motion animations (enter, exit, layout, hover)
- ≥80% code coverage for both backend and frontend is a hard requirement
- Auto-serve built frontend from FastAPI in production

## Notifications

```bash
openclaw gateway wake --text "<PREFIX>: <message>" --mode now
```

Prefixes:
- `DECISION:` — Need human input
- `ERROR:` — Tests failing after 3 attempts
- `BLOCKED:` — Missing dependency or unclear spec
- `PROGRESS:` — Major milestone complete
- `DONE:` — All tasks complete

## Completion

When all tasks are done:
1. Mark all tasks as done in IMPLEMENTATION_PLAN.md
2. Add `STATUS: COMPLETE`
3. Notify: `openclaw gateway wake --text "DONE: All tasks complete. Summary: <what was built>" --mode now`
