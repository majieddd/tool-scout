/**
 * Stack-builder — composes a curated, project-specific stack from the catalog.
 *
 * Design notes (post-audit, 2026-05-03):
 *
 * The first generation of this module produced too many false positives —
 * loose substring matches, no language penalty, no quality threshold, no
 * non-English filter. A real prompt ("Python MCP server for Postgres on
 * Windows, TDD") surfaced a XiaoHongShu scraper, a TypeScript SDK, and
 * an agent harness in a plugin slot. This rewrite addresses each:
 *
 *   1. Language penalty: tools whose declared language conflicts with the
 *      project's primary language lose 2.5 points (JS↔TS still compatible).
 *   2. Non-English filter: tools whose name+description are >35% CJK or
 *      Cyrillic are dropped. They may be great but the matcher can't read
 *      them, so it can't fairly compare relevance.
 *   3. Per-layer quality floor: a primary pick must score ≥ MIN_PRIMARY_SCORE.
 *      Layers with no candidate above the floor are skipped instead of
 *      filled with a weak match.
 *   4. Tighter layer predicates: each lane checks for layer-specific keywords
 *      in name OR tags first, then falls back to description. Plain
 *      substring-anywhere matching was the worst offender.
 *   5. Specific-target preference: when the description names a database
 *      (postgres, mysql, ...) or a target agent's primitive (slash command,
 *      hook), tools that mention that specific name in their *name* get a
 *      large bonus over generic tools.
 */
import type { Tool } from "./data";
import type { ExtendedProfile, AgentTarget, GoalType, ProjectArchetype } from "./architect";

export type ComposedPick = {
  tool: Tool;
  reason: string;
  layerId: string;
  score: number;
};

export type ComposedLayer = {
  id: string;
  name: string;
  description: string;
  primary: ComposedPick[];
  alternatives: ComposedPick[];
};

export type ComposedStack = {
  layers: ComposedLayer[];
  totalPrimaryCount: number;
  skipped: string[];
  generatedAt: string;
  /** Detected project archetype (when the prompt was goal-oriented). The UI
   *  should render this above the stack as a "your project breakdown" view. */
  archetype?: ProjectArchetype | null;
};

const MAX_PICKS = 15;
const MIN_PRIMARY_SCORE = 1.5;
const MIN_ALT_SCORE = 0.8;

/**
 * Goal-driven layer allow-list.
 *
 * Previously, layers decided their own applicability via `applies()` — but
 * the architect was goal-blind: a `goal=build_skill` (skill author writing
 * markdown) would still get an MCP SDK pick and a filesystem-server pick.
 *
 * This map gates layer applicability up front. Each goal whitelists the
 * layers that make sense; everything else is skipped with a clear reason.
 *
 * Special sentinel `__ALL__` means "no goal-level restriction".
 * `general` (catch-all when no goal regex matched) inherits __ALL__.
 */
const GOAL_LAYER_ALLOWLIST: Partial<Record<GoalType, Set<string> | "__ALL__">> = {
  build_mcp_server: "__ALL__",
  build_plugin:    new Set(["sdk-runtime", "context-fs", "context-git", "method-skill", "domain-skill", "agent-plugin"]),
  build_extension: new Set(["sdk-runtime", "context-fs", "method-skill", "domain-skill", "agent-plugin"]),
  build_skill:     new Set(["method-skill", "agent-plugin"]),
  build_harness:   new Set(["sdk-runtime", "memory-retrieval", "code-exec", "method-skill", "agent-plugin"]),
  wrap_cli:        new Set(["sdk-runtime", "method-skill", "agent-plugin"]),
  data_pipeline:   new Set(["sdk-runtime", "data-storage", "auth", "web-api", "code-exec", "observability", "method-skill", "agent-plugin"]),
  web_app:         new Set(["data-storage", "auth", "web-api", "observability", "method-skill", "domain-skill", "agent-plugin"]),
  // cli_tool: broadened from {sdk, method, domain, plugin} to include the
  // infra-adjacent layers — db-tooling/infra-ops/api-tooling all set
  // goal=cli_tool but legitimately need data-storage, observability,
  // code-exec, web-api candidates so the lane composes more than just an SDK.
  cli_tool:        new Set(["sdk-runtime", "context-fs", "context-git", "data-storage", "code-exec", "web-api", "observability", "method-skill", "domain-skill", "agent-plugin"]),
  library:         new Set(["sdk-runtime", "method-skill", "domain-skill"]),
  research:        "__ALL__",
  automation:      "__ALL__",
  general:         "__ALL__",
};

/**
 * Niche languages — those where the catalog has very few in-language tools.
 * For these, the SDK lane should hard-skip rather than silently pick a
 * Python/TS tool because the -2.5 language penalty isn't enough to demote
 * an A-grade Python tool below the score floor.
 */
const NICHE_LANGUAGES = new Set([
  "rust", "go", "swift", "kotlin", "csharp", "cpp", "ruby", "scala",
  "haskell", "ocaml", "elixir", "erlang", "clojure", "dart", "lua", "zig",
  "nim", "solidity", "vyper", "move",
]);

// ---- helpers ---------------------------------------------------------------

function blob(t: Tool): string {
  return ((t.name || "") + " " + (t.description || "") + " " + (t.tags || []).join(" ")).toLowerCase();
}

function nameAndDesc(t: Tool): string {
  return ((t.name || "") + " " + (t.description || "")).toLowerCase();
}

function nameOnly(t: Tool): string {
  return (t.name || "").toLowerCase();
}

function hasAny(t: Tool, needles: string[]): boolean {
  const h = blob(t);
  return needles.some((n) => h.includes(n.toLowerCase()));
}

