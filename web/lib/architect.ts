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
  | "build_extension"
  | "build_harness"
  | "wrap_cli"
  | "automation"
  | "research"
  | "data_pipeline"
  | "web_app"
  | "cli_tool"
  | "library"
  | "general";

export type DeployTarget = "web" | "mobile" | "desktop" | "server" | "cli" | "unknown";

/**
 * Project archetype = a coarse classification of WHAT the user is building,
 * detected from goal-oriented prose ("an app that trades on the stock market",
 * "a chatbot for our docs"). Archetypes break a bare goal into the technical
 * components needed to build it — without an archetype, the architect was
 * keyword-blind to project ideas that didn't name technologies.
 */
export type ProjectArchetype = {
  id: string;
  label: string;
  /** Plain-English summary the UI can show under "Your project breakdown" */
  summary: string;
  /** Technical components a builder will need (rendered as a checklist) */
  technicalParts: string[];
  /** Brief "typical stack" string the UI can show as guidance */
  exampleStack: string;
  /**
   * Does this archetype involve MCP-protocol tools as a CORE dependency?
   * - true: build_mcp_server, RAG chatbots that consume MCP retrieval, AI agents
   *   that orchestrate MCP tool calls. The SDK lane should fire and pick fastmcp /
   *   @modelcontextprotocol/sdk.
   * - false (default): domain apps (trading bots, social platforms, scrapers,
   *   content generators). The user is building a regular app and pip-installs
   *   their own libraries (ccxt, alpaca, etc.). The catalog's MCP-flavored SDK
   *   picks would be confusing — skip the SDK lane entirely for these.
   */
  usesMcpDirectly: boolean;
  /**
   * If set, the data-storage lane treats this archetype's prompts AS IF the
   * user had named that database, even when they didn't. Comes from each
   * archetype's typical example_stack. Example: market-trader → "postgres"
   * (matches the example stack "PostgreSQL + TimescaleDB"); a vague algo
   * trading prompt then picks a Postgres MCP rather than a generic MySQL one.
   * `null` means "no preference, fall through to generic matching."
   */
  preferredDataStore: "postgres" | "mysql" | "sqlite" | "mongo" | "redis" | "firebase" | "supabase" | null;
  /**
   * Off-catalog domain libraries the user MUST install themselves regardless
   * of what's in the catalog. The catalog is curated for agent-tooling MCPs,
   * plugins, and skills — it deliberately doesn't try to mirror every
   * pip/npm package. For domain apps (trading, voice, scraping, RAG),
   * the bulk of the work is wiring up these standard libraries. Surfacing
   * them here gives the user an actionable "things to install" list
   * alongside the catalog picks, instead of a stack with 2 items and a
   * confusing 9-item technical-parts checklist.
   *
   * Format: `{ name, install, why }` — `install` is a copy-pasteable command,
   * `why` is a one-liner explaining what part of the stack it covers.
   * Empty array (default) for archetypes where catalog coverage is good
   * (build_mcp_server, build_skill, etc.) and there's no off-catalog gap.
   */
  essentialLibraries: Array<{ name: string; install: string; why: string }>;
};

