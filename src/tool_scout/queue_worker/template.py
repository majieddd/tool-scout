"""Liquid prompt rendering (docs/02_SPEC_v1.1_SYMPHONY.md §9).

Strict mode — unknown variables/filters fail loudly so prompt typos surface
immediately instead of silently rendering the wrong text.
"""
from __future__ import annotations

from typing import Any

try:
    from liquid import Environment, StrictUndefined  # type: ignore
    _env: Any = Environment(undefined=StrictUndefined)
except ImportError:
    _env = None


def render_workflow_prompt(
    template_body: str,
    *,
    tool: Any,
    turn_number: int,
    previous_failure_reason: str | None = None,
) -> str:
    """Render the WORKFLOW.md body with the per-job context.

    `tool` is duck-typed: must have name/url/category/description/readme_excerpt
    attributes (or be a dict — we tolerate both).
    """
    if _env is None:
        raise RuntimeError("python-liquid not installed; pip install python-liquid")
    if isinstance(tool, dict):
        td = tool
    else:
        td = {
            "id": getattr(tool, "id", ""),
            "name": getattr(tool, "name", ""),
            "url": getattr(tool, "url", ""),
            "category": getattr(tool, "category", "") or "",
            "description": getattr(tool, "description", "") or "",
            "readme_excerpt": getattr(tool, "readme_excerpt", "") or "",
            "help_output": getattr(tool, "help_output", None),
        }
    template = _env.from_string(template_body)
    return template.render(
        tool=td,
        turn_number=turn_number,
        previous_failure_reason=previous_failure_reason,
    )
