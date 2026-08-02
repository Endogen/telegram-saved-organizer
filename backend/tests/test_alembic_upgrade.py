from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_fresh_alembic_upgrade_creates_current_multi_user_schema(
    tmp_path: Path,
) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    database_file = tmp_path / "fresh.db"
    database_url = f"sqlite+aiosqlite:///{database_file}"
    environment = os.environ.copy()
    environment.update(
        {
            "TSO_ENVIRONMENT": "test",
            "TSO_DATA_DIR": str(tmp_path / "data"),
            "TSO_DATABASE_URL": database_url,
            "TSO_MASTER_KEY": "migration-test-master-key-with-more-than-43-characters",
        }
    )

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=backend_root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"

    check_result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "check"],
        cwd=backend_root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert check_result.returncode == 0, (
        f"{check_result.stdout}\n{check_result.stderr}"
    )

    config = Config(str(backend_root / "alembic.ini"))
    expected_revision = ScriptDirectory.from_config(config).get_current_head()
    with sqlite3.connect(database_file) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        current_revision = connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone()
        message_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(messages)")
        }
        scan_job_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(scan_jobs)")
        }

    assert {
        "alembic_version",
        "abuse_rate_limit_buckets",
        "users",
        "web_sessions",
        "telegram_connections",
        "scan_jobs",
        "scan_stream_slots",
        "categories",
        "messages",
        "message_tags",
        "tags",
    } <= tables
    assert current_revision == (expected_revision,)
    assert {"id", "user_id", "telegram_id", "category_id"} <= message_columns
    assert {
        "last_message_id",
        "max_messages",
        "max_runtime_seconds",
        "completion_reason",
        "lease_owner",
        "lease_expires_at",
        "heartbeat_at",
    } <= scan_job_columns


def test_alembic_refuses_unowned_legacy_single_user_database(tmp_path: Path) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    database_file = tmp_path / "legacy.db"
    with sqlite3.connect(database_file) as connection:
        connection.execute(
            "CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"
        )

    environment = os.environ.copy()
    environment.update(
        {
            "TSO_ENVIRONMENT": "test",
            "TSO_DATA_DIR": str(tmp_path / "data"),
            "TSO_DATABASE_URL": f"sqlite+aiosqlite:///{database_file}",
            "TSO_MASTER_KEY": "migration-test-master-key-with-more-than-43-characters",
        }
    )
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=backend_root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "Unsupported legacy single-user database detected" in result.stderr
    with sqlite3.connect(database_file) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert "categories" in tables
    assert "users" not in tables
