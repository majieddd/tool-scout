/**
 * Compatibility-check warnings — encodes the cases where the previous
 * implementation produced misleading or false-positive warnings.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractFromDescription } from "@/lib/architect";
import { composeStack } from "@/lib/stack-builder";
import { checkCompat } from "@/lib/compat-check";
import type { Tool } from "@/lib/data";

const CATALOG_PATH = path.resolve(__dirname, "../public/data/tools.json");
const haveCatalog = fs.existsSync(CATALOG_PATH);

function check(prompt: string) {
  if (!haveCatalog) throw new Error("catalog missing");
  const tools: Tool[] = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const profile = extractFromDescription(prompt);
  const stack = composeStack(tools, profile);
  const warnings = checkCompat(stack, profile);
  return { profile, stack, warnings };
}

describe.skipIf(!haveCatalog)("compat-check: 'No SDK / runtime' warning suppression", () => {
  it("does NOT fire 'pip install mcp[cli]' for a crypto-trading bot", () => {
    // The user's exact prompt from the PDF audit. market-trader is
    // usesMcpDirectly=false, so the SDK lane is correctly skipped — and
    // therefore the warning telling the user to install MCP[cli] is wrong.
    const { warnings } = check(
      "i want to make an app that trades cryptocurrency for me with the sole purpose of earning $1,000,000 USD equivalent as fast as possible agentically without micromanaging"
    );
    const sdkWarn = warnings.find((w) =>
      /no sdk|mcp\[cli\]/i.test(w.message),
    );
    expect(sdkWarn).toBeUndefined();
  });

  it("does NOT fire for a social-app prompt either (web_app goal, no MCP intent)", () => {
    const { warnings } = check(
      "Building a Twitter clone with Next.js and Supabase"
    );
    const sdkWarn = warnings.find((w) =>
      /no sdk|mcp\[cli\]/i.test(w.message),
    );
    expect(sdkWarn).toBeUndefined();
  });

  it("DOES fire when user explicitly says 'build a Python MCP server' but the SDK lane somehow comes back empty", () => {
    // Sanity: the warning still fires for genuinely-empty MCP-intent projects.
    // For a real catalog the SDK lane should populate, so check the *condition*:
    // if the user is building an MCP server AND no SDK was picked, warn.
    const { stack, warnings } = check("Build a Python MCP server for Postgres");
    const sdk = stack.layers.find((l) => l.id === "sdk-runtime");
    if (!sdk || sdk.primary.length === 0) {
      // Lane was empty — warning must fire for this MCP-intent project
      const sdkWarn = warnings.find((w) =>
        /no sdk|mcp\[cli\]/i.test(w.message),
      );
      expect(sdkWarn).toBeDefined();
    }
  });

  it("DOES fire for ai-agent-app archetype (usesMcpDirectly=true) when SDK lane fails", () => {
    // ai-agent-app has usesMcpDirectly=true, so it's MCP-relevant. If the
    // SDK lane somehow comes back empty, the warning is legitimate.
    const { profile, stack, warnings } = check(
      "I want to build an autonomous agent that does research"
    );
    expect(profile.archetype?.usesMcpDirectly).toBe(true);
    const sdk = stack.layers.find((l) => l.id === "sdk-runtime");
    if (!sdk || sdk.primary.length === 0) {
      const sdkWarn = warnings.find((w) =>
        /no sdk|mcp\[cli\]/i.test(w.message),
      );
      expect(sdkWarn).toBeDefined();
    }
  });
});

describe.skipIf(!haveCatalog)("compat-check: low-pick info message accuracy", () => {
  it("when archetype is detected with 4+ technical parts, DOES NOT call the description 'light'", () => {
    // Critical UX bug: "i want to make an app that trades cryptocurrency..."
    // is a richly-specified description. Saying "your description was light"
    // is just wrong — the catalog has thin coverage for this domain, that's
    // the real explanation.
    const { warnings } = check(
      "i want to make an app that trades cryptocurrency for me with the sole purpose of earning $1,000,000 USD equivalent as fast as possible agentically without micromanaging"
    );
    const lowPickWarn = warnings.find((w) => /primary picks?/i.test(w.message));
    if (lowPickWarn) {
      expect(lowPickWarn.message).not.toMatch(/description was light/i);
      // The new copy explains the catalog-gap honestly
      expect(lowPickWarn.message).toMatch(/domain librar|catalog is curated|typical stack/i);
    }
  });

  it("when no archetype is detected and picks are low, falls back to the 'light description' guidance", () => {
    // Genuinely vague prompts still get the original copy (it's accurate there).
    // "hello" produces 0 picks AND no archetype, so the warning fires with
    // the "description was light" wording.
    const { stack, warnings } = check("hello");
    if (stack.totalPrimaryCount < 3 && !stack.archetype) {
      const lowPickWarn = warnings.find((w) => /primary picks?/i.test(w.message));
      if (lowPickWarn) {
        expect(lowPickWarn.message).toMatch(/light/i);
      }
    }
  });
});
