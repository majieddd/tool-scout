"""Recommendation scorer — combines grading signals + profile fit (spec §21).

score = 0.45*relevance + 0.25*quality + 0.15*novelty + 0.15*project_boost

Where relevance is normalized to [-1, 1] from profile interest weights × an
optional learning factor (Phase 5 stub returns 1.0; Phase 5b can extend).

Returns picks (tool_id, score, reasoning) sorted desc by score.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.orm import joinedload

from tool_scout.db import SessionLocal
from tool_scout.models import Grade, Tool, UserOverride
from tool_scout.recommender.profile import Profile

log = logging.getLogger("scout")


@dataclass
class Pick:
    tool_id: str
    name: str
    url: str
    category: str | None
    letter: str
    score: float
    reasoning: str


def _normalize_relevance(profile: Profile, tags: set[str], learning_factor: float) -> float:
    raw = profile.interest_sum(tags)
    # Empirical normalization: a sum of ~10 across matching tags is "very interested",
    # so scale to [-1, 1] via clamp(raw/10).
    return max(-1.0, min(1.0, raw / 10.0)) * learning_factor


def _score_one(tool: Tool, profile: Profile, learning_factor: float) -> tuple[float, str]:
    if tool.grade is None:
        return -999.0, "no grade"
    tags = {t.tag.lower() for t in (tool.tags or [])}
    rel = _normalize_relevance(profile, tags, learning_factor)
    quality = (tool.grade.quality or 0) / 5
    novelty = (tool.grade.novelty or 0) / 5
    project = profile.project_boost(tags)
    score = 0.45 * rel + 0.25 * quality + 0.15 * novelty + 0.15 * (project / 3.0)
    reasons: list[str] = []
    if rel > 0.4:
        reasons.append(f"relevance {rel:.2f}")
    if quality > 0.7:
        reasons.append("high upstream quality")
    if novelty > 0.7:
        reasons.append("recent activity")
    if project > 0:
        boost_projects = [p.name for p in profile.projects if tags & p.boost_tags]
        reasons.append(f"matches {','.join(boost_projects[:2])}")
    return score, "; ".join(reasons) or "general fit"


def recommend(
    *,
    count: int = 15,
    profile: Profile | None = None,
    learning_factor: float = 1.0,
) -> list[Pick]:
    profile = profile or Profile.load()
    with SessionLocal() as s:
        # Fetch all tools with their grade + tags eagerly; filter excluded
        excluded_ids = {
            row[0] for row in s.query(UserOverride.tool_id).filter(
                UserOverride.state.in_(("muted", "excluded_by_owner"))
            ).all()
        }
        tools = (
            s.query(Tool)
            .options(joinedload(Tool.grade), joinedload(Tool.tags))
            .filter(Tool.dead == 0)
            .filter(~Tool.id.in_(excluded_ids) if excluded_ids else True)
            .all()
        )
        scored: list[tuple[Tool, float, str]] = []
        for t in tools:
            tags = {tg.tag.lower() for tg in (t.tags or [])}
            if profile.matches_excluded(tags):
                continue
            sc, reason = _score_one(t, profile, learning_factor)
            scored.append((t, sc, reason))
        scored.sort(key=lambda x: x[1], reverse=True)
        picks: list[Pick] = []
        for t, sc, reason in scored[:count]:
            picks.append(Pick(
                tool_id=t.id,
                name=t.name or "",
                url=t.url,
                category=t.category,
                letter=t.grade.letter if t.grade else "?",
                score=round(sc, 3),
                reasoning=reason,
            ))
    return picks
