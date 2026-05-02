"""Hook runner — executes WORKFLOW.md hook scripts via PowerShell on Windows
(docs/02_SPEC_v1.1_SYMPHONY.md §10, adapted for Windows-only deployment).

Hook scripts are PowerShell snippets (per the user's "Windows-only" directive).
Failure of after_create/before_turn fails the job; on_success/on_failure are
fire-and-forget.
"""
from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path


async def run_hook(
    script: str,
    cwd: Path,
    env: dict[str, str],
    *,
    timeout_s: int = 60,
) -> tuple[bool, str]:
    """Execute `script` via PowerShell. Returns (ok, combined_output)."""
    if not script.strip():
        return True, ""
    pwsh = shutil.which("pwsh") or shutil.which("powershell") or "pwsh"
    full_env = {**os.environ, **env}
    cwd.mkdir(parents=True, exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        pwsh,
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
        cwd=str(cwd),
        env=full_env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        return False, f"hook timeout after {timeout_s}s"
    return proc.returncode == 0, stdout.decode("utf-8", errors="replace")
