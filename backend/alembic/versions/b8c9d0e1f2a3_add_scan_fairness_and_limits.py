"""add fair scan slices, quotas, and durable stream slots

Revision ID: b8c9d0e1f2a3
Revises: d7e8f9a0b1c2
Create Date: 2026-08-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: str | Sequence[str] | None = "d7e8f9a0b1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("scan_jobs") as batch_op:
        batch_op.add_column(
            sa.Column(
                "max_messages",
                sa.Integer(),
                server_default="10000",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "max_runtime_seconds",
                sa.Integer(),
                server_default="3600",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column("completion_reason", sa.String(length=32), nullable=True)
        )
        batch_op.create_check_constraint(
            "ck_scan_jobs_max_messages_positive",
            "max_messages > 0",
        )
        batch_op.create_check_constraint(
            "ck_scan_jobs_max_runtime_seconds_positive",
            "max_runtime_seconds > 0",
        )
        batch_op.create_check_constraint(
            "ck_scan_jobs_completion_reason_valid",
            "completion_reason IS NULL OR completion_reason IN "
            "('source_exhausted', 'message_limit_reached', "
            "'runtime_limit_reached', 'stopped_by_user')",
        )
        batch_op.create_index(
            "ix_scan_jobs_state_heartbeat_created_at",
            ["state", "heartbeat_at", "created_at"],
            unique=False,
        )

    op.create_table(
        "scan_stream_slots",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("slot", sa.Integer(), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "slot >= 0",
            name="ck_scan_stream_slots_slot_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_scan_stream_slots_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "user_id",
            "slot",
            name="pk_scan_stream_slots",
        ),
    )
    op.create_index(
        "ix_scan_stream_slots_lease_expires_at",
        "scan_stream_slots",
        ["lease_expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_scan_stream_slots_lease_expires_at",
        table_name="scan_stream_slots",
    )
    op.drop_table("scan_stream_slots")

    with op.batch_alter_table("scan_jobs") as batch_op:
        batch_op.drop_index("ix_scan_jobs_state_heartbeat_created_at")
        batch_op.drop_constraint(
            "ck_scan_jobs_completion_reason_valid",
            type_="check",
        )
        batch_op.drop_constraint(
            "ck_scan_jobs_max_runtime_seconds_positive",
            type_="check",
        )
        batch_op.drop_constraint(
            "ck_scan_jobs_max_messages_positive",
            type_="check",
        )
        batch_op.drop_column("completion_reason")
        batch_op.drop_column("max_runtime_seconds")
        batch_op.drop_column("max_messages")
