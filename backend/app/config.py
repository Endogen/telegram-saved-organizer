"""Application configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str
    data_dir: Path
    database_url: str


def _build_settings() -> Settings:
    root_dir = Path(__file__).resolve().parents[1]
    default_data_dir = root_dir / "data"

    data_dir = Path(os.getenv("TSO_DATA_DIR", default_data_dir))
    data_dir.mkdir(parents=True, exist_ok=True)

    database_url = os.getenv("TSO_DATABASE_URL", f"sqlite+aiosqlite:///{data_dir / 'app.db'}")

    return Settings(
        app_name="Telegram Saved Messages Organizer API",
        data_dir=data_dir,
        database_url=database_url,
    )


settings = _build_settings()
