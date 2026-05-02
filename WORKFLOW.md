---
# ============================================================================
# Tool Scout — Symphony Orchestrator WORKFLOW.md
# ============================================================================
# This file controls the behavior of the wrapper-generation orchestrator.
# Edit and save → orchestrator hot-reloads on the next tick.
# Validate edits before saving with: scout workflow validate
#
# Format: YAML front matter (config) + Markdown body (wrapper-gen prompt
# template, rendered with strict Liquid).
# ============================================================================

# tracker: where wrapper jobs come from
tracker:
  kind: sqlite_local
  table: wrapper_requests
  active_states: [pending]
  terminal_states: [succeeded, failed, canceled]

# polling: how often the orchestrator looks for work
polling:
  tick_interval_ms: 10000           # 10 seconds
  reconcile_every_ticks: 1          # reconcile every tick

# concurrency: how much parallelism
concurrency:
  max_concurrent_jobs: 2            # max parallel wrapper-gens (Max sub limits)
  max_per_tool_per_24h: 1           # info only — enforced at receiver
  max_global_per_24h: 10            # info only — enforced at receiver

# preflight: gates that must be true before any dispatch
preflight:
  require_docker_running: true
  require_ollama_running: true      # local Gemma backend instead of Claude CLI
  require_git_writable: true
  require_workflow_valid: true

# workspace: per-job isolated directory
# Hooks run via `pwsh -NoProfile -Command <script>` on Windows. Use PowerShell syntax.
workspace:
  root: ~/.tool-scout/workspaces
  retention: keep_until_terminal    # cleanup on success / permanent fail
  hooks:
    after_create: |
      New-Item -ItemType Directory -Force -Path input,output,meta | Out-Null
      Set-Content -Path meta/job_id -Value $env:JOB_ID -NoNewline -Encoding utf8
    before_turn: |
      Add-Content -Path meta/turns.log -Value "[$((Get-Date).ToString('o'))] turn $env:TURN_NUMBER starting" -Encoding utf8
    after_turn: |
      Add-Content -Path meta/turns.log -Value "[$((Get-Date).ToString('o'))] turn $env:TURN_NUMBER ended status=$env:TURN_STATUS" -Encoding utf8
    on_success: |
      Set-Content -Path meta/status -Value "published" -NoNewline -Encoding utf8
    on_failure: |
      Set-Content -Path meta/status -Value "failed" -NoNewline -Encoding utf8
    before_remove: |
      # nothing — workspace retention is keep_until_terminal

# agent: the coding-agent runner (local Gemma via Ollama, not Claude CLI)
agent:
  command: ollama                   # informational only — runner uses llm_client.py HTTP
  mode: ollama_http                 # POST http://localhost:11434/api/generate
  model: gemma3:4b                  # overridden by env LLM_MODEL if set
  fallback_model: qwen3-coder:30b   # used only after N consecutive smoke failures
  max_turns: 3                      # 1 = first attempt, 2-3 = retries with stricter prompts
  per_turn_timeout_s: 300           # 5 min hard timeout per LLM call
  stall_timeout_s: 90               # no event in 90s -> kill turn, schedule retry

# retries: exponential backoff schedule
retries:
  max_attempts: 3
  initial_backoff_s: 30
  max_backoff_s: 600
  retry_on:
    - smoke_test_failed
    - claude_subprocess_error
    - docker_unavailable_transient
    - timeout
    - stalled
  do_not_retry_on:
    - static_scan_blocked           # never retry suspicious/malicious code
    - rate_limit_exceeded           # caller hit their cap; not a real failure
    - workflow_invalid

# sandbox: Docker constraints applied to the smoke test
sandbox:
  image: python:3.11-slim
  network: none                     # no network in smoke test, period
  read_only: true
  memory: 256m
  cpus: 0.5
  smoke_timeout_s: 60

# observability: where events go
observability:
  jsonl_log: ~/.tool-scout/logs/orchestrator.jsonl
  http_status_port: 8766            # http://localhost:8766/jobs (read-only, localhost-bound)
  tui_dashboard: true               # `scout queue dashboard` opens it
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

{% if tool.help_output %}{{ tool.help_output }}{% else %}(none captured){% endif %}

## Hard requirements

1. Use the official Python MCP SDK (`mcp[cli]`).
2. Expose between 1 and 5 of the most useful operations as MCP tools.
3. Windows-compatible: never use `/tmp`, never use `shell=True` without escaping.
4. Self-contained in a single file at `./output/server.py`.
5. Start with: `#!/usr/bin/env -S uv run --script`
6. Include a PEP 723 inline dependency block for uv at the top.

## Forbidden — your output WILL be rejected by static scan if any of these appear

- `os.system(...)`
- `subprocess.run(...)`, `subprocess.Popen(...)`, `subprocess.call(...)`, `subprocess.check_output(...)`  (use `shutil.which` only for binary discovery)
- `eval(...)` or `exec(...)`
- `__import__(...)`
- `socket.*`
- `urllib.*`
- `requests.*`
- Any other network call
- File writes outside of a `tmp_path` parameter the tool caller passes in

## Required structure

The file MUST expose either `mcp` or `server` as a top-level symbol — the smoke test imports the file and asserts this. No side effects at import time (no network calls, no file writes, no environment-dependent logic).

{% if turn_number > 1 %}
## CONTINUATION — this is attempt {{ turn_number }} of {{ tool.max_turns | default: 3 }}

The previous attempt failed: **{{ previous_failure_reason }}**.

{% if previous_failure_reason == "static_scan_blocked" %}
The previous output contained a forbidden pattern. Re-read the "Forbidden" list above. Generate a version that does NOT use any OS, subprocess, or network call.
{% endif %}
{% if previous_failure_reason == "smoke_test_failed" %}
The previous output failed the Docker smoke test, likely because of:
- An import-time error
- Missing `mcp` or `server` top-level symbol
- Side effects at module load that fail without network access (the sandbox runs with `--network=none`)

Generate a version that imports cleanly with no side effects and exposes the required symbol.
{% endif %}
{% if previous_failure_reason == "timeout" %}
The previous attempt timed out at 5 minutes. Generate something simpler — fewer tools, less complex logic.
{% endif %}
{% endif %}

## Output

Output ONLY the complete Python file contents. No prose. No markdown fences. No commentary. No explanation. Just the file.

The orchestrator will write your output to `./output/server.py` automatically.
