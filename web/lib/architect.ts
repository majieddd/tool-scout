/**
 * Architect — extends ProjectProfile with project-description signals.
 *
 * Where lib/analyze.ts reads code structure, this module reads the user's
 * natural-language description (and optional spec sheet) to extract:
 *   - targetAgent: which AI coding agent the project is for
 *   - platform: where the project will run
 *   - goal: what kind of thing they're building
 *   - domains: subject areas the project covers
 *
 * Combines with a (possibly empty) ProjectProfile from lib/analyze.ts to
 * yield an ExtendedProfile that the stack builder consumes.
 */
import type { ProjectProfile } from "./analyze";
import { profileToTags } from "./analyze";

export type AgentTarget =
  | "claude-code"
  | "claude-desktop"
  | "codex-cli"
  | "cursor"
  | "cline"
  | "continue"
  | "aider"
  | "windsurf"
  | "cody"
  | "zed"
  | "gemini"
  | "generic"
  | "unknown";

export type Platform =
  | "windows"
  | "macos"
  | "linux"
  | "wsl"
  | "cloud"
  | "mobile"
  | "unknown";

export type GoalType =
  | "build_mcp_server"
  | "build_skill"
  | "build_plugin"
  | "build_harness"
  | "wrap_cli"
  | "automation"
  | "research"
  | "data_pipeline"
  | "web_app"
  | "cli_tool"
  | "library"
  | "general";

export type ExtendedProfile = ProjectProfile & {
  description: string;
  targetAgent: AgentTarget;
  platform: Platform;
  goal: GoalType;
  domains: string[];           // ordered by detection confidence
  tokens: Set<string>;         // every detected tag-shaped signal (lang, fw, marker, domain, agent)
};

const AGENT_PATTERNS: Array<[AgentTarget, RegExp[]]> = [
  ["claude-code", [/claude[\s-]?code/i, /~\/?\.claude\b/i, /SKILL\.md/, /\.claude\/plugins\b/i, /anthropic.*claude/i]],
  ["claude-desktop", [/claude[\s-]?desktop/i, /claude_desktop_config/i]],
  ["codex-cli", [/codex[\s-]?cli/i, /openai[\s-]?codex/i, /\bcodex\b/i]],
  ["cursor", [/\bcursor\b.*(ai|ide|editor)/i, /\.cursorrules/, /cursor[\s-]?rules?/i]],
  ["cline", [/\bcline\b/i, /claude[\s-]?dev/i]],
  ["continue", [/\bcontinue\.dev\b/i, /\bcontinue[\s-]?extension/i]],
  ["aider", [/\baider\b/i, /\.aider\.conf/i]],
  ["windsurf", [/\bwindsurf\b/i, /\.windsurfrules/i]],
  ["cody", [/\bsourcegraph[\s-]?cody\b/i, /\bcody\b.*sourcegraph/i]],
  ["zed", [/\bzed[\s-]?(ai|editor|extension)\b/i]],
  ["gemini", [/\bgemini[\s-]?(code\s?assist|agent|api)\b/i]],
];

const PLATFORM_PATTERNS: Array<[Platform, RegExp[]]> = [
  ["windows", [/\bwindows\s*1[01]\b/i, /\bwin\s*1[01]\b/i, /powershell/i, /\bwin32\b/i]],
  ["macos", [/\bmac\s?os\b/i, /\bdarwin\b/i, /\bapple\s+silicon\b/i, /\bm[1-4]\b/i]],
  ["wsl", [/\bwsl\s*[12]?\b/i, /windows\s+subsystem.*linux/i]],
  ["linux", [/\blinux\b/i, /\bubuntu\b/i, /\bdebian\b/i, /\bfedora\b/i, /\bnixos\b/i]],
  ["cloud", [/\bcloud(\s+only|-native)?\b/i, /\baws\b/i, /\bgcp\b/i, /\bazure\b/i, /\bvercel\b/i, /\bcloudflare\b/i, /\bfly\.io\b/i, /\brender\.com\b/i]],
  ["mobile", [/\bios\b/i, /\bandroid\b/i, /\breact[\s-]?native\b/i, /\bswift\s?ui\b/i, /\bjetpack[\s-]?compose\b/i]],
];

