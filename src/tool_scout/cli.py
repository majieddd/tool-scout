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
    from tool_scout.crawler.runner import run_crawl

    summary = run_crawl(quick=quick)
    console.print(f"[green]crawl complete[/green]: run #{summary['run_id']}")
    console.print(f"  duration:    {summary['duration_s']}s")
    console.print(f"  new tools:   {summary['new_tools']}")
    console.print(f"  updated:     {summary['updated']}")
    if summary["errors"]:
        console.print(f"  [red]errors:[/red] {summary['errors']}")
    raise typer.Exit(0 if not summary["errors"] else 1)


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


@app.command()
def classify(
    force: bool = typer.Option(False, "--force", help="Reclassify even already-categorized tools"),
    cap: Optional[int] = typer.Option(None, "--cap", help="Process at most N records"),
    batch_size: int = typer.Option(20, "--batch-size"),
) -> None:
    """Classify pending (or all if --force) tools via heuristics + Gemma."""
    from tool_scout.classifier import classify_all

    summary = classify_all(force=force, batch_size=batch_size, cap=cap)
    console.print(f"[green]classify complete[/green]")
    for k, v in summary.items():
        console.print(f"  {k}: {v}")


@app.command()
def grade() -> None:
    """Recompute grades for every tool from the current rubric + profile."""
    from tool_scout.grading import grade_all

    summary = grade_all()
    console.print(f"[green]grade complete[/green]")
    console.print(f"  total: {summary.get('total')}")
    by_letter = summary.get("by_letter", {})
    for letter in ("S", "A", "B", "C", "D", "F"):
        n = by_letter.get(letter, 0)
        if n:
            console.print(f"  {letter}: {n}")


# ---- discovery -----------------------------------------------------------
@app.command(name="list")
def list_tools(
    category: Optional[str] = typer.Option(None, "--category"),
    letter: Optional[str] = typer.Option(None, "--letter"),
    since: Optional[str] = typer.Option(None, "--since"),
    limit: int = typer.Option(20, "--limit"),
) -> None:
    """List crawled tools, optionally filtered."""
    from rich.table import Table

    from tool_scout.db import SessionLocal
    from tool_scout.models import Grade, Tool

    with SessionLocal() as s:
        q = s.query(Tool)
        if category:
            q = q.filter(Tool.category == category)
        if letter:
            from sqlalchemy.orm import joinedload

            q = q.outerjoin(Grade).filter(Grade.letter == letter).options(joinedload(Tool.grade))
        rows = q.order_by(Tool.last_crawled.desc()).limit(limit).all()
        # Letter is on the related grade row; load it eagerly.
        for r in rows:
            _ = r.grade

    table = Table(title=f"scout list (latest {limit})", show_lines=False)
    table.add_column("source", style="cyan", no_wrap=True)
    table.add_column("letter", justify="center")
    table.add_column("name")
    table.add_column("category")
    table.add_column("stars", justify="right")
    table.add_column("url", style="dim")
    for r in rows:
        letter_cell = r.grade.letter if r.grade else "-"
        table.add_row(
            r.source,
            letter_cell,
            (r.name or "")[:60],
            r.category or "-",
            str(r.stars or 0),
            r.url[:60],
        )
    console.print(table)
    console.print(f"[dim]{len(rows)} row(s)[/dim]")


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
    from tool_scout.recommender import recommend as do_recommend

    picks = do_recommend(count=count)
    if not picks:
        console.print("[yellow]No graded tools found — run `scout crawl` first.[/yellow]")
        raise typer.Exit(1)
    color_map = {"S": "magenta", "A": "green", "B": "cyan", "C": "yellow", "D": "bright_red", "F": "white"}
    for i, p in enumerate(picks, start=1):
        c = color_map.get(p.letter, "white")
        console.print(
            f"[bold]{i:>2}.[/bold] [bold {c}]{p.letter}[/bold {c}] "
            f"[white]{p.name[:60]:<60}[/white] "
            f"[dim]{p.category or '-':<14}[/dim] "
            f"score=[bold]{p.score:.2f}[/bold]  [dim]{p.reasoning}[/dim]"
        )


