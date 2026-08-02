# Telegram Saved Messages Organizer

A local-first organizer for Telegram Saved Messages. The FastAPI backend authenticates with Telegram, scans Saved Messages into SQLite, and exposes category, tag, and message APIs. The React frontend provides the connection, scan, dashboard, and message-management flows.

## Prerequisites

- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- Node.js 22.22 or newer and npm
- Telegram API credentials from `my.telegram.org`

## Development

Install and start the backend from one terminal:

```bash
cd backend
uv sync --extra dev
uv run uvicorn app.main:app --reload --port 8500
```

The default database, Telegram session, and saved credentials live in `backend/data/`. To move them elsewhere, export `TSO_DATA_DIR` or copy `backend/.env.example` to `backend/.env` and start Uvicorn with `--env-file .env`.

Install and start the frontend from a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` requests to the backend on port 8500. Enter the Telegram API ID, API hash, and phone number on the Connect page, complete verification, then start a scan.

On first start, the backend creates a private API token at `backend/data/api-token`. The browser exchanges this token for an HttpOnly, same-site session; it is never compiled into frontend code. Print the current token when the unlock screen asks for it:

```bash
cd backend
uv run python -m app.api_access
```

Scripts and other non-browser clients can authenticate with `Authorization: Bearer <token>`. Set `TSO_API_TOKEN` to a fixed value of at least 32 characters when a generated token file is not suitable.

## Verification

```bash
cd backend
uv run ruff check app tests
uv run pytest
uv build

cd ../frontend
npm test
npm run build
```

The application stores the API token, Telegram credentials, and a Telethon session locally so it can reconnect. The backend enforces private file permissions, but the data directory should still be backed up and kept out of version control.
