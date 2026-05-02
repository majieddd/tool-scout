"""Tests for the heuristic classifier — verify each of the 6 rules in spec §15."""
from __future__ import annotations

from tool_scout.classifier.heuristics import (
    ClassifyResult,
    DeadFlag,
    classify_one,
)


def test_rule1_mcp_server_via_topic():
    rec = {
        "id": "x",
        "name": "filesystem",
        "url": "https://github.com/foo/filesystem",
        "tags": ["mcp-server", "filesystem"],
        "readme_excerpt": "An MCP server for the filesystem.",
    }
    out = classify_one(rec)
    assert isinstance(out, ClassifyResult)
    assert out.category == "mcp_server"
    assert out.compatibility == "mcp_ready"
    assert out.confidence >= 0.9


def test_rule1_mcp_server_via_url():
    rec = {
        "id": "x",
        "name": "filesystem",
        "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
        "tags": [],
        "readme_excerpt": "Filesystem server",
    }
    out = classify_one(rec)
    assert isinstance(out, ClassifyResult)
    assert out.category == "mcp_server"


def test_rule2_skill_via_topic():
    rec = {
        "id": "x",
        "name": "rust-async-patterns",
        "url": "https://github.com/foo/skills-rust-async",
        "tags": ["anthropic-skill", "rust"],
        "readme_excerpt": "A Claude Code SKILL.md…",
    }
    out = classify_one(rec)
    assert isinstance(out, ClassifyResult)
    assert out.category == "skill"
    assert out.compatibility == "native_claude_code"


def test_rule3_claude_plugin_via_topic():
    rec = {
        "id": "x",
        "name": "claude-code-pr-reviewer",
        "url": "https://github.com/foo/claude-code-pr-reviewer",
        "tags": ["claude-plugin", "code-review"],
        "readme_excerpt": "Slash commands for PR review",
        "description": "A Claude Code plugin",
    }
    out = classify_one(rec)
    assert isinstance(out, ClassifyResult)
    assert out.category == "claude_plugin"
    assert out.subcategory in ("slash_command", "general")


def test_rule4_harness_text_match():
    rec = {
        "id": "x",
        "name": "aider",
        "url": "https://github.com/foo/aider",
        "tags": [],
        "readme_excerpt": "Aider is a coding agent harness with a multi-step agent loop.",
    }
    out = classify_one(rec)
    assert isinstance(out, ClassifyResult)
    assert out.category == "harness"


def test_rule5_dead_short_readme():
    rec = {
        "id": "x",
        "name": "abandoned",
        "url": "https://github.com/foo/abandoned",
        "tags": [],
        "readme_excerpt": "TODO",
    }
    out = classify_one(rec)
    assert isinstance(out, DeadFlag)


def test_rule6_defers_unknown():
    rec = {
        "id": "x",
        "name": "some-random-cli",
        "url": "https://github.com/foo/some-random-cli",
        "tags": ["cli"],
        # readme_excerpt None → "we don't know yet, defer"
    }
    out = classify_one(rec)
    assert out is None  # defer


def test_rule6_defers_when_readme_missing_even_if_short_desc():
    rec = {
        "id": "x",
        "name": "no-readme-yet",
        "url": "https://github.com/foo/no-readme",
        "tags": [],
        "description": "short",
        # no readme_excerpt at all
    }
    out = classify_one(rec)
    assert out is None  # rule 5 only triggers when readme is present-but-short
