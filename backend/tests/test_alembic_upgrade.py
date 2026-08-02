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
    assert check_result.returncode == 0, f"{check_result.stdout}\n{check_result.stderr}"

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
    assert {
        "id",
        "user_id",
        "telegram_id",
        "category_id",
        "last_seen_replacement_job_id",
    } <= message_columns
    assert {
        "last_message_id",
        "max_messages",
        "max_runtime_seconds",
        "completion_reason",
        "lease_owner",
        "lease_expires_at",
        "heartbeat_at",
        "replace_existing",
    } <= scan_job_columns



def test_per_user_credential_migration_erases_sessions_in_both_directions(
    tmp_path: Path,
) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    database_file = tmp_path / "credential-migration.db"
    environment = os.environ.copy()
    environment.update(
        {
            "TSO_ENVIRONMENT": "test",
            "TSO_DATA_DIR": str(tmp_path / "data"),
            "TSO_DATABASE_URL": f"sqlite+aiosqlite:///{database_file}",
            "TSO_MASTER_KEY": "migration-test-master-key-with-more-than-43-characters",
        }
    )

    def upgrade(revision: str) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", revision],
            cwd=backend_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"

    upgrade("f1a2b3c4d5e6")
    with sqlite3.connect(database_file) as connection:
        connection.execute(
            """
            INSERT INTO users (
                id, email, normalized_email, display_name, password_hash,
                is_active, failed_login_attempts
            ) VALUES ('user-a', 'a@example.test', 'a@example.test', 'A', 'hash', 1, 0)
            """
        )
        connection.execute(
            """
            INSERT INTO telegram_connections (
                id, user_id, telegram_user_id, phone_encrypted, session_encrypted,
                state, pending_phone_code_hash_encrypted, password_required, generation
            ) VALUES (
                'connection-a', 'user-a', 101, 'phone', 'session',
                'connected', 'challenge', 1, 4
            )
            """
        )
        connection.execute(
            """
            INSERT INTO scan_jobs (
                id, user_id, state, stop_requested, messages_scanned,
                pages_scanned, page_size, telegram_user_id, connection_generation
            ) VALUES ('job-a', 'user-a', 'running', 0, 0, 0, 100, 101, 4)
            """
        )
        connection.execute(
            """
            INSERT INTO categories (
                id, user_id, name, normalized_name, slug, system_key,
                icon, color, position, is_default
            ) VALUES (1, 'user-a', 'Other', 'other', 'other', 'other',
                      'archive', '#64748B', 1, 1)
            """
        )
        connection.execute(
            """
            INSERT INTO messages (
                user_id, telegram_id, content, date, category_id, raw_data,
                last_seen_replacement_job_id
            ) VALUES ('user-a', 501, 'staged', CURRENT_TIMESTAMP, 1, '{}', 'job-a')
            """
        )

    upgrade("head")
    with sqlite3.connect(database_file) as connection:
        telegram = connection.execute(
            """
            SELECT state, telegram_user_id, phone_encrypted, session_encrypted,
                   pending_phone_code_hash_encrypted, password_required, generation
            FROM telegram_connections WHERE id = 'connection-a'
            """
        ).fetchone()
        scan = connection.execute(
            "SELECT state, stop_requested, lease_owner FROM scan_jobs WHERE id = 'job-a'"
        ).fetchone()
        message_marker = connection.execute(
            "SELECT last_seen_replacement_job_id FROM messages WHERE telegram_id = 501"
        ).fetchone()
        assert telegram == ("disconnected", None, None, None, None, 0, 5)
        assert scan == ("cancelled", 1, None)
        assert message_marker == (None,)
        connection.execute(
            """
            UPDATE telegram_connections
            SET state = 'connected', telegram_user_id = 101,
                api_id_encrypted = 'api-id', api_hash_encrypted = 'api-hash',
                phone_encrypted = 'phone', session_encrypted = 'session',
                pending_phone_code_hash_encrypted = 'challenge', password_required = 1
            WHERE id = 'connection-a'
            """
        )
        connection.execute(
            "UPDATE scan_jobs SET state = 'running', stop_requested = 0 WHERE id = 'job-a'"
        )
        connection.execute(
            "UPDATE messages SET last_seen_replacement_job_id = 'job-a' WHERE telegram_id = 501"
        )

    downgrade = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "downgrade", "f1a2b3c4d5e6"],
        cwd=backend_root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert downgrade.returncode == 0, f"{downgrade.stdout}\n{downgrade.stderr}"
    with sqlite3.connect(database_file) as connection:
        telegram = connection.execute(
            """
            SELECT state, telegram_user_id, phone_encrypted, session_encrypted,
                   pending_phone_code_hash_encrypted, password_required, generation
            FROM telegram_connections WHERE id = 'connection-a'
            """
        ).fetchone()
        scan = connection.execute(
            "SELECT state, stop_requested, lease_owner FROM scan_jobs WHERE id = 'job-a'"
        ).fetchone()
        message_marker = connection.execute(
            "SELECT last_seen_replacement_job_id FROM messages WHERE telegram_id = 501"
        ).fetchone()
        columns = {row[1] for row in connection.execute("PRAGMA table_info(telegram_connections)")}
    assert telegram == ("disconnected", None, None, None, None, 0, 6)
    assert scan == ("cancelled", 1, None)
    assert message_marker == (None,)
    assert "api_id_encrypted" not in columns
    assert "api_hash_encrypted" not in columns


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