/**
 * Word-boundary aware name matching.
 *
 * The previous version did raw substring includes() — which let "iam" match
 * "iamzhihuix/skills-manage" (slipping a Skills Manager into the auth lane),
 * "test" match "ai-attestation" (slipping an attestation tool into the
 * code-review plugin lane), and "mcp-cli" match "mcp-client-for-ollama"
 * (picking an MCP client as an SDK).
 *
 * Now we tokenize BOTH the name and the needle on common separators
 * (/, -, _, @, :, ., space) and check the needle's token sequence appears
 * as a contiguous subsequence in the name's tokens.
 *
 * Examples:
 *   nameHas({name:"PrefectHQ/fastmcp"}, "fastmcp")         → true
 *   nameHas({name:"iamzhihuix/skills-manage"}, "iam")      → false (was true)
 *   nameHas({name:"Korext/ai-attestation"}, "test")        → false (was true)
 *   nameHas({name:"mcp-client-for-ollama"}, "mcp-cli")     → false (was true)
 *   nameHas({name:"mcp-server-cli"}, "mcp-cli")            → false (good — different intent)
 *   nameHas({name:"@modelcontextprotocol/sdk"}, "/sdk")    → true (legacy form)
 *   nameHas({name:"@modelcontextprotocol/sdk"}, "sdk")     → true
 *   nameHas({name:"row-level-security"}, "row-level")      → true
 *
 * Wildcard support:
 *   "*sdk"   → any token ending in "sdk"   (matches "fastsdk", "tssdk")
 *   "mcp-*"  → any token starting with "mcp-" — but since splitting drops the
 *              dash, this becomes equivalent to "any token starting with mcp"
 */
const NAME_SEP = /[\s/_\-@:.]+/;

function tokenizeName(s: string): string[] {
  return s.toLowerCase().split(NAME_SEP).filter(Boolean);
}

function nameHas(t: Tool, ...needles: string[]): boolean {
  const tokens = tokenizeName(t.name || "");
  for (const raw of needles) {
    const needle = raw.toLowerCase();
    // Wildcard suffix: "*sdk" → any token ending in "sdk"
    if (needle.startsWith("*") && needle.length > 1) {
      const suf = needle.slice(1);
      if (tokens.some((tok) => tok.endsWith(suf))) return true;
      continue;
    }
    // Wildcard prefix: "mcp*" → any token starting with "mcp"
    if (needle.endsWith("*") && needle.length > 1) {
      const pre = needle.slice(0, -1).replace(NAME_SEP, "");
      if (pre && tokens.some((tok) => tok.startsWith(pre))) return true;
      continue;
    }
    // Tokenize the needle the same way we tokenized the name.
    // Single-token needles need exact equality; multi-token needles need
    // their tokens to appear as a contiguous subsequence.
    const needleTokens = needle.split(NAME_SEP).filter(Boolean);
    if (needleTokens.length === 0) continue;
    if (needleTokens.length === 1) {
      if (tokens.includes(needleTokens[0])) return true;
      continue;
    }
    outer: for (let i = 0; i <= tokens.length - needleTokens.length; i++) {
      for (let j = 0; j < needleTokens.length; j++) {
        if (tokens[i + j] !== needleTokens[j]) continue outer;
      }
      return true;
    }
  }
  return false;
}

function tagHas(t: Tool, ...tags: string[]): boolean {
  const ts = new Set((t.tags || []).map((x) => x.toLowerCase()));
  return tags.some((tag) => ts.has(tag.toLowerCase()));
}

/**
 * Detect tools whose human-facing strings are mostly non-English.
 * The matcher's predicates are English-keyword-based; tools described in
 * other languages can't be fairly evaluated and shouldn't surface unless
 * a name or tag happens to hit. (Their tools page link still works for
 * users who want to investigate.)
 */
function isMostlyNonEnglish(t: Tool): boolean {
  const text = nameAndDesc(t);
  if (text.length < 50) return false;
  const cjkCount = (text.match(/[　-鿿가-힯]/g) || []).length;
  const cyrillicCount = (text.match(/[Ѐ-ӿ]/g) || []).length;
  const arabicCount = (text.match(/[؀-ۿ]/g) || []).length;
  const nonEnglishCount = cjkCount + cyrillicCount + arabicCount;
  return nonEnglishCount > text.length * 0.30;
}

/**
 * Filter the tool pool to "could plausibly work with this agent".
 *
 * Claude-targeted projects: must look Claude-shaped.
 *
 * Non-Claude agents (Cursor, Cline, Aider, etc.): the previous version
 * required `tagHas(t, agent)` OR `(category === mcp_server AND tagHas mcp)`.
 * Both branches were too tight:
 *   - Cursor users use Claude-flavored skills via `.cursorrules` daily, but
 *     the literal `cursor` tag is rare on Claude skills, so `method-skill`
 *     was always empty for Cursor (and Cline, Windsurf, etc.).
 *   - Aider's branch dropped 248 mcp_servers without the literal `mcp` tag.
 *
 * New rule: for non-Claude agents, accept any tool that's NOT marked
 * incompatible AND is one of:
 *   - tagged with the specific agent
 *   - an mcp_server (compatibility="mcp_ready" — protocol is portable)
 *   - a Claude skill / plugin (cross-agent in practice; we'll down-rank in
 *     scoring rather than hard-filter here)
 */
function compatibleWithAgent(t: Tool, agent: AgentTarget): boolean {
  if (t.compatibility === "incompatible") return false;
  if (agent === "unknown" || agent === "generic") return true;
  if (agent === "claude-code" || agent === "claude-desktop") {
    const looksClaudey =
      t.compatibility === "native_claude_code" ||
      t.compatibility === "mcp_ready" ||
      tagHas(t, "claude", "claude-code", "anthropic", "mcp", "mcp-server", "claude-plugin", "anthropic-skill") ||
      /\b(claude|anthropic|mcp\b|model context protocol)/i.test(nameAndDesc(t));
    return looksClaudey;
  }
  // Non-Claude agent: be more permissive — let scoring sort it out.
  if (tagHas(t, agent)) return true;
  if (t.category === "mcp_server") return true;                          // protocol portable
  if (t.category === "skill" || t.category === "claude_plugin") return true; // cross-agent in practice
  return tagHas(t, "claude", "claude-code", "anthropic");
}

/**
 * JS and TS are interchangeable for most agent-tooling purposes (TS gets
 * compiled down). Other language pairs aren't.
 */
function languagesCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return true;
  const jsTs = new Set(["javascript", "typescript"]);
  if (jsTs.has(la) && jsTs.has(lb)) return true;
  return false;
}

// ---- scoring ---------------------------------------------------------------

