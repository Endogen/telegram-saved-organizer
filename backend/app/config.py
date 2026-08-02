"""Application configuration."""

from __future__ import annotations

import os
import secrets
import stat
from dataclasses import dataclass
from pathlib import Path

PRIVATE_DIRECTORY_MODE = 0o700
PRIVATE_FILE_MODE = 0o600


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str
    data_dir: Path
    database_url: str
    api_token: str
    api_token_file: Path | None


def _validate_api_token(token: str, *, source: str) -> str:
    normalized = token.strip()
    if len(normalized) < 32:
        raise RuntimeError(f"{source} must contain at least 32 characters.")
    return normalized


def _read_api_token(path: Path) -> str:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"API token path is not a regular file: {path}")
    path.chmod(PRIVATE_FILE_MODE)
    return _validate_api_token(path.read_text(encoding="utf-8"), source=str(path))


def _load_or_create_api_token(data_dir: Path) -> tuple[str, Path | None]:
    configured_token = os.getenv("TSO_API_TOKEN")
    if configured_token is not None:
        return _validate_api_token(configured_token, source="TSO_API_TOKEN"), None

    token_file = data_dir / "api-token"
    try:
        return _read_api_token(token_file), token_file
    except FileNotFoundError:
        pass

    generated_token = secrets.token_urlsafe(32)
    try:
        descriptor = os.open(
            token_file,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            PRIVATE_FILE_MODE,
        )
    except FileExistsError:
        return _read_api_token(token_file), token_file

    with os.fdopen(descriptor, "w", encoding="utf-8") as token_stream:
        token_stream.write(f"{generated_token}\n")
    token_file.chmod(PRIVATE_FILE_MODE)
    return generated_token, token_file


def _build_settings() -> Settings:
    root_dir = Path(__file__).resolve().parents[1]
    default_data_dir = root_dir / "data"

    data_dir = Path(os.getenv("TSO_DATA_DIR", default_data_dir))
    data_dir.mkdir(mode=PRIVATE_DIRECTORY_MODE, parents=True, exist_ok=True)
    data_dir.chmod(PRIVATE_DIRECTORY_MODE)

    database_url = os.getenv("TSO_DATABASE_URL", f"sqlite+aiosqlite:///{data_dir / 'app.db'}")
    api_token, api_token_file = _load_or_create_api_token(data_dir)

    return Settings(
        app_name="Telegram Saved Messages Organizer API",
        data_dir=data_dir,
        database_url=database_url,
        api_token=api_token,
        api_token_file=api_token_file,
    )


settings = _build_settings()
