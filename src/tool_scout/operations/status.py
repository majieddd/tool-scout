"""scout status — comprehensive health summary across all surfaces."""
from __future__ import annotations

import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from tool_scout.db import SessionLocal
from tool_scout.installer.sandbox import docker_available
from tool_scout.llm_client import LlmClient
from tool_scout.models import (
    BackupLog,
    CrawlRun,
    Tool,
    UsageLog,
    WrapperRequest,
)


def collect_status() -> dict[str, Any]:
    out: dict[str, Any] = {"generated_at": datetime.utcnow().isoformat() + "Z"}
    with SessionLocal() as s:
        out["tools"] = {
            "total": s.query(Tool).count(),
            "live_public": s.query(Tool).filter(Tool.dead == 0, Tool.visibility == "public").count(),
        }
        last_crawl = s.query(CrawlRun).order_by(CrawlRun.id.desc()).first()
        out["last_crawl"] = (
            {
                "id": last_crawl.id,
                "started_at": last_crawl.started_at.isoformat() if last_crawl.started_at else None,
                "ended_at": last_crawl.ended_at.isoformat() if last_crawl.ended_at else None,
                "duration_s": last_crawl.duration_s,
                "new_tools": last_crawl.new_tools,
                "errors": last_crawl.errors,
            }
            if last_crawl
            else None
        )
        last_backup = s.query(BackupLog).order_by(BackupLog.id.desc()).first()
        out["last_backup"] = (
            {
                "created_at": last_backup.created_at.isoformat() if last_backup.created_at else None,
                "path": last_backup.path,
                "size_bytes": last_backup.size_bytes,
                "integrity_ok": bool(last_backup.integrity_ok),
            }
            if last_backup
            else None
        )
        out["queue"] = {
            "pending": s.query(WrapperRequest).filter(WrapperRequest.status == "pending").count(),
            "running": s.query(WrapperRequest).filter(WrapperRequest.status == "running").count(),
            "succeeded_24h": s.query(WrapperRequest).filter(
                WrapperRequest.status == "succeeded",
                WrapperRequest.finished_at > datetime.utcnow().replace(hour=0, minute=0, second=0)
            ).count(),
            "failed_24h": s.query(WrapperRequest).filter(
                WrapperRequest.status == "failed",
                WrapperRequest.finished_at > datetime.utcnow().replace(hour=0, minute=0, second=0)
            ).count(),
        }
        out["llm"] = {
            "calls_today": s.query(UsageLog).filter(
                UsageLog.called_at > datetime.utcnow().replace(hour=0, minute=0, second=0)
            ).count(),
        }

    # Surface checks
    out["docker"] = docker_available()
    out["ollama"] = LlmClient().ping()
    out["nssm_on_path"] = bool(shutil.which("nssm"))

    # Service running?
    if shutil.which("powershell"):
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "(Get-Service ToolScoutOrchestrator -ErrorAction SilentlyContinue).Status"],
                capture_output=True, text=True, timeout=5,
            )
            out["orchestrator_service_status"] = r.stdout.strip() or "Not Installed"
        except Exception:
            out["orchestrator_service_status"] = "?"
    else:
        out["orchestrator_service_status"] = "?"

    # ngrok tunnel reachable? (Just env presence — actual tunnel check needs probe)
    out["ngrok_domain"] = os.environ.get("NGROK_STATIC_DOMAIN") or "(not set)"
    out["webhook_secret_set"] = bool(os.environ.get("WEBHOOK_SHARED_SECRET"))
    out["vercel_deploy_hook_set"] = bool(os.environ.get("VERCEL_DEPLOY_HOOK_URL"))

    return out
