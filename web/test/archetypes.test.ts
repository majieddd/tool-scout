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

describe("archetype detection: market-trader (stocks/crypto/prediction-markets/sports)", () => {
  const PROMPTS = [
    "I want to build an app that trades for me on the stock market",
    "Building an algorithmic trading bot for crypto",
    "Automated stock trader that buys and sells based on signals",
    "I'm building a forex trading app",
    // Prediction markets — the user-reported gap
    "An app that trades on kalshi for me",
    "Bot that bets on polymarket",
    "Build a manifold markets trader",
    // Sports betting & fantasy
    "An app that automates my fantasy football lineup",
    "Bot that places sports bets on DraftKings",
  ];
  for (const prompt of PROMPTS) {
    it(`detects market-trader for: "${prompt.slice(0, 50)}..."`, () => {
      const p = extractFromDescription(prompt);
      expect(p.archetype?.id).toBe("market-trader");
      expect(p.archetype?.technicalParts.length).toBeGreaterThan(5);
      expect(p.domains).toContain("financial");
      expect(p.domains).toContain("backend");
      // Most market-trading is Python
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
      expect(stack.archetype?.id).toBe("market-trader");
      expect(stack.archetype?.technicalParts.join("\n")).toMatch(
        /Market API integration|Alpaca|Kalshi|Polymarket/
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

describe("archetype detection: chat-platform-bot", () => {
  const PROMPTS = [
    "I want to build a discord bot for my server",
    "Build a slack bot for our team",
    "Telegram bot that replies to messages",
    "WhatsApp bot for my business",
    "I want to build a Reddit bot that posts daily summaries",
  ];
  for (const prompt of PROMPTS) {
    it(`detects chat-platform-bot for: "${prompt.slice(0, 50)}..."`, () => {
      const p = extractFromDescription(prompt);
      expect(p.archetype?.id).toBe("chat-platform-bot");
      expect(p.domains).toContain("automation");
    });
  }
});

describe("archetype detection: social-listener", () => {
  const PROMPTS = [
    "I want a bot that watches Twitter for keywords and DMs me",
    "Notify me when my name is mentioned on Reddit",
    "A keyword tracker for tweets",
  ];
  for (const prompt of PROMPTS) {
    it(`detects social-listener for: "${prompt.slice(0, 50)}..."`, () => {
      const p = extractFromDescription(prompt);
      expect(p.archetype?.id).toBe("social-listener");
      expect(p.domains).toContain("scraping");
    });
  }
});

describe("archetype detection: content-generator", () => {
  const PROMPTS = [
    "Build me a personal podcast generator from my notes",
    "An app that generates resumes from LinkedIn data",
    "I want to build a tool that summarizes YouTube videos",
    "A blog post generator from my writing notes",
    "Turn my meeting transcripts into newsletter articles",
  ];
  for (const prompt of PROMPTS) {
    it(`detects content-generator for: "${prompt.slice(0, 50)}..."`, () => {
      const p = extractFromDescription(prompt);
      expect(p.archetype?.id).toBe("content-generator");
      expect(p.domains).toContain("llm");
    });
  }
});

describe("archetype detection: voice-calling-agent", () => {
  const PROMPTS = [
    "I want an AI that calls businesses and books me appointments",
    "Build a phone agent that books restaurant reservations",
    "AI bot that makes phone calls on my behalf",
  ];
  for (const prompt of PROMPTS) {
    it(`detects voice-calling-agent for: "${prompt.slice(0, 50)}..."`, () => {
      const p = extractFromDescription(prompt);
      expect(p.archetype?.id).toBe("voice-calling-agent");
      expect(p.domains).toContain("voice-audio");
    });
  }
});

describe("archetype detection: recommendation-engine", () => {
  const PROMPTS = [
    "Build a meal planner that uses what's in my fridge",
    "An app that recommends restaurants based on my mood",
    "A workout recommender based on my fitness goals",
    "Movie recommendations based on my taste",
  ];
  for (const prompt of PROMPTS) {
    it(`detects recommendation-engine for: "${prompt.slice(0, 50)}..."`, () => {
      const p = extractFromDescription(prompt);
      expect(p.archetype?.id).toBe("recommendation-engine");
    });
  }
});

describe("archetype detection: SMB archetypes", () => {
  it("inbox-autoresponder: 'auto-respond to my Etsy customer messages'", () => {
    const p = extractFromDescription("Auto-respond to my Etsy customer messages with friendly replies");
    expect(p.archetype?.id).toBe("inbox-autoresponder");
  });
  it("inbox-autoresponder: 'follow up with leads who didn't reply'", () => {
    const p = extractFromDescription("Something that follows up with leads who didn't reply to my first email");
    expect(p.archetype?.id).toBe("inbox-autoresponder");
  });
  it("scheduled-publisher: 'posts to Instagram on a schedule'", () => {
    const p = extractFromDescription("An app that posts to my Instagram, TikTok, and Facebook on a schedule");
    expect(p.archetype?.id).toBe("scheduled-publisher");
  });
  it("scheduled-publisher: 'sends my newsletter every Tuesday'", () => {
    const p = extractFromDescription("Something that sends my newsletter every Tuesday from my Notion notes");
    expect(p.archetype?.id).toBe("scheduled-publisher");
  });
  it("lead-prospector: 'finds leads on LinkedIn'", () => {
    const p = extractFromDescription("Build something that finds leads on LinkedIn for me");
    expect(p.archetype?.id).toBe("lead-prospector");
  });
  it("booking-payment-app: 'appointment booking page where clients pay'", () => {
    const p = extractFromDescription("Build me an appointment booking page where clients pick a time and pay");
    expect(p.archetype?.id).toBe("booking-payment-app");
  });
});

describe("archetype detection: developer tooling archetypes", () => {
  it("ci-bot: 'auto-generates changelogs from PRs'", () => {
    const p = extractFromDescription("An app that auto-generates changelogs from merged PRs");
    expect(p.archetype?.id).toBe("ci-bot");
  });
  it("ci-bot: 'reviews my PRs'", () => {
    const p = extractFromDescription("A bot that reviews my PRs and leaves comments on style and security");
    expect(p.archetype?.id).toBe("ci-bot");
  });
  it("ci-bot: 'opens upgrade PRs for outdated deps' (and not goal=library!)", () => {
    const p = extractFromDescription("Tool that checks my package.json for outdated deps and opens upgrade PRs");
    expect(p.archetype?.id).toBe("ci-bot");
    // The library goal regex previously misfired on "package.json for outdated"
    expect(p.goal).not.toBe("library");
  });
  it("static-analysis-tool: 'find dead code'", () => {
    const p = extractFromDescription("Tool to find dead code in my Python repo");
    expect(p.archetype?.id).toBe("static-analysis-tool");
  });
  it("static-analysis-tool: 'pre-commit hook that scans for leaked API keys'", () => {
    const p = extractFromDescription("A pre-commit hook that scans for leaked API keys");
    expect(p.archetype?.id).toBe("static-analysis-tool");
  });
  it("infra-ops-tool: 'tails k8s logs'", () => {
    const p = extractFromDescription("CLI that tails logs from multiple Kubernetes pods");
    expect(p.archetype?.id).toBe("infra-ops-tool");
  });
  it("infra-ops-tool: 'Terraform drift'", () => {
    const p = extractFromDescription("A tool that detects drift between my Terraform state and AWS infra");
    expect(p.archetype?.id).toBe("infra-ops-tool");
  });
  it("infra-ops-tool: 'analyzes Docker images'", () => {
    const p = extractFromDescription("Tool that analyzes my Docker images and tells me which layers are bloated");
    expect(p.archetype?.id).toBe("infra-ops-tool");
  });
  it("db-tooling: 'diffs staging and prod Postgres'", () => {
    const p = extractFromDescription("A thing that diffs my staging and prod Postgres databases");
    expect(p.archetype?.id).toBe("db-tooling");
  });
  it("api-tooling: 'mock API server from OpenAPI spec'", () => {
    const p = extractFromDescription("Spins up a mock API server from my OpenAPI spec");
    expect(p.archetype?.id).toBe("api-tooling");
  });
  it("test-tooling: 'find flaky tests in Jest'", () => {
    const p = extractFromDescription("A bot that finds flaky tests in my Jest suite");
    expect(p.archetype?.id).toBe("test-tooling");
  });
});

describe("archetype detection: education", () => {
  it("study-aid-generator: 'flashcard generator from PDFs'", () => {
    const p = extractFromDescription("I want a flashcard generator from my lecture PDFs");
    expect(p.archetype?.id).toBe("study-aid-generator");
  });
});

describe("archetype detection: creative archetypes", () => {
  it("image-generator: 'turns doodles into pixel art'", () => {
    const p = extractFromDescription("An app that turns my doodles into pixel art using AI");
    expect(p.archetype?.id).toBe("image-generator");
  });
  it("music-tool: 'guitar tab from humming'", () => {
    const p = extractFromDescription("A guitar tab generator that takes a hummed melody and produces tabs");
    expect(p.archetype?.id).toBe("music-tool");
  });
  it("music-tool: 'chord-progression suggester'", () => {
    const p = extractFromDescription("Chord-progression suggester for songwriters");
    expect(p.archetype?.id).toBe("music-tool");
  });
  it("creative-coding: 'generative art piece'", () => {
    const p = extractFromDescription("Generative art piece that responds to live audio input");
    expect(p.archetype?.id).toBe("creative-coding");
  });
  it("game-mod: 'Minecraft mod with custom NPCs'", () => {
    const p = extractFromDescription("A Minecraft mod that adds custom NPCs with AI-driven dialogue");
    expect(p.archetype?.id).toBe("game-mod");
  });
  it("procedural-generator: 'roguelike dungeon generator'", () => {
    const p = extractFromDescription("An app that procedurally generates dungeon maps for my tabletop RPG sessions");
    expect(p.archetype?.id).toBe("procedural-generator");
  });
  it("creative-writing-assistant: 'fanfic co-writer'", () => {
    const p = extractFromDescription("A fanfiction co-writer that keeps track of my OC's lore and continuity");
    expect(p.archetype?.id).toBe("creative-writing-assistant");
  });
  it("creative-writing-assistant: 'D&D campaign notes drafter'", () => {
    const p = extractFromDescription("A tool that drafts D&D campaign notes from my session recordings");
    expect(p.archetype?.id).toBe("creative-writing-assistant");
  });
});

describe("archetype detection: extended pattern coverage", () => {
  it("scraper-tracker: 'monitors competitor pricing' (intervening word)", () => {
    const p = extractFromDescription("A tool that monitors competitor pricing across their websites");
    expect(p.archetype?.id).toBe("scraper-tracker");
  });
  it("scraper-tracker: 'DMs me when listing matches'", () => {
    const p = extractFromDescription("A tool that scrapes new listings on Zillow and DMs me when something matches my criteria");
    expect(p.archetype?.id).toBe("scraper-tracker");
  });
  it("content-generator: 'drafts contracts'", () => {
    const p = extractFromDescription("A tool that drafts contracts from my client intake notes");
    expect(p.archetype?.id).toBe("content-generator");
  });
  it("content-generator: 'listing description generator'", () => {
    const p = extractFromDescription("A tool that generates listing descriptions for my Airbnb properties");
    expect(p.archetype?.id).toBe("content-generator");
  });
  it("content-generator: 'quoting tool that generates pricing PDFs'", () => {
    const p = extractFromDescription("A quoting tool that takes job specs and generates pricing PDFs");
    expect(p.archetype?.id).toBe("content-generator");
  });
  it("recommendation-engine: 'tracks macros and adjusts workout'", () => {
    const p = extractFromDescription("A tool that tracks my macros and adjusts my workout for the week");
    expect(p.archetype?.id).toBe("recommendation-engine");
  });
  it("recommendation-engine: 'plans my trip itinerary based on interests'", () => {
    const p = extractFromDescription("A tool that plans my trip itinerary based on my interests and budget");
    expect(p.archetype?.id).toBe("recommendation-engine");
  });
});

describe("archetype detection: generic-automation fallback", () => {
  it("catches 'an app that does X for me' when no specific archetype matched", () => {
    // A prompt that doesn't fit any specific archetype should still get
    // the generic-automation fallback so the user gets *some* breakdown.
    const p = extractFromDescription("Build me an app that organizes my email and prioritizes it");
    expect(p.archetype?.id).toBe("generic-automation-app");
    expect(p.domains).toContain("automation");
  });

  it("specific archetypes still beat the fallback", () => {
    // The generic fallback must NOT take precedence over specific patterns.
    const p1 = extractFromDescription("An app that trades on kalshi for me");
    expect(p1.archetype?.id).toBe("market-trader");

    const p2 = extractFromDescription("I want to build a discord bot for my server");
    expect(p2.archetype?.id).toBe("chat-platform-bot");
  });
});
