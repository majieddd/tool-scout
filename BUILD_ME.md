# BUILD_ME.md — Master Synthesis Spec

> **Purpose:** The single operational source of truth for building Tool Scout. Tells you what to do at every step, where to look for details, and what's already been pre-baked into starter files so you don't rewrite them.
>
> **Audience:** Claude Code. Read this first. The detailed specs in `docs/` are reference material consulted as needed during each phase.
>
> **Authority:** Where this file disagrees with `docs/01_SPEC.md` or `docs/02_SPEC_v1.1_SYMPHONY.md` on operational matters (build order, skip rules, gate points), this file wins. Where it disagrees on architecture, schema, or code samples, the docs win and this file is wrong — flag it.

---

## 0. The build in one paragraph

You are building a daily-crawling, public-catalog, on-demand-wrapper-generation service for Claude-compatible tools. It runs on Windows 11 against the user's existing Claude Max subscription plus free tiers of Vercel, ngrok, GitHub, and Google Cloud — total monthly cost $0. Three surfaces: terminal CLI (`scout` commands), Google Sheets monthly workbook, and a Next.js web app at `tool-scout.vercel.app`. The wrapper-generation queue uses an OpenAI-Symphony-pattern orchestrator: a long-running Windows Service that polls a local SQLite tracker, dispatches isolated workers, runs Claude Code in multi-turn continuation mode, smoke-tests output in a Docker container with no network access, and publishes successful wrappers to GitHub (which auto-deploys via Vercel). Build time: 13.5 focused days across 12 phases with 3 review gates.

---

## 1. Document map — what to read when

| When you're working on… | Primary reference | Supporting |
|---|---|---|
| **Anything** — read these once before Phase 1 | `docs/01_SPEC.md` (full), `docs/02_SPEC_v1.1_SYMPHONY.md` (full), this file (full) | — |
| Phase 1 — skeleton, DB, doctor | `docs/01_SPEC.md` Parts D, E, §62 | `starter-files/pyproject.toml`, `starter-files/.env.example`, `starter-files/.gitignore` |
| Phase 2 — GitHub crawler + local_projects | `docs/01_SPEC.md` §11–13 | `config/sources.yaml` (already written) |
| Phase 3 — classifier | `docs/01_SPEC.md` §14–16 | `config/prompts/classify_batch.md` (already written) |
| Phase 4 — grading rubric | `docs/01_SPEC.md` §17–19 | `config/grading_rubric.yaml` (already written) |
| Phase 5 — remaining crawl + recommender | `docs/01_SPEC.md` §11, §20–22 | `config/profile.yaml` (already written) |
| Phase 6 — installer A/B/C + takedown | `docs/01_SPEC.md` §23–24 | `config/adapters.yaml` |
| Phase 7 — Google Sheets sync | `docs/01_SPEC.md` §27–31 | gspread + gspread-formatting |
| Phase 8 — wrapper gen + Docker sandbox | `docs/01_SPEC.md` §25–26 | `tests-fixtures/` |
| Phase 9 — Vercel export + git publisher + repo files | `docs/01_SPEC.md` §10, §33–34, §43–50 | All `starter-files/` |
| Phase 10 — Next.js web app | `docs/01_SPEC.md` §32–37 | `templates/` (legal pages), `starter-files/web/` |
| **Phase 11 — Symphony orchestrator** | **`docs/02_SPEC_v1.1_SYMPHONY.md` (entire file)** | `starter-files/WORKFLOW.md`, `scripts/install_orchestrator_service.ps1` |
| Phase 12 — backup + polish | `docs/01_SPEC.md` §51–55, §64 | `scripts/install_backup_task.ps1` |
| Pre-flight (Majied does this, not you) | `docs/03_PREFLIGHT_SETUP.md` | — |

**Note on Phase 11:** v1.1 entirely supersedes v1.0 §38–§42. Do not implement the cron-style 5-minute worker. Build the orchestrator service instead.

---

## 2. What's already done (do not rewrite)

The user has hand-curated these. Treat them as canonical inputs. If you find yourself wanting to change them mid-build, stop and propose the change first.

### 2.1 Configuration (in `config/`)

