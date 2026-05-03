# Audit synthesis — 10-scenario architect review (2026-05-03)

10 parallel reviewers each audited one scenario against the real catalog (4,381 tools).
Findings collapsed into 12 root-cause themes, ordered by fix priority.

## Theme 1 — Profile extraction is too narrow [CRITICAL, multi-scenario]

**Symptoms:**
- `Next.js` doesn't match the `nextjs?` regex (sc 02). Same risk: Node.js, D3.js.
- `Go` not detected — pattern requires `golang` / `go module` (sc 04). Bare "Go gRPC microservice" misses.
- `Solidity` not in LANGUAGE_PATTERNS (sc 10). Likewise: vyper, move, cairo, scala, dart, lua, zig, nim.
- `Django` doesn't infer Python (sc 07). No framework→language inference at all.
- `React Native` doesn't infer TypeScript (sc 08).
- No FRAMEWORK_PATTERNS array — `frameworks` permanently empty for paste-mode prompts (sc 02, 07, 08, 10).
- `hasTests` regex `\btest(s|ing|[\s-]driven)\b` doesn't match "test coverage" (sc 07).
- Goal taxonomy gaps: "wraps the ripgrep CLI" → general (sc 03), "Cursor extension" → general (sc 02).
- Domain misses: "project-wide search" (no qualifier), "filesystem" (no verb), no `blockchain`/`web3`/`smart-contracts` (sc 10), no `mobile` (sc 08), no `accessibility`/`crash-reporting` (sc 08).
- `testing` false-positive triggered by Playwright (sc 05) — Playwright is dual-use.
- Platform: target vs host conflated (sc 08) — macOS host + iOS target collapses to one.

**Fix:**
- Add FRAMEWORK_PATTERNS with framework→language inference (Django→Python, RN/Next→TS, Hardhat→Solidity, etc.)
- Fix Next.js regex: `nextjs?` → `next\.?js`
- Add language patterns: solidity, vyper, scala, dart, lua, etc.
- Loosen Go regex to match bare "Go" with disambiguation context
- Loosen `hasTests` regex
- Add `wrap_cli`, `build_extension`, `data_pipeline` goal patterns
- Add `blockchain`, `mobile`, `accessibility`, `crash-reporting` domains
- Move Playwright out of `testing` domain (already in `browser-automation`)
- Add `target` field separate from `platform` (mobile/web/desktop/server)

## Theme 2 — `nameHas` is unsafe substring matching [CRITICAL, multi-scenario]

**Symptoms:**
- `iam` matched `iamzhihuix/skills-manage` → Skills Manager landed in **auth** lane (sc 10)
- `test` matched `Korext/ai-attestation` → off-topic plugin slipped through `isRealPlugin` (sc 02)
- `mcp-cli` matched `mcp-client-for-ollama` → MCP client picked as SDK (sc 06)
- `review` would match `reviewer/preview/unreviewed`. `auth` would match `author/unauthorized`.

**Fix:** Replace `nameHas` substring with word-boundary regex or token-split equality.

## Theme 3 — Layer applicability is goal-blind [CRITICAL, sc 06, 09]

**Symptoms:**
- `goal=build_skill` (skill author) still gets MCP SDK + FS server + code-exec picks (sc 06)
- Vague prompt (everything unknown) still picks fastmcp + Python FS tool (sc 09)
- `context-fs.applies()` includes `goal === "general"` — but "general" is "no goal detected", not "any goal"
- `sdk-runtime.applies = () => true` — fires even when no project signal exists

**Fix:**
- Add `GOAL_LAYER_ALLOWLIST: Record<Goal, Set<LayerId>>` — gate every layer through it
- `build_skill` ⊂ {method-skill, agent-plugin, skill-reference}
- Drop `"general"` from `context-fs.applies()` goal allow-list
- Add "underspecified prompt" early return in `composeStack`: when all signals empty, return empty stack with `prompt_too_vague: true`

## Theme 4 — Language penalty insufficient against catalog skew [CRITICAL, sc 03, 04, 08, 10]

**Symptoms:**
- `-2.5` penalty fails to demote A-grade Python tools below `MIN_PRIMARY_SCORE=1.5` floor
- Niche-lang projects (Rust/Go/Solidity/RN) silently get Python tools as primary
- `language: null` tools dodge the penalty entirely (sc 03) — awesome-list stubs become cross-language
- `sdk-runtime` candidate fallback `return true` for non-Python/JS/TS langs (sc 03, 04, 09, 10)

**Fix:**
- For SDK lane on niche-lang projects: hard-skip when no in-language candidate (return -Infinity, layer skip)
- Treat `language: null` as foreign for niche-lang projects
- Default-deny in `sdk-runtime.candidate` when language is unknown to the gate

## Theme 5 — Specific-target signals not generalized [CRITICAL/MAJOR, sc 04, 05, 02]

