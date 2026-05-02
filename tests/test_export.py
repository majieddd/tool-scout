"""Export tests — secret scrubbing + visibility filter shape."""
from __future__ import annotations

from tool_scout.export.vercel_export import _scrub_secrets, _truncate


def test_scrub_secrets_openai():
    s = "Use sk-abcdefghijklmnopqrstuvwxyz1234567890XX as your key"
    out = _scrub_secrets(s)
    assert "sk-abcdefghi" not in out
    assert "***SCRUBBED***" in out


def test_scrub_secrets_github_pat():
    s = "Set GITHUB_TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    out = _scrub_secrets(s)
    assert "ghp_AAAA" not in out


def test_scrub_secrets_innocent_unchanged():
    s = "npm install -g cool-tool"
    assert _scrub_secrets(s) == s


def test_truncate_short_unchanged():
    assert _truncate("hello", 10) == "hello"


def test_truncate_long_appends_ellipsis():
    long = "x" * 1000
    out = _truncate(long, 800)
    assert len(out) == 801   # 800 + "…"
    assert out.endswith("…")
