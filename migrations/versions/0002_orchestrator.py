"""orchestrator additions per docs/02_SPEC_v1.1_SYMPHONY.md §4

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-02

Plus a Gemma-pivot column on usage_log (model name) so we can analyze
per-model latency once we add LLM_FALLBACK_MODEL.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Per-job lifecycle events (single source of truth for the dashboard).
    op.create_table(
        "orchestrator_events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "job_id",
            sa.String,
            sa.ForeignKey("wrapper_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("occurred_at", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column("state", sa.String, nullable=False),
        sa.Column("turn_number", sa.Integer),
        sa.Column("duration_ms", sa.Integer),
        sa.Column("payload_json", sa.Text),
    )
    op.create_index("idx_orch_events_job", "orchestrator_events", ["job_id"])
    op.create_index("idx_orch_events_state", "orchestrator_events", ["state"])
    op.create_index("idx_orch_events_time", "orchestrator_events", ["occurred_at"])

    # Additive columns on wrapper_requests for FSM bookkeeping.
    with op.batch_alter_table("wrapper_requests") as batch:
        batch.add_column(sa.Column("attempts", sa.Integer, server_default="0"))
        batch.add_column(sa.Column("claimed_at", sa.DateTime))
        batch.add_column(sa.Column("claimed_by", sa.String))
        batch.add_column(sa.Column("workspace_path", sa.String))
        batch.add_column(sa.Column("last_event_at", sa.DateTime))
        batch.add_column(sa.Column("terminal_reason", sa.String))
    # Note: spec also mentions a `priority` column added here. We already
    # created it in 0001 (per the v1.0 wrapper_requests definition), so we
    # do NOT re-add it.

    # Gemma-pivot extension: track which model served each call.
    with op.batch_alter_table("usage_log") as batch:
        batch.add_column(sa.Column("model", sa.String))


def downgrade() -> None:
    with op.batch_alter_table("usage_log") as batch:
        batch.drop_column("model")
    with op.batch_alter_table("wrapper_requests") as batch:
        for col in ("terminal_reason", "last_event_at", "workspace_path", "claimed_by", "claimed_at", "attempts"):
            batch.drop_column(col)
    op.drop_index("idx_orch_events_time", table_name="orchestrator_events")
    op.drop_index("idx_orch_events_state", table_name="orchestrator_events")
    op.drop_index("idx_orch_events_job", table_name="orchestrator_events")
    op.drop_table("orchestrator_events")