function score(t: Tool, profile: ExtendedProfile, layerId?: string): number {
  let s = (t.grade?.total ?? 0) / 25 * 5; // 0–5

  // Recency
  if (t.last_updated) {
    const days = Math.max(0, (Date.now() - new Date(t.last_updated).getTime()) / 86400000);
    if (days < 30) s += 1;
    else if (days < 180) s += 0.5;
  }

  // Stars (logarithmic)
  s += Math.min(Math.log10((t.stars ?? 0) + 1) / 2, 2);

  // Language match / mismatch.
  // - Plugins/skills are agent-side — host language doesn't matter.
  // - Infrastructure layers (code-exec, observability, data-storage,
  //   web-api) are language-agnostic by purpose: a Docker sandbox is a
  //   Docker sandbox regardless of what language it's WRITTEN in. A user
  //   on Go can use a TypeScript-written observability MCP fine.
  // - SDK and domain-skill require strict language match (you'll write code
  //   in / consume idioms from the tool's language).
  const isLanguageAgnosticCategory = t.category === "claude_plugin" || t.category === "skill";
  const INFRA_LAYERS = new Set(["code-exec", "observability", "data-storage", "web-api", "search", "memory-retrieval"]);
  const isInfraLayer = layerId ? INFRA_LAYERS.has(layerId) : false;
  if (profile.primaryLanguage && t.language && !isLanguageAgnosticCategory) {
    if (languagesCompatible(profile.primaryLanguage, t.language)) {
      s += 1.5;
    } else if (NICHE_LANGUAGES.has(profile.primaryLanguage) && !isInfraLayer) {
      // Niche-language project + foreign-language tool in a language-strict
      // lane (SDK or domain-skill) = drop hard. Solidity user has zero use
      // for a Python REST auth lib. -10 ensures it falls below floor.
      s -= 10;
    } else if (NICHE_LANGUAGES.has(profile.primaryLanguage)) {
      // Niche-lang in infra lane: still penalize but not as hard, infra
      // tools are mostly portable.
      s -= 2;
    } else {
      s -= 2.5;
    }
  }
  // Treat language=null tools as foreign for niche-lang projects in
  // language-strict lanes (mostly awesome-list stubs).
  if (
    profile.primaryLanguage &&
    !t.language &&
    NICHE_LANGUAGES.has(profile.primaryLanguage) &&
    !isLanguageAgnosticCategory &&
    !isInfraLayer
  ) {
    s -= 4;
  }

  // Tag overlap with profile tokens
  const toks = profile.tokens;
  const tags = (t.tags || []).map((x) => x.toLowerCase());
  for (const tg of tags) if (toks.has(tg)) s += 0.5;

  // Domain mention in description
  const h = nameAndDesc(t);
  for (const d of profile.domains) if (h.includes(d.toLowerCase())) s += 0.4;

  // Compatibility cleanliness
  if (t.compatibility === "mcp_ready" || t.compatibility === "native_claude_code") s += 0.5;
  if (t.compatibility === "incompatible") s -= 5;

  // Down-rank Claude-only tools for non-Claude agents (we accepted them in
  // compatibleWithAgent rather than hard-filtering, so handle here).
  if (
    profile.targetAgent !== "unknown" &&
    profile.targetAgent !== "generic" &&
    profile.targetAgent !== "claude-code" &&
    profile.targetAgent !== "claude-desktop" &&
    t.compatibility === "native_claude_code"
  ) {
    s -= 1.5;
  }

  // Specific-name match — the "user mentioned a thing, prefer tools named
  // after that thing" rule. Previously only databases. Now generalized to
  // databases, frameworks, and observability vendors. When the user says
  // "Postgres", we want a Postgres tool; "Datadog" → a Datadog tool;
  // "Playwright" → a Playwright tool — not the most-popular generic.
  const SPECIFIC_NAME_TARGETS: { word: string; aliases: string[] }[] = [
    // Databases (existing behavior preserved)
    { word: "postgres", aliases: ["postgres", "postgresql", "supabase", "neon", "pg"] },
    { word: "mysql",    aliases: ["mysql", "mariadb", "planetscale"] },
    { word: "sqlite",   aliases: ["sqlite", "duckdb"] },
    { word: "mongo",    aliases: ["mongo"] },
    { word: "redis",    aliases: ["redis"] },
    { word: "duckdb",   aliases: ["duckdb"] },
    { word: "supabase", aliases: ["supabase"] },
    // Frameworks (NEW)
    { word: "playwright", aliases: ["playwright"] },
    { word: "puppeteer",  aliases: ["puppeteer"] },
    { word: "selenium",   aliases: ["selenium"] },
    { word: "django",     aliases: ["django"] },
    { word: "rails",      aliases: ["rails"] },
    { word: "next.js",    aliases: ["next", "nextjs"] },
    { word: "fastapi",    aliases: ["fastapi"] },
    { word: "firebase",   aliases: ["firebase", "firestore"] },
    { word: "hardhat",    aliases: ["hardhat"] },
    { word: "foundry",    aliases: ["foundry", "forge"] },
    { word: "react native", aliases: ["react-native", "reactnative", "expo"] },
    // Observability vendors (NEW)
    { word: "datadog",    aliases: ["datadog", "dd"] },
    { word: "grafana",    aliases: ["grafana"] },
    { word: "prometheus", aliases: ["prometheus"] },
    { word: "sentry",     aliases: ["sentry"] },
    { word: "opentelemetry", aliases: ["opentelemetry", "otel"] },
    { word: "jaeger",     aliases: ["jaeger"] },
  ];
  const descLower = profile.description.toLowerCase();
  for (const { word, aliases } of SPECIFIC_NAME_TARGETS) {
    if (descLower.includes(word) && aliases.some((a) => nameHas(t, a) || tagHas(t, a))) {
      s += 2.5;
    }
  }

  // Canonical-SDK boost — when the user is on TS/JS, the OFFICIAL
  // `@modelcontextprotocol/sdk` should beat niche TS variants like
  // `@mcp-b/webmcp-ts-sdk` even though the latter has a marginally higher
  // grade. Same for Python's fastmcp (already handled but generalized).
  if (layerId === "sdk-runtime") {
    if (nameHas(t, "modelcontextprotocol")) s += 3;
    if (profile.primaryLanguage === "python" && nameHas(t, "fastmcp")) s += 3;
    if (profile.primaryLanguage === "python") {
      if (t.language?.toLowerCase() === "python" && tagHas(t, "mcp", "mcp-server", "mcp-tools")) s += 1;
    }
  }

  // Subcategory boost — the catalog has structured subcategory info on ~20%
  // of records; when present, it's much higher signal than a description scrape.
  // (Audit recommendation #5)
  const subcatLayerMap: Record<string, string[]> = {
    "context-fs": ["filesystem"],
    "context-git": ["git"],
    "memory-retrieval": ["memory", "vector", "embeddings"],
    "data-storage": ["database"],
    "search": ["search"],
    "code-exec": ["sandbox", "execution"],
    "observability": ["logs", "metrics", "tracing"],
  };
  const wantedSub = subcatLayerMap[layerId || ""];
  if (wantedSub && t.subcategory && wantedSub.includes(t.subcategory.toLowerCase())) {
    s += 2;
  }

  // Penalize awesome-list stub records (no real verification signal)
  if (t.description && t.description.toLowerCase().startsWith("listed in ")) s -= 2;

  // Method-skill intent boosts: when the project asks for a SPECIFIC method
  // (TDD, code review, security audit), prefer tools whose name reflects
  // that specific method over generic ones. Without this, a "code review"
  // prompt would still get tdd-guard as #1 because TDD has the existing
  // boost and code-review had no parallel.
  if (layerId === "method-skill") {
    const projectWantsTdd = /\b(tdd|test[\s-]?driven|red[\s-]?green)\b/i.test(profile.description);
    const projectWantsReview = /\bcode[\s-]?review\b/i.test(profile.description);
    const projectWantsAudit = /\b(security[\s-]?audit|formal[\s-]?verification|smart[\s-]?contract\s+audit|gas[\s-]?optimi[sz]ation)\b/i.test(profile.description);
    if (projectWantsTdd) {
      if (nameHas(t, "tdd", "test-driven", "test-guard")) s += 3;
      else if (/\b(automated\s+tdd|tdd\s+enforcement|test[\s-]?driven\s+(?:development|enforcement))\b/i.test(nameAndDesc(t))) s += 2;
    }
    if (projectWantsReview) {
      if (nameHas(t, "code-review", "review-skill", "reviewer", "codex-review")) s += 3;
      else if (tagHas(t, "code-review", "review", "reviewer")) s += 2;
      else if (/\b(code\s+review|review\s+skill|automated\s+review)\b/i.test(nameAndDesc(t))) s += 1.5;
    }
    if (projectWantsAudit) {
      if (nameHas(t, "audit", "verify", "formal", "quillshield", "vigilo", "chiasmus")) s += 3;
      else if (tagHas(t, "security-audit", "formal-verification", "defi-security", "smart-contract-audit")) s += 2.5;
    }
  }

  // Demote misclassified shapes in the plugin layer (audit's harness/marketplace fix):
  // tools whose descriptions imply they ARE an agent, not a plugin FOR an agent
  if (layerId === "agent-plugin") {
    if (t.category === "harness") s -= 4;
    if (
      /\b(harness|nano\s+claude|claude-code-like|directory\s+of|marketplace|like\s+claude\s+code|full[\s-]?stack\s+(?:engineer\s+)?agent)\b/i.test(
        nameAndDesc(t),
      )
    ) {
      s -= 4;
    }
    // Project-relevance for plugins: a "PPTX generator" plugin doesn't help
    // someone building a Postgres MCP server. Boost plugins that touch the
    // project's dev workflow (test/lint/type/review/mcp/debug); demote ones
    // about media/presentations/voice/games/social.
    const text = nameAndDesc(t);
    const devToolingHits = (text.match(/\b(mcp|test|lint|format|type|review|debug|status|hook|spec|tdd)\b/gi) || []).length;
    s += Math.min(devToolingHits * 0.5, 2);
    if (/\b(pptx|powerpoint|slide|presentation|audio|voice|video|image|game|social|tweet|instagram)\b/i.test(text)) {
      s -= 2;
    }
    // Boost when plugin's tags overlap the project's detected domains
    const projectTokens = profile.tokens;
    const tagHitCount = (t.tags || []).filter((tg) => projectTokens.has(tg.toLowerCase())).length;
    s += Math.min(tagHitCount * 0.4, 1.5);
    // Mirror the method-skill intent boosts into the plugin lane: when the
    // user explicitly wants TDD / code-review / audit, prefer plugins that
    // address that intent over generic-but-popular plugins (claude-hud etc.).
    // Without this, a "code review skill" prompt picks tdd-guard as plugin
    // primary because tdd-guard happens to have higher base grade.
    const projectWantsReview = /\bcode[\s-]?review\b/i.test(profile.description);
    const projectWantsAudit = /\b(security[\s-]?audit|formal[\s-]?verification|smart[\s-]?contract\s+audit)\b/i.test(profile.description);
    if (projectWantsReview) {
      if (nameHas(t, "review", "consensus", "adversarial", "reviewer", "plannotator")) s += 2.5;
      else if (tagHas(t, "code-review", "review", "reviewer")) s += 1.5;
    }
    if (projectWantsAudit) {
      if (nameHas(t, "audit", "verify", "formal", "quillshield", "vigilo")) s += 2.5;
      else if (tagHas(t, "audit", "security-audit", "formal-verification", "defi-security")) s += 1.5;
    }
  }

  // Windows-compat soft preference: Python/Go/TS/JS install with one command
  // and don't require Rust toolchains or POSIX-only shell pipelines
  if (profile.platform === "windows" && t.language) {
    const friendly = ["python", "go", "typescript", "javascript", "c#"];
    if (friendly.includes(t.language.toLowerCase())) s += 0.5;
  }

  return Math.round(s * 100) / 100;
}

