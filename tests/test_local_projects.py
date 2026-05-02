"""Local-projects crawler tests — temp filesystem with synthetic indicators."""
from __future__ import annotations

import json
from pathlib import Path

from tool_scout.crawler.local_projects import crawl_local_projects
from tool_scout.util.time_budget import TimeBudget


def _make_skill(root: Path, slug: str, *, name: str, description: str) -> Path:
    d = root / "skills" / slug
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\nbody\n",
        encoding="utf-8",
    )
    return d


def _make_plugin(root: Path, slug: str, *, name: str, description: str) -> Path:
    d = root / "plugins" / slug
    d.mkdir(parents=True)
    (d / "plugin.json").write_text(
        json.dumps({"name": name, "description": description}), encoding="utf-8"
    )
    return d


def test_crawl_local_projects_finds_skills_and_plugins(tmp_path: Path):
    _make_skill(tmp_path, "alpha", name="alpha-skill", description="does alpha")
    _make_skill(tmp_path, "beta", name="beta-skill", description="does beta")
    _make_plugin(tmp_path, "gamma", name="gamma-plugin", description="does gamma")

    cfg = {
        "enabled": True,
        "roots": [str(tmp_path)],
        "indicators": ["SKILL.md", "plugin.json", "mcp.json"],
        "max_depth": 4,
        "budget_min": 1,
    }
    budget = TimeBudget.quick()
    budget.start()
    recs = crawl_local_projects(cfg, budget)
    by_name = {r.name: r for r in recs}
    assert "alpha-skill" in by_name
    assert "beta-skill" in by_name
    assert "gamma-plugin" in by_name
    skill = by_name["alpha-skill"]
    assert skill.source == "local-personal"
    assert skill.compatibility == "native_claude_code"
    plugin = by_name["gamma-plugin"]
    assert plugin.compatibility == "native_claude_code"


def test_crawl_local_projects_disabled():
    cfg = {"enabled": False, "roots": []}
    assert crawl_local_projects(cfg, TimeBudget.quick()) == []


def test_crawl_local_projects_missing_root_skips(tmp_path: Path):
    cfg = {
        "enabled": True,
        "roots": [str(tmp_path / "does-not-exist")],
        "indicators": ["SKILL.md"],
        "max_depth": 4,
        "budget_min": 1,
    }
    budget = TimeBudget.quick()
    budget.start()
    assert crawl_local_projects(cfg, budget) == []
