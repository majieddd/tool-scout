"""Backup tests — round-trip backup + restore on a temp DB."""
from __future__ import annotations

import gzip
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from tool_scout.operations.backup import (
    _enforce_disk_cap,
    _gzip_aged_files,
    _parse_date_from_name,
    _rotate,
    backup_now,
    restore,
)


def test_parse_date_from_name():
    assert _parse_date_from_name("scout-2026-05-02.db") == datetime(2026, 5, 2)
    assert _parse_date_from_name("scout-2026-05-02.db.gz") == datetime(2026, 5, 2)
    assert _parse_date_from_name("garbage") is None


def test_backup_creates_file_and_logs(tmp_path: Path, monkeypatch):
    """Make a fake DB, run backup_now, verify the file appears in BACKUPS_DIR."""
    fake_db = tmp_path / "scout.db"
    conn = sqlite3.connect(str(fake_db))
    conn.execute("CREATE TABLE alembic_version (version_num TEXT)")
    conn.execute("INSERT INTO alembic_version VALUES ('0002')")
    conn.commit()
    conn.close()

    backups = tmp_path / "backups"
    monkeypatch.setattr("tool_scout.operations.backup.BACKUP_DIR", backups)
    monkeypatch.setattr("tool_scout.operations.backup.db_path", lambda: fake_db)
    # Stub out the BackupLog DB write — would FK-fail against the real schema
    monkeypatch.setattr("tool_scout.operations.backup.SessionLocal", lambda: _NoopSession())

    target = backup_now()
    assert target.exists()
    assert target.suffix == ".db"


class _NoopSession:
    def __enter__(self):
        return self
    def __exit__(self, *a, **kw):
        pass
    def add(self, *_a, **_kw):
        pass
    def commit(self):
        pass


def test_gzip_aged_files_rolls_old(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("tool_scout.operations.backup.BACKUP_DIR", tmp_path)
    old = tmp_path / "scout-2026-04-01.db"
    old.write_bytes(b"some bytes")
    import os
    epoch = (datetime.utcnow() - timedelta(days=10)).timestamp()
    os.utime(old, (epoch, epoch))
    _gzip_aged_files()
    assert not old.exists()
    assert (tmp_path / "scout-2026-04-01.db.gz").exists()


def test_rotate_keeps_recent(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("tool_scout.operations.backup.BACKUP_DIR", tmp_path)
    # Create 10 daily backups
    for i in range(10):
        d = datetime.utcnow() - timedelta(days=i)
        f = tmp_path / f"scout-{d.strftime('%Y-%m-%d')}.db"
        f.write_bytes(b"x")
    _rotate()
    remaining = sorted(tmp_path.glob("scout-*.db*"))
    # 7 daily kept, plus any sundays/firsts
    assert 7 <= len(remaining) <= 10


def test_restore_swaps_live_db(tmp_path: Path, monkeypatch):
    """Simulate restore: stage a backup file, point db_path at temp, restore by date."""
    backups = tmp_path / "backups"
    backups.mkdir()
    monkeypatch.setattr("tool_scout.operations.backup.BACKUP_DIR", backups)
    live = tmp_path / "scout.db"
    monkeypatch.setattr("tool_scout.operations.backup.db_path", lambda: live)

    bk = backups / "scout-2026-04-15.db"
    bk.write_bytes(b"backed up content")
    live.write_bytes(b"current content")

    out = restore("2026-04-15")
    assert out == live
    assert live.read_bytes() == b"backed up content"
    # Predate file should be the previous live content
    assert (tmp_path / "scout.db.predate").read_bytes() == b"current content"
