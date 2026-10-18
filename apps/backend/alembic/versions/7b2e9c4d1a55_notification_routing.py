"""notification routing: staff phone numbers and opt-out, subscription unsubscribe tokens

Revision ID: 7b2e9c4d1a55
Revises: 4a7c1e2b9d10
Create Date: 2026-10-17 16:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "7b2e9c4d1a55"
down_revision: Union[str, None] = "4a7c1e2b9d10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone_number", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("notify_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("geofence_subscriptions", sa.Column("unsubscribe_token", sa.String(length=64), nullable=True))
    # Backfill existing rows with unguessable tokens before enforcing NOT NULL + UNIQUE.
    op.execute(
        "UPDATE geofence_subscriptions SET unsubscribe_token = md5(random()::text || id::text) || md5(clock_timestamp()::text) "
        "WHERE unsubscribe_token IS NULL"
    )
    op.alter_column("geofence_subscriptions", "unsubscribe_token", nullable=False)
    op.create_index(
        op.f("ix_geofence_subscriptions_unsubscribe_token"), "geofence_subscriptions", ["unsubscribe_token"], unique=True
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_geofence_subscriptions_unsubscribe_token"), table_name="geofence_subscriptions")
    op.drop_column("geofence_subscriptions", "unsubscribe_token")
    op.drop_column("users", "notify_enabled")
    op.drop_column("users", "phone_number")
