"""Discover Claude config paths on the local system.

On Windows, the relevant locations are:
  - ~/.claude/.mcp.json                 (Claude Code native MCP config)
  - ~/.claude/skills/<id>/              (skills)
  - ~/.claude/plugins/<id>/             (plugins)
  - %APPDATA%/Claude/claude_desktop_config.json (Claude Desktop, if installed)

Each path may not exist. install operations create directories as needed.
"""
from __future__ import annotations

import os
from pathlib import Path

CLAUDE_HOME = Path.home() / ".claude"
MCP_JSON = CLAUDE_HOME / ".mcp.json"
SKILLS_DIR = CLAUDE_HOME / "skills"
PLUGINS_DIR = CLAUDE_HOME / "plugins"
AGENTS_DIR = CLAUDE_HOME / "agents"

# Claude Desktop (separate install)
APPDATA = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
CLAUDE_DESKTOP_CFG = APPDATA / "Claude" / "claude_desktop_config.json"

# Tool-scout's own backup dir
BACKUPS_DIR = Path.home() / ".tool-scout" / "backups" / "configs"
INSTALLED_LIST = Path.home() / ".tool-scout" / "installed.jsonl"
AUDIT_LOG = Path.home() / ".tool-scout" / "audit.log"


def ensure_data_dirs() -> None:
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    INSTALLED_LIST.parent.mkdir(parents=True, exist_ok=True)


def discover_mcp_config_targets() -> list[Path]:
    """Return all MCP-config files we should keep in sync. Empty list -> none exist yet."""
    out: list[Path] = []
    if MCP_JSON.exists() or CLAUDE_HOME.exists():
        out.append(MCP_JSON)
    if CLAUDE_DESKTOP_CFG.exists():
        out.append(CLAUDE_DESKTOP_CFG)
    return out
