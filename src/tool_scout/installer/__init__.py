"""Installer package — exposes top-level install/uninstall API + takedown."""
from __future__ import annotations

import logging

from tool_scout.db import SessionLocal
from tool_scout.installer import mcp as mcp_install
from tool_scout.installer import plugin as plugin_install
from tool_scout.installer import skill as skill_install
from tool_scout.installer.audit import write_audit
from tool_scout.installer.detector import detect_strategy
from tool_scout.models import Tool, UserOverride

log = logging.getLogger("scout")


def install(tool_id: str, *, strategy_override: str = "auto", dry_run: bool = False) -> dict:
    """Install a tool by ID. Returns a result dict."""
    with SessionLocal() as s:
        tool = s.get(Tool, tool_id)
        if tool is None:
            return {"ok": False, "error": f"tool {tool_id!r} not found"}
        strategy = strategy_override if strategy_override != "auto" else detect_strategy(tool)
        if strategy == "wrapper":
            return {"ok": False, "error": "wrapper-gen install — use Phase 8 path", "strategy": strategy}
        if strategy == "unsupported":
            return {"ok": False, "error": "no install strategy detected", "strategy": strategy}

    handler_map = {
        "native_mcp": mcp_install.install,
        "skill": skill_install.install,
        "plugin": plugin_install.install,
    }
    handler = handler_map.get(strategy)
    if handler is None:
        return {"ok": False, "error": f"unknown strategy {strategy}"}

    with SessionLocal() as s:
        tool = s.get(Tool, tool_id)
        ok, diff = handler(tool, dry_run=dry_run)
    return {"ok": ok, "strategy": strategy, "diff": diff, "dry_run": dry_run}


def uninstall(tool_id: str) -> dict:
    """Uninstall — calls all known strategy uninstallers (idempotent)."""
    with SessionLocal() as s:
        tool = s.get(Tool, tool_id)
        if tool is None:
            return {"ok": False, "error": f"tool {tool_id!r} not found"}
    results: dict = {}
    for label, mod in (("native_mcp", mcp_install), ("skill", skill_install), ("plugin", plugin_install)):
        try:
            with SessionLocal() as s:
                tool = s.get(Tool, tool_id)
                ok, diff = mod.uninstall(tool)
                results[label] = {"ok": ok, "diff": diff}
        except Exception as e:  # noqa: BLE001
            log.exception("uninstall %s/%s failed", tool_id, label)
            results[label] = {"ok": False, "error": repr(e)}
    return {"ok": True, "results": results}


def set_override(tool_id: str, state: str, note: str | None = None) -> dict:
    """Set a user_overrides row. state in (pinned, muted, tried_and_dropped, excluded_by_owner)."""
    with SessionLocal() as s:
        existing = s.get(UserOverride, tool_id)
        if existing:
            existing.state = state
            existing.note = note
        else:
            s.add(UserOverride(tool_id=tool_id, state=state, note=note))
        s.commit()
    write_audit("override", tool_id, state=state, note=note)
    return {"ok": True, "tool_id": tool_id, "state": state}


def takedown(tool_id: str, reason: str | None = None) -> dict:
    """Apply excluded_by_owner override — tool never appears in public exports."""
    return set_override(tool_id, "excluded_by_owner", note=reason)


def list_installed() -> list[dict]:
    """Returns latest successful install per tool from `installs` table."""
    from tool_scout.models import Install
    with SessionLocal() as s:
        rows = (
            s.query(Install)
            .filter(Install.success == 1, Install.strategy.notlike("%_uninstall"))
            .order_by(Install.installed_at.desc())
            .all()
        )
        seen: set[str] = set()
        out: list[dict] = []
        for r in rows:
            if r.tool_id and r.tool_id not in seen:
                seen.add(r.tool_id)
                out.append({
                    "tool_id": r.tool_id,
                    "strategy": r.strategy,
                    "target_path": r.target_path,
                    "installed_at": r.installed_at.isoformat() if r.installed_at else None,
                })
        return out


__all__ = ["install", "uninstall", "takedown", "set_override", "list_installed"]
