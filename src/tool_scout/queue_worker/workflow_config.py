"""WorkflowConfig — typed loader for WORKFLOW.md (docs/02_SPEC_v1.1_SYMPHONY.md §8).

WORKFLOW.md is YAML frontmatter + Markdown body. The frontmatter is parsed
into a Pydantic model (validation + defaults), the body is the wrapper-gen
prompt template rendered later via strict Liquid.

Env-var resolution: any string field of shape `$VAR_NAME` is replaced with
os.environ[VAR_NAME] at load time (untouched if the env var isn't set).
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

ENV_VAR_RE = re.compile(r"\$([A-Z_][A-Z0-9_]*)")


def _resolve_env(value: Any) -> Any:
    if isinstance(value, str):
        return ENV_VAR_RE.sub(lambda m: os.environ.get(m.group(1), m.group(0)), value)
    if isinstance(value, dict):
        return {k: _resolve_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_env(v) for v in value]
    return value


class TrackerConfig(BaseModel):
    kind: str = "sqlite_local"
    table: str = "wrapper_requests"
    active_states: list[str] = Field(default_factory=lambda: ["pending"])
    terminal_states: list[str] = Field(default_factory=lambda: ["succeeded", "failed", "canceled"])


class PollingConfig(BaseModel):
    tick_interval_ms: int = 10_000
    reconcile_every_ticks: int = 1


class ConcurrencyConfig(BaseModel):
    max_concurrent_jobs: int = 2
    max_per_tool_per_24h: int = 1
    max_global_per_24h: int = 10


class HooksConfig(BaseModel):
    after_create: str = ""
    before_turn: str = ""
    after_turn: str = ""
    on_success: str = ""
    on_failure: str = ""
    before_remove: str = ""


class WorkspaceConfig(BaseModel):
    root: str = "~/.tool-scout/workspaces"
    retention: str = "keep_until_terminal"
    hooks: HooksConfig = Field(default_factory=HooksConfig)


class AgentConfig(BaseModel):
    command: str = "ollama"
    mode: str = "ollama_http"
    model: str | None = None
    fallback_model: str | None = None
    max_turns: int = 3
    per_turn_timeout_s: int = 300
    stall_timeout_s: int = 90


class RetriesConfig(BaseModel):
    max_attempts: int = 3
    initial_backoff_s: int = 30
    max_backoff_s: int = 600
    retry_on: list[str] = Field(default_factory=lambda: ["smoke_test_failed", "claude_subprocess_error", "timeout", "stalled"])
    do_not_retry_on: list[str] = Field(default_factory=lambda: ["static_scan_blocked", "rate_limit_exceeded", "workflow_invalid"])


class SandboxConfig(BaseModel):
    image: str = "python:3.11-slim"
    network: str = "none"
    read_only: bool = True
    memory: str = "256m"
    cpus: float = 0.5
    smoke_timeout_s: int = 60


class ObservabilityConfig(BaseModel):
    jsonl_log: str = "~/.tool-scout/logs/orchestrator.jsonl"
    http_status_port: int = 8766
    tui_dashboard: bool = True


class PreflightConfig(BaseModel):
    require_docker_running: bool = True
    require_ollama_running: bool = True
    require_git_writable: bool = True
    require_workflow_valid: bool = True


class WorkflowConfig(BaseModel):
    tracker: TrackerConfig = Field(default_factory=TrackerConfig)
    polling: PollingConfig = Field(default_factory=PollingConfig)
    concurrency: ConcurrencyConfig = Field(default_factory=ConcurrencyConfig)
    preflight: PreflightConfig = Field(default_factory=PreflightConfig)
    workspace: WorkspaceConfig = Field(default_factory=WorkspaceConfig)
    agent: AgentConfig = Field(default_factory=AgentConfig)
    retries: RetriesConfig = Field(default_factory=RetriesConfig)
    sandbox: SandboxConfig = Field(default_factory=SandboxConfig)
    observability: ObservabilityConfig = Field(default_factory=ObservabilityConfig)
    prompt_body: str = ""


def load_workflow(path: Path | str) -> WorkflowConfig:
    raw = Path(path).read_text(encoding="utf-8")
    if not raw.lstrip().startswith("---"):
        raise ValueError("WORKFLOW.md missing YAML front matter")
    parts = raw.split("---", 2)
    if len(parts) < 3:
        raise ValueError("WORKFLOW.md malformed: expected `---\\nyaml\\n---\\nbody`")
    front = yaml.safe_load(parts[1]) or {}
    front = _resolve_env(front)
    body = parts[2].strip()
    return WorkflowConfig(**front, prompt_body=body)
