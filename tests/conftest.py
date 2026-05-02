"""Pytest fixtures. Uses a per-test SQLite file under tmp_path so the prod
DB at ~/.tool-scout/scout.db is never touched by tests.
"""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def tmp_db(tmp_path: Path, monkeypatch):
    """Point HOME at tmp_path so db.py creates ~/.tool-scout/scout.db there."""
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path))
    # Re-import db module so it picks up the new HOME.
    import importlib
    import tool_scout.db as db_mod

    importlib.reload(db_mod)
    yield db_mod
    # Teardown: nothing — tmp_path is auto-cleaned.
