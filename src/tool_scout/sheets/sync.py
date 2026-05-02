"""Sheets sync — monthly workbook discovery / creation, daily tab,
ALL-TIME refresh, DASHBOARD computation, letter-cell coloring.

Per docs/01_SPEC.md §27-31.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import joinedload

from tool_scout.db import SessionLocal
from tool_scout.models import CrawlRun, Grade, Install, Tool, UsageLog, UserOverride
from tool_scout.sheets.client import SheetsClient
from tool_scout.sheets.schema import (
    ALLTIME_HEADERS,
    DAILY_HEADERS,
    DASHBOARD_HEADERS,
    LETTER_HEX,
    hex_to_rgb01,
)

log = logging.getLogger("scout")

WORKBOOK_NAME_FMT = "tool-scout-%Y-%m"


def _today_tab_name() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")


def _workbook_name(when: datetime | None = None) -> str:
    return (when or datetime.utcnow()).strftime(WORKBOOK_NAME_FMT)


def _format_letter_cells(ws, letter_col: str, letters: list[str]) -> None:
    """Apply background colors to the Letter column (B by spec) per row."""
    try:
        from gspread_formatting import CellFormat, Color, format_cell_ranges
    except ImportError:
        log.warning("gspread-formatting not installed — skipping cell coloring")
        return
    ranges = []
    for i, letter in enumerate(letters, start=2):  # row 1 = header
        hex_str = LETTER_HEX.get(letter, "6B7280")
        r, g, b = hex_to_rgb01(hex_str)
        ranges.append((f"{letter_col}{i}", CellFormat(backgroundColor=Color(r, g, b))))
    if ranges:
        format_cell_ranges(ws, ranges)


def _ensure_tab(wb, name: str, headers: list[str]):
    """Open or create a worksheet; ensure the headers row matches."""
    try:
        ws = wb.worksheet(name)
    except Exception:
        ws = wb.add_worksheet(title=name, rows=2000, cols=max(20, len(headers)))
    # Always overwrite headers to keep schema in sync.
    ws.update("A1", [headers])
    return ws


def _fetch_top_picks_today(limit: int = 50) -> list[dict[str, Any]]:
    with SessionLocal() as s:
        excluded = {
            r[0] for r in s.query(UserOverride.tool_id).filter(
                UserOverride.state.in_(("muted", "excluded_by_owner"))
            ).all()
        }
        rows = (
            s.query(Tool)
            .options(joinedload(Tool.grade), joinedload(Tool.tags))
            .filter(Tool.dead == 0)
            .filter(~Tool.id.in_(excluded) if excluded else True)
            .all()
        )
        rows = [r for r in rows if r.grade is not None]
        rows.sort(key=lambda r: r.grade.total, reverse=True)
    out = []
    for i, t in enumerate(rows[:limit], start=1):
        g = t.grade
        out.append({
            "rank": i,
            "letter": g.letter,
            "color": "#" + LETTER_HEX.get(g.letter, "6B7280"),
            "name": t.name or "",
            "category": t.category or "",
            "subcategory": t.subcategory or "",
            "R": round(g.relevance, 2),
            "Q": round(g.quality, 2),
            "N": round(g.novelty, 2),
            "I": round(g.install_ease, 2),
            "F": round(g.fit, 2),
            "total": round(g.total, 2),
            "source": t.source,
            "url": t.url,
            "install_hint": t.install_hint or "",
            "tags": ",".join(sorted({tag.tag for tag in (t.tags or [])})[:8]),
            "notes": "",
            "install_command": "",
        })
    return out


def _fetch_alltime_rows() -> list[list[Any]]:
    with SessionLocal() as s:
        rows = (
            s.query(Tool)
            .options(joinedload(Tool.grade), joinedload(Tool.tags))
            .filter(Tool.dead == 0)
            .all()
        )
    out: list[list[Any]] = [ALLTIME_HEADERS]
    for t in rows:
        g = t.grade
        out.append([
            t.id,
            g.letter if g else "?",
            ("#" + LETTER_HEX.get(g.letter if g else "F", "6B7280")),
            (t.name or "")[:200],
            t.category or "",
            t.subcategory or "",
            round(g.total, 2) if g else 0,
            t.source,
            t.url,
            t.stars or 0,
            t.license or "",
            t.last_updated.isoformat() if t.last_updated else "",
            t.first_seen.isoformat() if t.first_seen else "",
            t.compatibility or "",
            ",".join(sorted({tag.tag for tag in (t.tags or [])})[:8]),
        ])
    return out


def _fetch_dashboard_metrics() -> list[list[Any]]:
    with SessionLocal() as s:
        n_tools = s.query(Tool).filter(Tool.dead == 0).count()
        by_letter = {l: 0 for l in "SABCDF"}
        for letter, count in s.query(Grade.letter, ).from_statement(  # type: ignore[arg-type]
            Tool.__table__.join(Grade.__table__).select()
        ).all() if False else []:  # safe-stub (avoid weird API)
            by_letter[letter] = count
        # Simpler: count via SQLAlchemy expression
        from sqlalchemy import func
        for letter, count in s.query(Grade.letter, func.count()).group_by(Grade.letter).all():
            by_letter[letter] = count
        installs = s.query(Install).filter(Install.success == 1, Install.strategy.notlike("%_uninstall")).count()
        crawls = s.query(CrawlRun).count()
        usage_24h = s.query(UsageLog).filter(
            UsageLog.called_at > datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        ).count()
    metrics: list[list[Any]] = [DASHBOARD_HEADERS]
    metrics.append(["Total tools (live)", n_tools])
    for letter in "SABCDF":
        metrics.append([f"Letter {letter}", by_letter.get(letter, 0)])
    metrics.append(["Installs (success)", installs])
    metrics.append(["Crawls run (lifetime)", crawls])
    metrics.append(["LLM calls today", usage_24h])
    metrics.append(["Generated at (UTC)", datetime.utcnow().isoformat()])
    return metrics


def sync(
    *,
    workbook_when: datetime | None = None,
    client: SheetsClient | None = None,
) -> dict:
    """Full sync — open/create monthly workbook, populate today + ALL-TIME + DASHBOARD."""
    cli = client or SheetsClient()
    wb_name = _workbook_name(workbook_when)
    wb = cli.open_or_create(wb_name)

    # ---- Today's tab ----
    today_picks = _fetch_top_picks_today(limit=50)
    today_ws = _ensure_tab(wb, _today_tab_name(), DAILY_HEADERS)
    rows: list[list[Any]] = [DAILY_HEADERS]
    letters: list[str] = []
    for pick in today_picks:
        rows.append([
            pick["rank"], pick["letter"], pick["color"],
            pick["name"], pick["category"], pick["subcategory"],
            pick["R"], pick["Q"], pick["N"], pick["I"], pick["F"], pick["total"],
            pick["source"], pick["url"], pick["install_hint"], pick["tags"], pick["notes"], pick["install_command"],
        ])
        letters.append(pick["letter"])
    today_ws.batch_clear(["A1:Z2000"])
    today_ws.update("A1", rows)
    _format_letter_cells(today_ws, "B", letters)

    # ---- ALL-TIME tab ----
    all_rows = _fetch_alltime_rows()
    all_ws = _ensure_tab(wb, "ALL-TIME", ALLTIME_HEADERS)
    all_ws.batch_clear(["A1:Z20000"])
    all_ws.update("A1", all_rows)
    _format_letter_cells(all_ws, "B", [r[1] for r in all_rows[1:]])

    # ---- DASHBOARD tab ----
    dash_rows = _fetch_dashboard_metrics()
    dash_ws = _ensure_tab(wb, "DASHBOARD", DASHBOARD_HEADERS)
    dash_ws.batch_clear(["A1:Z200"])
    dash_ws.update("A1", dash_rows)

    return {
        "workbook": wb_name,
        "url": wb.url if hasattr(wb, "url") else None,
        "today_tab": _today_tab_name(),
        "today_rows": len(today_picks),
        "alltime_rows": len(all_rows) - 1,
        "dashboard_rows": len(dash_rows) - 1,
    }


def status(client: SheetsClient | None = None) -> dict:
    cli = client or SheetsClient()
    cli._ensure_creds()
    wb_name = _workbook_name()
    workbooks = cli.list_workbooks_in_folder()
    by_name = {w["name"]: w for w in workbooks}
    cur = by_name.get(wb_name)
    return {
        "current_month": wb_name,
        "current_workbook_id": cur["id"] if cur else None,
        "all_workbooks_in_folder": [w["name"] for w in workbooks],
    }
