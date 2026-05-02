"""Heuristic classifier — tier 1 of the two-tier pipeline (docs/01_SPEC.md §15).

6 ordered rules. First match wins. Returns ClassifyResult or None (defer to LLM)
or DeadFlag (skip — empty/abandoned).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Union


MCP_NAME_HINTS = ("mcp-server", "mcp_server", "-mcp", "mcp-")
PLUGIN_NAME_HINTS = ("claude-plugin", "claude-code-plugin")
SKILL_NAME_HINTS = ("anthropic-skill", "claude-skill", "-skill")


@dataclass
class ClassifyResult:
    category: str
    subcategory: str
    compatibility: str
    tags: list[str] = field(default_factory=list)
    install_hint: Optional[str] = None
    confidence: float = 0.0
    source: str = "heuristics"   # vs "gemma"


@dataclass
class DeadFlag:
    """Sentinel — skip classify, mark dead=1."""
    reason: str = "empty_or_short_readme"


def _norm_tags(record: dict) -> set[str]:
    return {t.lower() for t in (record.get("tags") or []) if isinstance(t, str)}


def _norm_text(record: dict, *fields: str) -> str:
    chunks = []
    for f in fields:
        v = record.get(f)
        if isinstance(v, str):
            chunks.append(v.lower())
    return " ".join(chunks)


def classify_one(record: dict) -> Optional[Union[ClassifyResult, DeadFlag]]:
    """Apply 6-rule heuristic. Returns:
    - ClassifyResult on hit (any rule 1-4)
    - DeadFlag on rule 5 (skip + mark dead)
    - None on rule 6 (defer to LLM)
    """
    tags = _norm_tags(record)
    name = (record.get("name") or "").lower()
    url = (record.get("url") or "").lower()
    desc = _norm_text(record, "description")
    readme = (record.get("readme_excerpt") or "")
    readme_lc = readme.lower()
    compat = (record.get("compatibility") or "").lower()

    # ---- Rule 1: MCP server ---------------------------------------------
    mcp_topic_hit = any(t in tags for t in ("mcp-server", "mcp_server", "mcp"))
    mcp_url_hit = "modelcontextprotocol" in url or "/mcp" in url
    mcp_name_hit = any(h in name for h in MCP_NAME_HINTS)
    mcp_text_hit = "mcp server" in desc or "mcp server" in readme_lc
    if mcp_topic_hit or mcp_url_hit or mcp_name_hit or mcp_text_hit or compat == "mcp_ready":
        sub = "filesystem" if "filesystem" in name or "filesystem" in desc else (
            "search" if "search" in desc or "search" in name else
            "database" if any(k in (desc + name) for k in ("postgres", "sqlite", "mysql", "database")) else
            "general"
        )
        return ClassifyResult(
            category="mcp_server",
            subcategory=sub,
            compatibility="mcp_ready",
            tags=sorted({*tags, "mcp", "mcp-server"})[:8],
            install_hint=_extract_install_hint(readme),
            confidence=0.95,
        )

    # ---- Rule 2: SKILL (anthropic-skill style) --------------------------
    skill_topic_hit = any(t in tags for t in ("anthropic-skill", "claude-skill", "skill"))
    skill_name_hit = any(h in name for h in SKILL_NAME_HINTS)
    skill_compat_hit = compat == "native_claude_code" and "skill" in tags
    if skill_topic_hit or skill_name_hit or skill_compat_hit:
        return ClassifyResult(
            category="skill",
            subcategory="general",
            compatibility="native_claude_code",
            tags=sorted({*tags, "anthropic-skill"})[:8],
            install_hint=_extract_install_hint(readme),
            confidence=0.95,
        )

    # ---- Rule 3: claude plugin ------------------------------------------
    plugin_topic_hit = any(t in tags for t in ("claude-plugin", "claude-code", "claude-code-plugin"))
    plugin_name_hit = any(h in name for h in PLUGIN_NAME_HINTS)
    plugin_url_hit = "/.claude/plugins/" in url
    if plugin_topic_hit or plugin_name_hit or plugin_url_hit:
        # Distinguish slash-command vs hook vs full plugin
        sub = "slash_command" if "slash" in readme_lc or "slash" in desc else (
            "hook" if "hook" in readme_lc else "general"
        )
        return ClassifyResult(
            category="claude_plugin",
            subcategory=sub,
            compatibility="native_claude_code",
            tags=sorted({*tags, "claude-plugin", "claude-code"})[:8],
            install_hint=_extract_install_hint(readme),
            confidence=0.95,
        )

    # ---- Rule 4: harness (agent framework) ------------------------------
    harness_words = ("agent loop", "agentic framework", "agent harness", "coding agent", "autonomous agent")
    harness_text_hit = any(w in readme_lc or w in desc for w in harness_words)
    if harness_text_hit and not mcp_topic_hit and "mcp" not in readme_lc:
        return ClassifyResult(
            category="harness",
            subcategory="general",
            compatibility="needs_wrapper",
            tags=sorted({*tags, "harness", "agentic"})[:8],
            install_hint=_extract_install_hint(readme),
            confidence=0.80,
        )

    # ---- Rule 5: dead --------------------------------------------------
    # Only fires when we *have* a readme and it's clearly thin.
    # Records without readme_excerpt are deferred (rule 6) — we don't know yet.
    if readme and len(readme.strip()) < 200:
        return DeadFlag(reason="short_readme")

    # ---- Rule 6: defer to LLM ------------------------------------------
    return None


def _extract_install_hint(readme: str) -> Optional[str]:
    """Pull the first install-looking line from the README excerpt, if any."""
    if not readme:
        return None
    install_keywords = ("npm install", "pip install", "pipx install", "uv tool install", "npx", "git clone")
    for line in readme.splitlines():
        s = line.strip()
        if any(k in s.lower() for k in install_keywords):
            # Cap to one line, scrub the inevitable backticks
            return s.strip("`").strip()[:200]
    return None
