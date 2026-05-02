"""scout doctor — comprehensive environment + credential check.

Shows a green/yellow/red table with one row per check. Returns True iff
no red rows. Yellow rows (e.g., GIT_BOT_TOKEN missing during dev) don't fail.

Adapted from docs/01_SPEC.md §62 step 7 with these substitutions for the
Gemma backend pivot:
  - DROP `claude --version` as a hard requirement; informational only.
  - ADD `ollama --version` + Ollama HTTP ping + LLM_MODEL availability.

Reads .env via python-dotenv (loaded by cli.py before this is called).
"""
from __future__ import annotations

import os
import secrets
import shutil
import socket
import subprocess
from pathlib import Path
from typing import Callable

import httpx
from rich.console import Console
from rich.table import Table

from tool_scout.db import db_path
from tool_scout.llm_client import LlmClient

console = Console()

CheckResult = tuple[str, str, str]  # (status, name, message)
GREEN = "[green]✓[/green]"
YELLOW = "[yellow]![/yellow]"
RED = "[red]✗[/red]"


# ---- individual checks ----------------------------------------------------
def _check_python() -> CheckResult:
    import sys

    v = sys.version_info
    if v >= (3, 11):
        return GREEN, "python", f"{v.major}.{v.minor}.{v.micro}"
    return RED, "python", f"need >= 3.11; have {v.major}.{v.minor}"


def _on_path(name: str) -> str | None:
    return shutil.which(name)


def _exec_version(cmd: list[str], min_token: str | None = None) -> CheckResult:
    name = cmd[0]
    found = _on_path(name)
    if not found:
        return RED, name, "not on PATH"
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    except (subprocess.SubprocessError, OSError) as e:
        return RED, name, f"failed: {e}"
    out = (r.stdout + r.stderr).strip().splitlines()
    line = out[0] if out else ""
    return GREEN, name, line[:80]


def _check_pwsh() -> CheckResult:
    return _exec_version(["pwsh", "--version"])


def _check_git() -> CheckResult:
    return _exec_version(["git", "--version"])


def _check_node() -> CheckResult:
    return _exec_version(["node", "--version"])


def _check_ngrok() -> CheckResult:
    return _exec_version(["ngrok", "version"])


def _check_nssm() -> CheckResult:
    found = _on_path("nssm")
    if not found:
        return YELLOW, "nssm", "not on PATH (needed for Phase 11 service install)"
    return GREEN, "nssm", "available"


def _check_docker() -> CheckResult:
    found = _on_path("docker")
    if not found:
        return RED, "docker", "not installed (REQUIRED for Phase 8 sandbox; install Docker Desktop)"
    try:
        r = subprocess.run(["docker", "version", "--format", "{{.Server.Version}}"], capture_output=True, text=True, timeout=10)
    except (subprocess.SubprocessError, OSError) as e:
        return RED, "docker", f"daemon unreachable: {e}"
    if r.returncode != 0:
        return RED, "docker", "daemon not running (start Docker Desktop)"
    return GREEN, "docker", f"server {r.stdout.strip()}"


def _check_claude_informational() -> CheckResult:
    if not _on_path("claude"):
        return YELLOW, "claude", "not on PATH (informational; Tool Scout uses local Gemma)"
    return GREEN, "claude", "available (informational; not used as backend)"


def _check_ollama_running() -> CheckResult:
    if not _on_path("ollama"):
        return RED, "ollama", "not installed (REQUIRED — Tool Scout's LLM backend)"
    cli = LlmClient()
    if not cli.ping():
        return RED, "ollama", f"daemon unreachable at {cli.host} (start with: ollama serve)"
    return GREEN, "ollama", f"reachable at {cli.host}"


def _check_llm_model() -> CheckResult:
    cli = LlmClient()
    if not cli.ping():
        return YELLOW, "llm-model", f"skipped (ollama unreachable at {cli.host})"
    if not cli.model_available():
        return RED, "llm-model", f"{cli.model} not pulled (run: ollama pull {cli.model})"
    return GREEN, "llm-model", f"{cli.model} available"


def _check_data_dir() -> CheckResult:
    p = Path.home() / ".tool-scout"
    for sub in ("cache", "logs", "backups", "workspaces"):
        (p / sub).mkdir(parents=True, exist_ok=True)
    return GREEN, "~/.tool-scout/", str(p)


def _check_db() -> CheckResult:
    p = db_path()
    if not p.exists():
        return YELLOW, "scout.db", f"missing at {p} (run: alembic upgrade head)"
    # Verify alembic head
    try:
        from sqlalchemy import text
        from tool_scout.db import engine

        with engine.connect() as conn:
            head = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        if head is None:
            return RED, "scout.db", "no alembic_version row"
        return GREEN, "scout.db", f"present, alembic head {head}"
    except Exception as e:
        return RED, "scout.db", f"unreadable: {type(e).__name__}: {e}"


def _check_alembic_head() -> CheckResult:
    if not _on_path("alembic"):
        return YELLOW, "alembic", "not on PATH (`pip install -e .` not run yet?)"
    try:
        r = subprocess.run(["alembic", "current"], capture_output=True, text=True, timeout=15, cwd=str(Path(__file__).resolve().parents[3]))
    except (subprocess.SubprocessError, OSError) as e:
        return RED, "alembic", f"failed: {e}"
    if r.returncode != 0:
        return RED, "alembic", (r.stderr or r.stdout).strip().splitlines()[-1][:80]
    out = r.stdout.strip().splitlines()
    return GREEN, "alembic", out[-1] if out else "current=?"


