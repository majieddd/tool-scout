/**
 * Project analyzer — extracts a structural profile from an uploaded
 * archive, single config file, or pasted text. Runs entirely in the
 * browser; nothing is uploaded.
 *
 * Surface area is intentionally small so the matcher (lib/match.ts)
 * sees a tidy `ProjectProfile` shape regardless of which input form the
 * user provided.
 */
import JSZip from "jszip";

export type ProjectProfile = {
  source: "zip" | "file" | "paste";
  fileCount: number;
  totalBytes: number;

  // Detected from extensions
  languages: Record<string, number>; // ext (without dot) -> file count
  primaryLanguage: string | null;

  // Detected from manifest files
  frameworks: Set<string>; // e.g. "react", "next", "fastapi", "django", "tokio"
  packageManagers: Set<string>; // "npm", "yarn", "pnpm", "pip", "uv", "cargo", "go-mod", "bundler", "maven", "gradle"
  dependencies: Set<string>; // raw package names (sample, capped)

  // Detected from filesystem markers
  hasDocker: boolean;
  hasCI: boolean;
  hasTests: boolean;
  hasMcp: boolean; // .mcp.json or .claude/ present
  hasSkill: boolean; // SKILL.md
  hasPlugin: boolean; // plugin.json or .claude/plugins
  hasReadme: boolean;

  // Free-text bag (lowercased), used for fuzzy keyword matching
  keywords: Set<string>;
};

const TEXT_EXTS = new Set([
  "md", "rst", "txt", "json", "toml", "yaml", "yml",
  "py", "ts", "tsx", "js", "jsx", "rs", "go", "rb", "java",
  "kt", "swift", "vue", "svelte", "sh", "ps1", "sql",
  "html", "css", "scss", "less", "ini", "cfg", "conf",
]);

const LANGUAGE_FROM_EXT: Record<string, string> = {
  py: "python", ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", rs: "rust", go: "go",
  rb: "ruby", java: "java", kt: "kotlin", swift: "swift",
  vue: "vue", svelte: "svelte", sh: "shell", ps1: "powershell",
  sql: "sql", html: "html", css: "css", scss: "css",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp",
};

// Files we should always inspect closely when present.
const MANIFEST_FILES = new Set([
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "pyproject.toml", "requirements.txt", "Pipfile", "Pipfile.lock", "setup.py", "setup.cfg",
  "Cargo.toml", "Cargo.lock",
  "go.mod", "go.sum",
  "Gemfile", "Gemfile.lock",
  "pom.xml", "build.gradle", "build.gradle.kts",
  "composer.json", "composer.lock",
  "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml",
  "tsconfig.json", "next.config.js", "next.config.ts", "vite.config.js", "vite.config.ts",
  "webpack.config.js", "rollup.config.js",
  "tailwind.config.js", "tailwind.config.ts",
  ".eslintrc.json", ".eslintrc.js", ".prettierrc", ".prettierrc.json",
  ".gitignore", ".npmrc", "Makefile", "Justfile",
  "SKILL.md", "plugin.json", "mcp.json", ".mcp.json",
]);

const FRAMEWORK_HINTS: Record<string, string[]> = {
  react: ["react", "react-dom"],
  next: ["next"],
  vue: ["vue", "@vue/"],
  svelte: ["svelte"],
  angular: ["@angular/"],
  remix: ["@remix-run/"],
  astro: ["astro"],
  fastapi: ["fastapi"],
  django: ["django"],
  flask: ["flask"],
  rails: ["rails", "actionpack"],
  spring: ["org.springframework"],
  tokio: ["tokio"],
  actix: ["actix-web"],
  axum: ["axum"],
  express: ["express"],
  nestjs: ["@nestjs/"],
  pytorch: ["torch", "pytorch"],
  tensorflow: ["tensorflow"],
  langchain: ["langchain"],
  anthropic: ["anthropic", "@anthropic-ai/sdk", "@anthropic-ai/claude-code"],
  openai: ["openai", "openai-python"],
  mcp: ["mcp", "@modelcontextprotocol/sdk", "fastmcp"],
};

