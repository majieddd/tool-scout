"""Awesome-list crawler — parses curated lists from GitHub raw markdown.

Lists are markdown files with a flat collection of bullet points referencing
external repos. We grab the raw README.md, extract https://github.com/* links,
and emit one ToolRecord per unique repo URL.

Runs only weekly (per sources.yaml `frequency: weekly` — caller controls).
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any

from tool_scout.crawler.record import ToolRecord
from tool_scout.util.rate_limit import CrawlClient
from tool_scout.util.time_budget import TimeBudget

log = logging.getLogger("crawl")

GITHUB_REPO_RE = re.compile(r"https://github\.com/([\w.-]+)/([\w.-]+)")


def _fetch_readme(cli: CrawlClient, repo: str) -> str | None:
    """Try main first, then master."""
    for branch in ("main", "master"):
        url = f"https://raw.githubusercontent.com/{repo}/{branch}/README.md"
        try:
            resp = cli.get(url)
        except Exception:  # noqa: BLE001
            continue
        if resp.status_code == 200:
            return resp.text
    return None


def _extract_repos(markdown: str, exclude_self: str) -> list[str]:
    repos: list[str] = []
    seen: set[str] = set()
    for m in GITHUB_REPO_RE.finditer(markdown):
        owner = m.group(1).rstrip(".,;")
        name = m.group(2).rstrip(".,;)").rsplit("#", 1)[0]
        if not name or name.endswith(".md"):
            continue
        slug = f"{owner}/{name}"
        if slug == exclude_self or slug in seen:
            continue
        seen.add(slug)
        repos.append(slug)
    return repos


def crawl_awesome_lists(
    config_block: dict, budget: TimeBudget, *, client: CrawlClient | None = None
) -> list[ToolRecord]:
    if not config_block.get("enabled", False):
        return []
    own = client is None
    cli = client or CrawlClient()
    records: list[ToolRecord] = []
    t0 = time.monotonic()
    sbudget_s = float(config_block.get("budget_min", 10)) * 60
    seen_urls: set[str] = set()
    try:
        for repo in config_block.get("repos") or []:
            if budget.expired() or (time.monotonic() - t0) > sbudget_s:
                break
            md = _fetch_readme(cli, repo)
            if not md:
                continue
            for slug in _extract_repos(md, exclude_self=repo):
                url = f"https://github.com/{slug}"
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                records.append(ToolRecord(
                    name=slug,
                    url=url,
                    source="awesome",
                    description=f"Listed in {repo}",
                    tags=["awesome", repo.split("/", 1)[-1]],
                ))
            time.sleep(1)
    finally:
        if own:
            cli.close()
    spent = time.monotonic() - t0
    budget.consume("awesome_lists", spent)
    log.info("awesome_lists: %d unique repos in %.1fs", len(records), spent)
    return records
