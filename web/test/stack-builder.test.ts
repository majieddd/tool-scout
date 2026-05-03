/**
 * Stack-builder regression tests.
 *
 * Each test corresponds to a bug we shipped and then fixed in v1→v2→v3.
 * If any of these regress, the architect is silently degrading and CI
 * should block the deploy.
 */
import { describe, it, expect } from "vitest";
import { extractFromDescription } from "@/lib/architect";
import { composeStack } from "@/lib/stack-builder";
import {
  ALL_FIXTURE_TOOLS,
  TOOL_FASTMCP,
  TOOL_MCP_USE_TS,
  TOOL_FS_PYTHON,
  TOOL_PLUGIN_MARKETPLACE,
  TOOL_PG_AIGUIDE,
  TOOL_GENERIC_DB,
  TOOL_FASTAPI_MCP,
  TOOL_PYTHON_NOTEBOOK,
  TOOL_CONTEXT_OPTIMIZER,
  TOOL_TDD_GUARD,
  TOOL_NO_NO_DEBUG,
  TOOL_PITH,
  TOOL_PPTX_GEN,
  TOOL_XHS_DOWNLOADER,
  TOOL_FULL_AGENT,
  TOOL_HARNESS_AS_PLUGIN,
  TOOL_INCOMPATIBLE,
  TOOL_AWESOME_STUB,
  TOOL_OFFTOPIC_SKILL,
  TOOL_GIT,
} from "./fixtures";

const PYTHON_POSTGRES_PROMPT =
  "I'm building a Claude Code MCP server in Python that lets the agent query our Postgres database with row-level auth. Running on Windows 11 with Docker. I want test-driven development.";

function compose(prompt: string) {
  const profile = extractFromDescription(prompt);
  const stack = composeStack(ALL_FIXTURE_TOOLS, profile);
  const allPicks = stack.layers.flatMap((l) => l.primary);
  const allAlts = stack.layers.flatMap((l) => l.alternatives);
  const findLayer = (id: string) => stack.layers.find((l) => l.id === id);
  return { profile, stack, allPicks, allAlts, findLayer };
}

