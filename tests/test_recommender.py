"""Recommender unit tests — mocked DB."""
from __future__ import annotations

from unittest.mock import MagicMock

from tool_scout.recommender.profile import Profile, Project
from tool_scout.recommender.scorer import _normalize_relevance, _score_one


def _profile() -> Profile:
    return Profile(
        interests={"mcp": 3, "claude-code": 3, "python": 3, "windows": 3, "macos-only": -3},
        projects=[
            Project(name="HYDRA", boost_tags={"mcp", "local-llm"}, weight=3.0),
            Project(name="Hytale", boost_tags={"hytale", "blockbench"}, weight=2.0),
        ],
        excludes={"crypto-trading", "nft"},
    )


def test_profile_loads_real_yaml():
    """Sanity: actual config/profile.yaml parses + matches our shape."""
    p = Profile.load()
    assert "mcp" in p.interests
    assert any(proj.name == "HYDRA" for proj in p.projects)


def test_profile_excluded():
    p = _profile()
    assert p.matches_excluded({"crypto-trading"})
    assert not p.matches_excluded({"python"})


def test_profile_project_boost():
    p = _profile()
    assert p.project_boost({"mcp"}) == 3.0
    assert p.project_boost({"hytale", "windows"}) == 2.0
    assert p.project_boost({"unknown-tag"}) == 0.0


def test_normalize_relevance_clamps():
    p = _profile()
    # Sum hits cap at 9 (3+3+3) for these tags; 9/10 = 0.9
    assert _normalize_relevance(p, {"mcp", "claude-code", "python"}, 1.0) == 0.9
    # Heavy positive sum should clamp to 1.0
    big = _normalize_relevance(p, {"mcp", "claude-code", "python", "windows"}, 1.0)
    assert big == 1.0
    # Negative tag should drop score
    assert _normalize_relevance(p, {"macos-only"}, 1.0) == -0.3


def test_score_one_high_for_relevant_tool():
    """A tool with relevant tags + high quality should outscore a low-quality one."""
    p = _profile()
    # Build a Tool-like object
    grade = MagicMock(quality=4.5, novelty=4)
    high = MagicMock(grade=grade, tags=[MagicMock(tag="mcp"), MagicMock(tag="python")])
    low = MagicMock(grade=MagicMock(quality=1, novelty=1), tags=[MagicMock(tag="random-thing")])
    s_high, _ = _score_one(high, p, 1.0)
    s_low, _ = _score_one(low, p, 1.0)
    assert s_high > s_low


def test_score_one_no_grade_returns_negative():
    p = _profile()
    t = MagicMock(grade=None, tags=[])
    s, reason = _score_one(t, p, 1.0)
    assert s < 0
    assert "no grade" in reason
