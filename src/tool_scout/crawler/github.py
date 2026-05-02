"""GitHub crawler — topic search + code search via REST API.

Implements two strategies driven by config/sources.yaml `github.searches`:
  - type: repositories → /search/repositories?q=<query>
  - type: code         → /search/code?q=<query>

Per spec §11–13:
  - Authenticates with GITHUB_TOKEN (or `gh auth token` fallback)
  - User-Agent set on every request
  - Honors per-search budget (config-driven)
  - 100 results per page, max 5 pages per query (configurable)
  - Returns ToolRecord list ready for the runner to upsert
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import time
from datetime import datetime
from typing import Any

from tool_scout.crawler.record import ToolRecord
from tool_scout.util.rate_limit import CrawlClient
from tool_scout.util.time_budget import TimeBudget

log = logging.getLogger("crawl")

API_BASE = "https://api.github.com"
PER_PAGE = 30
MAX_PAGES_PER_QUERY = 3   # GitHub Search caps at 1000 results total; 30 * 3 = 90 per query


def _resolve_token() -> str | None:
    tok = os.environ.get("GITHUB_TOKEN")
    if tok:
        return tok
    # Fallback: gh CLI keyring
    if shutil.which("gh"):
        try:
            r = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        except (subprocess.SubprocessError, OSError):
            pass
    return None


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def _truncate(s: str | None, n: int) -> str | None:
    if not s:
        return s
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + "…"


def _record_from_repo(item: dict[str, Any]) -> ToolRecord:
    return ToolRecord(
        name=item.get("full_name") or item.get("name") or "",
        url=item.get("html_url") or "",
        source="github",
        description=_truncate(item.get("description"), 500),
        readme_excerpt=None,  # filled later via separate /readme call if budget allows
        language=item.get("language"),
        stars=int(item.get("stargazers_count") or 0),
        license=(item.get("license") or {}).get("spdx_id"),
        last_updated=_parse_dt(item.get("pushed_at") or item.get("updated_at")),
        tags=list(item.get("topics") or []),
    )


def _record_from_code(item: dict[str, Any]) -> ToolRecord:
    repo = item.get("repository") or {}
    path = item.get("path") or ""
    return ToolRecord(
        name=f"{repo.get('full_name', '')}/{path}",
        url=item.get("html_url") or "",
        source="github",
        description=f"file match: {path}",
        language=None,
        stars=int(repo.get("stargazers_count") or 0),
        last_updated=_parse_dt(repo.get("pushed_at")),
        tags=["code-match"],
    )


def crawl_search(
    client: CrawlClient,
    query: str,
    search_type: str,
    budget_seconds: float,
    *,
    token: str | None = None,
) -> list[ToolRecord]:
    """One search query, paginated until budget runs out or no more pages."""
    if search_type not in ("repositories", "code"):
        log.warning("unknown github search type: %s — skipping", search_type)
        return []
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    records: list[ToolRecord] = []
    t0 = time.monotonic()
    seen_urls: set[str] = set()

    for page in range(1, MAX_PAGES_PER_QUERY + 1):
        if time.monotonic() - t0 > budget_seconds:
            log.info("github budget exhausted for query %r at page %s", query, page)
            break
        url = f"{API_BASE}/search/{search_type}?q={httpx_qs(query)}&per_page={PER_PAGE}&page={page}"
        try:
            resp = client.get(url, headers=headers)
        except Exception as e:  # noqa: BLE001
            log.warning("github search %r page %s failed: %s", query, page, e)
            break
        if resp.status_code != 200:
            log.warning("github returned %s for %r page %s", resp.status_code, query, page)
            break
        try:
            payload = resp.json()
        except Exception as e:  # noqa: BLE001
            log.warning("github JSON decode failed for %r: %s", query, e)
            break
        items = payload.get("items") or []
        if not items:
            break
        for item in items:
            rec = _record_from_repo(item) if search_type == "repositories" else _record_from_code(item)
            if not rec.url or rec.url in seen_urls:
                continue
            seen_urls.add(rec.url)
            records.append(rec)
        # GitHub Search API rate limit: 30/min authenticated. Pace ourselves.
        time.sleep(2)
    return records


def httpx_qs(s: str) -> str:
    """Minimal URL-encoder for the q= field."""
    from urllib.parse import quote_plus

    return quote_plus(s)


def crawl_github(
    config_block: dict[str, Any],
    budget: TimeBudget,
    *,
    client: CrawlClient | None = None,
) -> list[ToolRecord]:
    """Driver for the github: section of sources.yaml. Returns ToolRecord list."""
    if not config_block.get("enabled", False):
        return []
    token = _resolve_token()
    if not token:
        log.warning("github: no GITHUB_TOKEN and no gh CLI fallback — anonymous limit will choke")
    own_client = client is None
    client = client or CrawlClient()
    all_records: list[ToolRecord] = []
    try:
        for search in config_block.get("searches", []):
            if budget.expired():
                log.warning("hard kill: aborting remaining github searches")
                break
            query = search.get("query")
            stype = search.get("type", "repositories")
            sbudget_min = float(search.get("budget_min", 2))
            sbudget_s = sbudget_min * 60
            t0 = time.monotonic()
            recs = crawl_search(client, query, stype, sbudget_s, token=token)
            spent = time.monotonic() - t0
            budget.consume("github", spent)
            log.info("github search %r %s: %d records in %.1fs", query, stype, len(recs), spent)
            all_records.extend(recs)
    finally:
        if own_client:
            client.close()
    return all_records
