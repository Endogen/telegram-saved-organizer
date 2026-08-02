"""add shared abuse rate-limit buckets

Revision ID: d7e8f9a0b1c2
Revises: c4f1a2b3d4e5
Create Date: 2026-08-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d7e8f9a0b1c2"
down_revision: str | Sequence[str] | None = "c4f1a2b3d4e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "abuse_rate_limit_buckets",
        sa.Column("scope", sa.String(length=48), nullable=False),
        sa.Column("subject_hash", sa.String(length=64), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hit_count", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "hit_count >= 1",
            name="ck_abuse_rate_limit_buckets_hit_count_positive",
        ),
        sa.PrimaryKeyConstraint(
            "scope",
            "subject_hash",
            "window_started_at",
            name="pk_abuse_rate_limit_buckets",
        ),
    )
    op.create_index(
        "ix_abuse_rate_limit_buckets_expires_at",
        "abuse_rate_limit_buckets",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_abuse_rate_limit_buckets_expires_at",
        table_name="abuse_rate_limit_buckets",
    )
    op.drop_table("abuse_rate_limit_buckets")
