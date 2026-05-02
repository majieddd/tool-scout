# Tool Scout — v1.1 Supplement: Symphony-Style Orchestration

> **Status:** Additive supplement to `TOOL_SCOUT_SPEC.md` v1.0.
> **Scope:** Replaces the queue worker (Part N, §38–§42) with a Symphony-pattern orchestrator. Everything else in v1.0 stands unchanged.
> **Net change to build estimate:** +1.5 days at Phase 11. Everything else in the build order stays the same.

---

## 0. Why this exists, and what it is *not*

OpenAI Symphony is a long-running daemon that turns issue-tracker tickets into autonomous coding-agent runs. Its core ideas — a single authoritative orchestrator, polled work source, bounded concurrency, per-job isolated workspaces, exponential-backoff retries, multi-turn continuation, versioned in-repo workflow contract, and structured observability — are **directly applicable** to tool-scout's wrapper-generation queue, and they replace several ad-hoc pieces of v1.0 with a cleaner, more debuggable design.

What this supplement does **not** do:

- It does **not** Symphony-ize the daily crawler. The crawler is a batch job — Symphony's value is in long-running, claimed, retryable work. Wrong fit. Crawler stays as v1.0 specifies.
- It does **not** Symphony-ize the classifier. Same reason — synchronous batch.
- It does **not** require Linear, Codex, or Elixir. We adapt the *pattern*, not the implementation. Our "tracker" is the local SQLite `wrapper_requests` table (already exists). Our "coding agent" is Claude Code via subprocess (already exists). Our "workspace" is a Docker container (already exists).
- It does **not** add new external services. Same zero-cost stack.

What it **does** do:

