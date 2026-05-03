/**
 * Matcher — score catalog tools against a ProjectProfile.
 *
 * Scoring (per tool):
 *   tag overlap  : up to ~6 pts (3 / lang match, 2 / framework match, 1 / keyword)
 *   category fit : up to ~3 pts (e.g. project mentions database -> mcp_server bonus)
 *   grade boost  : up to ~2 pts (grade.total / 12)
 *   compat boost : up to ~1 pt  (mcp_ready / native_claude_code preferred)
 *   dead penalty : -10
 *
 * Returns a list sorted by descending score with per-pick reasoning chips.
 */
import type { ProjectProfile } from "./analyze";
import { profileToTags } from "./analyze";
import type { Tool } from "./data";

export type Match = {
  tool: Tool;
  score: number;
  reasons: string[];
};

const CATEGORY_KEYWORD_BOOST: Record<string, string[]> = {
  // category -> keywords that, if present in profile, boost that category's tools
  mcp_server: ["mcp", "claude-code", "anthropic", "agent"],
  claude_plugin: ["claude-code", "anthropic", "plugin", "slash"],
  skill: ["skill", "claude-code"],
  harness: ["agent", "agentic", "llm", "orchestration"],
  tool: ["cli", "automation", "script"],
  library: ["library", "sdk"],
};

export function scoreTool(tool: Tool, p: ProjectProfile): Match {
  const reasons: string[] = [];
  let score = 0;

  const projectTags = profileToTags(p);
  const toolTags = new Set((tool.tags || []).map((t) => t.toLowerCase()));

  // 1. Direct tag overlap
  const overlap: string[] = [];
  for (const tag of projectTags) {
    if (toolTags.has(tag)) overlap.push(tag);
  }
  if (overlap.length) {
    const weighted = overlap.reduce((acc, tag) => {
      // Languages weighted higher
      const isLang = ["python", "typescript", "javascript", "rust", "go", "ruby", "java"].includes(tag);
      const isFw = p.frameworks.has(tag);
      return acc + (isLang ? 3 : isFw ? 2 : 1);
    }, 0);
    score += Math.min(weighted, 8);
    reasons.push(`tag overlap: ${overlap.slice(0, 4).join(", ")}`);
  }

  // 2. Category fit by keyword
  if (tool.category) {
    const boostKws = CATEGORY_KEYWORD_BOOST[tool.category] || [];
    const hits = boostKws.filter((k) => p.keywords.has(k) || projectTags.has(k));
    if (hits.length) {
      score += Math.min(hits.length * 1.5, 3);
      reasons.push(`category fit: ${tool.category} (${hits.join("+")})`);
    }
  }

  // 3. Language match against tool.language field
  if (tool.language && p.primaryLanguage) {
    const tlang = tool.language.toLowerCase();
    if (tlang === p.primaryLanguage) {
      score += 2;
      reasons.push(`same language: ${tool.language}`);
    }
  }

  // 4. Name / description keyword scan (lightweight)
  const haystack = ((tool.name || "") + " " + (tool.description || "")).toLowerCase();
  const namedHits: string[] = [];
  for (const kw of p.keywords) {
    if (kw.length >= 5 && haystack.includes(kw)) namedHits.push(kw);
  }
  if (namedHits.length) {
    score += Math.min(namedHits.length * 0.5, 2);
    if (namedHits.length <= 3) reasons.push(`mentioned: ${namedHits.join(", ")}`);
    else reasons.push(`${namedHits.length} keyword matches`);
  }

  // 5. Grade boost
  if (tool.grade?.total) {
    score += tool.grade.total / 12;
  }

  // 6. Compatibility boost — Claude-ready tools are immediately useful
  if (tool.compatibility === "mcp_ready" || tool.compatibility === "native_claude_code") {
    score += 1;
  } else if (tool.compatibility === "incompatible") {
    score -= 5;
  }

  // 7. Dead / muted penalty
  // dead is a flag we don't carry into tools.json (filtered out at export).

  return { tool, score: Math.round(score * 100) / 100, reasons };
}

export function rankMatches(
  tools: Tool[],
  profile: ProjectProfile,
  count: number = 12
): Match[] {
  // Don't bother scoring tools without a grade — they're noise
  const candidates = tools.filter((t) => t.grade);
  const scored = candidates.map((t) => scoreTool(t, profile));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((m) => m.score > 0.5).slice(0, count);
}
