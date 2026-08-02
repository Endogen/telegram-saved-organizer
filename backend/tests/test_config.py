from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def run_config_import(tmp_path: Path, **overrides: str) -> subprocess.CompletedProcess[str]:
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("TSO_")
    }
    environment.update(
        {
            "TSO_DATA_DIR": str(tmp_path),
            **overrides,
        }
    )
    return subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.config import settings; print(settings.session_cookie_name)",
        ],
        check=False,
        capture_output=True,
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        text=True,
    )


def test_non_loopback_public_origin_requires_explicit_production(tmp_path: Path) -> None:
    result = run_config_import(tmp_path, TSO_PUBLIC_ORIGIN="https://organizer.example.com")

    assert result.returncode != 0
    assert "requires TSO_ENVIRONMENT=production" in result.stderr


def test_local_https_origin_enables_host_prefixed_secure_cookie(tmp_path: Path) -> None:
    result = run_config_import(tmp_path, TSO_PUBLIC_ORIGIN="https://localhost")

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "__Host-tso_session"


def test_production_rejects_wildcard_hosts(tmp_path: Path) -> None:
    result = run_config_import(
        tmp_path,
        TSO_ENVIRONMENT="production",
        TSO_PUBLIC_ORIGIN="https://organizer.example.com",
        TSO_ALLOWED_HOSTS="*",
        TSO_MASTER_KEY="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    )

    assert result.returncode != 0
    assert "Wildcard TSO_ALLOWED_HOSTS" in result.stderr


def test_production_uses_secure_host_prefixed_cookie(tmp_path: Path) -> None:
    result = run_config_import(
        tmp_path,
        TSO_ENVIRONMENT="production",
        TSO_PUBLIC_ORIGIN="https://organizer.example.com",
        TSO_ALLOWED_HOSTS="organizer.example.com",
        TSO_MASTER_KEY="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "__Host-tso_session"


def test_scan_resource_limits_must_be_positive(tmp_path: Path) -> None:
    result = run_config_import(tmp_path, TSO_SCAN_MAX_MESSAGES="0")

    assert result.returncode != 0
    assert "TSO_SCAN_MAX_MESSAGES must be greater than zero" in result.stderr
