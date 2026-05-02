"""Strategy A — native MCP install.

Edits ~/.claude/.mcp.json (and Claude Desktop's claude_desktop_config.json if
present) to add an `mcpServers` entry for the tool. Backs up first.

For tools whose install_hint contains an explicit `npx -y @org/pkg` or
`uvx pkg`, we parse it and use the parsed command/args. Otherwise we infer
from the tool's name pattern (npm scoped name → npx, pypi → uvx).

Allowlist: only the commands `npx`, `uvx`, `python -m`, `node` are accepted.
"""
from __future__ import annotations

import json
import logging
import re
import shlex
from pathlib import Path
from typing import Any

from tool_scout.installer.audit import backup_config, record_install, write_audit
from tool_scout.installer.paths import (
    CLAUDE_DESKTOP_CFG,
    MCP_JSON,
    discover_mcp_config_targets,
)
from tool_scout.models import Tool

log = logging.getLogger("scout")

ALLOWED_COMMANDS = {"npx", "uvx", "uv", "python", "node", "deno"}


def _entry_from_hint(tool: Tool) -> dict[str, Any] | None:
    """Best-effort parse of install_hint into mcpServers entry. None if too risky."""
    if not tool.install_hint:
        return None
    hint = tool.install_hint.strip().strip("`")
    # Common patterns:
    #   npx -y @scope/pkg --flag value
    #   uvx mcp-server-time
    #   uv tool run mcp-server-foo
    if hint.startswith(("$ ", "# ", "> ")):
        hint = hint[2:]
    try:
        parts = shlex.split(hint, posix=True)
    except ValueError:
        return None
    if not parts:
        return None
    cmd = parts[0]
    if cmd not in ALLOWED_COMMANDS:
        return None
    args = parts[1:]
    return {"command": cmd, "args": args}


def _entry_default(tool: Tool) -> dict[str, Any] | None:
    """Fallback when no install_hint: synthesize from name (npm/pypi conventions)."""
    name = tool.name or ""
    # Heuristic: scoped npm names look like "@scope/server-foo"
    if name.startswith("@") and "/" in name:
        return {"command": "npx", "args": ["-y", name]}
    # PyPI mcp-server-* convention
    if "/" not in name and "mcp-server-" in name:
        return {"command": "uvx", "args": [name]}
    return None


def _server_key(tool: Tool) -> str:
    """Deterministic key used inside mcpServers. Strip @ and / for safety."""
    base = tool.name or tool.id
    base = re.sub(r"[^a-zA-Z0-9_-]+", "-", base).strip("-").lower()
    return base[:60] or tool.id


def install(tool: Tool, *, dry_run: bool = False) -> tuple[bool, dict]:
    """Add the tool to all known MCP config files. Returns (success, diff_dict)."""
    entry = _entry_from_hint(tool) or _entry_default(tool)
    if entry is None:
        return False, {"error": "no parseable install_hint and no name-based fallback"}
    key = _server_key(tool)

    targets = discover_mcp_config_targets()
    if not targets:
        # Create a fresh ~/.claude/.mcp.json
        MCP_JSON.parent.mkdir(parents=True, exist_ok=True)
        MCP_JSON.write_text(json.dumps({"mcpServers": {}}, indent=2), encoding="utf-8")
        targets = [MCP_JSON]

    diff_per_target: dict[str, Any] = {}
    for target in targets:
        try:
            current = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {}
        except json.JSONDecodeError:
            log.warning("config %s is invalid JSON; skipping", target)
            diff_per_target[str(target)] = {"error": "invalid_json"}
            continue
        servers = current.setdefault("mcpServers", {})
        before = dict(servers.get(key, {}))
        if not dry_run:
            backup_config(target)
            servers[key] = entry
            target.write_text(json.dumps(current, indent=2), encoding="utf-8")
        diff_per_target[str(target)] = {"key": key, "before": before, "after": entry}

    write_audit("install", tool.id, strategy="native_mcp", diff=diff_per_target, dry_run=dry_run)
    if not dry_run:
        record_install(
            tool.id, strategy="native_mcp",
            target_path=", ".join(str(t) for t in targets),
            config_diff=diff_per_target,
        )
    return True, diff_per_target


def uninstall(tool: Tool) -> tuple[bool, dict]:
    """Remove the tool from MCP config files. Uses _server_key as the lookup."""
    key = _server_key(tool)
    targets = discover_mcp_config_targets()
    diff_per_target: dict[str, Any] = {}
    for target in targets:
        if not target.exists():
            continue
        try:
            current = json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        servers = current.get("mcpServers", {})
        if key in servers:
            backup_config(target)
            removed = servers.pop(key)
            target.write_text(json.dumps(current, indent=2), encoding="utf-8")
            diff_per_target[str(target)] = {"key": key, "removed": removed}
    write_audit("uninstall", tool.id, strategy="native_mcp", diff=diff_per_target)
    record_install(tool.id, strategy="native_mcp_uninstall", target_path=None, config_diff=diff_per_target)
    return True, diff_per_target