- Replaces the cron-style 5-minute queue worker with a continuous orchestrator process running as a Windows Service.
- Adds proper FSM lifecycle for each wrapper job: `Unclaimed → Claimed → Running → (TurnComplete | RetryQueued) → (Succeeded | Failed | TimedOut | Stalled | CanceledByReconciliation) → Released`.
- Adds multi-turn continuation: first attempt fails smoke test → second turn with a stricter prompt against the same workspace, agent sees its prior output (matches Symphony's "Continuation turns SHOULD send only continuation guidance" pattern).
- Adds a versioned `WORKFLOW.md` in the public repo that holds the wrapper-gen prompt template, retry policy, sandbox config, and hooks. Editing it changes orchestrator behavior on the next tick, no rebuild.
- Adds reconciliation: every tick checks if jobs got cancelled out-of-band (via `scout queue cancel <id>`), if Docker died, if claimed jobs are stalled.
- Adds structured observability: every state transition is a logged event with `job_id`, `tool_id`, `state`, `attempt`, `duration_ms`. Drives the TUI dashboard and the `scout queue` commands.

---

## 1. Architecture diff vs v1.0

```
                                  WAS (v1.0):
                                  ─────────────
            Webhook receiver  ──▶ wrapper_requests table
                                              │
            Task Scheduler (every 5 min)      │
            ──▶ scout queue run-next ─────────┘
                                  │
                                  ▼
                            Pop oldest, run wrapper-gen,
                            commit result. One job per tick.

                                  IS (v1.1):
                                  ─────────────
            Webhook receiver  ──▶ wrapper_requests table  ◀─── scout queue cancel
                                              │
                                              │
                            ┌─────────────────┴─────────────────┐
                            │       SymphonyOrchestrator        │  Windows Service
                            │       (long-running daemon)       │  always on
                            │                                   │
                            │   tick() every 10s:               │
                            │     1. Reconcile running jobs     │
                            │        (stall detect, cancel)     │
                            │     2. Preflight (workflow.md ok, │
                            │        Docker ok, claude ok)      │
                            │     3. Fetch candidates           │
                            │     4. Sort by priority + age     │
                            │     5. Dispatch up to N parallel  │
                            │                                   │
                            │   per-job WorkerTask (asyncio):   │
                            │     - prepare workspace           │
                            │     - render prompt from          │
                            │       WORKFLOW.md template        │
                            │     - turn 1: full prompt         │
                            │     - turn 2..N: continuation     │
                            │     - on failure: schedule retry  │
                            │       with exponential backoff    │
                            │                                   │
                            └───────────────────────────────────┘
                                              │
                                              ▼
                            Same Claude Code + Docker sandbox
                            + git_publisher as v1.0
```

---

## 2. The six layers (mapped from Symphony to tool-scout)

| Symphony layer | Tool Scout equivalent | File(s) |
|---|---|---|
| Policy Layer (`WORKFLOW.md`) | `WORKFLOW.md` in repo root with YAML frontmatter + Markdown wrapper-gen prompt body | `WORKFLOW.md` |
| Configuration Layer | Typed config loader with env-var resolution, hot-reload via filesystem watch | `src/tool_scout/queue_worker/workflow_config.py` |
| Coordination Layer (Orchestrator) | Asyncio orchestrator owning job FSM, retry queue, dispatch | `src/tool_scout/queue_worker/orchestrator.py` |
| Execution Layer (Worker Runner) | Per-job task: workspace → prompt → claude turns → smoke → publish | `src/tool_scout/queue_worker/runner.py` |
| Tracker Adapter | Local `wrapper_requests` table accessor (replaces Linear adapter) | `src/tool_scout/queue_worker/tracker.py` |
| Observability Layer | Structured JSONL events + TUI dashboard + HTTP status surface | `src/tool_scout/queue_worker/events.py`, `src/tool_scout/queue_worker/dashboard.py` |

---

## 3. `WORKFLOW.md` — the policy file

Lives at the **repo root**, committed publicly. Edit it without redeploying anything; orchestrator hot-reloads on filesystem change.

```markdown
---
# tracker: where jobs come from
tracker:
  kind: sqlite_local                  # tool-scout's only tracker
  table: wrapper_requests
  active_states: [pending]
  terminal_states: [succeeded, failed, canceled]

# polling: how often to look for work
polling:
  tick_interval_ms: 10000             # 10s — much tighter than v1.0's 5min
  reconcile_every_ticks: 1            # every tick reconciles running jobs

# concurrency: how much parallelism
concurrency:
  max_concurrent_jobs: 2              # 2 wrapper gens at once (Max sub limits)
  max_per_tool_per_24h: 1
  max_global_per_24h: 10

# preflight: gates that must be true before any dispatch
preflight:
  require_docker_running: true
  require_claude_cli: true
  require_git_writable: true
  require_workflow_valid: true

# workspace: per-job isolated directory
workspace:
  root: ~/.tool-scout/workspaces
  retention: keep_until_terminal      # cleanup on success/permanent_fail
  hooks:
    after_create: |
      mkdir -p ./input ./output ./meta
      echo "$JOB_ID" > ./meta/job_id
    before_turn: |
      echo "[$(date -Iseconds)] turn $TURN_NUMBER starting" >> ./meta/turns.log
    after_turn: |
      echo "[$(date -Iseconds)] turn $TURN_NUMBER ended (status=$TURN_STATUS)" >> ./meta/turns.log
    on_success: |
      cp ./output/server.py /tmp/published-wrapper.py
    on_failure: |
      tar czf ./meta/failure-bundle.tgz ./output ./meta
    before_remove: |
      # nothing — we keep workspace until terminal
      true

# agent: the coding-agent runner
agent:
  command: claude
  mode: subprocess_oneshot            # claude -p, JSON output mode
  max_turns: 3                        # turn 1 = first attempt, 2 = retry w/ stricter prompt, 3 = retry w/ even stricter
  per_turn_timeout_s: 300
  stall_timeout_s: 90                 # no output in 90s → kill, schedule retry

# retries: exponential backoff schedule
retries:
  max_attempts: 3
  initial_backoff_s: 30
  max_backoff_s: 600
  retry_on:
    - smoke_test_failed
    - claude_subprocess_error
    - docker_unavailable_transient
  do_not_retry_on:
    - static_scan_blocked              # security guardrail; never retry malicious code
    - rate_limit_exceeded              # caller hit cap; not a real failure
    - workflow_invalid

# sandbox: Docker constraints (already enforced by sandbox.py)
sandbox:
  image: python:3.11-slim
  network: none
  read_only: true
  memory: 256m
  cpus: 0.5
  smoke_timeout_s: 60

# observability: where events go
observability:
  jsonl_log: ~/.tool-scout/logs/orchestrator.jsonl
  http_status_port: 8766              # http://localhost:8766/jobs returns JSON
  tui_dashboard: true                 # `scout queue dashboard` opens it
---

You are generating a minimal MCP server that wraps an existing tool so it can be used from Claude Code.

## Tool to wrap
- Name: {{ tool.name }}
- URL: {{ tool.url }}
- Category: {{ tool.category }}
- Description: {{ tool.description }}
- README excerpt:
{{ tool.readme_excerpt }}
- CLI help output:
{{ tool.help_output | default: "(none captured)" }}

## Requirements
- Use the official Python MCP SDK (`mcp[cli]`).
- Expose 1–5 of the most useful operations as MCP tools.
- Windows-compatible (no `/tmp`, no `shell=True` without escaping).
- Self-contained in a single `server.py` file.
- Start with a uv-runnable shebang: `#!/usr/bin/env -S uv run --script`
- Include inline dependency block (PEP 723) for uv.
- DO NOT use: `os.system`, `subprocess` (except via `shutil.which`), `eval`, `exec`, `socket`, `urllib`, `requests`, or any network call.
- DO NOT write files outside of a `tmp_path` parameter passed into individual tools.

{% if turn_number > 1 %}
## CONTINUATION — this is attempt {{ turn_number }}
The previous attempt failed: {{ previous_failure_reason }}.
Stricter constraints this turn:
{% if previous_failure_reason == 'static_scan_failed' %}
- The previous output contained a forbidden pattern. Re-examine the requirements list above. Do not call out to the OS or network.
{% endif %}
{% if previous_failure_reason == 'smoke_test_failed' %}
- The previous output failed Docker smoke test (likely an import-time error or missing `mcp`/`server` symbol). Verify the file imports cleanly with no side effects and exposes either an `mcp` or `server` top-level symbol.
{% endif %}
{% endif %}

## Output
Output ONLY the complete Python file contents. No prose. No markdown fences. No commentary.
Write the file to `./output/server.py` in the workspace.
```

**Key Symphony patterns reflected:**

- Frontmatter is **typed config** with sensible defaults (validate via Pydantic on load)
- Markdown body is the **agent prompt template**, rendered with Liquid-compatible semantics
- Unknown variables MUST fail rendering (catch typos)
- Turn 2+ continuation includes a `previous_failure_reason` so the agent improves on the next try
- Hooks are **shell scripts** that run in the workspace context; failure of a hook fails the job (configurable)
- Hot reload: file watcher on `WORKFLOW.md`, applies on next tick

---

## 4. Database additions

One new table, no schema changes to existing ones:

```sql
-- Per-job lifecycle event log; single source of truth for the dashboard
CREATE TABLE orchestrator_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          TEXT NOT NULL REFERENCES wrapper_requests(id) ON DELETE CASCADE,
    occurred_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    state           TEXT NOT NULL,        -- unclaimed|claimed|running|turn_started|turn_completed|retry_queued|succeeded|failed|timed_out|stalled|canceled|released
    turn_number     INTEGER,              -- nullable; only on per-turn events
    duration_ms     INTEGER,
    payload_json    TEXT                  -- structured details for that event
);
CREATE INDEX idx_orch_events_job ON orchestrator_events(job_id);
CREATE INDEX idx_orch_events_state ON orchestrator_events(state);
CREATE INDEX idx_orch_events_time ON orchestrator_events(occurred_at);
```

Also extend `wrapper_requests` (additive; in a new Alembic migration `0002_orchestrator.py`):

```sql
ALTER TABLE wrapper_requests ADD COLUMN attempts INTEGER DEFAULT 0;
ALTER TABLE wrapper_requests ADD COLUMN claimed_at TIMESTAMP;
ALTER TABLE wrapper_requests ADD COLUMN claimed_by TEXT;            -- worker pid / id, for distributed expansion
ALTER TABLE wrapper_requests ADD COLUMN workspace_path TEXT;
ALTER TABLE wrapper_requests ADD COLUMN last_event_at TIMESTAMP;    -- for stall detection
ALTER TABLE wrapper_requests ADD COLUMN terminal_reason TEXT;       -- succeeded|smoke_failed|static_scan_blocked|max_retries|timed_out|stalled|canceled
ALTER TABLE wrapper_requests ADD COLUMN priority INTEGER DEFAULT 100;
```

---

## 5. The orchestrator — `queue_worker/orchestrator.py`

```python
# src/tool_scout/queue_worker/orchestrator.py
from __future__ import annotations
import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from tool_scout.queue_worker.workflow_config import WorkflowConfig, load_workflow
from tool_scout.queue_worker.tracker import LocalTracker
from tool_scout.queue_worker.runner import WorkerRunner
from tool_scout.queue_worker.events import emit_event
from tool_scout.usage_tracker import can_call

