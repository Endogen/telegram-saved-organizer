"""Validated application configuration for local development and public hosting."""

from __future__ import annotations

import os
import secrets
import stat
from dataclasses import dataclass
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlsplit

PRIVATE_DIRECTORY_MODE = 0o700
PRIVATE_FILE_MODE = 0o600
PRODUCTION_PLACEHOLDER_MARKERS = ("replace-with", "organizer.example.com")


def _read_bool(name: str, *, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be true or false.")


def _read_positive_int(name: str, *, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer.") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero.")
    return value


def _reject_production_placeholder(name: str, value: str) -> None:
    normalized = value.strip().casefold()
    if any(marker in normalized for marker in PRODUCTION_PLACEHOLDER_MARKERS):
        raise RuntimeError(f"{name} still contains an example placeholder.")
    if name == "TSO_TELEGRAM_API_ID" and normalized == "123456":
        raise RuntimeError(f"{name} still contains the example placeholder.")


def _normalize_origin(value: str, *, require_https: bool) -> str:
    try:
        parsed = urlsplit(value.strip())
        port = parsed.port
    except ValueError as exc:
        raise RuntimeError("TSO_PUBLIC_ORIGIN must be a valid origin URL.") from exc
    if parsed.scheme not in {"http", "https"} or parsed.hostname is None:
        raise RuntimeError("TSO_PUBLIC_ORIGIN must use http or https and include a host.")
    if require_https and parsed.scheme != "https":
        raise RuntimeError("TSO_PUBLIC_ORIGIN must use https in production.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise RuntimeError("TSO_PUBLIC_ORIGIN must be an origin without credentials, path, query, or fragment.")
    default_port = 443 if parsed.scheme == "https" else 80
    port_suffix = "" if (port or default_port) == default_port else f":{port}"
    return f"{parsed.scheme}://{parsed.hostname.lower().rstrip('.')}{port_suffix}"


def _is_loopback_host(value: str) -> bool:
    host = value.strip().lower().rstrip(".")
    if host in {"localhost", "testserver"}:
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def _private_regular_file(path: Path) -> str:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"Secret path is not a regular file: {path}")
    path.chmod(PRIVATE_FILE_MODE)
    value = path.read_text(encoding="utf-8").strip()
    if len(value) < 43:
        raise RuntimeError(f"Secret in {path} must contain at least 43 characters.")
    return value


def _load_master_key(*, data_dir: Path, production: bool) -> tuple[str, Path | None]:
    configured = os.getenv("TSO_MASTER_KEY")
    if configured is not None:
        normalized = configured.strip()
        if len(normalized) < 43:
            raise RuntimeError("TSO_MASTER_KEY must contain at least 43 characters of entropy.")
        return normalized, None
    if production:
        raise RuntimeError("TSO_MASTER_KEY is required when TSO_ENVIRONMENT=production.")

    path = data_dir / "master-key"
    try:
        return _private_regular_file(path), path
    except FileNotFoundError:
        pass

    generated = secrets.token_urlsafe(48)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, PRIVATE_FILE_MODE)
    except FileExistsError:
        return _private_regular_file(path), path
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(f"{generated}\n")
    path.chmod(PRIVATE_FILE_MODE)
    return generated, path


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str
    environment: str
    data_dir: Path
    database_url: str
    master_key: str
    master_key_file: Path | None
    public_origin: str | None
    allowed_hosts: tuple[str, ...]
    cookie_secure: bool
    allow_registration: bool
    session_absolute_seconds: int
    session_idle_seconds: int
    max_active_sessions: int
    process_scans_in_api: bool
    scan_max_messages: int
    scan_max_runtime_seconds: int
    scan_slice_max_pages: int
    scan_slice_seconds: int
    scan_max_streams_per_user: int
    telegram_api_id: int | None
    telegram_api_hash: str | None

    @property
    def production(self) -> bool:
        return self.environment == "production"

    @property
    def session_cookie_name(self) -> str:
        return "__Host-tso_session" if self.cookie_secure else "tso_session"

    @property
    def csrf_cookie_name(self) -> str:
        return "__Host-tso_csrf" if self.cookie_secure else "tso_csrf"