const DOMAIN_PATTERNS: Array<[string, RegExp[]]> = [
  ["database", [/\b(postgres(ql)?|sqlite|mysql|mariadb|mongo(db)?|redis|cassandra|dynamodb|sql\s+server|duckdb|supabase|neon|planetscale)\b/i, /\bdatabase\b/i, /\bORM\b/]],
  ["auth", [/\b(auth(entication|orization|n|z)?|oauth|jwt|sso|rbac|rls|row[\s-]?level)\b/i, /\bcredentials?\b/i]],
  ["frontend", [/\b(frontend|front[\s-]?end|react|vue|svelte|nextjs?|remix|astro|tailwind)\b/i, /\bUI\s+(component|library)/i]],
  ["backend", [/\b(backend|back[\s-]?end|api|rest|graphql|grpc|websocket)\b/i, /\bserver(\s+side)?\b/i]],
  ["scraping", [/\b(scrap(e|er|ing)|crawl(er|ing)?|spider|extract(ion|or))\b/i]],
  ["browser-automation", [/\b(playwright|puppeteer|selenium|browser[\s-]?automation|chromium\b)/i]],
  ["search", [/\b(search\s+engine|elastic(search)?|algolia|tavily|exa|perplexity|web\s+search|semantic\s+search)\b/i]],
  ["voice-audio", [/\b(voice|speech|audio|tts|stt|whisper|elevenlabs)\b/i]],
  ["video-media", [/\b(video|stream(ing)?|encode|ffmpeg|youtube)\b/i]],
  ["image-vision", [/\b(image|vision|ocr|diffusion|stable[\s-]?diffusion|midjourney|computer[\s-]?vision)\b/i]],
  ["embeddings-rag", [/\b(embed(ding)?s?|vector\s+(db|store|search)|rag\b|chunking)\b/i]],
  ["filesystem", [/\b(filesystem|file\s+system|directory|folder|file\s+(read|write|access))\b/i]],
  ["git-vcs", [/\b(git(hub|lab)?|version\s+control|commit\s+(history|log))\b/i]],
  ["deployment", [/\b(deploy(ment)?|kubernetes|k8s|container|orchestrat(ion|or))\b/i]],
  ["docker", [/\bdocker\b/i, /\bcompose\b.*\b(yaml|yml)\b/i]],
  ["automation", [/\b(automate|automation|workflow|pipeline|cron|scheduler)\b/i]],
  ["agent-orchestration", [/\b(agent\s+(framework|harness|loop)|multi[\s-]?agent|orchestrat(or|ion))\b/i]],
  ["devops", [/\b(ci\/?cd|github\s+actions|gitlab\s+ci|jenkins|terraform|ansible)\b/i]],
  ["observability", [/\b(observability|monitoring|tracing|logs?|metrics|prometheus|grafana|datadog|sentry)\b/i]],
  ["testing", [/\b(test(ing)?|tdd|test[\s-]?driven|pytest|jest|vitest|playwright)\b/i]],
  ["llm", [/\b(llm|language\s+model|gpt|claude|gemini|mistral|llama)\b/i]],
  ["game-dev", [/\b(game|hytale|minecraft|voxel|blockbench|unity|unreal|godot)\b/i]],
  ["financial", [/\b(financial|trading|stocks?|crypto|defi|bank(ing)?)\b/i]],
  ["security", [/\b(security|vuln(erability)?|pentest|encrypt(ion)?|auth\s+(check|test))\b/i]],
];

const GOAL_PATTERNS: Array<[GoalType, RegExp[]]> = [
  ["build_mcp_server", [/\b(build|create|make|implement)(ing)?\b.*\bmcp\s+server\b/i, /\bmcp\s+server\b.*\b(for|that)\b/i, /\bnew\s+mcp\b/i]],
  ["build_skill", [/\b(build|create|write|author)(ing)?\b.*\bskill\b/i, /\bSKILL\.md\b/i, /\banthropic[\s-]?skill\b/i]],
  ["build_plugin", [/\b(build|create|make)(ing)?\b.*\b(claude|claude[\s-]?code)\s+plugin\b/i, /\bplugin\.json\b/i]],
  ["build_harness", [/\b(build|create)(ing)?\b.*\b(coding[\s-]?agent|agent\s+harness|orchestrator)\b/i, /\b(symphony|aider|cline)[\s-]?style\b/i]],
  ["wrap_cli", [/\bwrap(ping)?\b.*\b(cli|tool|binary)\b/i, /\bwrapper\s+for\b/i]],
  ["automation", [/\bautomat(e|ing|ion)\b.*\b(workflow|process|pipeline)\b/i]],
  ["data_pipeline", [/\b(data\s+pipeline|etl|elt|ingest(ion)?)\b/i]],
  ["web_app", [/\b(web\s+(app|application|site)|landing\s+page|dashboard)\b/i]],
  ["cli_tool", [/\b(cli\s+(tool|app|application)|command[\s-]?line\s+(tool|app))\b/i]],
  ["library", [/\b(library|sdk|package|module)\b.*\b(for|to)\b/i]],
  ["research", [/\b(research|exper(iment|imental)|prototype|poc|proof[\s-]?of[\s-]?concept)\b/i]],
];

function detectFirstMatch<T>(text: string, patterns: Array<[T, RegExp[]]>, fallback: T): T {
  for (const [value, rxs] of patterns) {
    for (const rx of rxs) {
      if (rx.test(text)) return value;
    }
  }
  return fallback;
}

function detectAllMatches<T>(text: string, patterns: Array<[T, RegExp[]]>): T[] {
  const found: T[] = [];
  for (const [value, rxs] of patterns) {
    if (rxs.some((rx) => rx.test(text))) found.push(value);
  }
  return found;
}

