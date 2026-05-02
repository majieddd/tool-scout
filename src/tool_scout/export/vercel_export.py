"""Vercel export — emits the four JSON files the Next.js app reads.

Outputs (all under web/public/data/):
  - tools.json           list of public tools (filtered per spec §34)
  - recommendations.json today's top picks
  - grades_index.json    {tool_id: {letter, color, total}}
  - meta.json            crawl + run metadata

Visibility filter:
  - tools.visibility = 'public'
  - user_overrides.state NOT IN ('excluded_by_owner', 'muted')
  - tools.dead = 0
  - readme_excerpt truncated to 800 chars
  - install_hint scrubbed for API-key-shaped strings
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import joinedload

from tool_scout.db import SessionLocal
from tool_scout.models import CrawlRun, Grade, Tool, UsageLog, UserOverride
from tool_scout.recommender import recommend
from tool_scout.sheets.schema import LETTER_HEX

log = logging.getLogger("scout")

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "web" / "public" / "data"

API_KEY_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{20,}"),         # generic OpenAI-style
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),        # GitHub PATs
    re.compile(r"gho_[A-Za-z0-9]{20,}"),
    re.compile(r"AIzaSy[A-Za-z0-9_-]{20,}"),    # Google API
    re.compile(r"xox[baprs]-[A-Za-z0-9-]+"),    # Slack
    re.compile(r"[A-Za-z0-9_-]{40}"),            # generic 40-char token (very loose)
]


def _scrub_secrets(s: str) -> str:
    if not s:
        return s
    out = s
    for pat in API_KEY_PATTERNS:
        out = pat.sub("***SCRUBBED***", out)
    return out


def _truncate(s: str | None, n: int) -> str | None:
    if not s:
        return s
    return s if len(s) <= n else s[:n] + "…"


def _excluded_ids() -> set[str]:
    with SessionLocal() as s:
        return {
            r[0] for r in s.query(UserOverride.tool_id).filter(
                UserOverride.state.in_(("excluded_by_owner", "muted"))
            ).all()
        }


def _public_tools_payload() -> list[dict]:
    excluded = _excluded_ids()
    out: list[dict] = []
    with SessionLocal() as s:
        rows = (
            s.query(Tool)
            .options(joinedload(Tool.grade), joinedload(Tool.tags))
            .filter(Tool.visibility == "public", Tool.dead == 0)
            .all()
        )
        for t in rows:
            if t.id in excluded:
                continue
            out.append({
                "id": t.id,
                "name": t.name,
                "url": t.url,
                "source": t.source,
                "category": t.category,
                "subcategory": t.subcategory,
                "description": _truncate(t.description, 500),
                "readme_excerpt": _truncate(t.readme_excerpt, 800),
                "language": t.language,
                "stars": t.stars,
                "license": t.license,
                "last_updated": t.last_updated.isoformat() if t.last_updated else None,
                "first_seen": t.first_seen.isoformat() if t.first_seen else None,
                "compatibility": t.compatibility,
                "install_hint": _scrub_secrets(t.install_hint or ""),
                "tags": sorted({tag.tag for tag in (t.tags or [])})[:8],
                "grade": {
                    "letter": t.grade.letter if t.grade else None,
                    "total": round(t.grade.total, 2) if t.grade else None,
                    "axes": {
                        "R": round(t.grade.relevance, 2) if t.grade else None,
                        "Q": round(t.grade.quality, 2) if t.grade else None,
                        "N": round(t.grade.novelty, 2) if t.grade else None,
                        "I": round(t.grade.install_ease, 2) if t.grade else None,
                        "F": round(t.grade.fit, 2) if t.grade else None,
                    },
                } if t.grade else None,
            })
    return out


def _grades_index_payload(tools: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for t in tools:
        g = t.get("grade") or {}
        if not g:
            continue
        letter = g.get("letter") or "F"
        out[t["id"]] = {
            "letter": letter,
            "color": "#" + LETTER_HEX.get(letter, "6B7280"),
            "total": g.get("total", 0),
        }
    return out


def _recommendations_payload() -> list[dict]:
    return [
        {
            "rank": i + 1,
            "tool_id": p.tool_id,
            "name": p.name,
            "url": p.url,
            "category": p.category,
            "letter": p.letter,
            "score": p.score,
            "reasoning": p.reasoning,
        }
        for i, p in enumerate(recommend(count=50))
    ]


def _meta_payload() -> dict:
    with SessionLocal() as s:
        last_crawl = s.query(CrawlRun).order_by(CrawlRun.id.desc()).first()
        n_tools = s.query(Tool).filter(Tool.visibility == "public", Tool.dead == 0).count()
        last_usage = s.query(UsageLog).order_by(UsageLog.id.desc()).first()
    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "live_tools": n_tools,
        "last_crawl": {
            "started_at": last_crawl.started_at.isoformat() if last_crawl and last_crawl.started_at else None,
            "ended_at": last_crawl.ended_at.isoformat() if last_crawl and last_crawl.ended_at else None,
            "new_tools": last_crawl.new_tools if last_crawl else 0,
            "errors": last_crawl.errors if last_crawl else None,
        },
        "last_llm_call_at": last_usage.called_at.isoformat() if last_usage and last_usage.called_at else None,
    }


def export_to_disk() -> dict:
    """Writes the four JSON files. Returns a summary dict."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tools = _public_tools_payload()
    grades_idx = _grades_index_payload(tools)
    recs = _recommendations_payload()
    meta = _meta_payload()

    paths = {
        "tools.json": tools,
        "recommendations.json": recs,
        "grades_index.json": grades_idx,
        "meta.json": meta,
    }
    written: list[str] = []
    for name, payload in paths.items():
        target = DATA_DIR / name
        target.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        written.append(str(target.relative_to(REPO_ROOT)))
    log.info("export: wrote %d files (%d tools, %d recs)", len(written), len(tools), len(recs))
    return {"files": written, "tools": len(tools), "recommendations": len(recs)}
