"""Column schemas for each Sheets tab type."""
from __future__ import annotations

from typing import Final

DAILY_HEADERS: Final[list[str]] = [
    "Rank", "Letter", "Color", "Name", "Category", "Subcategory",
    "R", "Q", "N", "I", "F", "Total",
    "Source", "URL", "Install Hint", "Tags", "Notes", "Install Command",
]

ALLTIME_HEADERS: Final[list[str]] = [
    "Tool ID", "Letter", "Color", "Name", "Category", "Subcategory",
    "Total", "Source", "URL", "Stars", "License", "Last Updated",
    "First Seen", "Compatibility", "Tags",
]

DASHBOARD_HEADERS: Final[list[str]] = ["Metric", "Value"]


# Letter -> hex (no leading #) — used for cell background fills via gspread-formatting
LETTER_HEX: Final[dict[str, str]] = {
    "S": "8B5CF6",
    "A": "10B981",
    "B": "3B82F6",
    "C": "F59E0B",
    "D": "F97316",
    "F": "6B7280",
}


def hex_to_rgb01(hex_str: str) -> tuple[float, float, float]:
    """Convert 6-char hex to (r,g,b) in [0,1]."""
    h = hex_str.lstrip("#")
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)
