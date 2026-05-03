/**
 * Scenario harness — runs the architect against the real catalog for a
 * curated set of diverse prompts and writes structured JSON dumps to
 * `web/test/scenarios/<id>-output.json` for parallel-agent review.
 *
 * This is NOT a regression-test file (no assertions). It exists to produce
 * inspectable artifacts that human or agent reviewers can audit. The
 * results inform what new vitest invariants we add to stack-builder.test.ts.
 *
 * Run with:  npm test -- scenarios.dump
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractFromDescription } from "@/lib/architect";
import { composeStack } from "@/lib/stack-builder";
import type { Tool } from "@/lib/data";

const CATALOG_PATH = path.resolve(__dirname, "../public/data/tools.json");
const OUT_DIR = path.resolve(__dirname, "scenarios");

type Scenario = {
  id: string;
  title: string;
  prompt: string;
  expectedNotes: string;
};

const SCENARIOS: Scenario[] = [
  {
    id: "01-python-postgres-claude-tdd",
    title: "Python + Postgres + Claude Code + Windows + TDD (canonical baseline)",
    prompt:
      "I'm building a Claude Code MCP server in Python that lets the agent query our Postgres database with row-level auth. Running on Windows 11 with Docker. I want test-driven development.",
    expectedNotes:
      "Should pick: fastmcp (SDK), Python FS MCP, Git MCP, pg-aiguide or similar Postgres-named tool (Data), fastapi_mcp or auth tool (Auth), python-notebook-mcp or similar (Code-exec), tdd-guard (Method), Pith or similar real plugin (Plugin). Should NOT pick: XHS-Downloader, mcp-use, claude-plugins-official, harnesses, off-topic skills.",
  },
  {
    id: "02-typescript-cursor-nextjs",
    title: "TypeScript + Next.js + Cursor extension on macOS",
    prompt:
      "I'm building a Cursor extension in TypeScript with .cursorrules for a Next.js codebase that ships to Vercel. Running on macOS Sequoia. I want fast iteration and code review.",
    expectedNotes:
      "Target should be 'cursor', language 'typescript', platform 'macos'. SDK should be TS-flavored (NOT Python fastmcp). Method skill should pick a code-review tool. Should NOT pick Python-only tools as primary anywhere.",
  },
  {
    id: "03-rust-codex-cli-linux",
    title: "Rust system utility wrapping ripgrep for Codex CLI on Linux",
    prompt:
      "I'm building an OpenAI Codex extension in Rust that wraps the ripgrep CLI for fast project-wide search. Running on Linux Ubuntu 24.04.",
    expectedNotes:
      "Target should be 'codex-cli', language 'rust', platform 'linux'. SDK layer might be skipped if no Rust MCP SDK exists. Goal should be wrap_cli. Should NOT pick TS or Python tools as primary SDK without language-mismatch warning.",
  },
  {
    id: "04-go-grpc-microservice-claude",
    title: "Go + gRPC microservice with observability + Docker on WSL",
    prompt:
      "I'm building a Go gRPC microservice for Claude Code, with Datadog observability, structured logs, distributed tracing, deployed via Docker Compose. Running on WSL2 Ubuntu.",
    expectedNotes:
      "Language 'go', platform 'wsl', target 'claude-code'. Domains should include observability + docker. Observability layer should populate (Datadog/Grafana/Prometheus tools). Code-exec layer may apply (Docker). Should NOT pick generic chat-clone apps.",
  },
  {
    id: "05-playwright-cline-scraper",
    title: "Browser automation + Playwright + Cline on macOS",
    prompt:
      "Cline-based scraper using Playwright in TypeScript. Scrapes news sites for sentiment analysis. Stores results in SQLite. macOS Sonoma.",
    expectedNotes:
      "Target 'cline', language 'typescript', platform 'macos'. Domains: scraping + browser-automation + database. Web-API layer should populate with Playwright/browser MCP. Data layer should pick SQLite tool.",
  },
  {
    id: "06-skill-author-claude-desktop",
    title: "Skill author building a SKILL.md skill for Claude Desktop",
    prompt:
      "I'm authoring a Claude Code skill (SKILL.md) that codifies my code-review workflow. No external dependencies, just the skill markdown. Will install into ~/.claude/skills.",
    expectedNotes:
      "Goal 'build_skill', target 'claude-code' or 'claude-desktop'. Most server-y layers (FS, Git, Data, Code-exec) should be skipped. Method-skill layer might surface code-review skills. Should NOT pick MCP servers as primary anywhere.",
  },
  {
    id: "07-aider-django-postgres",
    title: "Aider + Python + Django + Postgres on Linux",
    prompt:
      "Building a Django web app with Postgres backend. Using Aider for AI pair programming. Linux Ubuntu. Need migrations, ORM tooling, and good test coverage.",
    expectedNotes:
      "Target 'aider', language 'python', platform 'linux'. Domains: database (postgres), backend, testing. Data layer should pick Postgres-specific. Method-skill should surface a test workflow. Aider has a different ecosystem than Claude — picks should be MCP-compatible since Aider can use them.",
  },
  {
    id: "08-mobile-react-native-continue",
    title: "Mobile React Native app with Continue on macOS targeting iOS",
    prompt:
      "React Native mobile app for iOS and Android. Using Continue.dev as the AI coding assistant. macOS development. Backend hits a Firebase API. Need accessibility testing and crash reporting.",
    expectedNotes:
      "Target 'continue', language 'typescript', platform 'macos'. Most MCP server layers should be irrelevant. Web-API may apply (Firebase). Should NOT over-pick — mobile apps don't need most MCP tooling. Tight stack is fine.",
  },
  {
    id: "09-vague-prompt",
    title: "Vague: 'I want to build something cool with AI'",
    prompt: "I want to build something cool with AI, maybe an agent or tool.",
    expectedNotes:
      "No language, no platform, no clear target agent. targetAgent should be 'unknown'. Stack should be small (≤5 picks). Most layers should be skipped due to no signal. The architect must NOT hallucinate a stack from nothing.",
  },
  {
    id: "10-solidity-cursor-hardhat",
    title: "Solidity + Hardhat + Cursor for DeFi smart contracts on Linux",
    prompt:
      "Building a DeFi lending protocol in Solidity with Hardhat and Foundry for testing. Using Cursor IDE on Linux. Need security audit tooling, formal verification, and gas optimization.",
    expectedNotes:
      "Language 'solidity' (or fall through). Target 'cursor'. Frameworks: hardhat, foundry. Most generic MCP server layers may be skipped. Method-skill might pick security-audit/review tooling. Should NOT pick unrelated tools just because they're popular.",
  },
];

const haveCatalog = fs.existsSync(CATALOG_PATH);

describe.skipIf(!haveCatalog)("scenarios dump", () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const tools: Tool[] = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));

  for (const sc of SCENARIOS) {
    it(`${sc.id} — ${sc.title}`, () => {
      const profile = extractFromDescription(sc.prompt);
      const stack = composeStack(tools, profile);

      // Slim each pick to the fields a reviewer needs (avoid bloating the dump
      // with unused tool fields like readme_excerpt).
      const slim = (p: { tool: Tool; reason: string; score: number; layerId: string }) => ({
        tool_id: p.tool.id,
        name: p.tool.name,
        url: p.tool.url,
        category: p.tool.category,
        subcategory: p.tool.subcategory,
        language: p.tool.language,
        stars: p.tool.stars,
        description: p.tool.description?.slice(0, 240),
        compatibility: p.tool.compatibility,
        grade_letter: p.tool.grade?.letter,
        grade_total: p.tool.grade?.total,
        score: p.score,
        reason: p.reason,
      });

      const dump = {
        scenario_id: sc.id,
        title: sc.title,
        prompt: sc.prompt,
        expected_notes: sc.expectedNotes,
        catalog_size: tools.length,
        profile: {
          targetAgent: profile.targetAgent,
          primaryLanguage: profile.primaryLanguage,
          platform: profile.platform,
          goal: profile.goal,
          domains: profile.domains,
          frameworks: [...profile.frameworks],
          hasTests: profile.hasTests,
          hasDocker: profile.hasDocker,
          hasMcp: profile.hasMcp,
          hasCI: profile.hasCI,
          tokens: [...profile.tokens].sort(),
          description: profile.description,
        },
        composed: {
          totalPrimaryCount: stack.totalPrimaryCount,
          generatedAt: stack.generatedAt,
          skipped: stack.skipped,
          layers: stack.layers.map((l) => ({
            id: l.id,
            name: l.name,
            description: l.description,
            primary: l.primary.map(slim),
            alternatives: l.alternatives.map(slim),
          })),
        },
      };

      const outPath = path.join(OUT_DIR, `${sc.id}-output.json`);
      fs.writeFileSync(outPath, JSON.stringify(dump, null, 2), "utf8");
      // Sanity: the dump file got written
      expect(fs.existsSync(outPath)).toBe(true);
    });
  }
});
