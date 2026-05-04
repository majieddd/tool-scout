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
  ["financial", [/\b(financial|trading|stocks?|bank(ing)?)\b/i]],
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
  ["library", [/\b(library|sdk|package|module)\b.*\b(for|to)\b/i]],
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
type ArchetypeDef = ProjectArchetype & {
  patterns: RegExp[];
  inferDomains: string[];
  inferFrameworks: string[];
  inferLanguage: string | null;
  inferGoal: GoalType | null;
};

const ARCHETYPES: ArchetypeDef[] = [
  {
    id: "stock-trading-app",
    label: "Algorithmic / automated trading app",
    summary:
      "An always-on bot that ingests market data, makes trading decisions, and executes orders against a brokerage API.",
    technicalParts: [
      "Market data ingestion (real-time quotes + historical bars)",
      "Brokerage API integration (Alpaca, Interactive Brokers, Tradier, etc.)",
      "Strategy / decision engine (signals, position sizing)",
      "Order execution + risk management (stop-loss, max drawdown)",
      "Backtesting harness against historical data",
      "Scheduling / always-on runner (or event-driven on tick)",
      "Persistence (orders, fills, P&L, equity curve)",
      "Observability (alerts on failures, slippage, daily summary)",
      "Paper-trading sandbox before live capital",
    ],
    exampleStack:
      "Python + Alpaca/IBKR SDK + pandas/numpy + APScheduler + PostgreSQL + Sentry",
    patterns: [
      /\b(?:algo(?:rithmic)?|automated|auto)\s+trad(?:ing|er)\b/i,
      // Either order: "trading X" OR "X trader/trading"
      /\btrad(?:ing|es?|er|e)\b.*\b(?:stock|equity|market|forex|fx|crypto|coin|option)/i,
      /\b(?:stock|equity|forex|fx|crypto|coin|option)\b.*\btrad(?:ing|es?|er|e)\b/i,
      /\b(?:stock|equity|forex|crypto|coin|option)\s+market\b.*\b(?:bot|app|trader|trading|invest|buy|sell)/i,
      /\b(?:trades?|trading)\s+for\s+me\b/i,
      /\bbuild(?:ing)?\s+a\s+(?:trading|trader)\b/i,
      /\b(?:buys?\s+and\s+sells?|signals?)\b.*\bstock\b/i,
      /\bstock\s+(?:bot|trader|app|invest)/i,
    ],
    inferDomains: ["financial", "backend", "automation", "observability", "database"],
    inferFrameworks: [],
    inferLanguage: "python",
    inferGoal: "data_pipeline",
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
      /\b(?:price|deal|inventory|product|stock|listing|availability)\s+(?:tracker|monitor|watcher|alert)/i,
      /\b(?:watch|monitor|track)\s+(?:websites?|prices?|listings?|inventory)/i,
      /\bnotif(?:y|ies|ication)\s+(?:me|us)\s+when\b.*\b(?:website|page|product|price|in\s+stock)/i,
      /\bscrape\b.*\b(?:and|then)\s+(?:store|save|alert|notify)/i,
    ],
    inferDomains: ["scraping", "browser-automation", "automation", "database", "observability"],
    inferFrameworks: ["playwright"],
    inferLanguage: "python",
    inferGoal: "data_pipeline",
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
    inferLanguage: null, // could be Python or TS — leave open
    inferGoal: "build_harness",
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
    inferLanguage: null,
    inferGoal: "automation",
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
  },
];

function detectArchetype(desc: string): ArchetypeDef | null {
  for (const a of ARCHETYPES) {
    if (a.patterns.some((rx) => rx.test(desc))) return a;
  }
  return null;
}

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
  // profile (UI doesn't need to see the regex bag).
  const archetype: ProjectArchetype | null = archetypeMatch
    ? {
        id: archetypeMatch.id,
        label: archetypeMatch.label,
        summary: archetypeMatch.summary,
        technicalParts: archetypeMatch.technicalParts,
        exampleStack: archetypeMatch.exampleStack,
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
