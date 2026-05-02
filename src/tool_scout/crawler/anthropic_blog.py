"""Anthropic blog + release-notes RSS crawler.

Some endpoints serve RSS, others serve HTML. We try RSS first, fall back to
HTML link extraction. Records are tagged with source='anthropic'.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any

from tool_scout.crawler.record import ToolRecord
from tool_scout.util.rate_limit import CrawlClient
from tool_scout.util.time_budget import TimeBudget

log = logging.getLogger("crawl")

LINK_RE = re.compile(r'https?://(?:www\.)?(?:anthropic\.com|docs\.claude\.com)/[^\s"\'<>]+', re.I)


def _try_rss(cli: CrawlClient, feed_url: str) -> list[ToolRecord]:
    try:
        resp = cli.get(feed_url)
    except Exception as e:  # noqa: BLE001
        log.warning("anthropic %s unreachable: %s", feed_url, e)
        return []
    if resp.status_code != 200:
        return []
    text = resp.text
    records: list[ToolRecord] = []
    # Naive RSS parsing: find <item> ... </item>
    items = re.findall(r"<item>(.*?)</item>", text, flags=re.DOTALL | re.IGNORECASE)
    for it in items:
        title = re.search(r"<title>(.*?)</title>", it, flags=re.DOTALL | re.IGNORECASE)
        link = re.search(r"<link>(.*?)</link>", it, flags=re.DOTALL | re.IGNORECASE)
        date = re.search(r"<pubDate>(.*?)</pubDate>", it, flags=re.DOTALL | re.IGNORECASE)
        if not link:
            continue
        url = link.group(1).strip()
        title_text = (title.group(1).strip() if title else url)[:200]
        # Strip CDATA wrappers
        title_text = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", title_text)
        when: datetime | None = None
        if date:
            try:
                when = parsedate_to_datetime(date.group(1).strip()).replace(tzinfo=None)
            except (TypeError, ValueError):
                when = None
        records.append(ToolRecord(
            name=title_text,
            url=url,
            source="anthropic",
            description="Anthropic announcement",
            last_updated=when,
            tags=["anthropic", "official"],
        ))
    if records:
        return records
    # Fallback: extract any anthropic.com / docs.claude.com link from HTML
    seen: set[str] = set()
    for m in LINK_RE.finditer(text):
        url = m.group(0).rstrip(".,;)")
        if url in seen:
            continue
        seen.add(url)
        records.append(ToolRecord(
            name=url.rsplit("/", 1)[-1] or url,
            url=url,
            source="anthropic",
            description="Anthropic page",
            tags=["anthropic"],
        ))
    return records


def crawl_anthropic_blog(
    config_block: dict, budget: TimeBudget, *, client: CrawlClient | None = None
) -> list[ToolRecord]:
    if not config_block.get("enabled", False):
        return []
    own = client is None
    cli = client or CrawlClient()
    records: list[ToolRecord] = []
    t0 = time.monotonic()
    sbudget_s = float(config_block.get("budget_min", 3)) * 60
    seen_urls: set[str] = set()
    try:
        for feed in config_block.get("feeds") or []:
            if budget.expired() or (time.monotonic() - t0) > sbudget_s:
                break
            for rec in _try_rss(cli, feed):
                if rec.url in seen_urls:
                    continue
                seen_urls.add(rec.url)
                records.append(rec)
            time.sleep(1)
    finally:
        if own:
            cli.close()
    spent = time.monotonic() - t0
    budget.consume("anthropic_blog", spent)
    log.info("anthropic_blog: %d records in %.1fs", len(records), spent)
    return records
