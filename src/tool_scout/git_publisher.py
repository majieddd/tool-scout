"""Git publisher (docs/01_SPEC.md §10).

Stages files, commits with bot identity, pushes to origin. The token-bearing
URL is set on the remote temporarily for the push and scrubbed back to the
plain URL afterward — never persisted to disk in a way that could leak.

If GIT_BOT_TOKEN isn't set, falls back to `gh auth token` (the gh CLI
keyring) so MVP doesn't require a separate fine-grained PAT.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path

from git import Actor, Repo

log = logging.getLogger("scout")


def _resolve_token() -> str | None:
    tok = os.environ.get("GIT_BOT_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if tok:
        return tok
    if shutil.which("gh"):
        try:
            r = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        except (subprocess.SubprocessError, OSError):
            pass
    return None


def _scrub_url(remote_url: str) -> str:
    """Strip any embedded auth token from a remote URL before logging or returning."""
    if "x-access-token" in remote_url:
        # Shape: https://x-access-token:TOKEN@github.com/owner/repo.git
        before, _, after = remote_url.partition("@")
        return "https://" + after if after else remote_url
    return remote_url


class GitPublisher:
    def __init__(
        self,
        repo_path: Path,
        bot_name: str,
        bot_email: str,
        token: str,
        remote_url: str,
    ):
        self.repo_path = Path(repo_path)
        self.bot = Actor(bot_name, bot_email)
        self.token = token
        self.remote_url = remote_url
        self.repo = Repo(repo_path)

    @classmethod
    def from_env(cls, repo_path: Path | None = None) -> "GitPublisher":
        repo_path = repo_path or Path.cwd()
        token = _resolve_token()
        if not token:
            raise RuntimeError("no GIT_BOT_TOKEN, no GITHUB_TOKEN, and `gh auth token` empty")
        remote_url = os.environ.get("GIT_REPO_URL")
        if not remote_url:
            # Fall back to the actual configured origin
            try:
                remote_url = Repo(repo_path).remote("origin").url
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(f"GIT_REPO_URL unset and no origin remote: {e}") from e
        return cls(
            repo_path=repo_path,
            bot_name=os.environ.get("GIT_BOT_USERNAME", "tool-scout-bot"),
            bot_email=os.environ.get("GIT_BOT_EMAIL", "bot@tool-scout.invalid"),
            token=token,
            remote_url=remote_url,
        )

    def publish_data(self, message: str, paths: list[str]) -> str | None:
        """Stage `paths`, commit (if dirty), push. Returns commit sha or None."""
        # Stage individually — never use `git add -A` here per spec safety rules
        self.repo.index.add(paths)
        if not (self.repo.is_dirty() or self.repo.untracked_files):
            log.info("publish_data: nothing to commit (paths=%s)", paths)
            return None
        commit = self.repo.index.commit(message, author=self.bot, committer=self.bot)
        sha = commit.hexsha

        # Tokenize URL for push, then immediately scrub
        authed = self.remote_url.replace("https://", f"https://x-access-token:{self.token}@", 1)
        origin = self.repo.remote("origin")
        original_url = origin.url
        try:
            origin.set_url(authed)
            origin.push()
        finally:
            origin.set_url(original_url)
        log.info("publish_data: pushed %s to %s", sha[:8], _scrub_url(self.remote_url))
        return sha
