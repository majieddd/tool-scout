# CLAUDE.md — Session instructions for Claude Code

This file is read at the start of every Claude Code session in this repository. Keep it short and operational.

## Conventions

- **Always commit and push after each phase.** Use conventional-commits format with phase scope:
  - `feat(phase-08): docker sandbox + static scan`
  - `fix(crawler): handle 429 from npm registry`
  - `chore: update deps`
- **Run tests before declaring a phase done.** `pytest` for Python, `npm run build` for the web app.
- **Pin versions.** Don't upgrade `pyproject.toml` or `web/package.json` unilaterally.

## Working directory

- Repo root: this directory
- Local data lives outside the repo at `~/.tool-scout/` (never committed)
- See `.gitignore` for the full exclusion list

## Automated crawler (DO NOT touch — runs in GitHub Actions)

The catalog data files (`web/public/data/*.json`) are maintained automatically by **two GitHub Actions workflows** that push commits directly to `origin/main` throughout the day. **The user wants this kept fully automatic — do not propose disabling either workflow.**

| Workflow | Cron | What it does | Commit message |
|---|---|---|---|
| `.github/workflows/fast-poll.yml` | `12 * * * *` (every hour at :12) | Crawls fast-tier sources only (GitHub trending, MCP registries, HN, Reddit, Anthropic blog) — `scout crawl --quick --tier fast` | `chore(data): hourly fast-poll <ISO timestamp>` |
| `.github/workflows/daily-crawl.yml` | `0 3 * * *` (daily 03:00 UTC) | Full crawl across heavy sources too (npm, PyPI, awesome-lists) — `scout crawl --quick` | `chore(data): nightly crawl <YYYY-MM-DD>` |

Both run heuristics-only in CI (no Ollama — classifier defers, doesn't block). Both share a `crawl` concurrency group so they can't collide. Both write to `web/public/data/*.json`: `tools.json`, `meta.json`, `recommendations.json`, `grades_index.json`. The deploy-pages workflow rebuilds the live site from main.

**Net effect: origin/main typically advances by 3–30 commits per day.** Local clones go stale fast.

### The "must git pull first" rule

Before ANY of these actions in this repo, run `git pull --ff-only origin main`:

- `npm run build` (in `web/`) — building from stale data ships a stale site
- creating a commit — risks merging onto an old base and creating a fork
- trusting `meta.json` fields (especially `live_tools` count) — they change every hour
- diagnosing a "missing tools" or "count mismatch" complaint — first hypothesis is always "local is behind"

A SessionStart hook at `.claude/hooks/check-git-staleness.ps1` auto-checks this at session start and prints the commits-behind count via `systemMessage` + `additionalContext`. If you don't see a warning, you're up to date.

## Authoritative documents

When something's unclear, consult in this order:

1. `BUILD_ME.md` — operational source of truth
2. `docs/02_SPEC_v1.1_SYMPHONY.md` — wrapper-generation queue (Phase 11)
3. `docs/01_SPEC.md` — everything else
4. The starter files in this repo — pinned canonical instances of `pyproject.toml`, `WORKFLOW.md`, `config/*.yaml`, etc.

If two conflict: `BUILD_ME.md` > `02_SPEC_v1.1_SYMPHONY.md` > `01_SPEC.md` > training data.

## LLM backend (deviation from spec)

This repo runs **local Gemma via Ollama** (`gemma3:4b` at `http://localhost:11434`) instead of the Claude Code CLI subprocess described in `01_SPEC.md` §8. The `claude_client.py` module from the spec is replaced by `src/tool_scout/llm_client.py`. The `usage_tracker.py` keeps the `usage_log` table for diagnostics but drops the `can_call()` rate-limit gating (no API limits on local). Spec working-rule #14 was overridden by the user on 2026-05-02. See `~/.claude/projects/.../memory/project_llm_backend.md`.

## Things to avoid

- Adding `ANTHROPIC_API_KEY` or any cloud-LLM provider (we use local Gemma via Ollama)
- Cloudflare anything (we use Vercel + ngrok + Google + GitHub only)
- Re-implementing `git_publisher.py`, `sandbox.py`, `backup.py`, the FastAPI receiver, or any of the PowerShell scripts — they have full code in the docs and starter files
- `claude_client.py` and `usage_tracker.py` per the spec — replaced by `llm_client.py` (Gemma) and a slimmed `usage_tracker.py` (logging only)
- Skipping gate points (Phase 7, 10, 11)
- Symphony-izing the daily crawler (wrong fit; v1.1 §0 explains)
- Hooks via `cmd /c` or `bash -lc` — Windows-only, run hooks via `pwsh -NoProfile -Command`

## When you're stuck

Stop and quote the relevant doc section. Don't guess. Working rule #10 in the build prompt.
