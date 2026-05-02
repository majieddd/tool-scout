"""Phase 1 smoke tests — imports + CLI registration.

These are deliberately tiny; per-module behavior tests land in their phase.
"""
from __future__ import annotations


def test_imports():
    """Every src/tool_scout module imports cleanly."""
    import tool_scout.cli  # noqa: F401
    import tool_scout.db  # noqa: F401
    import tool_scout.llm_client  # noqa: F401
    import tool_scout.models  # noqa: F401
    import tool_scout.operations.doctor  # noqa: F401
    import tool_scout.usage_tracker  # noqa: F401
    import tool_scout.util.logging  # noqa: F401


def test_cli_registers_doctor():
    from tool_scout.cli import app

    # Typer's CommandInfo.name is None when registered via @app.command() with
    # no explicit name; the actual command name comes from callback.__name__.
    cmd_names = {(c.name or (c.callback.__name__ if c.callback else "")) for c in app.registered_commands}
    assert "doctor" in cmd_names
    assert "crawl" in cmd_names
    assert "usage" in cmd_names


def test_models_metadata_has_all_tables():
    """Every spec table is registered on Base.metadata."""
    from tool_scout.db import Base
    import tool_scout.models  # noqa: F401  (triggers registration)

    expected = {
        "tools",
        "tags",
        "grades",
        "crawl_runs",
        "recommendations",
        "installs",
        "user_overrides",
        "wrapper_requests",
        "rate_limits",
        "usage_log",
        "backup_log",
        "orchestrator_events",
    }
    assert expected.issubset(set(Base.metadata.tables.keys()))
