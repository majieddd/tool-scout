/**
 * Prompt-builder — assembles a starter prompt the user can paste into
 * their target agent (Claude Code, Codex CLI, Cursor, etc.) to kick off
 * the project with the recommended stack already in mind.
 *
 * The prompt is intentionally minimal-context — it points at the local
 * install rather than embedding tool docs verbatim, which preserves the
 * agent's token budget for the actual work.
 */
import type { ComposedStack } from "./stack-builder";
import type { ExtendedProfile, AgentTarget, Platform } from "./architect";
import { AGENT_LABELS } from "./architect";

export type PromptStyle = "tdd" | "rapid" | "guided";

export type PromptOptions = {
  goal: string;                  // user-typed one-line goal
  targetAgent: AgentTarget;
  platform: Platform;
  style: PromptStyle;
  multiSession: boolean;
  includeWebReferences: boolean; // default true: include link to tool's catalog page
};

const STYLE_INSTRUCTIONS: Record<PromptStyle, string> = {
  tdd: "Use test-driven development. For each feature: write a failing test first, watch it fail, write the minimum code to pass, refactor, commit. Don't write multiple features in parallel.",
  rapid: "Optimize for speed-to-first-demo. Get a working spike of the happy path before any tests or polish. We'll harden it after the demo works.",
  guided: "Stop and confirm with me at each major step before proceeding. After every architectural decision (tool choice, schema, API surface), wait for my approval before writing code.",
};

const PLATFORM_NOTES: Record<Platform, string> = {
  windows: "On Windows: prefer PowerShell 7 for shell commands. Use forward slashes in Python paths. Docker Desktop must be running for sandboxed exec.",
  macos: "On macOS: most tooling installs cleanly via Homebrew or direct installer.",
  linux: "On Linux: prefer system package manager + pipx for isolated CLIs.",
  wsl: "Inside WSL: install Linux-native tooling. Cross-FS calls between WSL ↔ Windows are slow — keep your repo inside WSL's filesystem.",
  cloud: "Cloud-only: containerize early. Don't depend on host filesystem.",
  mobile: "Mobile target: most MCP servers won't help directly. The agent should focus on cross-platform code generation.",
  unknown: "",
};

const AGENT_INSTALL_LOCATION: Record<AgentTarget, string> = {
  "claude-code": "~/.claude/.mcp.json (MCP servers) and ~/.claude/skills/ (skills)",
  "claude-desktop": "%APPDATA%/Claude/claude_desktop_config.json on Windows; ~/Library/Application Support/Claude/claude_desktop_config.json on macOS",
  "codex-cli": "your Codex config directory (~/.config/codex/)",
  "cursor": "~/.cursor/extensions/ and your project's .cursorrules",
  "cline": "Cline's MCP marketplace (Settings → MCP) or directly in cline.config.json",
  "continue": "~/.continue/config.json",
  "aider": "~/.aider.conf.yml or your project root",
  "windsurf": "your project's .windsurfrules and Windsurf's extension manager",
  "cody": "Cody settings panel",
  "zed": "Zed's extensions UI",
  "gemini": "Gemini Code Assist settings",
  "generic": "varies by tool — see each tool's catalog page",
  "unknown": "varies by tool — see each tool's catalog page",
};

