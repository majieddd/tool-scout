# Build Prompt — Paste This Into Claude Code

> This is the message you paste when you start the build. Fill in the CREDENTIALS section first.

---

## BEGIN PROMPT (copy everything below this line)

You are building the **Tool Scout** system from scratch per the two specification documents I'm attaching to this conversation. You will work phase-by-phase, committing after each phase, pausing at explicit gate points for my review.

### Attached authoritative documents

1. **TOOL_SCOUT_SPEC.md** — canonical technical specification (v1.0). Source of truth for architecture, data schemas, code samples, CLI surface, and build order.
2. **TOOL_SCOUT_SPEC_v1.1_SYMPHONY.md** — supplement that introduces a Symphony-pattern orchestrator for Phase 11 (the wrapper-generation queue). Replaces v1.0 §38–§42 only. All other v1.0 sections stand.
3. **TOOL_SCOUT_SETUP.md** — pre-flight checklist confirming what I have ready on my machine.

Read all three in full before writing any code. If anything in your training conflicts with the specs, the specs win. Where v1.0 and v1.1 disagree, v1.1 wins (but only for the sections it explicitly supersedes — everything else in v1.0 still applies).

### My environment and credentials

Platform: Windows 11, PowerShell 7, working directory `C:\Users\Majied\projects\tool-scout` (already cloned from the empty GitHub repo).

Paste these into `.env` during Phase 1 `scout doctor`:

```
GITHUB_TOKEN=[paste crawler PAT from Setup §2.1-A]
GIT_BOT_TOKEN=[paste bot PAT from Setup §2.1-B]
GIT_REPO_URL=[paste repo clone URL]
GIT_BOT_USERNAME=tool-scout-bot
GIT_BOT_EMAIL=bot@tool-scout.invalid

NGROK_AUTHTOKEN=[paste ngrok token]
NGROK_STATIC_DOMAIN=[paste ngrok domain]

GOOGLE_SERVICE_ACCOUNT_PATH=C:\Users\Majied\.tool-scout\gcp-credentials.json
GOOGLE_DRIVE_FOLDER_ID=[paste folder ID]

RECAPTCHA_SITE_KEY=[paste site key]
RECAPTCHA_SECRET_KEY=[paste secret key]

VERCEL_DEPLOY_HOOK_URL=[paste deploy hook URL]

WEBHOOK_SHARED_SECRET=
LOG_LEVEL=INFO
CLAUDE_BINARY_PATH=claude
MAX_CLAUDE_CALLS_PER_5H=40
MAX_CLAUDE_CALLS_PER_DAY=120
RATE_LIMIT_PER_IP_PER_DAY=3
RATE_LIMIT_GLOBAL_PER_DAY=10
```

`WEBHOOK_SHARED_SECRET` is intentionally blank — `scout doctor` will generate it.

### Working rules — non-negotiable

1. **Phases are sequential.** Complete Phase N before starting Phase N+1. No skipping ahead, no parallelizing across phases. If blocked mid-phase, document the blocker and stop.

2. **Gate points are hard stops.** After **Phase 7** (Sheets), **Phase 10** (web app live), and **Phase 11** (end-to-end wrapper request working), you stop and wait for my explicit "go" before continuing. At each gate, send a short summary: what was built, what tests passed, anything noteworthy.

3. **Commit after each phase.** Conventional-commits format:
   - `chore(phase-01): skeleton + db + scout doctor`
   - `feat(phase-02): github crawler + local projects`
   - `feat(phase-08): docker sandbox + static scan`
   Push to origin after each commit. This is how I see progress.

4. **Use the spec's code samples directly.** `claude_client.py`, `usage_tracker.py`, `git_publisher.py`, `sandbox.py`, `static_scan.py`, `backup.py`, the FastAPI webhook receiver, the three PowerShell scheduled-task scripts — all have complete implementations in the spec. Use them as-is unless you find a concrete bug, in which case explain the bug to me before changing.

5. **Tests required per phase.** Run `pytest` at the end of each phase. A phase with failing tests is not complete. Add tests as specified in §63 of the spec.

6. **Pin exact versions.** Use exactly the versions in `pyproject.toml` §4 and `package.json` §5. Do not upgrade unilaterally.

7. **Windows-first.** All paths, line endings, scheduled-task scripts, and tooling targets assume Windows 11. WSL is not required. Use `pwsh`, not `cmd`.

8. **Safety rails are not optional.** Before calling a phase done, verify the rails for that phase:
   - Phase 6: config backups before any mutation, command allowlist enforced
   - Phase 8: Docker `--network=none` sandbox, static_scan before sandwich, both must pass or wrapper rejected
   - Phase 9: `.gitignore` verified (never commits `.env`, `scout.db`, credentials)
   - Phase 10: Terms/Privacy/Policy pages present and linked in footer
   - Phase 11: **follow `TOOL_SCOUT_SPEC_v1.1_SYMPHONY.md` §16 sub-phases (11a–11j)**, not v1.0 §38–§42. Orchestrator service installs via NSSM. WORKFLOW.md hot-reload works. All Definition of Done items 21–30 from v1.1 §15 pass in addition to v1.0's items 1–20. Rate limits still enforced at receiver (3/IP, 10/global, 1/tool per 24h, reCAPTCHA threshold 0.5).
   - Phase 12: backup task scheduled and verified with a test restore

9. **Use available skills.** You should have these loaded:
   - `mcp-builder` — for Phase 8 wrapper generation (critical)
   - `skill-creator` — for Phase 3 classifier heuristics around SKILL.md detection
   - `frontend-design` — for Phase 10 web app
   If any are missing, stop and tell me — I'll install them before we continue.

10. **When uncertain, ask.** Do not silently make architectural decisions. If the spec is ambiguous, quote the relevant section and ask me before proceeding. Better to pause than build the wrong thing.

11. **No scope creep.** The v1.1 candidates in §66 (Ollama fallback, Hytale forum crawler, notifications, etc.) are explicitly deferred. If you think a v1.1 item is actually needed for v1, raise it with a specific justification — don't silently add it.

12. **Credential hygiene.** Never print tokens to stdout, never commit them, never include them in error messages. The git publisher's URL-rewrite pattern in §10 is the only acceptable way to authenticate git pushes.

### Your first response

Do NOT start coding yet. Instead:

1. Confirm you've read both attached documents fully
2. Confirm the three required skills (`mcp-builder`, `skill-creator`, `frontend-design`) are available
3. List the first three concrete actions you'll take in Phase 1, in the order you'll take them
4. Flag anything unclear in the spec — this is your one chance to ask before we commit to the build
5. Wait for my explicit "go" before touching the filesystem

### Rhythm going forward

- Start of each phase: state the phase number, your plan, estimated time
- Mid-phase: if you hit something unexpected, pause and ask
- End of each phase: run tests, commit + push, summarize what changed, move to next phase (or stop at a gate point)
- If a command fails: paste the error, diagnose, try once more with a fix, or ask me if still stuck
- If the DB schema changes mid-build: generate a new Alembic migration, don't edit 0001

### Success condition

All 20 items in v1.0 §64 (Definition of Done) AND all 10 items in v1.1 §15 (additions) pass. `scout doctor` green. The orchestrator service is running. Daily crawl + backup remain on Task Scheduler. `tool-scout.vercel.app` is live. I can run `scout recommend` and see graded picks. An end-to-end wrapper request from the web app completes in under 15 minutes with multi-turn continuation visible in `scout queue events <id>`. `WORKFLOW.md` edits take effect within one tick. Monthly cost = $0.

---

**Begin with your first response per the template above. I'm ready.**

## END PROMPT (stop copying here)