log = logging.getLogger(__name__)

@dataclass
class RunningJob:
    job_id: str
    task: asyncio.Task
    started_at: datetime
    last_event_at: datetime

class SymphonyOrchestrator:
    """Single source of truth for wrapper job scheduling.

    Owns the poll/dispatch/reconcile loop. Spawns one asyncio task per
    running job. Mutates DB scheduling state; workers report outcomes
    back to it; outcomes become explicit state transitions.
    """

    def __init__(self, workflow_path: Path):
        self.workflow_path = workflow_path
        self.config: WorkflowConfig | None = None
        self.tracker = LocalTracker()
        self.running: dict[str, RunningJob] = {}
        self.retry_until: dict[str, datetime] = {}
        self._workflow_mtime: float = 0.0
        self._stop = asyncio.Event()

    async def run(self):
        """Long-running entrypoint. Started by the Windows service."""
        log.info("orchestrator starting")
        await self._reload_workflow(initial=True)
        await self._startup_cleanup()
        while not self._stop.is_set():
            try:
                await self._tick()
            except Exception:
                log.exception("tick failed; continuing")
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=self.config.polling.tick_interval_ms / 1000,
                )
            except asyncio.TimeoutError:
                pass
        await self._drain()

    async def _tick(self):
        await self._maybe_reload_workflow()
        await self._reconcile()
        if not await self._preflight():
            log.warning("preflight failed; skipping dispatch this tick")
            return
        await self._dispatch()

    # ---- Reconcile ---------------------------------------------------
    async def _reconcile(self):
        """Check running jobs for stalls, cancellations, terminal state."""
        now = datetime.utcnow()
        stall_after = timedelta(seconds=self.config.agent.stall_timeout_s)
        for job_id, run in list(self.running.items()):
            # External cancel check (set by `scout queue cancel`)
            if self.tracker.is_canceled(job_id):
                emit_event(job_id, "canceled", payload={"reason": "external"})
                run.task.cancel()
                self.tracker.mark_terminal(job_id, "canceled")
                self.running.pop(job_id, None)
                continue
            # Stall: no event in stall_timeout_s
            if now - run.last_event_at > stall_after:
                emit_event(job_id, "stalled", payload={"silent_seconds": (now - run.last_event_at).total_seconds()})
                run.task.cancel()
                self._schedule_retry(job_id, reason="stalled")
                self.running.pop(job_id, None)

    # ---- Preflight ---------------------------------------------------
    async def _preflight(self) -> bool:
        if not self.config:
            return False
        for check in self.config.preflight.checks:
            if not check.run():
                emit_event("__system__", "preflight_failed", payload={"check": check.name})
                return False
        return True

    # ---- Dispatch ----------------------------------------------------
    async def _dispatch(self):
        slots = self.config.concurrency.max_concurrent_jobs - len(self.running)
        if slots <= 0:
            return
        # Soft cap from Max-subscription window
        ok, _ = can_call("wrapper_gen")
        if not ok:
            return
        # Eligible candidates from tracker
        candidates = self.tracker.fetch_candidates(
            states=self.config.tracker.active_states,
            limit=slots * 3,                      # over-fetch; some may fail eligibility
        )
        candidates.sort(key=lambda c: (c.priority, c.requested_at, c.id))
        dispatched = 0
        for cand in candidates:
            if dispatched >= slots:
                break
            if cand.id in self.running:
                continue
            if cand.id in self.retry_until and self.retry_until[cand.id] > datetime.utcnow():
                continue
            if not self._eligible(cand):
                continue
            await self._claim_and_run(cand)
            dispatched += 1

    def _eligible(self, cand) -> bool:
        # Per-tool, per-IP, global caps already enforced at receiver;
        # orchestrator just trusts the queue. Add additional per-this-process
        # eligibility if needed.
        return True

    async def _claim_and_run(self, cand):
        self.tracker.claim(cand.id, claimed_by=str(id(self)))
        emit_event(cand.id, "claimed")
        runner = WorkerRunner(self.config, cand)
        task = asyncio.create_task(self._supervise(runner, cand.id))
        self.running[cand.id] = RunningJob(
            job_id=cand.id, task=task,
            started_at=datetime.utcnow(),
            last_event_at=datetime.utcnow(),
        )

    async def _supervise(self, runner: WorkerRunner, job_id: str):
        try:
            outcome = await runner.run(
                on_event=lambda ev: self._on_worker_event(job_id, ev)
            )
            if outcome.success:
                self.tracker.mark_terminal(job_id, "succeeded", result_url=outcome.result_url)
                emit_event(job_id, "succeeded", duration_ms=outcome.duration_ms)
            else:
                if outcome.retry_eligible and self._can_retry(job_id):
                    self._schedule_retry(job_id, reason=outcome.reason)
                else:
                    self.tracker.mark_terminal(job_id, outcome.reason or "failed", error=outcome.error)
                    emit_event(job_id, "failed", payload={"reason": outcome.reason})
        except asyncio.CancelledError:
            log.info("job %s cancelled", job_id)
        except Exception as exc:
            log.exception("supervisor error for job %s", job_id)
            self.tracker.mark_terminal(job_id, "failed", error=repr(exc))
            emit_event(job_id, "failed", payload={"reason": "supervisor_exception", "error": repr(exc)})
        finally:
            self.running.pop(job_id, None)

    def _on_worker_event(self, job_id: str, event: dict):
        if job_id in self.running:
            self.running[job_id].last_event_at = datetime.utcnow()
        emit_event(job_id, event["state"], turn_number=event.get("turn"), payload=event.get("payload"))

    # ---- Retry -------------------------------------------------------
    def _can_retry(self, job_id: str) -> bool:
        attempts = self.tracker.get_attempts(job_id)
        return attempts < self.config.retries.max_attempts

    def _schedule_retry(self, job_id: str, reason: str):
        attempts = self.tracker.get_attempts(job_id)
        delay_s = min(
            self.config.retries.initial_backoff_s * (2 ** attempts),
            self.config.retries.max_backoff_s,
        )
        self.retry_until[job_id] = datetime.utcnow() + timedelta(seconds=delay_s)
        self.tracker.release_for_retry(job_id)
        emit_event(job_id, "retry_queued", payload={"reason": reason, "delay_s": delay_s, "attempt": attempts + 1})

    # ---- Workflow hot reload ----------------------------------------
    async def _maybe_reload_workflow(self):
        try:
            mtime = self.workflow_path.stat().st_mtime
            if mtime > self._workflow_mtime:
                await self._reload_workflow()
        except FileNotFoundError:
            log.error("WORKFLOW.md missing; orchestrator will not dispatch")
            self.config = None

    async def _reload_workflow(self, initial: bool = False):
        try:
            new_config = load_workflow(self.workflow_path)
        except Exception as exc:
            log.error("workflow reload failed: %s; keeping previous config", exc)
            if initial:
                raise
            return
        self.config = new_config
        self._workflow_mtime = self.workflow_path.stat().st_mtime
        log.info("workflow loaded (initial=%s)", initial)

    # ---- Startup cleanup --------------------------------------------
    async def _startup_cleanup(self):
        """Reset any jobs stuck in 'running' from a previous crash."""
        stuck = self.tracker.fetch_stuck_running()
        for s in stuck:
            self.tracker.release_for_retry(s.id)
            emit_event(s.id, "released", payload={"reason": "startup_recovery"})

    async def _drain(self):
        for job_id, run in list(self.running.items()):
            run.task.cancel()
        await asyncio.gather(*(r.task for r in self.running.values()), return_exceptions=True)
