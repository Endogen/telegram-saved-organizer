# Backend Specification

## Architecture

```
backend/
├── app/
│   ├── main.py                  # FastAPI app, lifespan, middleware
│   ├── config.py                # Settings (env vars, paths)
│   ├── database.py              # SQLAlchemy async engine + session
│   ├── auth/
│   │   ├── router.py            # Login/session endpoints
│   │   ├── service.py           # JWT token management
│   │   └── schemas.py           # Auth request/response models
│   ├── telegram/
│   │   ├── client.py            # Telethon client wrapper
│   │   ├── scanner.py           # Saved Messages scanner
│   │   ├── categorizer.py       # Auto-categorization logic
│   │   └── schemas.py           # Telegram-related models
│   ├── messages/
│   │   ├── router.py            # CRUD endpoints for messages
│   │   ├── service.py           # Business logic
│   │   ├── models.py            # SQLAlchemy models
│   │   └── schemas.py           # Pydantic request/response
│   ├── categories/
│   │   ├── router.py            # Category endpoints
│   │   ├── service.py           # Category business logic
│   │   ├── models.py            # Category SQLAlchemy model
│   │   └── schemas.py           # Category schemas
│   └── tags/
│       ├── router.py            # Tag endpoints
│       ├── service.py           # Tag business logic
│       ├── models.py            # Tag + message_tags models
│       └── schemas.py           # Tag schemas
├── tests/
│   ├── conftest.py              # Shared fixtures
│   ├── test_auth.py
│   ├── test_messages.py
│   ├── test_categories.py
│   ├── test_tags.py
│   ├── test_scanner.py
│   └── test_categorizer.py
├── pyproject.toml
└── .env.example
```

## Database Models

### Message
- `id` (int, PK)
- `telegram_id` (int, unique) — Telegram message ID
- `content` (text, nullable) — message text
- `media_type` (str, nullable) — photo, video, audio, document, etc.
- `file_name` (str, nullable)
- `file_size` (int, nullable)
- `mime_type` (str, nullable)
- `url` (str, nullable) — extracted URL if present
- `sender_name` (str, nullable) — forwarded from name
- `date` (datetime) — message date
- `category_id` (int, FK → Category)
- `raw_data` (JSON) — original Telegram message data
- `created_at` (datetime)
- `updated_at` (datetime)

### Category
- `id` (int, PK)
- `name` (str, unique) — e.g. "Videos", "Links", "Repositories"
- `slug` (str, unique) — URL-friendly name
- `icon` (str) — emoji or icon identifier
- `color` (str) — hex color for UI
- `position` (int) — display order
- `is_default` (bool) — whether it's a built-in category

### Tag
- `id` (int, PK)
- `name` (str, unique)
- `color` (str, nullable)

### MessageTag (junction table)
- `message_id` (int, FK → Message)
- `tag_id` (int, FK → Tag)

## Default Categories
1. 📹 Videos — media_type contains video
2. 🎵 Audio — media_type contains audio/voice
3. 🔗 Links — contains URLs (non-GitHub)
4. 💻 Repositories — contains github.com/gitlab.com URLs
5. 🖼️ Images — media_type is photo
6. 📄 Documents — media_type is document (PDF, etc.)
7. 💬 Text — plain text messages, no media
8. 📦 Other — anything that doesn't fit above

## API Endpoints

### Auth
- `POST /api/auth/connect` — start Telegram connection (api_id, api_hash, phone)
- `POST /api/auth/verify` — submit 2FA/phone code
- `GET /api/auth/status` — check connection status
- `POST /api/auth/disconnect` — disconnect Telegram session

### Messages
- `GET /api/messages` — list messages (paginated, filterable)
  - Query: `?category=<slug>&tag=<name>&search=<text>&page=1&per_page=50&sort=date_desc`
- `GET /api/messages/{id}` — get single message
- `PATCH /api/messages/{id}` — update message (move category, etc.)
- `DELETE /api/messages/{id}` — delete message (local + Telegram)
- `POST /api/messages/bulk-delete` — bulk delete
- `POST /api/messages/bulk-move` — bulk move to category

### Scan
- `POST /api/scan/start` — start scanning Saved Messages
- `GET /api/scan/status` — get scan progress
- `POST /api/scan/stop` — stop scanning

### Categories
- `GET /api/categories` — list all categories with message counts
- `POST /api/categories` — create custom category
- `PATCH /api/categories/{id}` — update category
- `DELETE /api/categories/{id}` — delete category (moves messages to "Other")

### Tags
- `GET /api/tags` — list all tags
- `POST /api/tags` — create tag
- `DELETE /api/tags/{id}` — delete tag
- `POST /api/messages/{id}/tags` — add tags to message
- `DELETE /api/messages/{id}/tags/{tag_id}` — remove tag from message

## Auto-Categorization Logic

When scanning, each message is categorized based on:
1. If message has video media → Videos
2. If message has audio/voice media → Audio
3. If message has photo media → Images
4. If message has document media → Documents
5. If message text contains github.com or gitlab.com → Repositories
6. If message text contains any URL → Links
7. If message has text only (no media) → Text
8. Otherwise → Other

## Telegram Integration

- Use Telethon's `client.get_messages('me')` to fetch Saved Messages
- Iterate with `iter_messages` for pagination
- Store Telethon session file locally for persistence
- For deletion: `client.delete_messages('me', [message_id])`
- Handle rate limiting with exponential backoff

## Testing

- Mock Telethon client in tests (never hit real Telegram API)
- Use in-memory SQLite for test database
- Minimum 80% code coverage across all backend modules
- Test all API endpoints, services, categorization logic, error cases
