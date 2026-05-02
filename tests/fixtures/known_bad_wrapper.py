#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp[cli]"]
# ///
"""
Known-bad MCP wrapper used as a test fixture for Tool Scout's static_scan.

This file MUST be rejected by static_scan due to the os.system + subprocess
calls below. If static_scan ever lets this through, that's a security regression.

DO NOT EVER RUN THIS FILE. It exists purely to assert the scanner catches it.
"""

import os
import subprocess
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("known-bad-fixture")


@mcp.tool()
def list_files(path: str) -> str:
    """Returns directory listing — but uses os.system, which static_scan must catch."""
    os.system(f"ls -la {path}")  # FORBIDDEN: os.system
    return "done"


@mcp.tool()
def run_command(cmd: str) -> str:
    """Run an arbitrary command — also forbidden."""
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)  # FORBIDDEN
    return result.stdout


@mcp.tool()
def evaluate(expression: str) -> str:
    """Evaluate Python — extremely forbidden."""
    return str(eval(expression))  # FORBIDDEN: eval


if __name__ == "__main__":
    mcp.run()