| File | Status | What it contains |
|---|---|---|
| `sources.yaml` | ✅ done | Every crawl source with per-source budget; GitHub queries, MCP registries, npm/PyPI patterns, awesome-list repos, Reddit/HN, Anthropic blog feed, local projects roots |
| `profile.yaml` | ✅ done | Majied's interest weights (game-dev, mcp, hytale, python, etc.), active projects (HYDRA, Kingdoms-Mod, Echoes-Mod, tool-scout), excludes (crypto, NFT) |
| `grading_rubric.yaml` | ✅ done | All 5 axes with scoring formulas, letter bands with hex colors |
| `adapters.yaml` | ✅ stub | Empty overrides map; populate as you discover edge cases |
| `prompts/classify_batch.md` | ✅ done | The classifier prompt (heuristics fallback) |

### 2.2 Starter files (in `starter-files/`)

| File | Status | What it contains |
|---|---|---|
| `pyproject.toml` | ✅ done | Pinned deps for everything in v1.0 + v1.1 (typer, rich, httpx, sqlalchemy, alembic, gspread, gitpython, fastapi, python-liquid, etc.) |
| `web/package.json` | ✅ done | Next.js 15, React 18, Recharts, Tailwind |
| `WORKFLOW.md` | ✅ done | Full Symphony orchestrator config + wrapper-gen prompt body |
| `.env.example` | ✅ done | Every env var, with comments |
| `.gitignore` | ✅ done | Covers `.env`, `*.db`, all credential patterns |
| `LICENSE` | ✅ done | MIT |
| `README.md` (public) | ✅ done | Project README for the public repo |
| `SECURITY.md`, `CONTRIBUTING.md` | ✅ done | — |
| `CLAUDE.md` | ✅ done | Commit conventions; Claude Code reads this every session |
| `.github/dependabot.yml` | ✅ done | Weekly Python + Node updates |
| `.github/ISSUE_TEMPLATE/*.yml` | ✅ done | takedown, bug, feature templates |

### 2.3 PowerShell scripts (in `scripts/`)

| File | Status | What it does |
|---|---|---|
| `install_crawl_task.ps1` | ✅ done | Daily 03:00 crawl |
| `install_backup_task.ps1` | ✅ done | Daily 04:30 backup |
| `install_ngrok_service.ps1` | ✅ done | ngrok as Windows Service |
| `install_orchestrator_service.ps1` | ✅ done | NSSM-wrapped orchestrator service |
| `uninstall_all.ps1` | ✅ done | Clean removal |

### 2.4 Templates (in `templates/`)

| File | Status | What it is |
|---|---|---|
| `terms.md`, `privacy.md`, `policy.md` | ✅ done | Drop into `web/app/{terms,privacy,policy}/page.tsx` |

### 2.5 Test fixtures (in `tests-fixtures/`)

| File | Status | Used by |
|---|---|---|
| `known_good_wrapper.py` | ✅ done | Phase 8 sandbox positive test |
| `known_bad_wrapper.py` | ✅ done | Phase 8 static_scan rejection test |
| `borderline_wrapper.py` | ✅ done | Phase 8 sandbox negative test (clean code, missing MCP symbol) |
| `sample_tool_records/*.json` | ✅ done | Phase 3 classifier accuracy test |

---

## 3. What you (Claude Code) write from scratch

Everything else. Specifically:

| Module | Source of truth |
|---|---|
| `src/tool_scout/cli.py` (Typer entry) | `docs/01_SPEC.md` §56 |
| `src/tool_scout/db.py`, `models.py` | `docs/01_SPEC.md` Part E §7 |
| `src/tool_scout/claude_client.py` | `docs/01_SPEC.md` §8 (full code given) |
| `src/tool_scout/usage_tracker.py` | `docs/01_SPEC.md` §9 (full code given) |
| `src/tool_scout/git_publisher.py` | `docs/01_SPEC.md` §10 (full code given) |
| `src/tool_scout/crawler/*` | `docs/01_SPEC.md` Part G |
| `src/tool_scout/classifier/*` | `docs/01_SPEC.md` §14–16 |
| `src/tool_scout/grading/rubric.py` | `docs/01_SPEC.md` Part I |
| `src/tool_scout/recommender/*` | `docs/01_SPEC.md` Part J |
| `src/tool_scout/installer/*` | `docs/01_SPEC.md` Part K |
| `src/tool_scout/sheets/*` | `docs/01_SPEC.md` Part L |
| `src/tool_scout/export/vercel_export.py` | `docs/01_SPEC.md` §33–34 |
| **`src/tool_scout/queue_worker/*`** | **`docs/02_SPEC_v1.1_SYMPHONY.md` §5–11 (full code given)** |
| `src/tool_scout/operations/*` | `docs/01_SPEC.md` §51–53 |
| `migrations/versions/0001_initial.py` | Generated from `docs/01_SPEC.md` Part E §7 SQL |
| `migrations/versions/0002_orchestrator.py` | `docs/02_SPEC_v1.1_SYMPHONY.md` §4 SQL |
| `web/app/**/page.tsx`, `web/components/*.tsx`, `web/lib/*.ts` | `docs/01_SPEC.md` §32–37 |
| `tests/test_*.py` | Each phase's testing requirement; fixtures are in `tests/fixtures/` |