**Symptoms:**
- DB-name boost exists (postgres/mysql/sqlite/mongo/redis/supabase/duckdb)
- BUT no equivalent for: framework names (playwright, puppeteer), observability vendors (datadog, grafana, prometheus, sentry), canonical SDKs
- Result: "Playwright" prompt gets ChromeDevTools-MCP (sc 05). "Datadog" prompt gets Prometheus (sc 04). TS prompt gets webmcp-ts-sdk over `@modelcontextprotocol/sdk` (sc 02, 05).

**Fix:**
- Generalize the DB-name boost into a `specificNameBoost` table covering frameworks, observability vendors, canonical SDKs
- `[fw, vendor, sdk-name] in description AND in tool name → +2.5`

## Theme 6 — Predicates accept feature-mention as purpose [MAJOR, sc 04]

**Symptoms:**
- `LibreChat` (chat clone) matches code-exec via `\binterpreter\b` keyword in description
- `getsentry/XcodeBuildMCP` (iOS build tool) matches observability via "Sentry" org name

**Fix:**
- code-exec: require purpose self-description (e.g., "a code interpreter for X"), not feature-list mention. Exclude chat-clones explicitly.
- observability: require purpose word (logs/metrics/traces) in description, not just org name

## Theme 7 — Cross-agent compatibility too tight [MAJOR, sc 02, 05, 07]

**Symptoms:**
- Cursor users can't see Claude-flavored skills despite using them via `.cursorrules` daily
- Cline plugin lane empty because `compatibleWithAgent` requires literal `cline` tag
- Aider drops 248 mcp_servers without literal `mcp` tag

**Fix:**
- For non-Claude agents: also accept `category in {skill, claude_plugin}` AND `compatibility=native_claude_code`
- Don't gate on requiring agent-specific tag when tool is cross-agent by nature

## Theme 8 — Mobile target unsupported [MAJOR, sc 08]

**Symptoms:**
- Mobile RN project gets Python MCP SDK + Python FS server (useless)
- Catalog has 22+ mobile-relevant tools (XcodeBuildMCP, ios-skills, etc.) — no surfacing path

**Fix (deferred — needs design):**
- Add `target: "mobile" | "web" | "desktop" | "server"` field
- New layer `mobile-tooling` for mobile target
- Skip server-side layers (sdk-runtime, context-fs, code-exec) when target=mobile

## Theme 9 — Method-skill predicate TDD-centric [MAJOR, sc 06, 10]

**Symptoms:**
- "code review" prompt gets tdd-guard as primary, codex-review-skill as alt (sc 06)
- TDD-intent boost (+3) exists, no code-review-intent boost
- Solidity audit/formal-verification skills don't surface (sc 10)

**Fix:**
- Add `projectWantsReview` boost paralleling `projectWantsTdd`
- Broaden method-skill candidate to recognize audit/verify/formal/security keywords
- For Solidity projects: surface security-audit skills

## Theme 10 — Plugin language penalty inappropriate [MAJOR, sc 01]

**Symptoms:**
- `nizos/tdd-guard` (TS) gets -2.5 for being TS in Python project — but plugins are agent-side
- Non-Python plugins systematically under-rank for Python projects
- claude-devtools (TS) loses to Pith despite being more relevant

**Fix:** Skip language penalty when `t.category === "claude_plugin"`.

## Theme 11 — `skill-reference` layer missing [MAJOR, sc 06]

**Symptoms:**
- `goal=build_skill` has no place to surface skill-creator/skill-template/example-skill helpers
- Catalog has authoring helpers but they fall through every layer

**Fix:** Add new `skill-reference` layer that fires only on `goal=build_skill`.

## Theme 12 — PyPI/npm packages under-rank because stars=0 [MAJOR, sc 01]

**Symptoms:**
- `mcp-server-git` (PyPI canonical) loses to `Gitingest-MCP` because stars=0
- Similar for npm packages (no GitHub stars)

**Fix:** When `t.source === "pypi"` or `"npm"` and grade is high, treat stars differently.

---

## Execution plan (this loop)

Fixing in order — each fix gets a vitest invariant before moving on:

1. **architect.ts** — FRAMEWORK_PATTERNS, framework→language inference, fixed Next.js regex, broader Go regex, Solidity, hasTests, blockchain/mobile/crash-reporting domains, wrap_cli/build_extension/data_pipeline goals
2. **stack-builder.ts** — word-boundary `nameHas`, GOAL_LAYER_ALLOWLIST, drop "general" from context-fs, underspecified early-return
3. **stack-builder.ts** — niche-lang hard-skip, default-deny SDK fallback, null-language treated as foreign for niche
4. **stack-builder.ts** — `specificNameBoost` table (frameworks + vendors + SDKs)
5. **stack-builder.ts** — code-exec purpose tightening, observability purpose tightening
6. **stack-builder.ts** — cross-agent compatibleWithAgent loosening
7. **stack-builder.ts** — code-review boost, plugin lang penalty skip

Themes 8 (mobile target), 11 (skill-reference layer), 12 (PyPI star handling) deferred to next iteration — each needs more design work and the immediate value is in fixing what we have.
