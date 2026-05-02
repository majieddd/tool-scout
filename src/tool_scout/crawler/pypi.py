"""PyPI crawler — uses the JSON simple API.

PyPI doesn't expose a great search endpoint anymore; we use:
  GET https://pypi.org/simple/ (HTML index of all packages — too large)
  GET https://pypi.org/pypi/<name>/json (per-package metadata)

For Phase 2/5, the simplest practical approach is a curated query list against
the BigQuery-hosted package metadata dump alternative. Since that's too heavy,
we use the public XML-RPC search-via-pip-search alternative: the PyPI JSON
API on a list of likely package names that match keywords.

Pragmatic fallback: query github code-search for `pyproject.toml` files
mentioning `mcp` etc. — but that overlaps with the github source. So this
module does a thin enrichment: for known package names from sources.yaml.queries,
fetch their PyPI JSON.

The queries in sources.yaml are treated as substring matches against a
hard-coded curated list of packages we know exist (mcp-server-*, anthropic-skill-*).
This keeps things deterministic without needing PyPI Search.
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

# Curated list — extend as we discover new MCP/Claude-relevant Python packages.
# Each entry is a PyPI package name we'll fetch metadata for if it matches a query.
KNOWN_PACKAGES = [
    "mcp",
    "anthropic",
    "anthropic-skill",
    "claude-code",
    "fastmcp",
    "mcp-server",
    "mcp-server-fetch",
    "mcp-server-git",
    "mcp-server-time",
    "mcp-server-filesystem",
    "mcp-server-postgres",
    "mcp-server-sqlite",
    "mcp-server-memory",
    "mcp-cli",
    "mcp-py",
    "mcpkit",
]


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def _matches_queries(name: str, queries: list[str]) -> bool:
    n = name.lower()
    return any(q.lower() in n for q in queries)


def _fetch_package(cli: CrawlClient, name: str) -> ToolRecord | None:
    url = f"https://pypi.org/pypi/{name}/json"
    try:
        resp = cli.get(url)
    except Exception:  # noqa: BLE001
        return None
    if resp.status_code != 200:
        return None
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        return None
    info = body.get("info") or {}
    return ToolRecord(
        name=name,
        url=info.get("project_url") or info.get("home_page") or f"https://pypi.org/project/{name}/",
        source="pypi",
        description=info.get("summary"),
        readme_excerpt=(info.get("description") or "")[:2000],
        language="Python",
        stars=0,
        downloads=0,
        license=info.get("license"),
        last_updated=None,
        tags=[k.strip().lower() for k in (info.get("keywords") or "").split(",") if k.strip()][:8],
    )


def crawl_pypi(config_block: dict, budget: TimeBudget, *, client: CrawlClient | None = None) -> list[ToolRecord]:
    if not config_block.get("enabled", False):
        return []
    own = client is None
    cli = client or CrawlClient()
    queries = list(config_block.get("queries") or [])
    matches = [n for n in KNOWN_PACKAGES if _matches_queries(n, queries)]
    if not queries:
        matches = list(KNOWN_PACKAGES)
    records: list[ToolRecord] = []
    sbudget_s = float(config_block.get("budget_min", 5)) * 60
    t0 = time.monotonic()
    try:
        for name in matches:
            if budget.expired() or (time.monotonic() - t0) > sbudget_s:
                break
            rec = _fetch_package(cli, name)
            if rec:
                records.append(rec)
            time.sleep(0.3)
    finally:
        if own:
            cli.close()
    spent = time.monotonic() - t0
    budget.consume("pypi", spent)
    log.info("pypi: %d records in %.1fs", len(records), spent)
    return records