When `docs/01_SPEC.md` provides full code (e.g. §8 `claude_client.py`, §9 `usage_tracker.py`, §10 `git_publisher.py`) — use it as-is. Don't paraphrase.

---

## 4. Phase-by-phase build plan

### Pre-Phase 1 sanity check (~10 min)

Before touching any code:

```powershell
# All must succeed:
python --version            # 3.11+
node --version              # 20+
pwsh --version              # 7.4+
git --version               # 2.40+
claude --version            # any
docker run --rm hello-world # prints success
ngrok version               # 3.x
nssm version                # 2.24+

# Repo cloned, starter files copied:
Test-Path .\pyproject.toml  # True (from starter-files)
Test-Path .\WORKFLOW.md     # True
Test-Path .\config\sources.yaml  # True
Test-Path .\.env            # True (Majied filled in credentials)
```

If any fail → stop and tell Majied which item is missing. Don't try to install platform tools yourself.

### Phase 1 — Skeleton + DB + Alembic + scout doctor (0.5 day)

**Goal:** `scout doctor` runs and prints all-green output.

**Steps:**

1. `pip install -e ".[dev]"` (uses the `pyproject.toml` already in repo)
2. Initialize Alembic: `alembic init migrations` → adjust `alembic.ini` to point at `~/.tool-scout/scout.db`
3. Write `migrations/versions/0001_initial.py` with all tables from `docs/01_SPEC.md` §7
4. Write `migrations/versions/0002_orchestrator.py` with the orchestrator additions from `docs/02_SPEC_v1.1_SYMPHONY.md` §4 (do this now, not at Phase 11 — Alembic should be at head before any other work)
5. Write `src/tool_scout/db.py` (SQLAlchemy engine + session) and `src/tool_scout/models.py` (SQLAlchemy models matching the SQL)
6. Write `src/tool_scout/cli.py` skeleton (Typer app with placeholder commands)
7. Write `src/tool_scout/operations/doctor.py` checking:
   - `claude --version` succeeds
   - `docker run --rm hello-world` succeeds
   - GitHub crawler token validates against `https://api.github.com/user`
   - Git bot token can push to the repo (try a noop commit on a test branch, then delete branch)
   - Google service account JSON parses + has the expected service-account email
   - Drive folder ID is accessible (list files in folder via Sheets API)
   - ngrok auth + static domain configured
   - Vercel deploy hook URL responds (HEAD request → 401 or 200 both OK; we just want network reachability)
   - reCAPTCHA secret can verify a test token
   - `WEBHOOK_SHARED_SECRET` is missing → generate via `secrets.token_hex(32)` and offer to write to `.env`
   - `pwsh`, `nssm`, `ngrok` all on PATH
8. `alembic upgrade head` runs cleanly
9. `pytest` runs (no tests yet but pytest discoverable)

**Done criteria:**
- `scout doctor` output is all green (or has clear, actionable errors)
- Empty SQLite file at `~/.tool-scout/scout.db` with all tables
- One commit pushed: `chore(phase-01): skeleton + db + scout doctor`

### Phase 2 — Crawler: GitHub + local_projects (1 day)

**Goal:** `scout crawl --quick` pulls 100+ tool records from GitHub and writes them to the DB.

**Reference:** `docs/01_SPEC.md` §11 (sources), §12 (time budget), §13 (politeness). `config/sources.yaml` already drives source enable/disable.

**Steps:**

