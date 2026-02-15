# Telegram Saved Messages Organizer

## Goal

Build a modern web platform that connects to a user's Telegram account, scans their Saved Messages, and organizes them into searchable, filterable, tagged categories. Messages are displayed as cards with animations, can be moved between categories, and can be deleted (which also removes them from Telegram).

## Tech Stack

### Backend
- **Python 3.12+**
- **FastAPI 0.129** — async REST API
- **Telethon 1.42** — Telegram MTProto client (user account access to Saved Messages)
- **SQLAlchemy 2.0.46** — async ORM with aiosqlite
- **SQLite** — local database for message cache, categories, tags
- **Pytest 9.0** — testing with ≥80% code coverage
- **pytest-cov** — coverage reporting
- **pytest-asyncio** — async test support

### Frontend
- **React 19.2** — UI framework
- **TypeScript 5.9+**
- **Vite 7.3** — build tool
- **Tailwind CSS 4.1** — styling
- **Framer Motion 12.34** — card animations (enter, exit, reorder, drag)
- **shadcn/ui** — component primitives
- **React Router 7** — routing
- **Zustand 5** — state management

## Success Criteria
- [ ] Connect to Telegram via user session (API ID + API hash + phone auth)
- [ ] Scan and import all Saved Messages
- [ ] Auto-categorize messages (video, audio, links, repositories, images, documents, text, other)
- [ ] Display messages as animated cards
- [ ] Search messages by content, sender, date
- [ ] Filter by category and tags
- [ ] Add/remove custom tags on messages
- [ ] Move messages between categories (drag or menu)
- [ ] Delete messages (removes from local DB AND Telegram)
- [ ] Bulk selection and bulk delete
- [ ] Modern, responsive UI (mobile-friendly)
- [ ] ≥80% backend code coverage, all tests passing
- [ ] ≥80% frontend code coverage, all tests passing
