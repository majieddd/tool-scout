"""Typer entry point for the `scout` CLI (docs/01_SPEC.md §56).

Phase 1 only wires the skeleton — most subcommands stub-print "not yet
implemented" and exit non-zero so accidental production use fails loudly.
Implementations land per their respective phase.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

# Force UTF-8 on Windows console so Rich's checkmarks (✓✗) don't crash with
# the cp1252 codec. Must run before any rich.console.Console import touches stdout.
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        pass

import typer
from rich.console import Console

from dotenv import load_dotenv

# Load .env before anything else; envvars are widely consumed.
_dotenv = Path(__file__).resolve().parent.parent.parent / ".env"
if _dotenv.exists():
    load_dotenv(_dotenv)

app = typer.Typer(
    no_args_is_help=True,
    help="Tool Scout — discovery + wrapper-gen catalog for Claude-compatible developer tools.",
    pretty_exceptions_show_locals=False,
)

console = Console()


def _not_yet(name: str, phase: int) -> None:
    console.print(f"[yellow]{name}[/yellow]: not yet implemented (Phase {phase})")
    raise typer.Exit(2)


# ---- core ----------------------------------------------------------------
@app.command()
def doctor() -> None:
    """Validate environment, credentials, and dependencies."""
    from tool_scout.operations.doctor import run_doctor

    raise typer.Exit(0 if run_doctor() else 1)


@app.command()
def crawl(
    quick: bool = typer.Option(False, "--quick", help="10-min GitHub+MCP-only run"),
) -> None:
    """Run the daily crawl."""
    _not_yet("crawl", 2)


@app.command()
def status() -> None:
    """Show last crawl, publish, backup, queue, and surfaces health."""
    _not_yet("status", 12)


@app.command()
def usage(window_hours: int = typer.Option(24, "--hours")) -> None:
    """Show local LLM call stats for the last N hours."""
    from tool_scout.usage_tracker import stats

    s = stats(window_hours)
    console.print(s)


# ---- discovery -----------------------------------------------------------
@app.command(name="list")
def list_tools(
    category: Optional[str] = typer.Option(None, "--category"),
    letter: Optional[str] = typer.Option(None, "--letter"),
    since: Optional[str] = typer.Option(None, "--since"),
    limit: int = typer.Option(20, "--limit"),
) -> None:
    """List crawled tools, optionally filtered."""
    _not_yet("list", 5)


@app.command()
def search(query: str) -> None:
    """Full-text search over crawled tools."""
    _not_yet("search", 5)


@app.command()
def show(tool_id: str) -> None:
    """Show full details for a single tool."""
    _not_yet("show", 5)


@app.command()
def recommend(count: int = typer.Option(15, "--count")) -> None:
    """Print top N recommendations from the latest crawl."""
    _not_yet("recommend", 5)


# ---- personalization -----------------------------------------------------
@app.command()
def pin(tool_id: str) -> None:
    _not_yet("pin", 5)


@app.command()
def mute(tool_id: str) -> None:
    _not_yet("mute", 5)


@app.command()
def takedown(tool_id: str, reason: Optional[str] = typer.Option(None, "--reason")) -> None:
    _not_yet("takedown", 6)


# ---- install -------------------------------------------------------------
@app.command()
def install(
    tool_id: str,
    yes: bool = typer.Option(False, "--yes", "-y"),
    strategy: str = typer.Option("auto", "--strategy"),
) -> None:
    _not_yet("install", 6)


@app.command()
def uninstall(tool_id: str) -> None:
    _not_yet("uninstall", 6)


@app.command()
def installed() -> None:
    _not_yet("installed", 6)


# ---- sheets --------------------------------------------------------------
sheets_app = typer.Typer(help="Google Sheets sync subcommands.")
app.add_typer(sheets_app, name="sheets")


@sheets_app.command("sync")
def sheets_sync() -> None:
    _not_yet("sheets sync", 7)


@sheets_app.command("open")
def sheets_open() -> None:
    _not_yet("sheets open", 7)


@sheets_app.command("status")
def sheets_status() -> None:
    _not_yet("sheets status", 7)


# ---- publishing ----------------------------------------------------------
@app.command()
def export(force: bool = typer.Option(False, "--force")) -> None:
    _not_yet("export", 9)


@app.command()
def deploy() -> None:
    _not_yet("deploy", 9)


# ---- queue / orchestrator (Phase 11) -------------------------------------
queue_app = typer.Typer(help="Wrapper-gen queue.")
app.add_typer(queue_app, name="queue")


@queue_app.command("dashboard")
def queue_dashboard() -> None:
    _not_yet("queue dashboard", 11)


@queue_app.command("list")
def queue_list() -> None:
    _not_yet("queue list", 11)


@queue_app.command("show")
def queue_show(job_id: str) -> None:
    _not_yet("queue show", 11)


@queue_app.command("events")
def queue_events(job_id: str) -> None:
    _not_yet("queue events", 11)


@queue_app.command("cancel")
def queue_cancel(job_id: str) -> None:
    _not_yet("queue cancel", 11)


@queue_app.command("retry")
def queue_retry(job_id: str) -> None:
    _not_yet("queue retry", 11)


orch_app = typer.Typer(help="Symphony orchestrator subcommands.")
app.add_typer(orch_app, name="orchestrator")


@orch_app.command("start")
def orch_start() -> None:
    _not_yet("orchestrator start", 11)


@orch_app.command("status")
def orch_status() -> None:
    _not_yet("orchestrator status", 11)


workflow_app = typer.Typer(help="WORKFLOW.md tooling.")
app.add_typer(workflow_app, name="workflow")


@workflow_app.command("validate")
def workflow_validate() -> None:
    _not_yet("workflow validate", 11)


@workflow_app.command("show")
def workflow_show() -> None:
    _not_yet("workflow show", 11)


# ---- operations ----------------------------------------------------------
@app.command()
def backup() -> None:
    _not_yet("backup", 12)


@app.command()
def restore(date: str) -> None:
    _not_yet("restore", 12)


if __name__ == "__main__":
    app()
