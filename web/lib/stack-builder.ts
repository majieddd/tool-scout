/**
 * Stack-builder — composes a curated, project-specific stack from the catalog.
 *
 * Different from /stack which builds a stable foundation regardless of
 * project: this one picks tools that match the user's stated goal, language,
 * target agent, and detected domains. Hard cap at MAX_PICKS so the user
 * isn't drowned in tool noise.
 *
 * Each layer:
 *   - has a narrow predicate
 *   - is "required" or "conditional" — conditionals skip when no match
 *   - picks 1-2 primary + 0-3 alternatives
 */
import type { Tool } from "./data";
import type { ExtendedProfile, AgentTarget } from "./architect";

export type ComposedPick = {
  tool: Tool;
  reason: string;
  layerId: string;
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
  skipped: string[];           // layer IDs that produced no candidates
  generatedAt: string;
};

const MAX_PICKS = 15;

function blob(t: Tool): string {
  return ((t.name || "") + " " + (t.description || "") + " " + (t.tags || []).join(" ")).toLowerCase();
}

function hasAny(t: Tool, needles: string[]): boolean {
  const h = blob(t);
  return needles.some((n) => h.includes(n.toLowerCase()));
}

function hasTag(t: Tool, ...tags: string[]): boolean {
  const ts = new Set((t.tags || []).map((x) => x.toLowerCase()));
  return tags.some((tag) => ts.has(tag.toLowerCase()));
}

/** Filter to Claude-compatible tools when targetAgent is Claude-flavored. */
function compatibleWithAgent(t: Tool, agent: AgentTarget): boolean {
  if (agent === "unknown" || agent === "generic") return true;
  if (agent === "claude-code" || agent === "claude-desktop") {
    // Tools tagged or categorized for Claude
    if (t.compatibility === "native_claude_code" || t.compatibility === "mcp_ready") return true;
    if (t.category === "mcp_server" || t.category === "claude_plugin" || t.category === "skill") return true;
    if (hasTag(t, "claude", "claude-code", "anthropic", "mcp")) return true;
    return false;
  }
  // For other agents, accept tools tagged with that agent OR generic MCP
  return hasTag(t, agent) || (t.category === "mcp_server" && hasTag(t, "mcp"));
}

function score(t: Tool, profile: ExtendedProfile): number {
  let s = (t.grade?.total ?? 0) / 25 * 5;     // grade -> 0-5
  // Recency boost
  if (t.last_updated) {
    const days = Math.max(0, (Date.now() - new Date(t.last_updated).getTime()) / 86400000);
    if (days < 30) s += 1;
    else if (days < 180) s += 0.5;
  }
  // Stars boost (logarithmic)
  s += Math.min(Math.log10((t.stars ?? 0) + 1) / 2, 2);

  // Language match
  if (profile.primaryLanguage && t.language?.toLowerCase() === profile.primaryLanguage.toLowerCase()) {
    s += 1.5;
  }
  // Tag overlap with profile tokens
  const toks = profile.tokens;
  const tags = (t.tags || []).map((x) => x.toLowerCase());
  for (const tg of tags) if (toks.has(tg)) s += 0.5;
  // Boost on description mentions of detected domains
  const h = blob(t);
  for (const d of profile.domains) if (h.includes(d.toLowerCase())) s += 0.4;
  // Compatibility-cleanliness boost
  if (t.compatibility === "mcp_ready" || t.compatibility === "native_claude_code") s += 0.5;
  // Penalize incompatible
  if (t.compatibility === "incompatible") s -= 5;

  return Math.round(s * 100) / 100;
}

function reasonFor(t: Tool, profile: ExtendedProfile, layerName: string): string {
  const bits: string[] = [];
  if (t.grade?.letter) bits.push(`grade ${t.grade.letter}`);
  // Pick the strongest reason
  const tags = (t.tags || []).map((x) => x.toLowerCase());
  const hits = profile.domains.filter((d) => tags.includes(d.toLowerCase()) || blob(t).includes(d.toLowerCase()));
  if (hits.length) bits.push(`matches ${hits.slice(0, 2).join(", ")}`);
  if (t.language && profile.primaryLanguage === t.language.toLowerCase()) {
    bits.push(`${t.language} match`);
  }
  if (t.compatibility === "native_claude_code") bits.push("Claude-native");
  else if (t.compatibility === "mcp_ready") bits.push("MCP-ready");
  return bits.slice(0, 3).join(" · ") || layerName;
}