def _check_env_var(name: str, *, required: bool = True, hint: str = "") -> CheckResult:
    v = os.environ.get(name)
    if v:
        # Don't echo secrets
        return GREEN, name, "set"
    return (RED if required else YELLOW), name, f"not set{(' — ' + hint) if hint else ''}"


def _check_github_token() -> CheckResult:
    v = os.environ.get("GITHUB_TOKEN")
    if not v:
        # Try gh CLI fallback
        gh = _on_path("gh")
        if gh:
            try:
                r = subprocess.run([gh, "auth", "token"], capture_output=True, text=True, timeout=10)
                if r.returncode == 0 and r.stdout.strip():
                    v = r.stdout.strip()
            except (subprocess.SubprocessError, OSError):
                pass
    if not v:
        return YELLOW, "github-token", "no GITHUB_TOKEN; gh CLI fallback also missing (crawler will hit anon rate limits)"
    try:
        r = httpx.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {v}", "User-Agent": "tool-scout-doctor"},
            timeout=10,
        )
    except httpx.HTTPError as e:
        return RED, "github-token", f"GitHub API unreachable: {type(e).__name__}"
    if r.status_code == 200:
        login = r.json().get("login", "?")
        return GREEN, "github-token", f"valid (user: {login})"
    return RED, "github-token", f"GitHub returned {r.status_code}"


def _check_webhook_secret(write_back: bool = True) -> CheckResult:
    v = os.environ.get("WEBHOOK_SHARED_SECRET")
    if v:
        return GREEN, "webhook-secret", "set"
    if write_back:
        new = secrets.token_hex(32)
        env_path = Path(__file__).resolve().parents[3] / ".env"
        if env_path.exists():
            content = env_path.read_text(encoding="utf-8")
            if "WEBHOOK_SHARED_SECRET=" in content:
                content = content.replace(
                    "WEBHOOK_SHARED_SECRET=", f"WEBHOOK_SHARED_SECRET={new}", 1
                )
            else:
                content += f"\nWEBHOOK_SHARED_SECRET={new}\n"
            env_path.write_text(content, encoding="utf-8")
            os.environ["WEBHOOK_SHARED_SECRET"] = new
            return GREEN, "webhook-secret", "generated + saved to .env"
    return YELLOW, "webhook-secret", "missing; will be generated on first scout doctor with .env present"


def _check_gcp_creds() -> CheckResult:
    p_str = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PATH")
    if not p_str:
        return YELLOW, "gcp-creds", "GOOGLE_SERVICE_ACCOUNT_PATH not set"
    p = Path(p_str)
    if not p.exists():
        return RED, "gcp-creds", f"file not found at {p}"
    try:
        import json

        body = json.loads(p.read_text(encoding="utf-8"))
        email = body.get("client_email", "")
        if not email.endswith(".gserviceaccount.com"):
            return RED, "gcp-creds", "client_email looks wrong"
        return GREEN, "gcp-creds", f"valid service account {email[:40]}..."
    except Exception as e:
        return RED, "gcp-creds", f"parse failed: {e}"


def _check_drive_folder_id() -> CheckResult:
    v = os.environ.get("GOOGLE_DRIVE_FOLDER_ID")
    if not v:
        return YELLOW, "drive-folder", "GOOGLE_DRIVE_FOLDER_ID not set (Phase 7)"
    return GREEN, "drive-folder", f"set ({v[:20]}...)"


def _check_recaptcha() -> CheckResult:
    site = os.environ.get("RECAPTCHA_SITE_KEY")
    secret = os.environ.get("RECAPTCHA_SECRET_KEY")
    if not site or not secret:
        return YELLOW, "recaptcha", "keys not set (needed for Phase 10 web app)"
    return GREEN, "recaptcha", "site + secret keys present"


def _check_ports_free() -> CheckResult:
    """Webhook on 8765 + orchestrator status on 8766."""
    busy: list[int] = []
    for port in (8765, 8766):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                busy.append(port)
    if busy:
        return YELLOW, "ports", f"already bound: {busy} (orchestrator/webhook will fail)"
    return GREEN, "ports", "8765 + 8766 free"


# ---- runner --------------------------------------------------------------
CHECKS: list[Callable[[], CheckResult]] = [
    _check_python,
    _check_pwsh,
    _check_git,
    _check_node,
    _check_ngrok,
    _check_nssm,
    _check_docker,
    _check_claude_informational,
    _check_ollama_running,
    _check_llm_model,
    _check_data_dir,
    _check_db,
    _check_alembic_head,
    _check_github_token,
    _check_webhook_secret,
    _check_gcp_creds,
    _check_drive_folder_id,
    _check_recaptcha,
    _check_ports_free,
]


def run_doctor() -> bool:
    """Run all checks, print a table, return True iff no red rows."""
    table = Table(title="scout doctor", show_lines=False, header_style="bold")
    table.add_column(" ", width=2)
    table.add_column("check", style="cyan")
    table.add_column("info", style="white")

    red = 0
    yellow = 0
    for fn in CHECKS:
        try:
            status, name, msg = fn()
        except Exception as e:
            status, name, msg = RED, fn.__name__, f"check raised: {type(e).__name__}: {e}"
        table.add_row(status, name, msg)
        if "✗" in status:
            red += 1
        elif "!" in status:
            yellow += 1

    console.print(table)
    if red:
        console.print(f"[red]{red} hard failure(s)[/red]; {yellow} warning(s).")
        return False
    if yellow:
        console.print(f"[yellow]{yellow} warning(s)[/yellow] — non-blocking, but address before launch.")
    else:
        console.print("[green]all green[/green]")
    return True
