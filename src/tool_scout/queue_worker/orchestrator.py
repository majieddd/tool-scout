"""SymphonyOrchestrator — single source of truth for wrapper job scheduling
(docs/02_SPEC_v1.1_SYMPHONY.md §5).

Long-running asyncio loop. Owns the job FSM, retry queue, dispatch. Spawns
one asyncio task per running job. Hot-reloads WORKFLOW.md on filesystem change.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from tool_scout.queue_worker.events import emit_event
from tool_scout.queue_worker.preflight import build_checks
from tool_scout.queue_worker.runner import WorkerRunner
from tool_scout.queue_worker.tracker import LocalTracker
from tool_scout.queue_worker.workflow_config import WorkflowConfig, load_workflow

log = logging.getLogger("queue")


@dataclass
class RunningJob:
    job_id: str
    task: asyncio.Task
    started_at: datetime
    last_event_at: datetime


class SymphonyOrchestrator:
    def __init__(self, workflow_path: Path):
        self.workflow_path = Path(workflow_path)
        self.config: WorkflowConfig | None = None
        self.tracker = LocalTracker()
        self.running: dict[str, RunningJob] = {}
        self.retry_until: dict[str, datetime] = {}
        self._workflow_mtime: float = 0.0
        self._stop = asyncio.Event()
        self._tick_count = 0

    async def run(self) -> None:
        log.info("orchestrator starting (workflow=%s)", self.workflow_path)
        await self._reload_workflow(initial=True)
        await self._startup_cleanup()
        while not self._stop.is_set():
            try:
                await self._tick()
            except Exception:
                log.exception("tick failed; continuing")
            self._tick_count += 1
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=(self.config.polling.tick_interval_ms if self.config else 10_000) / 1000,
                )
            except asyncio.TimeoutError:
                pass
        await self._drain()

    def stop(self) -> None:
        self._stop.set()

    async def _tick(self) -> None:
        await self._maybe_reload_workflow()
        if self.config is None:
            return
        await self._reconcile()
        if not await self._preflight():
            return
        await self._dispatch()

    # ---- reconcile ---------------------------------------------------
    async def _reconcile(self) -> None:
        if self.config is None:
            return
        now = datetime.utcnow()
        stall_after = timedelta(seconds=self.config.agent.stall_timeout_s)
        for job_id, run in list(self.running.items()):
            if self.tracker.is_canceled(job_id):
                emit_event(job_id, "canceled", payload={"reason": "external"})
                run.task.cancel()
                self.tracker.mark_terminal(job_id, "canceled")
                self.running.pop(job_id, None)
                continue
            if now - run.last_event_at > stall_after:
                emit_event(job_id, "stalled",
                           payload={"silent_seconds": (now - run.last_event_at).total_seconds()})
                run.task.cancel()
                self._schedule_retry(job_id, reason="stalled")
                self.running.pop(job_id, None)

    # ---- preflight ---------------------------------------------------
    async def _preflight(self) -> bool:
        if self.config is None:
            return False
        for check in build_checks(self.config.preflight):
            try:
                if not check.run():
                    emit_event("__system__", "preflight_failed", payload={"check": check.name})
                    return False
            except Exception as e:  # noqa: BLE001
                emit_event("__system__", "preflight_error", payload={"check": check.name, "error": repr(e)})
                return False
        return True

    # ---- dispatch ----------------------------------------------------
    async def _dispatch(self) -> None:
        if self.config is None:
            return
        slots = self.config.concurrency.max_concurrent_jobs - len(self.running)
        if slots <= 0:
            return
        candidates = self.tracker.fetch_candidates(
            states=self.config.tracker.active_states, limit=slots * 3,
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
            await self._claim_and_run(cand)
            dispatched += 1

    async def _claim_and_run(self, cand) -> None:
        if not self.tracker.claim(cand.id, claimed_by=str(id(self))):
            return
        emit_event(cand.id, "claimed")
        runner = WorkerRunner(self.config, cand)
        task = asyncio.create_task(self._supervise(runner, cand.id))
        self.running[cand.id] = RunningJob(
            job_id=cand.id, task=task,
            started_at=datetime.utcnow(),
            last_event_at=datetime.utcnow(),
        )

    async def _supervise(self, runner: WorkerRunner, job_id: str) -> None:
        try:
            outcome = await runner.run(
                on_event=lambda ev: self._on_worker_event(job_id, ev)
            )
            if outcome.success:
                self.tracker.mark_terminal(job_id, "succeeded", result_url=outcome.result_url)
                emit_event(job_id, "succeeded", duration_ms=outcome.duration_ms)
            else:
                if outcome.retry_eligible and self._can_retry(job_id):
                    self._schedule_retry(job_id, reason=outcome.reason or "unknown")
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

    def _on_worker_event(self, job_id: str, event: dict) -> None:
        if job_id in self.running:
            self.running[job_id].last_event_at = datetime.utcnow()
        emit_event(job_id, event["state"], turn_number=event.get("turn"), payload=event.get("payload"))

    # ---- retry -------------------------------------------------------
    def _can_retry(self, job_id: str) -> bool:
        if self.config is None:
            return False
        return self.tracker.get_attempts(job_id) < self.config.retries.max_attempts

    def _schedule_retry(self, job_id: str, reason: str) -> None:
        if self.config is None:
            return
        attempts = self.tracker.get_attempts(job_id)
        delay_s = min(
            self.config.retries.initial_backoff_s * (2 ** attempts),
            self.config.retries.max_backoff_s,
        )
        self.retry_until[job_id] = datetime.utcnow() + timedelta(seconds=delay_s)
        self.tracker.release_for_retry(job_id)
        emit_event(job_id, "retry_queued",
                   payload={"reason": reason, "delay_s": delay_s, "attempt": attempts + 1})

    # ---- workflow hot reload ----------------------------------------
    async def _maybe_reload_workflow(self) -> None:
        try:
            mtime = self.workflow_path.stat().st_mtime
            if mtime > self._workflow_mtime:
                await self._reload_workflow()
        except FileNotFoundError:
            log.error("WORKFLOW.md missing; orchestrator will not dispatch")
            self.config = None

    async def _reload_workflow(self, initial: bool = False) -> None:
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

    # ---- startup cleanup --------------------------------------------
    async def _startup_cleanup(self) -> None:
        stuck = self.tracker.fetch_stuck_running()
        for s in stuck:
            self.tracker.release_for_retry(s.id)
            emit_event(s.id, "released", payload={"reason": "startup_recovery"})

    async def _drain(self) -> None:
        for run in self.running.values():
            run.task.cancel()
        await asyncio.gather(*(r.task for r in self.running.values()), return_exceptions=True)