export function extractFromDescription(description: string, base?: ProjectProfile): ExtendedProfile {
  const desc = description || "";
  const baseProfile: ProjectProfile = base ?? {
    source: "paste",
    fileCount: 0,
    totalBytes: 0,
    languages: {},
    primaryLanguage: null,
    frameworks: new Set(),
    packageManagers: new Set(),
    dependencies: new Set(),
    hasDocker: false,
    hasCI: false,
    hasTests: false,
    hasMcp: false,
    hasSkill: false,
    hasPlugin: false,
    hasReadme: false,
    keywords: new Set(),
  };

  const targetAgent = detectFirstMatch<AgentTarget>(desc, AGENT_PATTERNS, "unknown");
  const platform = detectFirstMatch<Platform>(desc, PLATFORM_PATTERNS, "unknown");
  const goal = detectFirstMatch<GoalType>(desc, GOAL_PATTERNS, "general");
  const domains = detectAllMatches<string>(desc, DOMAIN_PATTERNS);

  // Boost the base profile's keyword bag with detected signals
  const merged = new Set(baseProfile.keywords);
  for (const d of domains) merged.add(d);
  if (targetAgent !== "unknown") merged.add(targetAgent);
  if (platform !== "unknown") merged.add(platform);

  // Token bag = everything stack-builder might use for matching
  const tokens = new Set<string>();
  for (const t of profileToTags(baseProfile)) tokens.add(t);
  for (const d of domains) tokens.add(d);
  if (targetAgent !== "unknown") tokens.add(targetAgent);

  // If description mentions docker/tests/MCP and base profile didn't catch it,
  // promote the boolean.
  const hasDocker = baseProfile.hasDocker || /\bdocker\b/i.test(desc);
  const hasMcp = baseProfile.hasMcp || /\bmcp\b/i.test(desc);
  const hasTests = baseProfile.hasTests || /\btest(s|ing|[\s-]driven)\b/i.test(desc);

  return {
    ...baseProfile,
    description: desc,
    targetAgent,
    platform,
    goal,
    domains,
    tokens,
    keywords: merged,
    hasDocker,
    hasMcp,
    hasTests,
  };
}

/** Merge a description-derived profile with a code-derived profile. */
export function mergeProfiles(
  fromCode: ProjectProfile,
  fromDescription: ExtendedProfile
): ExtendedProfile {
  const merged: ExtendedProfile = {
    ...fromDescription,
    fileCount: fromCode.fileCount + fromDescription.fileCount,
    totalBytes: fromCode.totalBytes + fromDescription.totalBytes,
    languages: { ...fromCode.languages, ...fromDescription.languages },
    primaryLanguage: fromCode.primaryLanguage ?? fromDescription.primaryLanguage,
    frameworks: new Set([...fromCode.frameworks, ...fromDescription.frameworks]),
    packageManagers: new Set([...fromCode.packageManagers, ...fromDescription.packageManagers]),
    dependencies: new Set([...fromCode.dependencies, ...fromDescription.dependencies]),
    keywords: new Set([...fromCode.keywords, ...fromDescription.keywords]),
    tokens: new Set([...fromCode.keywords, ...fromDescription.tokens]),
    hasDocker: fromCode.hasDocker || fromDescription.hasDocker,
    hasCI: fromCode.hasCI || fromDescription.hasCI,
    hasTests: fromCode.hasTests || fromDescription.hasTests,
    hasMcp: fromCode.hasMcp || fromDescription.hasMcp,
    hasSkill: fromCode.hasSkill || fromDescription.hasSkill,
    hasPlugin: fromCode.hasPlugin || fromDescription.hasPlugin,
    hasReadme: fromCode.hasReadme || fromDescription.hasReadme,
    source: fromCode.source,
  };
  // Recompute primary language from merged histogram
  if (Object.keys(merged.languages).length > 0) {
    let max = -1;
    for (const [lang, n] of Object.entries(merged.languages)) {
      if (n > max) {
        max = n;
        merged.primaryLanguage = lang;
      }
    }
  }
  return merged;
}

export const AGENT_LABELS: Record<AgentTarget, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  "codex-cli": "OpenAI Codex CLI",
  "cursor": "Cursor",
  "cline": "Cline",
  "continue": "Continue.dev",
  "aider": "Aider",
  "windsurf": "Windsurf",
  "cody": "Sourcegraph Cody",
  "zed": "Zed AI",
  "gemini": "Gemini Code Assist",
  "generic": "Generic / multi-agent",
  "unknown": "Not detected",
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  wsl: "WSL",
  cloud: "Cloud",
  mobile: "Mobile",
  unknown: "Not detected",
};

export const GOAL_LABELS: Record<GoalType, string> = {
  build_mcp_server: "Build an MCP server",
  build_skill: "Author a Claude skill",
  build_plugin: "Author a Claude Code plugin",
  build_harness: "Build an agent harness",
  wrap_cli: "Wrap a CLI tool",
  automation: "Workflow automation",
  data_pipeline: "Data pipeline",
  web_app: "Web app",
  cli_tool: "CLI tool",
  library: "Library / SDK",
  research: "Research / prototype",
  general: "General development",
};