1. `src/tool_scout/util/time_budget.py` — `TimeBudget` class with `start`, `consume`, `remaining`, `expired` methods + `--quick` overrides
2. `src/tool_scout/util/rate_limit.py` — per-domain `httpx` semaphore + 24h disk cache at `~/.tool-scout/cache/`
3. `src/tool_scout/crawler/runner.py` — orchestrator that loads `sources.yaml`, dispatches enabled sources, collects records, writes to `tools` table
4. `src/tool_scout/crawler/github.py` — implements topic search and code search; respects `GITHUB_TOKEN`
5. `src/tool_scout/crawler/local_projects.py` — walks Majied's project folders looking for `SKILL.md`, `plugin.json`, `mcp.json`, etc.
6. Hook into `scout crawl`/`scout crawl --quick` in CLI

**Tests:**
- `tests/test_time_budget.py` — hard-kill at 75 min works
- `tests/test_github_crawler.py` — mocked HTTP returns expected record shape
- `tests/test_rate_limit.py` — cache hit avoids HTTP

**Done criteria:**
- `scout crawl --quick` writes ≥ 100 tools in < 20 min
- `scout list --limit 5` shows recent results
- Commit: `feat(phase-02): github crawler + local projects`

### Phase 3 — Two-tier classifier + usage_tracker (0.5 day)

**Goal:** Crawled tools get categorized; ≥85% accuracy on the 6-record fixture set.

**Reference:** `docs/01_SPEC.md` §14–16, full code for `claude_client.py` and `usage_tracker.py` in §8–9.

**Steps:**

1. Drop in `claude_client.py` and `usage_tracker.py` exactly as written in `docs/01_SPEC.md`
2. Write `src/tool_scout/classifier/heuristics.py` with the 6 rules in §15
3. Write `src/tool_scout/classifier/claude_classifier.py` — batch-of-20 calls using the prompt at `config/prompts/classify_batch.md`
4. Write the cache-key logic: `sha256(url + readme[:1024])`; skip reclassification if unchanged
5. Hook into `scout crawl` so classification runs after collection

**Tests:**
- `tests/test_heuristics.py` — each of the 6 rules fires on the right fixture
- `tests/test_classifier_accuracy.py` — load all 6 sample records, run full classifier, assert ≥85% match the expected category

**Done criteria:**
- 6 sample records all classify correctly
- `scout usage` shows Claude calls were made
- Commit: `feat(phase-03): two-tier classifier`

### Phase 4 — Grading rubric (0.5 day)

**Goal:** Every tool has a row in `grades` table with R/Q/N/I/F + total + letter + color.

**Reference:** `docs/01_SPEC.md` §17–19. `config/grading_rubric.yaml` is the config.

**Steps:**

1. Write `src/tool_scout/grading/rubric.py` reading the YAML
2. Implement each axis as a function `compute_relevance(tool, profile) -> float` etc.
3. Implement `compute_grade(tool, profile, rubric) -> Grade` which writes/updates `grades` table
4. Hook into `scout crawl` so grading runs after classification

**Tests:**
- `tests/test_rubric.py` — each axis computes deterministic value for fixture inputs
- An mcp-server with high stars + recent commits + python + windows-friendly grades S
- An ios-only tool grades F or near-F

**Done criteria:**
- All tools in DB have non-NULL grade
- `scout list --letter S` returns something
- Commit: `feat(phase-04): grading rubric`

### Phase 5 — Remaining sources + recommender + learning loop (1 day)

**Goal:** Full crawl writes ≥ 500 tools. `scout recommend` returns 15 letter-graded picks with at least 3 matching Hytale/HYDRA/Windows.

**Reference:** `docs/01_SPEC.md` §11 (remaining sources), §20–22 (recommender + learning).

**Steps:**

1. Implement remaining crawler modules: `npm.py`, `pypi.py`, `mcp_registries.py`, `awesome_lists.py` (weekly only), `reddit.py`, `hackernews.py`, `anthropic_blog.py`
2. Write `src/tool_scout/recommender/profile.py` (loads profile.yaml)
3. Write `src/tool_scout/recommender/scorer.py` (per §21 formula)
4. Write `src/tool_scout/recommender/learning.py` (per §22 — kicks in after 10 installs)
5. Hook into `scout recommend` CLI command — outputs the numbered colored-emoji list per §11

**Tests:**
- `tests/test_recommender.py` — fixture profile + fixture grades produces deterministic top-15

**Done criteria:**
- `scout crawl` writes ≥ 500 tools
- `scout recommend` shows 15 picks; ≥ 3 are Hytale/HYDRA/Windows-related
- Commit: `feat(phase-05): full crawler + recommender`

