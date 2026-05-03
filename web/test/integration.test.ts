/**
 * Integration test against the real public/data/tools.json.
 *
 * This catches the failure mode where the synthetic fixture passes but
 * the real catalog produces nonsense — usually because the catalog has
 * tools we didn't include in the fixture that game the score function.
 *
 * If the catalog isn't checked in (e.g. a fresh clone with no crawl yet),
 * the test is skipped rather than hard-failing.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractFromDescription } from "@/lib/architect";
import { composeStack } from "@/lib/stack-builder";
import type { Tool } from "@/lib/data";

const CATALOG_PATH = path.resolve(__dirname, "../public/data/tools.json");

const PROMPT =
  "I'm building a Claude Code MCP server in Python that lets the agent query our Postgres database with row-level auth. Running on Windows 11 with Docker. I want test-driven development.";

const haveCatalog = fs.existsSync(CATALOG_PATH);

describe.skipIf(!haveCatalog)("integration: real catalog (Python+Postgres+TDD)", () => {
  const tools: Tool[] = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const profile = extractFromDescription(PROMPT);
  const stack = composeStack(tools, profile);
  const allPicks = stack.layers.flatMap((l) => l.primary);
  const allAlts = stack.layers.flatMap((l) => l.alternatives);
  const all = [...allPicks, ...allAlts];

  it("catalog loads with at least 100 graded tools", () => {
    const graded = tools.filter((t) => t.grade);
    expect(graded.length).toBeGreaterThanOrEqual(100);
  });

  it("detects python primary language from this prompt", () => {
    expect(profile.primaryLanguage).toBe("python");
  });

  it("does NOT surface XHS-Downloader (the v1 noise pick)", () => {
    expect(all.find((p) => p.tool.name?.includes("XHS-Downloader"))).toBeUndefined();
  });

  it("does NOT surface mcp-use as the SDK pick (TypeScript for a Python project)", () => {
    const sdk = stack.layers.find((l) => l.id === "sdk-runtime");
    expect(sdk?.primary[0]?.tool.name).not.toMatch(/^mcp-use\//);
  });

  it("SDK pick is Python-flavored", () => {
    const sdk = stack.layers.find((l) => l.id === "sdk-runtime");
    if (sdk?.primary[0]) {
      const t = sdk.primary[0].tool;
      // Either the language is Python, the name contains 'fastmcp' or 'py', or both
      const looksPythonic =
        t.language?.toLowerCase() === "python" ||
        /fastmcp|py(?:thon)?/i.test(t.name || "");
      expect(looksPythonic).toBe(true);
    }
  });

  it("data-layer pick is Postgres-specific (name or description mentions postgres)", () => {
    const data = stack.layers.find((l) => l.id === "data-storage");
    if (data?.primary[0]) {
      const t = data.primary[0].tool;
      const hayName = (t.name || "").toLowerCase();
      const hayDesc = (t.description || "").toLowerCase();
      expect(
        /postgres|pg-|postgresql|supabase|timescale/.test(hayName) ||
          /postgres|postgresql/.test(hayDesc),
      ).toBe(true);
    }
  });

  it("method-skill pick is TDD-flavored when project asks for TDD", () => {
    const ms = stack.layers.find((l) => l.id === "method-skill");
    if (ms?.primary[0]) {
      const t = ms.primary[0].tool;
      const tddNamed = /tdd|test-driven|test-guard/.test((t.name || "").toLowerCase());
      const tddDesc = /\b(tdd|test[\s-]?driven)\b/i.test(t.description || "");
      expect(tddNamed || tddDesc).toBe(true);
    }
  });

  it("never picks an agent harness as a 'Claude QoL plugin'", () => {
    const plugin = stack.layers.find((l) => l.id === "agent-plugin");
    if (plugin?.primary[0]) {
      const t = plugin.primary[0].tool;
      expect(t.category).not.toBe("harness");
    }
  });

  it("hard cap of 15 picks is respected", () => {
    expect(stack.totalPrimaryCount).toBeLessThanOrEqual(15);
  });
});

describe.skipIf(!haveCatalog)("integration: TypeScript+Cursor prompt", () => {
  const tools: Tool[] = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const profile = extractFromDescription(
    "I'm building a Cursor extension in TypeScript with .cursorrules for a Next.js codebase. Running on macOS.",
  );
  const stack = composeStack(tools, profile);

  it("detects target as cursor", () => {
    expect(profile.targetAgent).toBe("cursor");
  });

  it("detects TypeScript primary language", () => {
    expect(profile.primaryLanguage).toBe("typescript");
  });

  it("detects platform as macos", () => {
    expect(profile.platform).toBe("macos");
  });

  it("composes some non-empty stack", () => {
    expect(stack.totalPrimaryCount).toBeGreaterThan(0);
  });
});

describe.skipIf(!haveCatalog)("integration: vague prompt", () => {
  const tools: Tool[] = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const profile = extractFromDescription("I want to build something");
  const stack = composeStack(tools, profile);

  it("targetAgent is unknown", () => {
    expect(profile.targetAgent).toBe("unknown");
  });

  it("does not over-pick — vague prompts produce few or zero picks", () => {
    expect(stack.totalPrimaryCount).toBeLessThanOrEqual(5);
  });
});
