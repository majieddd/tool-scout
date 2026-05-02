# Tool Scout — Unified Build Specification (v1.0 Final)

> **This is the authoritative spec.** Supersedes handoff v1, v2, v3, v4, and the v4 supplement.
> Hand this document (together with `TOOL_SCOUT_SETUP.md`) to Claude Code. Start at Phase 1.
>
> **Owner:** Majied · **Target platform:** Windows 11 · **Cost:** $0/month
> **Core principle:** everything runs on the Claude Max subscription + free tiers. No API keys purchased.
> **Style note:** numbered procedural CLI output. Voice-to-text-friendly error messages. Concise flags, verbose internal logging.

---

## Part A — Overview

### 1. Mission

Daily 60–75-minute crawl of the public internet for Claude-compatible tools — MCP servers, Claude Code plugins, SKILL.md skills, agentic harnesses, plus any CLI/library the wrapper generator can adapt. Three outputs from one crawl:

1. **Terminal:** `scout recommend` prints today's top picks with letter grades
2. **Google Sheets:** monthly workbook with daily tabs, color-coded letter grades for scanning
3. **Public Next.js web app** at `tool-scout.vercel.app`: browsable catalog where visitors can click "Request Claude Code wrapper" — queues a job on Majied's machine that generates an MCP wrapper, sandbox-smoke-tests it, and publishes it as a downloadable file

### 2. Resolved decisions

