"""Rotating-file loggers per docs/01_SPEC.md §52.

Three named loggers — scout (general), crawl, queue — each with its own
RotatingFileHandler at ~/.tool-scout/logs/. 10 MB per file, keep 5 backups.

Call `setup_logging()` once at process start. Subsequent `logging.getLogger(...)`
calls inherit the configured handlers.
"""
from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path.home() / ".tool-scout" / "logs"
MAX_BYTES = 10 * 1024 * 1024
BACKUP_COUNT = 5


def setup_logging(level: str | None = None) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    lvl = getattr(logging, (level or os.environ.get("LOG_LEVEL", "INFO")).upper(), logging.INFO)
    fmt = logging.Formatter(
        fmt="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    for name in ("scout", "crawl", "queue"):
        log = logging.getLogger(name)
        log.setLevel(lvl)
        # Don't double-attach if called twice.
        if any(getattr(h, "_scout_tag", None) == name for h in log.handlers):
            continue
        handler = RotatingFileHandler(
            LOG_DIR / f"{name}.log",
            maxBytes=MAX_BYTES,
            backupCount=BACKUP_COUNT,
            encoding="utf-8",
        )
        handler._scout_tag = name  # type: ignore[attr-defined]
        handler.setFormatter(fmt)
        log.addHandler(handler)
        log.propagate = False
    # Also wire up the root logger to a console handler so unexpected modules
    # still surface their warnings during development.
    root = logging.getLogger()
    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        ch = logging.StreamHandler()
        ch.setFormatter(fmt)
        ch.setLevel(logging.WARNING)
        root.addHandler(ch)
