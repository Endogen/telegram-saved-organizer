"""add scan job leases

Revision ID: a92d6e8b4f31
Revises: e26c5288e11f
Create Date: 2026-08-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a92d6e8b4f31"
down_revision: str | Sequence[str] | None = "e26c5288e11f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("scan_jobs", sa.Column("lease_owner", sa.String(length=64), nullable=True))
    op.add_column(
        "scan_jobs",
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "scan_jobs",
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_scan_jobs_state_lease_expires_created_at",
        "scan_jobs",
        ["state", "lease_expires_at", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_scan_jobs_state_lease_expires_created_at", table_name="scan_jobs")
    op.drop_column("scan_jobs", "heartbeat_at")
    op.drop_column("scan_jobs", "lease_expires_at")
    op.drop_column("scan_jobs", "lease_owner")
