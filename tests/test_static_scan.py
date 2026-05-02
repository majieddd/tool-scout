"""static_scan tests against the 3 fixture wrappers."""
from __future__ import annotations

from pathlib import Path

from tool_scout.installer.static_scan import scan

FIXTURES = Path(__file__).parent / "fixtures"


def test_known_good_clean():
    code = (FIXTURES / "known_good_wrapper.py").read_text(encoding="utf-8")
    clean, hits = scan(code)
    assert clean, f"expected clean but hit: {hits}"


def test_known_bad_rejected():
    code = (FIXTURES / "known_bad_wrapper.py").read_text(encoding="utf-8")
    clean, hits = scan(code)
    assert not clean, "expected rejection — known_bad has dangerous patterns"
    assert len(hits) >= 1


def test_borderline_clean():
    """borderline = no dangerous patterns but the smoke test will fail later."""
    code = (FIXTURES / "borderline_wrapper.py").read_text(encoding="utf-8")
    clean, hits = scan(code)
    assert clean, f"borderline should be scan-clean (smoke fails it instead) — hit: {hits}"


def test_subprocess_run_caught():
    bad = "import subprocess\nsubprocess.run(['ls'])"
    clean, hits = scan(bad)
    assert not clean
    assert any("subprocess" in h for h in hits)


def test_eval_caught():
    bad = "result = eval('1+1')"
    clean, hits = scan(bad)
    assert not clean


def test_socket_caught():
    bad = "import socket\ns = socket.socket()"
    clean, hits = scan(bad)
    assert not clean


def test_innocent_dict_unchanged():
    good = "data = {'subprocess': 'is just a key here'}"
    # subprocess as a string literal might still be regex-matched depending on
    # pattern strictness — we expect this to be flagged conservatively.
    # The patterns require `\bsubprocess\.` so this should NOT match.
    clean, hits = scan(good)
    assert clean, f"plain string subprocess should not flag: {hits}"
