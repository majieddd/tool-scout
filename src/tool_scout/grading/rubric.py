"""Grading rubric — five axes (R/Q/N/I/F), total 0-25, letter S/A/B/C/D/F.

Per docs/01_SPEC.md §17-19 and config/grading_rubric.yaml.
Profile is loaded from config/profile.yaml.

Recomputed every crawl after classification — so profile or rubric edits
propagate without re-crawling.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import yaml

from tool_scout.db import SessionLocal
from tool_scout.models import Grade, Tool

log = logging.getLogger("scout")

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_RUBRIC_PATH = REPO_ROOT / "config" / "grading_rubric.yaml"
DEFAULT_PROFILE_PATH = REPO_ROOT / "config" / "profile.yaml"


@dataclass
class GradeResult:
    relevance: float
    quality: float
    novelty: float
    install_ease: float
    fit: float
    total: float
    letter: str
    color_hex: str
    notes: str | None = None


def load_yaml(path: str | Path) -> dict:
    return yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _tags(tool: Tool) -> set[str]:
    return {t.tag.lower() for t in (tool.tags or [])}


def compute_relevance(tool: Tool, profile: dict, rubric: dict) -> float:
    """Sum profile interest weights for matching tags, scaled to 0-5."""
    interests: dict[str, float] = {k.lower(): float(v) for k, v in (profile.get("interests") or {}).items()}
    tags = _tags(tool)
    raw = sum(interests.get(t, 0) for t in tags)
    # Project boost: if any tag matches a current project's boost_tags, add weight
    for proj in profile.get("current_projects") or []:
        boost_tags = {t.lower() for t in (proj.get("boost_tags") or [])}
        if tags & boost_tags:
            raw += float(proj.get("weight") or 0)
    rconf = rubric.get("axes", {}).get("relevance", {})
    max_raw = float(rconf.get("max_raw_score", 30))
    scale_to = float(rconf.get("scale_to", 5))
    return _clamp((raw / max_raw) * scale_to, 0, scale_to)


def compute_quality(tool: Tool, rubric: dict) -> float:
    """Weighted quality signals — stars, downloads, recency, readme depth, license."""
    weights = rubric.get("axes", {}).get("quality", {}).get("weights", {})
    score = 0.0
    # log10(stars+1) normalized to ~1 at 10k stars
    log_stars = math.log10((tool.stars or 0) + 1) / math.log10(10001)
    score += weights.get("log_stars", 0.30) * _clamp(log_stars, 0, 1) * 5

    log_downloads = math.log10((tool.downloads or 0) + 1) / math.log10(1_000_001)
    score += weights.get("log_downloads", 0.15) * _clamp(log_downloads, 0, 1) * 5

    # Recency — 1.0 if last commit within 30 days, decays linearly to 0 at 365
    recency_score = 0.0
    if tool.last_updated:
        delta = (datetime.utcnow() - tool.last_updated).days
        if delta <= 30:
            recency_score = 1.0
        elif delta <= 365:
            recency_score = max(0, 1 - (delta - 30) / 335)
    score += weights.get("recency", 0.25) * recency_score * 5

    # Readme depth — proxy via length of readme_excerpt
    readme_len = len(tool.readme_excerpt or "")
    readme_score = _clamp(readme_len / 1500, 0, 1)
    score += weights.get("readme_depth", 0.15) * readme_score * 5

    # has_tests — proxy: tags include 'tests' or 'pytest'
    tags = _tags(tool)
    has_tests = bool(tags & {"tests", "test", "pytest", "jest"})
    score += weights.get("has_tests", 0.10) * (1 if has_tests else 0) * 5

    # has_license
    score += weights.get("has_license", 0.05) * (1 if tool.license else 0) * 5

    return _clamp(score, 0, 5)


def compute_novelty(tool: Tool, rubric: dict) -> float:
    """Days since most-recent of first_seen / last_updated → band score."""
    bands = rubric.get("axes", {}).get("novelty") or []
    candidates = []
    if tool.first_seen:
        candidates.append((datetime.utcnow() - tool.first_seen).days)
    if tool.last_updated:
        candidates.append((datetime.utcnow() - tool.last_updated).days)
    if not candidates:
        return 0.0
    age = min(candidates)
    for band in bands:
        max_days = band.get("max_days")
        if max_days is None or age <= max_days:
            return float(band.get("score", 0))
    return 0.0


def compute_install_ease(tool: Tool, rubric: dict) -> float:
    """Map compatibility string to score. Unknown → 0."""
    table = rubric.get("axes", {}).get("install_ease") or {}
    return float(table.get(tool.compatibility or "", 0))


def compute_fit(tool: Tool, rubric: dict) -> float:
    """Windows-native + language match + workflow bonuses (and OS-lock penalties)."""
    fit_cfg = rubric.get("axes", {}).get("fit") or {}
    score = 2.5  # midpoint baseline
    tags = _tags(tool)
    desc = ((tool.description or "") + " " + (tool.readme_excerpt or "")).lower()
    lang = (tool.language or "").lower()

    if "windows" in tags or "windows" in desc or "cross-platform" in tags:
        score += float(fit_cfg.get("windows_native_bonus", 1.0))
    if lang in ("python", "typescript"):
        score += float(fit_cfg.get("primary_language_match", 1.5))
    if "cli" in tags or "terminal" in tags or " cli " in desc:
        score += float(fit_cfg.get("cli_workflow_bonus", 0.5))
    if tags & {"three-js", "threejs", "electron", "blockbench", "voxel", "game-dev", "hytale"}:
        score += float(fit_cfg.get("game_dev_stack_bonus", 1.0))
    if "macos-only" in tags or "macos only" in desc:
        score += float(fit_cfg.get("macos_only_penalty", -5.0))
    if "ios-only" in tags or "ios only" in desc:
        score += float(fit_cfg.get("ios_only_penalty", -5.0))
    return _clamp(score, 0, 5)


def total_to_letter(total: float, rubric: dict) -> tuple[str, str]:
    bands = rubric.get("letter_bands") or []
    for band in bands:
        if total >= band.get("min", 0):
            return band.get("letter", "F"), band.get("color", "#6B7280")
    return "F", "#6B7280"


def compute_grade(tool: Tool, profile: dict, rubric: dict) -> GradeResult:
    r = compute_relevance(tool, profile, rubric)
    q = compute_quality(tool, rubric)
    n = compute_novelty(tool, rubric)
    i = compute_install_ease(tool, rubric)
    f = compute_fit(tool, rubric)
    total = r + q + n + i + f
    letter, color = total_to_letter(total, rubric)
    return GradeResult(
        relevance=round(r, 3),
        quality=round(q, 3),
        novelty=round(n, 3),
        install_ease=round(i, 3),
        fit=round(f, 3),
        total=round(total, 3),
        letter=letter,
        color_hex=color,
    )


def grade_all(
    *,
    profile_path: str | Path = DEFAULT_PROFILE_PATH,
    rubric_path: str | Path = DEFAULT_RUBRIC_PATH,
) -> dict:
    """Recompute grades for every tool in the DB. Returns summary dict."""
    profile = load_yaml(profile_path)
    rubric = load_yaml(rubric_path)

    counts: dict[str, int] = {}
    total_done = 0
    with SessionLocal() as s:
        tools = s.query(Tool).all()
        for t in tools:
            g = compute_grade(t, profile, rubric)
            existing = s.get(Grade, t.id)
            if existing is None:
                s.add(Grade(
                    tool_id=t.id,
                    relevance=g.relevance,
                    quality=g.quality,
                    novelty=g.novelty,
                    install_ease=g.install_ease,
                    fit=g.fit,
                    total=g.total,
                    letter=g.letter,
                    color_hex=g.color_hex,
                ))
            else:
                existing.relevance = g.relevance
                existing.quality = g.quality
                existing.novelty = g.novelty
                existing.install_ease = g.install_ease
                existing.fit = g.fit
                existing.total = g.total
                existing.letter = g.letter
                existing.color_hex = g.color_hex
                existing.computed_at = datetime.utcnow()
            counts[g.letter] = counts.get(g.letter, 0) + 1
            total_done += 1
        s.commit()
    summary = {"total": total_done, "by_letter": counts}
    log.info("grade_all: %s", summary)
    return summary