// ---- reasons (honest, not just "matches X" because of incidental string) ---

function reasonFor(t: Tool, profile: ExtendedProfile, layerName: string, sc: number): string {
  const bits: string[] = [];
  if (t.grade?.letter) bits.push(`grade ${t.grade.letter}`);

  // Specific-name matches go first (they're the most concrete reason)
  for (const dbName of ["postgres", "mysql", "sqlite", "mongo", "redis"]) {
    if (profile.description.toLowerCase().includes(dbName) && nameHas(t, dbName)) {
      bits.push(`${dbName}-specific`);
      break;
    }
  }

  // Language match (only if it's actually compatible)
  if (t.language && profile.primaryLanguage) {
    if (languagesCompatible(profile.primaryLanguage, t.language)) {
      bits.push(`${t.language} match`);
    }
  }

  // Domain alignment — but only if at least 2 of the project's detected
  // domains appear in the tool's text, otherwise it's likely incidental
  const tags = new Set((t.tags || []).map((x) => x.toLowerCase()));
  const hits = profile.domains.filter((d) => tags.has(d.toLowerCase()) || nameAndDesc(t).includes(d.toLowerCase()));
  if (hits.length >= 2) bits.push(`fits ${hits.slice(0, 2).join(" + ")}`);

  if (t.compatibility === "native_claude_code") bits.push("Claude-native");
  else if (t.compatibility === "mcp_ready") bits.push("MCP-ready");

  return bits.slice(0, 3).join(" · ") || layerName;
}