export type ExtendedProfile = ProjectProfile & {
  description: string;
  targetAgent: AgentTarget;
  platform: Platform;             // host OS where dev happens
  deployTarget: DeployTarget;     // what the project deploys to (separate from host)
  goal: GoalType;
  domains: string[];              // ordered by detection confidence
  tokens: Set<string>;            // every detected tag-shaped signal (lang, fw, marker, domain, agent)
  archetype: ProjectArchetype | null;  // detected from goal-oriented prose
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

// Platform = the HOST OS where dev happens. (Mobile is intentionally NOT here —
// it's a deploy target, not a host. See DEPLOY_TARGET_PATTERNS.)
const PLATFORM_PATTERNS: Array<[Platform, RegExp[]]> = [
  ["windows", [/\bwindows\s*1[01]\b/i, /\bwin\s*1[01]\b/i, /powershell/i, /\bwin32\b/i]],
  ["wsl", [/\bwsl\s*[12]?\b/i, /windows\s+subsystem.*linux/i]],
  ["macos", [/\bmac\s?os\b/i, /\bdarwin\b/i, /\bapple\s+silicon\b/i, /\bm[1-4]\b/i]],
  ["linux", [/\blinux\b/i, /\bubuntu\b/i, /\bdebian\b/i, /\bfedora\b/i, /\bnixos\b/i]],
  ["cloud", [/\bcloud(\s+only|-native)?\b/i, /\baws\b/i, /\bgcp\b/i, /\bazure\b/i, /\bvercel\b/i, /\bcloudflare\b/i, /\bfly\.io\b/i, /\brender\.com\b/i]],
];

// DeployTarget = what the project produces. Detected from explicit signals.
const DEPLOY_TARGET_PATTERNS: Array<[DeployTarget, RegExp[]]> = [
  ["mobile", [/\bios\b/i, /\bandroid\b/i, /\breact[\s-]?native\b/i, /\bswift\s?ui\b/i, /\bjetpack[\s-]?compose\b/i, /\bexpo\b/i, /\bflutter\b/i]],
  ["web", [/\b(web\s+(app|application|site)|landing\s+page|dashboard|spa\b|website)\b/i, /\bnext\.?js\b/i, /\bvercel\b/i, /\bremix\b/i, /\bastro\b/i]],
  ["server", [/\b(microservice|grpc|rest\s+api|backend\s+(service|server)|server[\s-]?side|http\s+server)\b/i]],
  ["cli", [/\b(cli\s+(tool|app|application)|command[\s-]?line\s+(tool|app))\b/i]],
  ["desktop", [/\b(electron|tauri|desktop\s+app)\b/i]],
];

const DOMAIN_PATTERNS: Array<[string, RegExp[]]> = [
  ["database", [/\b(postgres(ql)?|sqlite|mysql|mariadb|mongo(db)?|redis|cassandra|dynamodb|sql\s+server|duckdb|supabase|neon|planetscale|firebase|firestore)\b/i, /\bdatabase\b/i, /\bORM\b/]],
  ["auth", [/\b(auth(entication|orization|n|z)?|oauth|jwt|sso|rbac|rls|row[\s-]?level)\b/i, /\bcredentials?\b/i]],
  // Frontend: fixed Next.js (literal dot), added vite/qwik/solid; "UI library" still requires word boundary
  ["frontend", [/\b(frontend|front[\s-]?end|react|vue|svelte|next\.?js|remix|astro|tailwind|vite|qwik|solid\.?js)\b/i, /\bUI\s+(component|library)/i]],
  // Backend now requires the noun "API" with a qualifier (not bare "api" which leaks)
  ["backend", [/\b(backend|back[\s-]?end|rest\s+api|graphql|grpc|websocket|microservice)\b/i, /\bserver[\s-]?side\b/i, /\bapi\s+(gateway|server|service)\b/i]],
  ["scraping", [/\b(scrap(e|er|ing)|crawl(er|ing)?|spider|extract(ion|or))\b/i]],
  ["browser-automation", [/\b(playwright|puppeteer|selenium|browser[\s-]?automation|chromium\b)/i]],
  // Search: now also matches "code search" / "project-wide search" / bare "search" with file/code/project context
  ["search", [/\b(search\s+engine|elastic(search)?|algolia|tavily|exa|perplexity|web\s+search|semantic\s+search|code\s+search|project[\s-]?wide\s+search|fast\s+search|fuzzy\s+search)\b/i, /\b(ripgrep|grep|fzf|fd)\b/i]],
  ["voice-audio", [/\b(voice|speech|audio|tts|stt|whisper|elevenlabs)\b/i]],
  ["video-media", [/\b(video|stream(ing)?|encode|ffmpeg|youtube)\b/i]],
  ["image-vision", [/\b(image|vision|ocr|diffusion|stable[\s-]?diffusion|midjourney|computer[\s-]?vision)\b/i]],
  ["embeddings-rag", [/\b(embed(ding)?s?|vector\s+(db|store|search)|rag\b|chunking)\b/i]],
  // Filesystem: now also matches "wraps the X CLI for fast project-wide search across files"
  ["filesystem", [/\b(filesystem|file\s+system|directory|folder|file\s+(read|write|access)|across\s+files|project[\s-]?wide)\b/i]],
  ["git-vcs", [/\b(git(hub|lab)?|version\s+control|commit\s+(history|log))\b/i]],
  ["deployment", [/\b(deploy(ment)?|kubernetes|k8s|container|orchestrat(ion|or))\b/i]],
  ["docker", [/\bdocker\b/i, /\bcompose\b.*\b(yaml|yml)\b/i]],
  ["automation", [/\b(automate|automation|workflow|pipeline|cron|scheduler)\b/i]],
  ["agent-orchestration", [/\b(agent\s+(framework|harness|loop)|multi[\s-]?agent|orchestrat(or|ion))\b/i]],
  ["devops", [/\b(ci\/?cd|github\s+actions|gitlab\s+ci|jenkins|terraform|ansible)\b/i]],
  // Observability now also matches crash reporting, distributed tracing, structured logs
  ["observability", [/\b(observability|monitoring|tracing|logs?|metrics|prometheus|grafana|datadog|sentry|bugsnag|crash(\s+reporting)?|crashlytics|otel|opentelemetry|jaeger|distributed\s+tracing|structured\s+logs?)\b/i]],
  // Testing must NOT auto-trigger on Playwright (it's dual-use; covered by browser-automation)
  ["testing", [/\b(tdd|test[\s-]?driven|red[\s-]?green|pytest|jest|vitest|cypress|playwright\s+test|unit\s+tests?|integration\s+tests?|e2e\s+tests?|test\s+coverage|test\s+suite|test\s+harness)\b/i]],
  ["llm", [/\b(llm|language\s+model|gpt|claude|gemini|mistral|llama|ollama)\b/i]],
  ["game-dev", [/\b(game|hytale|minecraft|voxel|blockbench|unity|unreal|godot)\b/i]],
  ["financial", [/\b(financial|trading|stocks?|bank(ing)?|invoic(?:e|ing)|expenses?|receipts?|bookkeeping|payroll|quickbooks|xero|wave|stripe|paypal|square|tax(?:es)?)\b/i]],
  ["security", [/\b(security|vuln(erability)?|pentest|encrypt(ion)?|auth\s+(check|test))\b/i]],
  // NEW: blockchain / web3 / smart contracts
  ["blockchain", [/\b(blockchain|smart\s+contracts?|defi|web3|ethereum|evm|solana|polygon|arbitrum|optimism|hardhat|foundry|forge|truffle|brownie|anchor|gas\s+optim)/i]],
  // NEW: mobile (deploy target also in DEPLOY_TARGET_PATTERNS, but mobile is a "domain" too for tag matching)
  ["mobile", [/\b(ios|android|react[\s-]?native|swift\s?ui|jetpack[\s-]?compose|xcode|expo|flutter|mobile\s+app)\b/i]],
  // NEW: accessibility
  ["accessibility", [/\b(accessibility|a11y|aria|screen[\s-]?reader|wcag|axe[\s-]?core)\b/i]],
];

// Language detection from description text. Order matters — more specific first.
// Each entry: [language, patterns]. The Go and language patterns were too narrow
// (e.g. "Go gRPC microservice" never matched). Now broader but still
// disambiguated against common false positives (e.g. "Java" excludes "JavaScript").
const LANGUAGE_PATTERNS: Array<[string, RegExp[]]> = [
  ["typescript", [/\btypescript\b/i, /\.tsx?\b/i, /\btsconfig\b/i]],
  ["javascript", [/\bjavascript\b/i, /\bnode\.?js\b/i, /\bnpm\b/i]],
  ["python", [/\bpython\b/i, /\bpy(?:thon)?\s*3\b/i, /\bpip\b/i, /\buv\b.*\b(?:install|tool)\b/i, /\bdjango\b/i, /\bflask\b/i, /\bfastapi\b/i, /\bpoetry\b/i]],
  ["rust", [/\brust\b/i, /\bcargo\b/i, /\b\.rs\b/i, /\btokio\b/i, /\bcrate\b/i]],
  // Go: now matches "Go gRPC", "Go service", "Go module", "go.mod", goroutine, etc.
  // Disambiguated against "go to" / "go through" by requiring a programming-context word
  ["go", [
    /\bgolang\b/i,
    /\bgo\s+(?:lang|module|build|program|service|microservice|server|app|binary|grpc|routine|channel|func|test|fmt|run|mod|sum|generic)\b/i,
    /\bgo[-\s]?grpc\b/i, /\bgrpc[-\s]?go\b/i,
    /\.go\b/i, /\bgo\.mod\b|\bgo\.sum\b/i,
    /\b(goroutine|gofmt|govet|golint|gomod)\b/i,
  ]],
  ["ruby", [/\bruby\b/i, /\brails\b/i, /\bgem(?:file)?\b/i]],
  ["java", [/\bjava\b(?!\s*script)/i, /\bmaven\b/i, /\bgradle\b/i, /\bspring\s+boot\b/i]],
  ["kotlin", [/\bkotlin\b/i]],
  ["swift", [/\bswift\b/i, /\bxcode\b/i, /\bswift\s?ui\b/i]],
  ["csharp", [/\bc#\b/i, /\bdotnet\b/i, /\b\.net\b/i]],
  ["cpp", [/\bc\+\+\b/i, /\bcpp\b/i]],
  ["php", [/\bphp\b/i, /\blaravel\b/i]],
  ["shell", [/\bbash\b/i, /\bzsh\b/i, /\bshell\s+script\b/i]],
  // NEW: niche but real
  ["solidity", [/\bsolidity\b/i, /\bsmart\s+contracts?\b/i, /\b\.sol\b/i, /\bhardhat\b/i, /\bfoundry\b/i]],
  ["vyper", [/\bvyper\b/i]],
  ["scala", [/\bscala\b/i, /\bsbt\b/i]],
  ["dart", [/\bdart\b/i, /\bflutter\b/i]],
  ["lua", [/\blua\b/i]],
  ["zig", [/\bzig\b/i]],
  ["elixir", [/\belixir\b/i, /\bphoenix\s+framework\b/i]],
  ["haskell", [/\bhaskell\b/i, /\bcabal\b/i]],
  ["clojure", [/\bclojure\b/i, /\bleiningen\b/i]],
];

// Framework detection from description text. Pattern: [framework, language-hint, patterns]
// language-hint is used for framework→language inference when language is null.
// e.g. "Django" → primaryLanguage="python", "React Native" → "typescript"
const FRAMEWORK_PATTERNS: Array<[string, string | null, RegExp[]]> = [
  ["django",       "python",     [/\bdjango\b/i]],
  ["flask",        "python",     [/\bflask\b/i]],
  ["fastapi",      "python",     [/\bfastapi\b/i]],
  ["rails",        "ruby",       [/\brails\b/i, /\bruby[\s-]?on[\s-]?rails\b/i]],
  ["nextjs",       "typescript", [/\bnext\.?js\b/i]],
  ["nuxt",         "typescript", [/\bnuxt\b/i]],
  ["remix",        "typescript", [/\bremix\b/i]],
  ["astro",        "typescript", [/\bastro\b/i]],
  ["express",      "javascript", [/\bexpress(\.js)?\b/i]],
  ["spring",       "java",       [/\bspring(\s+boot)?\b/i]],
  ["laravel",      "php",        [/\blaravel\b/i]],
  ["react",        "typescript", [/\breact\b(?!\s*native)/i]],
  ["react-native", "typescript", [/\breact[\s-]?native\b/i, /\bexpo\b/i]],
  ["svelte",       "typescript", [/\bsvelte(kit)?\b/i]],
  ["vue",          "typescript", [/\bvue(\.?js)?\b/i]],
  ["tailwind",     null,         [/\btailwind(\s?css)?\b/i]],
  ["vite",         "typescript", [/\bvite\b/i]],
  ["hardhat",      "solidity",   [/\bhardhat\b/i]],
  ["foundry",      "solidity",   [/\bfoundry\b/i, /\bforge\b/i]],
  ["truffle",      "solidity",   [/\btruffle\b/i]],
  ["firebase",     null,         [/\bfirebase\b/i, /\bfirestore\b/i, /\bfcm\b/i]],
  ["supabase",     null,         [/\bsupabase\b/i]],
  ["playwright",   null,         [/\bplaywright\b/i]],
  ["puppeteer",    null,         [/\bpuppeteer\b/i]],
  ["selenium",     null,         [/\bselenium\b/i]],
  ["pytest",       "python",     [/\bpytest\b/i]],
  ["vitest",       "typescript", [/\bvitest\b/i]],
  ["jest",         "javascript", [/\bjest\b/i]],
];

const GOAL_PATTERNS: Array<[GoalType, RegExp[]]> = [
  ["build_mcp_server", [/\b(build|create|make|implement)(ing)?\b.*\bmcp\s+server\b/i, /\bmcp\s+server\b.*\b(for|that)\b/i, /\bnew\s+mcp\b/i]],
  ["build_skill", [/\b(build|create|write|author)(ing)?\b.*\bskill\b/i, /\bSKILL\.md\b/i, /\banthropic[\s-]?skill\b/i]],
  ["build_plugin", [/\b(build|create|make)(ing)?\b.*\b(claude|claude[\s-]?code)\s+plugin\b/i, /\bplugin\.json\b/i]],
  // NEW: cursor/vscode/zed extensions are a different shape than claude plugins
  ["build_extension", [/\b(cursor|vscode|zed|jetbrains|intellij)\s+extension\b/i, /\bbuilding\s+(?:an?\s+)?(?:cursor|vscode|zed|jetbrains)\s+(?:extension|plugin)\b/i, /\.cursorrules\b/i]],
  ["build_harness", [/\b(build|create)(ing)?\b.*\b(coding[\s-]?agent|agent\s+harness|orchestrator)\b/i, /\b(symphony|aider|cline)[\s-]?style\b/i]],
  // wrap_cli now also fires on "wraps the X CLI" which the previous regex missed
  ["wrap_cli", [/\bwrap(ping|s)?\b.*\b(cli|tool|binary|command)\b/i, /\bwrapper\s+for\b/i, /\bwraps\s+the\s+\w+\s+(cli|tool|binary|command)\b/i]],
  ["automation", [/\bautomat(e|ing|ion)\b.*\b(workflow|process|pipeline)\b/i]],
  // data_pipeline now also fires on "scrapes X and stores results in Y" patterns
  ["data_pipeline", [/\b(data\s+pipeline|etl|elt|ingest(ion)?)\b/i, /\b(scrap(e|er|ing|es)|crawl(er|ing)?)\b.*\b(stor(es?|age)|sav(es?)|persist|database|sqlite|postgres|mongo)\b/i]],
  ["web_app", [/\b(web\s+(app|application|site)|landing\s+page|dashboard)\b/i, /\b(django|rails|laravel|next\.?js|remix|astro|svelte)\b.*\b(app|site|application|project)\b/i]],
  ["cli_tool", [/\b(cli\s+(tool|app|application)|command[\s-]?line\s+(tool|app))\b/i]],
  // library: previously misfired on "package.json for outdated" because the
  // regex accepted "package ... for". Tightened to require the noun at the
  // start of a phrase ("a Rust library for X", "an SDK for Y") rather than
  // anywhere in the prompt.
  ["library", [
    /\b(?:building|build|create|creating|writing|writes?)\s+(?:a|an|the|my)\s+(?:library|sdk|package|module)\s+(?:for|to)\s+\w/i,
    /\b(?:rust|python|go|typescript|javascript|java)\s+(?:library|sdk|package|crate)\b.*\b(?:for|to)\s+\w/i,
  ]],
  ["research", [/\b(research|exper(iment|imental)|prototype|poc|proof[\s-]?of[\s-]?concept)\b/i]],
];

/**
 * Project archetypes — pattern → inferred technical breakdown.
 *
 * The architect was previously keyword-only: a goal-oriented prompt like
 * "I want to build an app that trades for me on the stock market" yielded
 * `domains=["financial"]` and nothing else, because no technology was named.
 * Now we recognize common project shapes and infer the technical parts they
 * imply, plus suggested domains/frameworks/language that downstream layers
 * can act on.
 *
 * Order matters — first match wins, so put more specific patterns first.
 *
 * Each archetype's `inferred*` fields are SOFT hints: they only fire when
 * the user hasn't already given an explicit signal. So if the user says
 * "trading app in Rust", we still respect Rust.
 */
// Internal definition. The new fields (usesMcpDirectly, preferredDataStore)
// are OPTIONAL here so we don't have to set them on every archetype — defaults
// apply at the public-export step (ARCHETYPE_CATALOG below).
type ArchetypeDef = Omit<ProjectArchetype, "usesMcpDirectly" | "preferredDataStore" | "essentialLibraries"> & {
  patterns: RegExp[];
  inferDomains: string[];
  inferFrameworks: string[];
  inferLanguage: string | null;
  inferGoal: GoalType | null;
  usesMcpDirectly?: boolean;
  preferredDataStore?: ProjectArchetype["preferredDataStore"];
  essentialLibraries?: ProjectArchetype["essentialLibraries"];
};

const ARCHETYPES: ArchetypeDef[] = [
  {
    id: "market-trader",
    label: "Algorithmic / automated market trader",
    summary:
      "An always-on bot that ingests market data, makes decisions, and executes positions against a market API — stocks, crypto, prediction markets (Kalshi, Polymarket), or sports betting.",
    technicalParts: [
      "Market data ingestion (real-time quotes / orderbook / event prices)",
      "Market API integration (Alpaca/IBKR for stocks, Coinbase/Binance for crypto, Kalshi/Polymarket for prediction markets, etc.)",
      "Strategy / decision engine (signals, edge calculation, position sizing)",
      "Order execution + risk management (stop-loss, max position, kelly sizing)",
      "Backtesting harness against historical data",
      "Scheduling / always-on runner (or event-driven on tick)",
      "Persistence (orders, fills, P&L, equity curve)",
      "Observability (alerts on failures, slippage, daily summary)",
      "Paper / sandbox mode before live capital",
    ],
    exampleStack:
      "Python + market SDK (Alpaca / Coinbase / Kalshi API) + pandas/numpy + APScheduler + PostgreSQL + Sentry",
    patterns: [
      /\b(?:algo(?:rithmic)?|automated|auto)\s+trad(?:ing|er)\b/i,
      // Either order: "trading X" OR "X trader/trading" — covers stocks, forex, crypto, options
      /\btrad(?:ing|es?|er|e)\b.*\b(?:stock|equity|market|forex|fx|crypto|coin|option|future|derivative)/i,
      /\b(?:stock|equity|forex|fx|crypto|coin|option|future)\b.*\btrad(?:ing|es?|er|e)\b/i,
      /\b(?:stock|equity|forex|crypto|coin|option|future)\s+market\b.*\b(?:bot|app|trader|trading|invest|buy|sell)/i,
      /\b(?:trades?|trading)\s+for\s+me\b/i,
      /\bbuild(?:ing)?\s+a\s+(?:trading|trader)\b/i,
      /\b(?:buys?\s+and\s+sells?|signals?)\b.*\b(?:stock|crypto|option)/i,
      /\bstock\s+(?:bot|trader|app|invest)/i,
      // Prediction markets — Kalshi, Polymarket, Manifold, PredictIt, Augur, Hedgehog
      /\b(?:trades?|trading|trader|bets?|betting|bettor)\b.*\b(?:kalshi|polymarket|manifold|predictit|augur|hedgehog|prediction[\s-]?market)\b/i,
      /\b(?:kalshi|polymarket|manifold|predictit|augur|hedgehog|prediction[\s-]?market)\b.*\b(?:trades?|trading|trader|bets?|betting|bot|app|automat)/i,
      /\bbets?\s+on\s+(?:kalshi|polymarket|manifold|predictit|polymarkets?|markets?)\b/i,
      // Sports betting — DraftKings, FanDuel, Betfair, sportsbook
      /\b(?:bets?|betting|bettor|wager|wagers?)\b.*\b(?:sport|nba|nfl|mlb|nhl|epl|soccer|football|baseball|basketball|hockey|fantasy|draftkings|fanduel|betfair|sportsbook)/i,
      /\b(?:sports?[\s-]?bet|sportsbook|fantasy[\s-]?(?:football|sport|league)|draftkings|fanduel|betfair)\b.*\b(?:bot|app|automat|optim|lineup)/i,
      /\b(?:fantasy[\s-]?(?:football|baseball|basketball|hockey|sport)|fantasy\s+(?:lineup|league|team))\b.*\b(?:bot|app|automat|optim|lineup)/i,
      /\b(?:bot|app|automat)\b.*\b(?:fantasy[\s-]?(?:football|baseball|basketball|hockey|sport)|fantasy\s+(?:lineup|league|team))/i,
    ],
    inferDomains: ["financial", "backend", "automation", "observability", "database"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "data_pipeline",
    preferredDataStore: "postgres", // example_stack: PostgreSQL + Timescale typical
    essentialLibraries: [
      { name: "ccxt", install: "pip install ccxt", why: "Unified API across 100+ crypto exchanges (Coinbase, Binance, Kraken)" },
      { name: "coinbase-advanced-py", install: "pip install coinbase-advanced-py", why: "Official Coinbase Advanced Trade SDK if you're Coinbase-only" },
      { name: "alpaca-py", install: "pip install alpaca-py", why: "Stock + crypto trading API (paper-trading sandbox included)" },
      { name: "pandas + numpy", install: "pip install pandas numpy", why: "Time-series math, indicators, P&L calculation" },
      { name: "vectorbt or backtrader", install: "pip install vectorbt", why: "Backtesting harness against historical data — required before live capital" },
      { name: "APScheduler", install: "pip install apscheduler", why: "Always-on scheduler for tick / cron-driven strategies" },
      { name: "psycopg[binary] + sqlalchemy", install: "pip install \"psycopg[binary]\" sqlalchemy", why: "Postgres driver + ORM for orders / fills / equity-curve persistence" },
      { name: "sentry-sdk", install: "pip install sentry-sdk", why: "Crash + slippage alerting (catalog also has prometheus-mcp for metrics)" },
    ],
  },
  {
    id: "rag-chatbot",
    label: "RAG chatbot / document Q&A",
    summary:
      "A chatbot that answers questions grounded in your documents using retrieval-augmented generation.",
    technicalParts: [
      "Document ingestion + chunking (PDFs, markdown, web pages)",
      "Embeddings generation (OpenAI / local model)",
      "Vector store (pgvector / Chroma / Pinecone / Qdrant)",
      "Retrieval + reranking (hybrid keyword + vector)",
      "LLM completion with grounded context",
      "Conversation history + session state",
      "Optional: streaming responses, citations",
    ],
    exampleStack:
      "Python + LangChain or LlamaIndex + pgvector + OpenAI/Anthropic API + FastAPI",
    patterns: [
      /\b(?:rag|retrieval[\s-]?augmented)\b/i,
      /\b(?:chatbot|chat[\s-]?bot|assistant)\b.*\b(?:document|knowledge[\s-]?base|company|internal|wiki|pdf)/i,
      /\b(?:answer\s+questions?|q\s*&\s*a)\b.*\b(?:document|wiki|knowledge[\s-]?base)/i,
      /\b(?:talk|chat)\s+(?:to|with)\s+(?:my|our|your)\s+(?:docs?|documents?|pdfs?|notes?)\b/i,
    ],
    inferDomains: ["embeddings-rag", "search", "llm", "backend"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: null,
    preferredDataStore: "postgres", // pgvector is standard
    essentialLibraries: [
      { name: "langchain or llamaindex", install: "pip install langchain llama-index", why: "Document loaders, chunking, retriever interfaces" },
      { name: "openai or anthropic SDK", install: "pip install anthropic openai", why: "LLM completion + embeddings provider" },
      { name: "pgvector + psycopg[binary]", install: "pip install pgvector \"psycopg[binary]\"", why: "Vector store on Postgres — most boring/reliable choice" },
      { name: "fastapi + uvicorn", install: "pip install fastapi uvicorn", why: "HTTP layer for the chat endpoint" },
      { name: "tiktoken", install: "pip install tiktoken", why: "Accurate token counting for chunking + cost tracking" },
    ],
  },
  {
    id: "social-app",
    label: "Social / community platform",
    summary:
      "A multi-user app with profiles, posts, and a feed — a social network or community space.",
    technicalParts: [
      "User auth + profiles (signup, OAuth, password reset)",
      "Posts / content creation (text, media uploads)",
      "Feed / timeline (chronological or ranked)",
      "Comments, likes, follows",
      "Notifications (in-app, email, push)",
      "Real-time updates (websockets or polling)",
      "Moderation tooling (report, ban, content review)",
      "Media storage (S3 / CDN)",
    ],
    exampleStack:
      "Next.js + Supabase or Firebase + S3/Cloudflare R2 + Pusher/Ably for realtime",
    patterns: [
      /\b(?:social\s+(?:app|network|media|platform)|community\s+(?:app|platform|site))\b/i,
      /\b(?:twitter|instagram|tiktok|reddit|discord)[\s-]?(?:clone|alternative|like)\b/i,
      /\bbuild(?:ing)?\s+(?:a|an)\s+(?:social|community)\b/i,
    ],
    inferDomains: ["frontend", "backend", "auth", "database"],
    inferFrameworks: [],
    inferLanguage: "typescript",
    inferGoal: "web_app",
    preferredDataStore: "postgres", // Supabase / Postgres standard for social
  },
  {
    id: "scraper-tracker",
    label: "Web scraper / price-or-listing tracker",
    summary:
      "An automated system that watches websites and fires alerts (or stores data) when something changes.",
    technicalParts: [
      "Target site discovery + URL list management",
      "HTML fetching + parsing (static or browser-rendered)",
      "Change detection (diff against previous snapshot)",
      "Persistence (history of values / listings)",
      "Alerting (email, Discord, Slack, push)",
      "Anti-bot handling (rate limits, rotating UAs, sometimes proxies)",
      "Scheduling (cron / always-on poller)",
    ],
    exampleStack:
      "Python + Playwright or BeautifulSoup + SQLite/PostgreSQL + cron/APScheduler",
    patterns: [
      /\b(?:price|deal|inventory|product|stock|listing|availability|competitor|rival|flight|ticket)\s+(?:tracker|monitor|watcher|alert(?:s|ing)?)/i,
      // Allow optional intervening words: "monitor competitor pricing", "monitors flight prices"
      /\b(?:watch(?:es)?|monitor(?:s)?|tracks?)\s+(?:\w+\s+)?(?:websites?|prices?|listings?|inventory|pricing|availab|deals?|flights?|tickets?)/i,
      /\bnotif(?:y|ies|ication)\s+(?:me|us)\s+when\b.*\b(?:website|page|product|price|in\s+stock|listing|change|drop|matches)/i,
      /\bscrape\b.*\b(?:and|then)\s+(?:store|save|alert|notify|dm|message)/i,
      /\bscrapes?\b.*\b(?:zillow|realtor|airbnb|booking|amazon|ebay|craigslist)/i,
      // "DMs me when X matches" / "texts me when X drops"
      /\b(?:dm|dms|text|texts|message|messages|ping|pings)\s+me\b.*\b(?:when|if)\b.*\b(?:matches|drops|available|in\s+stock|changes|goes)/i,
    ],
    inferDomains: ["scraping", "browser-automation", "automation", "database", "observability"],
    inferFrameworks: ["playwright"],
    inferLanguage: "python",
    inferGoal: "data_pipeline",
    preferredDataStore: "sqlite", // Small local stores typical for personal scrapers
    essentialLibraries: [
      { name: "playwright", install: "pip install playwright && playwright install chromium", why: "Browser-rendered scraping (handles JS-heavy sites, anti-bot easier)" },
      { name: "beautifulsoup4 + httpx", install: "pip install beautifulsoup4 httpx", why: "Static HTML scraping when sites don't require a browser" },
      { name: "APScheduler", install: "pip install apscheduler", why: "Cron / interval polling without standing up a separate service" },
      { name: "ntfy or pushover client", install: "pip install requests", why: "Cheap-and-cheerful push notifications via ntfy.sh / Pushover HTTP" },
    ],
  },
  {
    id: "ai-agent-app",
    label: "Autonomous AI agent",
    summary:
      "An LLM-driven agent that pursues a goal across multiple steps — research, code, ops, etc.",
    technicalParts: [
      "Agent loop (plan → act → observe)",
      "Tool / function calling (web search, file ops, shell)",
      "Memory (conversation history + long-term)",
      "LLM provider integration (Anthropic / OpenAI / local)",
      "Sandboxed execution for code/shell tools",
      "Observability (trace each step, cost tracking)",
      "Safety rails (allowed tools, max iterations)",
    ],
    exampleStack:
      "Python or TypeScript + Anthropic/OpenAI API + LangGraph or custom loop + E2B sandbox",
    patterns: [
      /\b(?:autonomous|ai)\s+agent\b/i,
      /\b(?:research|coding|ops)\s+agent\b/i,
      /\b(?:agent|assistant)\s+that\s+(?:does|can|will|writes|reviews|plans)\b/i,
      /\bbuild(?:ing)?\s+an\s+agent\s+to\b/i,
      /\bmulti[\s-]?step\s+(?:agent|reasoning|tool)/i,
    ],
    inferDomains: ["agent-orchestration", "llm", "automation"],
    inferFrameworks: [],
    inferLanguage: "python", // Most agent frameworks (LangGraph, smolagents, autogen) are Python-first
    inferGoal: "build_harness",
    usesMcpDirectly: true, // MCP IS the dominant agent-tool protocol now — agents legitimately benefit from MCP SDK + servers
    essentialLibraries: [
      { name: "langgraph", install: "pip install langgraph", why: "Stateful agent loops with checkpointing — best default for non-trivial agents" },
      { name: "anthropic + openai SDKs", install: "pip install anthropic openai", why: "LLM provider integration (start with one, abstract later if needed)" },
      { name: "smolagents (HF)", install: "pip install smolagents", why: "Lightweight alternative to LangGraph if you want code-first tool calling" },
    ],
  },
  {
    id: "personal-assistant",
    label: "Personal assistant / lifestyle automation",
    summary:
      "An always-on helper that automates personal tasks — reminders, summaries, scheduling, errands.",
    technicalParts: [
      "Trigger source (calendar, email, voice, schedule)",
      "Task queue / orchestration",
      "External integrations (calendar, email, messaging, todo app)",
      "LLM for summarization / decision-making",
      "Persistence + history",
      "Notifications (push, SMS, email, voice)",
    ],
    exampleStack:
      "Python or TS + cron/n8n + LLM API + Twilio/Pushover + PostgreSQL",
    patterns: [
      /\b(?:personal\s+assistant|life\s+assistant|daily\s+(?:planner|assistant))\b/i,
      /\b(?:reminds?|nudges?|summari[sz]es?)\s+me\b.*\b(?:every|daily|weekly|when)/i,
      /\b(?:plans?|schedules?)\s+my\s+(?:day|week|tasks?)/i,
    ],
    inferDomains: ["automation", "llm", "backend"],
    inferFrameworks: [],
    inferLanguage: "python", // Personal assistants tend to be backend-heavy automation
    inferGoal: "automation",
    preferredDataStore: "postgres",
  },
  {
    id: "saas-dashboard",
    label: "SaaS dashboard / admin panel",
    summary:
      "An internal/external dashboard for managing data, users, or business operations.",
    technicalParts: [
      "User auth + roles (admin, member, viewer)",
      "Data tables with filters / sort / pagination",
      "Charts / KPI visualizations",
      "CRUD on domain entities",
      "Audit log",
      "Multi-tenancy (if customer-facing)",
      "Billing integration (if paid)",
    ],
    exampleStack:
      "Next.js + Supabase or Postgres + Stripe + Recharts/Tremor",
    patterns: [
      /\b(?:saas|admin|internal)\s+(?:dashboard|panel|tool)\b/i,
      /\b(?:dashboard|panel)\s+(?:for|to)\s+(?:manage|track|view|monitor)/i,
      /\b(?:crud|admin)\s+(?:app|panel|interface)\b/i,
    ],
    inferDomains: ["frontend", "backend", "auth", "database"],
    inferFrameworks: ["nextjs"],
    inferLanguage: "typescript",
    inferGoal: "web_app",
    preferredDataStore: "postgres",
  },
  // voice-calling-agent must come BEFORE voice-assistant — they share a few
  // patterns ("phone agent") but the calling-agent's outbound + booking
  // intent is the more specific case.
  {
    id: "voice-calling-agent",
    label: "Outbound voice / phone agent",
    summary:
      "An AI that makes phone calls on your behalf — booking appointments, screening leads, handling reservations.",
    technicalParts: [
      "Telephony provider (Twilio, Telnyx, Vapi)",
      "Speech-to-text (real-time / streaming)",
      "LLM dialogue manager with goal completion logic",
      "Text-to-speech (low-latency, natural prosody)",
      "Conversation state machine (handle objections, hang-up, voicemail)",
      "Calendar / booking integration (Google Calendar, Calendly)",
      "Recording + transcript storage",
      "Compliance (call recording disclosure, opt-out)",
    ],
    exampleStack:
      "Python or TS + Twilio/Vapi + Deepgram/Whisper + OpenAI/Anthropic + ElevenLabs + Google Calendar API",
    patterns: [
      /\b(?:ai|agent|bot)\b.*\bcalls?\s+(?:businesses?|stores?|restaurants?|people|leads?)\b/i,
      /\b(?:books?|booking)\s+(?:me\s+)?(?:appointments?|reservations?|tables?)\b/i,
      /\b(?:phone|call|telephony)\s+(?:bot|agent)\b.*\b(?:books?|schedules?|negotiates?|orders?)/i,
      /\bmakes?\s+(?:phone\s+)?calls?\s+(?:for\s+me|on\s+my\s+behalf)\b/i,
    ],
    inferDomains: ["voice-audio", "llm", "automation", "backend"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "automation",
    preferredDataStore: "postgres",
    essentialLibraries: [
      { name: "twilio or vapi-python", install: "pip install twilio", why: "Telephony provider — Twilio is the standard, Vapi is voice-first" },
      { name: "deepgram-sdk or openai-whisper", install: "pip install deepgram-sdk", why: "Real-time speech-to-text (Deepgram is lowest-latency)" },
      { name: "elevenlabs", install: "pip install elevenlabs", why: "Natural-prosody text-to-speech — crucial for not sounding like a robot" },
      { name: "anthropic or openai SDK", install: "pip install anthropic", why: "LLM dialogue manager + tool use" },
      { name: "google-api-python-client", install: "pip install google-api-python-client", why: "Calendar booking integration" },
    ],
  },
  {
    id: "voice-assistant",
    label: "Voice / audio assistant",
    summary:
      "A voice-driven app — STT input, LLM reasoning, TTS output. Could be phone, smart speaker, or in-app.",
    technicalParts: [
      "Speech-to-text (Whisper, Deepgram, AssemblyAI)",
      "Wake-word / endpointing (if always-listening)",
      "LLM dialogue management",
      "Text-to-speech (ElevenLabs, OpenAI TTS, local)",
      "Audio I/O pipeline (low-latency)",
      "Optional: streaming for under-1s round-trip",
    ],
    exampleStack:
      "Python + Whisper + OpenAI/Anthropic + ElevenLabs + WebRTC for realtime",
    patterns: [
      /\b(?:voice|speech|audio)\s+(?:assistant|agent|app|interface|bot)\b/i,
      /\btalk\s+(?:to|with)\s+(?:my|the)\s+(?:app|computer|ai)/i,
      /\b(?:phone|call|telephony)\s+(?:bot|agent|assistant)/i,
    ],
    inferDomains: ["voice-audio", "llm", "backend"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: null,
    essentialLibraries: [
      { name: "openai-whisper or deepgram-sdk", install: "pip install openai-whisper", why: "Speech-to-text — Whisper for local, Deepgram for streaming" },
      { name: "elevenlabs", install: "pip install elevenlabs", why: "Text-to-speech with natural prosody" },
      { name: "sounddevice or pyaudio", install: "pip install sounddevice", why: "Audio I/O for mic input + speaker output" },
      { name: "anthropic or openai SDK", install: "pip install anthropic", why: "LLM dialogue management" },
    ],
  },
  {
    id: "chat-platform-bot",
    label: "Chat-platform bot (Discord / Slack / Telegram / WhatsApp)",
    summary:
      "A bot that lives inside a chat platform — responds to commands, posts on schedule, moderates, or summarizes.",
    technicalParts: [
      "Platform SDK / webhook integration (Discord.py, Slack Bolt, telegraf, etc.)",
      "Command parsing + slash-commands or natural-language triggers",
      "Persistence (per-server config, user memory, command history)",
      "LLM integration (if it's an AI bot)",
      "Scheduling (cron jobs for daily posts, reminders)",
      "Permission / role handling (admin commands, opt-in channels)",
      "Hosting (always-on; serverless for webhooks or VPS for gateway connections)",
      "Rate-limit handling (platform-specific limits)",
    ],
    exampleStack:
      "TypeScript + Discord.js / Slack Bolt + Postgres or Redis + Railway/Fly.io for hosting",
    patterns: [
      /\b(?:discord|slack|telegram|whatsapp|signal|matrix|teams)\s+(?:bot|app|integration|plugin)\b/i,
      /\bbot\s+(?:for|in|on)\s+(?:my\s+)?(?:discord|slack|telegram|whatsapp|signal|server|channel|community|group)/i,
      /\bbuild(?:ing)?\s+a\s+(?:discord|slack|telegram|whatsapp)\b/i,
      /\b(?:reddit|x|twitter)\s+bot\b/i,
      /\bbot\s+that\s+(?:posts?|replies|responds?)\s+(?:on|in|to)\s+(?:reddit|x|twitter|discord|slack|telegram)/i,
    ],
    inferDomains: ["llm", "automation", "backend"],
    inferFrameworks: [],
    inferLanguage: "typescript",
    inferGoal: "automation",
    preferredDataStore: "postgres",
    essentialLibraries: [
      { name: "discord.js (or @slack/bolt, telegraf)", install: "npm install discord.js", why: "Platform SDK — pick the one matching your target chat platform" },
      { name: "@anthropic-ai/sdk", install: "npm install @anthropic-ai/sdk", why: "LLM integration if it's an AI bot" },
      { name: "node-cron", install: "npm install node-cron", why: "Scheduling for daily-post / reminder bots" },
      { name: "drizzle-orm + pg", install: "npm install drizzle-orm pg", why: "Postgres ORM for per-server config + memory" },
    ],
  },
  {
    id: "social-listener",
    label: "Social-media listener / alerting watcher",
    summary:
      "Monitors social platforms or websites for keywords / mentions / events and notifies you when something matches.",
    technicalParts: [
      "Source ingestion (Twitter/X API, Reddit API, RSS, Hacker News, web scraping)",
      "Keyword / regex / semantic match engine",
      "Optional: LLM filter for relevance ranking",
      "Deduplication (don't re-alert on the same item)",
      "Notification channels (DM, email, Discord/Slack webhook, push)",
      "Persistence (seen items, user preferences)",
      "Scheduling / always-on poller",
    ],
    exampleStack:
      "Python + tweepy/PRAW + APScheduler + SQLite + ntfy.sh / Pushover / Discord webhook",
    patterns: [
      /\b(?:watch|listen|monitor|track)\b.*\b(?:twitter|x|reddit|hacker[\s-]?news|hackernews|hn|tweet|subreddit|mentions?|keywords?)\b.*\b(?:notif|alert|dm|message|me\b|email)/i,
      /\bnotif(?:y|ies|ication)\s+me\s+when\b.*\b(?:twitter|x|reddit|tweet|posts?|mentions?)/i,
      /\b(?:keyword|mention|alert)\s+(?:tracker|watcher|monitor|alerts?|alerting)\b/i,
      /\bdms?\s+me\b.*\b(?:keyword|tweet|post|reddit)/i,
      /\bbot\s+that\s+watches?\b/i,
    ],
    inferDomains: ["scraping", "automation", "llm", "backend"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "automation",
    preferredDataStore: "sqlite",
    essentialLibraries: [
      { name: "tweepy / praw", install: "pip install tweepy praw", why: "Twitter/X + Reddit API clients (most listeners watch one or both)" },
      { name: "feedparser", install: "pip install feedparser", why: "RSS / Atom for HN, blogs, news sources" },
      { name: "APScheduler", install: "pip install apscheduler", why: "Polling on an interval without a separate service" },
      { name: "anthropic or openai SDK", install: "pip install anthropic", why: "LLM relevance filter — drops 90% of noise before alerting" },
    ],
  },
  {
    id: "content-generator",
    label: "Content generator (podcast / resume / summary / blog from input)",
    summary:
      "Takes structured input (notes, profile data, transcripts) and produces formatted output (podcast audio, resume PDF, blog post, summary).",
    technicalParts: [
      "Input adapter (parse notes / LinkedIn / docs / transcripts)",
      "LLM transformation (summarize, expand, restructure, brand-voice)",
      "Output renderer (PDF / DOCX for resumes, audio for podcasts, MD for blogs)",
      "Template management (multiple output styles)",
      "Optional: TTS for audio output (ElevenLabs, OpenAI TTS)",
      "Optional: image generation for thumbnails",
      "Persistence (input + output history, user preferences)",
      "Delivery (download, email, RSS for podcasts)",
    ],
    exampleStack:
      "Python + OpenAI/Anthropic + ElevenLabs (audio) or WeasyPrint (PDF) + S3 storage",
    patterns: [
      // Verbs widened: drafts/writes/composes in addition to generate/create/produce
      /\b(?:generate|generator|generates?|creates?|produces?|drafts?|writes?|composes?|build(?:ing)?)\b.*\b(?:resume|cv|podcast|summary|summaries|blog|article|newsletter|video\s+summary|listing\s+description|product\s+description|property\s+description|quote|quotes?|proposal|invoice|estimate|contract)/i,
      // "X generator/builder/maker/writer" — allow optional middle word ("blog post generator")
      /\b(?:resume|cv|podcast|summary|summaries|blog(?:\s+\w+)?|article|newsletter|video|listing|product|property|airbnb|etsy|amazon|shopify|ebay|quote|proposal|invoice|estimate|contract|cover\s+letter)\s+(?:generator|builder|maker|creator|writer)\b/i,
      // Inputs widened: charts/records/files/cases/documents
      /\bsummari[sz]es?\b.*\b(?:videos?|youtube|articles?|papers?|notes?|meetings?|podcasts?|transcripts?|charts?|records?|files?|cases?|documents?|emails?|threads?)/i,
      // "Turn X into Y" — much broader inputs and outputs (with or without article).
      /\bturns?\s+(?:my\s+)?(?:\w+\s+)?(?:notes?|ideas?|profile|linkedin|transcripts?|recordings?|meetings?|writing|docs?|emails?|calls?|charts?|records?|files?|cases?|documents?|stripe|sales|data|threads?)\s+(?:into|to)\s+(?:a\s+|the\s+|an\s+)?(?:podcasts?|resumes?|blogs?|articles?|summaries?|newsletters?|posts?|reports?|pdfs?|invoices?|quotes?)/i,
      /\b(?:podcast|resume|blog|newsletter|article|report)\s+from\s+(?:my\s+)?(?:notes?|profile|linkedin|docs|writing|transcripts?|meetings?|recordings?|stripe|data)/i,
      // Vertical-specific output verbs
      /\bdrafts?\s+(?:contracts?|emails?|messages?|proposals?|invoices?|quotes?|reports?|cover\s+letters?|listings?)/i,
      // "PDF" / "report" / "doc" generation from data — note "generates" with the s,
      // and broader output nouns including documentation
      /\b(?:generate|generates|generating|generator|build|builds|building|create|creates|creating|produce|produces|writes?|writing)\s+(?:pricing\s+|monthly\s+|weekly\s+|financial\s+|onboarding\s+)?(?:pdfs?|reports?|invoices?|quotes?|estimates?|docs?|documents?|documentation|readmes?|onboarding|tutorials?)/i,
      // "writes an X doc/document" / "reads a repo and writes onboarding"
      // Note: "an" article support added after "an onboarding doc" was missed.
      /\b(?:reads?|takes?|consumes?)\s+(?:a\s+|an\s+|my\s+|the\s+)?\w+\s+and\s+(?:writes?|generates?|produces?)\s+(?:a\s+|an\s+|the\s+)?(?:onboarding|tutorial|doc|document|readme|guide)/i,
    ],
    inferDomains: ["llm", "automation", "backend"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "automation",
  },
  {
    id: "recommendation-engine",
    label: "Recommendation / personalization engine",
    summary:
      "Suggests items to a user based on their preferences, mood, past behavior, or current context (food, media, products, plans).",
    technicalParts: [
      "User profile / preference capture",
      "Item catalog (restaurants, recipes, products, media — usually a 3rd-party API)",
      "Scoring / ranking model (rules, embeddings, collaborative filtering, or LLM)",
      "Context input (mood, location, time, weather, what's-in-fridge)",
      "Feedback loop (thumbs up/down updates preferences)",
      "Persistence (user history, accepted/rejected suggestions)",
      "Delivery UI (mobile, web, voice)",
    ],
    exampleStack:
      "Python or TS + OpenAI embeddings or LLM + a domain API (Yelp, Spoonacular, etc.) + Postgres + Next.js or React Native",
    patterns: [
      // Verbs widened: adjusts/curates/optimizes/personalizes/picks/plans in addition to recommend/suggest
      /\b(?:recommends?|recommendation|suggests?|suggestion|adjusts?|curates?|optimi[sz]es?|personali[sz]es?|picks?|plans?\b(?!\s+to))\b.*\b(?:restaurants?|recipes?|meals?|movies?|shows?|books?|products?|songs?|playlists?|workouts?|trips?|itinerar(?:y|ies)|routes?|outfits?|gifts?|exercises?|reads?)\b/i,
      // "X planner/recommender/generator" — outputs widened
      /\b(?:meal|recipe|workout|movie|book|gift|outfit|trip|itinerary|playlist|exercise|reading|date|travel)\s+(?:planner|recommender|suggestion|generator|optimizer|picker)\b/i,
      // Preference signals widened
      /\bbased\s+on\s+(?:my\s+)?(?:mood|taste|preferences?|history|location|weather|fridge|pantry|ingredients?|interests?|budget|goals?|fitness|macros?|level|skill|schedule)\b/i,
      /\bwhat'?s\s+in\s+my\s+(?:fridge|pantry|kitchen|closet|library|wardrobe)\b/i,
      // Macro/fitness adjusters
      /\b(?:tracks?|adjusts?)\s+(?:my\s+)?(?:macros?|workout|exercise|calories|fitness)\b.*\b(?:and|then|to)\b/i,
      // Trip/itinerary planners
      /\bplans?\s+(?:my\s+)?(?:trip|itinerary|route|day|week|vacation)\b/i,
    ],
    inferDomains: ["llm", "backend", "embeddings-rag"],
    inferFrameworks: [],
    inferLanguage: "typescript", // Recommendation apps are usually UI-heavy (Next.js, RN, etc.)
    inferGoal: null,
    preferredDataStore: "postgres",
  },
  // ────────────────────────────────────────────────────────────────────
  // SMB / freelancer archetypes
  // ────────────────────────────────────────────────────────────────────
  {
    id: "inbox-autoresponder",
    label: "Inbox autoresponder / lead follow-up",
    summary:
      "An automation that watches your inbox (email, Etsy, Shopify, Google reviews) and sends contextual replies or follow-ups.",
    technicalParts: [
      "Inbox connector (Gmail/Outlook OAuth, Etsy/Shopify webhook, Google Business API)",
      "Trigger router (new message, no-reply timer, review posted)",
      "Brand-voice prompt + LLM reply generation",
      "Draft-vs-send mode (review queue or auto-send rules)",
      "Persistence (conversation history, dedup, opt-outs)",
      "Scheduling for follow-up cadence",
      "Compliance (CAN-SPAM, opt-out links, do-not-contact list)",
      "Optional: human handoff when confidence is low",
    ],
    exampleStack:
      "Python or TS + Gmail API / Etsy API + LLM provider + Postgres + cron / Cloud Run",
    patterns: [
      /\bauto[\s-]?(?:respond|reply|replies)\b.*\b(?:email|message|messages|inbox|customer|review|reviews|comments?)/i,
      /\b(?:auto[\s-]?(?:respond|reply)|automat(?:ed|e)\s+(?:replies|responses?))/i,
      /\bfollow[\s-]?ups?\b.*\b(?:leads?|customers?|prospects?|emails?|clients?)/i,
      /\b(?:didn'?t|didnt|haven'?t)\s+(?:reply|respond)/i,
      /\b(?:reach\s+out|nudge|chase)\b.*\b(?:leads?|customers?|prospects?)/i,
      /\breply\s+to\b.*\b(?:reviews?|customers?|messages?)/i,
    ],
    inferDomains: ["llm", "automation", "backend", "auth"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "automation",
    preferredDataStore: "postgres",
  },
  {
    id: "scheduled-publisher",
    label: "Scheduled publisher (social / newsletter)",
    summary:
      "Posts content to social platforms or sends newsletters on a schedule, often pulled from a notes/CMS source.",
    technicalParts: [
      "Source ingestion (Notion, Google Docs, markdown, RSS)",
      "Content transformation (LLM rewrite per platform: short for Twitter, long for LinkedIn, etc.)",
      "Platform APIs (Buffer, Hootsuite, native Instagram Graph API, Mailchimp/Beehiiv)",
      "Scheduling (cron, queue, time-zone aware)",
      "Asset handling (image resize per platform, OG cards)",
      "Audit log + retry on failures",
      "Approval workflow (draft → publish)",
    ],
    exampleStack:
      "TypeScript + Buffer/native APIs + cron / Inngest + Postgres + Notion API",
    patterns: [
      /\b(?:posts?|publish(?:es|ing)?|sends?)\b.*\b(?:on\s+a\s+schedule|every\s+\w+|daily|weekly|tuesday|monday)/i,
      /\b(?:schedule(?:s|d|r)?|scheduled?)\s+(?:posts?|publishing|posting|sending|emails?|tweets?)/i,
      /\b(?:newsletter|email\s+(?:list|campaign))\b.*\b(?:every|daily|weekly|automate|schedule)/i,
      /\bposts?\s+to\s+(?:my\s+)?(?:instagram|tiktok|facebook|twitter|x|linkedin|threads|bluesky|mastodon)/i,
      /\b(?:cross[\s-]?post|multi[\s-]?platform\s+post)/i,
    ],
    inferDomains: ["automation", "llm", "backend", "database"],
    inferFrameworks: [],
    inferLanguage: "typescript",
    inferGoal: "automation",
    preferredDataStore: "postgres",
  },
  {
    id: "lead-prospector",
    label: "Lead prospector / sales-research bot",
    summary:
      "Finds and enriches leads (LinkedIn, Apollo, Google Maps, Sales Navigator), exports to a CRM or sheet.",
    technicalParts: [
      "Source connector (Apollo / Sales Nav / LinkedIn / Google Maps / Crunchbase)",
      "Search filter builder (industry, role, geography, signal)",
      "Enrichment (email finder, company info, recent funding)",
      "Dedup against existing CRM",
      "Export to CRM (HubSpot, Pipedrive, Salesforce) or Sheets",
      "Throttling + rotating proxies (anti-detection)",
      "Compliance (GDPR, CCPA — opt-out lists)",
    ],
    exampleStack:
      "Python + Playwright (for site scraping) + Apollo/Hunter API + HubSpot API + Postgres",
    patterns: [
      /\b(?:find(?:s|ing)?|generate|prospect(?:ing|s)?|scrape|gather)\b.*\b(?:leads?|prospects?|contacts?)/i,
      /\bleads?\b.*\b(?:on|from|via)\s+(?:linkedin|apollo|sales\s+nav|google\s+maps?|crunchbase)/i,
      /\b(?:linkedin|apollo|sales\s+nav)\s+(?:scrap(?:er|ing)|prospector|lead\s+gen)/i,
      /\blead\s+(?:gen(?:eration)?|prospector|finder|hunter)\b/i,
    ],
    inferDomains: ["scraping", "automation", "backend", "database"],
    inferFrameworks: ["playwright"],
    inferLanguage: "python",
    inferGoal: "data_pipeline",
    preferredDataStore: "postgres",
  },

  // ────────────────────────────────────────────────────────────────────
  // Education
  // ────────────────────────────────────────────────────────────────────
  {
    id: "study-aid-generator",
    label: "Study aid / flashcard / quiz generator",
    summary:
      "Ingests learning material (PDFs, lectures, notes, textbooks) and produces flashcards, quizzes, or spaced-repetition decks.",
    technicalParts: [
      "PDF / transcript ingestion + chunking",
      "LLM Q→A pair generation (or cloze deletion)",
      "Deck export (Anki .apkg, CSV for Quizlet, JSON)",
      "Spaced-repetition scheduling (SM-2, FSRS)",
      "Optional review UI (web or mobile)",
      "Persistence (cards, review history, scheduling state)",
      "Card-quality filtering (LLM-as-judge to drop weak cards)",
    ],
    exampleStack:
      "Python + PyPDF + OpenAI/Ollama + genanki + SQLite + Streamlit (optional UI)",
    patterns: [
      /\b(?:flashcards?|flash[\s-]?cards?|quiz(?:zes)?|study\s+(?:aids?|guides?)|anki\s+deck)\s+(?:generator|builder|maker|creator)/i,
      /\b(?:generate|create|build|make)\b.*\b(?:flashcards?|quiz(?:zes)?|anki|study\s+(?:aid|guide))/i,
      /\b(?:study|learn(?:ing)?|memori[sz]e)\b.*\b(?:from|out\s+of)\s+(?:my\s+)?(?:lecture|textbook|pdf|notes?|book|chapter)/i,
      /\b(?:spaced[\s-]?repetition|sm[\s-]?2|fsrs)/i,
    ],
    inferDomains: ["llm", "embeddings-rag", "backend"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "automation",
    preferredDataStore: "sqlite", // Anki + study apps typically use SQLite
  },

  // ────────────────────────────────────────────────────────────────────
  // Developer / DevOps tooling
  // ────────────────────────────────────────────────────────────────────
  {
    id: "ci-bot",
    label: "CI / PR-automation bot",
    summary:
      "Reacts to git events (PR opened, push, label added) — runs jobs, posts checks/comments, opens follow-up PRs.",
    technicalParts: [
      "GitHub/GitLab webhook receiver or App",
      "Octokit/PyGithub client + auth (App token or PAT)",
      "Status-check / commit-status API",
      "PR comment / review API",
      "Job runner (workflow dispatch, container, or local CLI)",
      "Persistence for run history",
      "Rate-limit + retry handling",
      "Secrets management for tokens",
    ],
    exampleStack:
      "TypeScript + Probot/Octokit + GitHub Actions + Vercel/Cloudflare Workers (webhook) + KV/Postgres",
    patterns: [
      /\b(?:bot|app|action|tool)\b.*\b(?:pull[\s-]?request|pr|merge|commit)\b.*\b(?:github|gitlab|bitbucket|status\s+check|comment|review)/i,
      /\b(?:auto[\s-]?generate|generates?)\b.*\b(?:changelogs?|release\s+notes?)/i,
      /\bci\s+matrix\b/i,
      /\b(?:opens?|creates?)\s+(?:upgrade\s+|patch\s+|fix\s+)?prs?\b/i,
      /\b(?:reviews?|comments?\s+on|leaves?\s+comments?\s+on)\s+(?:my\s+)?prs?\b/i,
      /\bgithub\s+(?:bot|app|action)\b.*\b(?:pr|merge|push|label)/i,
      /\b(?:depend(?:abot|ency)|outdated\s+deps?|upgrade\s+deps?)/i,
    ],
    inferDomains: ["git-vcs", "devops", "automation", "backend"],
    inferFrameworks: [],
    inferLanguage: "typescript",
    inferGoal: "automation",
  },
  {
    id: "static-analysis-tool",
    label: "Static analysis / code-scanning tool",
    summary:
      "Walks a codebase and surfaces issues — dead code, secret leaks, anti-patterns, license issues — emitting a report or annotations.",
    technicalParts: [
      "Repo discovery + file glob",
      "Language-aware parser (tree-sitter, AST modules)",
      "Rule engine (regex + semantic checks)",
      "Ignore-list / config (.scanignore, glob patterns)",
      "SARIF or JSON report output",
      "Pre-commit / CI integration",
      "Incremental scanning (only changed files)",
      "Performance optimization for large repos",
    ],
    exampleStack:
      "Rust or Go (for speed) OR Python with ast/tree-sitter — depends on the languages being scanned",
    patterns: [
      /\b(?:dead\s+code|unused\s+(?:imports?|code|deps?|exports?)|code\s+smell|anti[\s-]?pattern)/i,
      /\b(?:scan|detect|find|hunt(?:s|ing)?)\b.*\b(?:leaked|exposed|hardcoded|secrets?|api\s+keys?|credentials?|tokens?)/i,
      /\bpre[\s-]?commit\s+hook\b.*\b(?:scans?|checks?|lints?|secrets?|formats?)/i,
      /\b(?:semantic|ast|tree[\s-]?sitter)\s+code\s+(?:search|analysis|scan)/i,
      /\b(?:lint(?:er|ing)?|static\s+analysis|sast)\b.*\b(?:tool|cli|builds?|writes?)/i,
      /\b(?:vulnerab|cve)\b.*\b(?:scanner?|detect)/i,
    ],
    inferDomains: ["filesystem", "git-vcs", "security", "automation"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "cli_tool",
  },
  {
    id: "infra-ops-tool",
    label: "Infra / DevOps operator tool",
    summary:
      "CLI or daemon that operates on cloud / container infrastructure — kubectl wrappers, Terraform inspectors, Docker orchestrators.",
    technicalParts: [
      "Infra SDK or CLI shell-out (kubectl, aws-cli, terraform, docker)",
      "Auth (kubeconfig, AWS creds, service accounts, OIDC)",
      "Concurrent log/event streaming (multi-pod, multi-region)",
      "Diff / state-comparison logic",
      "TUI or formatted CLI output (Bubble Tea, rich)",
      "Safe-mode / dry-run flag",
      "Config file (YAML)",
      "Credential refresh + caching",
    ],
    exampleStack:
      "Go + cobra + Kubernetes / AWS / Terraform Go SDKs + Bubble Tea (TUI)",
    patterns: [
      /\b(?:kubernetes|k8s|kubectl)\b.*\b(?:logs?|pods?|tail|events?|deploy(?:ments?)?)/i,
      /\b(?:terraform|pulumi|cdk|opentofu)\b.*\b(?:drift|diff|state|plan|apply)/i,
      /\bdocker[\s-]?compose\b.*\b(?:manage|orchestrat|start|stop|local|dev|environment)/i,
      /\b(?:cli|tool|daemon)\b.*\b(?:k8s|kubernetes|aws|gcp|azure|cluster|infra)/i,
      /\bmanages?\s+my\s+(?:local\s+)?(?:dev\s+)?(?:environments?|env|envs)\b/i,
      /\b(?:tail|stream|aggregate)\s+logs?\s+from\b/i,
      // Docker image analysis (Dive-style)
      /\b(?:analy[sz]e(?:s|d)?|inspect(?:s|ing)?)\b.*\bdocker\s+images?\b/i,
      /\bdocker\s+image\s+(?:layer|size|bloat|analy)/i,
      /\bwhich\s+layers?\s+are\s+(?:bloated|big|large)/i,
    ],
    inferDomains: ["deployment", "docker", "devops", "observability"],
    inferFrameworks: [],
    inferLanguage: "go",
    inferGoal: "cli_tool",
  },
  {
    id: "db-tooling",
    label: "Database tooling / schema management",
    summary:
      "Operates on databases — schema diff, migration generation, data masking, query analysis, prod/staging comparison.",
    technicalParts: [
      "DB driver per dialect (psycopg, mysql2, sqlite3)",
      "Information_schema / pg_catalog introspection",
      "Migration DSL or SQL emitter",
      "Connection-pool + SSL handling",
      "Safe diffing (don't drop unless explicit)",
      "Dry-run output + plan preview",
      "Optional data masking for staging mirrors",
    ],
    exampleStack:
      "Go (Atlas, sqldef) or Python (alembic/migra) + appropriate DB driver",
    patterns: [
      /\b(?:diffs?|compares?|drift)\b.*\b(?:databases?|schemas?|postgres|mysql|sqlite|prod\s+and\s+staging)/i,
      /\b(?:schema|migration)\s+(?:diff|drift|generator|tool|management)/i,
      /\bdb\s+(?:diff|migration|tool)/i,
      /\b(?:staging|prod(?:uction)?)\b.*\b(?:database|db|schema)\b.*\b(?:diff|sync|compare)/i,
    ],
    inferDomains: ["database", "backend", "devops"],
    inferFrameworks: [],
    inferLanguage: "go",
    inferGoal: "cli_tool",
  },
  {
    id: "api-tooling",
    label: "API tooling (mock / SDK gen / spec validation)",
    summary:
      "Consumes an OpenAPI/GraphQL spec and produces a mock server, client SDK, types, or validation report.",
    technicalParts: [
      "Spec parser (OpenAPI 3, Swagger 2, GraphQL SDL)",
      "Request matcher + example responder (Prism-style)",
      "Codegen templates (Mustache/Handlebars or AST-based)",
      "CLI scaffolder",
      "Watch-mode hot reload",
      "Auth simulation (OAuth, API key)",
    ],
    exampleStack:
      "TypeScript + Prism / openapi-generator + Commander/Yargs",
    patterns: [
      /\b(?:openapi|swagger|graphql)\s+(?:spec|schema|definition)/i,
      /\bmock\s+(?:api\s+)?server\b/i,
      /\b(?:sdk|client)\s+(?:gen(?:erator)?|generation)\b/i,
      /\bspins?\s+up\s+a\s+(?:mock|fake|stub)/i,
    ],
    inferDomains: ["backend", "automation"],
    inferFrameworks: [],
    inferLanguage: "typescript",
    inferGoal: "cli_tool",
  },
  {
    id: "test-tooling",
    label: "Test-suite tooling (flaky-test detection / coverage)",
    summary:
      "Operates on a test suite — finds flakes, ranks slow tests, generates fixtures, surfaces coverage trends.",
    technicalParts: [
      "Test-runner integration (Jest/Pytest/Vitest reporters)",
      "junit.xml / coverage parsing",
      "Statistical re-run + quarantine logic",
      "Result persistence (across CI runs)",
      "PR-comment / dashboard reporter",
      "Flake-rate computation (% over N runs)",
    ],
    exampleStack:
      "TypeScript or Python + jest/pytest reporters + Postgres + GitHub Actions integration",
    patterns: [
      /\b(?:flaky|flake|flak(?:ey|ier))\s+tests?\b/i,
      /\b(?:test|coverage)\s+(?:dashboard|report|tracker|tool|trend)/i,
      /\b(?:re[\s-]?runs?|quarantines?)\s+(?:failed\s+)?tests?\b/i,
      /\bslow(?:est)?\s+tests?\b.*\b(?:rank|find|profile)/i,
    ],
    inferDomains: ["testing", "automation", "observability"],
    inferFrameworks: [],
    inferLanguage: "typescript",
    inferGoal: "cli_tool",
    preferredDataStore: "postgres", // test-tooling: cross-CI persistence
  },

  // ────────────────────────────────────────────────────────────────────
  // Creative / hobbyist
  // ────────────────────────────────────────────────────────────────────
  {
    id: "image-generator",
    label: "Image / visual content generator",
    summary:
      "Takes input (text, photo, sketch) and produces stylized images using diffusion models or vision LLMs.",
    technicalParts: [
      "Input handling (text prompt, image upload, sketch capture)",
      "Diffusion model (Stable Diffusion / SDXL / Flux) — local GPU or hosted API",
      "ControlNet / LoRA conditioning (style, pose, depth)",
      "Output post-processing (upscaling, GIF/MP4 stitching for animation)",
      "Storage (S3 / R2 for images)",
      "Optional: gallery UI",
      "Cost / quota tracking (if hosted API)",
    ],
    exampleStack:
      "Python + diffusers / ComfyUI / Replicate API + S3 + FastAPI/Streamlit",
    patterns: [
      // "stylized comic book panels" — allow optional adjective before output noun
      /\b(?:turns?|converts?|transforms?)\s+(?:my\s+)?(?:\w+\s+)?(?:doodles?|sketches?|photos?|images?|drawings?)\s+(?:into|to)\s+(?:a\s+|the\s+|stylized\s+|\w+\s+)?(?:pixel\s?art|comic|cartoon|anime|painting|gif|sticker|3d|panel|panels)/i,
      /\b(?:generate|generator|create)\b.*\b(?:images?|pixel\s?art|stickers?|comic|tattoo|flash\s+sheet|thumbnails?|wallpapers?|avatars?|cover\s+art)/i,
      /\b(?:stable[\s-]?diffusion|midjourney|dall[\s-]?e|sdxl|flux|controlnet|comfy[\s-]?ui)\b/i,
      // Animates: handle "es" form
      /\b(?:animat(?:e|es|ing|ion)|loop(?:ing)?\s+gif)\b.*\b(?:sketch|character|drawing|photo|gif)/i,
      /\bdesign(?:s|ing)?\s+(?:tattoo|posters?|logos?|covers?)\b.*\b(?:from|using|with|via)\s+(?:text|prompts?)/i,
    ],
    inferDomains: ["image-vision", "llm", "backend", "automation"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "automation",
  },
  {
    id: "music-tool",
    label: "Music / audio analysis or generation tool",
    summary:
      "Analyzes or generates musical content — pitch detection, transcription, chord/melody suggestion, beat generation, practice feedback.",
    technicalParts: [
      "Audio I/O (microphone capture, file upload)",
      "DSP library (librosa, aubio, essentia) for pitch/beat/key detection",
      "Optional ML model (Magenta, Demucs, Music Source Separation)",
      "MIDI generation (mido) or notation rendering (LilyPond, music21)",
      "Real-time feedback loop (low-latency processing)",
      "Persistence (practice history, generated stems)",
      "Optional UI (web with Tone.js for playback)",
    ],
    exampleStack:
      "Python + librosa + Magenta + mido + WebMIDI + FastAPI",
    patterns: [
      // Allow hyphen between noun and tool-word: "chord-progression suggester"
      /\b(?:chord|melody|tab|tabs|riff|drum|beat|bassline|midi|metronome)[\s-]+(?:generator|suggester|tracker|maker|builder|engine|progression)/i,
      // "Chord-progression suggester" — handle the compound noun
      /\bchord[\s-]progression[\s-](?:generator|suggester|recommender|builder|maker)/i,
      /\b(?:music|guitar|piano|bass|drum|vocal)\s+(?:practice|trainer|tutor|tracker|coach)/i,
      /\b(?:humm(?:ed|ing)|sing(?:s|ing)?|whistle)\b.*\b(?:melody|tab|notation|score|chord)/i,
      /\bdrum\s+machine\b/i,
      /\b(?:listens?\s+through|listening\s+to)\s+(?:my\s+)?(?:microphone|mic)\b.*\b(?:scales?|notes?|chord|pitch|tempo)/i,
      /\b(?:chord|key|tempo|pitch)\s+(?:detection|analysis|recogniz)/i,
      /\bsongwriter\b/i,
    ],
    inferDomains: ["voice-audio", "llm", "backend"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: null,
  },
  {
    id: "creative-coding",
    label: "Creative coding / generative art",
    summary:
      "Real-time visual or audio art piece — Processing, p5.js, Three.js, TouchDesigner, openFrameworks. Often interactive.",
    technicalParts: [
      "Rendering layer (p5.js / Three.js / shader / canvas)",
      "Input source (microphone / camera / OSC / MIDI / mouse / live data)",
      "Frame loop / animation system",
      "Audio reactivity (FFT, pitch tracking)",
      "Shader pipeline (GLSL / WGSL)",
      "Optional: recording / capture for output",
    ],
    exampleStack:
      "TypeScript + Three.js + p5.js + Tone.js + Vite (or Processing/openFrameworks for desktop)",
    patterns: [
      /\b(?:generative|procedural|algorithmic)\s+(?:art|visuals?|animation|graphics?)/i,
      /\b(?:p5\.?js|processing|openframeworks|touchdesigner|shadertoy|cables\.gl|three\.?js|hydra)\b/i,
      /\b(?:interactive|live)\s+(?:art|visuals?|installation|piece)/i,
      /\b(?:art\s+piece|visual\s+piece|installation|visualizer)\b.*\b(?:responds?|reacts?|listens?)/i,
    ],
    inferDomains: ["frontend", "image-vision", "voice-audio"],
    inferFrameworks: [],
    inferLanguage: "typescript",
    inferGoal: null,
  },
  {
    id: "game-mod",
    label: "Game mod / extension / plugin",
    summary:
      "An add-on for an existing game — Minecraft mod, Roblox script, Skyrim plugin, etc. Distinct from a from-scratch game.",
    technicalParts: [
      "Host-game modding API / SDK (Forge, Fabric, Roblox Studio, SKSE, etc.)",
      "Asset pipeline (textures, models, sounds → game-native formats)",
      "Lifecycle hooks (on tick, on entity spawn, on use, etc.)",
      "Persistence (save data, world state)",
      "LLM integration (if AI dialogue / behavior is mentioned)",
      "Distribution (CurseForge / Modrinth / Roblox Marketplace)",
      "Compatibility / version management",
    ],
    exampleStack:
      "Java (Minecraft Forge/Fabric) or Lua (Roblox) or Papyrus (Skyrim) — host-dependent",
    patterns: [
      /\b(?:minecraft|roblox|skyrim|fallout|hytale|terraria|stardew|factorio|valheim|gta|the\s+sims)\s+(?:mod|plugin|addon|add[\s-]?on|extension|script)/i,
      /\bmod(?:s|ding)?\s+(?:for|in)\s+(?:minecraft|roblox|skyrim|hytale|fallout)/i,
      /\b(?:adds?|add)\b.*\b(?:custom\s+(?:npcs?|items?|biomes?|blocks?|mobs?)|new\s+(?:mobs?|recipes?|dimensions?|enchantments?))/i,
    ],
    inferDomains: ["game-dev", "filesystem"],
    inferFrameworks: [],
    inferLanguage: "java", // Minecraft has the largest modding fanbase; we'll guess wrong on Roblox/Skyrim but it's a defensible default
    inferGoal: null,
  },
  {
    id: "procedural-generator",
    label: "Procedural generator / game-content toolkit",
    summary:
      "Generates game content algorithmically — dungeons, maps, names, loot tables, terrain, quests. Often a library, not a full game.",
    technicalParts: [
      "Seed-based RNG (deterministic, reproducible)",
      "Noise functions (Perlin, simplex, voronoi)",
      "Generation algorithm (BSP, cellular automata, wave function collapse)",
      "Constraint satisfaction (loot balance, room connectivity)",
      "Visualization / preview output",
      "Export format (JSON, image, game-engine asset)",
    ],
    exampleStack:
      "Python + tcod / numpy + matplotlib (preview) — or TS + Phaser/Pixi for visual procgen",
    patterns: [
      /\bproc(?:edurally|edural)\b.*\b(?:generat|creat|build)/i,
      /\b(?:dungeon|map|terrain|level|world|name|quest|loot)\s+generator/i,
      /\b(?:roguelike|rogue[\s-]?lite|metroidvania)\b.*\b(?:generat|procedural|dungeon|map)/i,
      /\bloot\s+tables?\b/i,
    ],
    inferDomains: ["game-dev", "automation"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "library",
  },
  {
    id: "creative-writing-assistant",
    label: "Creative writing / worldbuilding assistant",
    summary:
      "LLM-powered helper for fiction, TTRPGs, or worldbuilding — tracks characters, lore, continuity, plot beats. Drafts scenes or campaign material.",
    technicalParts: [
      "Long-form context management (story bible, OC profiles, world canon)",
      "Vector store for lore retrieval (so LLM can quote canon accurately)",
      "Continuity checker (flag canon contradictions)",
      "Scene/chapter drafter (LLM with bible context)",
      "Plot-beat / pacing tracker",
      "Optional: collaborative editor",
    ],
    exampleStack:
      "Python + LlamaIndex (lore RAG) + LLM API + FastAPI + SQLite or pgvector",
    patterns: [
      /\b(?:fanfic(?:tion)?|fiction|novel|screenplay|script|story|worldbuild(?:ing)?|lore|narrative)\b.*\b(?:co[\s-]?writer|writer|drafter|assistant|helper|generator)/i,
      /\b(?:d&amp;d|dnd|dungeons?\s+&amp;?\s+dragons?|pathfinder|ttrpg|tabletop\s+rpg|gm|dungeon\s+master|game\s+master)\b.*\b(?:notes?|campaign|session|prep|tools?|assistant|drafts?)/i,
      /\b(?:character|oc|world)\s+(?:continuity|consistency|bible|tracker|sheet|sheets?)/i,
      /\b(?:campaign|session)\s+(?:notes?|recap|summary|prep)/i,
      /\bdrafts?\b.*\b(?:campaign|session|chapter|scene|story|plot)/i,
    ],
    inferDomains: ["llm", "embeddings-rag", "backend"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "automation",
    preferredDataStore: "postgres", // creative-writing-assistant: lore + bible storage
  },

  {
    id: "booking-payment-app",
    label: "Booking / scheduling app with payment",
    summary:
      "A web app where customers see your availability, pick a time slot, and pay — Calendly-with-payment, AppointMint-style.",
    technicalParts: [
      "Calendar / availability management (admin sets working hours, blocks)",
      "Public booking page (customers pick time slot)",
      "Payment integration (Stripe Checkout, PayPal)",
      "Email + SMS confirmations + reminders",
      "Calendar sync (Google Calendar, Outlook, iCal)",
      "Buffer time + double-booking prevention",
      "Admin dashboard (upcoming bookings, payments, refunds)",
      "Optional: client intake form before payment",
    ],
    exampleStack:
      "Next.js + Cal.com or Calendly API + Stripe Checkout + Postgres + Resend (email)",
    patterns: [
      /\b(?:appointment|booking|reservation|scheduling)\s+(?:page|app|tool|platform|system)\b/i,
      /\bbooks?\s+(?:my\s+)?(?:clients?|customers?|appointments?|reservations?)\b.*\b(?:and|then)\b/i,
      /\b(?:clients?|customers?)\s+(?:pick|choose|book|select)\s+(?:a\s+)?time\b/i,
      /\b(?:pay|pays|payment|paid)\b.*\b(?:appointment|booking|reservation)/i,
      /\b(?:calendly|cal\.com|appointmint|squarespace\s+scheduling)[\s-]?(?:like|alternative|clone)\b/i,
    ],
    inferDomains: ["frontend", "backend", "auth", "database", "automation", "financial"],
    inferFrameworks: ["nextjs"],
    inferLanguage: "typescript",
    inferGoal: "web_app",
    preferredDataStore: "postgres",
  },
  {
    id: "generic-automation-app",
    label: "Generic automation / 'app that does X for me'",
    summary:
      "A goal-oriented automation: you described a task you want offloaded to an app or bot, but didn't name a specific platform or technology. We've inferred the broad shape so you have a starting point — refining the description (with a platform, language, or specific data source) will tighten the recommendations.",
    technicalParts: [
      "Trigger source (schedule, webhook, manual, event-driven)",
      "Input adapter (where the data or action originates)",
      "Decision logic (rule-based or LLM-driven)",
      "External integrations (APIs the task touches)",
      "Output / side-effects (notifications, writes, calls, posts)",
      "Persistence (state, history, dedup)",
      "Hosting (cron, serverless, always-on worker)",
      "Observability (did the run succeed? alert me if not)",
    ],
    exampleStack:
      "Python or TypeScript + n8n / Zapier / cron + an LLM API + the platform API you're integrating with + a small DB",
    patterns: [
      // This is the fallback — must match LAST in the array. Catches generic
      // "an app/bot/tool/thing that does X" phrasing where no specific archetype fired.
      // Broadened from earlier version to also catch "page where", "system that",
      // "build me an app that ___ automatically" (without that/to/for connector).
      /\b(?:an?|build(?:ing)?|i\s+want|i'?d\s+like|create|make)\s+(?:an?\s+)?(?:app|bot|tool|thing|system|service|agent|script|page|dashboard|platform)\b/i,
      /\b(?:automat(?:e|ing|ion)|do(?:es)?\s+\w+\s+for\s+me|takes?\s+care\s+of|handles?)\b/i,
      /\b(?:an?\s+)?(?:app|bot|tool|service|system)\s+(?:for|to|that)\s+(?:my|me|our|us)\b/i,
      // "Something that ___" — vague but goal-oriented
      /\b(?:something|anything)\s+(?:that|to|which)\b/i,
    ],
    inferDomains: ["automation", "llm", "backend"],
    inferFrameworks: [],
    inferLanguage: "python", // Default for the generic fallback — Python is the most catalog-friendly automation language
    inferGoal: "automation",
  },
];

function detectArchetype(desc: string): ArchetypeDef | null {
  for (const a of ARCHETYPES) {
    if (a.patterns.some((rx) => rx.test(desc))) return a;
  }
  return null;
}

/**
 * Public read-only view of the archetypes — exposed so the UI / LLM
 * refinement layer can list valid archetype ids and labels without
 * needing access to the internal pattern arrays.
 *
 * Applies defaults for the optional fields:
 *   usesMcpDirectly: false (most apps don't depend on the MCP catalog as
 *     a core dep — overridden true for ai-agent-app, where MCP is the
 *     dominant agent-tool protocol)
 *   preferredDataStore: null (no preference) — overridden per archetype
 *     when its example_stack implies a specific DB family
 */
export const ARCHETYPE_CATALOG: ProjectArchetype[] = ARCHETYPES.map((a) => ({
  id: a.id,
  label: a.label,
  summary: a.summary,
  technicalParts: a.technicalParts,
  exampleStack: a.exampleStack,
  usesMcpDirectly: a.usesMcpDirectly ?? false,
  preferredDataStore: a.preferredDataStore ?? null,
  essentialLibraries: a.essentialLibraries ?? [],
}));

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
  const deployTarget = detectFirstMatch<DeployTarget>(desc, DEPLOY_TARGET_PATTERNS, "unknown");
  let goal = detectFirstMatch<GoalType>(desc, GOAL_PATTERNS, "general");
  const domains = detectAllMatches<string>(desc, DOMAIN_PATTERNS);

  // Archetype detection: when the user has described WHAT they want to build
  // in plain English (no technologies named), match against known project
  // shapes and INFER the technical signals their idea implies.
  // The archetype is exposed on the profile so the UI can render the
  // technical breakdown — and its inferred domains/frameworks/language
  // populate the standard fields downstream layers consume.
  const archetypeMatch = detectArchetype(desc);
  if (archetypeMatch) {
    // Inferred domains augment (don't replace) explicit ones
    for (const d of archetypeMatch.inferDomains) {
      if (!domains.includes(d)) domains.push(d);
    }
    // Inferred frameworks augment baseProfile.frameworks (only if base is empty)
    for (const fw of archetypeMatch.inferFrameworks) baseProfile.frameworks.add(fw);
    // Inferred goal only fills the "general" fallback
    if (goal === "general" && archetypeMatch.inferGoal) goal = archetypeMatch.inferGoal;
  }

  // Detect frameworks from description text. This populates baseProfile.frameworks
  // for paste-mode prompts (where lib/analyze.ts can't see a real codebase).
  // The architect previously had no framework detection at all from text — every
  // paste-mode prompt got frameworks=[] regardless of whether the user wrote
  // "Django" or "Next.js" verbatim.
  const detectedFrameworks: Array<[string, string | null]> = [];
  for (const [fw, langHint, rxs] of FRAMEWORK_PATTERNS) {
    if (rxs.some((rx) => rx.test(desc))) {
      detectedFrameworks.push([fw, langHint]);
      baseProfile.frameworks.add(fw);
    }
  }

  // Detect primary language from description text (only when code didn't tell us)
  let descLanguage: string | null = null;
  if (!baseProfile.primaryLanguage) {
    descLanguage = detectFirstMatch<string | null>(
      desc,
      LANGUAGE_PATTERNS.map(([l, rxs]) => [l, rxs]) as Array<[string | null, RegExp[]]>,
      null,
    );
    // Framework-based fallback inference: if no explicit language was detected
    // but a framework with a strong language hint was, use the framework's hint.
    // (e.g. "Django" → python, "React Native" → typescript, "Hardhat" → solidity)
    if (!descLanguage) {
      for (const [, langHint] of detectedFrameworks) {
        if (langHint) {
          descLanguage = langHint;
          break;
        }
      }
    }
    // Archetype-based fallback inference: if neither explicit language nor a
    // framework gave us a hint, fall back to the archetype's typical language.
    // (e.g. "trading app" → python, "social app" → typescript)
    if (!descLanguage && archetypeMatch?.inferLanguage) {
      descLanguage = archetypeMatch.inferLanguage;
    }
    if (descLanguage) {
      baseProfile.primaryLanguage = descLanguage;
      baseProfile.languages = { ...baseProfile.languages, [descLanguage]: 1 };
    }
  }

  // Boost the base profile's keyword bag with detected signals
  const merged = new Set(baseProfile.keywords);
  for (const d of domains) merged.add(d);
  if (targetAgent !== "unknown") merged.add(targetAgent);
  if (platform !== "unknown") merged.add(platform);
  if (deployTarget !== "unknown") merged.add(deployTarget);
  for (const [fw] of detectedFrameworks) merged.add(fw);

  // Token bag = everything stack-builder might use for matching.
  // Now also includes detected frameworks so framework-name boost can fire.
  const tokens = new Set<string>();
  for (const t of profileToTags(baseProfile)) tokens.add(t);
  for (const d of domains) tokens.add(d);
  if (targetAgent !== "unknown") tokens.add(targetAgent);
  if (deployTarget !== "unknown") tokens.add(deployTarget);
  for (const [fw] of detectedFrameworks) tokens.add(fw);
  // Surface critical booleans as tokens so tag-overlap scoring can use them
  if (/\bmcp\b/i.test(desc)) { tokens.add("mcp"); tokens.add("mcp-server"); }
  if (/\b(tdd|test[\s-]?driven|red[\s-]?green)\b/i.test(desc)) tokens.add("tdd");
  if (/\bcode[\s-]?review\b/i.test(desc)) tokens.add("code-review");

  // If description mentions docker/tests/MCP and base profile didn't catch it,
  // promote the boolean. hasTests is now broader: matches "test coverage",
  // "test suite", "unit tests", "e2e tests" — not just "tests" / "testing".
  const hasDocker = baseProfile.hasDocker || /\bdocker\b/i.test(desc);
  const hasMcp = baseProfile.hasMcp || /\bmcp\b/i.test(desc);
  const hasTests =
    baseProfile.hasTests ||
    /\btest(s|ing|[\s-]driven)\b/i.test(desc) ||
    /\btest\s+(coverage|suite|harness|case|fixtures?)\b/i.test(desc) ||
    /\b(unit|integration|e2e|end[\s-]?to[\s-]?end)\s+tests?\b/i.test(desc) ||
    /\b(pytest|jest|vitest|cypress|playwright\s+test)\b/i.test(desc);

  // Strip the internal pattern array before exposing the archetype on the
  // profile (UI doesn't need to see the regex bag). Apply defaults for the
  // optional usesMcpDirectly / preferredDataStore fields so consumers don't
  // have to handle undefined.
  const archetype: ProjectArchetype | null = archetypeMatch
    ? {
        id: archetypeMatch.id,
        label: archetypeMatch.label,
        summary: archetypeMatch.summary,
        technicalParts: archetypeMatch.technicalParts,
        exampleStack: archetypeMatch.exampleStack,
        usesMcpDirectly: archetypeMatch.usesMcpDirectly ?? false,
        preferredDataStore: archetypeMatch.preferredDataStore ?? null,
        essentialLibraries: archetypeMatch.essentialLibraries ?? [],
      }
    : null;

  return {
    ...baseProfile,
    description: desc,
    targetAgent,
    platform,
    deployTarget,
    goal,
    domains,
    tokens,
    keywords: merged,
    hasDocker,
    hasMcp,
    hasTests,
    archetype,
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
    deployTarget: fromDescription.deployTarget,
    archetype: fromDescription.archetype,
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
  build_extension: "Build an IDE extension",
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

export const DEPLOY_TARGET_LABELS: Record<DeployTarget, string> = {
  web: "Web app",
  mobile: "Mobile app",
  desktop: "Desktop app",
  server: "Server / backend",
  cli: "CLI tool",
  unknown: "Not detected",
};
