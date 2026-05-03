/**
 * Recommended Base App Stack
 *
 * Composes a stable, "best of breed per layer" stack from the catalog.
 * Stable = the layers are fixed; only the picks within each layer
 * shift as the catalog refreshes (and only when a higher-graded
 * candidate emerges in the same lane). New tools never displace a
 * pick unless they out-grade it AND match the layer's filter.
 *
 * Computed at build time from tools.json — no client cost, regenerates
 * once a day with the catalog.
 */
import type { Tool } from "./data";

export type StackLayerDef = {
  id: string;
  name: string;
  description: string;
  // Predicate: which tools belong in this layer?
  matches: (t: Tool) => boolean;
  primary: number;      // how many top picks to surface
  alternative: number;  // how many runner-ups
};

export type StackPick = {
  tool: Tool;
  reason: string;
};

export type StackLayer = {
  def: StackLayerDef;
  primary: StackPick[];
  alternative: StackPick[];
};

export type StackResult = {
  layers: StackLayer[];
  generatedAt: string;
  totalCandidates: number;
};

const has = (t: Tool, ...needles: string[]) => {
  const hay = (
    (t.name || "") + " " +
    (t.description || "") + " " +
    ((t.tags || []).join(" "))
  ).toLowerCase();
  return needles.some((n) => hay.includes(n.toLowerCase()));
};

const hasTag = (t: Tool, ...tags: string[]) => {
  const ts = new Set((t.tags || []).map((x) => x.toLowerCase()));
  return tags.some((tag) => ts.has(tag.toLowerCase()));
};

/**
 * Layers are ordered foundation → core → tooling → intelligence → ops.
 * Each layer is a *lane*: tools that solve the same kind of problem.
 * The matcher is intentionally narrow per lane so picks don't oscillate
 * between unrelated tools.
 */
export const LAYERS: StackLayerDef[] = [
  {
    id: "sdk",
    name: "MCP SDK & runtime",
    description: "The protocol layer everything else depends on. Pick the SDK that matches your runtime.",
    matches: (t) =>
      (has(t, "mcp sdk", "fastmcp", "mcp framework", "model context protocol")) ||
      (hasTag(t, "mcp-sdk", "fastmcp")) ||
      (t.category === "library" && hasTag(t, "mcp")),
    primary: 2,
    alternative: 3,
  },
  {
    id: "fs-git",
    name: "Filesystem & Git context",
    description: "Let the agent read code, browse files, run git ops in a controlled scope.",
    matches: (t) =>
      t.category === "mcp_server" &&
      has(t, "filesystem", " git ", "/git/", "files", "repository", "directory"),
    primary: 2,
    alternative: 3,
  },
  {
    id: "memory",
    name: "Memory & retrieval",
    description: "Give the agent persistent state — knowledge graphs, vector stores, sticky notes.",
    matches: (t) =>
      t.category === "mcp_server" &&
      has(t, "memory", "knowledge", "vector", "embedding", "rag", "recall", "remember", "notes"),
    primary: 2,
    alternative: 3,
  },
  {
    id: "data",
    name: "Databases & storage",
    description: "SQL, key-value, object storage. The agent's persistence options.",
    matches: (t) =>
      t.category === "mcp_server" &&
      has(t, "postgres", "sqlite", "mysql", "mongo", "redis", "supabase", "neon", "duckdb", "database", " sql"),
    primary: 2,
    alternative: 4,
  },
  {
    id: "web",
    name: "Web & API access",
    description: "Fetch URLs, scrape pages, hit external APIs — the agent's window outward.",
    matches: (t) =>
      t.category === "mcp_server" &&
      has(t, " fetch", "http ", "api ", "scrape", "browser", "playwright", "selenium", "puppeteer", "webhook"),
    primary: 2,
    alternative: 3,
  },
  {
    id: "search",
    name: "Search & retrieval",
    description: "Web search, code search, semantic search — extend the model's reach.",
    matches: (t) =>
      t.category === "mcp_server" &&
      has(t, "search", "tavily", "exa ", "perplexity", "brave", "google search", "duckduckgo"),
    primary: 1,
    alternative: 3,
  },
  {
    id: "code",
    name: "Code execution & sandbox",
    description: "Run code in isolated sandboxes — Python REPLs, Docker exec, language servers.",
    matches: (t) =>
      t.category === "mcp_server" &&
      has(t, "sandbox", "execute", "repl", "interpreter", "code-run", "docker exec", "shell"),
    primary: 1,
    alternative: 3,
  },
  {
    id: "obs",
    name: "Observability & logs",
    description: "Surface logs, metrics, traces. Lets the agent debug what it built.",
    matches: (t) =>
      t.category === "mcp_server" &&
      has(t, "log", "metrics", "trace", "observability", "monitor", "datadog", "grafana", "prometheus"),
    primary: 1,
    alternative: 2,
  },
  {
    id: "plugin-core",
    name: "Claude Code plugins — slash commands & hooks",
    description: "Local-first conveniences inside Claude Code: review, ship, plan workflows.",
    matches: (t) =>
      t.category === "claude_plugin" &&
      has(t, "slash", "command", "review", "ship", "plan", "test", "lint", "format"),
    primary: 3,
    alternative: 4,
  },
  {
    id: "skills-method",
    name: "Method & process skills",
    description: "SKILL.md skills that codify workflows: TDD, debugging, documentation, code review.",
    matches: (t) =>
      t.category === "skill" &&
      has(t, "tdd", "debug", "test-driven", "review", "code review", "refactor", "documentation", "doc-", "doc ", "writing", "coaching"),
    primary: 3,
    alternative: 4,
  },
  {
    id: "skills-domain",
    name: "Domain skills",
    description: "Patterns for specific tech stacks: Rust async, Python typing, React patterns, infra.",
    matches: (t) =>
      t.category === "skill" &&
      !has(t, "test-driven", "tdd", "code review", "writing", "coaching") &&
      has(t, "python", "typescript", "rust", "react", "next", "react", "svelte", "go ", "kubernetes", "docker", "infra"),
    primary: 3,
    alternative: 4,
  },
  {
    id: "harness",
    name: "Coding-agent harnesses",
    description: "Long-running agentic loops that orchestrate Claude Code itself.",
    matches: (t) =>
      t.category === "harness",
    primary: 2,
    alternative: 3,
  },
];