```

---

## 6. The worker runner — `queue_worker/runner.py`

```python
# src/tool_scout/queue_worker/runner.py
from __future__ import annotations
import asyncio
import logging
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable, Optional

from tool_scout.claude_client import ClaudeClient
from tool_scout.installer.sandbox import run_smoke_test
from tool_scout.installer.static_scan import scan
from tool_scout.git_publisher import GitPublisher
from tool_scout.queue_worker.workflow_config import WorkflowConfig
from tool_scout.queue_worker.template import render_workflow_prompt
from tool_scout.queue_worker.hooks import run_hook

log = logging.getLogger(__name__)

@dataclass
class WorkerOutcome:
    success: bool
    duration_ms: int
    result_url: Optional[str] = None
    reason: Optional[str] = None        # smoke_test_failed | static_scan_blocked | claude_error | ...
    retry_eligible: bool = False
    error: Optional[str] = None

class WorkerRunner:
    """Runs one wrapper-generation job, possibly across multiple turns."""

    def __init__(self, config: WorkflowConfig, candidate):
        self.config = config
        self.cand = candidate
        self.workspace = Path(config.workspace.root).expanduser() / candidate.id
        self.claude = ClaudeClient(workdir=self.workspace)
        self.publisher = GitPublisher.from_env()

    async def run(self, on_event: Callable[[dict], Awaitable[None] | None]) -> WorkerOutcome:
        t0 = time.monotonic()
        try:
            await self._prepare_workspace(on_event)

            previous_failure: Optional[str] = None
            for turn in range(1, self.config.agent.max_turns + 1):
                await self._emit(on_event, "turn_started", turn=turn)
                await run_hook(self.config.workspace.hooks.before_turn,
                               cwd=self.workspace, env=self._hook_env(turn))

                prompt = render_workflow_prompt(
                    template_body=self.config.prompt_body,
                    tool=self.cand.tool,
                    turn_number=turn,
                    previous_failure_reason=previous_failure,
                )

                # 1. Generate
                wrapper_path = self.workspace / "output" / "server.py"
                try:
                    duration = await asyncio.wait_for(
                        asyncio.to_thread(self.claude.ask_file, prompt, wrapper_path),
                        timeout=self.config.agent.per_turn_timeout_s,
                    )
                except asyncio.TimeoutError:
                    await self._emit(on_event, "turn_completed", turn=turn, payload={"status": "timeout"})
                    previous_failure = "timeout"
                    continue
                except Exception as exc:
                    await self._emit(on_event, "turn_completed", turn=turn, payload={"status": "claude_error", "error": repr(exc)})
                    return WorkerOutcome(success=False, duration_ms=int((time.monotonic()-t0)*1000),
                                         reason="claude_subprocess_error", retry_eligible=True, error=repr(exc))

                # 2. Static scan (security guardrail; never retry on hits)
                code = wrapper_path.read_text()
                clean, hits = scan(code)
                if not clean:
                    await self._emit(on_event, "turn_completed", turn=turn,
                                     payload={"status": "static_scan_blocked", "hits": hits})
                    await run_hook(self.config.workspace.hooks.on_failure, cwd=self.workspace, env=self._hook_env(turn))
                    return WorkerOutcome(success=False, duration_ms=int((time.monotonic()-t0)*1000),
                                         reason="static_scan_blocked", retry_eligible=False)

                # 3. Sandbox smoke test
                passed, smoke_log = run_smoke_test(wrapper_path)
                if not passed:
                    await self._emit(on_event, "turn_completed", turn=turn,
                                     payload={"status": "smoke_test_failed", "smoke_log_tail": smoke_log[-500:]})
                    previous_failure = "smoke_test_failed"
                    await run_hook(self.config.workspace.hooks.after_turn, cwd=self.workspace, env=self._hook_env(turn, status="smoke_failed"))
                    continue   # try next turn

                # 4. Success — publish
                await run_hook(self.config.workspace.hooks.on_success, cwd=self.workspace, env=self._hook_env(turn, status="success"))
                result_url = await asyncio.to_thread(self._publish, wrapper_path)
                await self._emit(on_event, "turn_completed", turn=turn, payload={"status": "success"})
                return WorkerOutcome(success=True, duration_ms=int((time.monotonic()-t0)*1000),
                                     result_url=result_url)

            # exhausted all turns
            await run_hook(self.config.workspace.hooks.on_failure, cwd=self.workspace, env=self._hook_env(self.config.agent.max_turns))
            return WorkerOutcome(success=False, duration_ms=int((time.monotonic()-t0)*1000),
                                 reason="max_turns_exhausted", retry_eligible=True)
        finally:
            # workspace retained per config; orchestrator decides whether to remove
            pass

    # helpers
    async def _prepare_workspace(self, on_event):
        if self.workspace.exists():
            shutil.rmtree(self.workspace)
        self.workspace.mkdir(parents=True)
        await run_hook(self.config.workspace.hooks.after_create, cwd=self.workspace, env=self._hook_env(0))
        await self._emit(on_event, "workspace_ready")

    def _publish(self, wrapper_path: Path) -> str:
        repo_target = Path(self.publisher.repo_path) / "web" / "public" / "wrappers" / self.cand.tool.id / "server.py"
        repo_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(wrapper_path, repo_target)
        self.publisher.publish_data(
            message=f"feat(wrapper): {self.cand.tool.name} ({self.cand.id})",
            paths=[str(repo_target.relative_to(self.publisher.repo_path))],
        )
        return f"/wrappers/{self.cand.tool.id}/server.py"

    async def _emit(self, on_event, state: str, turn: int | None = None, payload: dict | None = None):
        evt = {"state": state, "turn": turn, "payload": payload or {}}
        result = on_event(evt)
        if asyncio.iscoroutine(result):
            await result

    def _hook_env(self, turn: int, status: str = "running") -> dict:
        return {
            "JOB_ID": self.cand.id,
            "TOOL_ID": self.cand.tool.id,
            "TURN_NUMBER": str(turn),
            "TURN_STATUS": status,
        }
