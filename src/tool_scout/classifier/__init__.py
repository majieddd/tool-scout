"""Two-tier classifier orchestrator (docs/01_SPEC.md §14).

`classify_all()` is the public entrypoint. It:
  1. Pulls all `tools` rows whose classifier_cache_key has changed (or who
     have no category yet)
  2. Runs each through the heuristic tier; records hits + dead flags
  3. Batches the deferred records to Gemma in groups of `batch_size`
  4. Writes results back to the `tools` table (category, subcategory,
     compatibility, install_hint, dead) and the `tags` table

Returns a summary dict.
"""
from __future__ import annotations

import logging

from tool_scout.classifier.gemma_classifier import classify_in_batches
from tool_scout.classifier.heuristics import ClassifyResult, DeadFlag, classify_one
from tool_scout.db import SessionLocal
from tool_scout.models import Tag, Tool

log = logging.getLogger("scout")


def _record_dict_for(t: Tool) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "url": t.url,
        "description": t.description,
        "readme_excerpt": t.readme_excerpt,
        "tags": [tag.tag for tag in (t.tags or [])],
        "compatibility": t.compatibility,
    }


def _apply_result(t: Tool, res: ClassifyResult, session) -> None:
    t.category = res.category
    t.subcategory = res.subcategory
    t.compatibility = res.compatibility
    t.install_hint = res.install_hint or t.install_hint
    for tag in res.tags:
        if tag:
            session.merge(Tag(tool_id=t.id, tag=tag.lower()))


def _select_targets(force: bool) -> list[str]:
    """Returns IDs of tools that need classification."""
    with SessionLocal() as s:
        q = s.query(Tool.id)
        if not force:
            q = q.filter((Tool.category.is_(None)) | (Tool.category == ""))
        return [r[0] for r in q.all()]


def classify_all(
    *,
    force: bool = False,
    batch_size: int = 20,
    cap: int | None = None,
) -> dict:
    """Tier-1 then tier-2 classify everything pending. Returns summary dict.

    `force=True` reclassifies even records that already have a category.
    `cap` stops after this many records (useful for `--quick`).
    """
    target_ids = _select_targets(force)
    if cap is not None:
        target_ids = target_ids[:cap]

    if not target_ids:
        log.info("classify_all: nothing to do (force=%s)", force)
        return {"heuristic_hits": 0, "llm_hits": 0, "dead": 0, "deferred_unresolved": 0, "total": 0}

    log.info("classify_all: %d records pending", len(target_ids))

    heuristic_hits = 0
    dead = 0
    deferred: list[dict] = []  # records to send to LLM

    # Tier 1
    with SessionLocal() as s:
        for tid in target_ids:
            t = s.get(Tool, tid)
            if t is None:
                continue
            rec = _record_dict_for(t)
            outcome = classify_one(rec)
            if outcome is None:
                deferred.append(rec)
            elif isinstance(outcome, DeadFlag):
                t.dead = 1
                t.category = "dead"
                dead += 1
            else:
                _apply_result(t, outcome, s)
                heuristic_hits += 1
        s.commit()

    # Tier 2 — only attempt if Ollama is actually reachable. CI runs (where
    # OLLAMA_HOST is unreachable on purpose) skip cleanly here instead of
    # blocking on per-record connect timeouts.
    llm_hits = 0
    if deferred:
        from tool_scout.llm_client import LlmClient

        cli = LlmClient()
        if not cli.ping():
            log.warning(
                "LLM unreachable at %s — skipping tier-2 (heuristics-only run; "
                "%d records left uncategorized)",
                cli.host, len(deferred),
            )
        else:
            results = classify_in_batches(deferred, batch_size=batch_size, client=cli)
            with SessionLocal() as s:
                for rec_id, res in results.items():
                    t = s.get(Tool, rec_id)
                    if t is None:
                        continue
                    _apply_result(t, res, s)
                    llm_hits += 1
                s.commit()

    summary = {
        "total": len(target_ids),
        "heuristic_hits": heuristic_hits,
        "llm_hits": llm_hits,
        "dead": dead,
        "deferred_unresolved": len(deferred) - llm_hits,
    }
    log.info("classify_all: %s", summary)
    return summary
