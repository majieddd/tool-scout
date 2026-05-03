"""Import the public tools.json back into the local SQLite DB.

Used by the CI daily-crawl workflow so the catalog's gemma-classified
categories survive across CI runs (which start from an empty SQLite).
The local maintainer's machine doesn't need this — it has the persistent
~/.tool-scout/scout.db.

Idempotent: existing rows are updated in-place; newly-discovered tools
in JSON get inserted.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

from tool_scout.db import SessionLocal
from tool_scout.models import Grade, Tag, Tool

log = logging.getLogger("scout")

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PATH = REPO_ROOT / "web" / "public" / "data" / "tools.json"


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def import_from_json(path: str | Path = DEFAULT_PATH) -> dict:
    p = Path(path)
    if not p.exists():
        log.warning("import_json: %s missing — nothing to import", p)
        return {"imported": 0, "skipped": 0}

    body = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(body, list):
        log.error("import_json: expected JSON array, got %s", type(body))
        return {"imported": 0, "skipped": 0}

    inserted = 0
    updated = 0
    with SessionLocal() as s:
        for rec in body:
            if not isinstance(rec, dict):
                continue
            tid = rec.get("id")
            if not tid:
                continue
            existing = s.get(Tool, tid)
            if existing is None:
                s.add(Tool(
                    id=tid,
                    name=(rec.get("name") or "")[:500],
                    url=rec.get("url") or "",
                    source=rec.get("source") or "imported",
                    category=rec.get("category"),
                    subcategory=rec.get("subcategory"),
                    description=rec.get("description"),
                    readme_excerpt=rec.get("readme_excerpt"),
                    language=rec.get("language"),
                    stars=int(rec.get("stars") or 0),
                    license=rec.get("license"),
                    last_updated=_parse_dt(rec.get("last_updated")),
                    first_seen=_parse_dt(rec.get("first_seen")) or datetime.utcnow(),
                    compatibility=rec.get("compatibility"),
                    install_hint=rec.get("install_hint"),
                ))
                inserted += 1
            else:
                # Only update fields the JSON has authoritatively (keep existing data
                # for fields not in the export, e.g. classifier_cache_key).
                if rec.get("category"):
                    existing.category = rec["category"]
                if rec.get("subcategory"):
                    existing.subcategory = rec["subcategory"]
                if rec.get("compatibility"):
                    existing.compatibility = rec["compatibility"]
                if rec.get("install_hint"):
                    existing.install_hint = rec["install_hint"]
                updated += 1
            # Tags
            for tag in (rec.get("tags") or []):
                if isinstance(tag, str):
                    s.merge(Tag(tool_id=tid, tag=tag.lower()))
            # Grade (if export had one)
            g = rec.get("grade")
            if g and isinstance(g, dict):
                axes = g.get("axes") or {}
                grade_row = s.get(Grade, tid)
                if grade_row is None:
                    s.add(Grade(
                        tool_id=tid,
                        relevance=float(axes.get("R") or 0),
                        quality=float(axes.get("Q") or 0),
                        novelty=float(axes.get("N") or 0),
                        install_ease=float(axes.get("I") or 0),
                        fit=float(axes.get("F") or 0),
                        total=float(g.get("total") or 0),
                        letter=g.get("letter") or "F",
                        color_hex="#" + {
                            "S": "8B5CF6", "A": "10B981", "B": "3B82F6",
                            "C": "F59E0B", "D": "F97316", "F": "6B7280",
                        }.get(g.get("letter") or "F", "6B7280"),
                    ))
        s.commit()
    summary = {"imported_new": inserted, "updated": updated, "total_in_json": len(body)}
    log.info("import_json: %s", summary)
    return summary
