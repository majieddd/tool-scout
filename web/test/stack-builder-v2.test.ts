/**
 * Stack-builder v2 invariants — encodes every regression uncovered by the
 * 10-scenario audit (2026-05-03). These run against the REAL catalog
 * (public/data/tools.json) so they're integration-style, not synthetic.
 *
 * Each test is named after the bug class it prevents.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractFromDescription } from "@/lib/architect";
import { composeStack } from "@/lib/stack-builder";
import type { Tool } from "@/lib/data";

const CATALOG_PATH = path.resolve(__dirname, "../public/data/tools.json");
const haveCatalog = fs.existsSync(CATALOG_PATH);

function compose(prompt: string) {
  if (!haveCatalog) throw new Error("catalog missing");
  const tools: Tool[] = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const profile = extractFromDescription(prompt);
  const stack = composeStack(tools, profile);
  return { profile, stack };
}

const findLayer = (stack: ReturnType<typeof compose>["stack"], id: string) =>
  stack.layers.find((l) => l.id === id);

const allPicks = (stack: ReturnType<typeof compose>["stack"]) =>
  stack.layers.flatMap((l) => [...l.primary, ...l.alternatives]);

describe.skipIf(!haveCatalog)("stack-builder-v2: vague-prompt returns zero picks", () => {
  it("a TRULY vague prompt (no project shape at all) produces zero primary picks", () => {
    // The architect should still hard-skip when the prompt has no shape.
    // ("Something cool with AI" has no archetype-detectable verb-noun shape.)
    const { stack } = compose("hello");
    expect(stack.totalPrimaryCount).toBe(0);
    expect(stack.skipped[0]).toMatch(/too vague|underspecified/i);
  });

  it("'I want an agent or tool' is treated as goal-oriented (generic-automation fallback)", () => {
    // The new design: if the prompt names a project shape (app/bot/agent/tool),
    // fire the generic-automation fallback so the user gets *some* breakdown
    // instead of a confusing empty result.
    const { stack } = compose("I want to build something cool with AI, maybe an agent or tool.");
    expect(stack.archetype?.id).toBe("generic-automation-app");
    expect(stack.totalPrimaryCount).toBeGreaterThan(0);
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: goal-driven layer gating", () => {
  it("goal=build_skill skips SDK and context-fs entirely", () => {
    const { stack } = compose(
      "I'm authoring a Claude Code skill (SKILL.md) that codifies my code-review workflow."
    );
    // SDK + context-fs must NOT appear as layers
    expect(stack.layers.find((l) => l.id === "sdk-runtime")).toBeUndefined();
    expect(stack.layers.find((l) => l.id === "context-fs")).toBeUndefined();
    // The skipped list should explain why
    expect(stack.skipped.some((s) => /sdk-runtime.*build_skill/.test(s))).toBe(true);
    expect(stack.skipped.some((s) => /context-fs.*build_skill/.test(s))).toBe(true);
  });

  it("goal=build_extension skips unrelated server layers", () => {
    const { stack } = compose(
      "Building a Cursor extension in TypeScript with .cursorrules."
    );
    // Should NOT have data-storage / auth / code-exec / observability
    for (const id of ["data-storage", "auth", "code-exec", "observability"]) {
      expect(stack.layers.find((l) => l.id === id)).toBeUndefined();
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: niche-language hard-skip", () => {
  it("Rust project does NOT pick a Python SDK", () => {
    const { stack } = compose(
      "Building an OpenAI Codex extension in Rust that wraps the ripgrep CLI."
    );
    const sdk = findLayer(stack, "sdk-runtime");
    if (sdk && sdk.primary.length > 0) {
      expect(sdk.primary[0].tool.language?.toLowerCase()).not.toBe("python");
    }
    // It's also fine for the lane to be skipped entirely (the typical outcome)
  });

  it("Solidity project never picks fastapi_mcp (Python REST auth) for auth", () => {
    const { stack } = compose(
      "Building a DeFi lending protocol in Solidity with Hardhat. Need security audit tooling."
    );
    for (const pick of allPicks(stack)) {
      expect(pick.tool.name?.toLowerCase()).not.toBe("tadata-org/fastapi_mcp");
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: word-boundary nameHas", () => {
  it("'iam' substring no longer matches usernames like 'iamzhihuix'", () => {
    // Solidity project with 'security' domain previously picked
    // iamzhihuix/skills-manage as auth via 'iam' substring match.
    // Now: auth only fires on explicit 'auth' domain, AND nameHas uses
    // word-boundary, so the pick can't recur.
    const { stack } = compose(
      "Building a DeFi lending protocol in Solidity. Need smart contract security audit tooling."
    );
    for (const pick of allPicks(stack)) {
      expect(pick.tool.name?.toLowerCase().startsWith("iamzhihuix/")).toBe(false);
    }
  });

  it("'test' substring no longer matches 'ai-attestation'", () => {
    // Cursor user with 'code review' previously got Korext/ai-attestation
    // in plugin layer because 'test' matched 'attestation'.
    const { stack } = compose(
      "Building a Cursor extension in TypeScript. I want code review."
    );
    for (const pick of allPicks(stack)) {
      expect(pick.tool.name?.toLowerCase()).not.toBe("korext/ai-attestation");
    }
  });

  it("'mcp-cli' substring no longer matches 'mcp-client-for-X'", () => {
    // Skill author scenario previously picked jonigl/mcp-client-for-ollama
    // as SDK because 'mcp-cli' matched 'mcp-client'.
    const { stack } = compose(
      "Authoring a Claude Code skill (SKILL.md) for code review."
    );
    for (const pick of allPicks(stack)) {
      expect(pick.tool.name?.toLowerCase()).not.toMatch(/mcp-client-for-/);
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: framework-name boost", () => {
  it("Playwright prompt picks playwright-mcp over chrome-devtools-mcp in web-api", () => {
    const { stack } = compose(
      "Cline-based scraper using Playwright in TypeScript. Scrapes news sites. macOS Sonoma."
    );
    const webApi = findLayer(stack, "web-api");
    if (webApi && webApi.primary.length > 0) {
      const pick = webApi.primary[0].tool.name?.toLowerCase() || "";
      expect(pick).toMatch(/playwright/);
      expect(pick).not.toMatch(/chrome-devtools/);
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: canonical-SDK boost", () => {
  it("TypeScript MCP project picks @modelcontextprotocol/* over niche TS variants", () => {
    const { stack } = compose(
      "Building a Cursor extension in TypeScript with MCP support."
    );
    const sdk = findLayer(stack, "sdk-runtime");
    if (sdk && sdk.primary.length > 0) {
      const pick = sdk.primary[0].tool.name?.toLowerCase() || "";
      expect(pick).toMatch(/modelcontextprotocol/);
      expect(pick).not.toMatch(/^@mcp-b\/webmcp/);
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: code-exec excludes feature-mention false positives", () => {
  it("LibreChat (chat clone with 'code interpreter' as a feature) is never a code-exec primary", () => {
    const { stack } = compose(
      "Building a Go gRPC microservice with Docker Compose."
    );
    const exec = findLayer(stack, "code-exec");
    if (exec && exec.primary.length > 0) {
      const name = exec.primary[0].tool.name?.toLowerCase() || "";
      expect(name).not.toMatch(/librechat/);
      expect(name).not.toMatch(/chatgpt[\s-]?clone/);
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: observability requires purpose, not org-name overlap", () => {
  it("XcodeBuildMCP (Sentry org but iOS build tool) never appears in observability layer", () => {
    const { stack } = compose(
      "Need Datadog observability and structured logs for my Go service."
    );
    const obs = findLayer(stack, "observability");
    const all = obs ? [...obs.primary, ...obs.alternatives] : [];
    for (const p of all) {
      expect(p.tool.name?.toLowerCase()).not.toMatch(/xcodebuild/);
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: data-storage specific-DB precedence", () => {
  it("when SQLite is named, picks a SQLite tool — not an SSH manager with a 'database' tag", () => {
    const { stack } = compose(
      "Cline-based scraper that stores results in SQLite. macOS."
    );
    const data = findLayer(stack, "data-storage");
    if (data && data.primary.length > 0) {
      const name = data.primary[0].tool.name?.toLowerCase() || "";
      const desc = (data.primary[0].tool.description || "").toLowerCase();
      // Pick must mention sqlite OR duckdb
      expect(`${name} ${desc}`).toMatch(/sqlite|duckdb/);
    }
  });

  it("when Firebase is named, picks a Firebase tool", () => {
    const { stack } = compose(
      "React Native mobile app. Backend hits a Firebase API."
    );
    const data = findLayer(stack, "data-storage");
    if (data && data.primary.length > 0) {
      const name = data.primary[0].tool.name?.toLowerCase() || "";
      expect(name).toMatch(/firebase|firestore/);
    }
  });

  it("when Postgres is named, no MySQL/MongoDB tool appears anywhere in the data lane", () => {
    const { stack } = compose(
      "Python MCP server that queries our Postgres database."
    );
    const data = findLayer(stack, "data-storage");
    const all = data ? [...data.primary, ...data.alternatives] : [];
    for (const p of all) {
      const name = p.tool.name?.toLowerCase() || "";
      expect(name).not.toMatch(/mysql|mongodb|mongo-/);
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: SDK layer rejects MCP clients", () => {
  it("mcp-client-for-ollama (a TUI client) is never primary in sdk-runtime", () => {
    const { stack } = compose(
      "Build a Python MCP server."
    );
    const sdk = findLayer(stack, "sdk-runtime");
    if (sdk && sdk.primary.length > 0) {
      expect(sdk.primary[0].tool.name?.toLowerCase()).not.toMatch(/mcp-client-for-/);
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: cross-agent skill compatibility", () => {
  it("Cursor user with 'code review' surfaces a code-review skill in method-skill", () => {
    const { stack } = compose(
      "Building a Cursor extension in TypeScript. I want code review."
    );
    const ms = findLayer(stack, "method-skill");
    // Must surface SOMETHING — used to be empty because Claude-tagged skills
    // were filtered out for Cursor.
    expect(ms?.primary.length).toBeGreaterThan(0);
    // The primary's tags should hint at code-review
    if (ms?.primary[0]) {
      const tags = (ms.primary[0].tool.tags || []).join(" ").toLowerCase();
      const desc = (ms.primary[0].tool.description || "").toLowerCase();
      const name = (ms.primary[0].tool.name || "").toLowerCase();
      expect(`${name} ${desc} ${tags}`).toMatch(/review|tdd|debug/);
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: method-skill audit boost", () => {
  it("Solidity DeFi audit prompt surfaces quillshield_skills (or vigilo) in method-skill", () => {
    const { stack } = compose(
      "DeFi lending protocol in Solidity with Hardhat. Need security audit tooling, formal verification, and gas optimization."
    );
    const ms = findLayer(stack, "method-skill");
    if (ms && ms.primary.length > 0) {
      const name = ms.primary[0].tool.name?.toLowerCase() || "";
      expect(name).toMatch(/quillshield|vigilo|chiasmus|audit/);
    }
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: framework→language inference", () => {
  it("'Building a Django web app' → primaryLanguage detected as python downstream", () => {
    const { profile, stack } = compose(
      "Building a Django web app with Postgres backend."
    );
    expect(profile.primaryLanguage).toBe("python");
    // data-storage pick must therefore be Python-friendly
    const data = findLayer(stack, "data-storage");
    if (data && data.primary.length > 0) {
      const lang = data.primary[0].tool.language?.toLowerCase();
      // Either Python or language-agnostic null is fine
      if (lang) expect(["python"]).toContain(lang);
    }
  });

  it("'React Native' → primaryLanguage detected as typescript downstream", () => {
    const { profile } = compose(
      "React Native mobile app for iOS and Android."
    );
    expect(profile.primaryLanguage).toBe("typescript");
  });
});

describe.skipIf(!haveCatalog)("stack-builder-v2: hard-cap and quality preservation", () => {
  it("never exceeds 15 picks across all scenarios", () => {
    const prompts = [
      "Python MCP server for Postgres on Windows with TDD.",
      "TypeScript Cursor extension with Next.js.",
      "Go gRPC microservice with Datadog observability.",
      "Solidity DeFi protocol with Hardhat.",
    ];
    for (const p of prompts) {
      const { stack } = compose(p);
      expect(stack.totalPrimaryCount).toBeLessThanOrEqual(15);
    }
  });

  it("every primary pick has score >= 1.5 (the floor)", () => {
    const { stack } = compose("Python MCP server for Postgres on Windows with TDD.");
    for (const layer of stack.layers) {
      for (const pick of layer.primary) {
        expect(pick.score).toBeGreaterThanOrEqual(1.5);
      }
    }
  });
});