type LayerDef = {
  id: string;
  name: string;
  description: string;
  required: boolean;
  primary: number;
  alternatives: number;
  /** Returns true if this layer applies to the given profile. */
  applies: (p: ExtendedProfile) => boolean;
  /** Filter for tools that belong in this layer. */
  candidate: (t: Tool, p: ExtendedProfile) => boolean;
};

const LAYERS: LayerDef[] = [
  {
    id: "sdk-runtime",
    name: "SDK & runtime",
    description: "The core SDK or runtime your project will depend on for talking to the agent.",
    required: true,
    primary: 1,
    alternatives: 2,
    applies: () => true,
    candidate: (t, p) =>
      hasAny(t, ["mcp sdk", "fastmcp", "mcp framework", "model context protocol", "anthropic-sdk", "anthropic sdk"]) ||
      hasTag(t, "mcp-sdk", "fastmcp") ||
      (t.category === "library" && hasTag(t, "mcp")),
  },
  {
    id: "context-fs-git",
    name: "Code context (filesystem + git)",
    description: "Let the agent read your code and use git in a controlled way.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) => p.domains.includes("filesystem") || p.domains.includes("git-vcs") || ["build_mcp_server", "build_plugin", "build_skill", "build_harness", "general"].includes(p.goal),
    candidate: (t, p) =>
      t.category === "mcp_server" && hasAny(t, ["filesystem", " git ", "/git/", "files", "repository", "directory"]),
  },
  {
    id: "memory-retrieval",
    name: "Memory & retrieval",
    description: "Persistent state and recall across the agent's sessions.",
    required: false,
    primary: 1,
    alternatives: 3,
    applies: (p) => p.domains.includes("embeddings-rag") || p.domains.includes("agent-orchestration") || /\b(memory|recall|persist|knowledge[\s-]?base)\b/i.test(p.description),
    candidate: (t) =>
      t.category === "mcp_server" && hasAny(t, ["memory", "knowledge", "vector", "embedding", "rag", "recall", "remember", "notes"]),
  },
  {
    id: "data-storage",
    name: "Data layer",
    description: "Database / storage MCP servers — let the agent query your domain data directly.",
    required: false,
    primary: 1,
    alternatives: 4,
    applies: (p) => p.domains.includes("database"),
    candidate: (t, p) => {
      if (t.category !== "mcp_server") return false;
      const text = blob(t);
      // Try to match the specific DB if named in description
      const dbMatchers: Record<string, string[]> = {
        postgres: ["postgres", "postgresql", "supabase", "neon"],
        mysql: ["mysql", "mariadb", "planetscale"],
        sqlite: ["sqlite", "duckdb"],
        mongo: ["mongo", "mongodb"],
        redis: ["redis"],
      };
      for (const dbName of Object.keys(dbMatchers)) {
        if (p.description.toLowerCase().includes(dbName) && dbMatchers[dbName].some((m) => text.includes(m))) return true;
      }
      // Generic database tools
      return hasAny(t, ["postgres", "sqlite", "mysql", "mongo", "redis", "supabase", "duckdb", "database", " sql"]);
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
    candidate: (t) => hasAny(t, ["auth", "oauth", "jwt", "rbac", "row-level"]),
  },
  {
    id: "web-api",
    name: "Web & API access",
    description: "Outbound HTTP — fetch URLs, hit external APIs, scrape pages.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) =>
      p.domains.includes("scraping") ||
      p.domains.includes("browser-automation") ||
      p.domains.includes("backend") ||
      p.domains.includes("search"),
    candidate: (t) => t.category === "mcp_server" && hasAny(t, [" fetch", "http ", "api ", "scrape", "browser", "playwright", "selenium", "puppeteer", "webhook"]),
  },
  {
    id: "search",
    name: "Search",
    description: "Web search and semantic retrieval extensions for the agent.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) => p.domains.includes("search") || /\b(search\s+the\s+web|google\s+search)\b/i.test(p.description),
    candidate: (t) => t.category === "mcp_server" && hasAny(t, ["search", "tavily", "exa ", "perplexity", "brave", "google search", "duckduckgo"]),
  },
  {
    id: "code-exec",
    name: "Code execution",
    description: "Sandboxed REPL or container exec — let the agent run code safely.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) => p.domains.includes("docker") || p.hasDocker || p.goal === "build_harness" || /\b(execute|sandbox|repl)\b/i.test(p.description),
    candidate: (t) => t.category === "mcp_server" && hasAny(t, ["sandbox", "execute", "repl", "interpreter", "code-run", "docker exec", "shell"]),
  },
  {
    id: "observability",
    name: "Observability",
    description: "Logs, metrics, traces. Lets the agent debug what it built.",
    required: false,
    primary: 1,
    alternatives: 2,
    applies: (p) => p.domains.includes("observability") || p.hasCI,
    candidate: (t) => t.category === "mcp_server" && hasAny(t, ["log", "metrics", "trace", "observability", "monitor", "datadog", "grafana", "prometheus", "sentry"]),
  },
  {
    id: "method-skill",
    name: "Method skill (TDD / debugging / review)",
    description: "Codified workflows for the agent — TDD, structured debugging, code review.",
    required: false,
    primary: 1,
    alternatives: 3,
    applies: () => true,
    candidate: (t) => t.category === "skill" && hasAny(t, ["tdd", "test-driven", "debug", "code review", "review"]),
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
      if (p.primaryLanguage && hasAny(t, [p.primaryLanguage])) return true;
      for (const fw of p.frameworks) if (hasAny(t, [fw])) return true;
      return false;
    },
  },
  {
    id: "agent-plugin",
    name: "Agent quality-of-life plugin",
    description: "Slash commands, hooks, output styles for your target agent.",
    required: false,
    primary: 2,
    alternatives: 3,
    applies: (p) => p.targetAgent !== "unknown",
    candidate: (t, p) => {
      if (t.category !== "claude_plugin") return false;
      if (p.targetAgent === "claude-code" || p.targetAgent === "claude-desktop") return true;
      return hasTag(t, p.targetAgent);
    },
  },
];

