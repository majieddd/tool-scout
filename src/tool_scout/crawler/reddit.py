"""Reddit crawler — uses the .json suffix on subreddit listings.

GET https://www.reddit.com/r/<sub>/new.json?limit=25

Extracts each post's title + URL; skips posts that are pure self-text (no
external link). Each external link becomes a ToolRecord with source='reddit'.
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


def _record_from_post(data: dict) -> ToolRecord | None:
    url = data.get("url_overridden_by_dest") or data.get("url")
    if not url or not url.startswith("http") or "reddit.com" in url:
        return None
    title = (data.get("title") or "")[:140]
    return ToolRecord(
        name=title or url,
        url=url,
        source="reddit",
        description=f"shared on r/{data.get('subreddit', 'unknown')}",
        readme_excerpt=(data.get("selftext") or "")[:1000],
        last_updated=datetime.fromtimestamp(int(data.get("created_utc") or 0)) if data.get("created_utc") else None,
        tags=[f"r-{data.get('subreddit', '').lower()}"],
    )


def crawl_reddit(
    config_block: dict, budget: TimeBudget, *, client: CrawlClient | None = None
) -> list[ToolRecord]:
    if not config_block.get("enabled", False):
        return []
    own = client is None
    user_agent = "tool-scout/0.1 (+https://github.com/majieddd/tool-scout)"
    cli = client or CrawlClient(user_agent=user_agent)
    records: list[ToolRecord] = []
    t0 = time.monotonic()
    sbudget_s = float(config_block.get("budget_min", 3)) * 60
    try:
        for sub in config_block.get("subreddits") or []:
            if budget.expired() or (time.monotonic() - t0) > sbudget_s:
                break
            url = f"https://www.reddit.com/r/{sub}/new.json?limit=25"
            try:
                resp = cli.get(url, headers={"User-Agent": user_agent})
            except Exception as e:  # noqa: BLE001
                log.warning("reddit r/%s failed: %s", sub, e)
                continue
            if resp.status_code != 200:
                log.warning("reddit r/%s returned %s", sub, resp.status_code)
                continue
            try:
                payload = resp.json()
            except Exception:  # noqa: BLE001
                continue
            children = (payload.get("data") or {}).get("children") or []
            for child in children:
                rec = _record_from_post(child.get("data") or {})
                if rec:
                    records.append(rec)
            time.sleep(1.5)
    finally:
        if own:
            cli.close()
    spent = time.monotonic() - t0
    budget.consume("reddit", spent)
    log.info("reddit: %d records in %.1fs", len(records), spent)
    return records
