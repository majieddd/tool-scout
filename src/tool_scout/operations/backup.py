"""Backup operations (docs/01_SPEC.md §51).

Daily backup via SQLite's online backup API (no lock). Gzips files older
than 1 day, rotates: keep 7 daily + 4 weekly (Sundays) + 6 monthly (1st
of month).

`scout restore <YYYY-MM-DD>` swaps in a previous backup.
"""
from __future__ import annotations

import gzip
import logging
import shutil
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from tool_scout.db import SessionLocal, db_path
from tool_scout.models import BackupLog

log = logging.getLogger("scout")

BACKUP_DIR = Path.home() / ".tool-scout" / "backups"
DISK_CAP_BYTES = 2 * 1024 * 1024 * 1024   # 2 GB


def _ensure_dir() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def backup_now() -> Path:
    """Run a backup. Returns the path of the new file."""
    _ensure_dir()
    src_path = db_path()
    if not src_path.exists():
        raise RuntimeError(f"DB not found at {src_path}; run alembic upgrade head first")
    ts = datetime.utcnow().strftime("%Y-%m-%d")
    target = BACKUP_DIR / f"scout-{ts}.db"

    # SQLite online backup API — no lock on src
    src = sqlite3.connect(str(src_path))
    dst = sqlite3.connect(str(target))
    try:
        with dst:
            src.backup(dst)
    finally:
        dst.close()
        src.close()

    # integrity check
    conn = sqlite3.connect(str(target))
    try:
        ok_row = conn.execute("PRAGMA integrity_check").fetchone()
    finally:
        conn.close()
    integrity_ok = ok_row and ok_row[0] == "ok"
    if not integrity_ok:
        target.unlink(missing_ok=True)
        raise RuntimeError("backup integrity_check failed")

    # gzip anything older than 1 day, _then_ rotate
    _gzip_aged_files()
    _rotate()
    _enforce_disk_cap()

    size = target.stat().st_size
    with SessionLocal() as s:
        s.add(BackupLog(path=str(target), size_bytes=size, integrity_ok=1, kind="daily"))
        s.commit()
    log.info("backup wrote %s (%d bytes)", target, size)
    return target


def _gzip_aged_files() -> None:
    cutoff = datetime.utcnow() - timedelta(days=1)
    for f in BACKUP_DIR.glob("scout-*.db"):
        try:
            mtime = datetime.fromtimestamp(f.stat().st_mtime)
        except OSError:
            continue
        if mtime < cutoff:
            gz = f.with_suffix(".db.gz")
            try:
                with open(f, "rb") as fi, gzip.open(gz, "wb") as fo:
                    shutil.copyfileobj(fi, fo)
                f.unlink()
            except OSError as e:
                log.warning("gzip failed for %s: %s", f, e)


def _all_backups() -> list[Path]:
    return sorted(BACKUP_DIR.glob("scout-*.db*"))


def _parse_date_from_name(name: str) -> datetime | None:
    # scout-YYYY-MM-DD.db / .db.gz
    base = name.replace(".db.gz", "").replace(".db", "")
    if not base.startswith("scout-"):
        return None
    try:
        return datetime.strptime(base[len("scout-"):], "%Y-%m-%d")
    except ValueError:
        return None


def _rotate() -> None:
    """Keep 7 daily, 4 weekly (Sundays), 6 monthly (1st of month)."""
    keep: set[Path] = set()
    by_date: list[tuple[datetime, Path]] = []
    for p in _all_backups():
        d = _parse_date_from_name(p.name)
        if d:
            by_date.append((d, p))
    by_date.sort(key=lambda x: x[0], reverse=True)

    daily, weekly, monthly = [], [], []
    for d, p in by_date:
        if len(daily) < 7:
            daily.append(p)
            continue
        if d.weekday() == 6 and len(weekly) < 4:    # Sunday
            weekly.append(p)
            continue
        if d.day == 1 and len(monthly) < 6:
            monthly.append(p)
            continue
    keep.update(daily + weekly + monthly)
    for _, p in by_date:
        if p not in keep:
            try:
                p.unlink()
            except OSError:
                pass


def _enforce_disk_cap() -> None:
    total = sum(p.stat().st_size for p in _all_backups() if p.exists())
    if total <= DISK_CAP_BYTES:
        return
    log.warning("backups exceed %d bytes — purging beyond 7-day window", DISK_CAP_BYTES)
    cutoff = datetime.utcnow() - timedelta(days=7)
    for p in _all_backups():
        d = _parse_date_from_name(p.name)
        if d and d < cutoff:
            try:
                p.unlink()
            except OSError:
                pass


def restore(date_str: str) -> Path:
    """Restore from `scout-<date>.db[.gz]` — destructive! Renames live DB to .predate."""
    _ensure_dir()
    target_db = BACKUP_DIR / f"scout-{date_str}.db"
    target_gz = BACKUP_DIR / f"scout-{date_str}.db.gz"
    if target_db.exists():
        src = target_db
    elif target_gz.exists():
        src = BACKUP_DIR / f"scout-{date_str}.db"
        with gzip.open(target_gz, "rb") as fi, open(src, "wb") as fo:
            shutil.copyfileobj(fi, fo)
    else:
        raise FileNotFoundError(f"no backup for {date_str} in {BACKUP_DIR}")

    live = db_path()
    if live.exists():
        predate = live.with_suffix(".db.predate")
        if predate.exists():
            predate.unlink()
        live.rename(predate)
    shutil.copy2(src, live)
    log.info("restored %s -> %s", src, live)
    return live
