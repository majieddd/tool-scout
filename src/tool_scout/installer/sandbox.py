"""Docker-isolated smoke test for generated wrappers (docs/01_SPEC.md §25).

The wrapper file is mounted read-only into a python:3.11-slim container with:
  --network=none           no outbound traffic possible
  --read-only --tmpfs      filesystem locked except for /tmp (32MB)
  --cap-drop=ALL           drop every Linux capability
  --memory=256m --cpus=0.5 prevent fork-bomb / cpu-thrash
  --user 1000:1000         non-root inside container

Inside the container we import-load the wrapper and assert it exposes either
`mcp` or `server` as a top-level symbol. This catches:
  - import-time errors
  - missing required symbols
  - any code that can't run without network (those would fail with no error
    surface, which is the point)

Returns (passed: bool, log: str). Log includes both stdout + stderr from the
container — useful for the operator to triage failures.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger("scout")

SANDBOX_IMAGE = "python:3.11-slim"
SMOKE_TIMEOUT_S = 60
DOCKER_WALL_TIMEOUT_S = 90


SMOKE_SCRIPT = (
    "import importlib.util,sys; "
    "spec = importlib.util.spec_from_file_location('s', 'server.py'); "
    "m = importlib.util.module_from_spec(spec); "
    "spec.loader.exec_module(m); "
    "assert hasattr(m, 'mcp') or hasattr(m, 'server'), 'wrapper must expose mcp or server'; "
    "print('SMOKE_OK')"
)


def docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        r = subprocess.run(["docker", "version", "--format", "{{.Server.Version}}"], capture_output=True, text=True, timeout=10)
        return r.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def run_smoke_test(wrapper_path: Path, *, image: str = SANDBOX_IMAGE) -> tuple[bool, str]:
    if not wrapper_path.exists():
        return False, f"wrapper file not found at {wrapper_path}"
    if not docker_available():
        return False, "docker not available — install Docker Desktop and re-run"

    with tempfile.TemporaryDirectory() as workdir:
        target = Path(workdir) / "server.py"
        target.write_bytes(wrapper_path.read_bytes())
        cmd = [
            "docker", "run", "--rm",
            "--network=none",
            "--read-only", "--tmpfs", "/tmp:size=32m",
            "--cap-drop=ALL",
            "--memory=256m", "--cpus=0.5",
            "--user", "1000:1000",
            "-v", f"{workdir}:/app:ro",
            "-w", "/app",
            image,
            "timeout", str(SMOKE_TIMEOUT_S),
            "python", "-c", SMOKE_SCRIPT,
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=DOCKER_WALL_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return False, f"docker wall-timeout after {DOCKER_WALL_TIMEOUT_S}s"
        out = (r.stdout or "") + ("\n--- stderr ---\n" + r.stderr if r.stderr else "")
        passed = (r.returncode == 0) and ("SMOKE_OK" in (r.stdout or ""))
        return passed, out
