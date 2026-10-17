"""add 'simulated' stream type

Revision ID: 4a7c1e2b9d10
Revises: 93197d642cc5
Create Date: 2026-10-17 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "4a7c1e2b9d10"
down_revision: Union[str, None] = "93197d642cc5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres 12+ allows ADD VALUE inside a transaction as long as the new value
    # isn't used in that same transaction, which this migration never does.
    op.execute("ALTER TYPE stream_type ADD VALUE IF NOT EXISTS 'simulated'")


def downgrade() -> None:
    # Postgres cannot drop a single enum value. Rewrite any simulated cameras to
    # 'file' and rebuild the type without it.
    op.execute("UPDATE cameras SET stream_type = 'file' WHERE stream_type = 'simulated'")
    op.execute("ALTER TYPE stream_type RENAME TO stream_type_old")
    op.execute("CREATE TYPE stream_type AS ENUM ('rtsp', 'http', 'onvif', 'usb', 'file', 'webcam')")
    op.execute(
        "ALTER TABLE cameras ALTER COLUMN stream_type TYPE stream_type "
        "USING stream_type::text::stream_type"
    )
    op.execute("DROP TYPE stream_type_old")
