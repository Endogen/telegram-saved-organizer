# Telegram Saved Messages Organizer

A multi-user web application for importing and organizing each account's own Telegram Saved Messages. The FastAPI API stores tenant-owned data in PostgreSQL or SQLite, the React UI provides account and Telegram onboarding, and a durable worker imports Saved Messages without sharing Telegram sessions between users.

## What is included

- Email/password accounts with Argon2id password hashing
- Opaque, revocable server-side sessions with absolute and idle expiry
- HttpOnly, `Secure`, same-site cookies and session-bound CSRF protection
- Per-account categories, tags, messages, Telegram authorization, and scan jobs
- Encrypted Telegram `StringSession`, phone, and verification challenge at rest
- Active-session review/revocation, password rotation, and account deletion
- Provider-aware GitHub, YouTube, X/Twitter, generic-link, and plain-text message rendering
- Alembic migrations plus a durable scan worker suitable for multi-process deployment

## Local development

Requirements: Python 3.12, [uv](https://docs.astral.sh/uv/), Node.js 22.22+, and npm. Each website user supplies their own Telegram application credentials during connection setup.

Start the API:

```bash
cd backend
uv sync --extra dev
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8500
```

Start the UI in another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`, register an application account, then connect that account to Telegram. Development defaults to a private SQLite database in `backend/data/`; `TSO_DATA_DIR` changes that location. The generated development encryption key is stored with mode `0600` in that directory.

The API deliberately refuses to start if its database is not at the current Alembic revision. Run `uv run alembic upgrade head` after pulling schema changes.

## Public deployment

The included Compose topology runs PostgreSQL, a one-shot migration service, two API processes, a dedicated durable scan worker, and Nginx for the built React app and same-origin `/api` proxy.

1. Create a private production environment file and replace every placeholder:

   ```bash
   install -m 600 .env.production.example .env
   openssl rand -base64 48  # paste this one-line output into TSO_MASTER_KEY
   ```
2. Terminate TLS in a reverse proxy on the same host in front of the loopback-bound `TSO_HTTP_PORT`.
3. Preserve the original `Host`, forward the HTTPS scheme, overwrite `X-Forwarded-For` with the client chain, and set `TSO_PUBLIC_ORIGIN` to the exact external HTTPS origin.
4. Start the stack with `docker compose up --build -d`.
5. Confirm `https://your-host/api/ready` returns `{"status":"ready"}`. The separate
   `/api/health` endpoint is a process-only liveness check.

The production config requires HTTPS, secure cookies, an explicit public origin, and a master encryption key encoded from exactly 48 random bytes. Keep both the PostgreSQL volume and `TSO_MASTER_KEY` backed up: losing the key makes stored Telegram sessions intentionally unrecoverable. Follow the [backup and restore runbook](docs/backup-and-restore.md) for verified database archives, separate key custody, and safe fresh-database restores. Users rotate their Telegram API credentials by disconnecting and reconnecting. Rotate the master key only with a planned credential migration; existing AES-GCM ciphertext is bound to the current key and tenant context.

Registration can be closed with `TSO_ALLOW_REGISTRATION=false` after the intended accounts are created. The edge config rate-limits sign-in, registration, Telegram verification, and general API traffic. For a horizontally scaled deployment, use the same environment values for every API/worker replica and a shared PostgreSQL database.

This branch introduces a new tenant schema and intentionally refuses to adopt the old single-user development database because those rows have no account owner. Export any data you need, then deploy this release with a fresh database; there is no automatic legacy converter.

## Configuration

| Variable | Purpose | Production behavior |
| --- | --- | --- |
| `TSO_DATABASE_URL` | SQLAlchemy async database URL | Set by Compose to PostgreSQL |
| `TSO_MASTER_KEY` | Encryption root for Telegram secrets | Required base64/base64url encoding of exactly 48 random bytes |
| `TSO_PUBLIC_ORIGIN` | Exact browser origin | Required HTTPS origin |
| `TSO_ALLOWED_HOSTS` | Comma-separated accepted Host names | Defaults to public-origin host |
| `TSO_COOKIE_SECURE` | Enables `Secure` and `__Host-` cookies | Must be true |
| `TSO_ALLOW_REGISTRATION` | Enables public account creation | Defaults to true |
| `TSO_SESSION_ABSOLUTE_SECONDS` | Maximum session lifetime | Defaults to 30 days |
| `TSO_SESSION_IDLE_SECONDS` | Idle session lifetime | Defaults to 7 days |
| `TSO_MAX_ACTIVE_SESSIONS` | Maximum concurrently active sessions per account | Defaults to 10 |
| `TSO_PROCESS_SCANS_IN_API` | Runs scan jobs inside the API process | Defaults off in production; use worker |
| `TSO_HTTP_BIND/TSO_HTTP_PORT` | Address and port exposed by the web container | Defaults to `127.0.0.1:8080` for a same-host TLS proxy |
| `TSO_SCAN_MAX_MESSAGES` | Per-job message import ceiling, snapshotted at start | Defaults to 10,000 |
| `TSO_SCAN_MAX_RUNTIME_SECONDS` | Per-job wall-clock runtime ceiling, snapshotted at first claim | Defaults to 3,600 |
| `TSO_SCAN_SLICE_MAX_PAGES` | Maximum pages processed before yielding to another job | Defaults to 5 |
| `TSO_SCAN_SLICE_SECONDS` | Maximum duration of one worker slice | Defaults to 30 seconds |
| `TSO_SCAN_MAX_STREAMS_PER_USER` | Concurrent durable status streams per account | Defaults to 3 |
| `TSO_TELEGRAM_CONNECT_TIMEOUT_SECONDS` | Deadline for establishing a Telegram client connection | Defaults to 15 seconds |
| `TSO_TELEGRAM_DISCONNECT_TIMEOUT_SECONDS` | Deadline for Telegram client cleanup | Defaults to 5 seconds |

## Verification

```bash
cd backend
uv run ruff check app tests
uv run pytest
uv run alembic check
uv build

cd ../frontend
npm test
npm run build

cd ..
docker compose config --quiet
```
