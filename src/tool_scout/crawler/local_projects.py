"""Local-projects crawler — walks Majied's project folders for indicator files.

Per config/sources.yaml `local_projects.indicators`:
  - SKILL.md         → an Anthropic-style skill
  - plugin.json      → a Claude Code plugin
  - mcp.json         → an MCP server config
  - .claude/plugins  → a directory marker for plugin installs

Each match becomes one ToolRecord with source="local-personal". Path is the
URL (file:/// scheme is not used — raw absolute path is the unique key).
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from tool_scout.crawler.record import ToolRecord
from tool_scout.util.time_budget import TimeBudget

log = logging.getLogger("crawl")


def _read_skill_frontmatter(path: Path) -> tuple[str | None, str | None]:
    """Return (name, description) from SKILL.md YAML front matter."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None, None
    if not text.startswith("---"):
        return None, None
    try:
        # Hand-parse the limited subset we expect (name:, description:).
        end = text.find("\n---", 4)
        if end == -1:
            return None, None
        block = text[4:end]
        name = description = None
        for line in block.splitlines():
            ls = line.strip()
            if ls.startswith("name:"):
                name = ls[len("name:") :].strip().strip("\"'")
            elif ls.startswith("description:"):
                description = ls[len("description:") :].strip().strip("\"'")
        return name, description
    except Exception:  # noqa: BLE001
        return None, None


def _read_plugin_json(path: Path) -> tuple[str | None, str | None]:
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, None
    return body.get("name"), body.get("description")


def _read_mcp_json(path: Path) -> tuple[str | None, str | None]:
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, None
    # mcp.json conventions vary; pick the first plausible entry.
    if isinstance(body, dict):
        if "name" in body:
            return body.get("name"), body.get("description")
        servers = body.get("mcpServers") or body.get("mcp_servers") or {}
        if isinstance(servers, dict) and servers:
            first_key = next(iter(servers))
            return first_key, f"mcp server: {first_key}"
    return None, None


def _readme_excerpt(dir_path: Path) -> str | None:
    for cand in ("README.md", "Readme.md", "readme.md", "README.txt"):
        p = dir_path / cand
        if p.exists():
            try:
                return p.read_text(encoding="utf-8", errors="replace")[:2000]
            except OSError:
                pass
    return None


def _walk(root: Path, indicators: list[str], max_depth: int):
    """Yield (dir_path, indicator_filename) for each match found within max_depth."""
    root = Path(root)
    if not root.exists():
        return
    root_str = str(root)
    base_depth = root_str.count(os.sep)
    for dirpath, dirnames, filenames in os.walk(root):
        # Skip noisy dirs early
        dirnames[:] = [d for d in dirnames if d not in (
            "node_modules", ".git", ".venv", "venv", "__pycache__",
            "dist", "build", ".next", "target", ".idea", ".vscode",
        )]
        cur_depth = dirpath.count(os.sep) - base_depth
        if cur_depth > max_depth:
            dirnames[:] = []
            continue
        # Detect indicator files in this directory
        cur = Path(dirpath)
        for ind in indicators:
            if "/" in ind or "\\" in ind:
                # directory-style indicator like ".claude/plugins"
                if (cur / ind).exists():
                    yield cur, ind
            else:
                if (cur / ind).exists():
                    yield cur, ind


def crawl_local_projects(
    config_block: dict[str, Any],
    budget: TimeBudget,
) -> list[ToolRecord]:
    if not config_block.get("enabled", False):
        return []
    indicators = list(config_block.get("indicators") or [])
    roots = list(config_block.get("roots") or [])
    max_depth = int(config_block.get("max_depth") or 4)
    budget_s = float(config_block.get("budget_min", 2)) * 60

    records: list[ToolRecord] = []
    seen_paths: set[str] = set()
    t0 = time.monotonic()

    for root in roots:
        if budget.expired() or (time.monotonic() - t0) > budget_s:
            log.info("local_projects: budget reached, stopping at root %s", root)
            break
        rp = Path(root)
        if not rp.exists():
            log.info("local_projects: root not found %s — skipping", root)
            continue

        for dir_path, indicator in _walk(rp, indicators, max_depth):
            key = str(dir_path)
            if key in seen_paths:
                continue
            seen_paths.add(key)

            name = description = None
            compat = None
            if indicator == "SKILL.md":
                name, description = _read_skill_frontmatter(dir_path / "SKILL.md")
                compat = "native_claude_code"
            elif indicator == "plugin.json":
                name, description = _read_plugin_json(dir_path / "plugin.json")
                compat = "native_claude_code"
            elif indicator == "mcp.json":
                name, description = _read_mcp_json(dir_path / "mcp.json")
                compat = "mcp_ready"

            if not name:
                # Fall back to the directory name
                name = dir_path.name

            try:
                last_modified = datetime.fromtimestamp(dir_path.stat().st_mtime)
            except OSError:
                last_modified = None

            rec = ToolRecord(
                name=name,
                url=str(dir_path),
                source="local-personal",
                description=description or f"{indicator} found at {dir_path.name}",
                readme_excerpt=_readme_excerpt(dir_path),
                last_updated=last_modified,
                compatibility=compat,
                tags=["local", indicator.split(".")[0]],
            )
            records.append(rec)

    spent = time.monotonic() - t0
    budget.consume("local_projects", spent)
    log.info("local_projects: %d records from %d roots in %.1fs", len(records), len(roots), spent)
    return records