export function composeStack(tools: Tool[], profile: ExtendedProfile): ComposedStack {
  // Remove ungraded + dead + agent-incompatible candidates upfront
  const pool = tools.filter((t) => t.grade && compatibleWithAgent(t, profile.targetAgent));
  const placed = new Set<string>();
  const layers: ComposedLayer[] = [];
  const skipped: string[] = [];

  let totalPrimary = 0;

  for (const def of LAYERS) {
    if (totalPrimary >= MAX_PICKS) {
      skipped.push(def.id + " (cap reached)");
      continue;
    }
    if (!def.applies(profile)) {
      skipped.push(def.id + " (n/a)");
      continue;
    }
    const lane = pool.filter((t) => !placed.has(t.id) && def.candidate(t, profile));
    if (lane.length === 0) {
      if (def.required) {
        // Required but no match — log into skipped, don't push empty layer
        skipped.push(def.id + " (no candidates)");
      } else {
        skipped.push(def.id + " (no candidates)");
      }
      continue;
    }
    lane.sort((a, b) => score(b, profile) - score(a, profile));

    const wantPrimary = Math.min(def.primary, MAX_PICKS - totalPrimary);
    const primaryRaw = lane.slice(0, wantPrimary);
    const altRaw = lane.slice(wantPrimary, wantPrimary + def.alternatives);

    const primary: ComposedPick[] = primaryRaw.map((t) => {
      placed.add(t.id);
      return { tool: t, reason: reasonFor(t, profile, def.name), layerId: def.id };
    });
    const alternative: ComposedPick[] = altRaw.map((t) => {
      placed.add(t.id);
      return { tool: t, reason: reasonFor(t, profile, def.name), layerId: def.id };
    });

    totalPrimary += primary.length;
    layers.push({
      id: def.id,
      name: def.name,
      description: def.description,
      primary,
      alternatives: alternative,
    });
  }

  return {
    layers,
    totalPrimaryCount: totalPrimary,
    skipped,
    generatedAt: new Date().toISOString(),
  };
}