### Phase 6 — Installer A/B/C + takedown (1 day)

**Goal:** Can install MCP servers, plugins, and skills. Round-trip install/uninstall preserves config.

**Reference:** `docs/01_SPEC.md` §23–24.

**Steps:**

1. `src/tool_scout/installer/detector.py` — picks A/B/C/D strategy
2. `installer/mcp.py`, `installer/plugin.py`, `installer/skill.py` — strategies A/B/C
3. `installer/audit.py` — JSONL audit log + `installs` table writes
4. **Skip Strategy D for now** — that's Phase 8
5. Config backup: copy `claude_desktop_config.json` and `~/.claude/mcp.json` to `~/.tool-scout/backups/configs/<timestamp>-<file>` before any mutation
6. Command allowlist: hardcode `pip`, `pipx`, `uv`, `npm`, `npx`, `git clone`, `mkdir`, `cp` only
7. Takedown CLI: `scout takedown <tool-id>` writes to `user_overrides.state='excluded_by_owner'`

**Tests:**
- `tests/test_installer_mcp.py` — install + uninstall round-trip on a test config
- `tests/test_takedown.py` — excluded_by_owner tools never appear in next export

**Done criteria:**
- `scout install <real-mcp-server-id>` works against a test config
- `scout uninstall <id>` reverses cleanly
- Commit: `feat(phase-06): installer + takedown`

### Phase 7 — Google Sheets sync (1 day) **← GATE POINT**

**Goal:** Monthly workbook exists with `DASHBOARD`, `ALL-TIME`, and today's daily tab. Letter cells are color-filled.

**Reference:** `docs/01_SPEC.md` §27–31.

**Steps:**

1. `src/tool_scout/sheets/client.py` — gspread service-account auth
2. `sheets/schema.py` — column definitions for each tab type
3. `sheets/sync.py` — month rollover, daily tab creation, ALL-TIME refresh, DASHBOARD computation
4. Cell coloring via `gspread-formatting` per §30
5. CLI: `scout sheets sync`, `scout sheets open`, `scout sheets status`

**Tests:**
- `tests/test_sheets.py` — mocked gspread; verify the right cells get the right colors

**Done criteria:**
- `scout sheets sync` creates current-month workbook in the configured Drive folder
- Open the workbook in browser → today's tab populated → S/A/B/C/D/F cells color-filled correctly
- **STOP HERE.** Tell Majied: "Phase 7 done. Sheets are visible at <URL>. Please review and approve before I continue to Phase 8."
- Commit: `feat(phase-07): sheets sync`

### Phase 8 — Wrapper gen + Docker sandbox + static scan (1.5 days)

**Goal:** Strategy D wrapper generation works against real tools, with the Docker sandbox catching unsafe code and the static scan rejecting malicious patterns.

**Reference:** `docs/01_SPEC.md` §25–26.

**Steps:**

1. `src/tool_scout/installer/static_scan.py` — exactly the patterns in §25
2. `src/tool_scout/installer/sandbox.py` — exactly the Docker invocation in §25 (full code given)
3. `src/tool_scout/installer/wrapper.py` — orchestrates: extract README → call Claude → static_scan → sandbox → publish-or-fail
4. Note: this is the *standalone* Strategy D from the v1.0 installer. The orchestrator-driven version in Phase 11 will reuse `static_scan.py` and `sandbox.py` but supersede `wrapper.py`'s flow.
5. Wrapper-gen prompt: use `config/prompts/wrapper_gen.md` for now (Phase 11 will move it into `WORKFLOW.md` body)

**Tests:**
- `tests/test_static_scan.py` — `known_good_wrapper.py` clean, `known_bad_wrapper.py` rejected with hits, `borderline_wrapper.py` clean (no scan triggers)
- `tests/test_sandbox.py` — known_good passes smoke, borderline fails (no `mcp`/`server` symbol)
- `tests/test_wrapper_gen.py` — full integration with mocked Claude returning known_good fixture

**Done criteria:**
- All three fixtures behave correctly through static_scan + sandbox
- A real install via Strategy D works (pick one CLI tool, generate wrapper, install)
- Commit: `feat(phase-08): wrapper gen + sandbox + static scan`

### Phase 9 — Vercel export + git_publisher + guardrail + repo files (1 day)

**Goal:** First successful `git push` to public repo triggers Vercel deploy.

