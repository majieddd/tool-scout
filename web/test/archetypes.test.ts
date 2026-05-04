/**
 * Archetype-detection invariants — encodes the "goal-oriented prompt"
 * gap the user flagged: prompts like "I want to build an app that trades
 * for me on the stock market" used to yield empty stacks because no
 * technology was named. The architect now decomposes them into archetypes
 * with technical-part breakdowns and inferred signals.
 */
import { describe, it, expect } from "vitest";
import { extractFromDescription } from "@/lib/architect";
import fs from "node:fs";
import path from "node:path";
import { composeStack } from "@/lib/stack-builder";
import type { Tool } from "@/lib/data";

const CATALOG_PATH = path.resolve(__dirname, "../public/data/tools.json");
const haveCatalog = fs.existsSync(CATALOG_PATH);

describe("archetype detection: stock-trading-app", () => {
  const PROMPTS = [
    "I want to build an app that trades for me on the stock market",
    "Building an algorithmic trading bot for crypto",
    "Automated stock trader that buys and sells based on signals",
    "I'm building a forex trading app",
  ];
  for (const prompt of PROMPTS) {
    it(`detects stock-trading-app for: "${prompt.slice(0, 50)}..."`, () => {
      const p = extractFromDescription(prompt);
      expect(p.archetype?.id).toBe("stock-trading-app");
      // Archetype should have populated technical breakdown
      expect(p.archetype?.technicalParts.length).toBeGreaterThan(5);
      // Inferred domains should fill in the gaps
      expect(p.domains).toContain("financial");
      expect(p.domains).toContain("backend");
      // Language should be inferred as Python (most algo trading is Python)
      expect(p.primaryLanguage).toBe("python");
    });
  }
});

describe("archetype detection: rag-chatbot", () => {
  const PROMPTS = [
    "I want a chatbot for our company documents",
    "Build a RAG-based assistant over our wiki",
    "A way to chat with my PDFs",
    "Building a retrieval-augmented assistant for internal docs",
  ];
  for (const prompt of PROMPTS) {
    it(`detects rag-chatbot for: "${prompt.slice(0, 50)}..."`, () => {
      const p = extractFromDescription(prompt);
      expect(p.archetype?.id).toBe("rag-chatbot");
      expect(p.domains).toContain("embeddings-rag");
      expect(p.domains).toContain("llm");
    });
  }
});

describe("archetype detection: scraper-tracker", () => {
  it("detects scraper-tracker from 'price tracker'", () => {
    const p = extractFromDescription("I want a price tracker that watches Amazon listings");
    expect(p.archetype?.id).toBe("scraper-tracker");
    expect(p.domains).toContain("scraping");
    expect(p.frameworks.has("playwright")).toBe(true);
  });

  it("detects from 'monitor websites and notify me'", () => {
    const p = extractFromDescription("Monitor websites and notify me when prices change");
    expect(p.archetype?.id).toBe("scraper-tracker");
  });
});

describe("archetype detection: ai-agent-app", () => {
  it("detects autonomous agent", () => {
    const p = extractFromDescription("I want to build an autonomous agent that does research");
    expect(p.archetype?.id).toBe("ai-agent-app");
    expect(p.domains).toContain("agent-orchestration");
  });
});

describe("archetype detection: social-app", () => {
  it("detects social platform", () => {
    const p = extractFromDescription("Building a social network for indie developers");
    expect(p.archetype?.id).toBe("social-app");
    expect(p.primaryLanguage).toBe("typescript");
    expect(p.domains).toContain("auth");
  });
});

describe("archetype detection: voice-assistant", () => {
  it("detects voice assistant", () => {
    const p = extractFromDescription("I want to build a voice assistant for my smart home");
    expect(p.archetype?.id).toBe("voice-assistant");
    expect(p.domains).toContain("voice-audio");
  });
});

describe("archetype-driven composition: trading prompt produces a real stack", () => {
  it.skipIf(!haveCatalog)(
    "the canonical trading prompt no longer returns 0 picks",
    () => {
      const tools: Tool[] = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
      const profile = extractFromDescription(
        "I want to build an app that trades for me on the stock market"
      );
      const stack = composeStack(tools, profile);
      // Archetype must surface in the output for the UI to render
      expect(stack.archetype?.id).toBe("stock-trading-app");
      expect(stack.archetype?.technicalParts).toContain(
        "Brokerage API integration (Alpaca, Interactive Brokers, Tradier, etc.)"
      );
      // Stack should now have real picks driven by inferred domains/lang
      expect(stack.totalPrimaryCount).toBeGreaterThan(0);
      // Should NOT pick a C# MCP SDK (the previous broken behavior)
      const allNames = stack.layers
        .flatMap((l) => l.primary)
        .map((p) => p.tool.name?.toLowerCase() || "");
      for (const n of allNames) {
        expect(n).not.toMatch(/csharp-sdk/);
      }
    }
  );
});

describe("archetype is null when prompt is fully technical (no archetype hint)", () => {
  it("'Python MCP server for Postgres' has no archetype (the prompt is already concrete)", () => {
    const p = extractFromDescription(
      "Python MCP server for Postgres on Windows with TDD"
    );
    expect(p.archetype).toBeNull();
  });
});

describe("archetype is null for fully vague prompts (no archetype matches)", () => {
  it("'I want to build something cool' has no archetype", () => {
    const p = extractFromDescription("I want to build something cool with AI");
    expect(p.archetype).toBeNull();
  });
});
