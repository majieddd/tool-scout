# Wrapper-gen prompt (reference only)

> **Note:** The live version of this prompt is the **body of `WORKFLOW.md`** at
> the repo root. The orchestrator (Phase 11) reads it from there with hot-reload
> support. This file is a pre-Phase-11 reference and a fallback for the
> standalone Strategy D installer in Phase 8.

---

You are generating a minimal MCP server that wraps an existing tool so it can be used from Claude Code.

## Tool to wrap

- Name: {name}
- URL: {url}
- Description: {description}
- README excerpt:
{readme}
- CLI help output:
{help_output}

## Hard requirements

1. Use the official Python MCP SDK (`mcp[cli]`).
2. Expose 1-5 of the most useful operations as MCP tools.
3. Windows-compatible: never use `/tmp`, never use `shell=True` without escaping.
4. Self-contained in a single `server.py` file.
5. Start with `#!/usr/bin/env -S uv run --script`
6. Include a PEP 723 inline dependency block for uv at the top.
7. Expose either `mcp` or `server` as a top-level symbol — the smoke test imports
   the file and asserts this. No side effects at import time.

## Forbidden — your output WILL be rejected if any of these appear

- `os.system`, `subprocess.run/Popen/call/check_output`, `eval`, `exec`, `__import__`
- `socket`, `urllib`, `requests`, any other network call
- File writes outside a `tmp_path` parameter passed into individual tools

## Output

Output ONLY the complete Python file contents. No prose. No markdown fences. No commentary.