**Reference:** `docs/01_SPEC.md` §10 (full git_publisher code), §33–34 (export logic), §43–50 (legal/repo files), §53 (guardrail).

**Steps:**

1. Drop in `git_publisher.py` exactly as written in §10
2. Write `src/tool_scout/export/vercel_export.py` — produces the four JSON files in `web/public/data/`, applying the visibility filter (§34)
3. Write `src/tool_scout/operations/guardrail.py` — implements the §53 check
4. Verify all repo-level files are in place from `starter-files/`: `LICENSE`, `README.md` (public), `SECURITY.md`, `CONTRIBUTING.md`, `.gitignore`, `.github/`
5. Verify all legal templates are in place: copy `templates/terms.md`, `privacy.md`, `policy.md` to `web/app/{terms,privacy,policy}/page.tsx` (Phase 10 will wrap them in proper Next.js pages)
6. CLI: `scout export`, `scout export --force`, `scout deploy`

**Tests:**
- `tests/test_git_publisher.py` — bot identity used; tokenized URL never persisted
- `tests/test_export.py` — visibility filter excludes private rows
- `tests/test_guardrail.py` — simulated bad crawl blocks publish

**Done criteria:**
- Manual `scout export` writes JSON, commits, pushes, Vercel rebuilds (verify in Vercel dashboard)
- `.gitignore` verified — `git status` after `scout doctor` regenerates the secret should NOT show `.env` as modified-and-tracked
- Commit: `feat(phase-09): vercel export + git publisher + guardrail`

### Phase 10 — Next.js web app + legal pages (2 days) **← GATE POINT**

**Goal:** `tool-scout.vercel.app` loads with a working catalog browse experience.

**Reference:** `docs/01_SPEC.md` §32–37. Use the `frontend-design` skill heavily here.

**Steps:**

1. `cd web && npm install` (uses the pre-baked `package.json`)
2. Build `web/app/layout.tsx` with the Footer linking Terms/Privacy/Policy
3. Build `web/app/page.tsx` (catalog browse) per §32
4. Build `web/app/tool/[id]/page.tsx` with the GradeRadar chart
5. Build `web/app/today/page.tsx`, `/about/page.tsx`
6. Build `web/app/{terms,privacy,policy}/page.tsx` from the templates in `templates/`
7. Build `web/components/{ToolCard,GradeBadge,GradeRadar,FilterBar,Footer}.tsx`
8. Build `web/lib/{data,grading,rate-limit,recaptcha}.ts`
9. Stub `web/app/api/request-wrapper/route.ts` and `/api/status/[job_id]/route.ts` (full implementation in Phase 11)
10. Push, verify Vercel deploy, fix any build issues

**Tests:**
- Manual: catalog renders, filters work, tool detail page renders, footer links work, mobile-responsive

**Done criteria:**
- Site live at `tool-scout.vercel.app`
- All grade colors match the rubric
- **STOP HERE.** Tell Majied: "Phase 10 done. Site is live at https://tool-scout.vercel.app. Please review and approve before I continue to Phase 11."
- Commit: `feat(phase-10): web app + legal pages`

### Phase 11 — Symphony orchestrator + queue (2.5 days) **← GATE POINT**

**Goal:** End-to-end wrapper request from web form → orchestrator → Claude Code → Docker → published wrapper file. Multi-turn continuation visible. Hot-reload of `WORKFLOW.md` works.

**Reference:** `docs/02_SPEC_v1.1_SYMPHONY.md` (entire file). Use the §16 sub-phases (11a–11j) as your sub-checklist.

**Steps (per v1.1 §16):**

- **11a.** ngrok setup + webhook receiver (FastAPI on port 8765, receives POSTs from Vercel)
- **11b.** Migration `0002_orchestrator.py` — already created in Phase 1; verify `OrchestratorEvent` model exists
- **11c.** `WorkflowConfig` (Pydantic, env-var resolution, validation), Liquid template engine, validate `starter-files/WORKFLOW.md`
- **11d.** `LocalTracker` adapter against `wrapper_requests` table
- **11e.** `WorkerRunner` (workspace prep → multi-turn loop → static_scan → sandbox → publish via git_publisher)
- **11f.** `SymphonyOrchestrator` (poll/dispatch/reconcile, retry queue with exponential backoff, hot-reload of WORKFLOW.md)
- **11g.** Events: JSONL log + DB writes + HTTP status surface on port 8766
- **11h.** TUI dashboard (`scout queue dashboard`)
- **11i.** Install as Windows Service via NSSM (`scripts/install_orchestrator_service.ps1`)
- **11j.** Run all 10 acceptance tests from v1.1 §15 (Definition of Done items 21–30)

