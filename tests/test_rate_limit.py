"""DiskCache + CrawlClient unit tests (no network — mocked httpx)."""
from __future__ import annotations

import gzip
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx

from tool_scout.util.rate_limit import CrawlClient, DiskCache


def test_disk_cache_roundtrip(tmp_path: Path):
    cache = DiskCache(root=tmp_path, ttl_hours=24)
    fake = MagicMock()
    fake.status_code = 200
    fake.headers = {"X-Test": "y"}
    fake.text = '{"hello":"world"}'
    cache.put("https://example.com/x", fake)
    cached = cache.get("https://example.com/x")
    assert cached is not None
    assert cached.status_code == 200
    assert cached.headers.get("X-Test") == "y"
    assert cached.json() == {"hello": "world"}


def test_disk_cache_ttl_expiry(tmp_path: Path, monkeypatch):
    cache = DiskCache(root=tmp_path, ttl_hours=24)
    fake = MagicMock()
    fake.status_code = 200
    fake.headers = {}
    fake.text = "{}"
    cache.put("https://example.com/y", fake)
    # Force file mtime to 2 days ago
    target = next(tmp_path.glob("*.json.gz"))
    import os, time
    old = time.time() - (48 * 3600)
    os.utime(target, (old, old))
    assert cache.get("https://example.com/y") is None


def test_disk_cache_sweep(tmp_path: Path):
    cache = DiskCache(root=tmp_path, ttl_hours=24)
    fake = MagicMock()
    fake.status_code = 200
    fake.headers = {}
    fake.text = "{}"
    cache.put("https://example.com/a", fake)
    cache.put("https://example.com/b", fake)
    # Age one of them past 48h
    target = sorted(tmp_path.glob("*.json.gz"))[0]
    import os, time
    old = time.time() - (60 * 3600)
    os.utime(target, (old, old))
    deleted = cache.sweep(max_age_hours=48)
    assert deleted == 1


def test_crawl_client_uses_cache_on_repeat(tmp_path: Path):
    cache = DiskCache(root=tmp_path)
    cli = CrawlClient(cache=cache)
    with patch.object(cli._client, "get") as mock_get:
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.headers = {}
        resp.text = "{\"a\":1}"
        mock_get.return_value = resp
        r1 = cli.get("https://example.com/foo")
        r2 = cli.get("https://example.com/foo")
        assert mock_get.call_count == 1   # second call hit the cache
        assert r1.text == r2.text == "{\"a\":1}"
    cli.close()