const KEYWORD_BAG_FROM_README = new Set([
  "ai", "ml", "agent", "agentic", "llm", "rag", "embeddings",
  "database", "postgres", "sqlite", "mysql", "redis", "graphql",
  "auth", "authentication", "oauth", "jwt", "rest", "api",
  "websocket", "realtime", "streaming", "pubsub", "queue",
  "worker", "scheduler", "cron", "etl", "pipeline",
  "test", "testing", "ci", "cd", "deploy", "docker", "kubernetes",
  "frontend", "backend", "fullstack", "mobile", "ios", "android",
  "cli", "terminal", "tui", "wizard",
  "voxel", "minecraft", "hytale", "blockbench", "game",
  "voice", "speech", "audio", "video", "image",
  "scraper", "crawler", "extractor", "parser",
  "mcp", "claude", "anthropic", "claude-code", "skill", "plugin",
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return "";
  return name.slice(i + 1).toLowerCase();
}

function basenameOf(name: string): string {
  const i = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return i === -1 ? name : name.slice(i + 1);
}

function emptyProfile(source: ProjectProfile["source"]): ProjectProfile {
  return {
    source,
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
}

function extractKeywordsFromText(text: string, into: Set<string>): void {
  const lower = text.toLowerCase();
  for (const kw of KEYWORD_BAG_FROM_README) {
    if (lower.includes(kw)) into.add(kw);
  }
  // Also pull single-word identifiers as fuzzy hints
  const words = lower.match(/\b[a-z][a-z0-9-]{2,24}\b/g) || [];
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  // top-frequency non-stopword words become signals
  const STOP = new Set([
    "the", "and", "for", "with", "this", "that", "from", "you", "your",
    "have", "are", "was", "will", "into", "more", "use", "using", "used",
    "any", "all", "but", "can", "not", "see", "set", "get", "run", "via",
    "out", "off", "yes", "now", "new", "one", "two", "etc", "via",
  ]);
  for (const [w, c] of counts) {
    if (c >= 3 && !STOP.has(w) && w.length >= 4) into.add(w);
  }
}

function inferFrameworksFromManifest(name: string, content: string, p: ProjectProfile): void {
  const base = basenameOf(name);
  if (base === "package.json") {
    p.packageManagers.add("npm");
    try {
      const pkg = JSON.parse(content);
      const deps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
        ...(pkg.peerDependencies || {}),
      };
      for (const [dep] of Object.entries(deps)) p.dependencies.add(dep);
      for (const [fw, hints] of Object.entries(FRAMEWORK_HINTS)) {
        if (hints.some((h) => Object.keys(deps).some((d) => d.startsWith(h)))) {
          p.frameworks.add(fw);
        }
      }
    } catch { /* malformed package.json — skip */ }
  } else if (base === "yarn.lock") p.packageManagers.add("yarn");
  else if (base === "pnpm-lock.yaml") p.packageManagers.add("pnpm");
  else if (base === "pyproject.toml") {
    p.packageManagers.add("uv");
    // Naive parse — extract `dep = ` and `"dep>=..."` patterns
    for (const m of content.matchAll(/['"`]([a-zA-Z][\w-]+)(?:\[\w+\])?['"`]\s*[=,>~<]/g)) {
      p.dependencies.add(m[1].toLowerCase());
    }
    for (const [fw, hints] of Object.entries(FRAMEWORK_HINTS)) {
      if (hints.some((h) => content.toLowerCase().includes(h))) p.frameworks.add(fw);
    }
  } else if (base === "requirements.txt" || base === "Pipfile") {
    p.packageManagers.add("pip");
    for (const line of content.split("\n")) {
      const m = line.trim().match(/^([a-zA-Z][\w-]+)/);
      if (m) p.dependencies.add(m[1].toLowerCase());
    }
    for (const [fw, hints] of Object.entries(FRAMEWORK_HINTS)) {
      if (hints.some((h) => content.toLowerCase().includes(h))) p.frameworks.add(fw);
    }
  } else if (base === "Cargo.toml") {
    p.packageManagers.add("cargo");
    for (const m of content.matchAll(/^([a-zA-Z][\w-]+)\s*=/gm)) {
      p.dependencies.add(m[1].toLowerCase());
    }
    for (const [fw, hints] of Object.entries(FRAMEWORK_HINTS)) {
      if (hints.some((h) => content.toLowerCase().includes(h))) p.frameworks.add(fw);
    }
  } else if (base === "go.mod") {
    p.packageManagers.add("go-mod");
    for (const m of content.matchAll(/^require\s+([a-z0-9./-]+)/gm)) {
      p.dependencies.add(m[1]);
    }
  } else if (base === "Gemfile") p.packageManagers.add("bundler");
  else if (base === "pom.xml" || base === "build.gradle" || base === "build.gradle.kts") {
    p.packageManagers.add(base.startsWith("pom") ? "maven" : "gradle");
  } else if (base === "Dockerfile" || base.startsWith("docker-compose") || base === "compose.yml") {
    p.hasDocker = true;
  } else if (base === "tsconfig.json") {
    p.frameworks.add("typescript");
  } else if (base === "next.config.js" || base === "next.config.ts") {
    p.frameworks.add("next");
    p.frameworks.add("react");
  } else if (base === "vite.config.js" || base === "vite.config.ts") {
    p.frameworks.add("vite");
  } else if (base === "tailwind.config.js" || base === "tailwind.config.ts") {
    p.frameworks.add("tailwind");
  } else if (base === "SKILL.md") {
    p.hasSkill = true;
    p.keywords.add("skill");
    p.keywords.add("claude-code");
  } else if (base === "plugin.json") {
    p.hasPlugin = true;
    p.keywords.add("claude-plugin");
  } else if (base === "mcp.json" || base === ".mcp.json") {
    p.hasMcp = true;
    p.keywords.add("mcp");
  } else if (base.toLowerCase().startsWith("readme")) {
    p.hasReadme = true;
    extractKeywordsFromText(content, p.keywords);
  } else if (base === "Makefile" || base === "Justfile") {
    p.keywords.add("automation");
  }
}

function finalizeProfile(p: ProjectProfile): ProjectProfile {
  if (Object.keys(p.languages).length > 0) {
    let max = -1;
    for (const [lang, n] of Object.entries(p.languages)) {
      if (n > max) {
        max = n;
        p.primaryLanguage = lang;
      }
    }
  }
  // The framework "typescript" is implicit if .ts/.tsx is the primary lang
  if (p.primaryLanguage === "typescript") p.frameworks.add("typescript");
  if (p.primaryLanguage === "python") p.frameworks.add("python");
  return p;
}

export async function analyzeZip(file: File, progressCb?: (msg: string) => void): Promise<ProjectProfile> {
  const p = emptyProfile("zip");
  const buf = await file.arrayBuffer();
  progressCb?.("unpacking…");
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.values(zip.files).filter((f) => !f.dir);

  for (const entry of entries) {
    const name = entry.name;
    const lower = name.toLowerCase();
    p.fileCount += 1;

    // Skip noisy build/cache/vendor dirs entirely
    if (
      lower.includes("/node_modules/") ||
      lower.includes("/.git/") ||
      lower.includes("/.venv/") ||
      lower.includes("/venv/") ||
      lower.includes("/__pycache__/") ||
      lower.includes("/dist/") ||
      lower.includes("/build/") ||
      lower.includes("/target/") ||
      lower.includes("/.next/") ||
      lower.includes("/.idea/") ||
      lower.includes("/.vscode/")
    ) {
      continue;
    }

    const ext = extOf(name);
    const lang = LANGUAGE_FROM_EXT[ext];
    if (lang) p.languages[lang] = (p.languages[lang] ?? 0) + 1;

    if (lower.includes("/test") || lower.includes("/__tests__/") || lower.includes("/spec/")) {
      p.hasTests = true;
    }
    if (lower.includes(".github/workflows/")) p.hasCI = true;
    if (lower.includes(".claude/plugins")) {
      p.hasPlugin = true;
      p.keywords.add("claude-plugin");
    }
    if (lower.includes(".claude/")) {
      p.hasMcp = true;
      p.keywords.add("claude-code");
    }

    const base = basenameOf(name);
    if (MANIFEST_FILES.has(base) || lower.endsWith("/dockerfile") || lower.endsWith("/skill.md")) {
      try {
        const content = await entry.async("string");
        p.totalBytes += content.length;
        inferFrameworksFromManifest(base, content, p);
      } catch {
        // binary or unreadable manifest — skip
      }
    }
  }
  return finalizeProfile(p);
}

export async function analyzeFile(file: File): Promise<ProjectProfile> {
  const p = emptyProfile("file");
  const text = await file.text();
  p.fileCount = 1;
  p.totalBytes = text.length;
  const ext = extOf(file.name);
  const lang = LANGUAGE_FROM_EXT[ext];
  if (lang) p.languages[lang] = 1;
  inferFrameworksFromManifest(file.name, text, p);
  if (TEXT_EXTS.has(ext)) extractKeywordsFromText(text, p.keywords);
  return finalizeProfile(p);
}

export function analyzeText(text: string): ProjectProfile {
  const p = emptyProfile("paste");
  p.fileCount = 1;
  p.totalBytes = text.length;
  // Detect manifest-shaped content
  if (/^\s*\{/.test(text) && text.includes('"dependencies"')) {
    inferFrameworksFromManifest("package.json", text, p);
  } else if (text.includes("[project]") || text.includes("dependencies = [")) {
    inferFrameworksFromManifest("pyproject.toml", text, p);
  } else if (/^[a-zA-Z][\w-]+(==|>=|~=)/m.test(text)) {
    inferFrameworksFromManifest("requirements.txt", text, p);
  } else if (text.includes("[dependencies]") && text.includes("[package]")) {
    inferFrameworksFromManifest("Cargo.toml", text, p);
  }
  extractKeywordsFromText(text, p.keywords);
  return finalizeProfile(p);
}

export function profileToTags(p: ProjectProfile): Set<string> {
  const tags = new Set<string>();
  if (p.primaryLanguage) tags.add(p.primaryLanguage);
  for (const lang of Object.keys(p.languages)) tags.add(lang);
  for (const fw of p.frameworks) tags.add(fw);
  for (const kw of p.keywords) tags.add(kw);
  if (p.hasDocker) tags.add("docker");
  if (p.hasCI) tags.add("ci");
  if (p.hasTests) tags.add("testing");
  if (p.hasMcp) tags.add("mcp");
  if (p.hasSkill) tags.add("skill");
  if (p.hasPlugin) tags.add("claude-plugin");
  return tags;
}
