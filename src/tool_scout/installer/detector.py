"""Detect which install strategy applies to a given Tool.

Strategies (spec §23):
  A. native_mcp     — tool is an MCP server (compatibility=mcp_ready)
  B. claude_plugin  — Claude Code plugin (.claude/plugins/, plugin.json)
  C. skill          — SKILL.md skill (compatibility=native_claude_code AND
                                       category=skill OR has skill tag)
  D. wrapper_gen    — useful tool/library that needs a generated MCP wrapper
                       (Phase 8 — NOT implemented at Phase 6)

Returns one of: "native_mcp" | "plugin" | "skill" | "wrapper" | "unsupported"
"""
from __future__ import annotations

from tool_scout.models import Tool


def detect_strategy(tool: Tool) -> str:
    cat = (tool.category or "").lower()
    compat = (tool.compatibility or "").lower()
    tags = {t.tag.lower() for t in (tool.tags or [])}

    if cat == "skill" or compat == "native_claude_code" and "skill" in tags:
        return "skill"
    if cat == "claude_plugin" or "claude-plugin" in tags or "plugin.json" in tags:
        return "plugin"
    if cat == "mcp_server" or compat == "mcp_ready":
        return "native_mcp"
    if compat == "needs_wrapper":
        return "wrapper"
    return "unsupported"