function detectInstallCommand(installHint: string | null | undefined): string | null {
  if (!installHint) return null;
  const trimmed = installHint.trim().split("\n")[0].trim();
  // Strip leading prompt markers
  return trimmed.replace(/^[$#>] /, "");
}

export function buildPrompt(stack: ComposedStack, profile: ExtendedProfile, opts: PromptOptions): string {
  const lines: string[] = [];
  const cataBase = "https://majieddd.github.io/tool-scout/tool";

  // Header ----------------------------------------------------
  lines.push(`# Project: ${opts.goal || "(unnamed)"}`);
  lines.push("");

  // Context section ------------------------------------------
  lines.push("## Project context");
  lines.push("");
  if (profile.description) {
    lines.push(`> ${profile.description.split("\n").slice(0, 3).join(" ").slice(0, 400)}${profile.description.length > 400 ? "…" : ""}`);
    lines.push("");
  }
  const factBits: string[] = [];
  if (profile.primaryLanguage) factBits.push(`primary language: **${profile.primaryLanguage}**`);
  if (profile.frameworks.size > 0) factBits.push(`frameworks: ${[...profile.frameworks].slice(0, 4).join(", ")}`);
  if (profile.domains.length > 0) factBits.push(`domains: ${profile.domains.slice(0, 4).join(", ")}`);
  factBits.push(`target agent: **${AGENT_LABELS[opts.targetAgent]}**`);
  factBits.push(`platform: **${opts.platform}**`);
  for (const f of factBits) lines.push(`- ${f}`);
  lines.push("");

  // Tools section --------------------------------------------
  lines.push("## Step 1 — Install the recommended stack");
  lines.push("");
  if (AGENT_INSTALL_LOCATION[opts.targetAgent]) {
    lines.push(`> Tools install into: ${AGENT_INSTALL_LOCATION[opts.targetAgent]}`);
    lines.push("");
  }
  for (const layer of stack.layers) {
    if (layer.primary.length === 0) continue;
    lines.push(`### ${layer.name}`);
    lines.push(`*${layer.description}*`);
    lines.push("");
    for (const pick of layer.primary) {
      const cmd = detectInstallCommand(pick.tool.install_hint);
      const link = opts.includeWebReferences ? ` ([catalog](${cataBase}/${pick.tool.id}/))` : "";
      lines.push(`- **${pick.tool.name}** — ${pick.reason}${link}`);
      if (cmd) {
        lines.push("  ```");
        lines.push("  " + cmd);
        lines.push("  ```");
      } else {
        lines.push(`  *(no install hint extracted yet — see ${pick.tool.url})*`);
      }
    }
    lines.push("");
  }

  // Configuration section ------------------------------------
  lines.push("## Step 2 — Configure your agent");
  lines.push("");
  if (opts.targetAgent === "claude-code" || opts.targetAgent === "claude-desktop") {
    lines.push("After installing each MCP server, register it in your config:");
    lines.push("");
    lines.push("```json");
    lines.push("{");
    lines.push('  "mcpServers": {');
    const mcpPicks = stack.layers
      .flatMap((l) => l.primary)
      .filter((p) => p.tool.category === "mcp_server")
      .slice(0, 5);
    mcpPicks.forEach((p, i) => {
      const cmd = detectInstallCommand(p.tool.install_hint) || "";
      const m = cmd.match(/^npx\s+(?:-y\s+)?(\S+)/);
      const npxArg = m ? m[1] : p.tool.name;
      const sep = i < mcpPicks.length - 1 ? "," : "";
      lines.push(`    "${p.tool.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 40)}": {`);
      lines.push(`      "command": "npx",`);
      lines.push(`      "args": ["-y", "${npxArg}"]`);
      lines.push(`    }${sep}`);
    });
    lines.push("  }");
    lines.push("}");
    lines.push("```");
    lines.push("");
    lines.push("(Replace `npx` lines with the actual install command from each tool's catalog page if it's not an npm package.)");
  } else if (opts.targetAgent === "cursor") {
    lines.push("Cursor reads `.cursorrules` from your project root. Drop the highest-graded cursor-rules tool's contents in.");
  } else if (opts.targetAgent === "cline") {
    lines.push("In Cline: Settings → MCP → install each server by its npm package name.");
  } else {
    lines.push("Refer to your agent's docs for how to register MCP servers + load skills/plugins.");
  }
  lines.push("");

  // Implementation phases ------------------------------------
  lines.push("## Step 3 — Implementation plan");
  lines.push("");
  lines.push(STYLE_INSTRUCTIONS[opts.style]);
  lines.push("");

  // Goal-specific phasing
  switch (profile.goal) {
    case "build_mcp_server":
      lines.push("Suggested phases:");
      lines.push("1. Project scaffold + smoke test (one tool that returns a static value)");
      lines.push("2. Wire the SDK + register one real tool with input validation");
      lines.push("3. Add error handling + observability (log every tool invocation)");
      lines.push("4. Iterate: add the remaining tools you scoped");
      lines.push("5. Smoke-test against the target agent in a sandbox first");
      break;
    case "build_skill":
      lines.push("Suggested phases:");
      lines.push("1. Write SKILL.md with strict frontmatter (`name`, `description`, `when_to_use`)");
      lines.push("2. Draft 3-5 unambiguous trigger examples");
      lines.push("3. Test the skill in the target agent — does it activate when expected? Stay quiet otherwise?");
      lines.push("4. Tighten the description until the trigger surface is exactly the cases you want");
      break;
    case "build_plugin":
      lines.push("Suggested phases:");
      lines.push("1. plugin.json with manifest fields (name, version, slash commands list)");
      lines.push("2. Each slash command as a separate .md file with the prompt + side effects documented");
      lines.push("3. Test each command in isolation first, then in chained workflows");
      break;
    case "build_harness":
      lines.push("Suggested phases:");
      lines.push("1. Define the FSM: which states does each job pass through?");
      lines.push("2. Implement the orchestrator loop with one happy-path job");
      lines.push("3. Add retry/cancellation/stall detection one at a time");
      lines.push("4. Add observability + dashboard");
      break;
    case "wrap_cli":
      lines.push("Suggested phases:");
      lines.push("1. Inspect the CLI's `--help` output and identify the 1-5 most useful commands");
      lines.push("2. Write the MCP wrapper exposing those as tools");
      lines.push("3. Sandbox-test the wrapper (no network, read-only FS) before publishing");
      break;
    default:
      lines.push("Suggested phases:");
      lines.push("1. Smallest viable demo of the happy path");
      lines.push("2. Add error handling and logging");
      lines.push("3. Add tests for the cases that broke during 1+2");
      lines.push("4. Polish + docs");
  }
  lines.push("");

  // Multi-session handoff ------------------------------------
  if (opts.multiSession) {
    lines.push("### Multi-session handoff");
    lines.push("");
    lines.push("At the end of each session, write a `HANDOFF.md` capturing:");
    lines.push("- What's done (with commit SHAs)");
    lines.push("- What's next (smallest possible task)");
    lines.push("- Any state you can't easily recover (env vars, running services, etc.)");
    lines.push("");
    lines.push("Start the next session by reading HANDOFF.md and a relevant slice of the code, not the entire repo.");
    lines.push("");
  }

  // Platform note --------------------------------------------
  if (PLATFORM_NOTES[opts.platform]) {
    lines.push("### Platform note");
    lines.push("");
    lines.push(PLATFORM_NOTES[opts.platform]);
    lines.push("");
  }

  // Token budget tips ----------------------------------------
  lines.push("### Token efficiency tips");
  lines.push("");
  lines.push("- Reference files by path; don't paste their content unless the agent needs to edit them.");
  lines.push("- For big repos, use `grep`/`rg` and read narrow slices instead of full files.");
  lines.push("- Discourage the agent from re-reading the same file twice in one turn.");
  lines.push("- The recommended stack already does most of this for you — the MCP filesystem server reads ranges, and search MCPs hit external indexes.");
  lines.push("");

  // Starter prompt for the agent -----------------------------
  lines.push("---");
  lines.push("");
  lines.push("## Step 4 — Paste this into your agent");
  lines.push("");
  lines.push("Open your terminal in the project directory, launch the agent, and paste:");
  lines.push("");
  lines.push("```");
  lines.push(`I want to ${opts.goal}.`);
  lines.push("");
  if (profile.description.length > 100) {
    lines.push(`Context: ${profile.description.slice(0, 800)}${profile.description.length > 800 ? "…" : ""}`);
    lines.push("");
  }
  if (profile.primaryLanguage) lines.push(`Primary language: ${profile.primaryLanguage}.`);
  if (profile.frameworks.size > 0) lines.push(`Frameworks: ${[...profile.frameworks].slice(0, 5).join(", ")}.`);
  if (profile.domains.length > 0) lines.push(`Domains: ${profile.domains.slice(0, 5).join(", ")}.`);
  lines.push("");
  lines.push(`Approach: ${opts.style === "tdd" ? "test-driven, one feature at a time" : opts.style === "rapid" ? "spike the happy path first, then harden" : "step-by-step, confirm at each architectural decision"}.`);
  lines.push("");
  lines.push("Tools available in this environment (already installed):");
  for (const layer of stack.layers) {
    for (const pick of layer.primary) {
      lines.push(`- ${pick.tool.name} — ${layer.name.toLowerCase()}`);
    }
  }
  lines.push("");
  lines.push("Start by:");
  switch (profile.goal) {
    case "build_mcp_server":
      lines.push("1. Confirming the project scaffold (or initializing one if empty)");
      lines.push("2. Implementing the smallest possible MCP tool that returns a static value");
      lines.push("3. Smoke-testing that with the configured agent");
      break;
    case "build_skill":
      lines.push("1. Writing SKILL.md with strict frontmatter and 1 example trigger");
      break;
    case "build_plugin":
      lines.push("1. Drafting plugin.json with the slash commands you have in mind");
      break;
    default:
      lines.push("1. Confirming the project scaffold");
      lines.push("2. Implementing the simplest end-to-end happy path");
      lines.push("3. Showing me the result before adding more features");
  }
  lines.push("```");
  lines.push("");

  // Footer ---------------------------------------------------
  lines.push("---");
  lines.push("");
  lines.push("*Generated by [Tool Scout Architect](https://majieddd.github.io/tool-scout/architect/) on " +
    new Date(stack.generatedAt).toLocaleDateString() + ". Stack picks reflect the catalog as of generation. Re-run if the catalog has refreshed.*");

  return lines.join("\n");
}