```

---

## 7. The tracker — `queue_worker/tracker.py`

Symphony's `LinearAdapter` becomes our local SQLite accessor. Same shape — `fetch_candidates`, `claim`, `mark_terminal`, `release_for_retry`, `is_canceled`, `fetch_stuck_running`. Implementation is straightforward SQLAlchemy against `wrapper_requests`. Key methods:

```python
class LocalTracker:
    def fetch_candidates(self, states: list[str], limit: int) -> list[Candidate]: ...
    def claim(self, job_id: str, claimed_by: str) -> None: ...
    def mark_terminal(self, job_id: str, reason: str, **kwargs) -> None: ...
    def release_for_retry(self, job_id: str) -> None: ...
    def is_canceled(self, job_id: str) -> bool: ...
    def fetch_stuck_running(self) -> list[Candidate]: ...
    def get_attempts(self, job_id: str) -> int: ...
```

---

## 8. Workflow config loader — `queue_worker/workflow_config.py`

Pydantic models for typed config, Liquid template engine for the prompt body.

```python
# src/tool_scout/queue_worker/workflow_config.py
from __future__ import annotations
import os
import re
from pathlib import Path
from typing import Optional
import yaml
from pydantic import BaseModel, Field, field_validator

ENV_VAR_RE = re.compile(r"\$([A-Z_][A-Z0-9_]*)")

