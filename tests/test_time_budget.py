"""TimeBudget unit tests."""
from __future__ import annotations

import time

from tool_scout.util.time_budget import TimeBudget


def test_factories():
    full = TimeBudget.full()
    quick = TimeBudget.quick()
    assert full.total_minutes == 60
    assert full.hard_kill_minutes == 75
    assert quick.total_minutes == 10
    assert quick.hard_kill_minutes == 15


def test_allocate_consume_remaining():
    b = TimeBudget(total_minutes=60, hard_kill_minutes=75)
    b.allocate("github", 4)  # 4 min = 240s
    b.consume("github", 100)
    assert b.remaining_for_source("github") == 140
    assert not b.source_exhausted("github")
    b.consume("github", 200)
    assert b.source_exhausted("github")


def test_expired_after_hard_kill(monkeypatch):
    b = TimeBudget(total_minutes=1, hard_kill_minutes=1)
    fake_now = [1000.0]

    def fake_monotonic():
        return fake_now[0]

    monkeypatch.setattr("time.monotonic", fake_monotonic)
    b.start()
    fake_now[0] += 30
    assert not b.expired()
    fake_now[0] += 35  # 65s elapsed; hard_kill is 60s
    assert b.expired()


def test_soft_vs_hard():
    b = TimeBudget(total_minutes=1, hard_kill_minutes=2)
    fake_now = [1000.0]

    import unittest.mock as m

    with m.patch("time.monotonic", side_effect=lambda: fake_now[0]):
        b.start()
        fake_now[0] += 70  # 70s elapsed
        assert b.soft_expired()
        assert not b.expired()
        fake_now[0] += 60  # 130s elapsed
        assert b.expired()
