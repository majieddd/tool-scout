"""WorkerRunner — runs one wrapper-generation job, possibly across multiple
turns (docs/02_SPEC_v1.1_SYMPHONY.md §6, adapted for the local-Gemma backend
and PowerShell hooks).

Per-turn flow:
  1. before_turn hook
  2. render prompt from WORKFLOW.md body via Liquid
  3. LlmClient.ask_file -> ./output/server.py
  4. static_scan -> if blocked, emit + return (no retry)
  5. sandbox smoke -> if failed, after_turn hook + try next turn
  6. on success: on_success hook + git_publisher.publish_data
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from tool_scout.installer.sandbox import run_smoke_test
from tool_scout.installer.static_scan import scan as static_scan
from tool_scout.llm_client import LlmClient
from tool_scout.queue_worker.hooks import run_hook
from tool_scout.queue_worker.template import render_workflow_prompt
from tool_scout.queue_worker.workflow_config import WorkflowConfig

log = logging.getLogger("queue")


@dataclass
class WorkerOutcome:
    success: bool
    duration_ms: int
    result_url: Optional[str] = None
    reason: Optional[str] = None
    retry_eligible: bool = False
    error: Optional[str] = None


class WorkerRunner:
    def __init__(self, config: WorkflowConfig, candidate):
        self.config = config
        self.cand = candidate
        self.workspace = Path(config.workspace.root).expanduser() / candidate.id
        # Use config model with optional override
        model = (config.agent.model or None)
        self.claude = LlmClient(model=model)

    async def run(self, on_event: Callable[[dict], Awaitable[None] | None]) -> WorkerOutcome:
        t0 = time.monotonic()
        try:
            await self._prepare_workspace(on_event)
            previous_failure: Optional[str] = None
            for turn in range(1, self.config.agent.max_turns + 1):
                await self._emit(on_event, "turn_started", turn=turn)
                ok, _ = await run_hook(
                    self.config.workspace.hooks.before_turn,
                    cwd=self.workspace,
                    env=self._hook_env(turn),
                )
                if not ok:
                    return WorkerOutcome(False, int((time.monotonic() - t0) * 1000),
                                         reason="before_turn_hook_failed", retry_eligible=False)

                prompt = render_workflow_prompt(
                    template_body=self.config.prompt_body,
                    tool=self.cand.tool,
                    turn_number=turn,
                    previous_failure_reason=previous_failure,
                )

                wrapper_path = self.workspace / "output" / "server.py"
                try:
                    await asyncio.wait_for(
                        asyncio.to_thread(self.claude.ask_file, prompt, wrapper_path),
                        timeout=self.config.agent.per_turn_timeout_s,
                    )
                except asyncio.TimeoutError:
                    await self._emit(on_event, "turn_completed", turn=turn,
                                     payload={"status": "timeout"})
                    previous_failure = "timeout"
                    continue
                except Exception as exc:  # noqa: BLE001
                    await self._emit(on_event, "turn_completed", turn=turn,
                                     payload={"status": "claude_error", "error": repr(exc)})
                    return WorkerOutcome(False, int((time.monotonic() - t0) * 1000),
                                         reason="claude_subprocess_error", retry_eligible=True,
                                         error=repr(exc))

                code = wrapper_path.read_text(encoding="utf-8")
                clean, hits = static_scan(code)
                if not clean:
                    await self._emit(on_event, "turn_completed", turn=turn,
                                     payload={"status": "static_scan_blocked", "hits": hits})
                    await run_hook(self.config.workspace.hooks.on_failure,
                                   cwd=self.workspace, env=self._hook_env(turn))
                    return WorkerOutcome(False, int((time.monotonic() - t0) * 1000),
                                         reason="static_scan_blocked", retry_eligible=False)

                passed, smoke_log = await asyncio.to_thread(run_smoke_test, wrapper_path)
                if not passed:
                    await self._emit(on_event, "turn_completed", turn=turn,
                                     payload={"status": "smoke_test_failed",
                                              "smoke_log_tail": smoke_log[-500:]})
                    previous_failure = "smoke_test_failed"
                    await run_hook(self.config.workspace.hooks.after_turn,
                                   cwd=self.workspace,
                                   env=self._hook_env(turn, status="smoke_failed"))
                    continue

                await run_hook(self.config.workspace.hooks.on_success,
                               cwd=self.workspace, env=self._hook_env(turn, status="success"))
                result_url = await asyncio.to_thread(self._publish, wrapper_path)
                await self._emit(on_event, "turn_completed", turn=turn,
                                 payload={"status": "success"})
                return WorkerOutcome(True, int((time.monotonic() - t0) * 1000),
                                     result_url=result_url)

            # Exhausted all turns without success.
            await run_hook(self.config.workspace.hooks.on_failure,
                           cwd=self.workspace, env=self._hook_env(self.config.agent.max_turns))
            return WorkerOutcome(False, int((time.monotonic() - t0) * 1000),
                                 reason="max_turns_exhausted", retry_eligible=True)
        finally:
            pass  # workspace retention controlled by config

    async def _prepare_workspace(self, on_event):
        if self.workspace.exists():
            shutil.rmtree(self.workspace, ignore_errors=True)
        self.workspace.mkdir(parents=True)
        await run_hook(self.config.workspace.hooks.after_create,
                       cwd=self.workspace, env=self._hook_env(0))
        await self._emit(on_event, "workspace_ready")

    def _publish(self, wrapper_path: Path) -> str:
        from tool_scout.git_publisher import GitPublisher
        repo_root = Path(__file__).resolve().parents[3]
        try:
            publisher = GitPublisher.from_env(repo_path=repo_root)
        except RuntimeError:
            log.warning("publish: GitPublisher unavailable — wrapper saved locally only")
            return f"file://{wrapper_path}"
        target = repo_root / "web" / "public" / "wrappers" / self.cand.tool.id / "server.py"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(wrapper_path, target)
        rel_path = str(target.relative_to(repo_root)).replace("\\", "/")
        publisher.publish_data(
            message=f"feat(wrapper): {self.cand.tool.name} ({self.cand.id})",
            paths=[rel_path],
        )
        return f"/wrappers/{self.cand.tool.id}/server.py"

    async def _emit(self, on_event, state: str, turn: int | None = None, payload: dict | None = None):
        evt = {"state": state, "turn": turn, "payload": payload or {}}
        result = on_event(evt)
        if asyncio.iscoroutine(result):
            await result

    def _hook_env(self, turn: int, status: str = "running") -> dict[str, str]:
        return {
            "JOB_ID": self.cand.id,
            "TOOL_ID": self.cand.tool.id if self.cand.tool else "",
            "TURN_NUMBER": str(turn),
            "TURN_STATUS": status,
        }
