/**
 * Compatibility check — flag warnings when the composed stack might not
 * cleanly match the project's stated target.
 *
 * Returns Warning objects (not Errors) — the user can ignore them, but
 * they're surfaced prominently so misconfigurations don't slip through.
 */
import type { Tool } from "./data";
import type { ComposedStack } from "./stack-builder";
import type { ExtendedProfile } from "./architect";

export type Warning = {
  severity: "info" | "warn";
  layerId: string | null;
  message: string;
};

function isClaudeAgent(target: string): boolean {
  return target === "claude-code" || target === "claude-desktop";
}

export function checkCompat(stack: ComposedStack, profile: ExtendedProfile): Warning[] {
  const warnings: Warning[] = [];

  // 1. Check that at least one SDK / runtime layer was picked
  const sdk = stack.layers.find((l) => l.id === "sdk-runtime");
  if (!sdk || sdk.primary.length === 0) {
    warnings.push({
      severity: "warn",
      layerId: "sdk-runtime",
      message: "No SDK / runtime tool found in the catalog matching your target agent. You may need to install the official SDK manually (e.g. `pip install mcp[cli]` for Python).",
    });
  }

  // 2. Per-pick: warn on non-matching agent compatibility
  if (isClaudeAgent(profile.targetAgent)) {
    for (const layer of stack.layers) {
      for (const pick of layer.primary) {
        const c = pick.tool.compatibility;
        if (c === "incompatible") {
          warnings.push({
            severity: "warn",
            layerId: layer.id,
            message: `${pick.tool.name} is marked incompatible — verify before using.`,
          });
        }
        if (c === "needs_wrapper") {
          warnings.push({
            severity: "info",
            layerId: layer.id,
            message: `${pick.tool.name} needs a Claude wrapper. Tool Scout's wrapper-gen flow can produce one.`,
          });
        }
      }
    }
  }

  // 3. Language mismatch — only flag if the project has a primary language and
  //    a picked tool's language differs significantly
  if (profile.primaryLanguage && profile.primaryLanguage !== "shell") {
    const mismatched: { tool: Tool; layer: string }[] = [];
    for (const layer of stack.layers) {
      for (const pick of layer.primary) {
        const tlang = pick.tool.language?.toLowerCase();
        if (!tlang) continue;
        const pl = profile.primaryLanguage.toLowerCase();
        // Allow JS/TS interchange
        const compatible =
          tlang === pl ||
          (tlang === "javascript" && pl === "typescript") ||
          (tlang === "typescript" && pl === "javascript");
        if (!compatible && pl !== "shell" && tlang !== "shell" && tlang !== "markdown") {
          mismatched.push({ tool: pick.tool, layer: layer.id });
        }
      }
    }
    if (mismatched.length > 2) {
      warnings.push({
        severity: "info",
        layerId: null,
        message: `${mismatched.length} picks are written in a different primary language than your project. They still install fine — most MCP servers run as separate processes — but worth verifying.`,
      });
    }
  }

  // 4. Goal-specific checks
  if (profile.goal === "build_mcp_server" && !stack.layers.some((l) => l.id === "sdk-runtime" && l.primary.length > 0)) {
    warnings.push({
      severity: "warn",
      layerId: "sdk-runtime",
      message: "You said you're building an MCP server but the catalog didn't surface an SDK pick. Consider `mcp[cli]` (Python) or `@modelcontextprotocol/sdk` (TypeScript).",
    });
  }

  if (profile.goal === "build_skill" && !stack.layers.some((l) => l.id === "method-skill" || l.id === "domain-skill")) {
    warnings.push({
      severity: "info",
      layerId: null,
      message: "Authoring a skill is mostly Markdown and a few clear examples. Look at high-graded existing skills as templates.",
    });
  }

  // 5. Platform-specific notes
  if (profile.platform === "windows") {
    warnings.push({
      severity: "info",
      layerId: null,
      message: "Windows: Docker-based MCP servers should use Docker Desktop with WSL2. PowerShell hooks should set `-NoProfile -ExecutionPolicy Bypass`.",
    });
  }

  // 6. If we ended up with very few picks (under 3), flag low signal
  if (stack.totalPrimaryCount < 3) {
    warnings.push({
      severity: "info",
      layerId: null,
      message: `Only ${stack.totalPrimaryCount} primary picks. Your description was light — try adding more detail (target agent, primary language, key domains) for a richer stack.`,
    });
  }

  return warnings;
}
