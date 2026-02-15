# Implementation Plan

STATUS: IN PROGRESS

## Phase 1: Project Setup & Database

- [x] 1.1: Initialize backend project (FastAPI, SQLAlchemy, pyproject.toml, virtual env)
- [x] 1.2: Create database models (Message, Category, Tag, MessageTag) with async SQLite
- [x] 1.3: Create default categories with seed data
- [x] 1.4: Initialize frontend project (React 19, Vite 7, TypeScript, Tailwind CSS 4)
- [x] 1.5: Set up frontend tooling (shadcn/ui, Framer Motion, Zustand, React Router)

## Phase 2: Telegram Integration

- [x] 2.1: Implement Telethon client wrapper with session management
- [x] 2.2: Create auth endpoints (connect, verify code, status, disconnect)
- [ ] 2.3: Implement Saved Messages scanner with pagination and progress tracking
- [ ] 2.4: Implement auto-categorization logic for scanned messages
- [ ] 2.5: Create scan endpoints (start, status, stop)

## Phase 3: Backend API

- [ ] 3.1: Implement message CRUD service and endpoints (list, get, update, delete)
- [ ] 3.2: Implement search and filtering (full-text search, category filter, tag filter, pagination)
- [ ] 3.3: Implement bulk operations (bulk delete, bulk move)
- [ ] 3.4: Implement category endpoints (list with counts, create, update, delete)
- [ ] 3.5: Implement tag endpoints (list, create, delete, add/remove from messages)
- [ ] 3.6: Implement Telegram message deletion (delete locally + on Telegram)

## Phase 4: Frontend Layout & Navigation

- [ ] 4.1: Create app layout with responsive sidebar and top bar
- [ ] 4.2: Build category sidebar navigation with message counts and icons
- [ ] 4.3: Create Telegram connection flow (connect form → verify code → status)
- [ ] 4.4: Build scan progress component with real-time updates

## Phase 5: Message UI

- [ ] 5.1: Build message card component with category badge, content preview, date, tags
- [ ] 5.2: Create responsive message grid with Framer Motion layout animations
- [ ] 5.3: Implement card enter/exit/hover animations
- [ ] 5.4: Build search bar and filter controls (category dropdown, tag multi-select, sort)
- [ ] 5.5: Implement message actions (move to category dialog, add/remove tags, delete)
- [ ] 5.6: Implement bulk selection mode with bulk actions toolbar

## Phase 6: Advanced Features

- [ ] 6.1: Implement drag-to-move (drag message card to sidebar category)
- [ ] 6.2: Build message detail modal/drawer with full content view
- [ ] 6.3: Add empty states, loading skeletons, and error handling throughout
- [ ] 6.4: Implement real-time scan progress updates

## Phase 7: Testing & Polish

- [ ] 7.1: Write backend tests for auth and telegram modules (mock Telethon)
- [ ] 7.2: Write backend tests for message, category, tag services and endpoints
- [ ] 7.3: Write backend tests for scanner and categorizer
- [ ] 7.4: Write frontend tests for message card, grid, and sidebar components
- [ ] 7.5: Write frontend tests for search, filter, and API client
- [ ] 7.6: Achieve ≥80% backend code coverage (add missing tests)
- [ ] 7.7: Achieve ≥80% frontend code coverage (add missing tests)
- [ ] 7.8: Final UI polish — consistent spacing, dark mode, mobile refinements

## Blockers

- 2026-02-15: Fresh backend dependency installation is still blocked by offline package index access (`pip install -e ".[dev]"`), but existing `backend/.venv` currently includes the required tooling for lint/test backpressure.
- 2026-02-15: Async SQLite operations (`aiosqlite.connect(...)`) hang in this sandbox because thread callbacks do not wake the asyncio loop promptly; avoid live async DB I/O in tests here.
