"""Crawl runner — loads config/sources.yaml, dispatches enabled sources,
and upserts ToolRecords into the `tools` table.

In Phase 2 only `github` and `local_projects` are wired. Phase 5 adds
npm, pypi, mcp_registries, awesome_lists, reddit, hackernews, anthropic_blog.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

import yaml

from tool_scout.crawler.github import crawl_github
from tool_scout.crawler.local_projects import crawl_local_projects
from tool_scout.crawler.record import ToolRecord
from tool_scout.db import SessionLocal
from tool_scout.models import CrawlRun, Tag, Tool
from tool_scout.util.logging import setup_logging
from tool_scout.util.rate_limit import CrawlClient, DiskCache
from tool_scout.util.time_budget import TimeBudget

log = logging.getLogger("crawl")


SourceFn = Callable[[dict, TimeBudget], list[ToolRecord]]

# Phase 2: github + local_projects only. Phase 5 will register the rest.
SOURCE_DRIVERS: dict[str, SourceFn] = {
    "github": lambda cfg, budget: crawl_github(cfg, budget),
    "local_projects": lambda cfg, budget: crawl_local_projects(cfg, budget),
}

QUICK_ALLOWED = {"github", "local_projects", "mcp_registries"}  # mcp_registries lands in Phase 5


def load_sources_yaml(path: Path | str) -> dict:
    p = Path(path)
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}


def _today_is_sunday() -> bool:
    return datetime.utcnow().weekday() == 6


def _upsert(records: list[ToolRecord]) -> tuple[int, int]:
    """Insert new tools, update existing-by-id. Returns (new, updated).

    Dedupes within-batch by id() so multiple GitHub searches hitting the same
    repo merge into one row. Also handles URL collisions between sources by
    falling back to a URL lookup before insert.
    """
    # Within-batch dedupe by id (sha256(source||url)). Last write wins;
    # later records tend to have richer fields if the same tool was hit
    # through more searches.
    by_id: dict[str, ToolRecord] = {}
    for rec in records:
        if not rec.url:
            continue
        by_id[rec.id()] = rec

    new = 0
    updated = 0
    skipped = 0
    with SessionLocal() as s:
        for tid, rec in by_id.items():
            existing = s.get(Tool, tid)
            if existing is None:
                # URL UNIQUE could still collide if a different source produced
                # the same URL. Check before INSERT.
                from sqlalchemy import select
                existing_by_url = s.execute(select(Tool).where(Tool.url == rec.url)).scalar_one_or_none()
                if existing_by_url is not None:
                    existing = existing_by_url

            if existing is None:
                try:
                    s.add(Tool(
                        id=tid,
                        name=rec.name[:500],
                        url=rec.url,
                        source=rec.source,
                        description=rec.description,
                        readme_excerpt=rec.readme_excerpt,
                        language=rec.language,
                        stars=rec.stars,
                        downloads=rec.downloads,
                        license=rec.license,
                        last_updated=rec.last_updated,
                        compatibility=rec.compatibility,
                        classifier_cache_key=rec.classifier_cache_key(),
                    ))
                    s.flush()
                    new += 1
                    for t in rec.tags:
                        s.merge(Tag(tool_id=tid, tag=t.lower()))
                except Exception:  # noqa: BLE001
                    s.rollback()
                    skipped += 1
                    continue
            else:
                existing.name = (rec.name[:500] or existing.name)
                existing.description = rec.description or existing.description
                existing.readme_excerpt = rec.readme_excerpt or existing.readme_excerpt
                existing.language = rec.language or existing.language
                existing.stars = max(existing.stars or 0, rec.stars or 0)
                existing.downloads = max(existing.downloads or 0, rec.downloads or 0)
                existing.license = existing.license or rec.license
                existing.last_updated = rec.last_updated or existing.last_updated
                existing.last_crawled = datetime.utcnow()
                existing.compatibility = existing.compatibility or rec.compatibility
                new_key = rec.classifier_cache_key()
                if existing.classifier_cache_key != new_key:
                    existing.classifier_cache_key = new_key
                for t in rec.tags:
                    s.merge(Tag(tool_id=existing.id, tag=t.lower()))
                updated += 1
        s.commit()
    if skipped:
        log.warning("upsert: skipped %d records due to integrity errors", skipped)
    return new, updated


def run_crawl(
    sources_path: str | Path | None = None,
    *,
    quick: bool = False,
) -> dict:
    """Top-level entry. Returns a summary dict with new/updated counts + errors."""
    setup_logging()
    sources_path = Path(sources_path) if sources_path else (
        Path(__file__).resolve().parents[3] / "config" / "sources.yaml"
    )
    config = load_sources_yaml(sources_path)
    budget = TimeBudget.quick() if quick else TimeBudget.full()
    budget.start()
    is_sunday = _today_is_sunday()
    errors: list[str] = []
    all_records: list[ToolRecord] = []

    # Pre-allocate per-source budgets (sum of search/source budget_min values)
    for src_name, cfg in config.items():
        if not isinstance(cfg, dict):
            continue
        if isinstance(cfg.get("searches"), list):
            total = sum(float(s.get("budget_min", 0)) for s in cfg["searches"])
        else:
            total = float(cfg.get("budget_min", 2))
        budget.allocate(src_name, total)

    with SessionLocal() as s:
        run = CrawlRun()
        s.add(run)
        s.commit()
        run_id = run.id

    try:
        for src_name, driver in SOURCE_DRIVERS.items():
            cfg = config.get(src_name) or {}
            if not cfg.get("enabled", False):
                continue
            if quick and src_name not in QUICK_ALLOWED:
                log.info("--quick: skipping %s", src_name)
                continue
            if cfg.get("frequency") == "weekly" and not is_sunday:
                log.info("%s is weekly-only — skipping (today is %s)", src_name, datetime.utcnow().strftime("%a"))
                continue
            if budget.expired():
                log.warning("hard kill — aborting %s and remaining sources", src_name)
                errors.append(f"hard_kill_before_{src_name}")
                break
            log.info("=== %s starting (allocated %.1fs) ===", src_name, budget.allocations_per_source.get(src_name, 0))
            try:
                recs = driver(cfg, budget)
                all_records.extend(recs)
            except Exception as e:  # noqa: BLE001
                log.exception("source %s failed", src_name)
                errors.append(f"{src_name}: {type(e).__name__}: {e}")
    finally:
        # Sweep stale cache (anything > 48h old)
        try:
            DiskCache().sweep(48)
        except Exception:  # noqa: BLE001
            pass

    new, updated = _upsert(all_records)
    # Classify newly-added + still-unclassified records.
    try:
        from tool_scout.classifier import classify_all

        classify_summary = classify_all()
        log.info("classify summary: %s", classify_summary)
    except Exception as e:  # noqa: BLE001
        log.exception("classifier failed (crawl results still saved)")
        errors.append(f"classifier: {type(e).__name__}: {e}")
        classify_summary = {}
    # Grade everything (recomputes existing grades too — profile/rubric edits
    # propagate without needing a re-crawl).
    try:
        from tool_scout.grading import grade_all

        grade_summary = grade_all()
        log.info("grade summary: %s", grade_summary)
    except Exception as e:  # noqa: BLE001
        log.exception("grading failed")
        errors.append(f"grading: {type(e).__name__}: {e}")
        grade_summary = {}
    duration_s = int(budget.elapsed_s())

    with SessionLocal() as s:
        run = s.get(CrawlRun, run_id)
        if run:
            run.ended_at = datetime.utcnow()
            run.duration_s = duration_s
            run.sources = json.dumps(list(SOURCE_DRIVERS.keys()))
            run.new_tools = new
            run.updated = updated
            run.errors = json.dumps(errors)
            s.commit()

    summary = {
        "run_id": run_id,
        "duration_s": duration_s,
        "new_tools": new,
        "updated": updated,
        "errors": errors,
        "budget": budget.summary(),
        "classify": classify_summary,
        "grade": grade_summary,
    }
    log.info("crawl complete: %s", summary)
    return summary