def _resolve_env(value):
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
    active_states: list[str] = ["pending"]
    terminal_states: list[str] = ["succeeded", "failed", "canceled"]

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
    hooks: HooksConfig = HooksConfig()

class AgentConfig(BaseModel):
    command: str = "claude"
    mode: str = "subprocess_oneshot"
    max_turns: int = 3
    per_turn_timeout_s: int = 300
    stall_timeout_s: int = 90

class RetriesConfig(BaseModel):
    max_attempts: int = 3
    initial_backoff_s: int = 30
    max_backoff_s: int = 600
    retry_on: list[str] = ["smoke_test_failed", "claude_subprocess_error"]
    do_not_retry_on: list[str] = ["static_scan_blocked", "rate_limit_exceeded"]

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
    require_claude_cli: bool = True
    require_git_writable: bool = True
    require_workflow_valid: bool = True

    @property
    def checks(self):
        from tool_scout.queue_worker.preflight import build_checks
        return build_checks(self)

class WorkflowConfig(BaseModel):
    tracker: TrackerConfig = TrackerConfig()
    polling: PollingConfig = PollingConfig()
    concurrency: ConcurrencyConfig = ConcurrencyConfig()
    preflight: PreflightConfig = PreflightConfig()
    workspace: WorkspaceConfig = WorkspaceConfig()
    agent: AgentConfig = AgentConfig()
    retries: RetriesConfig = RetriesConfig()
    sandbox: SandboxConfig = SandboxConfig()
    observability: ObservabilityConfig = ObservabilityConfig()
    prompt_body: str = ""        # the markdown body

def load_workflow(path: Path) -> WorkflowConfig:
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        raise ValueError("WORKFLOW.md missing YAML front matter")
    parts = raw.split("---", 2)
    if len(parts) < 3:
        raise ValueError("WORKFLOW.md malformed: expected `---\\nyaml\\n---\\nbody`")
    front = yaml.safe_load(parts[1]) or {}
    front = _resolve_env(front)
    body = parts[2].strip()
    cfg = WorkflowConfig(**front, prompt_body=body)
    return cfg
```

---

## 9. Liquid prompt rendering — `queue_worker/template.py`

Symphony specifies "Liquid-compatible semantics" with strict mode (unknown variables/filters fail). Use the `liquid` Python package.

```python
# src/tool_scout/queue_worker/template.py
from liquid import Environment, StrictUndefined

env = Environment(undefined=StrictUndefined)

def render_workflow_prompt(template_body: str, tool, turn_number: int,
                            previous_failure_reason: str | None) -> str:
    template = env.from_string(template_body)
    return template.render(
        tool={
            "id": tool.id,
            "name": tool.name,
            "url": tool.url,
            "category": tool.category,
            "description": tool.description,
            "readme_excerpt": tool.readme_excerpt,
            "help_output": getattr(tool, "help_output", None),
        },
        turn_number=turn_number,
        previous_failure_reason=previous_failure_reason,
    )
```

Add `python-liquid` to `pyproject.toml` dependencies.

---

## 10. Hooks — `queue_worker/hooks.py`

Hooks run in the workspace's working directory with controlled environment. Failure of `on_success`/`on_failure` is logged but doesn't fail the job; failure of `after_create`/`before_turn` does fail the job.

```python
# src/tool_scout/queue_worker/hooks.py
import asyncio
from pathlib import Path

async def run_hook(script: str, cwd: Path, env: dict, timeout_s: int = 60) -> tuple[bool, str]:
    if not script.strip():
        return True, ""
    full_env = {**os.environ, **env}
    proc = await asyncio.create_subprocess_shell(
        script, cwd=str(cwd), env=full_env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        return False, f"hook timeout after {timeout_s}s"
    return proc.returncode == 0, stdout.decode("utf-8", errors="replace")
```

On Windows, hooks run via `cmd /c` (not `bash -lc`). Document in `WORKFLOW.md` comments that hook scripts should be portable PowerShell or trivial commands.

---

## 11. Events + observability — `queue_worker/events.py`

```python
# src/tool_scout/queue_worker/events.py
import json
import logging
from datetime import datetime
from pathlib import Path
from tool_scout.db import SessionLocal
from tool_scout.models import OrchestratorEvent

log = logging.getLogger("orchestrator.events")

def emit_event(job_id: str, state: str, *,
               turn_number: int | None = None,
               duration_ms: int | None = None,
               payload: dict | None = None):
    """Write to DB + JSONL + structured log."""
    record = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "job_id": job_id,
        "state": state,
        "turn_number": turn_number,
        "duration_ms": duration_ms,
        "payload": payload or {},
    }
    log.info(json.dumps(record))
    if job_id != "__system__":
        with SessionLocal() as s:
            s.add(OrchestratorEvent(
                job_id=job_id, state=state,
                turn_number=turn_number, duration_ms=duration_ms,
                payload_json=json.dumps(payload or {}),
            ))
            s.commit()
