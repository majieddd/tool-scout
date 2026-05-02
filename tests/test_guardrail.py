"""Guardrail tests — temp DB seeded with synthetic crawl_runs."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from tool_scout.operations.guardrail import GuardrailResult, passes_guardrail


def _runs(*pairs):
    """Build mocks that look like CrawlRun rows."""
    out = []
    for new, errors in pairs:
        m = MagicMock()
        m.new_tools = new
        m.errors = json.dumps(errors) if isinstance(errors, list) else errors
        out.append(m)
    return out


def test_guardrail_no_runs_returns_failed():
    with patch("tool_scout.operations.guardrail.SessionLocal") as session_cls:
        s = session_cls.return_value.__enter__.return_value
        q = MagicMock()
        q.order_by.return_value = q
        q.first.return_value = None
        q.offset.return_value = q
        q.limit.return_value = q
        q.all.return_value = []
        s.query.return_value = q
        r = passes_guardrail()
    assert not r.passed
    assert "no crawl_runs" in r.reason


def test_guardrail_pass_when_normal():
    rs = _runs((550, []))
    prior = _runs((500, []), (520, []), (480, []))
    with patch("tool_scout.operations.guardrail.SessionLocal") as session_cls:
        s = session_cls.return_value.__enter__.return_value
        q = MagicMock()
        # last
        q.order_by.return_value.first.return_value = rs[0]
        # prior
        q.order_by.return_value.offset.return_value.limit.return_value.all.return_value = prior
        s.query.return_value = q
        r = passes_guardrail()
    assert r.passed
    assert r.last_run_new == 550


def test_guardrail_blocks_when_new_below_threshold():
    rs = _runs((3, []))   # only 3 new tools
    prior = _runs((500, []), (520, []), (480, []))
    with patch("tool_scout.operations.guardrail.SessionLocal") as session_cls:
        s = session_cls.return_value.__enter__.return_value
        q = MagicMock()
        q.order_by.return_value.first.return_value = rs[0]
        q.order_by.return_value.offset.return_value.limit.return_value.all.return_value = prior
        s.query.return_value = q
        r = passes_guardrail()
    assert not r.passed
    assert "below threshold" in r.reason


def test_guardrail_blocks_when_too_many_errors():
    rs = _runs((550, ["e1", "e2", "e3", "e4", "e5"]))
    prior = _runs((500, []))
    with patch("tool_scout.operations.guardrail.SessionLocal") as session_cls:
        s = session_cls.return_value.__enter__.return_value
        q = MagicMock()
        q.order_by.return_value.first.return_value = rs[0]
        q.order_by.return_value.offset.return_value.limit.return_value.all.return_value = prior
        s.query.return_value = q
        r = passes_guardrail()
    assert not r.passed
    assert "errors" in r.reason


def test_guardrail_force_overrides():
    rs = _runs((1, []))
    prior = _runs((500, []))
    with patch("tool_scout.operations.guardrail.SessionLocal") as session_cls:
        s = session_cls.return_value.__enter__.return_value
        q = MagicMock()
        q.order_by.return_value.first.return_value = rs[0]
        q.order_by.return_value.offset.return_value.limit.return_value.all.return_value = prior
        s.query.return_value = q
        r = passes_guardrail(force=True)
    assert r.passed
    assert r.reason == "forced"
