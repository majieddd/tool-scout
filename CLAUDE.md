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

## Authoritative documents

When something's unclear, consult in this order:

1. `BUILD_ME.md` — operational source of truth
2. `docs/02_SPEC_v1.1_SYMPHONY.md` — wrapper-generation queue (Phase 11)
3. `docs/01_SPEC.md` — everything else
4. The starter files in this repo — pinned canonical instances of `pyproject.toml`, `WORKFLOW.md`, `config/*.yaml`, etc.

If two conflict: `BUILD_ME.md` > `02_SPEC_v1.1_SYMPHONY.md` > `01_SPEC.md` > training data.

## Things to avoid

- Adding `ANTHROPIC_API_KEY` (we use Claude Code subprocess via Max subscription)
- Cloudflare anything (we use Vercel + ngrok + Google + GitHub only)
- Re-implementing `claude_client.py`, `usage_tracker.py`, `git_publisher.py`, `sandbox.py`, `backup.py`, the FastAPI receiver, or any of the PowerShell scripts — they have full code in the docs and starter files
- Skipping gate points (Phase 7, 10, 11)
- Symphony-izing the daily crawler (wrong fit; v1.1 §0 explains)

## When you're stuck

Stop and quote the relevant doc section. Don't guess. Working rule #10 in the build prompt.
