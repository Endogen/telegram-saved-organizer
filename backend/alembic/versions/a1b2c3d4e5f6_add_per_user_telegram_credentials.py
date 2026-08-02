"""add per-user Telegram API credentials

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-08-03 00:20:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cancel_active_scans() -> None:
    op.execute(
        sa.text(
            """
            UPDATE messages
            SET last_seen_replacement_job_id = NULL
            WHERE last_seen_replacement_job_id IN (
                SELECT id
                FROM scan_jobs
                WHERE state IN ('pending', 'running', 'stopping')
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE scan_jobs
            SET state = 'cancelled',
                stop_requested = true,
                completion_reason = 'stopped_by_user',
                finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
                lease_owner = NULL,
                lease_expires_at = NULL,
                heartbeat_at = NULL
            WHERE state IN ('pending', 'running', 'stopping')
            """
        )
    )


def _erase_authorization_material() -> None:
    op.execute(
        sa.text(
            """
            UPDATE telegram_connections
            SET state = 'disconnected',
                telegram_user_id = NULL,
                phone_encrypted = NULL,
                session_encrypted = NULL,
                password_required = false,
                pending_phone_code_hash_encrypted = NULL,
                pending_expires_at = NULL,
                generation = generation + 1
            """
        )
    )


def upgrade() -> None:
    with op.batch_alter_table("telegram_connections", schema=None) as batch_op:
        batch_op.add_column(sa.Column("api_id_encrypted", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("api_hash_encrypted", sa.Text(), nullable=True))

    # Legacy sessions were created with one server-owned Telegram application.
    # They cannot be used after credentials become tenant-owned, so force an
    # explicit reconnect and crypto-erase every challenge/session value.
    _cancel_active_scans()
    _erase_authorization_material()


def downgrade() -> None:
    # Returning to the server-owned credential model must not revive sessions
    # created with tenant-owned Telegram applications.
    _cancel_active_scans()
    _erase_authorization_material()
    with op.batch_alter_table("telegram_connections", schema=None) as batch_op:
        batch_op.drop_column("api_hash_encrypted")
        batch_op.drop_column("api_id_encrypted")
