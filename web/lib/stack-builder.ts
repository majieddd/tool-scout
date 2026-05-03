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
import type { ExtendedProfile, AgentTarget } from "./architect";

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
};

const MAX_PICKS = 15;
const MIN_PRIMARY_SCORE = 1.5;
const MIN_ALT_SCORE = 0.8;

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

function nameHas(t: Tool, ...needles: string[]): boolean {
  const n = nameOnly(t);
  return needles.some((needle) => n.includes(needle.toLowerCase()));
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
 * For Claude-flavored projects, require an actual signal that the tool is
 * relevant to the agent ecosystem. Previously we accepted any
 * `category: 'mcp_server'` row, which let in tools that were technically
 * MCP-shaped but addressed unrelated domains.
 */
function compatibleWithAgent(t: Tool, agent: AgentTarget): boolean {
  if (agent === "unknown" || agent === "generic") return true;
  if (agent === "claude-code" || agent === "claude-desktop") {
    if (t.compatibility === "incompatible") return false;
    const looksClaudey =
      t.compatibility === "native_claude_code" ||
      t.compatibility === "mcp_ready" ||
      tagHas(t, "claude", "claude-code", "anthropic", "mcp", "mcp-server", "claude-plugin", "anthropic-skill") ||
      /\b(claude|anthropic|mcp\b|model context protocol)/i.test(nameAndDesc(t));
    return looksClaudey;
  }
  return tagHas(t, agent) || (t.category === "mcp_server" && tagHas(t, "mcp"));
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

  // Language match / mismatch
  if (profile.primaryLanguage && t.language) {
    if (languagesCompatible(profile.primaryLanguage, t.language)) {
      s += 1.5;
    } else {
      s -= 2.5; // hard penalty — "Python project, TS pick" bug
    }
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

  // Specific-DB name match (the "user said Postgres" fix)
  for (const dbName of ["postgres", "mysql", "sqlite", "mongo", "redis", "supabase", "duckdb"]) {
    if (profile.description.toLowerCase().includes(dbName) && nameHas(t, dbName, dbName + "-", dbName + "_")) {
      s += 2.5;
    }
  }

  // SDK-name match (boost real Python MCP SDKs when target is Python MCP)
  if (layerId === "sdk-runtime" && profile.primaryLanguage === "python") {
    if (nameHas(t, "fastmcp", "mcp-cli", "mcp-server-") || tagHas(t, "fastmcp")) s += 2;
    if (t.language?.toLowerCase() === "python" && tagHas(t, "mcp", "mcp-server", "mcp-tools")) s += 1;
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

  // Method-skill TDD intent boost: when the project asks for TDD specifically
  // (not generic "tests"), prefer tools whose NAME contains tdd / test-driven
  // over generic review/debug skills.
  if (layerId === "method-skill") {
    const projectWantsTdd = /\b(tdd|test[\s-]?driven|red[\s-]?green)\b/i.test(profile.description);
    if (projectWantsTdd) {
      if (nameHas(t, "tdd", "test-driven", "test-guard")) s += 3;
      else if (/\b(automated\s+tdd|tdd\s+enforcement|test[\s-]?driven\s+(?:development|enforcement))\b/i.test(nameAndDesc(t))) s += 2;
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
    applies: () => true,
    candidate: (t, p) => {
      // Strict: must look like an SDK or framework, not a tool that uses MCP.
      // Name match is required — descriptions are too noisy to be authoritative.
      const nameHit =
        nameHas(t, "fastmcp", "mcp-sdk", "/sdk", "anthropic-sdk", "@anthropic", "mcp-cli", "mcp-server-cli")
        || /(^|[\s/-])mcp([-_]server)?($|[\s/-])/.test(nameOnly(t));
      const tagHit = tagHas(t, "mcp-sdk", "fastmcp", "sdk");
      const libCat = t.category === "library" && tagHas(t, "mcp");
      // For Python target, require Python language declaration on the tool
      if (p.primaryLanguage === "python") {
        return (nameHit || tagHit || libCat) && (t.language?.toLowerCase() === "python" || nameHas(t, "py"));
      }
      if (p.primaryLanguage === "typescript" || p.primaryLanguage === "javascript") {
        return (nameHit || tagHit || libCat) && (
          ["typescript", "javascript"].includes(t.language?.toLowerCase() || "") ||
          nameHas(t, "ts-", "-ts", "/sdk")
        );
      }
      return nameHit || tagHit || libCat;
    },
  },
  {
    id: "context-fs",
    name: "Filesystem context",
    description: "Let the agent read your code via a sandboxed filesystem MCP.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) =>
      p.domains.includes("filesystem") ||
      ["build_mcp_server", "build_plugin", "build_skill", "build_harness", "general"].includes(p.goal),
    candidate: (t) =>
      t.category === "mcp_server" &&
      (t.subcategory?.toLowerCase() === "filesystem" ||
        nameHas(t, "filesystem", "/fs/", "-fs-", "fs-mcp", "fs-server") ||
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

      // If a specific DB is named, prefer name-match on that DB (the previous
      // OR with generic-database fell through too easily).
      const namedDbs: Record<string, string[]> = {
        postgres: ["postgres", "postgresql", "supabase", "neon", "pg-"],
        mysql: ["mysql", "mariadb", "planetscale"],
        sqlite: ["sqlite", "duckdb"],
        mongo: ["mongo"],
        redis: ["redis"],
      };
      for (const [dbName, aliases] of Object.entries(namedDbs)) {
        if (desc.includes(dbName)) {
          if (aliases.some((a) => nameHas(t, a))) return true;
        }
      }

      // Otherwise allow generic database tools — but require either name OR tag
      const hasDbName = nameHas(t, "postgres", "sqlite", "mysql", "mongo", "redis", "supabase", "duckdb", "database");
      const hasDbTag = tagHas(t, "database", "postgres", "mysql", "sqlite", "mongodb", "redis", "supabase");
      return hasDbName || hasDbTag;
    },
  },
  {
    id: "auth",
    name: "Auth / identity",
    description: "Authentication, RBAC, or row-level security.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) => p.domains.includes("auth") || p.domains.includes("security"),
    candidate: (t) =>
      nameHas(t, "auth", "oauth", "jwt", "rbac", "row-level", "iam", "casdoor", "keycloak") ||
      tagHas(t, "auth", "authentication", "oauth", "jwt", "iam", "rbac"),
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
      // Require an unambiguous exec/sandbox keyword in NAME or tag.
      // Crucially: exclude "sandboxes tool output" / "context sandbox"
      // (those are context-window optimizers, not code-exec sandboxes).
      const hasNameMatch =
        nameHas(t, "e2b", "incus", "pyodide", "jupyter", "sandbox", "/repl", "code-runner", "docker-mcp", "shell-mcp") ||
        /\b(?:e2b|pyodide|jupyter|repl|interpreter|isolated\s+(?:machine|env))\b/i.test(nameAndDesc(t));
      if (!hasNameMatch) return false;
      // Exclusion: context/output sandboxers
      if (/sandbox(?:es)?\s+(?:tool\s+output|response|context|window)/i.test(nameAndDesc(t))) return false;
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
    candidate: (t) =>
      t.category === "mcp_server" &&
      (nameHas(t, "log", "metric", "trace", "datadog", "grafana", "prometheus", "sentry", "telemetry") ||
        tagHas(t, "logs", "metrics", "tracing", "observability", "monitoring")),
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

      // Otherwise standard method-skill markers — but require unambiguous name match,
      // not just any "debug"/"review" anywhere in description.
      return (
        nameHas(t, "tdd", "test-driven", "debug-guide", "code-review", "review-skill", "refactor-skill") ||
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
      // Real plugin signal — don't accept a generic agent app
      const isRealPlugin =
        nameHas(t, "slash", "command", "hook", "output-style", "review", "test", "lint", "format") ||
        /\b(slash[\s-]?command|claude[\s-]?code\s+plugin|hook|output[\s-]?style)\b/i.test(nameAndDesc(t));
      if (!isRealPlugin) return false;
      if (p.targetAgent === "claude-code" || p.targetAgent === "claude-desktop") return true;
      return tagHas(t, p.targetAgent);
    },
  },
];

// ---- composition -----------------------------------------------------------

export function composeStack(tools: Tool[], profile: ExtendedProfile): ComposedStack {
  // Pre-filter: must be graded, agent-compatible, and readably-described
  const pool = tools.filter(
    (t) => t.grade && compatibleWithAgent(t, profile.targetAgent) && !isMostlyNonEnglish(t)
  );

  const placed = new Set<string>();
  const layers: ComposedLayer[] = [];
  const skipped: string[] = [];
  let totalPrimary = 0;

  for (const def of LAYERS) {
    if (totalPrimary >= MAX_PICKS) {
      skipped.push(`${def.id} (cap reached)`);
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

  return { layers, totalPrimaryCount: totalPrimary, skipped, generatedAt: new Date().toISOString() };
}
