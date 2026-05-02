"""Crawl health guardrail (docs/01_SPEC.md §53).

Before vercel_export publishes public data, we verify the latest crawl wasn't
a degenerate run (e.g., GitHub API outage produced 3 tools instead of the
usual 500). If it was, skip publish — local DB still has the data, but we
don't push degraded results live.

Override available via `scout export --force`.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from sqlalchemy import desc

from tool_scout.db import SessionLocal
from tool_scout.models import CrawlRun

log = logging.getLogger("scout")

LOOKBACK_RUNS = 7
MIN_RATIO_OF_AVG = 0.20    # < 20% of recent average = suspicious
ABS_MIN = 20               # ...or < 20 tools, period
MAX_ERRORS = 3


@dataclass
class GuardrailResult:
    passed: bool
    reason: str
    last_run_new: int
    avg_new_7d: float
    last_run_errors: int


def passes_guardrail(force: bool = False) -> GuardrailResult:
    """Check the latest crawl_runs row against the rolling 7-run average.

    Returns a GuardrailResult; .passed=False means refuse to publish unless
    force=True is passed by the caller.
    """
    with SessionLocal() as s:
        last = s.query(CrawlRun).order_by(desc(CrawlRun.id)).first()
        prior = (
            s.query(CrawlRun)
            .order_by(desc(CrawlRun.id))
            .offset(1)
            .limit(LOOKBACK_RUNS)
            .all()
        )
    if last is None:
        return GuardrailResult(passed=False, reason="no crawl_runs yet", last_run_new=0, avg_new_7d=0, last_run_errors=0)

    new = int(last.new_tools or 0)
    errors_list = []
    if last.errors:
        try:
            errors_list = json.loads(last.errors) or []
        except Exception:  # noqa: BLE001
            errors_list = [last.errors]
    err_count = len(errors_list)

    avg = sum(int(r.new_tools or 0) for r in prior) / max(len(prior), 1)

    if force:
        return GuardrailResult(passed=True, reason="forced", last_run_new=new, avg_new_7d=avg, last_run_errors=err_count)

    if new < max(avg * MIN_RATIO_OF_AVG, ABS_MIN):
        return GuardrailResult(
            passed=False,
            reason=f"new_tools={new} below threshold (max(avg*{MIN_RATIO_OF_AVG},{ABS_MIN})={max(avg*MIN_RATIO_OF_AVG, ABS_MIN):.0f}, 7-run avg={avg:.0f})",
            last_run_new=new, avg_new_7d=avg, last_run_errors=err_count,
        )
    if err_count > MAX_ERRORS:
        return GuardrailResult(
            passed=False,
            reason=f"{err_count} errors > {MAX_ERRORS} threshold",
            last_run_new=new, avg_new_7d=avg, last_run_errors=err_count,
        )
    return GuardrailResult(passed=True, reason="ok", last_run_new=new, avg_new_7d=avg, last_run_errors=err_count)
