"""Audit log + config backup for installs.

Every install backs up the affected config to
  ~/.tool-scout/backups/configs/<timestamp>-<filename>
before mutation, then writes:
  - JSONL line to ~/.tool-scout/audit.log
  - Row to the `installs` table

uninstall reads the most recent install row for the tool, restores the backup
(or removes the added entries), and writes another audit line.
"""
from __future__ import annotations

import json
import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from tool_scout.db import SessionLocal
from tool_scout.installer.paths import AUDIT_LOG, BACKUPS_DIR, ensure_data_dirs
from tool_scout.models import Install

log = logging.getLogger("scout")


def backup_config(path: Path) -> Path | None:
    """Copy `path` to BACKUPS_DIR/<ts>-<name>. No-op if path missing."""
    if not path.exists():
        return None
    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    target = BACKUPS_DIR / f"{ts}-{path.name}"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
    log.info("backed up %s -> %s", path, target)
    return target


def write_audit(action: str, tool_id: str, **kwargs: Any) -> None:
    ensure_data_dirs()
    line = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "action": action,
        "tool_id": tool_id,
        **kwargs,
    }
    with AUDIT_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(line) + "\n")


def record_install(
    tool_id: str,
    *,
    strategy: str,
    target_path: str | None,
    config_diff: dict | None,
    success: bool = True,
    notes: str | None = None,
) -> int:
    with SessionLocal() as s:
        row = Install(
            tool_id=tool_id,
            strategy=strategy,
            target_path=target_path,
            config_diff=json.dumps(config_diff) if config_diff is not None else None,
            success=int(success),
            notes=notes,
        )
        s.add(row)
        s.commit()
        return row.id


def latest_install(tool_id: str) -> Install | None:
    with SessionLocal() as s:
        return (
            s.query(Install)
            .filter(Install.tool_id == tool_id, Install.success == 1)
            .order_by(Install.id.desc())
            .first()
        )