```

### 11.1 HTTP status surface

A tiny FastAPI app on port 8766 exposing `/jobs`, `/jobs/<id>`, `/events?since=ts`. Read-only. Localhost-bound. Not exposed via ngrok. Powers the TUI dashboard and any future web monitoring.

### 11.2 TUI dashboard — `scout queue dashboard`

Uses `rich.live` to render a refreshing table:

```
┌─ Tool Scout Orchestrator ─────────────────────────────────────────────────┐
│ Tick interval: 10s · Concurrency: 2/2 · Workflow: WORKFLOW.md (v 4 mins ago) │
├──────────┬──────────────────────────┬─────────┬──────┬─────────┬──────────┤
│ Job      │ Tool                     │ State   │ Turn │ Elapsed │ Last evt │
├──────────┼──────────────────────────┼─────────┼──────┼─────────┼──────────┤
│ ab12cd   │ awesome-mcp-server       │ running │ 2/3  │ 1m 42s  │ 4s ago   │
│ ef34gh   │ hytale-asset-tool        │ running │ 1/3  │   23s   │ 2s ago   │
│ ij56kl   │ vram-budget-calculator   │ retry…  │ —    │   —     │ 12s ago  │
├──────────┴──────────────────────────┴─────────┴──────┴─────────┴──────────┤
│ Recent events:                                                             │
│  04:21:18  ab12cd  smoke_test_failed (turn 1)                              │
│  04:21:19  ab12cd  turn_started (turn 2)                                   │
│  04:21:42  ef34gh  workspace_ready                                         │
└────────────────────────────────────────────────────────────────────────────┘
[q] quit   [c] cancel job   [r] retry   [w] reload workflow
```

---

## 12. CLI additions

Append to `scout queue …` family from v1.0 §56:

```
scout orchestrator start             # start the orchestrator (foreground; for debug)
scout orchestrator status            # is service running, last tick, current jobs
scout orchestrator reload            # touch WORKFLOW.md to trigger reload
scout queue dashboard                # TUI dashboard (rich.live)
scout queue events <job_id>          # full event log for a job
scout workflow validate              # parse WORKFLOW.md, report errors without applying
scout workflow show                  # dump effective resolved config
```

Keep these v1.0 commands but adapt them:

- `scout queue run-next` — **deprecated.** Orchestrator handles dispatch. Command now prints a deprecation note and explains how to start the orchestrator service.
- `scout queue list` / `scout queue show` / `scout queue cancel` / `scout queue retry` / `scout queue blacklist` — unchanged behavior, now backed by orchestrator events.

---

## 13. Windows Service installation

The orchestrator runs as a Windows Service (replaces the v1.0 every-5-min Task Scheduler job for the queue worker).

New script: `scripts/install_orchestrator_service.ps1`

Use **NSSM** (Non-Sucking Service Manager — the standard way to wrap a Python process as a Windows Service for free). Add to platform prerequisites in v1.0 §6.

```powershell
# scripts/install_orchestrator_service.ps1
$serviceName = "ToolScoutOrchestrator"
$exePath = (Get-Command pwsh).Source
$args = "-NoProfile -Command `"scout orchestrator start`""

# Install via NSSM (assume nssm.exe is on PATH from setup)
nssm install $serviceName $exePath $args
nssm set $serviceName AppDirectory $env:USERPROFILE
nssm set $serviceName AppStdout "$env:USERPROFILE\.tool-scout\logs\orchestrator-stdout.log"
nssm set $serviceName AppStderr "$env:USERPROFILE\.tool-scout\logs\orchestrator-stderr.log"
nssm set $serviceName AppRotateFiles 1
nssm set $serviceName AppRotateBytes 10485760     # 10 MB
nssm set $serviceName Start SERVICE_AUTO_START
nssm set $serviceName AppExit Default Restart
nssm set $serviceName AppRestartDelay 5000        # 5s before restart on crash

Start-Service $serviceName
```

`scout schedule install orchestrator` invokes this script.

**Removed from v1.0:** `scripts/install_queue_worker_task.ps1` and the `ToolScoutQueueWorker` Task Scheduler job — the orchestrator service replaces both.

---

## 14. Pre-flight additions

Add to `TOOL_SCOUT_SETUP.md` Part 1:

### 1.8 NSSM (Non-Sucking Service Manager)

```powershell
nssm version
# Expected: 2.24 or newer
```

If missing: `winget install NSSM.NSSM` or download from https://nssm.cc/download.

---

## 15. Definition of Done — additions

Append to v1.0 §64:

21. ✅ `WORKFLOW.md` exists at repo root, validates with `scout workflow validate`.
22. ✅ Editing `WORKFLOW.md` (e.g. changing `tick_interval_ms` from 10000 to 5000) takes effect within one tick without restarting the service. `scout orchestrator status` shows the new interval.
23. ✅ Orchestrator runs as Windows Service `ToolScoutOrchestrator`; survives reboot; `Get-Service ToolScoutOrchestrator` shows Running.
24. ✅ `scout queue dashboard` renders a live updating TUI with current jobs, tick counter, recent events.
25. ✅ Job lifecycle: a forced-failure wrapper-gen (e.g. tool with deliberately confusing README) goes `claimed → running → turn_started(1) → turn_completed(smoke_failed) → turn_started(2) → turn_completed(success) → succeeded`. Verify in `scout queue events <id>`.
26. ✅ Static-scan-blocked jobs do NOT retry (verify by submitting a tool whose README would tempt the agent to use `subprocess` — should fail at turn 1 with `static_scan_blocked` and stop).
27. ✅ Stall test: kill a Claude subprocess externally mid-turn → orchestrator detects via stall_timeout_s → `stalled` event → retry scheduled with backoff.
28. ✅ External cancel test: `scout queue cancel <id>` while job is running → orchestrator detects in next reconcile → worker task cancelled → `canceled` event → terminal state.
29. ✅ Startup recovery: kill orchestrator service while jobs are running → restart service → previously-running jobs are released for retry, no jobs left in stuck `running` state.
30. ✅ Hot reload of bad WORKFLOW.md: introduce a YAML syntax error → orchestrator logs error, continues with last good config, refuses to dispatch new jobs until fixed (existing jobs continue).