**Critical:** Do NOT keep v1.0's `install_queue_worker_task.ps1`. The Service replaces it. Confirm the file has been removed from `scripts/` (it was never there in this bundle's starter-files).

**Tests (must all pass before declaring done):**
- v1.1 DoD #21: `WORKFLOW.md` validates
- v1.1 DoD #22: edit `tick_interval_ms`, see effect within one tick
- v1.1 DoD #23: service survives reboot
- v1.1 DoD #24: TUI dashboard renders live
- v1.1 DoD #25: smoke-fail then succeed scenario produces correct event sequence
- v1.1 DoD #26: static-scan-blocked jobs do NOT retry
- v1.1 DoD #27: stall test
- v1.1 DoD #28: external cancel test
- v1.1 DoD #29: startup recovery
- v1.1 DoD #30: bad WORKFLOW.md → keeps last good config

**Done criteria:**
- Real wrapper request from `tool-scout.vercel.app` completes in < 15 min
- Worker logs visible via `scout queue events <id>`
- **STOP HERE.** Tell Majied: "Phase 11 done. End-to-end wrapper flow is operational. Please verify by submitting a test request and approve before I continue to Phase 12."
- Commit: `feat(phase-11): symphony orchestrator + queue`

### Phase 12 — Backup + log rotation + status + polish (1 day)

**Goal:** All Definition of Done items pass. System is production-ready (for "production" = "Majied uses it daily").

**Reference:** `docs/01_SPEC.md` §51–55, §64.

**Steps:**

1. `src/tool_scout/operations/backup.py` per §51 (full code given)
2. `scout backup` and `scout restore <date>` CLI
3. Install daily backup task via `scripts/install_backup_task.ps1`
4. Log rotation per §52
5. `scout status` upgrade per §55 — show all surfaces
6. README polish in the public repo
7. Run full Definition of Done from `docs/01_SPEC.md` §64 (items 1–20) AND `docs/02_SPEC_v1.1_SYMPHONY.md` §15 (items 21–30)

**Done criteria:**
- All 30 DoD items pass
- Test restore from yesterday's backup on a throwaway DB succeeds
- `scout status` shows everything green
- Commit: `feat(phase-12): backup + status + polish`
- Final commit: `chore: v1.0 release` and tag `v1.0.0`

---

## 5. Working rules (from build prompt — restating because they matter)

1. **Phases are sequential.** Complete N before starting N+1.
2. **Gate points are hard stops.** Phase 7, 10, 11 — wait for Majied's "go".
3. **Commit after each phase.** Conventional-commits format. Push after every commit.
4. **Use spec code samples directly** when they're provided. Don't paraphrase.
5. **Tests required per phase.** A phase with failing tests is not complete.
6. **Pin exact versions** from `pyproject.toml` and `package.json`. Don't upgrade.
7. **Windows-first.** All paths, line endings, scripts target Windows 11.
8. **Safety rails are not optional.** §3 above + each phase's specific rails.
9. **Use available skills.** `mcp-builder`, `skill-creator`, `frontend-design`. If missing, stop and tell Majied.
10. **When uncertain, ask.** Quote the relevant spec section. Don't guess.
11. **No scope creep.** v1.1 candidates are deferred. Don't add them.
12. **Credential hygiene.** Tokens never in stdout/logs/commits. Use `git_publisher`'s URL-rewrite pattern only.

---

## 6. Subscription usage realism

Daily expected Claude Code calls:
- Classifier: ~150 calls (~7 batches × 20 records, mostly during 03:00 crawl)
- Wrapper-gen: 0–10 calls (varies with public demand)
- Total: ~160 calls/day average

Max subscription has soft 5-hour windows. The 03:00 crawl runs entirely inside one window when Majied is asleep, so doesn't conflict with daytime use. Wrapper-gen is paced by the global cap (10/day) and per-IP cap (3/24h).

If you (Claude Code) are currently *also* using Majied's subscription to build this, **be conscious**: you and the orchestrator will be sharing the same window during the build. If you hit limits while building, the message will be unmistakable. Pause, wait for the window to reset (5h), continue.

