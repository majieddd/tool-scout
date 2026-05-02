"""Slim usage tracker for the local-Gemma backend.

Spec docs/01_SPEC.md §9 had hard caps (40/5h, 120/24h) for the Claude CLI
subscription. With local LLM there are no API limits — we keep the usage_log
table for diagnostics (latency, throughput, model mix) but drop the gate.

`can_call()` is preserved as a no-op stub so existing code paths keep working.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta

from tool_scout.db import SessionLocal
from tool_scout.models import UsageLog


def can_call(_purpose: str) -> tuple[bool, str]:
    """Always True for local LLM. Kept as a stub for spec-code compatibility."""
    return True, "ok (local-llm; no rate limit)"


def record(
    purpose: str,
    duration_s: float,
    in_chars: int,
    out_chars: int,
    *,
    success: bool = True,
    model: str | None = None,
) -> None:
    """Persist one LLM call to usage_log."""
    with SessionLocal() as s:
        s.add(
            UsageLog(
                purpose=purpose,
                duration_s=duration_s,
                input_chars=in_chars,
                output_chars=out_chars,
                success=int(success),
                model=model or os.environ.get("LLM_MODEL"),
            )
        )
        s.commit()


def stats(window_hours: int = 24) -> dict:
    """Summary of recent usage — used by `scout usage`."""
    cutoff = datetime.utcnow() - timedelta(hours=window_hours)
    with SessionLocal() as s:
        rows = s.query(UsageLog).filter(UsageLog.called_at > cutoff).all()
    total = len(rows)
    by_purpose: dict[str, int] = {}
    by_model: dict[str, int] = {}
    total_dur = 0.0
    fails = 0
    for r in rows:
        by_purpose[r.purpose] = by_purpose.get(r.purpose, 0) + 1
        if r.model:
            by_model[r.model] = by_model.get(r.model, 0) + 1
        total_dur += r.duration_s or 0
        if not r.success:
            fails += 1
    return {
        "window_hours": window_hours,
        "total_calls": total,
        "total_duration_s": round(total_dur, 2),
        "avg_duration_s": round(total_dur / total, 2) if total else 0,
        "by_purpose": by_purpose,
        "by_model": by_model,
        "failures": fails,
    }
