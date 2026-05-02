"""npm registry crawler — uses the public registry search API.

GET https://registry.npmjs.org/-/v1/search?text=keywords:mcp&size=20

Each result includes name, version, description, links, downloads (weekly),
keywords, last-publish date.
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

API_BASE = "https://registry.npmjs.org/-/v1/search"
PER_PAGE = 50


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def _record(obj: dict[str, Any]) -> ToolRecord | None:
    pkg = obj.get("package") or {}
    name = pkg.get("name")
    if not name:
        return None
    links = pkg.get("links") or {}
    url = links.get("npm") or f"https://www.npmjs.com/package/{name}"
    downloads = (obj.get("score") or {}).get("detail", {}).get("popularity", 0)
    # The /search endpoint doesn't give absolute weekly downloads in the score
    # block, but it does in some response shapes via scope.
    weekly = obj.get("downloads") or 0
    return ToolRecord(
        name=name,
        url=url,
        source="npm",
        description=pkg.get("description"),
        readme_excerpt=None,
        language="JavaScript" if not name.startswith("@types") else "TypeScript",
        stars=0,
        downloads=int(weekly) if isinstance(weekly, (int, float)) else 0,
        license=None,
        last_updated=_parse_dt(pkg.get("date")),
        tags=[k.lower() for k in (pkg.get("keywords") or [])][:8],
    )


def crawl_npm(config_block: dict, budget: TimeBudget, *, client: CrawlClient | None = None) -> list[ToolRecord]:
    if not config_block.get("enabled", False):
        return []
    own = client is None
    cli = client or CrawlClient()
    records: list[ToolRecord] = []
    sbudget_s = float(config_block.get("budget_min", 5)) * 60
    t0 = time.monotonic()
    try:
        for query in config_block.get("queries", []):
            if budget.expired() or (time.monotonic() - t0) > sbudget_s:
                break
            url = f"{API_BASE}?text={query}&size={PER_PAGE}"
            try:
                resp = cli.get(url)
            except Exception as e:  # noqa: BLE001
                log.warning("npm %r failed: %s", query, e)
                continue
            if resp.status_code != 200:
                log.warning("npm %r returned %s", query, resp.status_code)
                continue
            try:
                payload = resp.json()
            except Exception:  # noqa: BLE001
                continue
            for obj in payload.get("objects", []):
                rec = _record(obj)
                if rec:
                    records.append(rec)
            time.sleep(1)
    finally:
        if own:
            cli.close()
    spent = time.monotonic() - t0
    budget.consume("npm", spent)
    log.info("npm: %d records in %.1fs", len(records), spent)
    return records
