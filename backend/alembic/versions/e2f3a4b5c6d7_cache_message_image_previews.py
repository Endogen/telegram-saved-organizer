"""cache bounded image previews with messages

Revision ID: e2f3a4b5c6d7
Revises: a1b2c3d4e5f6
Create Date: 2026-08-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2f3a4b5c6d7"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("messages") as batch_op:
        batch_op.add_column(sa.Column("cached_media", sa.LargeBinary(), nullable=True))
        batch_op.add_column(
            sa.Column("cached_media_mime_type", sa.String(length=100), nullable=True)
        )
        batch_op.create_check_constraint(
            "ck_messages_cached_media_complete",
            "(cached_media IS NULL AND cached_media_mime_type IS NULL) OR "
            "(cached_media IS NOT NULL AND cached_media_mime_type IS NOT NULL)",
        )


def downgrade() -> None:
    with op.batch_alter_table("messages") as batch_op:
        batch_op.drop_constraint(
            "ck_messages_cached_media_complete",
            type_="check",
        )
        batch_op.drop_column("cached_media_mime_type")
        batch_op.drop_column("cached_media")
