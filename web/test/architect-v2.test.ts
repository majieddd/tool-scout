/**
 * Architect v2 invariants — encodes every regression uncovered by the
 * 10-scenario audit (2026-05-03). Each test corresponds to a real bug
 * found by an independent reviewer, and is named after the symptom.
 *
 * If any of these fail, the architect has degraded back to a state that
 * users complained about. CI will block the deploy.
 */
import { describe, it, expect } from "vitest";
import { extractFromDescription } from "@/lib/architect";

describe("architect-v2: framework detection from description text", () => {
  it("Django prompt populates frameworks AND infers Python language", () => {
    const p = extractFromDescription("Building a Django web app with Postgres backend.");
    expect(p.frameworks.has("django")).toBe(true);
    expect(p.primaryLanguage).toBe("python");
  });

  it("React Native prompt populates frameworks AND infers TypeScript", () => {
    const p = extractFromDescription("React Native mobile app for iOS and Android.");
    expect(p.frameworks.has("react-native")).toBe(true);
    expect(p.primaryLanguage).toBe("typescript");
  });

  it("Hardhat + Foundry populate frameworks AND infer Solidity", () => {
    const p = extractFromDescription("DeFi protocol with Hardhat and Foundry for testing.");
    expect(p.frameworks.has("hardhat")).toBe(true);
    expect(p.frameworks.has("foundry")).toBe(true);
    expect(p.primaryLanguage).toBe("solidity");
  });

  it("Next.js (with the dot) is detected as a framework AND a frontend domain", () => {
    const p = extractFromDescription("Next.js codebase that ships to Vercel.");
    expect(p.frameworks.has("nextjs")).toBe(true);
    expect(p.domains).toContain("frontend");
  });

  it("Playwright is detected as a framework token", () => {
    const p = extractFromDescription("Cline-based scraper using Playwright in TypeScript.");
    expect(p.frameworks.has("playwright")).toBe(true);
  });
});

describe("architect-v2: language detection robustness", () => {
  it("detects Go from 'Go gRPC microservice' (no longer requires 'golang' or 'go module')", () => {
    const p = extractFromDescription("Building a Go gRPC microservice for Claude Code.");
    expect(p.primaryLanguage).toBe("go");
  });

  it("detects Solidity (was missing entirely)", () => {
    const p = extractFromDescription("Building a DeFi lending protocol in Solidity.");
    expect(p.primaryLanguage).toBe("solidity");
  });

  it("detects Dart from 'Flutter'", () => {
    const p = extractFromDescription("Cross-platform mobile app in Flutter.");
    expect(p.primaryLanguage).toBe("dart");
  });
});

describe("architect-v2: hasTests detection breadth", () => {
  it("matches 'test coverage' (not just 'tests' or 'testing')", () => {
    expect(extractFromDescription("Need good test coverage").hasTests).toBe(true);
  });

  it("matches 'unit tests'", () => {
    expect(extractFromDescription("Want unit tests for every function").hasTests).toBe(true);
  });

  it("matches 'pytest'", () => {
    expect(extractFromDescription("Use pytest for testing").hasTests).toBe(true);
  });

  it("matches 'e2e tests'", () => {
    expect(extractFromDescription("Add e2e tests with Playwright").hasTests).toBe(true);
  });
});

describe("architect-v2: goal detection breadth", () => {
  it("detects wrap_cli from 'wraps the ripgrep CLI'", () => {
    const p = extractFromDescription("Building an extension that wraps the ripgrep CLI for fast project-wide search.");
    expect(p.goal).toBe("wrap_cli");
  });

  it("detects build_extension from 'Cursor extension'", () => {
    const p = extractFromDescription("Building a Cursor extension in TypeScript with .cursorrules.");
    expect(p.goal).toBe("build_extension");
  });

  it("detects data_pipeline from 'scrapes news sites... stores results in SQLite'", () => {
    const p = extractFromDescription("Scrapes news sites for sentiment analysis. Stores results in SQLite.");
    expect(p.goal).toBe("data_pipeline");
  });
});

describe("architect-v2: domain detection breadth", () => {
  it("detects 'project-wide search' as the search domain (not just 'search engine')", () => {
    const p = extractFromDescription("Fast project-wide search across files.");
    expect(p.domains).toContain("search");
  });

  it("detects blockchain domain from 'DeFi' / 'smart contracts' / 'Hardhat'", () => {
    const p = extractFromDescription("DeFi lending protocol in Solidity with Hardhat.");
    expect(p.domains).toContain("blockchain");
  });

  it("detects mobile domain from 'iOS' / 'Android' / 'React Native'", () => {
    const p = extractFromDescription("React Native mobile app for iOS and Android.");
    expect(p.domains).toContain("mobile");
  });

  it("detects accessibility domain", () => {
    const p = extractFromDescription("Need accessibility testing with axe-core.");
    expect(p.domains).toContain("accessibility");
  });

  it("crash reporting maps to observability", () => {
    const p = extractFromDescription("Need crash reporting and Sentry for the mobile app.");
    expect(p.domains).toContain("observability");
  });

  it("Playwright alone does NOT trigger the testing domain (it's dual-use)", () => {
    const p = extractFromDescription("Scraper using Playwright to scrape news sites.");
    expect(p.domains).not.toContain("testing");
    // browser-automation should still fire
    expect(p.domains).toContain("browser-automation");
  });
});

describe("architect-v2: tokens populated correctly", () => {
  it("includes detected frameworks in tokens (so framework-name boost can fire)", () => {
    const p = extractFromDescription("Cline-based scraper using Playwright in TypeScript.");
    expect(p.tokens.has("playwright")).toBe(true);
  });

  it("includes 'mcp' / 'tdd' / 'code-review' in tokens when mentioned", () => {
    const p = extractFromDescription("Building an MCP server with TDD and code review.");
    expect(p.tokens.has("mcp")).toBe(true);
    expect(p.tokens.has("tdd")).toBe(true);
    expect(p.tokens.has("code-review")).toBe(true);
  });
});

describe("architect-v2: deployTarget separated from platform", () => {
  it("macOS dev host + iOS target → platform=macos, deployTarget=mobile", () => {
    const p = extractFromDescription("React Native mobile app for iOS. Develop on macOS.");
    expect(p.platform).toBe("macos");
    expect(p.deployTarget).toBe("mobile");
  });

  it("Linux + Vercel deploy → deployTarget=web", () => {
    const p = extractFromDescription("Next.js app on Linux that ships to Vercel.");
    expect(p.deployTarget).toBe("web");
  });
});
