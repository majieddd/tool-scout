"""LocalTracker — adapts the wrapper_requests SQLite table to the orchestrator's
expected interface (docs/02_SPEC_v1.1_SYMPHONY.md §7).
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update

from tool_scout.db import SessionLocal
from tool_scout.models import Tool, WrapperRequest

log = logging.getLogger("queue")


@dataclass
class Candidate:
    id: str
    tool_id: str | None
    requester_ip: str
    priority: int
    requested_at: datetime
    attempts: int
    tool: Any  # Tool ORM row, or stub-like dict for tests


class LocalTracker:
    def fetch_candidates(self, *, states: list[str], limit: int = 10) -> list[Candidate]:
        out: list[Candidate] = []
        with SessionLocal() as s:
            rows = (
                s.query(WrapperRequest)
                .filter(WrapperRequest.status.in_(states))
                .order_by(WrapperRequest.priority.asc(), WrapperRequest.requested_at.asc())
                .limit(limit)
                .all()
            )
            for r in rows:
                tool = s.get(Tool, r.tool_id) if r.tool_id else None
                out.append(Candidate(
                    id=r.id,
                    tool_id=r.tool_id,
                    requester_ip=r.requester_ip,
                    priority=int(r.priority or 0),
                    requested_at=r.requested_at or datetime.utcnow(),
                    attempts=int(r.attempts or 0),
                    tool=tool,
                ))
        return out

    def claim(self, job_id: str, *, claimed_by: str) -> bool:
        with SessionLocal() as s:
            r = s.get(WrapperRequest, job_id)
            if r is None or r.status not in ("pending",):
                return False
            r.status = "running"
            r.claimed_at = datetime.utcnow()
            r.claimed_by = claimed_by
            r.attempts = (r.attempts or 0) + 1
            r.started_at = r.started_at or datetime.utcnow()
            r.last_event_at = datetime.utcnow()
            s.commit()
        return True

    def mark_terminal(
        self,
        job_id: str,
        reason: str,
        *,
        result_url: str | None = None,
        error: str | None = None,
    ) -> None:
        terminal_status = "succeeded" if reason == "succeeded" else (
            "canceled" if reason == "canceled" else "failed"
        )
        with SessionLocal() as s:
            r = s.get(WrapperRequest, job_id)
            if r is None:
                return
            r.status = terminal_status
            r.terminal_reason = reason
            r.finished_at = datetime.utcnow()
            r.last_event_at = datetime.utcnow()
            if result_url:
                r.result_url = result_url
            if error:
                r.error = error
            s.commit()

    def release_for_retry(self, job_id: str) -> None:
        with SessionLocal() as s:
            r = s.get(WrapperRequest, job_id)
            if r is None:
                return
            r.status = "pending"
            r.claimed_at = None
            r.claimed_by = None
            r.last_event_at = datetime.utcnow()
            s.commit()

    def is_canceled(self, job_id: str) -> bool:
        with SessionLocal() as s:
            r = s.get(WrapperRequest, job_id)
            return r is not None and r.status == "canceled"

    def fetch_stuck_running(self) -> list[Candidate]:
        """Jobs left in 'running' from a previous service crash."""
        with SessionLocal() as s:
            rows = s.query(WrapperRequest).filter(WrapperRequest.status == "running").all()
            return [
                Candidate(
                    id=r.id, tool_id=r.tool_id, requester_ip=r.requester_ip,
                    priority=int(r.priority or 0), requested_at=r.requested_at or datetime.utcnow(),
                    attempts=int(r.attempts or 0), tool=None,
                )
                for r in rows
            ]

    def get_attempts(self, job_id: str) -> int:
        with SessionLocal() as s:
            r = s.get(WrapperRequest, job_id)
            return int((r.attempts if r else 0) or 0)