def test_provenance_downgrade_refuses_legacy_message_identity_collisions(
    tmp_path: Path,
) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    database_file = tmp_path / "provenance.db"
    environment = os.environ.copy()
    environment.update(
        {
            "TSO_ENVIRONMENT": "test",
            "TSO_DATA_DIR": str(tmp_path / "data"),
            "TSO_DATABASE_URL": f"sqlite+aiosqlite:///{database_file}",
            "TSO_MASTER_KEY": "migration-test-master-key-with-more-than-43-characters",
        }
    )
    upgrade_result = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            "alembic.ini",
            "upgrade",
            "c4f1a2b3d4e5",
        ],
        cwd=backend_root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert upgrade_result.returncode == 0, (
        f"{upgrade_result.stdout}\n{upgrade_result.stderr}"
    )

    with sqlite3.connect(database_file) as connection:
        connection.execute(
            """
            INSERT INTO users (
                id, email, normalized_email, display_name, password_hash,
                is_active, failed_login_attempts
            ) VALUES (?, ?, ?, ?, ?, 1, 0)
            """,
            ("user-a", "owner@example.com", "owner@example.com", "Owner", "hash"),
        )
        connection.execute(
            """
            INSERT INTO categories (
                id, user_id, name, normalized_name, slug, icon, color,
                position, is_default
            ) VALUES (1, 'user-a', 'Other', 'other', 'other', 'inbox', '#64748B', 0, 1)
            """
        )
        connection.executemany(
            """
            INSERT INTO messages (
                user_id, telegram_id, telegram_user_id,
                connection_generation, content, date, category_id, raw_data
            ) VALUES ('user-a', 42, ?, 0, 'message', '2026-08-02', 1, '{}')
            """,
            [(1001,), (2002,)],
        )

    downgrade_result = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            "alembic.ini",
            "downgrade",
            "a92d6e8b4f31",
        ],
        cwd=backend_root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert downgrade_result.returncode != 0
    output = f"{downgrade_result.stdout}\n{downgrade_result.stderr}"
    assert "Cannot downgrade Telegram message provenance" in output
    with sqlite3.connect(database_file) as connection:
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == ("c4f1a2b3d4e5",)
        message_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(messages)")
        }
    assert {"telegram_user_id", "connection_generation"} <= message_columns


def test_provenance_downgrade_succeeds_when_legacy_message_keys_are_unique(
    tmp_path: Path,
) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    database_file = tmp_path / "safe-provenance.db"
    environment = os.environ.copy()
    environment.update(
        {
            "TSO_ENVIRONMENT": "test",
            "TSO_DATA_DIR": str(tmp_path / "data"),
            "TSO_DATABASE_URL": f"sqlite+aiosqlite:///{database_file}",
            "TSO_MASTER_KEY": "migration-test-master-key-with-more-than-43-characters",
        }
    )

    for command in (
        ("upgrade", "c4f1a2b3d4e5"),
        ("downgrade", "a92d6e8b4f31"),
    ):
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "-c",
                "alembic.ini",
                *command,
            ],
            cwd=backend_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"

    with sqlite3.connect(database_file) as connection:
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == ("a92d6e8b4f31",)
        message_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(messages)")
        }
    assert "telegram_user_id" not in message_columns
    assert "connection_generation" not in message_columns
