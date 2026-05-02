"""WorkflowConfig + Liquid template + tracker basic tests."""
from __future__ import annotations

from pathlib import Path

import pytest

from tool_scout.queue_worker.workflow_config import WorkflowConfig, load_workflow
from tool_scout.queue_worker.template import render_workflow_prompt


def test_load_real_workflow_md():
    """The real starter WORKFLOW.md should parse cleanly."""
    repo_root = Path(__file__).parent.parent
    cfg = load_workflow(repo_root / "WORKFLOW.md")
    assert isinstance(cfg, WorkflowConfig)
    assert cfg.polling.tick_interval_ms > 0
    assert cfg.agent.max_turns >= 1
    assert "MCP server" in cfg.prompt_body or "mcp" in cfg.prompt_body.lower()


def test_load_missing_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_workflow(tmp_path / "does_not_exist.md")


def test_load_no_frontmatter_raises(tmp_path):
    p = tmp_path / "WORKFLOW.md"
    p.write_text("just a body, no frontmatter\n", encoding="utf-8")
    with pytest.raises(ValueError, match="missing YAML"):
        load_workflow(p)


def test_render_prompt_substitutes_tool_fields():
    body = "Tool: {{ tool.name }} at {{ tool.url }}. Turn {{ turn_number }}."
    out = render_workflow_prompt(body, tool={"id": "x", "name": "demo", "url": "https://x"}, turn_number=1)
    assert "demo" in out
    assert "https://x" in out
    assert "Turn 1" in out


def test_render_prompt_continuation_branch():
    body = (
        "{% if turn_number > 1 %}retry: {{ previous_failure_reason }}"
        "{% else %}first attempt{% endif %}"
    )
    first = render_workflow_prompt(body, tool={"id": "x", "name": "n", "url": "u"}, turn_number=1)
    second = render_workflow_prompt(
        body, tool={"id": "x", "name": "n", "url": "u"}, turn_number=2, previous_failure_reason="smoke_test_failed"
    )
    assert first.strip() == "first attempt"
    assert "smoke_test_failed" in second
