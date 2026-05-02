# Claude Code Setup — Updated for May 2026 Plugin Ecosystem

> Replaces the older `04_CLAUDE_CODE_SETUP.md`. Reflects the actual state of Claude Code's plugin/marketplace ecosystem as of May 2026, which has evolved substantially since the bundle was first written.

---

## What changed since the original

- **Plugin marketplaces now exist as a first-class feature.** Install with `/plugin marketplace add <repo>` then `/plugin install <name>@<marketplace>`.
- **Anthropic's official marketplace** ships the foundational skills (mcp-builder, skill-creator, frontend-design, etc.).
- **Superpowers** (`obra/superpowers`) was accepted into the official Anthropic marketplace in January 2026 and is now widely considered the default discipline framework for serious Claude Code projects. ~150K+ stars at time of writing.
- **The `frontend-design` plugin** matured — better than the SKILL.md-only version that existed earlier.
- **Spec-driven workflow plugins** (Pimzino's spec-workflow, claude-code-workflows) bridge the gap between a raw spec doc and Claude Code's execution.

For a 13-day, multi-phase, spec-heavy build like Tool Scout, **Superpowers is genuinely the highest-leverage install**. Everything else is optional.

---

## Required installs (do these before Phase 1)

### 1. Superpowers — the engineering discipline framework

This is the single most useful install for this project. It enforces a mandatory workflow: brainstorm → write a plan → use git worktrees → TDD with red/green/refactor → subagent-driven implementation → code review → finish branch. Without it, Claude Code tends to skip tests and over-batch changes.

```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
/quit
```

Restart Claude Code (`claude` again). Verify: ask "help me plan a feature" — it should ask clarifying questions instead of writing code immediately. If it dives into code, the bootstrap didn't load. Run `/plugin list` to confirm.

**Why this matters for Tool Scout specifically:**
- Phase 11 (Symphony orchestrator) is async, multi-file, async/await-heavy — exactly where Superpowers' subagent isolation prevents cross-task context pollution
- The bundle's spec is detailed enough that Superpowers' brainstorm phase can mostly be skipped per-phase ("we already have the design — go to plan-writing")
- Mandatory TDD aligns with the spec's "tests required per phase" rule
- The subagent two-stage review catches the kinds of regressions that would otherwise slip through over a 13-day build

**One caveat:** Superpowers' brainstorm phase is interactive. For Tool Scout you're handing it a fully-designed spec, so when starting each phase tell Claude something like:

> "Skip brainstorming — the design is in `BUILD_ME.md` and `docs/01_SPEC.md` for Phase N. Go straight to writing-plans for Phase N's sub-steps."

This skips the redundant design-from-scratch step but keeps the TDD + subagent + code-review parts.

### 2. Anthropic's official skills marketplace

```
/plugin marketplace add anthropics/skills
/plugin install mcp-builder@anthropic-skills
/plugin install skill-creator@anthropic-skills
/plugin install frontend-design@anthropic-skills
```

- **`mcp-builder`** — essential for Phase 8 wrapper generation. Encodes canonical MCP server patterns. Without it, generated wrappers fail Docker sandbox at higher rates.
- **`skill-creator`** — Phase 3 classifier needs to recognize valid SKILL.md files. Having the canonical reference loaded prevents the classifier from misidentifying skills as generic tools.
- **`frontend-design`** — essential for Phase 10. Tailwind patterns, design tokens, accessibility defaults. The difference between a Vercel-deployed site that looks generic and one that looks designed.

### 3. GitHub MCP server (also from Anthropic)

```
/plugin install github-mcp-server@anthropic-skills
```

Or add to your MCP config manually if you prefer. Useful at Phase 1 (verify PATs work), Phase 9 (set up issue templates and dependabot from inside Claude Code), Phase 11 (security advisory configuration).

---

## Recommended (high value, but not blocking)

### 4. Spec-workflow plugin (Pimzino)

If you find Superpowers' brainstorm-first phase friction annoying when you already have a spec, this is the spec-driven alternative. Phases are: Requirements → Design → Tasks → Implementation, with each phase producing a written artifact.

```
/plugin marketplace add Pimzino/claude-code-spec-workflow
/plugin install spec-workflow@pimzino
```

I'd pick **either** Superpowers **or** spec-workflow, not both. Superpowers wins for this project because Tool Scout's TDD requirements are a better fit for its mandatory test-first design.

### 5. Filesystem MCP server (scoped to project)

Cleaner than raw shell for path-heavy work on Windows.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem",
               "C:\\Users\\Majied\\projects\\tool-scout"]
    }
  }
}
```

Add to `%APPDATA%\Claude\claude_desktop_config.json` and `~/.claude/mcp.json`.

### 6. SQLite MCP server (after Phase 1)

After Phase 1 creates `~/.tool-scout/scout.db`, this lets Claude Code query the DB directly during development instead of running `scout` subcommands.

```json
{
  "sqlite-tool-scout": {
    "command": "uvx",
    "args": ["mcp-server-sqlite", "--db-path",
             "C:\\Users\\Majied\\.tool-scout\\scout.db"]
  }
}
```

---

## Optional (use only if you've used them before)

- **gstack** (Garry Tan's role-based framework) — adds adversarial review, security audit, design critique as separate "team members." Excellent for novel projects, overkill here since the spec already encodes those concerns.
- **claude-code-workflows** (`shinpr/claude-code-workflows`) — alternative TDD/workflow plugin. Skip if you have Superpowers.
- **Python backend plugins** (`ruslan-korneev/claude-plugins`) — provides `/lint:check`, `/test:first`, `/fastapi:module` commands. Useful but doesn't change outcomes meaningfully.

**Don't install everything.** Each plugin adds tokens to the baseline context. Three good ones beat twenty fighting for attention. The four required + one recommended (Superpowers, mcp-builder, skill-creator, frontend-design, GitHub MCP) is the right set for this build.

---

## Skills already provided in Tool Scout's bundle

Reminder: the bundle ships its own `CLAUDE.md` and `WORKFLOW.md` that Claude Code reads automatically. The plugins above complement these, not replace them.

Specifically:

- `starter-files/CLAUDE.md` → session conventions (commit format, working dir, doc precedence). Read every session.
- `starter-files/WORKFLOW.md` → Symphony orchestrator policy. Hot-reloaded by the running orchestrator at Phase 11; not by Claude Code itself.

If you install Superpowers, its bootstrap will run alongside Tool Scout's `CLAUDE.md`. They don't conflict — Superpowers' rules apply to *how* Claude codes; `CLAUDE.md` defines *what* Claude is building.

---

## Pre-flight verification (after plugin installs)

Run inside Claude Code:

```
/plugin list
```

You should see at least:
- `superpowers@superpowers-marketplace`
- `mcp-builder@anthropic-skills`
- `skill-creator@anthropic-skills`
- `frontend-design@anthropic-skills`
- (optionally) `github-mcp-server@anthropic-skills`

Then exit (`/quit`) and verify outside:

```powershell
# All should print versions
python --version            # 3.11+
node --version              # 20+
pwsh --version              # 7.4+
git --version               # 2.40+
claude --version            # latest
docker run --rm hello-world # prints success
ngrok version               # 3.x
nssm version                # 2.24+

