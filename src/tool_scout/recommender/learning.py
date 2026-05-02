"""Recommender learning loop (spec §22) — biases scoring based on install
history. Activates after 10 logged installs.

After 10+ installs in the last 90 days:
  - tags appearing often in installs → multiplier > 1
  - tags appearing often in muted/excluded → multiplier < 1
  - tags consistently shown but never installed → small downward bias

Returns a multiplier in [0.7, 1.3] applied per-tool to the relevance term.
"""
from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timedelta

from tool_scout.db import SessionLocal
from tool_scout.models import Install, Tag, Tool, UserOverride

log = logging.getLogger("scout")


def _tag_counter_from_installs(days: int) -> Counter:
    cutoff = datetime.utcnow() - timedelta(days=days)
    counter: Counter[str] = Counter()
    with SessionLocal() as s:
        for inst in s.query(Install).filter(Install.installed_at > cutoff).all():
            if not inst.tool_id:
                continue
            tags = s.query(Tag.tag).filter(Tag.tool_id == inst.tool_id).all()
            for (t,) in tags:
                counter[t.lower()] += 1
    return counter


def _tag_counter_from_overrides(state: str, days: int) -> Counter:
    cutoff = datetime.utcnow() - timedelta(days=days)
    counter: Counter[str] = Counter()
    with SessionLocal() as s:
        for ov in s.query(UserOverride).filter(
            UserOverride.state == state, UserOverride.updated_at > cutoff
        ).all():
            tags = s.query(Tag.tag).filter(Tag.tool_id == ov.tool_id).all()
            for (t,) in tags:
                counter[t.lower()] += 1
    return counter


def install_count(days: int = 90) -> int:
    cutoff = datetime.utcnow() - timedelta(days=days)
    with SessionLocal() as s:
        return s.query(Install).filter(Install.installed_at > cutoff).count()


def compute_learning_factor(tool_tags: set[str]) -> float:
    """Returns multiplier in [0.7, 1.3] based on install/mute history.

    Below 10 logged installs in the last 90 days, returns 1.0 (no learning yet).
    """
    if install_count(90) < 10:
        return 1.0

    installed = _tag_counter_from_installs(90)
    muted = _tag_counter_from_overrides("muted", 90)

    delta = 0.0
    for tag in tool_tags:
        delta += 0.05 * installed.get(tag, 0)
        delta -= 0.10 * muted.get(tag, 0)
    return max(0.7, min(1.3, 1.0 + delta))


def profile_analyze() -> dict:
    """Diagnostic — `scout profile analyze` shows what the learning layer is doing."""
    n_installs = install_count(90)
    if n_installs < 10:
        return {
            "active": False,
            "reason": f"Need >=10 installs in last 90 days (have {n_installs})",
            "installs_90d": n_installs,
        }
    installed = _tag_counter_from_installs(90)
    muted = _tag_counter_from_overrides("muted", 90)
    return {
        "active": True,
        "installs_90d": n_installs,
        "top_installed_tags": installed.most_common(10),
        "top_muted_tags": muted.most_common(10),
    }