@app.command(name="profile")
def profile_cmd(
    show: bool = typer.Option(False, "--show"),
    analyze: bool = typer.Option(False, "--analyze"),
) -> None:
    """Show profile config (--show) or learning-loop diagnostics (--analyze)."""
    if analyze:
        from tool_scout.recommender import profile_analyze

        console.print(profile_analyze())
        return
    if show:
        from tool_scout.recommender import Profile

        p = Profile.load()
        console.print(f"[bold]Interests[/bold]: {len(p.interests)} tag weights")
        for t, w in sorted(p.interests.items(), key=lambda kv: -kv[1])[:10]:
            console.print(f"  {t:30} {w:+.0f}")
        console.print(f"[bold]Projects[/bold]: {len(p.projects)}")
        for proj in p.projects:
            console.print(f"  {proj.name:20} weight={proj.weight} boost_tags={list(proj.boost_tags)[:5]}")
        console.print(f"[bold]Excludes[/bold]: {sorted(p.excludes)}")
        return
    console.print("Use --show to dump profile, --analyze to inspect learning loop")


# ---- personalization -----------------------------------------------------
@app.command()
def pin(tool_id: str) -> None:
    _not_yet("pin", 5)


@app.command()
def mute(tool_id: str) -> None:
    _not_yet("mute", 5)


@app.command()
def takedown(tool_id: str, reason: Optional[str] = typer.Option(None, "--reason")) -> None:
    """Permanently exclude a tool from public exports + future re-adds."""
    from tool_scout.installer import takedown as do_takedown

    res = do_takedown(tool_id, reason=reason)
    console.print(res)


# ---- install -------------------------------------------------------------
@app.command()
def install(
    tool_id: str,
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompt"),
    strategy: str = typer.Option("auto", "--strategy", help="auto|native_mcp|skill|plugin"),
) -> None:
    """Install a tool. Always dry-runs first and prints the diff unless --yes."""
    from tool_scout.installer import install as do_install

    # Dry run first
    dry = do_install(tool_id, strategy_override=strategy, dry_run=True)
    if not dry.get("ok"):
        console.print(f"[red]install failed[/red]: {dry}")
        raise typer.Exit(1)
    console.print(f"[bold]Strategy:[/bold] {dry.get('strategy')}")
    console.print(f"[bold]Diff (dry run):[/bold]")
    console.print(dry.get("diff"))
    if not yes:
        ok = typer.confirm("Proceed with install?")
        if not ok:
            console.print("[yellow]aborted[/yellow]")
            raise typer.Exit(0)
    res = do_install(tool_id, strategy_override=strategy, dry_run=False)
    if not res.get("ok"):
        console.print(f"[red]install failed[/red]: {res}")
        raise typer.Exit(1)
    console.print(f"[green]install ok[/green]: {res.get('strategy')}")


@app.command()
def uninstall(tool_id: str) -> None:
    """Reverse a prior install (idempotent across all strategies)."""
    from tool_scout.installer import uninstall as do_uninstall

    res = do_uninstall(tool_id)
    console.print(res)


@app.command()
def installed() -> None:
    """List currently installed tools (latest successful install per tool)."""
    from tool_scout.installer import list_installed

    rows = list_installed()
    if not rows:
        console.print("[dim]nothing installed[/dim]")
        return
    for r in rows:
        console.print(f"  [{r['strategy']:12}] {r['tool_id']}  {r['installed_at']}")


@app.command()
def pin(tool_id: str) -> None:
    """Mark a tool as pinned (boost in recommendations)."""
    from tool_scout.installer import set_override

    console.print(set_override(tool_id, "pinned"))


@app.command()
def mute(tool_id: str) -> None:
    """Mute a tool (de-prioritized + excluded from public export)."""
    from tool_scout.installer import set_override

    console.print(set_override(tool_id, "muted"))


# ---- sheets --------------------------------------------------------------
sheets_app = typer.Typer(help="Google Sheets sync subcommands.")
app.add_typer(sheets_app, name="sheets")


@sheets_app.command("sync")
def sheets_sync() -> None:
    """Sync monthly workbook (DASHBOARD + ALL-TIME + today's tab)."""
    from tool_scout.sheets import sync as do_sync

    summary = do_sync()
    console.print(f"[green]sheets sync complete[/green]")
    for k, v in summary.items():
        console.print(f"  {k}: {v}")


@sheets_app.command("open")
def sheets_open() -> None:
    """Open the current month's workbook in the default browser."""
    import webbrowser
    from tool_scout.sheets import status as do_status

    s = do_status()
    wb_id = s.get("current_workbook_id")
    if not wb_id:
        console.print("[yellow]no current-month workbook (run `scout sheets sync` first)[/yellow]")
        raise typer.Exit(1)
    url = f"https://docs.google.com/spreadsheets/d/{wb_id}"
    webbrowser.open(url)
    console.print(f"opened {url}")


@sheets_app.command("status")
def sheets_status() -> None:
    """Show which workbooks exist in the configured Drive folder."""
    from tool_scout.sheets import status as do_status

    console.print(do_status())


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
