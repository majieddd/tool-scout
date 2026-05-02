"""Tier 2 classifier — per-record calls to local Gemma via LlmClient,
parallelized with a thread pool.

Ollama's `format: json` mode constrains to a SINGLE JSON value per call, so
batches-of-N inevitably get truncated. Per-record calls are reliable and, with
4-way parallelism against a local model, still fast (~1s/record on Gemma3:4b).

Logs every call to usage_log so `scout usage` shows real activity.
"""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from tool_scout.classifier.heuristics import ClassifyResult
from tool_scout.llm_client import LlmClient, LlmError
from tool_scout.usage_tracker import record as record_usage

log = logging.getLogger("scout")

PROMPT_PATH_SINGLE = Path(__file__).resolve().parents[3] / "config" / "prompts" / "classify_single.md"
PROMPT_PATH_BATCH = Path(__file__).resolve().parents[3] / "config" / "prompts" / "classify_batch.md"
DEFAULT_PARALLELISM = 4
DEFAULT_BATCH_SIZE = 1   # parallel single-record calls (kept for spec compatibility)


def _load_prompt_single() -> str:
    return PROMPT_PATH_SINGLE.read_text(encoding="utf-8")


def _safe_str(v) -> str:
    return v if isinstance(v, str) else (str(v) if v is not None else "")


def _coerce(classification: dict) -> ClassifyResult:
    tags_raw = classification.get("tags") or []
    tags = [str(t).lower() for t in tags_raw if isinstance(t, (str, int))]
    try:
        confidence = float(classification.get("confidence") or 0.5)
    except (TypeError, ValueError):
        confidence = 0.5
    return ClassifyResult(
        category=_safe_str(classification.get("category")) or "tool",
        subcategory=_safe_str(classification.get("subcategory")) or "general",
        compatibility=_safe_str(classification.get("compatibility")) or "needs_wrapper",
        tags=tags[:8],
        install_hint=_safe_str(classification.get("install_hint")) or None,
        confidence=confidence,
        source="gemma",
    )


def _build_record_payload(rec: dict) -> dict:
    return {
        "id": rec["id"],
        "name": rec.get("name", "")[:120],
        "url": rec.get("url", ""),
        "readme_excerpt": (rec.get("readme_excerpt") or rec.get("description") or "")[:1500],
    }


def classify_single(rec: dict, client: LlmClient, template: str) -> ClassifyResult | None:
    payload = _build_record_payload(rec)
    prompt = template.replace("{record_json}", json.dumps(payload, ensure_ascii=False))
    t0 = time.monotonic()
    success = True
    out_text = ""
    try:
        body, _ = client.ask_json(prompt)
    except LlmError as e:
        success = False
        log.warning("classify_single %s failed: %s", rec["id"], e)
        return None
    finally:
        record_usage(
            purpose="classify",
            duration_s=time.monotonic() - t0,
            in_chars=len(prompt),
            out_chars=len(out_text),
            success=success,
            model=client.model,
        )
    if not isinstance(body, dict):
        log.warning("classify_single %s: response not a dict (%r)", rec["id"], type(body))
        return None
    return _coerce(body)


def classify_batch(
    records: list[dict],
    *,
    client: LlmClient | None = None,
    template: str | None = None,
    parallelism: int = DEFAULT_PARALLELISM,
) -> dict[str, ClassifyResult]:
    """Classify a list of records via parallel per-record calls.

    Despite the name kept for spec compatibility, internally this is N parallel
    single-record calls — Ollama JSON mode requires a single value per call.
    """
    if not records:
        return {}
    cli = client or LlmClient()
    template = template or _load_prompt_single()
    out: dict[str, ClassifyResult] = {}
    with ThreadPoolExecutor(max_workers=parallelism) as pool:
        futures = {pool.submit(classify_single, r, cli, template): r["id"] for r in records}
        for fut in as_completed(futures):
            rid = futures[fut]
            try:
                res = fut.result()
            except Exception as e:  # noqa: BLE001
                log.warning("classify_single %s raised: %s", rid, e)
                continue
            if res is not None:
                out[rid] = res
    return out


def classify_in_batches(
    records: list[dict],
    *,
    batch_size: int = 50,
    client: LlmClient | None = None,
    parallelism: int = DEFAULT_PARALLELISM,
) -> dict[str, ClassifyResult]:
    """Process records in chunks (logs progress); each chunk is parallelized."""
    cli = client or LlmClient()
    template = _load_prompt_single()
    out: dict[str, ClassifyResult] = {}
    chunks = [records[i : i + batch_size] for i in range(0, len(records), batch_size)]
    for i, chunk in enumerate(chunks, start=1):
        t0 = time.monotonic()
        results = classify_batch(chunk, client=cli, template=template, parallelism=parallelism)
        out.update(results)
        log.info(
            "classify chunk %d/%d: %d/%d resolved in %.1fs",
            i, len(chunks), len(results), len(chunk), time.monotonic() - t0,
        )
    return out
