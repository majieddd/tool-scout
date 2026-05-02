"""TUI dashboard — `scout queue dashboard` opens a Rich live table.

Shows running jobs, recent events, tick interval, current workflow mtime.
"""
from __future__ import annotations

import json
import time
from datetime import datetime

from rich.console import Console
from rich.live import Live
from rich.table import Table

from tool_scout.db import SessionLocal
from tool_scout.models import OrchestratorEvent, WrapperRequest

console = Console()


def _state_color(state: str) -> str:
    return {
        "succeeded": "green",
        "failed": "red",
        "canceled": "yellow",
        "running": "cyan",
        "claimed": "cyan",
        "stalled": "magenta",
        "retry_queued": "yellow",
    }.get(state, "white")


def _build_table() -> Table:
    table = Table(title="Tool Scout Orchestrator", show_lines=False, header_style="bold")
    table.add_column("Job", width=10)
    table.add_column("Tool")
    table.add_column("Status")
    table.add_column("Attempts", justify="right")
    table.add_column("Last event")

    with SessionLocal() as s:
        active = (
            s.query(WrapperRequest)
            .filter(WrapperRequest.status.in_(("pending", "running")))
            .order_by(WrapperRequest.requested_at.desc())
            .limit(20)
            .all()
        )
        for j in active:
            tool_name = "(unknown)"
            if j.tool_id:
                from tool_scout.models import Tool
                t = s.get(Tool, j.tool_id)
                if t:
                    tool_name = (t.name or t.id)[:48]
            last_evt = (
                s.query(OrchestratorEvent)
                .filter(OrchestratorEvent.job_id == j.id)
                .order_by(OrchestratorEvent.id.desc())
                .first()
            )
            last_str = (
                f"{last_evt.state} ({_age(last_evt.occurred_at)})"
                if last_evt else "(no events)"
            )
            color = _state_color(j.status)
            table.add_row(
                j.id[:8],
                tool_name,
                f"[{color}]{j.status}[/{color}]",
                str(j.attempts or 0),
                last_str,
            )
    return table


def _age(ts: datetime) -> str:
    delta = datetime.utcnow() - ts
    if delta.total_seconds() < 60:
        return f"{int(delta.total_seconds())}s ago"
    if delta.total_seconds() < 3600:
        return f"{int(delta.total_seconds() / 60)}m ago"
    return f"{int(delta.total_seconds() / 3600)}h ago"


def run_dashboard(refresh_s: float = 2.0) -> None:
    with Live(_build_table(), refresh_per_second=1 / refresh_s, console=console) as live:
        try:
            while True:
                time.sleep(refresh_s)
                live.update(_build_table())
        except KeyboardInterrupt:
            console.print("[dim]dashboard stopped[/dim]")
