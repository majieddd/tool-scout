"""GitHub crawler tests — mocked CrawlClient, no network."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from tool_scout.crawler.github import crawl_github
from tool_scout.crawler.record import ToolRecord
from tool_scout.util.rate_limit import CachedResponse
from tool_scout.util.time_budget import TimeBudget


def _fake_repo_payload():
    return {
        "items": [
            {
                "full_name": "anthropics/claude-code",
                "html_url": "https://github.com/anthropics/claude-code",
                "description": "The official CLI for Claude",
                "stargazers_count": 12345,
                "language": "TypeScript",
                "topics": ["claude", "anthropic"],
                "license": {"spdx_id": "MIT"},
                "pushed_at": "2026-04-30T12:00:00Z",
            },
            {
                "full_name": "punkpeye/awesome-mcp-servers",
                "html_url": "https://github.com/punkpeye/awesome-mcp-servers",
                "description": "Curated list of MCP servers",
                "stargazers_count": 4200,
                "language": "Markdown",
                "topics": ["mcp", "awesome"],
                "license": None,
                "pushed_at": "2026-04-25T08:00:00Z",
            },
        ]
    }


def test_crawl_github_parses_repo_search_results(monkeypatch):
    fake_client = MagicMock()
    fake_client.get.return_value = CachedResponse(
        status_code=200, headers={}, body=json.dumps(_fake_repo_payload())
    )
    cfg = {
        "enabled": True,
        "searches": [
            {"query": "topic:mcp-server", "type": "repositories", "budget_min": 1},
        ],
    }
    monkeypatch.setattr("tool_scout.crawler.github.time.sleep", lambda _: None)
    budget = TimeBudget.quick()
    budget.start()
    recs = crawl_github(cfg, budget, client=fake_client)
    assert len(recs) >= 2
    by_url = {r.url: r for r in recs}
    assert "https://github.com/anthropics/claude-code" in by_url
    rec = by_url["https://github.com/anthropics/claude-code"]
    assert rec.source == "github"
    assert rec.stars == 12345
    assert rec.language == "TypeScript"
    assert "claude" in rec.tags
    assert rec.license == "MIT"


def test_crawl_github_disabled_returns_empty():
    cfg = {"enabled": False, "searches": []}
    recs = crawl_github(cfg, TimeBudget.quick())
    assert recs == []


def test_record_id_is_stable():
    r = ToolRecord(name="x", url="https://example.com", source="github")
    assert r.id() == r.id()
    assert len(r.id()) == 16
    # Different source → different ID
    r2 = ToolRecord(name="x", url="https://example.com", source="npm")
    assert r.id() != r2.id()
