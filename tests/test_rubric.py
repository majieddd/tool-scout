"""Per-axis grading rubric tests."""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import MagicMock

from tool_scout.grading.rubric import (
    compute_fit,
    compute_grade,
    compute_install_ease,
    compute_novelty,
    compute_quality,
    compute_relevance,
    load_yaml,
    total_to_letter,
)


def _tool(**kw) -> MagicMock:
    """Mock Tool with the fields the rubric reads."""
    t = MagicMock()
    t.stars = kw.get("stars", 0)
    t.downloads = kw.get("downloads", 0)
    t.last_updated = kw.get("last_updated")
    t.first_seen = kw.get("first_seen", datetime.utcnow())
    t.readme_excerpt = kw.get("readme_excerpt", "")
    t.description = kw.get("description", "")
    t.license = kw.get("license")
    t.compatibility = kw.get("compatibility")
    t.language = kw.get("language")
    # tags is a list of MagicMocks each with a .tag attr (lowercase)
    t.tags = [MagicMock(tag=tag) for tag in (kw.get("tags") or [])]
    return t


PROFILE = {
    "interests": {"mcp": 3, "claude-code": 3, "python": 3, "windows": 3, "macos-only": -3},
    "current_projects": [{"name": "HYDRA", "boost_tags": ["mcp", "local-llm"], "weight": 3}],
}

RUBRIC = {
    "axes": {
        "relevance": {"max_raw_score": 30, "scale_to": 5},
        "quality": {
            "weights": {"log_stars": 0.30, "log_downloads": 0.15, "recency": 0.25, "readme_depth": 0.15, "has_tests": 0.10, "has_license": 0.05},
        },
        "novelty": [
            {"max_days": 3, "score": 5},
            {"max_days": 14, "score": 4},
            {"max_days": 30, "score": 3},
            {"max_days": 90, "score": 2},
            {"max_days": 180, "score": 1},
            {"max_days": None, "score": 0},
        ],
        "install_ease": {"native_claude_code": 5, "mcp_ready": 4.5, "needs_wrapper": 2.5, "incompatible": 0},
        "fit": {
            "windows_native_bonus": 1.0,
            "primary_language_match": 1.5,
            "cli_workflow_bonus": 0.5,
            "game_dev_stack_bonus": 1.0,
            "macos_only_penalty": -5.0,
            "ios_only_penalty": -5.0,
        },
    },
    "letter_bands": [
        {"min": 22, "letter": "S", "color": "#8B5CF6"},
        {"min": 18, "letter": "A", "color": "#10B981"},
        {"min": 14, "letter": "B", "color": "#3B82F6"},
        {"min": 10, "letter": "C", "color": "#F59E0B"},
        {"min": 6, "letter": "D", "color": "#F97316"},
        {"min": 0, "letter": "F", "color": "#6B7280"},
    ],
}


def test_relevance_sums_profile_weights():
    t = _tool(tags=["mcp", "claude-code", "python"])
    r = compute_relevance(t, PROFILE, RUBRIC)
    # Tags = mcp(3) + claude-code(3) + python(3) = 9 raw. + project boost (mcp matches HYDRA boost) = 12.
    # 12/30 * 5 = 2.0
    assert 1.5 < r < 2.5


def test_relevance_with_negative_interests():
    t = _tool(tags=["macos-only", "python"])
    r = compute_relevance(t, PROFILE, RUBRIC)
    # macos-only(-3) + python(3) = 0 raw → relevance = 0
    assert r == 0.0


def test_relevance_no_tags_is_zero():
    t = _tool()
    assert compute_relevance(t, PROFILE, RUBRIC) == 0


def test_quality_high_stars_high_score():
    t = _tool(stars=20000, last_updated=datetime.utcnow() - timedelta(days=5), readme_excerpt="x" * 1500, license="MIT")
    q = compute_quality(t, RUBRIC)
    assert q > 2  # log_stars + recency + readme_depth + license should accumulate


def test_quality_unknown_returns_low():
    t = _tool()
    assert compute_quality(t, RUBRIC) < 1


def test_novelty_recent():
    t = _tool(last_updated=datetime.utcnow() - timedelta(days=1))
    assert compute_novelty(t, RUBRIC) == 5


def test_novelty_old():
    # Rubric picks the more-recent of (first_seen, last_updated) — to test
    # "old", BOTH need to be old, otherwise a freshly-crawled record always
    # scores 5 regardless of upstream activity.
    old = datetime.utcnow() - timedelta(days=400)
    t = _tool(first_seen=old, last_updated=old)
    assert compute_novelty(t, RUBRIC) == 0


def test_install_ease_native_claude_code():
    assert compute_install_ease(_tool(compatibility="native_claude_code"), RUBRIC) == 5


def test_install_ease_unknown_zero():
    assert compute_install_ease(_tool(compatibility=None), RUBRIC) == 0


def test_fit_windows_python_cli_high():
    t = _tool(language="Python", tags=["windows", "cli"])
    assert compute_fit(t, RUBRIC) >= 4   # baseline 2.5 + windows + python + cli


def test_fit_macos_only_floor():
    t = _tool(language="Swift", tags=["macos-only"])
    assert compute_fit(t, RUBRIC) == 0   # penalty drives below 0, clamped


def test_total_to_letter():
    assert total_to_letter(24, RUBRIC) == ("S", "#8B5CF6")
    assert total_to_letter(20, RUBRIC) == ("A", "#10B981")
    assert total_to_letter(15, RUBRIC) == ("B", "#3B82F6")
    assert total_to_letter(11, RUBRIC) == ("C", "#F59E0B")
    assert total_to_letter(7, RUBRIC) == ("D", "#F97316")
    assert total_to_letter(2, RUBRIC) == ("F", "#6B7280")


def test_compute_grade_end_to_end_s_tier():
    t = _tool(
        stars=15000,
        last_updated=datetime.utcnow() - timedelta(days=2),
        readme_excerpt="x" * 1800,
        license="MIT",
        compatibility="mcp_ready",
        language="Python",
        tags=["mcp", "claude-code", "python", "windows", "cli"],
    )
    g = compute_grade(t, PROFILE, RUBRIC)
    assert g.letter in ("S", "A", "B")  # high-quality tool should grade well
    assert g.relevance > 1
    assert g.quality > 1
    assert g.novelty == 5
    assert g.install_ease == 4.5


def test_compute_grade_low_for_macos_only_swift_thing():
    t = _tool(
        stars=10,
        last_updated=datetime.utcnow() - timedelta(days=400),
        readme_excerpt="",
        license=None,
        compatibility="incompatible",
        language="Swift",
        tags=["macos-only"],
    )
    g = compute_grade(t, PROFILE, RUBRIC)
    assert g.letter in ("D", "F")


def test_load_yaml_real_files():
    """Sanity: the actual config files load without error."""
    from pathlib import Path
    repo_root = Path(__file__).parent.parent
    rubric = load_yaml(repo_root / "config" / "grading_rubric.yaml")
    profile = load_yaml(repo_root / "config" / "profile.yaml")
    assert "letter_bands" in rubric
    assert "interests" in profile