| Decision | Choice | Rationale |
|---|---|---|
| LLM provider | Claude Code CLI subprocess (uses Majied's Max subscription) | $0 API bill |
| Classifier routing | Heuristics → Claude Code (two tier) | Simplest; flat-rate cost |
| Public data hosting | `web/public/data/` in the Vercel repo | One fewer service than R2 |
| Webhook tunnel | ngrok free (static subdomain) | Free + stable URL |
| CAPTCHA | Google reCAPTCHA v3 | Invisible to users |
| Sheets auth | GCP service account | No OAuth dance |
| Sandboxing | Docker Desktop with `--network=none` | Non-negotiable for public service |
| Takedown contact | GitHub issue template | No email infra needed |
| License | MIT | Clear, permissive |
| DB | SQLite (WAL) + Alembic migrations | Single-user writer, auditable schema |
| Classifier learning | Light feedback from `installs`/`user_overrides` | Low cost, big signal |

### 3. Architecture

```
┌────────────────────────── LOCAL (Majied's Windows PC) ──────────────────────────┐
│                                                                                 │
│  Task Scheduler                                                                 │
│    ├─ ToolScoutDailyCrawl       03:00 daily                                     │
│    ├─ ToolScoutQueueWorker      every 5 min                                     │
│    └─ ToolScoutDailyBackup      04:30 daily                                     │
│                                                                                 │
│  Windows Services                                                               │
│    ├─ ngrok (tunnel to port 8765, static subdomain)                             │
│    └─ Docker Desktop (powers sandbox in §9.4)                                   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                                                                         │   │
│  │  ┌──────────┐  ┌─────────────┐  ┌──────────┐  ┌───────────┐             │   │
│  │  │ Crawler  │─▶│ Classifier  │─▶│ Grading  │─▶│ SQLite DB │             │   │
│  │  └──────────┘  │heuristics + │  └──────────┘  │  (WAL)    │             │   │
│  │                │Claude Code  │                └─────┬─────┘             │   │
│  │                └─────────────┘                      │                   │   │
│  │                                                     │                   │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┴────────┐          │   │
│  │  │   CLI    │  │ Sheets   │  │Installer │  │   Exporter +    │          │   │
│  │  │          │  │  Sync    │  │          │  │ Git Publisher   │          │   │
│  │  └──────────┘  └────┬─────┘  └──────────┘  └────────┬────────┘          │   │
│  │                     │                               │                   │   │
│  │  ┌──────────────────┴──────┐                        │                   │   │
│  │  │  Queue Worker + Webhook │◀── ngrok ─┐            │                   │   │
│  │  │  Receiver (port 8765)   │           │            │                   │   │
│  │  │  + Docker sandbox       │           │            │                   │   │
│  │  └─────────────────────────┘           │            │                   │   │
│  └────────────────────────────────────────┼────────────┼───────────────────┘   │
│                                           │            │                       │
└───────────────────────────────────────────┼────────────┼───────────────────────┘
                                            │            │
                                  webhook   │            │  git push
                                            │            │
                                            │            ▼
                                            │   ┌─────────────────────┐
                                            │   │  GitHub (public)    │
                                            │   │  tool-scout repo    │
                                            │   │  web/public/data/   │
                                            │   │  web/public/wrappers│
                                            │   └──────────┬──────────┘
                                            │              │
                                            │   auto-deploy on push
                                            │              │
                                            │              ▼
                          ┌─────────────────────────────────────────────┐
                          │  Vercel — tool-scout.vercel.app             │
                          │                                             │
                          │  Static Next.js app reading /data/*.json    │
                          │  + /api/request-wrapper (serverless)        │
                          │  + /api/status/[job_id]                     │
                          │                                             │
                          │  Rate limit via Vercel Edge Config          │
                          │  reCAPTCHA v3 verification                  │
                          └─────────────────────────────────────────────┘
```

---

## Part B — Pre-flight (done by Majied before Claude Code starts)

See `TOOL_SCOUT_SETUP.md` for the step-by-step checklist. When `scout doctor` runs in Phase 1, it expects every item on that checklist to be ready.

---

## Part C — Tech Stack (pinned)

### 4. Python

```toml
# pyproject.toml
[project]
name = "tool-scout"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "typer>=0.12.0",
    "rich>=13.7.0",
    "httpx>=0.27.0",
    "tenacity>=8.2.0",
    "selectolax>=0.3.21",
    "beautifulsoup4>=4.12.0",
    "pydantic>=2.7.0",
    "pyyaml>=6.0.1",
    "sqlalchemy>=2.0.30",
    "alembic>=1.13.0",
    "gspread>=6.1.0",
    "google-auth>=2.29.0",
    "gitpython>=3.1.43",
    "fastapi>=0.111.0",
    "uvicorn[standard]>=0.30.0",
    "python-dotenv>=1.0.1",
    "cryptography>=42.0.0",
]

[project.scripts]
scout = "tool_scout.cli:app"

[project.optional-dependencies]
dev = [
    "pytest>=8.2.0",
    "pytest-asyncio>=0.23.0",
    "pytest-mock>=3.14.0",
    "ruff>=0.4.0",
    "mypy>=1.10.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 5. Node / web

```json
// web/package.json (key versions)
{
  "dependencies": {
    "next": "15.0.0",
    "react": "18.3.0",
    "react-dom": "18.3.0",
    "recharts": "2.12.0"
  },
  "devDependencies": {
    "typescript": "5.5.0",
    "tailwindcss": "3.4.0",
    "@types/node": "20.0.0",
    "@types/react": "18.3.0"
  }
}
```

### 6. Platform prerequisites (machine-level)

| Tool | Minimum | Verify command |
|---|---|---|
| Python | 3.11 | `python --version` |
| Node | 20 LTS | `node --version` |
| PowerShell | 7.4 | `pwsh --version` |
| Git | 2.40 | `git --version` |
| Claude Code | latest | `claude --version` |
| Docker Desktop | 4.30 | `docker run --rm hello-world` |
| ngrok | v3 | `ngrok version` |

All verified by `scout doctor`.

---

## Part D — Repo Structure

```
tool-scout/                                    # public GitHub repo
├── pyproject.toml
├── alembic.ini
├── README.md
├── LICENSE                                    # MIT
├── SECURITY.md
├── CONTRIBUTING.md
├── .env.example
├── .gitignore                                 # see §35
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── takedown.yml
│   │   ├── bug.yml
│   │   └── feature.yml
│   └── dependabot.yml
├── config/
│   ├── sources.yaml
│   ├── profile.yaml                           # public-safe version of Majied's profile
│   ├── adapters.yaml
│   ├── grading_rubric.yaml
│   └── prompts/
│       ├── classify_batch.md
│       └── wrapper_gen.md
├── migrations/                                # Alembic
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       └── 0001_initial.py                    # more added per schema change
├── src/
│   └── tool_scout/
│       ├── __init__.py
│       ├── cli.py                             # Typer entry point
│       ├── config.py                          # loads YAML + env
│       ├── db.py                              # SQLAlchemy engine + session
│       ├── models.py                          # SQLAlchemy + Pydantic models
│       ├── claude_client.py
│       ├── usage_tracker.py
│       ├── git_publisher.py
│       ├── crawler/
│       │   ├── __init__.py
│       │   ├── runner.py
│       │   ├── github.py
│       │   ├── npm.py
│       │   ├── pypi.py
│       │   ├── mcp_registries.py
│       │   ├── awesome_lists.py
│       │   ├── reddit.py
│       │   ├── hackernews.py
│       │   ├── anthropic_blog.py
│       │   └── local_projects.py
│       ├── classifier/
│       │   ├── __init__.py
│       │   ├── heuristics.py
│       │   └── claude_classifier.py
│       ├── recommender/
│       │   ├── __init__.py
│       │   ├── profile.py
│       │   ├── scorer.py
│       │   └── learning.py                    # install-feedback loop
│       ├── grading/
│       │   ├── __init__.py
│       │   └── rubric.py
│       ├── installer/
│       │   ├── __init__.py
│       │   ├── detector.py
│       │   ├── mcp.py
│       │   ├── plugin.py
│       │   ├── skill.py
│       │   ├── wrapper.py
│       │   ├── sandbox.py                     # Docker smoke test
│       │   ├── static_scan.py                 # pre-sandbox pattern check
│       │   └── audit.py
│       ├── sheets/
│       │   ├── __init__.py
│       │   ├── client.py
│       │   ├── schema.py
│       │   └── sync.py
│       ├── export/
│       │   ├── __init__.py
│       │   └── vercel_export.py
│       ├── queue_worker/
│       │   ├── __init__.py
│       │   ├── worker.py                      # picks pending jobs, runs gen
│       │   └── webhook.py                     # FastAPI receiver on 8765
│       ├── operations/
│       │   ├── __init__.py
│       │   ├── backup.py
│       │   ├── guardrail.py
│       │   └── status.py
│       └── util/
│           ├── __init__.py
│           ├── rate_limit.py
│           ├── time_budget.py
│           └── logging.py
├── web/                                       # Next.js — deploys to Vercel
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── public/
│   │   ├── data/                              # bot commits here after each crawl
│   │   │   ├── tools.json
│   │   │   ├── recommendations.json
│   │   │   ├── grades_index.json
│   │   │   └── meta.json
│   │   └── wrappers/                          # generated wrappers land here
│   │       └── <tool-id>/server.py
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                           # catalog
│   │   ├── tool/[id]/page.tsx
│   │   ├── today/page.tsx
│   │   ├── request/[id]/page.tsx
│   │   ├── about/page.tsx
│   │   ├── terms/page.tsx
│   │   ├── privacy/page.tsx
│   │   ├── policy/page.tsx
│   │   └── api/
│   │       ├── request-wrapper/route.ts
│   │       └── status/[job_id]/route.ts
│   ├── lib/
│   │   ├── data.ts
│   │   ├── grading.ts
│   │   ├── rate-limit.ts
│   │   └── recaptcha.ts
│   └── components/
│       ├── ToolCard.tsx
│       ├── GradeBadge.tsx
│       ├── GradeRadar.tsx
│       ├── FilterBar.tsx
│       ├── RequestButton.tsx
│       └── Footer.tsx
├── tests/
│   ├── conftest.py
│   ├── test_heuristics.py
│   ├── test_rubric.py
│   ├── test_sandbox.py
│   ├── test_static_scan.py
│   ├── test_git_publisher.py
│   ├── test_guardrail.py
│   └── fixtures/
│       ├── sample_tool_readmes/
│       ├── known_good_wrapper.py
│       └── known_bad_wrapper.py
└── scripts/
    ├── install_crawl_task.ps1
    ├── install_queue_worker_task.ps1
    ├── install_backup_task.ps1
    ├── install_ngrok_service.ps1
    └── uninstall_all.ps1
```

---

## Part E — Database

### 7. Full SQL schema

SQLite WAL mode at `~/.tool-scout/scout.db`. Managed by Alembic. Migration 0001 creates everything below.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Every tool ever seen
CREATE TABLE tools (
    id              TEXT PRIMARY KEY,          -- sha256(source || url), 16 chars
    name            TEXT NOT NULL,
    url             TEXT NOT NULL UNIQUE,
    source          TEXT NOT NULL,             -- github|npm|pypi|mcp.so|pulsemcp|reddit|hn|anthropic|awesome|local-personal
    category        TEXT,                      -- mcp_server|claude_plugin|skill|harness|tool|library
    subcategory     TEXT,
    description     TEXT,
    readme_excerpt  TEXT,                      -- first ~2000 chars
    language        TEXT,
    stars           INTEGER DEFAULT 0,
    downloads       INTEGER DEFAULT 0,
    license         TEXT,
    last_updated    TIMESTAMP,                 -- upstream last commit/release
    first_seen      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_crawled    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    compatibility   TEXT,                      -- native_claude_code|mcp_ready|needs_wrapper|incompatible
    install_hint    TEXT,
    quality_score   REAL DEFAULT 0.0,
    dead            INTEGER DEFAULT 0,
    visibility      TEXT DEFAULT 'public',     -- public|private|hidden
    classifier_cache_key TEXT                  -- sha256(url + readme[:1024]); skip reclass if unchanged
);
CREATE INDEX idx_tools_category ON tools(category);
CREATE INDEX idx_tools_source ON tools(source);
CREATE INDEX idx_tools_last_updated ON tools(last_updated);
CREATE INDEX idx_tools_visibility ON tools(visibility);
CREATE INDEX idx_tools_cache_key ON tools(classifier_cache_key);

-- Tag cloud
CREATE TABLE tags (
    tool_id TEXT REFERENCES tools(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    weight  REAL DEFAULT 1.0,
    PRIMARY KEY (tool_id, tag)
);
CREATE INDEX idx_tags_tag ON tags(tag);

-- Per-axis grades (0–5 each, total 0–25, letter S/A/B/C/D/F)
CREATE TABLE grades (
    tool_id         TEXT PRIMARY KEY REFERENCES tools(id) ON DELETE CASCADE,
    relevance       REAL NOT NULL,
    quality         REAL NOT NULL,
    novelty         REAL NOT NULL,
    install_ease    REAL NOT NULL,
    fit             REAL NOT NULL,
    total           REAL NOT NULL,
    letter          TEXT NOT NULL,
    color_hex       TEXT NOT NULL,
    computed_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes           TEXT
);
CREATE INDEX idx_grades_letter ON grades(letter);
CREATE INDEX idx_grades_total ON grades(total);

-- Every crawl run (audit trail)
CREATE TABLE crawl_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at    TIMESTAMP,
    duration_s  INTEGER,
    sources     TEXT,                          -- JSON array
    new_tools   INTEGER DEFAULT 0,
    updated     INTEGER DEFAULT 0,
    errors      TEXT,                          -- JSON array
    guardrail_passed INTEGER DEFAULT 1
);

-- Today's top picks (rebuilt each run)
CREATE TABLE recommendations (
    run_id      INTEGER REFERENCES crawl_runs(id) ON DELETE CASCADE,
    tool_id     TEXT REFERENCES tools(id) ON DELETE CASCADE,
    rank        INTEGER NOT NULL,
    score       REAL NOT NULL,
    reasoning   TEXT,
    PRIMARY KEY (run_id, tool_id)
);

-- Install history (Majied's local installs)
CREATE TABLE installs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id         TEXT REFERENCES tools(id),
    installed_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    strategy        TEXT,                      -- native_mcp|plugin_copy|skill_copy|wrapper_generated
    target_path     TEXT,
    config_diff     TEXT,                      -- JSON
    success         INTEGER DEFAULT 1,
    notes           TEXT
);

-- User overrides including takedowns
CREATE TABLE user_overrides (
    tool_id     TEXT PRIMARY KEY REFERENCES tools(id),
    state       TEXT NOT NULL,                 -- pinned|muted|tried_and_dropped|excluded_by_owner
    note        TEXT,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_overrides_state ON user_overrides(state);

-- Public wrapper-generation requests (from the web app)
CREATE TABLE wrapper_requests (
    id              TEXT PRIMARY KEY,          -- uuid
    tool_id         TEXT REFERENCES tools(id),
    requester_ip    TEXT NOT NULL,
    requester_hash  TEXT NOT NULL,
    recaptcha_score REAL,
    requested_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status          TEXT NOT NULL,             -- pending|running|success|failed|rejected
    started_at      TIMESTAMP,
    finished_at     TIMESTAMP,
    result_url      TEXT,
    error           TEXT,
    static_scan_output TEXT,
    sandbox_output  TEXT,
    priority        INTEGER DEFAULT 0
);
CREATE INDEX idx_wreq_status ON wrapper_requests(status);
CREATE INDEX idx_wreq_ip ON wrapper_requests(requester_ip);
CREATE INDEX idx_wreq_tool ON wrapper_requests(tool_id);

-- Rate limit counters (local fallback; Vercel uses Edge Config)
CREATE TABLE rate_limits (
    ip              TEXT NOT NULL,
    window_start    TIMESTAMP NOT NULL,
    count           INTEGER DEFAULT 0,
    PRIMARY KEY (ip, window_start)
);

-- Usage log — every Claude Code subprocess call
CREATE TABLE usage_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    called_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    purpose         TEXT NOT NULL,             -- classify|wrapper_gen|other
    duration_s      REAL,
    input_chars     INTEGER,
    output_chars    INTEGER,
    success         INTEGER DEFAULT 1
);
CREATE INDEX idx_usage_time ON usage_log(called_at);

-- Backup audit
CREATE TABLE backup_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    path            TEXT NOT NULL,
    size_bytes      INTEGER,
    integrity_ok    INTEGER DEFAULT 1,
    kind            TEXT                       -- daily|weekly|monthly
);
```

---

## Part F — Core Modules

### 8. Claude Code as brain — `claude_client.py`

Invokes the `claude` CLI as a subprocess. All LLM work bills against Majied's Max subscription.

```python
# src/tool_scout/claude_client.py
from __future__ import annotations
import subprocess
import json
import time
from pathlib import Path
from typing import Any

class ClaudeClient:
    def __init__(self, binary: str = "claude", workdir: Path | None = None):
        self.binary = binary
        self.workdir = workdir or Path.cwd()

    def ask_json(self, prompt: str, max_retries: int = 2, timeout_s: int = 300) -> Any:
        """Non-interactive call; expects JSON back. Retries on parse failure."""
        last_err: Exception | None = None
        for attempt in range(max_retries + 1):
            t0 = time.monotonic()
            result = subprocess.run(
                [self.binary, "-p", prompt, "--output-format", "json"],
                capture_output=True, text=True, timeout=timeout_s,
                cwd=self.workdir,
            )
            duration = time.monotonic() - t0
            if result.returncode != 0:
                last_err = RuntimeError(result.stderr.strip() or "claude non-zero exit")
                if attempt == max_retries:
                    raise last_err
                continue
            try:
                wrapper = json.loads(result.stdout)
                body = wrapper.get("result", wrapper)
                if isinstance(body, str):
                    body = body.strip().removeprefix("```json").removesuffix("```").strip()
                    return json.loads(body), duration
                return body, duration
            except json.JSONDecodeError as e:
                last_err = e
                if attempt == max_retries:
                    raise
        raise last_err or RuntimeError("unreachable")

    def ask_file(self, prompt: str, output_path: Path, timeout_s: int = 600) -> float:
        """Non-interactive call; writes raw stdout to file. Returns duration."""
        t0 = time.monotonic()
        result = subprocess.run(
            [self.binary, "-p", prompt],
            capture_output=True, text=True, timeout=timeout_s,
            cwd=self.workdir,
        )
        duration = time.monotonic() - t0
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "claude non-zero exit")
        text = result.stdout.strip()
        if text.startswith("```"):
            parts = text.split("\n", 1)
            text = parts[1] if len(parts) > 1 else text
            if text.endswith("```"):
                text = text.rsplit("```", 1)[0]
        output_path.write_text(text.rstrip() + "\n", encoding="utf-8")
        return duration
```

Every call goes through `usage_tracker.record()` afterward.

### 9. Usage throttle — `usage_tracker.py`

```python
# src/tool_scout/usage_tracker.py
from datetime import datetime, timedelta
from tool_scout.db import SessionLocal
from tool_scout.models import UsageLog

MAX_CLAUDE_CALLS_PER_5H = 40
MAX_CLAUDE_CALLS_PER_DAY = 120

def can_call(purpose: str) -> tuple[bool, str]:
    now = datetime.utcnow()
    with SessionLocal() as s:
        five_h = s.query(UsageLog).filter(
            UsageLog.called_at > now - timedelta(hours=5)
        ).count()
        day = s.query(UsageLog).filter(
            UsageLog.called_at > now - timedelta(hours=24)
        ).count()
    if five_h >= MAX_CLAUDE_CALLS_PER_5H:
        return False, f"5h window at cap ({five_h}/{MAX_CLAUDE_CALLS_PER_5H})"
    if day >= MAX_CLAUDE_CALLS_PER_DAY:
        return False, f"24h cap reached ({day}/{MAX_CLAUDE_CALLS_PER_DAY})"
    return True, "ok"

def record(purpose: str, duration_s: float, in_chars: int, out_chars: int, success: bool = True):
    with SessionLocal() as s:
        s.add(UsageLog(
            purpose=purpose, duration_s=duration_s,
            input_chars=in_chars, output_chars=out_chars,
            success=int(success),
        ))
        s.commit()
```

Throttle checked before every classify batch and every wrapper-gen job. If blocked, classify batches checkpoint to a `pending_classify` queue and resume next run; wrapper jobs stay in `pending` state.

### 10. Git publisher — `git_publisher.py`

Commits data and generated wrappers to the public repo using a bot identity. Fine-scoped PAT stored in OS keyring (via `keyring` package) or encrypted file — never in plain `.env`.

```python
# src/tool_scout/git_publisher.py
from __future__ import annotations
from pathlib import Path
from git import Repo, Actor
import os

class GitPublisher:
    def __init__(self, repo_path: Path, bot_name: str, bot_email: str, token: str, remote_url: str):
        self.repo_path = repo_path
        self.bot = Actor(bot_name, bot_email)
        self.token = token
        self.remote_url = remote_url  # https://github.com/Majied/tool-scout.git
        self.repo = Repo(repo_path)

    def publish_data(self, message: str, paths: list[str]) -> str | None:
        """Stage paths, commit with bot identity, push. Returns commit sha or None if nothing to commit."""
        self.repo.index.add(paths)
        if not self.repo.is_dirty(untracked_files=True):
            return None
        commit = self.repo.index.commit(message, author=self.bot, committer=self.bot)
        authed_url = self.remote_url.replace("https://", f"https://x-access-token:{self.token}@")
        origin = self.repo.remote("origin")
        with origin.config_writer as cw:
            cw.set("url", authed_url)
        try:
            origin.push()
        finally:
            with origin.config_writer as cw:
                cw.set("url", self.remote_url)   # scrub token back out
        return commit.hexsha
```

Never writes the tokenized URL to disk. Stdout/log scrubs the token from any error messages.

---

## Part G — Crawler

### 11. Sources (`config/sources.yaml`)

```yaml
github:
  enabled: true
  token_env: GITHUB_TOKEN
  searches:
    - query: "topic:mcp-server"
      type: repositories
      budget_min: 4
    - query: "topic:claude-code"
      type: repositories
      budget_min: 3
    - query: "topic:anthropic-skill"
      type: repositories
      budget_min: 2
    - query: "topic:claude-plugin"
      type: repositories
      budget_min: 2
    - query: "filename:SKILL.md path:/"
      type: code
      budget_min: 3
    - query: '"mcp_servers" filename:claude_desktop_config.json'
      type: code
      budget_min: 3
    - query: '"mcp" filename:claude.json'
      type: code
      budget_min: 3

mcp_registries:
  enabled: true
  sources:
    - url: https://pulsemcp.com/servers
      selector: ".server-card a"
      budget_min: 4
    - url: https://mcp.so/
      selector: ".project-item a"
      budget_min: 3
    - url: https://smithery.ai/
      selector: "a[href*='/server/']"
      budget_min: 3

awesome_lists:
  enabled: true
  frequency: weekly             # skip other days
  repos:
    - punkpeye/awesome-mcp-servers
    - wong2/awesome-mcp-servers
    - hesreallyhim/awesome-claude-code
    - langgptai/awesome-claude-prompts
  budget_min: 10

npm:
  enabled: true
  queries:
    - keywords:mcp
    - keywords:claude
    - keywords:anthropic
  budget_min: 5

pypi:
  enabled: true
  queries:
    - mcp
    - claude
    - anthropic-skill
  budget_min: 5

reddit:
  enabled: true
  subreddits: [ClaudeAI, mcp, LocalLLaMA]
  budget_min: 3

hackernews:
  enabled: true
  queries: ["claude mcp", "anthropic skill", "claude code"]
  budget_min: 2

anthropic_blog:
  enabled: true
  feeds:
    - https://www.anthropic.com/news/rss.xml
    - https://docs.claude.com/en/release-notes/claude-code
  budget_min: 3

local_projects:
  enabled: true
  roots:
    - C:\Users\Majied\projects
    - C:\Users\Majied\Documents\GitHub
  indicators:
    - SKILL.md
    - plugin.json
    - mcp.json
  max_depth: 4
  budget_min: 2
```

### 12. Time budget (`util/time_budget.py`)

Total crawl budget: **60 min minimum, 75 max hard kill**. Allocation:

| Stage | Budget |
|---|---|
| All crawl sources combined | 48 min |
| Classify (heuristics + Claude) | 15 min |
| Grade + recommend | 2 min |
| Sheets sync | 3 min |
| Export + git push | 2 min |
| Buffer | 5 min |

If any source blows its per-source budget, skip remaining pagination of that source and move on. Hard kill at 75 min writes `crawl_runs.errors` and proceeds to classify what's collected.

### 13. Crawl politeness

- `User-Agent: tool-scout/0.1 (+https://github.com/Majied/tool-scout)`
- Max 2 concurrent requests per domain (via `httpx` limits + per-host semaphore)
- Respect `robots.txt` via `urllib.robotparser`
- 429 → exponential backoff to 60s, then abandon source for this run
- 24h local HTTP cache at `~/.tool-scout/cache/` (sha256 URL key); entries > 48h old swept at end of each crawl

---

## Part H — Classifier

### 14. Two-tier pipeline

```
Raw record
   │
   ▼
Heuristics (free)
   │  confidence ≥ 0.9? ─── yes ──▶ DONE  (~70% of records)
   │
   no
   ▼
Batch up to 20 records
   │
   ▼
Claude Code (via claude_client)
   │
   ▼
DONE
```

Cache key on each tool: `sha256(url || readme[:1024])` → `tools.classifier_cache_key`. Unchanged records skip reclassification entirely.

### 15. Heuristics rules (ordered, first match wins)

1. Repo topics contain `mcp-server` OR package ships an MCP server module → `mcp_server`, `compatibility=mcp_ready`, confidence 0.95
2. Has `SKILL.md` in root or `/skills/` with valid frontmatter (`name:`, `description:`) → `skill`, `compatibility=native_claude_code`, confidence 0.95
3. Has `plugin.json` in `.claude/plugins/` or root → `claude_plugin`, confidence 0.95
4. README mentions "agent loop", "agentic framework", "harness" AND no MCP markers → `harness`, confidence 0.80
5. Empty README, or < 200 chars, or archived repo → `dead=1`, skip classify
6. Everything else → defer to Claude Code

### 16. Claude classify prompt — `config/prompts/classify_batch.md`

```
You are classifying developer tools for a Claude Code discovery catalog.

For each tool in the input, output a JSON object with fields:
- category: mcp_server | claude_plugin | skill | harness | tool | library
- subcategory: 1-3 words, lowercase
- compatibility: native_claude_code | mcp_ready | needs_wrapper | incompatible
- tags: array of 3-8 lowercase kebab-case tags
- install_hint: shell command or config snippet clearly shown in README, else null
- confidence: 0.0-1.0

Output a JSON array, one object per input, same order. No markdown fences. No prose.

Input (id, name, url, readme_excerpt):
{batch_json}
```

Batch size 20. Haiku-equivalent quality is plenty — this is a bucketing task.

---

## Part I — Grading — `grading/rubric.py`

### 17. Five axes, 0–5 each, total 0–25

| Axis | Abbrev | Drives |
|---|---|---|
| Relevance | R | Sum of `profile.yaml` interest weights for matching tags, scaled 0–5 |
| Quality | Q | log(stars) + log(downloads) + recency of commits + README depth + tests present + license set |
| Novelty | N | Days since first seen or last updated |
| Install ease | I | Map from `compatibility` and `install_hint` presence |
| Fit | F | Windows-native, primary language match (python/ts), CLI-friendly, stack alignment |

### 18. Letter bands

```
22–25 → S → #8B5CF6  "stop everything"
18–21 → A → #10B981  "install this week"
14–17 → B → #3B82F6  "solid, try soon"
10–13 → C → #F59E0B  "situational"
 6–9  → D → #F97316  "probably skip"
 0–5  → F → #6B7280  "irrelevant/dead"
```

### 19. Rubric config (`config/grading_rubric.yaml`)

```yaml
axes:
  relevance:
    max_raw_score: 30
    scale_to: 5
  quality:
    weights:
      log_stars: 0.30
      log_downloads: 0.15
      recency: 0.25
      readme_depth: 0.15
      has_tests: 0.10
      has_license: 0.05
  novelty:
    - {max_days: 3,   score: 5}
    - {max_days: 14,  score: 4}
    - {max_days: 30,  score: 3}
    - {max_days: 90,  score: 2}
    - {max_days: 180, score: 1}
    - {max_days: null, score: 0}
  install_ease:
    native_claude_code: 5
    mcp_ready: 4.5
    needs_wrapper: 2.5
    incompatible: 0
  fit:
    windows_native_bonus: 1.0
    primary_language_match: 1.5
    cli_workflow_bonus: 0.5
    game_dev_stack_bonus: 1.0
    macos_only_penalty: -5.0
    ios_only_penalty: -5.0

letter_bands:
  - {min: 22, letter: S, color: "#8B5CF6"}
  - {min: 18, letter: A, color: "#10B981"}
  - {min: 14, letter: B, color: "#3B82F6"}
  - {min: 10, letter: C, color: "#F59E0B"}
  - {min:  6, letter: D, color: "#F97316"}
  - {min:  0, letter: F, color: "#6B7280"}
```

Grades recomputed every crawl — profile or rubric tweaks propagate automatically.

---

## Part J — Recommender

### 20. Profile (`config/profile.yaml`)

Public-safe version (no NDA-sensitive details). Goes in the public repo.

```yaml
interests:
  # Game dev & Hytale
  hytale: 3
  minecraft-modding: 2
  game-dev: 3
  blockbench: 2
  voxel: 2

  # AI / agentic
  mcp: 3
  mcp-server: 3
  claude-code: 3
  claude-plugin: 3
  anthropic-skill: 3
  agentic: 3
  local-llm: 3
  ollama: 2
  multi-agent: 2
  orchestration: 2

  # Languages
  python: 3
  typescript: 2
  javascript: 2
  react: 2
  three-js: 2
  electron: 2

  # Platforms
  windows: 3
  wsl: 2
  cross-platform: 1

  # Workflows
  cli: 3
  terminal: 3
  automation: 3
  sqlite: 2

  # De-prioritize
  macos-only: -3
  ios-only: -3
  android-only: -3
  requires-paid-saas: -2
  browser-extension-only: -1
  no-recent-commits: -1

current_projects:
  - name: HYDRA
    boost_tags: [agentic, mcp, local-llm, orchestration, model-router, vram]
    weight: 3
  - name: Kingdoms-Mod
    boost_tags: [hytale, reputation-system, faction, game-design]
    weight: 2
  - name: Echoes-Mod
    boost_tags: [hytale, progression, bestiary]
    weight: 2
  - name: tool-scout
    boost_tags: [crawler, classifier, recommender, sqlite]
    weight: 2

exclude:
  - crypto-trading
  - nft
  - dropshipping
```

### 21. Scoring

```
score = 0.45 * relevance + 0.25 * quality + 0.15 * novelty + 0.15 * project_boost

where:
  relevance     = clamp(sum(profile.interests[tag]) / 10, -1, 1) * (learning_factor)
  quality       = grades.quality / 5
  novelty       = grades.novelty / 5
  project_boost = max(weight for project in current_projects if any(tag in project.boost_tags)) or 0
```

Hard exclude: `relevance < -0.2`, `dead = 1`, `user_overrides.state in ('muted', 'excluded_by_owner')`.

### 22. Learning loop — `recommender/learning.py`

After 10 logged installs, apply adjustment:

```python
def compute_learning_factor(tool_tags: set[str]) -> float:
    """Returns multiplier in [0.7, 1.3] based on install/mute history."""
    installed = tag_frequency_in_installs(90)      # last 90 days
    muted     = tag_frequency_in_overrides('muted', 90)
    ignored   = tag_frequency_recommended_not_installed(30)
    delta = 0.0
    for tag in tool_tags:
        delta += 0.05 * installed.get(tag, 0)
        delta -= 0.10 * muted.get(tag, 0)
        delta -= 0.02 * ignored.get(tag, 0)
    return max(0.7, min(1.3, 1.0 + delta))
```

`scout profile analyze` prints what the learning layer is doing.

---

## Part K — Installer

### 23. Four strategies

| Strategy | File | When |
|---|---|---|
| A. Native MCP | `installer/mcp.py` | Tool is already an MCP server |
| B. Claude plugin | `installer/plugin.py` | Slash command / agent / hook / output style |
| C. Skill | `installer/skill.py` | Has valid SKILL.md |
| D. Wrapper generation | `installer/wrapper.py` + `sandbox.py` + `static_scan.py` | Useful CLI/library with no MCP interface |

### 24. Safety rails (non-negotiable)

- Every install is dry-run first — shows config diff, asks `[y/N]`
- Before modifying `claude_desktop_config.json` or `~/.claude/mcp.json`, copy to `~/.tool-scout/backups/configs/<timestamp>-<file>`
- Installer command allowlist: `pip`, `pipx`, `uv`, `npm`, `npx`, `git clone`, `mkdir`, `cp` — nothing else
- Never executes install hints verbatim; treats them as suggestions to display
- Every install writes to `installs` table + JSONL `~/.tool-scout/audit.log`
- `scout uninstall` reverses using the saved `config_diff`

### 25. Wrapper generation (Strategy D)

Split across three files:

**`static_scan.py`** — before sandbox:

```python
DANGER_PATTERNS = [
    r"\bos\.system\b",
    r"\bsubprocess\.(run|Popen|call|check_output)\b",
    r"\b__import__\b",
    r"\beval\s*\(",
    r"\bexec\s*\(",
    r"\bshutil\.rmtree\b",
    r"\bsocket\.",
    r"\burllib\.",
    r"\brequests\.",
    r"\bopen\s*\([^)]*['\"][wa]",             # writing files
    r"\bpathlib\.[^.]+\.write",
    r"\b__file__\b.*\bopen\b",
]

def scan(code: str) -> tuple[bool, list[str]]:
    hits = [p for p in DANGER_PATTERNS if re.search(p, code)]
    return (len(hits) == 0, hits)
```

Any match → wrapper rejected, `wrapper_requests.status='failed'`, `static_scan_output` populated. Majied reviews via `scout queue show <job_id>`.

**`sandbox.py`** — Docker-isolated smoke test:

```python
# src/tool_scout/installer/sandbox.py
import subprocess, tempfile
from pathlib import Path

SANDBOX_IMAGE = "python:3.11-slim"

def run_smoke_test(wrapper_path: Path) -> tuple[bool, str]:
    with tempfile.TemporaryDirectory() as workdir:
        (Path(workdir) / "server.py").write_bytes(wrapper_path.read_bytes())
        cmd = [
            "docker", "run", "--rm",
            "--network=none",
            "--read-only", "--tmpfs", "/tmp:size=32m",
            "--cap-drop=ALL",
            "--memory=256m", "--cpus=0.5",
            "--user", "1000:1000",
            "-v", f"{workdir}:/app:ro",
            "-w", "/app",
            SANDBOX_IMAGE,
            "timeout", "60",
            "python", "-c",
            (
                "import importlib.util; "
                "spec = importlib.util.spec_from_file_location('s', 'server.py'); "
                "m = importlib.util.module_from_spec(spec); "
                "spec.loader.exec_module(m); "
                "assert hasattr(m, 'mcp') or hasattr(m, 'server'); "
                "print('SMOKE_OK')"
            ),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        passed = result.returncode == 0 and "SMOKE_OK" in result.stdout
        return passed, result.stdout + "\n" + result.stderr
```

**`wrapper.py`** — orchestrates:
1. Extract README excerpt + `--help` output (if available)
2. Call `claude_client.ask_file()` with the wrapper-gen prompt
3. Run `static_scan.scan()` on the output
4. If clean → run `sandbox.run_smoke_test()`
5. If both pass → commit to `web/public/wrappers/<tool_id>/server.py` via `git_publisher`
6. If either fails → log + set status=failed; optionally retry once with a stricter prompt

### 26. Wrapper-gen prompt (`config/prompts/wrapper_gen.md`)

```
You are generating a minimal MCP server that wraps an existing tool so it can be used from Claude Code.

Requirements:
- Use the official Python MCP SDK (`mcp[cli]`)
- Expose 1-5 of the most useful operations as MCP tools
- Windows-compatible (no /tmp, no shell=True without escaping)
- Self-contained in a single server.py file
- Start with a uv-runnable shebang: #!/usr/bin/env -S uv run --script
- Include inline dependency block (PEP 723) for uv
- Do NOT use: os.system, subprocess (except via Python stdlib's shutil.which), eval, exec, socket, urllib, requests, or any network call
- Do NOT write files outside of a 'tmp_path' parameter passed into individual tools

Tool being wrapped:
- Name: {name}
- URL: {url}
- Description: {description}
- README excerpt:
{readme}
- CLI help output:
{help_output}

Output ONLY the complete Python file contents. No prose. No markdown fences. No commentary.
```

---

## Part L — Google Sheets Sync

### 27. Auth

GCP service account. Credentials file at `~/.tool-scout/gcp-credentials.json`, path in `.env` as `GOOGLE_SERVICE_ACCOUNT_PATH`. Sheets API + Drive API enabled. Service account email granted Editor on the target Drive folder.

### 28. Workbook structure

One workbook per month: `tool-scout-YYYY-MM` (auto-created on first crawl of the month in the configured Drive folder).

| Tab | Purpose |
|---|---|
| `DASHBOARD` | Month metrics: total new tools, letter distribution, install success rate, Claude call counts |
| `ALL-TIME` | Full DB dump of public tools, sortable |
| `YYYY-MM-DD` (one per day) | Top 50 recommendations that day |

### 29. Daily tab columns

```
| Rank | Letter | Color | Name | Category | Subcategory |
| R | Q | N | I | F | Total | Source | URL | Install Hint | Tags | Notes | Install Command |
```

"Letter" cell is color-filled using `gspread.Worksheet.format()` with the hex from the rubric. Column "Color" holds the hex string for conditional formatting.

### 30. Cell coloring implementation

Use `gspread.Worksheet.batch_format()` with `CellFormat` entries keyed by letter:

```python
from gspread.cell import Cell
from gspread_formatting import CellFormat, Color, format_cell_ranges

def color_for_letter(letter: str) -> Color:
    hex_map = {"S":"8B5CF6","A":"10B981","B":"3B82F6","C":"F59E0B","D":"F97316","F":"6B7280"}
    h = hex_map[letter]
    r,g,b = int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255
    return Color(r, g, b)

ranges = [(f"B{i}", CellFormat(backgroundColor=color_for_letter(letter))) for i,letter in enumerate(letters, start=2)]
format_cell_ranges(worksheet, ranges)
```

`gspread-formatting` is a small helper lib — add to `pyproject.toml`.

### 31. Month rollover

First crawl of a new month detects no current-month workbook → creates `tool-scout-YYYY-MM` in the same Drive folder → seeds DASHBOARD + ALL-TIME + first daily tab.

---

## Part M — Web App (Next.js on Vercel)

### 32. Pages

| Route | Purpose |
|---|---|
| `/` | Catalog browse; filter by category/grade/language/source/recency; sort by grade or date |
| `/tool/[id]` | Tool detail; grade radar chart (R/Q/N/I/F); install snippet w/ copy; "Request Claude Code wrapper" button |
| `/today` | Top 50 recommendations today (prettier render of daily Sheets tab) |
| `/request/[id]` | Job status polling; download link when done |
| `/about` | How it works; data sources; credit to Majied w/ GitHub link |
| `/terms` | Terms of Service (§43) |
| `/privacy` | Privacy Policy (§44) |
| `/policy` | Content & Abuse Policy (§45) |

All pages link `/terms`, `/privacy`, `/policy` in footer.

### 33. Public data pipeline

After each crawl:
1. `export/vercel_export.py` writes gzipped JSON to `web/public/data/`
2. `git_publisher.publish_data()` commits with message `chore(data): crawl YYYY-MM-DD` and pushes
3. Vercel auto-deploys on push
4. Next.js fetches `/data/tools.json` at build time (ISR revalidate 1h)

### 34. Public data filtering

`vercel_export.py` emits only rows where:
- `visibility = 'public'` AND
- `user_overrides.state IS NULL OR state NOT IN ('excluded_by_owner', 'muted')` AND
- `dead = 0`

Before writing, strip:
- `readme_excerpt` to max 800 chars (no large reproductions of upstream READMEs)
- `install_hint` scrubbed for API-key-shaped strings via regex

### 35. `/api/request-wrapper` endpoint

```typescript
// web/app/api/request-wrapper/route.ts
// POST body: { tool_id: string, recaptcha_token: string }
// 1. Verify reCAPTCHA v3 score >= 0.5
// 2. Check per-IP rate (Edge Config): 3/24h
// 3. Check per-tool rate: 1/24h
// 4. Check global cap: 10/24h
// 5. POST to ngrok URL with X-Scout-Secret header
// 6. Return { job_id, estimated_wait_minutes }
// 7. On ngrok timeout (>5s): return 503 { error: "worker_offline" }
```

### 36. Rate limiting implementation

`web/lib/rate-limit.ts` uses Vercel Edge Config (free). Three keys per window:
- `rl:ip:<hash>` → count in current 24h window
- `rl:tool:<id>` → count per tool
- `rl:global` → global daily counter

Edge Config is writable; resets performed lazily on read when `window_start` rolls over.

### 37. Styling

Tailwind. Dark base (`#0a0a0a`), text-primary near-white, accent colors derived from grade letter hex. Mobile responsive. Hint of 2h2t cyberpunk in the homepage hero but restrained overall — readability first.

---

## Part N — Queue Worker + Webhook

### 38. ngrok setup

One-time via `scripts/install_ngrok_service.ps1`:

1. Download ngrok v3 for Windows
2. `ngrok config add-authtoken $env:NGROK_AUTHTOKEN`
3. Reserve static domain in the ngrok dashboard (free tier: 1 domain)
4. Write `%USERPROFILE%\.ngrok2\ngrok.yml`:
   ```yaml
   version: "3"
   agent:
     authtoken: ${NGROK_AUTHTOKEN}
   tunnels:
     queue:
       proto: http
       addr: 8765
       domain: ${NGROK_STATIC_DOMAIN}
   ```
5. `ngrok service install --config %USERPROFILE%\.ngrok2\ngrok.yml`
6. `ngrok service start`

Result: `https://<your-reserved>.ngrok.app` → `localhost:8765`. Survives reboot. Free.

### 39. Webhook receiver (`queue_worker/webhook.py`)

FastAPI on port 8765, started by queue worker service.

```python
# src/tool_scout/queue_worker/webhook.py
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import os, uuid
from tool_scout.db import SessionLocal
from tool_scout.models import WrapperRequest, Tool

app = FastAPI()

class EnqueuePayload(BaseModel):
    tool_id: str
    requester_ip: str
    requester_hash: str
    recaptcha_score: float

@app.post("/enqueue")
def enqueue(payload: EnqueuePayload, x_scout_secret: str = Header(...)):
    if x_scout_secret != os.environ["WEBHOOK_SHARED_SECRET"]:
        raise HTTPException(403, "bad secret")
    job_id = uuid.uuid4().hex
    with SessionLocal() as s:
        if not s.get(Tool, payload.tool_id):
            raise HTTPException(404, "unknown tool")
        s.add(WrapperRequest(
            id=job_id, tool_id=payload.tool_id,
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
        return {"status": r.status, "result_url": r.result_url, "error": r.error}
```

### 40. Worker loop (`queue_worker/worker.py`)

Triggered every 5 min by Task Scheduler (`scout queue run-next --if-pending`).

```
1. Check usage_tracker.can_call("wrapper_gen"); exit silently if blocked
2. SELECT oldest wrapper_requests WHERE status='pending' ORDER BY requested_at LIMIT 1
3. SET status='running', started_at=now
4. Gather readme excerpt + help output (if CLI)
5. claude_client.ask_file(prompt, tmp_wrapper_path)
6. static_scan.scan() → if hits, status='failed', static_scan_output=hits, exit
7. sandbox.run_smoke_test() → if not passed, retry once with stricter prompt
8. If final pass: git_publisher commits wrapper to web/public/wrappers/<tool_id>/server.py
9. SET status='success', result_url=/wrappers/<tool_id>/server.py, finished_at=now
10. On any exception: status='failed', error=repr(exc)
```

### 41. Rate limits (final values)

| Cap | Value |
|---|---|
| Per-IP | 3 requests / 24h |
| Per-tool | 1 request / 24h |
| Global | 10 requests / 24h |
| Request body size | 4 KB |
| Generated wrapper max size | 200 KB |

### 42. Offline handling

If PC is off → ngrok URL unreachable → `/api/request-wrapper` times out at 5s → returns 503 JSON `{ "error": "worker_offline", "message": "Maintainer's machine is offline. Requests resume when back online." }`. Web app surfaces this gracefully with a retry-later message.

---

## Part O — Security, Legal, and Operational Files

### 43. Terms of Service (`web/app/terms/page.tsx` — static content)

```
TERMS OF SERVICE — tool-scout

1. Service description
   tool-scout aggregates publicly-available information about developer tools
   and offers optional generation of MCP-server wrappers for them. Usage is
   free and provided as-is, with no warranty of availability, accuracy, or
   fitness for any purpose.

2. Acceptable use
   You agree not to:
   - Submit automated or abusive request volumes
   - Attempt to bypass rate limits
   - Request wrappers to harass, spam, or attack a tool's authors or users
   - Use generated wrappers to violate the wrapped tool's license

3. Generated wrappers
   Wrappers produced by this service are provided under the MIT License.
   You are responsible for complying with the license of the original tool
   being wrapped. Wrapped tools' authors have not endorsed, reviewed, or
   approved these wrappers.

4. Liability
   This is a personal project. Maximum liability is zero. Do not use
   generated code in production without your own review.

5. Changes
   Terms may change. Material changes will be noted on this page.

Last updated: {YYYY-MM-DD}
Contact: open a GitHub issue at github.com/Majied/tool-scout/issues
```

### 44. Privacy Policy (`web/app/privacy/page.tsx`)

```
PRIVACY POLICY — tool-scout

What we collect
  - IP address (retained 30 days, solely for rate limiting; hashed before DB storage)
  - Request timestamps and tool IDs
  - reCAPTCHA scores (anonymous, via Google)
  - No cookies except those required for site function

What we do NOT collect
  - Names, emails, accounts (we have none)
  - Browser fingerprints
  - Analytics of individual user behavior

Third parties that see request metadata
  - Vercel (hosting)
  - Google (reCAPTCHA)
  - ngrok (tunnel; sees headers and body in transit)
  - GitHub (generated wrappers are stored in a public repo)

Data deletion
  Open a GitHub issue with your approximate request timestamps; logs
  covering that window will be purged within 7 days.

Last updated: {YYYY-MM-DD}
```

### 45. Content & Abuse Policy (`web/app/policy/page.tsx`)

```
CONTENT POLICY

Inclusion
  tool-scout indexes tools from public sources (GitHub, npm, PyPI, MCP
  registries, curated lists, public posts). Tools appear automatically
  based on public signals.

Takedown
  Tool authors who wish to be removed may open a GitHub issue with the
  "takedown" label. Removal typically within 48 hours. Removed tools are
  permanently excluded and will not be re-added on future crawls.

Wrapper requests
  If a generated wrapper infringes a license or terms, open a takedown
  issue with the wrapper URL. The wrapper file and the tool's "Request
  wrapper" button will be disabled.

Abuse
  Per-IP rate limits apply (3 wrapper requests / 24h). Repeated abuse
  results in permanent IP blacklisting.
```

### 46. `.github/ISSUE_TEMPLATE/takedown.yml`

```yaml
name: Takedown request
description: Request removal of a tool or generated wrapper from tool-scout
labels: [takedown]
assignees: [Majied]
body:
  - type: input
    id: tool_url
    attributes:
      label: Tool or wrapper URL
      description: The full URL of the tool or wrapper you want removed
    validations:
      required: true
  - type: dropdown
    id: role
    attributes:
      label: Your role
      options:
        - Tool owner/maintainer
        - Authorized representative of the tool owner
        - Concerned third party
    validations:
      required: true
  - type: textarea
    id: reason
    attributes:
      label: Reason
      description: Optional — helps us prioritize
```

### 47. SECURITY.md

```markdown
# Security Policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:
https://github.com/Majied/tool-scout/security/advisories/new

Please do not file public issues for security vulnerabilities. Expect a
response within 7 days.

## Scope

In scope:
- The tool-scout crawler, classifier, wrapper generator, and public web app
- Any code in this repository

Out of scope:
- Vulnerabilities in third-party tools indexed by the crawler (report to
  those tools' maintainers)
- Vulnerabilities in Claude Code itself (report to Anthropic)
```

### 48. CONTRIBUTING.md

```markdown
# Contributing

tool-scout is a personal project and is developed primarily by its owner.
Pull requests are welcome but not guaranteed to be merged or reviewed
quickly. For large changes, open an issue first to discuss.

## Development setup
See README.md.

## Code style
- Python: ruff format, ruff check, mypy in strict mode for src/
- TypeScript: Next.js defaults, strict mode
- All tests via pytest must pass before merge

## Commit messages
Conventional-commits-ish: `feat:`, `fix:`, `chore:`, `docs:`.
```

### 49. LICENSE — standard MIT text.

### 50. `.gitignore`

```
# Secrets & local data
.env
.env.local
*.pem
*.p12
gcp-credentials.json
git-credentials
ngrok.yml

# Local runtime
*.db
*.db-wal
*.db-shm
.tool-scout/
~/.tool-scout/
logs/
cache/
backups/
installed/

# Python
__pycache__/
*.pyc
.pytest_cache/
.mypy_cache/
.ruff_cache/
dist/
build/
*.egg-info/

# Node / Next
node_modules/
.next/
web/.vercel/
.env*.local

# OS / IDE
.DS_Store
Thumbs.db
.vscode/
.idea/

# Explicitly NOT ignored — want these committed:
# web/public/data/**
# web/public/wrappers/**
```

---

## Part P — Operations

### 51. Backup (`operations/backup.py`)

Third Task Scheduler job, 04:30 daily (after crawl finishes).

```python
# src/tool_scout/operations/backup.py
import sqlite3, gzip, shutil
from datetime import datetime, timedelta
from pathlib import Path

BACKUP_DIR = Path.home() / ".tool-scout" / "backups"
DB_PATH = Path.home() / ".tool-scout" / "scout.db"

def backup_now() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y-%m-%d")
    target = BACKUP_DIR / f"scout-{ts}.db"

    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(target)
    with dst:
        src.backup(dst)                # online backup API
    dst.close(); src.close()

    # integrity check
    conn = sqlite3.connect(target)
    ok = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    conn.close()
    if not ok:
        target.unlink()
        raise RuntimeError("backup integrity_check failed")

    # gzip anything older than 1 day
    for f in BACKUP_DIR.glob("scout-*.db"):
        mtime = datetime.fromtimestamp(f.stat().st_mtime)
        if datetime.utcnow() - mtime > timedelta(days=1):
            with open(f, "rb") as fi, gzip.open(f.with_suffix(".db.gz"), "wb") as fo:
                shutil.copyfileobj(fi, fo)
            f.unlink()

    _rotate()
    return target

def _rotate():
    """Keep 7 daily, 4 weekly (Sundays), 6 monthly (1st of month). Delete everything else."""
    # Implementation: sort existing, categorize by filename date, prune.
```

`scout restore <YYYY-MM-DD>` restores (with confirmation) by overwriting `scout.db` after renaming the live one to `scout.db.predate`.

Disk cap: 2 GB. If exceeded, purge oldest beyond 7-day window first.

### 52. Log rotation (`util/logging.py`)

`RotatingFileHandler` — 10 MB per file, keep 5 files. Three targets in `~/.tool-scout/logs/`:
- `scout.log` — general
- `crawl.log` — per-source details
- `queue.log` — wrapper request lifecycle

Cache dir `~/.tool-scout/cache/` — swept at end of every crawl; anything with mtime > 48h old is deleted.

### 53. Crawl health guardrail (`operations/guardrail.py`)

Before `vercel_export` publishes public data:

```python
def passes_guardrail(run_stats) -> tuple[bool, str]:
    avg_new_7d = db_avg_new_tools_last_n_runs(7)
    if run_stats.new_tools < max(avg_new_7d * 0.2, 20):
        return False, f"new_tools={run_stats.new_tools} vs 7d avg={avg_new_7d:.0f} — probable source failure"
    if len(run_stats.errors) > 3:
        return False, f"{len(run_stats.errors)} source errors — deferring publish"
    return True, "ok"
```

If guardrail fails: crawl still completes, DB still updated, Sheets still sync (those are local-only surfaces). But `vercel_export` + `git_publisher` are **skipped**. Alert surfaces red in `scout status`. User can manually override via `scout export --force` after investigation.

### 54. Alembic migrations

```
# alembic.ini (minimal)
[alembic]
script_location = migrations
sqlalchemy.url = sqlite:///%(HOME)s/.tool-scout/scout.db

# migrations/env.py — standard boilerplate
```

Every schema change adds a new version under `migrations/versions/`. `scout doctor` runs `alembic upgrade head` silently on startup.

### 55. `scout status` output

```
Tool Scout status — 2026-04-19 14:22
────────────────────────────────────────
Last crawl:        2026-04-19 03:47   ✓ 537 new / 12 errors
Last publish:      2026-04-19 04:05   ✓ deployed to Vercel
Last backup:       2026-04-19 04:30   ✓ integrity ok (412 MB)
Last queue job:    2026-04-19 12:15   ✓ tool-abc123 (6.2 min)
Claude usage 5h:   12/40
Claude usage 24h:  89/120
ngrok:             ● online (tool-scout.ngrok.app)
Docker:            ● running
Pending queue:     2 jobs
Guardrail:         ✓ healthy
Next crawl:        2026-04-20 03:00
```

---

## Part Q — CLI Reference

### 56. Full command list

```
# Core
scout doctor                            # validates everything; walks through missing credentials
scout crawl [--quick]                   # quick = 10-min GitHub+MCP-only run
scout status
scout usage                             # Claude calls, 5h and 24h windows

# Discovery
scout list [--category X] [--letter S|A|B|C|D|F] [--since 7d] [--limit 20]
scout search <query>
scout show <tool-id>
scout recommend [--count 15]

# Personalization
scout pin <tool-id>
scout mute <tool-id>
scout takedown <tool-id> [--reason "..."]
scout profile edit
scout profile show
scout profile analyze                   # what the learning layer is doing

# Install
scout install <tool-id> [--yes] [--strategy auto|native|wrapper]
scout uninstall <tool-id>
scout installed                         # inventory

# Sheets
scout sheets sync
scout sheets open
scout sheets status

# Publishing
scout publish <tool-id>                 # flip visibility to public
scout export [--force]                  # write data, git commit, git push
scout deploy                            # alias: export --force + Vercel deploy hook

# Queue
scout queue list
scout queue show <job_id>
scout queue run-next [--if-pending]
scout queue retry <job_id>
scout queue cancel <job_id>
scout queue blacklist <ip>
scout queue stats

# Operations
scout backup                            # run backup now
scout restore <YYYY-MM-DD>              # with confirmation
scout logs [--tail 100] [--kind crawl|queue|scout]

# Scheduling
scout schedule install crawl
scout schedule install queue-worker
scout schedule install backup
scout schedule install ngrok
scout schedule remove all
```

---

## Part R — Scheduled Tasks

### 57. `scripts/install_crawl_task.ps1`

```powershell
$action = New-ScheduledTaskAction `
    -Execute "pwsh.exe" `
    -Argument "-NoProfile -Command `"scout crawl`""
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
$settings = New-ScheduledTaskSettingsSet `
    -WakeToRun -StartWhenAvailable -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName "ToolScoutDailyCrawl" `
    -Action $action -Trigger $trigger -Settings $settings `
    -Description "tool-scout daily crawl"
```

### 58. `scripts/install_queue_worker_task.ps1`

```powershell
$action = New-ScheduledTaskAction `
    -Execute "pwsh.exe" `
    -Argument "-NoProfile -Command `"scout queue run-next --if-pending`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "ToolScoutQueueWorker" `
    -Action $action -Trigger $trigger -Settings $settings
```

### 59. `scripts/install_backup_task.ps1`

```powershell
$action = New-ScheduledTaskAction `
    -Execute "pwsh.exe" `
    -Argument "-NoProfile -Command `"scout backup`""
$trigger = New-ScheduledTaskTrigger -Daily -At 4:30am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName "ToolScoutDailyBackup" `
    -Action $action -Trigger $trigger -Settings $settings
```

### 60. `scripts/install_ngrok_service.ps1`

See §38.

---

## Part S — Environment Variables

### 61. `.env.example`

```
# ─── Crawler ───────────────────────────────────
GITHUB_TOKEN=ghp_xxx                        # public_repo scope

# ─── Sheets ────────────────────────────────────
GOOGLE_SERVICE_ACCOUNT_PATH=C:\Users\Majied\.tool-scout\gcp-credentials.json
GOOGLE_DRIVE_FOLDER_ID=1AbCdEfGhIjK...

# ─── Git publisher (bot identity) ──────────────
GIT_REPO_URL=https://github.com/Majied/tool-scout.git
GIT_BOT_USERNAME=tool-scout-bot
GIT_BOT_EMAIL=bot@tool-scout.invalid
GIT_BOT_TOKEN=ghp_xxx                       # fine-scoped PAT: contents:write on this repo only

# ─── ngrok ─────────────────────────────────────
NGROK_AUTHTOKEN=xxx
NGROK_STATIC_DOMAIN=your-reserved-domain.ngrok.app

# ─── Webhook ───────────────────────────────────
WEBHOOK_SHARED_SECRET=                      # filled by scout doctor (32-byte random hex)
WEBHOOK_LOCAL_PORT=8765

# ─── reCAPTCHA (also set in Vercel env) ────────
RECAPTCHA_SITE_KEY=xxx
RECAPTCHA_SECRET_KEY=xxx

# ─── Vercel ────────────────────────────────────
VERCEL_DEPLOY_HOOK_URL=https://api.vercel.com/v1/integrations/deploy/xxx

# ─── Tunables ──────────────────────────────────
LOG_LEVEL=INFO
CLAUDE_BINARY_PATH=claude
MAX_CLAUDE_CALLS_PER_5H=40
MAX_CLAUDE_CALLS_PER_DAY=120
RATE_LIMIT_PER_IP_PER_DAY=3
RATE_LIMIT_GLOBAL_PER_DAY=10

# ─── Optional ──────────────────────────────────
REDDIT_USER_AGENT=tool-scout/0.1
```

**Explicitly absent:** `ANTHROPIC_API_KEY`, Cloudflare keys, R2 keys, Turnstile keys. None are needed.

---

## Part T — Build Order

### 62. Phases

| Phase | Work | Est. days | Gate |
|---|---|---|---|
| 1 | Skeleton + DB + Alembic 0001 + `scout doctor` (all credential checks incl. Docker) | 0.5 | `scout doctor` green |
| 2 | Crawler: GitHub + local_projects + time budget | 1.0 | 100+ tools crawled in < 20 min |
| 3 | Two-tier classifier + usage_tracker | 0.5 | 85%+ accuracy on 50-tool fixture |
| 4 | Grading rubric (all 5 axes) + unit tests per axis | 0.5 | All axes compute correctly |
| 5 | Remaining crawl sources + recommender + learning loop | 1.0 | Full crawl writes ≥500 tools |
| 6 | Installer A/B/C + takedown support + config backups | 1.0 | Install + uninstall round-trip works |
| 7 | Google Sheets sync + monthly workbook + colored cells | 1.0 | **GATE: Majied reviews Sheets output** |
| 8 | Wrapper gen (Strategy D) + static_scan + Docker sandbox | 1.5 | Known-good wrapper passes; known-bad rejected |
| 9 | Vercel export + git_publisher + guardrail + public-repo files | 1.0 | First `git push` triggers Vercel deploy |
| 10 | Next.js web app (catalog, detail, filters, Terms/Privacy/Policy) | 2.0 | **GATE: Majied reviews live site** |
| 11 | ngrok + webhook receiver + queue worker + reCAPTCHA | 1.0 | **GATE: end-to-end wrapper request works** |
| 12 | Backup task + log rotation + `scout status` + final polish | 1.0 | All Definition of Done items pass |

**Total: 12 days focused work.** Gate points (7, 10, 11) require Majied's review before proceeding.

### 63. Test fixtures

`tests/fixtures/` must include:
- 50 sample tool records (JSON) for classifier accuracy test
- 5 sample READMEs covering each category
- One known-good MCP wrapper (should pass sandbox)
- One known-bad MCP wrapper (contains `os.system`, should be rejected by static_scan)
- One borderline wrapper (nothing dangerous but does nothing useful, should fail sandbox)

---

## Part U — Definition of Done

### 64. Acceptance checklist

1. `scout doctor` green: DB migrations applied, Claude CLI reachable, Docker running, GitHub token valid, git bot credentials work (test push succeeds), Sheets service account access confirmed, ngrok tunnel live, reCAPTCHA keys valid, Vercel deploy hook reachable.
2. Four scheduled tasks active: daily crawl (03:00), queue worker (5-min), daily backup (04:30), ngrok service.
3. `scout crawl` completes 60–75 min, ≥ 500 tools, zero Anthropic API key used, stays inside 40/5h limits.
4. All tools graded with letter + color. No NULL grades.
5. `scout recommend` outputs 15 picks; ≥ 3 match Hytale/HYDRA/Windows interests.
6. Current month's Google Sheets workbook exists; today's tab populated; letter cells color-filled matching rubric.
7. `tool-scout.vercel.app` loads; catalog renders with filters; grade badges correct; Terms/Privacy/Policy pages reachable from footer.
8. End-to-end wrapper request: web form → reCAPTCHA → ngrok → queue → Claude gen → static scan → Docker sandbox → git commit → Vercel deploy → download link. Total < 15 min.
9. Rate limits enforced: 4th IP request / 24h → 429; 11th global / 24h → queued tomorrow.
10. Usage throttle tested: artificially setting 40 calls in 5h blocks next classify cleanly; checkpoint resumes next run.
11. Sandbox rejects malicious wrapper (contains `os.system`) via static scan; rejects network-using wrapper via `--network=none` failure; accepts known-good wrapper.
12. `scout uninstall` reverses a native MCP install using the backed-up config.
13. Public JSON export excludes `visibility != 'public'` and `user_overrides.state in ('excluded_by_owner','muted')`.
14. Offline test: stopping ngrok service → `/api/request-wrapper` returns 503 with friendly message.
15. `scout backup` produces a gzipped file; `scout restore <yesterday>` succeeds on a test DB.
16. `scout takedown <tool-id>` removes the tool from public JSON on next export; tool never reappears even if re-crawled.
17. Guardrail check blocks a simulated "3 new tools" crawl from publishing while still updating local DB.
18. `.gitignore` verified — `.env`, `scout.db`, credential files never appear in git history.
19. Alembic migrations run cleanly from an empty DB to head.
20. Total monthly cost = $0 (verify: Vercel Hobby, GCP no billing, ngrok free, GitHub public repo).

---

## Part V — Post-launch Tuning (first 2 weeks)

### 65. What to watch

- `scout usage` once a day: if tool-scout consistently eats > 40% of the 5h window during Majied's active Claude Code hours, tune down (raise heuristics threshold, raise batch size, drop global wrapper cap).
- Failed wrapper-gen ratio: if > 50%, tighten the prompt or add more structural examples.
- Guardrail false-positive rate: if it's blocking publish on normal-looking runs, loosen `new_tools < 20%` threshold.
- Sheets API quota: default free quota is plenty but worth watching the first month.

### 66. v1.1 candidates (deferred)

- Ollama fallback classifier (HYDRA MoM alignment)
- Hytale Discord/forum crawler
- `scout outdated` — detect updates to installed tools
- `scout self-update` — `git pull` + re-run migrations + restart services
- Email/Discord notifications for S-tier finds
- Community submit-a-tool form

---

## Part W — Risks Acknowledged

- **Subscription usage:** 150 classify calls/day + occasional wrapper gens sits inside Max's 5-hour windows today but isn't guaranteed forever. Mitigation: throttle + checkpoint + tuning levers in §65.
- **ngrok free = 1 tunnel:** if Majied needs a tunnel for something else, tool-scout goes offline until reclaimed. Mitigation: document; if painful, swap to `localhost.run` (no account but rotating URL) or pay $8/mo.
- **Public repo exposes `profile.yaml`:** intentional (Majied is already publicly associated with Hytale/HYDRA). Phase 9 scrubs anything newly sensitive.
- **Wrapper gen on public demand:** Docker sandbox + static scan + rate limits are the defense. Still possible a clever attacker finds a way to get useful malicious code out. Mitigation: static scan can be tightened; sandbox has `--network=none` so leakage is hard; generated code is public so abuse is auditable.
- **Generated wrapper quality:** first-shot success expected ~50%. Majied can manually review `scout queue show <job_id>` for failed ones and improve prompts over time.

---

## Part X — Documents Superseded

- `CLAUDE_CODE_HANDOFF_tool-scout.md` (v1)
- `CLAUDE_CODE_HANDOFF_tool-scout_v2.md`
- `CLAUDE_CODE_HANDOFF_tool-scout_v3.md`
- `CLAUDE_CODE_HANDOFF_tool-scout_v4.md`
- `CLAUDE_CODE_HANDOFF_tool-scout_v4_supplement.md`

This document (v1.0 final) is the single authoritative source.

---

**End of specification.** Hand this to Claude Code along with `TOOL_SCOUT_SETUP.md`. Start at Phase 1. `scout doctor` gates Phase 2. Review gates at Phases 7, 10, and 11.
