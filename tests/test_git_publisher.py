"""git_publisher tests — verify token never persists, bot identity is used.

These tests run against a temporary git repo so we don't touch the real one.
"""
from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from git import Repo

from tool_scout.git_publisher import GitPublisher, _resolve_token, _scrub_url


def test_scrub_url_strips_token():
    out = _scrub_url("https://x-access-token:secret123@github.com/owner/repo.git")
    assert "secret" not in out
    assert "github.com/owner/repo.git" in out


def test_scrub_url_plain_unchanged():
    url = "https://github.com/owner/repo.git"
    assert _scrub_url(url) == url


def test_resolve_token_prefers_env(monkeypatch):
    monkeypatch.setenv("GIT_BOT_TOKEN", "env-token-abc")
    assert _resolve_token() == "env-token-abc"


def test_publish_data_commit_with_bot_identity(tmp_path: Path):
    """Spin up a local repo, commit a tracked file via GitPublisher, verify
    the bot identity ended up on the commit."""
    repo = Repo.init(tmp_path)
    # Initial commit so HEAD exists
    (tmp_path / "README.md").write_text("hi", encoding="utf-8")
    repo.index.add(["README.md"])
    repo.index.commit("init", author=__import__("git").Actor("u", "u@x"), committer=__import__("git").Actor("u", "u@x"))

    # New file to publish
    (tmp_path / "data.json").write_text("{}", encoding="utf-8")

    pub = GitPublisher(
        repo_path=tmp_path,
        bot_name="tool-scout-bot",
        bot_email="bot@tool-scout.invalid",
        token="dummy",
        remote_url="https://github.com/dummy/dummy.git",
    )
    # Mock the push (we don't have a remote)
    with patch.object(pub.repo, "remote") as remote_factory:
        fake_remote = MagicMock()
        fake_remote.url = "https://github.com/dummy/dummy.git"
        remote_factory.return_value = fake_remote
        sha = pub.publish_data("test commit", ["data.json"])
    assert sha is not None
    head = repo.head.commit
    assert head.author.name == "tool-scout-bot"
    assert head.author.email == "bot@tool-scout.invalid"


def test_publish_data_returns_none_when_nothing_changed(tmp_path: Path):
    repo = Repo.init(tmp_path)
    (tmp_path / "README.md").write_text("hi", encoding="utf-8")
    repo.index.add(["README.md"])
    repo.index.commit("init", author=__import__("git").Actor("u", "u@x"), committer=__import__("git").Actor("u", "u@x"))

    pub = GitPublisher(
        repo_path=tmp_path,
        bot_name="b",
        bot_email="b@x",
        token="dummy",
        remote_url="https://github.com/x/y.git",
    )
    # Same file, unchanged content
    sha = pub.publish_data("noop", ["README.md"])
    assert sha is None
