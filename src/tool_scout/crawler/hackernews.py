"""Hacker News crawler — uses Algolia HN search API (free, well-documented).

GET https://hn.algolia.com/api/v1/search?query=<q>&tags=story&hitsPerPage=20

Stories with external URLs become ToolRecords.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

from tool_scout.crawler.record import ToolRecord
from tool_scout.util.rate_limit import CrawlClient
from tool_scout.util.time_budget import TimeBudget

log = logging.getLogger("crawl")

API_BASE = "https://hn.algolia.com/api/v1/search"


def _record_from_hit(hit: dict) -> ToolRecord | None:
    url = hit.get("url")
    if not url or not url.startswith("http"):
        return None
    return ToolRecord(
        name=(hit.get("title") or "")[:140] or url,
        url=url,
        source="hn",
        description=f"HN story (points={hit.get('points', 0)})",
        readme_excerpt=(hit.get("story_text") or "")[:1500],
        last_updated=datetime.fromisoformat(hit["created_at"].replace("Z", "+00:00")).replace(tzinfo=None) if hit.get("created_at") else None,
        tags=["hn", "story"],
    )


def crawl_hackernews(
    config_block: dict, budget: TimeBudget, *, client: CrawlClient | None = None
) -> list[ToolRecord]:
    if not config_block.get("enabled", False):
        return []
    own = client is None
    cli = client or CrawlClient()
    records: list[ToolRecord] = []
    seen_urls: set[str] = set()
    t0 = time.monotonic()
    sbudget_s = float(config_block.get("budget_min", 2)) * 60
    try:
        for q in config_block.get("queries") or []:
            if budget.expired() or (time.monotonic() - t0) > sbudget_s:
                break
            from urllib.parse import quote_plus
            url = f"{API_BASE}?query={quote_plus(q)}&tags=story&hitsPerPage=20"
            try:
                resp = cli.get(url)
            except Exception as e:  # noqa: BLE001
                log.warning("hn %r failed: %s", q, e)
                continue
            if resp.status_code != 200:
                continue
            try:
                payload = resp.json()
            except Exception:  # noqa: BLE001
                continue
            for hit in payload.get("hits", []):
                rec = _record_from_hit(hit)
                if rec and rec.url not in seen_urls:
                    seen_urls.add(rec.url)
                    records.append(rec)
            time.sleep(1)
    finally:
        if own:
            cli.close()
    spent = time.monotonic() - t0
    budget.consume("hackernews", spent)
    log.info("hackernews: %d records in %.1fs", len(records), spent)
    return records
