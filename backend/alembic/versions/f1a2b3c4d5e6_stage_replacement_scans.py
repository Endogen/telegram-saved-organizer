"""stage destructive replacement scans until source exhaustion

Revision ID: f1a2b3c4d5e6
Revises: b8c9d0e1f2a3
Create Date: 2026-08-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: str | Sequence[str] | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("scan_jobs") as batch_op:
        batch_op.add_column(
            sa.Column(
                "replace_existing",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )

    with op.batch_alter_table("messages") as batch_op:
        batch_op.add_column(
            sa.Column(
                "last_seen_replacement_job_id",
                sa.String(length=36),
                nullable=True,
            )
        )
        batch_op.create_foreign_key(
            "fk_messages_last_seen_replacement_job_id_scan_jobs",
            "scan_jobs",
            ["last_seen_replacement_job_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_messages_user_id_last_seen_replacement_job_id",
            ["user_id", "last_seen_replacement_job_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("messages") as batch_op:
        batch_op.drop_index("ix_messages_user_id_last_seen_replacement_job_id")
        batch_op.drop_constraint(
            "fk_messages_last_seen_replacement_job_id_scan_jobs",
            type_="foreignkey",
        )
        batch_op.drop_column("last_seen_replacement_job_id")

    with op.batch_alter_table("scan_jobs") as batch_op:
        batch_op.drop_column("replace_existing")
