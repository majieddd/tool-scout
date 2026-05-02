"""Sheets sync tests — fully mocked (no GCP creds, no network)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from tool_scout.sheets.schema import (
    ALLTIME_HEADERS,
    DAILY_HEADERS,
    DASHBOARD_HEADERS,
    LETTER_HEX,
    hex_to_rgb01,
)
from tool_scout.sheets.sync import _format_letter_cells, _today_tab_name, _workbook_name


def test_hex_to_rgb01():
    r, g, b = hex_to_rgb01("8B5CF6")  # S-tier purple
    assert 0 <= r <= 1 and 0 <= g <= 1 and 0 <= b <= 1
    # Compare against a known-good RGB conversion
    assert abs(r - 0x8B / 255) < 1e-6
    assert abs(g - 0x5C / 255) < 1e-6
    assert abs(b - 0xF6 / 255) < 1e-6


def test_letter_hex_complete():
    """Every letter S-F has a hex color."""
    for letter in "SABCDF":
        assert letter in LETTER_HEX


def test_workbook_name_format():
    import datetime as dt
    name = _workbook_name(dt.datetime(2026, 5, 17))
    assert name == "tool-scout-2026-05"


def test_today_tab_name_iso():
    name = _today_tab_name()
    # YYYY-MM-DD shape
    assert len(name) == 10 and name[4] == "-" and name[7] == "-"


def test_format_letter_cells_calls_gspread_formatting():
    ws = MagicMock()
    with patch("tool_scout.sheets.sync.format_cell_ranges", create=True) as mock_fmt:
        # Inject the import that's lazy
        import sys
        fake_mod = MagicMock()
        fake_mod.CellFormat = MagicMock()
        fake_mod.Color = MagicMock()
        fake_mod.format_cell_ranges = mock_fmt
        sys.modules["gspread_formatting"] = fake_mod
        _format_letter_cells(ws, "B", ["S", "A", "B"])
    assert mock_fmt.called


def test_daily_headers_have_grade_axes():
    """Daily tab includes the R/Q/N/I/F columns from the rubric."""
    for axis in ("R", "Q", "N", "I", "F", "Total"):
        assert axis in DAILY_HEADERS
    # Letter + Color come right after Rank per spec §29
    assert DAILY_HEADERS[1] == "Letter"
    assert DAILY_HEADERS[2] == "Color"


def test_alltime_headers_have_keys():
    assert "Tool ID" in ALLTIME_HEADERS
    assert "URL" in ALLTIME_HEADERS
    assert "Letter" in ALLTIME_HEADERS


def test_dashboard_headers_minimal():
    assert DASHBOARD_HEADERS == ["Metric", "Value"]