---

## 16. Build order — adjusted Phase 11

Replace v1.0 Phase 11 with this expanded version:

| Sub-phase | Work | Hours |
|---|---|---|
| 11a | ngrok setup + webhook receiver (unchanged from v1.0 §39) | 2 |
| 11b | Alembic migration `0002_orchestrator.py` + `OrchestratorEvent` model + `wrapper_requests` columns | 1 |
| 11c | `WorkflowConfig` + Liquid template + `WORKFLOW.md` written and validated | 2 |
| 11d | `LocalTracker` adapter | 1 |
| 11e | `WorkerRunner` + hooks + integration with existing sandbox/static_scan/git_publisher | 3 |
| 11f | `SymphonyOrchestrator` (poll/dispatch/reconcile) + retry logic | 3 |
| 11g | Events + JSONL log + HTTP status surface | 2 |
| 11h | `scout queue dashboard` TUI | 2 |
| 11i | NSSM service install + reboot test | 1 |
| 11j | End-to-end test against Definition of Done items 25–30 | 2 |

**Total: ~19 hours = 2.5 days.** Net +1.5 days vs v1.0 Phase 11.

Build at the **gate point** (after v1.0 Phase 10's web app review) — same gate as before, just expanded scope.

---

## 17. What v1.0 sections are deprecated

| v1.0 section | v1.1 disposition |
|---|---|
| §38 ngrok setup | unchanged |
| §39 webhook receiver | unchanged |
| §40 Worker loop pseudocode | **replaced** by §5 + §6 above |
| §41 Rate limits | unchanged (still enforced at receiver) |
| §42 Offline handling | unchanged |
| §57 `install_crawl_task.ps1` | unchanged |
| §58 `install_queue_worker_task.ps1` | **removed** — replaced by orchestrator service |
| §59 `install_backup_task.ps1` | unchanged |
| §60 ngrok service install | unchanged |
| §66 v1.1 candidates | one item ("Email/Discord notifications for S-tier finds") still applies; the orchestrator pattern can be reused for the daily crawl in v1.2 if useful |

---

## 18. What this buys you (honest accounting)

**Real wins:**

- **Multi-turn continuation.** v1.0 retries an entire job from scratch on smoke failure. v1.1 keeps the workspace, tells Claude *why* the previous turn failed, and asks for a stricter version. Symphony's design choice. Higher first-week success rate (estimate: 50% → 70%).
- **Editable behavior without redeploy.** Change the prompt, retry policy, concurrency, hook scripts → just edit `WORKFLOW.md`, save, orchestrator reloads. Currently requires git push + Vercel deploy + scheduled task restart.
- **Real observability.** Every state change is a structured event. `scout queue events <id>` gives you a per-job timeline. The TUI dashboard shows the system at a glance instead of grepping logs.
- **Proper FSM.** The v1.0 worker had implicit state in code paths. v1.1 makes states explicit (`claimed`, `running`, `retry_queued`, etc.) so reconciliation, recovery, and metrics are tractable.
- **Stall + cancel handling.** v1.0 had no real way to detect a stuck job or honor an out-of-band cancel. v1.1 reconciles every tick.
- **Future-proof for parallelism.** Symphony's pattern scales to N concurrent workers cleanly. v1.0's single-job-per-tick model would have needed a rewrite to add parallelism.

**Honest costs:**

- **+1.5 days of build.** Real time, not guesswork.
- **One more dependency to install (NSSM)** to run as a proper Windows Service.
- **One more dependency to install (`python-liquid`).**
- **Worth understanding asyncio.** The orchestrator and runner are async. Not exotic, but the developer touching this code should be comfortable with `async`/`await` and `asyncio.Task`.
- **The crawler is unchanged.** This integration deliberately doesn't Symphony-ize the daily crawl. If you wanted that too, it would be a separate v1.2 effort and would cost more than it saves (the crawl is well-served by a synchronous batch).

**What it doesn't fix:**

- Wrapper quality is still bounded by Claude's output quality. Multi-turn continuation gives more shots at the basket; it doesn't make Claude smarter.
- ngrok is still a single point of failure for webhook ingress. Symphony pattern doesn't help here.
- Max-subscription rate limits are still real. Higher concurrency in `WORKFLOW.md` will hit them faster.

---

## 19. Migration path from v1.0

If v1.0 is already partially built when you adopt v1.1:

1. **Phases 1–10:** unchanged. Keep building per v1.0.
2. **Phase 11:** when you reach it, follow §16 above (the expanded sub-phases) instead of v1.0 §38–§42.
3. **Phase 12:** drop the install of `ToolScoutQueueWorker` task (since service replaces it). Everything else in Phase 12 stands.

If v1.0 is fully built and running:

1. Add migration `0002_orchestrator.py` and apply.
2. Build the orchestrator + worker per §5–§11.
3. Stop and remove the `ToolScoutQueueWorker` Task Scheduler job.
4. Install the orchestrator service.
5. Verify Definition of Done items 21–30.

---

## 20. Update to handoff bundle

When delivering this to Claude Code, include both files:

- `TOOL_SCOUT_SPEC.md` (v1.0 — unchanged)
- `TOOL_SCOUT_SPEC_v1.1_SYMPHONY.md` (this file)

Update the build prompt to add at the end:

> "Phase 11 must follow `TOOL_SCOUT_SPEC_v1.1_SYMPHONY.md` §16 sub-phases instead of v1.0 §38–§42. All Definition of Done items from both v1.0 §64 and v1.1 §15 must pass."

Update setup prerequisites: install NSSM (v1.1 §14).

---

**End of v1.1 supplement.**