def _build_settings() -> Settings:
    environment = os.getenv("TSO_ENVIRONMENT", "development").strip().lower()
    if environment not in {"development", "test", "production"}:
        raise RuntimeError("TSO_ENVIRONMENT must be development, test, or production.")
    production = environment == "production"

    root_dir = Path(__file__).resolve().parents[1]
    data_dir = Path(os.getenv("TSO_DATA_DIR", root_dir / "data")).expanduser().resolve()
    data_dir.mkdir(mode=PRIVATE_DIRECTORY_MODE, parents=True, exist_ok=True)
    data_dir.chmod(PRIVATE_DIRECTORY_MODE)

    database_url = os.getenv("TSO_DATABASE_URL", f"sqlite+aiosqlite:///{data_dir / 'app.db'}").strip()
    master_key, master_key_file = _load_master_key(data_dir=data_dir, production=production)
    if production:
        _reject_production_placeholder("TSO_DATABASE_URL", database_url)
        _reject_production_placeholder("TSO_MASTER_KEY", master_key)

    origin_value = os.getenv("TSO_PUBLIC_ORIGIN")
    public_origin = (
        _normalize_origin(origin_value, require_https=production) if origin_value else None
    )
    if production and public_origin is None:
        raise RuntimeError("TSO_PUBLIC_ORIGIN is required in production.")
    if production and public_origin is not None:
        _reject_production_placeholder("TSO_PUBLIC_ORIGIN", public_origin)
    if public_origin is not None:
        public_host = urlsplit(public_origin).hostname
        if not production and (public_host is None or not _is_loopback_host(public_host)):
            raise RuntimeError(
                "A non-loopback TSO_PUBLIC_ORIGIN requires TSO_ENVIRONMENT=production."
            )

    configured_hosts = tuple(
        host.strip().lower()
        for host in os.getenv("TSO_ALLOWED_HOSTS", "").split(",")
        if host.strip()
    )
    if production:
        for configured_host in configured_hosts:
            _reject_production_placeholder("TSO_ALLOWED_HOSTS", configured_host)
    derived_host = urlsplit(public_origin).hostname if public_origin else None
    allowed_hosts = configured_hosts or ((derived_host,) if derived_host else ("127.0.0.1", "localhost", "testserver"))
    if production and any(host == "*" or host.startswith("*.") for host in allowed_hosts):
        raise RuntimeError("Wildcard TSO_ALLOWED_HOSTS values are not allowed in production.")
    if not production and any(not _is_loopback_host(host) for host in allowed_hosts):
        raise RuntimeError(
            "Non-loopback TSO_ALLOWED_HOSTS values require TSO_ENVIRONMENT=production."
        )

    cookie_secure = _read_bool(
        "TSO_COOKIE_SECURE",
        default=production or bool(public_origin and public_origin.startswith("https://")),
    )
    if production and not cookie_secure:
        raise RuntimeError("TSO_COOKIE_SECURE cannot be disabled in production.")

    telegram_api_id_raw = os.getenv("TSO_TELEGRAM_API_ID")
    telegram_api_hash = os.getenv("TSO_TELEGRAM_API_HASH")
    telegram_api_id: int | None = None
    if telegram_api_id_raw:
        try:
            telegram_api_id = int(telegram_api_id_raw)
        except ValueError as exc:
            raise RuntimeError("TSO_TELEGRAM_API_ID must be an integer.") from exc
        if telegram_api_id <= 0:
            raise RuntimeError("TSO_TELEGRAM_API_ID must be positive.")
    if bool(telegram_api_id) != bool(telegram_api_hash):
        raise RuntimeError("TSO_TELEGRAM_API_ID and TSO_TELEGRAM_API_HASH must be configured together.")
    if production and telegram_api_id_raw:
        _reject_production_placeholder("TSO_TELEGRAM_API_ID", telegram_api_id_raw)
    if production and telegram_api_hash:
        _reject_production_placeholder("TSO_TELEGRAM_API_HASH", telegram_api_hash)

    absolute_seconds = _read_positive_int("TSO_SESSION_ABSOLUTE_SECONDS", default=30 * 24 * 60 * 60)
    idle_seconds = _read_positive_int("TSO_SESSION_IDLE_SECONDS", default=7 * 24 * 60 * 60)
    if idle_seconds > absolute_seconds:
        raise RuntimeError("TSO_SESSION_IDLE_SECONDS cannot exceed TSO_SESSION_ABSOLUTE_SECONDS.")

    return Settings(
        app_name="Telegram Saved Messages Organizer API",
        environment=environment,
        data_dir=data_dir,
        database_url=database_url,
        master_key=master_key,
        master_key_file=master_key_file,
        public_origin=public_origin,
        allowed_hosts=allowed_hosts,
        cookie_secure=cookie_secure,
        allow_registration=_read_bool("TSO_ALLOW_REGISTRATION", default=True),
        session_absolute_seconds=absolute_seconds,
        session_idle_seconds=idle_seconds,
        max_active_sessions=_read_positive_int("TSO_MAX_ACTIVE_SESSIONS", default=10),
        process_scans_in_api=_read_bool("TSO_PROCESS_SCANS_IN_API", default=not production),
        scan_max_messages=_read_positive_int("TSO_SCAN_MAX_MESSAGES", default=10_000),
        scan_max_runtime_seconds=_read_positive_int(
            "TSO_SCAN_MAX_RUNTIME_SECONDS",
            default=60 * 60,
        ),
        scan_slice_max_pages=_read_positive_int("TSO_SCAN_SLICE_MAX_PAGES", default=5),
        scan_slice_seconds=_read_positive_int("TSO_SCAN_SLICE_SECONDS", default=30),
        scan_max_streams_per_user=_read_positive_int(
            "TSO_SCAN_MAX_STREAMS_PER_USER",
            default=3,
        ),
        telegram_api_id=telegram_api_id,
        telegram_api_hash=telegram_api_hash.strip() if telegram_api_hash else None,
    )


settings = _build_settings()
