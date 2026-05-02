"""Strategy C — skill install.

Copies the skill directory into ~/.claude/skills/<tool_id>/. For local-personal
tools, copies from the resolved local path. For github tools, requires the
user to clone first (Phase 6 stub: returns "needs source path").

Uninstall removes the directory.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from tool_scout.installer.audit import record_install, write_audit
from tool_scout.installer.paths import SKILLS_DIR
from tool_scout.models import Tool

log = logging.getLogger("scout")


def _slug(tool: Tool) -> str:
    base = tool.name or tool.id
    return "".join(c if c.isalnum() or c in "-_" else "-" for c in base)[:60] or tool.id


def _resolve_source(tool: Tool) -> Path | None:
    """Local-personal tools have URL = local filesystem path."""
    if tool.source == "local-personal" and tool.url:
        p = Path(tool.url)
        if p.exists():
            return p
    return None


def install(tool: Tool, *, dry_run: bool = False) -> tuple[bool, dict]:
    src = _resolve_source(tool)
    if src is None:
        return False, {"error": "no resolvable source path; clone the repo and re-run with --source"}
    target = SKILLS_DIR / _slug(tool)
    diff = {"source": str(src), "target": str(target), "exists_before": target.exists()}
    if dry_run:
        write_audit("install", tool.id, strategy="skill_dry_run", diff=diff)
        return True, diff
    if target.exists():
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, target)
    else:
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target / src.name)
    write_audit("install", tool.id, strategy="skill", diff=diff)
    record_install(tool.id, strategy="skill", target_path=str(target), config_diff=diff)
    return True, diff


def uninstall(tool: Tool) -> tuple[bool, dict]:
    target = SKILLS_DIR / _slug(tool)
    diff = {"target": str(target), "existed": target.exists()}
    if target.exists():
        shutil.rmtree(target)
    write_audit("uninstall", tool.id, strategy="skill", diff=diff)
    record_install(tool.id, strategy="skill_uninstall", target_path=str(target), config_diff=diff)
    return True, diff
