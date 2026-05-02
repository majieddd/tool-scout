"""Orchestrator event emitter — JSONL file + DB row + structured log.
docs/02_SPEC_v1.1_SYMPHONY.md §11.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from tool_scout.db import SessionLocal
from tool_scout.models import OrchestratorEvent

log = logging.getLogger("queue.events")

JSONL_DEFAULT = Path.home() / ".tool-scout" / "logs" / "orchestrator.jsonl"


def _jsonl_path() -> Path:
    return Path(os.environ.get("ORCHESTRATOR_JSONL", str(JSONL_DEFAULT)))


def emit_event(
    job_id: str,
    state: str,
    *,
    turn_number: int | None = None,
    duration_ms: int | None = None,
    payload: dict | None = None,
) -> None:
    record = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "job_id": job_id,
        "state": state,
        "turn_number": turn_number,
        "duration_ms": duration_ms,
        "payload": payload or {},
    }
    log.info(json.dumps(record))
    # JSONL append
    p = _jsonl_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    # DB row (skip system events that aren't tied to a real job)
    if job_id != "__system__":
        try:
            with SessionLocal() as s:
                s.add(OrchestratorEvent(
                    job_id=job_id,
                    state=state,
                    turn_number=turn_number,
                    duration_ms=duration_ms,
                    payload_json=json.dumps(payload or {}),
                ))
                s.commit()
        except Exception as e:  # noqa: BLE001
            log.warning("failed to persist event %s/%s: %s", job_id, state, e)
