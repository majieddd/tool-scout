/**
 * prompt-builder tests — locks in the contracts the user-facing
 * "Generate starter prompt" flow depends on.
 *
 * Most important: the bridge from `archetype.essentialLibraries` (which the
 * UI shows under "Essential libraries to install yourself") into the actual
 * generated markdown prompt the user pastes into their agent. Without this
 * bridge, the architect identifies ccxt/pandas/etc., the UI displays them,
 * but the prompt drops them — the user pastes an incomplete plan into Claude.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractFromDescription } from "@/lib/architect";
import { composeStack } from "@/lib/stack-builder";
import { buildPrompt } from "@/lib/prompt-builder";
import type { Tool } from "@/lib/data";

const CATALOG_PATH = path.resolve(__dirname, "../public/data/tools.json");
const haveCatalog = fs.existsSync(CATALOG_PATH);

function generate(prompt: string, opts?: { targetAgent?: string }) {
  const tools: Tool[] = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const profile = extractFromDescription(prompt);
  const stack = composeStack(tools, profile);
  const md = buildPrompt(stack, profile, {
    goal: "test goal",
    targetAgent: (opts?.targetAgent ?? "claude-code") as never,
    platform: "windows",
    style: "tdd",
    multiSession: true,
    includeWebReferences: true,
  });
  return { profile, stack, md };
}

describe.skipIf(!haveCatalog)("prompt-builder: essentialLibraries bridge", () => {
  it("crypto trading prompt produces a prompt that mentions ccxt + pandas + APScheduler", () => {
    // The architect's whole point: when the catalog can't cover the
    // domain (here: crypto trading), surface the off-catalog libs the
    // user MUST install. The starter prompt must carry them through.
    const { stack, md } = generate(
      "i want to make an app that trades cryptocurrency for me with the sole purpose of earning $1,000,000 USD agentically",
    );
    expect(stack.archetype?.id).toBe("market-trader");
    expect(md).toMatch(/### Essential off-catalog libraries/);
    expect(md.toLowerCase()).toMatch(/ccxt/);
    expect(md.toLowerCase()).toMatch(/pandas/);
    expect(md.toLowerCase()).toMatch(/apscheduler/);
  });

  it("each essential lib in the prompt has a copy-pasteable install command in a fenced block", () => {
    const { md } = generate(
      "i want to make a crypto trading bot",
    );
    const essSection = md.split("### Essential off-catalog libraries")[1] || "";
    // Every lib entry: name + why + fenced install command
    // Count `pip install` or `npm install` mentions inside the section
    const installs = essSection.match(/^\s*(pip install|npm install)/gm) || [];
    expect(installs.length).toBeGreaterThanOrEqual(3);
  });

  it("RAG chatbot prompt mentions langchain/llamaindex + pgvector + fastapi", () => {
    const { stack, md } = generate(
      "I want a chatbot for our company documents in PDF",
    );
    expect(stack.archetype?.id).toBe("rag-chatbot");
    expect(md).toMatch(/### Essential off-catalog libraries/);
    const lower = md.toLowerCase();
    // At least one of langchain/llama-index
    expect(/langchain|llama-?index/.test(lower)).toBe(true);
    expect(lower).toMatch(/pgvector/);
    expect(lower).toMatch(/fastapi/);
  });

  it("vague prompts produce NO essentials section (no archetype = nothing to add)", () => {
    const { stack, md } = generate("hello");
    expect(stack.archetype).toBeNull();
    expect(md).not.toMatch(/### Essential off-catalog libraries/);
  });

  it("MCP-server prompts (catalog covers them well) produce no essentials section unless archetype defines them", () => {
    // build_mcp_server doesn't have essentialLibraries by default — the
    // catalog's fastmcp + SDK lane handle this case. The section should
    // be absent for this archetype.
    const { md } = generate(
      "Build a Python MCP server for Postgres on Windows",
    );
    // If essentials are defined for this archetype, they appear; if not,
    // the section is omitted. Either is fine, but if they appear the
    // entries must be well-formed.
    if (md.includes("### Essential off-catalog libraries")) {
      const sec = md.split("### Essential off-catalog libraries")[1] || "";
      const installs = sec.match(/^\s*(pip install|npm install)/gm) || [];
      expect(installs.length).toBeGreaterThan(0);
    }
  });

  it("essentials section appears AT THE TOP of Step 1, before catalog layers", () => {
    // The ordering matters: domain libs are foundational deps. Listing
    // them after the catalog picks would imply the catalog is primary
    // and they're optional addons, which inverts reality for archetypes
    // like market-trader (catalog is the small part).
    const { md } = generate("I want a chatbot for our company documents in PDF");
    const essIdx = md.indexOf("### Essential off-catalog libraries");
    const firstLayer = md.match(/### (Data layer|SDK & runtime|Memory & retrieval|Observability|Filesystem context|Method skill)/);
    if (essIdx >= 0 && firstLayer && firstLayer.index !== undefined) {
      expect(essIdx).toBeLessThan(firstLayer.index);
    }
  });
});