// ---- layers ----------------------------------------------------------------

type LayerDef = {
  id: string;
  name: string;
  description: string;
  required: boolean;
  primary: number;
  alternatives: number;
  applies: (p: ExtendedProfile) => boolean;
  candidate: (t: Tool, p: ExtendedProfile) => boolean;
};

const LAYERS: LayerDef[] = [
  {
    id: "sdk-runtime",
    name: "SDK & runtime",
    description: "The core SDK or runtime your project will depend on.",
    required: true,
    primary: 1,
    alternatives: 2,
    // applies: now gates on MCP-intent. Previously this lane fired for every
    // project, leading to fastmcp being recommended for trading bots, social
    // apps, etc. — projects where the user just installs domain libraries
    // (ccxt, alpaca, supabase) themselves. The MCP-flavored SDK pick was
    // confusing and irrelevant.
    //
    // Now: fire only when the user is BUILDING an MCP-related thing OR the
    // detected archetype natively depends on MCP infrastructure (currently
    // just ai-agent-app — see usesMcpDirectly on the archetype).
    applies: (p) => {
      // Explicit MCP signal in the description
      if (p.hasMcp) return true;
      // Project-shape signals: building an MCP server, plugin, extension,
      // skill, harness, or consuming an MCP-flavored library
      if ([
        "build_mcp_server",
        "build_plugin",
        "build_extension",
        "build_skill",
        "build_harness",
        "library",
      ].includes(p.goal)) return true;
      // Archetype-level signal: ai-agent-app legitimately uses MCP as the
      // tool-call protocol, even when the user didn't say "MCP" verbatim.
      if (p.archetype?.usesMcpDirectly) return true;
      return false;
    },
    candidate: (t, p) => {
      // Strict: must look like an SDK or framework, not a tool that uses MCP.
      // The previous broad regex matched ANY tool with "mcp" in the name
      // (mcp-workspace, gitingest-mcp, python-notebook-mcp); those are MCP
      // SERVERS, not SDKs. Now requires either category=library, a specific
      // SDK name token, or an SDK tag. Also explicitly excludes MCP CLIENTS
      // (they consume MCP, they aren't SDKs to build with).
      const isLibrary = t.category === "library" && tagHas(t, "mcp");
      const isSpecificSdk = nameHas(
        t,
        "fastmcp",
        "mcp-sdk",
        "anthropic-sdk",
        "modelcontextprotocol",
        "mcp-cli",
        "mcp-server-cli",
      );
      const tagSdk = tagHas(t, "mcp-sdk", "fastmcp", "sdk");
      const isSdk = isLibrary || isSpecificSdk || tagSdk;
      if (!isSdk) return false;
      // Reject MCP clients (they're for consuming MCP, not building servers)
      if (nameHas(t, "client") || /\b(mcp\s+client|client\s+for\s+mcp)\b/i.test(nameAndDesc(t))) {
        // Allow only if the tool ALSO has clear server-side SDK tagging
        if (!tagHas(t, "fastmcp", "mcp-sdk") && !nameHas(t, "fastmcp")) return false;
      }
      // Language gate: STRICT match required.
      // Default-deny when language is unknown — previous fallback `return true`
      // accepted any SDK regardless of project language, leading to fastmcp
      // being picked for Rust, Go, Solidity, vague-prompt, and mobile projects.
      if (!p.primaryLanguage) {
        // No project language — require a canonical/agent-neutral SDK name
        return nameHas(t, "modelcontextprotocol", "anthropic-sdk", "fastmcp");
      }
      if (p.primaryLanguage === "python") {
        return t.language?.toLowerCase() === "python" || nameHas(t, "fastmcp");
      }
      if (p.primaryLanguage === "typescript" || p.primaryLanguage === "javascript") {
        return (
          ["typescript", "javascript"].includes(t.language?.toLowerCase() || "") ||
          nameHas(t, "modelcontextprotocol", "anthropic-sdk")
        );
      }
      // Niche language (Rust, Go, Solidity, etc.): require explicit language match.
      // The catalog has very few niche-lang SDKs; better to skip the layer
      // than pick a Python tool the user can't use.
      if (NICHE_LANGUAGES.has(p.primaryLanguage)) {
        return t.language?.toLowerCase() === p.primaryLanguage.toLowerCase();
      }
      return false;
    },
  },
  {
    id: "context-fs",
    name: "Filesystem context",
    description: "Let the agent read your code via a sandboxed filesystem MCP.",
    required: false,
    primary: 1,
    alternatives: 2,
    // applies: dropped "general" — that goal is the catch-all when no goal
    // regex matched. Treating it as "yes, you need filesystem context" was
    // making vague prompts pick a Python FS server out of nowhere. Same for
    // build_skill — skill authors don't need an FS MCP, they write markdown.
    applies: (p) =>
      p.domains.includes("filesystem") ||
      ["build_mcp_server", "build_plugin", "build_harness"].includes(p.goal),
    candidate: (t) =>
      t.category === "mcp_server" &&
      (t.subcategory?.toLowerCase() === "filesystem" ||
        nameHas(t, "filesystem", "fs-mcp", "fs-server", "mcp-fs") ||
        tagHas(t, "filesystem")),
  },
  {
    id: "context-git",
    name: "Git context",
    description: "Git ops MCP — read commit history, branches, diffs.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) =>
      p.domains.includes("git-vcs") ||
      ["build_mcp_server", "build_plugin", "build_harness"].includes(p.goal),
    candidate: (t) =>
      t.category === "mcp_server" &&
      (t.subcategory?.toLowerCase() === "git" ||
        nameHas(t, "git-mcp", "git-server", "mcp-git", "/git/", "mcp-server-git") ||
        tagHas(t, "git", "github")),
  },
  {
    id: "memory-retrieval",
    name: "Memory & retrieval",
    description: "Persistent state, vector recall, knowledge graphs.",
    required: false,
    primary: 1,
    alternatives: 3,
    applies: (p) =>
      p.domains.includes("embeddings-rag") || p.domains.includes("agent-orchestration") ||
      /\b(memory|recall|persist|knowledge[\s-]?base)\b/i.test(p.description),
    candidate: (t) =>
      t.category === "mcp_server" &&
      (nameHas(t, "memory", "vector", "embed", "rag", "retrieval", "knowledge") ||
        tagHas(t, "memory", "vector", "embeddings", "rag")),
  },
  {
    id: "data-storage",
    name: "Data layer",
    description: "Database / storage MCP servers — let the agent query domain data directly.",
    required: false,
    primary: 1,
    alternatives: 4,
    applies: (p) => p.domains.includes("database"),
    candidate: (t, p) => {
      if (t.category !== "mcp_server") return false;
      const desc = p.description.toLowerCase();

      // If a specific DB is named, require a name-match on that DB.
      // Previously we'd fall through to generic-tag matching, which let an
      // SSH-manager with a "database" tag (because it has "DB operations"
      // as one of 37 features) win the data-storage lane for a SQLite prompt.
      const namedDbs: Record<string, string[]> = {
        postgres:  ["postgres", "postgresql", "supabase", "neon", "pg"],
        mysql:     ["mysql", "mariadb", "planetscale"],
        sqlite:    ["sqlite", "duckdb"],
        mongo:     ["mongo", "mongodb"],
        redis:     ["redis"],
        firebase:  ["firebase", "firestore"],
        supabase:  ["supabase"],
      };
      // Treat the archetype's preferredDataStore as if it were named in the
      // prompt. This is what fixes the "trading app gets MySQL pick" bug —
      // market-trader's example_stack uses Postgres + Timescale, so when the
      // user describes a trading project we should bias toward Postgres
      // tools even if they didn't say "Postgres" verbatim.
      let specificDbNamed = false;
      const archetypePreferredDb = p.archetype?.preferredDataStore;
      if (archetypePreferredDb && namedDbs[archetypePreferredDb]) {
        const aliases = namedDbs[archetypePreferredDb];
        if (aliases.some((a) => nameHas(t, a) || tagHas(t, a))) return true;
        specificDbNamed = true;
      }
      for (const [dbName, aliases] of Object.entries(namedDbs)) {
        if (desc.includes(dbName)) {
          specificDbNamed = true;
          if (aliases.some((a) => nameHas(t, a) || tagHas(t, a))) return true;
        }
      }
      // If a specific DB was named but the tool doesn't match it, reject.
      // No fall-through to "any tool with a 'database' tag" — that lets in
      // SSH/devops tools that incidentally do DB ops as a side feature.
      if (specificDbNamed) return false;

      // Generic case: require BOTH a DB-specific name token AND a DB tag,
      // OR subcategory=database with a clear DB-noun in the description.
      const hasDbName = nameHas(t, "postgres", "sqlite", "mysql", "mongo", "redis", "supabase", "duckdb", "database");
      const hasDbTag = tagHas(t, "database", "postgres", "mysql", "sqlite", "mongodb", "redis", "supabase", "firebase");
      const subcatDb = t.subcategory?.toLowerCase() === "database";
      const dbNounInDesc = /\b(database|sql\s+query|relational|nosql|key[\s-]?value\s+store|document\s+store)\b/i.test(nameAndDesc(t));
      return (hasDbName && hasDbTag) || (subcatDb && dbNounInDesc);
    },
  },
  {
    id: "auth",
    name: "Auth / identity",
    description: "Authentication, RBAC, or row-level security.",
    required: false,
    primary: 1,
    alternatives: 2,
    // applies: only fire on the explicit "auth" domain — NOT "security".
    // "Security" is too broad: a Solidity DeFi project says "security"
    // meaning smart-contract security, not user auth/RBAC. Firing on
    // "security" was forcing auth picks (fastapi_mcp) into Solidity stacks.
    applies: (p) => p.domains.includes("auth"),
    candidate: (t) => {
      // Under the new word-boundary nameHas, "iam" only matches a standalone
      // "iam" token (not "iamzhihuix"); "auth" doesn't match "author".
      const nameMatch = nameHas(t, "auth", "oauth", "jwt", "rbac", "row-level", "iam", "casdoor", "keycloak", "fastapi-mcp");
      const tagMatch = tagHas(t, "auth", "authentication", "oauth", "jwt", "iam", "rbac");
      if (!nameMatch && !tagMatch) return false;
      // Require auth-purpose in description too, OR an explicit auth tag.
      const purposeInDesc = /\b(auth(entication|orization|n|z)?|oauth|jwt|sso|rbac|rls|row[\s-]?level|identity|credentials?|keycloak|casdoor|with\s+auth)\b/i.test(nameAndDesc(t));
      return purposeInDesc || tagMatch;
    },
  },
  {
    id: "web-api",
    name: "Web & API access",
    description: "Outbound HTTP — fetch URLs, hit external APIs, scrape pages.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) =>
      p.domains.includes("scraping") || p.domains.includes("browser-automation") ||
      p.domains.includes("backend") || p.domains.includes("search"),
    candidate: (t, p) => {
      if (t.category !== "mcp_server") return false;
      // Tighter: require purpose-keyword in NAME or tag, not just substring in description.
      const purposeName = nameHas(t, "fetch", "http", "browser", "playwright", "selenium", "puppeteer", "scraper", "crawl", "request");
      const purposeTag = tagHas(t, "fetch", "http", "browser", "scraping", "scraper", "crawler", "playwright", "puppeteer");
      // Require the project actually has a scraping/browser intent, otherwise web-api is overreach
      const projectNeedsIt = p.domains.includes("scraping") || p.domains.includes("browser-automation") || /\b(fetch\s+url|http\s+client|api\s+gateway)\b/i.test(p.description);
      return (purposeName || purposeTag) && projectNeedsIt;
    },
  },
  {
    id: "search",
    name: "Search",
    description: "Web/semantic search.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) =>
      p.domains.includes("search") ||
      /\b(search\s+the\s+web|google\s+search)\b/i.test(p.description),
    candidate: (t) =>
      t.category === "mcp_server" &&
      (nameHas(t, "search", "tavily", "exa-", "perplexity", "brave-search", "duckduckgo") ||
        tagHas(t, "search", "tavily", "exa", "brave-search")),
  },
  {
    id: "code-exec",
    name: "Code execution",
    description: "Sandboxed REPL or container exec.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) =>
      p.domains.includes("docker") || p.hasDocker || p.goal === "build_harness" ||
      /\b(sandbox|repl|interpreter|run\s+code|docker\s+exec)\b/i.test(p.description),
    candidate: (t) => {
      if (t.category !== "mcp_server") return false;
      // Strict: tool must BE about code execution, not just mention it as a
      // feature. Previous version matched LibreChat (a chat clone) because
      // its description has "code interpreter" in a feature list.
      const hasNameMatch =
        nameHas(t, "e2b", "incus", "pyodide", "jupyter", "sandbox", "repl", "code-runner", "docker-mcp", "shell-mcp", "edgebox") ||
        tagHas(t, "sandbox", "code-execution", "code-interpreter", "e2b", "llm-sandbox", "jupyter") ||
        // Kernel/exec keywords as product self-description (NOT feature mentions)
        /\b(?:kernel\s+exec|sandboxed\s+repl|isolated\s+(?:machine|env)|run\s+code\s+in|execute\s+code)\b/i.test(nameAndDesc(t));
      if (!hasNameMatch) return false;
      // Exclusion: chat-clones / LLM apps that happen to feature code-exec
      if (/\b(chatgpt[\s-]?clone|enhanced\s+chatgpt|chat\s+(app|platform|interface|clone))\b/i.test(nameAndDesc(t))) return false;
      // Exclusion: context/output sandboxers (different meaning of "sandbox")
      if (/sandbox(?:es)?\s+(?:tool\s+output|response|context|window)/i.test(nameAndDesc(t))) return false;
      // Exclusion: notebook MCPs that are EDITORS, not executors
      if (nameHas(t, "notebook") && !/\b(sandbox|exec|kernel|isolated|run\s+code)\b/i.test(nameAndDesc(t))) return false;
      return true;
    },
  },
  {
    id: "observability",
    name: "Observability",
    description: "Logs, metrics, traces.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) => p.domains.includes("observability") || p.hasCI,
    candidate: (t) => {
      if (t.category !== "mcp_server") return false;
      const nameMatch = nameHas(t, "log", "metric", "trace", "datadog", "grafana", "prometheus", "sentry", "telemetry", "opentelemetry", "otel", "jaeger");
      const tagMatch = tagHas(t, "logs", "metrics", "tracing", "observability", "monitoring", "telemetry", "opentelemetry");
      if (!nameMatch && !tagMatch) return false;
      // Exclude tools whose ORG matches an observability vendor but whose
      // PURPOSE is unrelated. Previous version let `getsentry/XcodeBuildMCP`
      // (an iOS build tool) into the observability lane via "Sentry" org.
      const purposeInDesc = /\b(observability|monitoring|tracing|logs?|metrics|telemetry|alerts?|dashboards?|incidents?)\b/i.test(nameAndDesc(t));
      return purposeInDesc || tagMatch;
    },
  },
  {
    id: "method-skill",
    name: "Method skill (TDD / debugging / review)",
    description: "Codified workflows — TDD, debugging, code review.",
    required: false,
    primary: 1,
    alternatives: 3,
    applies: (p) => p.hasTests || /\b(tdd|test[\s-]?driven|red[\s-]?green|debug|code[\s-]?review)\b/i.test(p.description),
    candidate: (t, p) => {
      // A "method skill" can be packaged as either a `skill` OR a `claude_plugin`
      // (e.g. nizos/tdd-guard is a plugin that enforces TDD — same intent).
      // What matters is that it's a CODIFIED METHOD, not a domain-specific app.
      if (t.category !== "skill" && t.category !== "claude_plugin") return false;

      // Project asked for TDD specifically? Strongly prefer TDD-named tools.
      const projectWantsTdd = /\b(tdd|test[\s-]?driven|red[\s-]?green)\b/i.test(p.description);
      const tddNamed = nameHas(t, "tdd", "test-driven", "test-guard");
      const tddDesc = /\b(automated\s+tdd|test[\s-]?driven\s+(?:development|enforcement)|red[\s-]?green[\s-]?refactor)\b/i.test(nameAndDesc(t));
      if (projectWantsTdd && (tddNamed || tddDesc)) return true;

      // Project asked for code review specifically? Prefer review-named tools.
      const projectWantsReview = /\bcode[\s-]?review\b/i.test(p.description);
      if (projectWantsReview && (nameHas(t, "code-review", "review-skill", "reviewer", "codex-review") || tagHas(t, "code-review"))) return true;

      // Project asked for security audit / formal verification / smart-contract
      // audit specifically? Prefer audit-named tools. Without this branch, a
      // Solidity DeFi project explicitly requesting "security audit tooling"
      // would still get tdd-guard because audit tools weren't even candidates.
      const projectWantsAudit = /\b(security[\s-]?audit|formal[\s-]?verification|smart[\s-]?contract\s+audit|gas[\s-]?optimi[sz]ation|audit\s+tooling)\b/i.test(p.description);
      if (projectWantsAudit) {
        if (nameHas(t, "audit", "verify", "formal", "quillshield", "vigilo", "chiasmus")) return true;
        if (tagHas(t, "audit", "security-audit", "formal-verification", "defi-security", "solidity-audit", "smart-contract-audit")) return true;
      }

      // Otherwise standard method-skill markers
      return (
        nameHas(t, "tdd", "test-driven", "debug-guide", "code-review", "review-skill", "refactor-skill") ||
        tagHas(t, "code-review", "tdd", "test-driven", "review-skill") ||
        /\b(systematic[\s-]?debug|automated\s+(?:tdd|review)|debug.*workflow)\b/i.test(nameAndDesc(t))
      );
    },
  },
  {
    id: "domain-skill",
    name: "Domain / language skill",
    description: "Patterns specific to your language or framework.",
    required: false,
    primary: 1,
    alternatives: 3,
    applies: (p) => !!p.primaryLanguage || p.frameworks.size > 0,
    candidate: (t, p) => {
      if (t.category !== "skill") return false;

      // Tighter: language match must be in NAME or TAG, not description.
      // ("claude-code-stock-analysis" has python in description but the skill
      //  is about stocks, not Python coding.)
      const langInNameOrTag = (lang: string) =>
        nameHas(t, lang, lang + "-", "-" + lang) || tagHas(t, lang);

      // Plus require an actual coding-pattern signal (idiomatic, patterns, async,
      // typing, structure, organize) — otherwise it's an app skill, not a
      // language skill.
      const codingPatternSignal =
        /\b(idiomatic|patterns?|async|typing|annotations?|conventions|best[\s-]?practices|structure|organize|architecture|style[\s-]?guide|refactor)\b/i.test(nameAndDesc(t));

      if (p.primaryLanguage) {
        if (langInNameOrTag(p.primaryLanguage) && codingPatternSignal) return true;
      }
      for (const fw of p.frameworks) {
        if (langInNameOrTag(fw) && codingPatternSignal) return true;
      }
      return false;
    },
  },
  {
    id: "agent-plugin",
    name: "Agent quality-of-life plugin",
    description: "Slash commands, hooks, output styles.",
    required: false,
    primary: 1,                         // dropped from 2 → 1 to avoid layer-overweighting
    alternatives: 3,
    applies: (p) => p.targetAgent !== "unknown",
    candidate: (t, p) => {
      if (t.category !== "claude_plugin") return false;
      // Real plugin signal — under the new word-boundary nameHas, "test"
      // no longer matches "ai-attestation" (which slipped through before)
      // and "review" no longer matches "preview/reviewer/unreviewed".
      const isRealPlugin =
        nameHas(t, "slash", "command", "hook", "output-style", "review", "test", "lint", "format", "tdd", "spec", "audit") ||
        /\b(slash[\s-]?command|claude[\s-]?code\s+plugin|hook|output[\s-]?style|code\s+review)\b/i.test(nameAndDesc(t));
      if (!isRealPlugin) return false;
      // Claude-code / Claude-desktop: accept any plugin that passed the
      // "real plugin" gate.
      if (p.targetAgent === "claude-code" || p.targetAgent === "claude-desktop") return true;
      // Other agents (Cursor, Cline, Aider, etc.): accept if the plugin is
      // tagged for the agent OR if it's a cross-agent skill (Cursor users
      // routinely consume Claude-flavored plugins via .cursorrules).
      // Previously: required literal tag, leaving the lane empty for most
      // non-Claude scenarios.
      return tagHas(t, p.targetAgent) || tagHas(t, "claude-code", "claude-plugin");
    },
  },
];