# Project folder exists with starter files
Test-Path C:\Users\Majied\projects\tool-scout\pyproject.toml      # True
Test-Path C:\Users\Majied\projects\tool-scout\WORKFLOW.md         # True
Test-Path C:\Users\Majied\projects\tool-scout\.env                # True (Majied filled it)
```

---

## Working directory

Open Claude Code in your project folder:

```powershell
cd C:\Users\Majied\projects\tool-scout
claude
```

Claude Code automatically reads `CLAUDE.md` from the working directory. The bundle's `CLAUDE.md` already encodes the build conventions; Superpowers' bootstrap loads on top of it.

---

## When you're ready to build

1. Inside Claude Code, attach the four required documents:
   - `BUILD_ME.md`
   - `docs/01_SPEC.md`
   - `docs/02_SPEC_v1.1_SYMPHONY.md`
   - `docs/03_PREFLIGHT_SETUP.md`
2. Paste the contents of `docs/05_BUILD_PROMPT.md` (with credentials filled in) as your first message
3. Claude Code (with Superpowers active) will run the brainstorm phase. Tell it: "Skip brainstorming — design is fully specified in BUILD_ME.md. Begin Phase 1's writing-plans step now."
4. Approve the plan, then say "go"

Superpowers will then run TDD-driven subagent dispatch through each phase. You stop at gate points (Phases 7, 10, 11) per the build prompt.

---

## The realistic time impact

Superpowers' TDD + subagent flow makes individual phases ~20% slower than raw "write the code" mode. That's a feature, not a bug — the cost is upfront, the benefit is fewer regressions and clearer commits. Net: instead of 13 days of work with 2–3 days of mid-build fixes, expect 14–15 days of slightly slower work with very few rework loops.

If you're truly time-constrained, you can run Phase 1 (skeleton) and Phase 2 (crawler) without Superpowers and turn it on starting at Phase 3. Don't skip Superpowers for Phase 8 (wrapper sandbox) or Phase 11 (orchestrator) — those are exactly the phases where TDD discipline matters most.

---

## When something goes wrong

- **Superpowers won't activate after install:** restart Claude Code (`/quit` then `claude` fresh). Session-start hook only fires on a new session.
- **Superpowers' brainstorm is repetitive:** tell Claude "the design is already finalized in BUILD_ME.md §X — skip brainstorm, go to writing-plans."
- **A plugin is generating spurious context:** `/plugin disable <name>` for that session.
- **TDD red phase generates tests for the wrong thing:** Superpowers respects natural-language steering. Tell it explicitly what to test.
- **Confused about which doc has the answer:** the precedence in `CLAUDE.md` and `BUILD_ME.md` §1 is the tiebreaker.

---

**End of setup.** Once these plugins are installed and the pre-flight checks pass, hand off the build prompt.