After launch, monitor with `scout usage`. If month one shows tool-scout consuming > 40% of windows during Majied's active hours, tune via `WORKFLOW.md`:
- `concurrency.max_concurrent_jobs: 2 → 1`
- `retries.max_attempts: 3 → 2`
- `agent.max_turns: 3 → 2`

These edits hot-reload — no rebuild.

---

## 7. Final acceptance — full Definition of Done

You must verify all 30 items pass before declaring v1.0 complete:

**v1.0 §64 items 1–20** (verbatim from `docs/01_SPEC.md`):
1. `scout doctor` green across all credentials
2. Four scheduled tasks/services running (crawl, orchestrator, backup, ngrok)
3. `scout crawl` completes 60–75 min, ≥ 500 tools, no API key, inside Max limits
4. All tools graded with letter + color
5. `scout recommend` outputs 15 picks; ≥ 3 match Hytale/HYDRA/Windows
6. Sheets workbook for current month exists; daily tab populated; cells color-filled
7. `tool-scout.vercel.app` loads; catalog renders; legal pages reachable from footer
8. End-to-end wrapper request < 15 min
9. Rate limits enforced (3/IP, 10/global, 1/tool per 24h)
10. Usage throttle blocks classify when 5h cap hit; resumes next run
11. Sandbox rejects malicious wrapper; accepts known-good
12. `scout uninstall` reverses native MCP install via backup
13. Public JSON excludes private + excluded_by_owner + muted
14. Stopping ngrok → web returns 503 with friendly message
15. `scout backup` produces valid file; restore succeeds
16. Takedown removes from public + prevents re-add
17. Guardrail blocks publish on simulated bad crawl
18. `.gitignore` verified — no secrets in git history
19. Alembic migrations clean from empty to head
20. Total monthly cost = $0

**v1.1 §15 items 21–30** (verbatim from `docs/02_SPEC_v1.1_SYMPHONY.md`):
21. `WORKFLOW.md` exists; validates with `scout workflow validate`
22. Editing `WORKFLOW.md` takes effect within one tick
23. Orchestrator service auto-starts on reboot
24. `scout queue dashboard` renders live
25. Smoke-fail-then-succeed scenario produces correct event sequence
26. Static-scan-blocked jobs do NOT retry
27. Stall detection works
28. External cancel works
29. Startup recovery from killed service works
30. Bad WORKFLOW.md → keeps last good, refuses new dispatches

When all 30 pass: tag `v1.0.0`, write a release note, hand back to Majied.

---

## 8. Things you might be tempted to do but should not

- **Re-implement what's in the docs.** The `claude_client.py`, `usage_tracker.py`, `git_publisher.py`, `sandbox.py`, `backup.py`, FastAPI receiver, and PowerShell scripts have full code in the docs and starter files. Use them.
- **Skip phases.** Tempting on Phase 4 (just rubric) or Phase 12 (just polish). Don't. Each builds on the prior.
- **Add features from v1.1 §66 (deferred candidates).** Email notifications, Hytale Discord crawler, etc. Out of scope.
- **Switch to Anthropic API direct.** No. The whole zero-cost design depends on Claude Code subprocess via Max subscription.
- **Use port-forwarding instead of ngrok.** ngrok with the static domain is what the starter files and pre-flight assume.
- **Add a database other than SQLite.** No reason to. Single user. WAL mode handles concurrency fine.
- **Symphony-ize the daily crawler.** Wrong fit. v1.1 §0 explains.
- **Run hooks via `bash -lc` on Windows.** They run via `cmd /c`. Document this in `WORKFLOW.md` comments.
- **Skip the gate points.** Phase 7, 10, 11 are wait-for-Majied. They exist because those surfaces involve taste, design, or significant architectural risk.

---

## 9. When you're done

Final handoff message to Majied:

> "Tool Scout v1.0 build complete. All 30 Definition of Done items verified. Service is operational at tool-scout.vercel.app. Daily crawl scheduled for 03:00. Orchestrator running as Windows Service. First crawl recommended for tonight; first wrapper-gen request can be tested anytime. See `scout status` for live state. Tag pushed: v1.0.0."

Then stop. The first 2 weeks of operation are tuning, which Majied owns — not your job to anticipate every tweak.

---

**End of BUILD_ME.md.** Read once before Phase 1; consult per-phase as needed.
