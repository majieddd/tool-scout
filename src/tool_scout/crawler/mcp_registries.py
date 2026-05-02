"""MCP registries crawler — pulsemcp.com, mcp.so, smithery.ai.

Each is HTML-scraped using the CSS selector specified in sources.yaml.
Uses selectolax (fast Cython parser) which is already in dependencies.

Defensive: if a selector doesn't match (sites change layouts), logs a warning
and returns an empty list rather than crashing. Listings without absolute URLs
are skipped.
"""
from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urljoin

from tool_scout.crawler.record import ToolRecord
from tool_scout.util.rate_limit import CrawlClient
from tool_scout.util.time_budget import TimeBudget

log = logging.getLogger("crawl")

try:
    from selectolax.parser import HTMLParser
except ImportError:  # pragma: no cover
    HTMLParser = None  # type: ignore[assignment]


def _scrape_one(cli: CrawlClient, base_url: str, selector: str, source_label: str) -> list[ToolRecord]:
    if HTMLParser is None:
        log.warning("selectolax not installed — mcp_registries skipped")
        return []
    try:
        resp = cli.get(base_url)
    except Exception as e:  # noqa: BLE001
        log.warning("registry %s unreachable: %s", base_url, e)
        return []
    if resp.status_code != 200:
        log.warning("registry %s returned %s", base_url, resp.status_code)
        return []
    try:
        tree = HTMLParser(resp.text)
    except Exception as e:  # noqa: BLE001
        log.warning("registry %s HTML parse failed: %s", base_url, e)
        return []
    nodes = tree.css(selector)
    if not nodes:
        log.info("registry %s: selector %r matched 0 nodes", base_url, selector)
        return []
    records: list[ToolRecord] = []
    seen: set[str] = set()
    for node in nodes:
        href = node.attributes.get("href") or ""
        if not href:
            continue
        full_url = urljoin(base_url, href)
        if full_url in seen or not full_url.startswith("http"):
            continue
        seen.add(full_url)
        # Try to glean a name from link text or aria-label
        name = (node.text(strip=True) or node.attributes.get("aria-label") or full_url.rsplit("/", 1)[-1])[:120]
        records.append(ToolRecord(
            name=name,
            url=full_url,
            source=source_label,
            description=f"Listed on {source_label}",
            tags=["mcp", "mcp-server", source_label],
        ))
    log.info("registry %s: %d records", base_url, len(records))
    return records


def crawl_mcp_registries(
    config_block: dict, budget: TimeBudget, *, client: CrawlClient | None = None
) -> list[ToolRecord]:
    if not config_block.get("enabled", False):
        return []
    own = client is None
    cli = client or CrawlClient()
    records: list[ToolRecord] = []
    t0 = time.monotonic()
    try:
        for src in config_block.get("sources") or []:
            if budget.expired():
                break
            url = src.get("url")
            selector = src.get("selector")
            if not url or not selector:
                continue
            label = "mcp.so" if "mcp.so" in url else (
                "pulsemcp" if "pulsemcp" in url else (
                    "smithery" if "smithery" in url else url
                )
            )
            sbudget_s = float(src.get("budget_min", 3)) * 60
            site_t0 = time.monotonic()
            recs = _scrape_one(cli, url, selector, label)
            records.extend(recs)
            site_spent = time.monotonic() - site_t0
            budget.consume("mcp_registries", site_spent)
            if site_spent > sbudget_s:
                log.info("registry %s budget exceeded", url)
            time.sleep(2)
    finally:
        if own:
            cli.close()
    log.info("mcp_registries total: %d in %.1fs", len(records), time.monotonic() - t0)
    return records
