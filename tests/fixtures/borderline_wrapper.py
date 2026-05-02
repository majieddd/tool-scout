#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Borderline test fixture for Tool Scout's Docker sandbox.

This file MUST:
  - Pass static_scan (no forbidden patterns — there are none here)
  - FAIL the Docker sandbox smoke test because it does not expose `mcp` or
    `server` as a top-level symbol

The smoke test does:
    spec = importlib.util.spec_from_file_location('s', 'server.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert hasattr(m, 'mcp') or hasattr(m, 'server')

This file imports cleanly but the assertion fails. That's the test scenario:
"Claude generated something syntactically clean and not malicious, but it's
not actually an MCP server."
"""


def add(a: int, b: int) -> int:
    """A function that exists, but is not registered with any MCP server."""
    return a + b


def greet(name: str) -> str:
    """Same — just a free function, not exposed via MCP."""
    return f"Hello, {name}"


# Note: no `mcp` or `server` top-level symbol. The smoke test asserts the
# generated wrapper is actually an MCP server, not just any Python file.

if __name__ == "__main__":
    print("This is not an MCP server.")
