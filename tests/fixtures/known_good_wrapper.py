#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp[cli]"]
# ///
"""
Known-good MCP wrapper used as a test fixture for Tool Scout's sandbox.

This file MUST:
  - Pass static_scan (no os.system, subprocess, eval, network calls, etc.)
  - Pass Docker sandbox smoke test (imports cleanly, exposes `mcp`, no side effects)

This file MUST NOT be modified during normal development. If you need to
update it, also update the static_scan and sandbox unit tests.
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("known-good-fixture")


@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two integers and return the result."""
    return a + b


@mcp.tool()
def greet(name: str) -> str:
    """Return a greeting for the given name."""
    return f"Hello, {name}!"


@mcp.tool()
def reverse(text: str) -> str:
    """Reverse a string."""
    return text[::-1]


if __name__ == "__main__":
    mcp.run()