function reasonFor(layer: StackLayerDef, t: Tool): string {
  const bits: string[] = [];
  if (t.grade?.letter) bits.push(`grade ${t.grade.letter}`);
  if (t.stars) bits.push(`${t.stars.toLocaleString()}★`);
  if (t.last_updated) {
    const days = Math.floor(
      (Date.now() - new Date(t.last_updated).getTime()) / 86400000
    );
    if (days < 30) bits.push("active in last 30d");
    else if (days < 180) bits.push(`updated ${days}d ago`);
  }
  if (t.compatibility === "mcp_ready") bits.push("MCP-ready");
  if (t.compatibility === "native_claude_code") bits.push("Claude-native");
  return bits.slice(0, 3).join(" · ");
}

/**
 * Sort key — higher is better.
 * Combines: grade.total (heavier), recency, stars (logarithmic).
 */
function score(t: Tool): number {
  const g = t.grade?.total ?? 0;
  const recencyBoost = (() => {
    if (!t.last_updated) return 0;
    const days = Math.max(0, (Date.now() - new Date(t.last_updated).getTime()) / 86400000);
    if (days < 30) return 2;
    if (days < 90) return 1;
    if (days < 365) return 0.5;
    return 0;
  })();
  const starsBoost = t.stars > 0 ? Math.log10(t.stars + 1) / 2 : 0;
  const compatBoost = t.compatibility === "mcp_ready" || t.compatibility === "native_claude_code" ? 1 : 0;
  return g + recencyBoost + starsBoost + compatBoost;
}

export function computeStack(tools: Tool[]): StackResult {
  // Filter to graded, non-dead tools (dead is already stripped at export time)
  const candidates = tools.filter((t) => t.grade);

  // Track tools we've already placed so they don't appear in two layers
  const placed = new Set<string>();
  const layers: StackLayer[] = [];

  for (const def of LAYERS) {
    const inLane = candidates.filter((t) => !placed.has(t.id) && def.matches(t));
    inLane.sort((a, b) => score(b) - score(a));

    const primary = inLane.slice(0, def.primary);
    const alternative = inLane.slice(def.primary, def.primary + def.alternative);
    for (const t of primary) placed.add(t.id);
    for (const t of alternative) placed.add(t.id);

    layers.push({
      def,
      primary: primary.map((t) => ({ tool: t, reason: reasonFor(def, t) })),
      alternative: alternative.map((t) => ({ tool: t, reason: reasonFor(def, t) })),
    });
  }

  return {
    layers,
    generatedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
  };
}
