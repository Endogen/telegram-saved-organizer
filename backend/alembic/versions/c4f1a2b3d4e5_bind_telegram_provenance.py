"""bind messages and scan jobs to a Telegram principal generation

Revision ID: c4f1a2b3d4e5
Revises: a92d6e8b4f31
Create Date: 2026-08-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4f1a2b3d4e5"
down_revision: str | Sequence[str] | None = "a92d6e8b4f31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("telegram_connections") as batch_op:
        batch_op.add_column(
            sa.Column("generation", sa.Integer(), server_default="0", nullable=False)
        )
        batch_op.create_check_constraint(
            "ck_telegram_connections_generation_non_negative",
            "generation >= 0",
        )

    with op.batch_alter_table("scan_jobs") as batch_op:
        batch_op.add_column(
            sa.Column("telegram_user_id", sa.BigInteger(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("connection_generation", sa.Integer(), nullable=True)
        )
        batch_op.create_check_constraint(
            "ck_scan_jobs_provenance_complete",
            "(telegram_user_id IS NULL AND connection_generation IS NULL) OR "
            "(telegram_user_id IS NOT NULL AND connection_generation IS NOT NULL)",
        )
        batch_op.create_check_constraint(
            "ck_scan_jobs_connection_generation_non_negative",
            "connection_generation IS NULL OR connection_generation >= 0",
        )

    # A job created by an older release cannot be safely resumed because it has
    # no Telegram-principal provenance. Terminalize it instead of guessing.
    scan_jobs = sa.table(
        "scan_jobs",
        sa.column("state", sa.String()),
        sa.column("stop_requested", sa.Boolean()),
        sa.column("finished_at", sa.DateTime(timezone=True)),
        sa.column("lease_owner", sa.String()),
        sa.column("lease_expires_at", sa.DateTime(timezone=True)),
    )
    op.execute(
        sa.update(scan_jobs)
        .where(scan_jobs.c.state.in_(("pending", "running", "stopping")))
        .values(
            state="cancelled",
            stop_requested=True,
            finished_at=sa.func.now(),
            lease_owner=None,
            lease_expires_at=None,
        )
    )

    with op.batch_alter_table("messages") as batch_op:
        batch_op.add_column(
            sa.Column("telegram_user_id", sa.BigInteger(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("connection_generation", sa.Integer(), nullable=True)
        )
        batch_op.drop_constraint("uq_messages_user_id_telegram_id", type_="unique")
        batch_op.create_unique_constraint(
            "uq_messages_user_id_telegram_user_id_telegram_id",
            ["user_id", "telegram_user_id", "telegram_id"],
        )
        batch_op.create_check_constraint(
            "ck_messages_provenance_complete",
            "(telegram_user_id IS NULL AND connection_generation IS NULL) OR "
            "(telegram_user_id IS NOT NULL AND connection_generation IS NOT NULL)",
        )
        batch_op.create_check_constraint(
            "ck_messages_connection_generation_non_negative",
            "connection_generation IS NULL OR connection_generation >= 0",
        )


def _assert_message_identity_can_be_downgraded() -> None:
    """Refuse a lossy downgrade when the legacy unique key would collide."""

    messages = sa.table(
        "messages",
        sa.column("user_id", sa.String()),
        sa.column("telegram_id", sa.BigInteger()),
    )
    duplicate = (
        op.get_bind()
        .execute(
            sa.select(messages.c.user_id, messages.c.telegram_id)
            .group_by(messages.c.user_id, messages.c.telegram_id)
            .having(sa.func.count() > 1)
            .limit(1)
        )
        .first()
    )
    if duplicate is not None:
        raise RuntimeError(
            "Cannot downgrade Telegram message provenance: multiple messages "
            "would collide on the legacy (user_id, telegram_id) uniqueness key. "
            "Resolve or export those messages before retrying the downgrade."
        )


def downgrade() -> None:
    # This must happen before any schema mutation so a refused downgrade leaves
    # the provenance-aware schema fully intact.
    _assert_message_identity_can_be_downgraded()

    with op.batch_alter_table("messages") as batch_op:
        batch_op.drop_constraint(
            "ck_messages_connection_generation_non_negative", type_="check"
        )
        batch_op.drop_constraint("ck_messages_provenance_complete", type_="check")
        batch_op.drop_constraint(
            "uq_messages_user_id_telegram_user_id_telegram_id", type_="unique"
        )
        batch_op.create_unique_constraint(
            "uq_messages_user_id_telegram_id", ["user_id", "telegram_id"]
        )
        batch_op.drop_column("connection_generation")
        batch_op.drop_column("telegram_user_id")

    with op.batch_alter_table("scan_jobs") as batch_op:
        batch_op.drop_constraint(
            "ck_scan_jobs_connection_generation_non_negative", type_="check"
        )
        batch_op.drop_constraint("ck_scan_jobs_provenance_complete", type_="check")
        batch_op.drop_column("connection_generation")
        batch_op.drop_column("telegram_user_id")

    with op.batch_alter_table("telegram_connections") as batch_op:
        batch_op.drop_constraint(
            "ck_telegram_connections_generation_non_negative", type_="check"
        )
        batch_op.drop_column("generation")
