"""SQLAlchemy ORM models matching docs/01_SPEC.md §7 + docs/02_SPEC_v1.1_SYMPHONY.md §4.

Names and types mirror the SQL exactly so Alembic autogenerate would be a no-op
against a freshly-migrated DB.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Float,
    DateTime,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tool_scout.db import Base


class Tool(Base):
    __tablename__ = "tools"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    source: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String)
    subcategory: Mapped[Optional[str]] = mapped_column(String)
    description: Mapped[Optional[str]] = mapped_column(Text)
    readme_excerpt: Mapped[Optional[str]] = mapped_column(Text)
    language: Mapped[Optional[str]] = mapped_column(String)
    stars: Mapped[int] = mapped_column(Integer, default=0)
    downloads: Mapped[int] = mapped_column(Integer, default=0)
    license: Mapped[Optional[str]] = mapped_column(String)
    last_updated: Mapped[Optional[datetime]] = mapped_column(DateTime)
    first_seen: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    last_crawled: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    compatibility: Mapped[Optional[str]] = mapped_column(String)
    install_hint: Mapped[Optional[str]] = mapped_column(Text)
    quality_score: Mapped[float] = mapped_column(Float, default=0.0)
    dead: Mapped[int] = mapped_column(Integer, default=0)
    visibility: Mapped[str] = mapped_column(String, default="public")
    classifier_cache_key: Mapped[Optional[str]] = mapped_column(String)

    grade: Mapped[Optional["Grade"]] = relationship(back_populates="tool", uselist=False, cascade="all, delete-orphan")
    tags: Mapped[list["Tag"]] = relationship(back_populates="tool", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_tools_category", "category"),
        Index("idx_tools_source", "source"),
        Index("idx_tools_last_updated", "last_updated"),
        Index("idx_tools_visibility", "visibility"),
        Index("idx_tools_cache_key", "classifier_cache_key"),
    )


class Tag(Base):
    __tablename__ = "tags"

    tool_id: Mapped[str] = mapped_column(ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True)
    tag: Mapped[str] = mapped_column(String, primary_key=True)
    weight: Mapped[float] = mapped_column(Float, default=1.0)

    tool: Mapped["Tool"] = relationship(back_populates="tags")

    __table_args__ = (Index("idx_tags_tag", "tag"),)


class Grade(Base):
    __tablename__ = "grades"

    tool_id: Mapped[str] = mapped_column(ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True)
    relevance: Mapped[float] = mapped_column(Float, nullable=False)
    quality: Mapped[float] = mapped_column(Float, nullable=False)
    novelty: Mapped[float] = mapped_column(Float, nullable=False)
    install_ease: Mapped[float] = mapped_column(Float, nullable=False)
    fit: Mapped[float] = mapped_column(Float, nullable=False)
    total: Mapped[float] = mapped_column(Float, nullable=False)
    letter: Mapped[str] = mapped_column(String, nullable=False)
    color_hex: Mapped[str] = mapped_column(String, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    notes: Mapped[Optional[str]] = mapped_column(Text)

    tool: Mapped["Tool"] = relationship(back_populates="grade")

    __table_args__ = (
        Index("idx_grades_letter", "letter"),
        Index("idx_grades_total", "total"),
    )


class CrawlRun(Base):
    __tablename__ = "crawl_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    duration_s: Mapped[Optional[int]] = mapped_column(Integer)
    sources: Mapped[Optional[str]] = mapped_column(Text)
    new_tools: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[Optional[str]] = mapped_column(Text)
    guardrail_passed: Mapped[int] = mapped_column(Integer, default=1)


class Recommendation(Base):
    __tablename__ = "recommendations"

    run_id: Mapped[int] = mapped_column(ForeignKey("crawl_runs.id", ondelete="CASCADE"), primary_key=True)
    tool_id: Mapped[str] = mapped_column(ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    reasoning: Mapped[Optional[str]] = mapped_column(Text)


class Install(Base):
    __tablename__ = "installs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tool_id: Mapped[Optional[str]] = mapped_column(ForeignKey("tools.id"))
    installed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    strategy: Mapped[Optional[str]] = mapped_column(String)
    target_path: Mapped[Optional[str]] = mapped_column(String)
    config_diff: Mapped[Optional[str]] = mapped_column(Text)
    success: Mapped[int] = mapped_column(Integer, default=1)
    notes: Mapped[Optional[str]] = mapped_column(Text)


class UserOverride(Base):
    __tablename__ = "user_overrides"

    tool_id: Mapped[str] = mapped_column(ForeignKey("tools.id"), primary_key=True)
    state: Mapped[str] = mapped_column(String, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())

    __table_args__ = (Index("idx_overrides_state", "state"),)


class WrapperRequest(Base):
    __tablename__ = "wrapper_requests"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    tool_id: Mapped[Optional[str]] = mapped_column(ForeignKey("tools.id"))
    requester_ip: Mapped[str] = mapped_column(String, nullable=False)
    requester_hash: Mapped[str] = mapped_column(String, nullable=False)
    recaptcha_score: Mapped[Optional[float]] = mapped_column(Float)
    requested_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    status: Mapped[str] = mapped_column(String, nullable=False)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    result_url: Mapped[Optional[str]] = mapped_column(String)
    error: Mapped[Optional[str]] = mapped_column(Text)
    static_scan_output: Mapped[Optional[str]] = mapped_column(Text)
    sandbox_output: Mapped[Optional[str]] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(Integer, default=0)

    # v1.1 orchestrator additions (added in migration 0002)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    claimed_by: Mapped[Optional[str]] = mapped_column(String)
    workspace_path: Mapped[Optional[str]] = mapped_column(String)
    last_event_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    terminal_reason: Mapped[Optional[str]] = mapped_column(String)

    __table_args__ = (
        Index("idx_wreq_status", "status"),
        Index("idx_wreq_ip", "requester_ip"),
        Index("idx_wreq_tool", "tool_id"),
    )


class RateLimit(Base):
    __tablename__ = "rate_limits"

    ip: Mapped[str] = mapped_column(String, primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)


class UsageLog(Base):
    __tablename__ = "usage_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    called_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    purpose: Mapped[str] = mapped_column(String, nullable=False)
    duration_s: Mapped[Optional[float]] = mapped_column(Float)
    input_chars: Mapped[Optional[int]] = mapped_column(Integer)
    output_chars: Mapped[Optional[int]] = mapped_column(Integer)
    success: Mapped[int] = mapped_column(Integer, default=1)
    model: Mapped[Optional[str]] = mapped_column(String)  # Gemma-pivot extension

    __table_args__ = (Index("idx_usage_time", "called_at"),)


class BackupLog(Base):
    __tablename__ = "backup_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    path: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer)
    integrity_ok: Mapped[int] = mapped_column(Integer, default=1)
    kind: Mapped[Optional[str]] = mapped_column(String)


class OrchestratorEvent(Base):
    """v1.1 §4: per-job lifecycle event log; powers the dashboard."""

    __tablename__ = "orchestrator_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("wrapper_requests.id", ondelete="CASCADE"), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    state: Mapped[str] = mapped_column(String, nullable=False)
    turn_number: Mapped[Optional[int]] = mapped_column(Integer)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer)
    payload_json: Mapped[Optional[str]] = mapped_column(Text)

    __table_args__ = (
        Index("idx_orch_events_job", "job_id"),
        Index("idx_orch_events_state", "state"),
        Index("idx_orch_events_time", "occurred_at"),
    )
