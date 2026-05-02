"""initial v1.0 schema (docs/01_SPEC.md §7)

Revision ID: 0001
Revises:
Create Date: 2026-05-02

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tools",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("url", sa.String, nullable=False, unique=True),
        sa.Column("source", sa.String, nullable=False),
        sa.Column("category", sa.String),
        sa.Column("subcategory", sa.String),
        sa.Column("description", sa.Text),
        sa.Column("readme_excerpt", sa.Text),
        sa.Column("language", sa.String),
        sa.Column("stars", sa.Integer, server_default="0"),
        sa.Column("downloads", sa.Integer, server_default="0"),
        sa.Column("license", sa.String),
        sa.Column("last_updated", sa.DateTime),
        sa.Column("first_seen", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column("last_crawled", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column("compatibility", sa.String),
        sa.Column("install_hint", sa.Text),
        sa.Column("quality_score", sa.Float, server_default="0.0"),
        sa.Column("dead", sa.Integer, server_default="0"),
        sa.Column("visibility", sa.String, server_default="public"),
        sa.Column("classifier_cache_key", sa.String),
    )
    op.create_index("idx_tools_category", "tools", ["category"])
    op.create_index("idx_tools_source", "tools", ["source"])
    op.create_index("idx_tools_last_updated", "tools", ["last_updated"])
    op.create_index("idx_tools_visibility", "tools", ["visibility"])
    op.create_index("idx_tools_cache_key", "tools", ["classifier_cache_key"])

    op.create_table(
        "tags",
        sa.Column("tool_id", sa.String, sa.ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag", sa.String, primary_key=True),
        sa.Column("weight", sa.Float, server_default="1.0"),
    )
    op.create_index("idx_tags_tag", "tags", ["tag"])

    op.create_table(
        "grades",
        sa.Column("tool_id", sa.String, sa.ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("relevance", sa.Float, nullable=False),
        sa.Column("quality", sa.Float, nullable=False),
        sa.Column("novelty", sa.Float, nullable=False),
        sa.Column("install_ease", sa.Float, nullable=False),
        sa.Column("fit", sa.Float, nullable=False),
        sa.Column("total", sa.Float, nullable=False),
        sa.Column("letter", sa.String, nullable=False),
        sa.Column("color_hex", sa.String, nullable=False),
        sa.Column("computed_at", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column("notes", sa.Text),
    )
    op.create_index("idx_grades_letter", "grades", ["letter"])
    op.create_index("idx_grades_total", "grades", ["total"])

    op.create_table(
        "crawl_runs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("started_at", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column("ended_at", sa.DateTime),
        sa.Column("duration_s", sa.Integer),
        sa.Column("sources", sa.Text),
        sa.Column("new_tools", sa.Integer, server_default="0"),
        sa.Column("updated", sa.Integer, server_default="0"),
        sa.Column("errors", sa.Text),
        sa.Column("guardrail_passed", sa.Integer, server_default="1"),
    )

    op.create_table(
        "recommendations",
        sa.Column("run_id", sa.Integer, sa.ForeignKey("crawl_runs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tool_id", sa.String, sa.ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("rank", sa.Integer, nullable=False),
        sa.Column("score", sa.Float, nullable=False),
        sa.Column("reasoning", sa.Text),
    )

    op.create_table(
        "installs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tool_id", sa.String, sa.ForeignKey("tools.id")),
        sa.Column("installed_at", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column("strategy", sa.String),
        sa.Column("target_path", sa.String),
        sa.Column("config_diff", sa.Text),
        sa.Column("success", sa.Integer, server_default="1"),
        sa.Column("notes", sa.Text),
    )

    op.create_table(
        "user_overrides",
        sa.Column("tool_id", sa.String, sa.ForeignKey("tools.id"), primary_key=True),
        sa.Column("state", sa.String, nullable=False),
        sa.Column("note", sa.Text),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.current_timestamp()),
    )
    op.create_index("idx_overrides_state", "user_overrides", ["state"])

    op.create_table(
        "wrapper_requests",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("tool_id", sa.String, sa.ForeignKey("tools.id")),
        sa.Column("requester_ip", sa.String, nullable=False),
        sa.Column("requester_hash", sa.String, nullable=False),
        sa.Column("recaptcha_score", sa.Float),
        sa.Column("requested_at", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column("status", sa.String, nullable=False),
        sa.Column("started_at", sa.DateTime),
        sa.Column("finished_at", sa.DateTime),
        sa.Column("result_url", sa.String),
        sa.Column("error", sa.Text),
        sa.Column("static_scan_output", sa.Text),
        sa.Column("sandbox_output", sa.Text),
        sa.Column("priority", sa.Integer, server_default="0"),
    )
    op.create_index("idx_wreq_status", "wrapper_requests", ["status"])
    op.create_index("idx_wreq_ip", "wrapper_requests", ["requester_ip"])
    op.create_index("idx_wreq_tool", "wrapper_requests", ["tool_id"])

    op.create_table(
        "rate_limits",
        sa.Column("ip", sa.String, primary_key=True),
        sa.Column("window_start", sa.DateTime, primary_key=True),
        sa.Column("count", sa.Integer, server_default="0"),
    )

    op.create_table(
        "usage_log",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("called_at", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column("purpose", sa.String, nullable=False),
        sa.Column("duration_s", sa.Float),
        sa.Column("input_chars", sa.Integer),
        sa.Column("output_chars", sa.Integer),
        sa.Column("success", sa.Integer, server_default="1"),
    )
    op.create_index("idx_usage_time", "usage_log", ["called_at"])

    op.create_table(
        "backup_log",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column("path", sa.String, nullable=False),
        sa.Column("size_bytes", sa.Integer),
        sa.Column("integrity_ok", sa.Integer, server_default="1"),
        sa.Column("kind", sa.String),
    )


def downgrade() -> None:
    for tbl in [
        "backup_log",
        "usage_log",
        "rate_limits",
        "wrapper_requests",
        "user_overrides",
        "installs",
        "recommendations",
        "crawl_runs",
        "grades",
        "tags",
        "tools",
    ]:
        op.drop_table(tbl)