describe("stack-builder: regressions from the Python+Postgres+TDD prompt", () => {
  describe("language alignment (v1 bug: TS pick for Python project)", () => {
    it("picks fastmcp (Python) for SDK, NOT mcp-use (TypeScript)", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const sdk = findLayer("sdk-runtime");
      expect(sdk?.primary[0]?.tool.id).toBe(TOOL_FASTMCP.id);
    });

    it("never places mcp-use (TypeScript) anywhere in the stack", () => {
      const { allPicks } = compose(PYTHON_POSTGRES_PROMPT);
      expect(allPicks.find((p) => p.tool.id === TOOL_MCP_USE_TS.id)).toBeUndefined();
    });
  });

  describe("filesystem split (v1 bug: claude-plugins-official picked for FS)", () => {
    it("picks a filesystem MCP, NOT the plugin marketplace directory", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const fs = findLayer("context-fs");
      expect(fs?.primary[0]?.tool.id).toBe(TOOL_FS_PYTHON.id);
    });

    it("never places the plugin marketplace in the filesystem layer", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const fs = findLayer("context-fs");
      const allFsPicks = [...(fs?.primary || []), ...(fs?.alternatives || [])];
      expect(allFsPicks.find((p) => p.tool.id === TOOL_PLUGIN_MARKETPLACE.id)).toBeUndefined();
    });

    it("picks a separate git layer pick", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const git = findLayer("context-git");
      expect(git?.primary[0]?.tool.id).toBe(TOOL_GIT.id);
    });
  });

  describe("specific-DB preference (v1 bug: generic toolbox picked for Postgres)", () => {
    it("picks pg-aiguide (Postgres-specific) over generic mcp-toolbox", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const data = findLayer("data-storage");
      expect(data?.primary[0]?.tool.id).toBe(TOOL_PG_AIGUIDE.id);
    });
  });

  describe("auth layer", () => {
    it("picks fastapi_mcp ('with Auth!') for an MCP+auth project", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const auth = findLayer("auth");
      expect(auth?.primary[0]?.tool.id).toBe(TOOL_FASTAPI_MCP.id);
    });
  });

  describe("code-execution sandbox (v1 bug: context-mode picked)", () => {
    it("picks python-notebook-mcp, NOT mksglu/context-mode (context-window optimizer)", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const exec = findLayer("code-exec");
      expect(exec?.primary[0]?.tool.id).toBe(TOOL_PYTHON_NOTEBOOK.id);
    });

    it("never places mksglu/context-mode in code-exec (it's a context optimizer)", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const exec = findLayer("code-exec");
      const all = [...(exec?.primary || []), ...(exec?.alternatives || [])];
      expect(all.find((p) => p.tool.id === TOOL_CONTEXT_OPTIMIZER.id)).toBeUndefined();
    });
  });

  describe("method-skill TDD (v1+v2 bug: vague debug skill picked)", () => {
    it("picks tdd-guard when project description requests TDD", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const ms = findLayer("method-skill");
      expect(ms?.primary[0]?.tool.id).toBe(TOOL_TDD_GUARD.id);
    });

    it("does NOT pick the vague no-no-debug skill in primary slot", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const ms = findLayer("method-skill");
      expect(ms?.primary.find((p) => p.tool.id === TOOL_NO_NO_DEBUG.id)).toBeUndefined();
    });
  });

  describe("plugin layer (v1 bug: harnesses + apps picked as plugins)", () => {
    it("picks Pith (a real Claude Code hook) for the plugin layer", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const plugin = findLayer("agent-plugin");
      expect(plugin?.primary[0]?.tool.id).toBe(TOOL_PITH.id);
    });

    it("never picks an agent harness as a plugin", () => {
      const { allPicks } = compose(PYTHON_POSTGRES_PROMPT);
      expect(allPicks.find((p) => p.tool.id === TOOL_HARNESS_AS_PLUGIN.id)).toBeUndefined();
    });

    it("never picks a fullstack agent app as a plugin", () => {
      const { allPicks } = compose(PYTHON_POSTGRES_PROMPT);
      expect(allPicks.find((p) => p.tool.id === TOOL_FULL_AGENT.id)).toBeUndefined();
    });

    it("PPTX generator does not score above Pith for an MCP/auth project", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const plugin = findLayer("agent-plugin");
      const pithIdx = plugin?.primary.findIndex((p) => p.tool.id === TOOL_PITH.id) ?? -1;
      const pptxIdx = [...(plugin?.primary || []), ...(plugin?.alternatives || [])].findIndex(
        (p) => p.tool.id === TOOL_PPTX_GEN.id,
      );
      // Pith must be picked AND PPTX must be ranked below it (or not surfaced)
      expect(pithIdx).toBe(0);
      if (pptxIdx >= 0) expect(pptxIdx).toBeGreaterThan(0);
    });
  });

  describe("non-English filter (v1 bug: XHS-Downloader picked)", () => {
    it("never surfaces XHS-Downloader (mostly Chinese description) anywhere", () => {
      const { allPicks, allAlts } = compose(PYTHON_POSTGRES_PROMPT);
      const all = [...allPicks, ...allAlts];
      expect(all.find((p) => p.tool.id === TOOL_XHS_DOWNLOADER.id)).toBeUndefined();
    });
  });

  describe("incompatible / stub filtering", () => {
    it("never surfaces an 'incompatible' tool", () => {
      const { allPicks, allAlts } = compose(PYTHON_POSTGRES_PROMPT);
      const all = [...allPicks, ...allAlts];
      expect(all.find((p) => p.tool.id === TOOL_INCOMPATIBLE.id)).toBeUndefined();
    });

    it("awesome-list stub does not beat a real graded tool in same lane", () => {
      const { findLayer } = compose(PYTHON_POSTGRES_PROMPT);
      const fs = findLayer("context-fs");
      const stubIdx = fs?.primary.findIndex((p) => p.tool.id === TOOL_AWESOME_STUB.id) ?? -1;
      // The real fs Python tool should be #1; the stub may appear as alt or be skipped
      expect(fs?.primary[0]?.tool.id).toBe(TOOL_FS_PYTHON.id);
      expect(stubIdx).not.toBe(0);
    });
  });

  describe("domain-skill correctly skips when no real pattern skill (v2 bug)", () => {
    it("does NOT pick stock-analysis as a 'Python pattern skill'", () => {
      const { allPicks } = compose(PYTHON_POSTGRES_PROMPT);
      expect(allPicks.find((p) => p.tool.id === TOOL_OFFTOPIC_SKILL.id)).toBeUndefined();
    });
  });

  describe("hard cap respected", () => {
    it("never exceeds 15 primary picks", () => {
      const { stack } = compose(PYTHON_POSTGRES_PROMPT);
      expect(stack.totalPrimaryCount).toBeLessThanOrEqual(15);
    });
  });

  describe("language penalty asymmetry (TS pool, Python project)", () => {
    it("when project is Python, TS-only mcp-use does not become #1 SDK", () => {
      const onlyTsTools = ALL_FIXTURE_TOOLS.filter(
        (t) => t.language?.toLowerCase() === "typescript" || t.language?.toLowerCase() === "javascript",
      );
      const profile = extractFromDescription(PYTHON_POSTGRES_PROMPT);
      const stack = composeStack(onlyTsTools, profile);
      const sdk = stack.layers.find((l) => l.id === "sdk-runtime");
      // Either the layer is skipped (no Python option) OR the score floor blocks weak picks.
      // Either is acceptable — what's NOT acceptable is silently picking mcp-use.
      if (sdk && sdk.primary.length > 0) {
        // If a TS pick is offered, score must clear the floor
        expect(sdk.primary[0].score).toBeGreaterThanOrEqual(1.5);
      }
      // mcp-use specifically must never be the top pick when Python is requested
      // (the language penalty + Python-required predicate should both block it)
      expect(sdk?.primary[0]?.tool.id).not.toBe(TOOL_MCP_USE_TS.id);
    });
  });
});

describe("stack-builder: composition shape", () => {
  it("returns a valid ComposedStack with layers + skipped + generatedAt", () => {
    const { stack } = compose(PYTHON_POSTGRES_PROMPT);
    expect(stack.layers).toBeInstanceOf(Array);
    expect(stack.skipped).toBeInstanceOf(Array);
    expect(stack.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(stack.totalPrimaryCount).toBe(
      stack.layers.reduce((sum, l) => sum + l.primary.length, 0),
    );
  });

  it("each pick has a non-empty reason and a score", () => {
    const { allPicks } = compose(PYTHON_POSTGRES_PROMPT);
    for (const p of allPicks) {
      expect(p.reason.length).toBeGreaterThan(0);
      expect(typeof p.score).toBe("number");
    }
  });
});
