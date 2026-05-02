"""Strategy D — wrapper generation (docs/01_SPEC.md §25-26).

Pipeline (single attempt; Phase 11's orchestrator adds multi-turn retry):
  1. Build a prompt from config/prompts/wrapper_gen.md with tool metadata
  2. Call LlmClient.ask_file() → write candidate server.py
  3. static_scan.scan() → if hits, FAIL with reason='static_scan_blocked'
  4. sandbox.run_smoke_test() → if not passed, FAIL with reason='smoke_failed'
  5. Publish: copy to web/public/wrappers/<tool_id>/server.py + record_install

Returns dict with keys: ok, reason, output_path, scan_hits, smoke_log.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from tool_scout.installer.audit import record_install, write_audit
from tool_scout.installer.sandbox import run_smoke_test
from tool_scout.installer.static_scan import scan as static_scan
from tool_scout.llm_client import LlmClient
from tool_scout.models import Tool

log = logging.getLogger("scout")

REPO_ROOT = Path(__file__).resolve().parents[3]
PROMPT_PATH = REPO_ROOT / "config" / "prompts" / "wrapper_gen.md"
PUBLISH_DIR = REPO_ROOT / "web" / "public" / "wrappers"


def _build_prompt(tool: Tool) -> str:
    template = PROMPT_PATH.read_text(encoding="utf-8")
    # The starter wrapper_gen.md uses `{name}, {url}, {description}, {readme}, {help_output}`
    # placeholders (legacy spec format); the orchestrator prompt in WORKFLOW.md uses Liquid.
    # Keep both viable — substitute simple placeholders here.
    return (
        template
        .replace("{name}", tool.name or "")
        .replace("{url}", tool.url or "")
        .replace("{description}", tool.description or "")
        .replace("{readme}", tool.readme_excerpt or "")
        .replace("{help_output}", "(none captured)")
    )


def generate_and_install(
    tool: Tool,
    *,
    workspace_root: Path | None = None,
    client: LlmClient | None = None,
    skip_sandbox: bool = False,
) -> dict:
    """One-shot wrapper generation + safety + publish.

    `skip_sandbox=True` is for testing only; production must always sandbox.
    """
    workspace_root = workspace_root or (Path.home() / ".tool-scout" / "workspaces")
    workspace = workspace_root / tool.id
    workspace.mkdir(parents=True, exist_ok=True)
    output_path = workspace / "server.py"
    cli = client or LlmClient()

    # 1. Generate
    prompt = _build_prompt(tool)
    try:
        cli.ask_file(prompt, output_path)
    except Exception as e:  # noqa: BLE001
        write_audit("wrapper_gen", tool.id, status="llm_error", error=repr(e))
        return {"ok": False, "reason": "llm_error", "error": repr(e)}

    code = output_path.read_text(encoding="utf-8")

    # 2. Static scan (security guardrail; never published if hits)
    clean, hits = static_scan(code)
    if not clean:
        write_audit("wrapper_gen", tool.id, status="static_scan_blocked", hits=hits)
        return {"ok": False, "reason": "static_scan_blocked", "scan_hits": hits, "output_path": str(output_path)}

    # 3. Docker sandbox smoke test
    if not skip_sandbox:
        passed, smoke_log = run_smoke_test(output_path)
        if not passed:
            write_audit("wrapper_gen", tool.id, status="smoke_failed", smoke_log_tail=smoke_log[-500:])
            return {"ok": False, "reason": "smoke_failed", "smoke_log": smoke_log, "output_path": str(output_path)}

    # 4. Publish to web/public/wrappers/<tool_id>/server.py
    publish_target = PUBLISH_DIR / tool.id / "server.py"
    publish_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(output_path, publish_target)
    write_audit("wrapper_gen", tool.id, status="published", target=str(publish_target))
    try:
        published_rel = str(publish_target.relative_to(REPO_ROOT))
    except ValueError:
        # PUBLISH_DIR has been monkey-patched outside the repo (test) — record absolute.
        published_rel = str(publish_target)
    record_install(
        tool.id,
        strategy="wrapper_generated",
        target_path=str(publish_target),
        config_diff={"published": published_rel},
    )
    return {
        "ok": True,
        "reason": "published",
        "output_path": str(output_path),
        "publish_target": str(publish_target),
        "result_url": f"/wrappers/{tool.id}/server.py",
    }
