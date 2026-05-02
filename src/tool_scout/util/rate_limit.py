"""HTTP client with politeness controls + 24h disk cache (docs/01_SPEC.md §13).

Wraps httpx.Client with:
  - per-host concurrency cap (default 2)
  - exponential backoff on 429 / 5xx (max 60s, then abandon)
  - 24h disk cache at ~/.tool-scout/cache/<sha256(url)>.json (gzipped)
  - sweeps cache entries older than 48h on `sweep()`

Used by every HTTP-based crawler module.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

log = logging.getLogger("crawl")

CACHE_DIR = Path.home() / ".tool-scout" / "cache"
DEFAULT_UA = "tool-scout/0.1 (+https://github.com/majieddd/tool-scout)"


@dataclass
class CachedResponse:
    status_code: int
    headers: dict[str, str]
    body: str

    def json(self) -> Any:
        return json.loads(self.body)

    @property
    def text(self) -> str:
        return self.body


def _cache_key(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


class DiskCache:
    """Simple gzipped-JSON file cache keyed by sha256(url)."""

    def __init__(self, root: Path = CACHE_DIR, ttl_hours: int = 24):
        self.root = root
        self.ttl = timedelta(hours=ttl_hours)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, url: str) -> Path:
        return self.root / f"{_cache_key(url)}.json.gz"

    def get(self, url: str) -> CachedResponse | None:
        p = self._path(url)
        if not p.exists():
            return None
        # Honor TTL on read.
        mtime = datetime.fromtimestamp(p.stat().st_mtime)
        if datetime.utcnow() - mtime > self.ttl:
            return None
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                payload = json.load(f)
            return CachedResponse(
                status_code=int(payload["status_code"]),
                headers=dict(payload.get("headers", {})),
                body=str(payload["body"]),
            )
        except (OSError, json.JSONDecodeError, KeyError):
            return None

    def put(self, url: str, resp: httpx.Response) -> None:
        p = self._path(url)
        payload = {
            "url": url,
            "status_code": resp.status_code,
            "headers": dict(resp.headers),
            "body": resp.text,
        }
        try:
            with gzip.open(p, "wt", encoding="utf-8") as f:
                json.dump(payload, f)
        except OSError as e:
            log.warning("cache write failed for %s: %s", url[:80], e)

    def sweep(self, max_age_hours: int = 48) -> int:
        """Remove cache entries older than max_age_hours. Returns count deleted."""
        cutoff = datetime.utcnow() - timedelta(hours=max_age_hours)
        deleted = 0
        for p in self.root.glob("*.json.gz"):
            try:
                if datetime.fromtimestamp(p.stat().st_mtime) < cutoff:
                    p.unlink()
                    deleted += 1
            except OSError:
                pass
        return deleted


class CrawlClient:
    """httpx wrapper with per-host concurrency + 24h disk cache + 429 backoff."""

    def __init__(
        self,
        max_per_host: int = 2,
        timeout_s: float = 30.0,
        user_agent: str = DEFAULT_UA,
        cache: DiskCache | None = None,
    ):
        self.cache = cache or DiskCache()
        self.user_agent = user_agent
        self.timeout_s = timeout_s
        self._max_per_host = max_per_host
        self._semaphores: dict[str, threading.Semaphore] = {}
        self._sem_lock = threading.Lock()
        self._client = httpx.Client(
            timeout=timeout_s,
            headers={"User-Agent": user_agent},
            follow_redirects=True,
        )

    def _semaphore(self, host: str) -> threading.Semaphore:
        with self._sem_lock:
            if host not in self._semaphores:
                self._semaphores[host] = threading.Semaphore(self._max_per_host)
            return self._semaphores[host]

    def get(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        accept_cache: bool = True,
        max_retries: int = 3,
    ) -> CachedResponse:
        if accept_cache:
            cached = self.cache.get(url)
            if cached is not None:
                log.debug("cache hit %s", url[:80])
                return cached

        host = urlparse(url).hostname or url
        sem = self._semaphore(host)

        for attempt in range(max_retries + 1):
            with sem:
                try:
                    resp = self._client.get(url, headers=headers)
                except httpx.HTTPError as e:
                    log.warning("http error on %s (attempt %s): %s", url[:80], attempt + 1, e)
                    if attempt == max_retries:
                        raise
                    time.sleep(min(2 ** attempt, 60))
                    continue

            # 429 / 5xx: back off and retry up to max_retries
            if resp.status_code in (429, 500, 502, 503, 504):
                wait = min(2 ** attempt, 60)
                log.info("backoff %ss on %s status %s", wait, url[:80], resp.status_code)
                if attempt == max_retries:
                    log.warning("giving up on %s after %s attempts", url[:80], max_retries + 1)
                    break
                time.sleep(wait)
                continue
            self.cache.put(url, resp)
            return CachedResponse(
                status_code=resp.status_code,
                headers=dict(resp.headers),
                body=resp.text,
            )

        # Final response from the loop (whatever it was).
        self.cache.put(url, resp)
        return CachedResponse(
            status_code=resp.status_code,
            headers=dict(resp.headers),
            body=resp.text,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "CrawlClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
