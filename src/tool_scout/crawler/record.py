"""ToolRecord — the dataclass each crawler produces for the runner to upsert.

Mirrors the columns of the `tools` table that crawlers can populate at scrape
time (category/subcategory/compatibility get filled by the classifier in Phase 3,
quality_score by the grader in Phase 4).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class ToolRecord:
    name: str
    url: str
    source: str  # github | npm | pypi | mcp.so | pulsemcp | reddit | hn | anthropic | awesome | local-personal
    description: str | None = None
    readme_excerpt: str | None = None
    language: str | None = None
    stars: int = 0
    downloads: int = 0
    license: str | None = None
    last_updated: datetime | None = None
    install_hint: str | None = None
    tags: list[str] = field(default_factory=list)
    compatibility: str | None = None  # Pre-set by source if known (e.g., local skills)

    def id(self) -> str:
        """Stable ID = sha256(source||url) truncated to 16 hex chars (per spec §7)."""
        return hashlib.sha256(f"{self.source}|{self.url}".encode("utf-8")).hexdigest()[:16]

    def classifier_cache_key(self) -> str:
        """sha256(url + readme[:1024]) — used by classifier to skip unchanged tools."""
        body = (self.url + (self.readme_excerpt or "")[:1024]).encode("utf-8")
        return hashlib.sha256(body).hexdigest()