// ---- composition -----------------------------------------------------------

export function composeStack(tools: Tool[], profile: ExtendedProfile): ComposedStack {
  // Underspecified-prompt early return: when the user has given us nothing
  // to go on AND we couldn't even match an archetype, don't hallucinate a
  // stack. Previously we'd still pick fastmcp + a Python FS server — two
  // random-feeling MCP servers with no fit rationale.
  // When an archetype DID match (e.g. "trading app", "RAG chatbot"), the
  // archetype's inferred domains/frameworks/language fill the profile, so
  // this early-return shouldn't fire.
  const isUnderspecified =
    profile.targetAgent === "unknown" &&
    !profile.primaryLanguage &&
    profile.goal === "general" &&
    profile.domains.length === 0 &&
    profile.frameworks.size === 0 &&
    !profile.archetype &&
    !profile.hasMcp &&
    !profile.hasTests &&
    !profile.hasDocker;
  if (isUnderspecified) {
    return {
      layers: [],
      totalPrimaryCount: 0,
      skipped: ["all layers — prompt too vague to recommend (please specify language, agent, or goal)"],
      generatedAt: new Date().toISOString(),
      archetype: null,
    };
  }

  // Pre-filter: must be graded, agent-compatible, and readably-described
  const pool = tools.filter(
    (t) => t.grade && compatibleWithAgent(t, profile.targetAgent) && !isMostlyNonEnglish(t)
  );

  // Goal-driven layer allow-list. See GOAL_LAYER_ALLOWLIST docstring.
  const goalAllow = GOAL_LAYER_ALLOWLIST[profile.goal];
  const layerAllowed = (layerId: string): boolean => {
    if (!goalAllow || goalAllow === "__ALL__") return true;
    return goalAllow.has(layerId);
  };

  const placed = new Set<string>();
  const layers: ComposedLayer[] = [];
  const skipped: string[] = [];
  let totalPrimary = 0;

  for (const def of LAYERS) {
    if (totalPrimary >= MAX_PICKS) {
      skipped.push(`${def.id} (cap reached)`);
      continue;
    }
    if (!layerAllowed(def.id)) {
      skipped.push(`${def.id} (not for goal=${profile.goal})`);
      continue;
    }
    if (!def.applies(profile)) {
      skipped.push(`${def.id} (n/a)`);
      continue;
    }

    const lane = pool
      .filter((t) => !placed.has(t.id) && def.candidate(t, profile))
      .map((t) => ({ tool: t, sc: score(t, profile, def.id) }))
      .sort((a, b) => b.sc - a.sc);

    // Quality floor: best primary must clear MIN_PRIMARY_SCORE
    if (lane.length === 0 || lane[0].sc < MIN_PRIMARY_SCORE) {
      skipped.push(
        `${def.id} (${lane.length === 0 ? "no candidates" : `top score ${lane[0].sc} < ${MIN_PRIMARY_SCORE}`})`,
      );
      continue;
    }

    const wantPrimary = Math.min(def.primary, MAX_PICKS - totalPrimary);
    const primaryRaw = lane.slice(0, wantPrimary).filter((x) => x.sc >= MIN_PRIMARY_SCORE);
    const altRaw = lane
      .slice(wantPrimary, wantPrimary + def.alternatives)
      .filter((x) => x.sc >= MIN_ALT_SCORE);

    const primary: ComposedPick[] = primaryRaw.map(({ tool, sc }) => {
      placed.add(tool.id);
      return { tool, score: sc, reason: reasonFor(tool, profile, def.name, sc), layerId: def.id };
    });
    const alternative: ComposedPick[] = altRaw.map(({ tool, sc }) => {
      placed.add(tool.id);
      return { tool, score: sc, reason: reasonFor(tool, profile, def.name, sc), layerId: def.id };
    });

    if (primary.length === 0) continue;

    totalPrimary += primary.length;
    layers.push({ id: def.id, name: def.name, description: def.description, primary, alternatives: alternative });
  }

  return {
    layers,
    totalPrimaryCount: totalPrimary,
    skipped,
    generatedAt: new Date().toISOString(),
    archetype: profile.archetype,
  };
}
