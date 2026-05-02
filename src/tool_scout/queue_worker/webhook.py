"""FastAPI webhook receiver — port 8765, behind ngrok (docs/01_SPEC.md §39).

Validates X-Scout-Secret header against env, inserts a wrapper_requests row,
returns the new job_id. Status endpoint reads back from DB.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from tool_scout.db import SessionLocal
from tool_scout.models import Tool, WrapperRequest

app = FastAPI(title="Tool Scout webhook receiver")


class EnqueuePayload(BaseModel):
    tool_id: str
    requester_ip: str
    requester_hash: str
    recaptcha_score: float | None = None


def _check_secret(provided: str | None) -> None:
    expected = os.environ.get("WEBHOOK_SHARED_SECRET")
    if not expected:
        raise HTTPException(503, "WEBHOOK_SHARED_SECRET not set on worker")
    if provided != expected:
        raise HTTPException(403, "bad secret")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/enqueue")
def enqueue(payload: EnqueuePayload, x_scout_secret: str = Header(None)):
    _check_secret(x_scout_secret)
    job_id = uuid.uuid4().hex
    with SessionLocal() as s:
        if not s.get(Tool, payload.tool_id):
            raise HTTPException(404, "unknown tool")
        # Per-tool 1/24h cap (defense-in-depth — Vercel Edge Config also enforces)
        cutoff = datetime.utcnow() - timedelta(hours=24)
        recent_for_tool = (
            s.query(WrapperRequest)
            .filter(WrapperRequest.tool_id == payload.tool_id, WrapperRequest.requested_at > cutoff)
            .count()
        )
        if recent_for_tool >= 1:
            raise HTTPException(429, "tool already requested in last 24h")
        s.add(WrapperRequest(
            id=job_id,
            tool_id=payload.tool_id,
            requester_ip=payload.requester_ip,
            requester_hash=payload.requester_hash,
            recaptcha_score=payload.recaptcha_score,
            status="pending",
        ))
        s.commit()
    return {"job_id": job_id, "estimated_wait_minutes": 5}


@app.get("/status/{job_id}")
def status(job_id: str):
    with SessionLocal() as s:
        r = s.get(WrapperRequest, job_id)
        if not r:
            raise HTTPException(404)
        return {
            "status": r.status,
            "result_url": r.result_url,
            "error": r.error,
            "attempts": int(r.attempts or 0),
            "terminal_reason": r.terminal_reason,
        }
