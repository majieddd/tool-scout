"""Preflight checks for the orchestrator — return False to skip dispatch this tick.

Each check has a `.name` and a `.run()` -> bool. If any returns False, dispatch
is skipped for the tick (running jobs continue).
"""
from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from tool_scout.installer.sandbox import docker_available
from tool_scout.llm_client import LlmClient


@dataclass
class Check:
    name: str
    run: Callable[[], bool]


def _docker_running() -> bool:
    return docker_available()


def _ollama_running() -> bool:
    return LlmClient().ping()


def _git_writable() -> bool:
    """`git status` succeeds in the cwd → repo is writable."""
    if not shutil.which("git"):
        return False
    try:
        r = subprocess.run(["git", "status"], capture_output=True, text=True, timeout=5)
        return r.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def _workflow_valid() -> bool:
    """Try loading WORKFLOW.md. True iff parse succeeds."""
    from tool_scout.queue_worker.workflow_config import load_workflow

    candidates = [Path.cwd() / "WORKFLOW.md"]
    repo_root_guess = Path(__file__).resolve().parents[3]
    candidates.append(repo_root_guess / "WORKFLOW.md")
    for p in candidates:
        if p.exists():
            try:
                load_workflow(p)
                return True
            except Exception:
                return False
    return False


def build_checks(cfg) -> list[Check]:
    """Per the WorkflowConfig.preflight settings, return enabled checks."""
    out: list[Check] = []
    if cfg.require_docker_running:
        out.append(Check("docker_running", _docker_running))
    if cfg.require_ollama_running:
        out.append(Check("ollama_running", _ollama_running))
    if cfg.require_git_writable:
        out.append(Check("git_writable", _git_writable))
    if cfg.require_workflow_valid:
        out.append(Check("workflow_valid", _workflow_valid))
    return out
