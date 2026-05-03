/**
 * Synthetic tool fixtures designed to catch every regression we've fixed.
 *
 * Each tool is shaped after a real catalog row that triggered (or correctly
 * resisted) a specific behavior in the architect — so when an invariant
 * breaks, we can point to the exact tool that should/shouldn't have been
 * picked.
 *
 * Naming convention: `<id>` matches a synthetic ID that explains why the
 * tool exists in the fixture set.
 */
import type { Tool } from "@/lib/data";

const baseGrade = (letter: string, total: number) => ({
  letter,
  total,
  axes: { R: total / 5, Q: total / 5, N: total / 5, I: total / 5, F: total / 5 },
});

// ── SDK / runtime layer ────────────────────────────────────────────────────
export const TOOL_FASTMCP: Tool = {
  id: "fastmcp_id",
  name: "PrefectHQ/fastmcp",
  url: "https://github.com/PrefectHQ/fastmcp",
  source: "github",
  category: "library",
  subcategory: null,
  description: "🚀 The fast, Pythonic way to build MCP servers and clients.",
  readme_excerpt: null,
  language: "Python",
  stars: 24900,
  license: "Apache-2.0",
  last_updated: "2026-04-25T00:00:00Z",
  first_seen: "2025-09-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: "pip install fastmcp",
  tags: ["mcp", "mcp-server", "mcp-tools", "fastmcp"],
  grade: baseGrade("A", 19),
};

export const TOOL_MCP_USE_TS: Tool = {
  id: "mcp_use_id",
  name: "mcp-use/mcp-use",
  url: "https://github.com/mcp-use/mcp-use",
  source: "github",
  category: "library",
  subcategory: null,
  description: "The fullstack MCP framework to develop MCP Apps for ChatGPT / Claude & MCP Servers for AI Agents.",
  readme_excerpt: null,
  language: "TypeScript",
  stars: 5400,
  license: "MIT",
  last_updated: "2026-04-25T00:00:00Z",
  first_seen: "2025-08-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: "npm install mcp-use",
  tags: ["mcp", "mcp-server"],
  grade: baseGrade("A", 19),
};

// ── Filesystem ─────────────────────────────────────────────────────────────
export const TOOL_FS_PYTHON: Tool = {
  id: "fs_py_id",
  name: "MarcusJellinghaus/mcp-workspace",
  url: "https://github.com/MarcusJellinghaus/mcp-workspace",
  source: "github",
  category: "mcp_server",
  subcategory: "filesystem",
  description: "MCP Workspace Server: A secure Model Context Protocol server providing file, git, and GitHub tools for AI assistants.",
  readme_excerpt: null,
  language: "Python",
  stars: 320,
  license: "MIT",
  last_updated: "2026-04-10T00:00:00Z",
  first_seen: "2025-12-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: "uvx mcp-workspace",
  tags: ["filesystem", "mcp", "git"],
  grade: baseGrade("B", 16),
};

// ── Git ────────────────────────────────────────────────────────────────────
export const TOOL_GIT: Tool = {
  id: "git_id",
  name: "puravparab/Gitingest-MCP",
  url: "https://github.com/puravparab/Gitingest-MCP",
  source: "github",
  category: "mcp_server",
  subcategory: "git",
  description: "mcp server for gitingest",
  readme_excerpt: null,
  language: "Python",
  stars: 180,
  license: "MIT",
  last_updated: "2026-04-15T00:00:00Z",
  first_seen: "2025-12-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: "uvx gitingest-mcp",
  tags: ["git", "github", "mcp"],
  grade: baseGrade("B", 16),
};

// ── Plugin marketplace (the v1 wrong-fit for filesystem) ──────────────────
export const TOOL_PLUGIN_MARKETPLACE: Tool = {
  id: "plugin_mkt_id",
  name: "anthropics/claude-plugins-official",
  url: "https://github.com/anthropics/claude-plugins-official",
  source: "github",
  category: "claude_plugin",
  subcategory: null,
  description: "Official, Anthropic-managed directory of high quality Claude Code Plugins.",
  readme_excerpt: null,
  language: null,
  stars: 8000,
  license: "MIT",
  last_updated: "2026-04-25T00:00:00Z",
  first_seen: "2025-10-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: null,
  tags: ["claude-plugin", "marketplace"],
  grade: baseGrade("A", 18),
};

// ── Data layer (Postgres-specific vs generic) ─────────────────────────────
export const TOOL_PG_AIGUIDE: Tool = {
  id: "pg_aiguide_id",
  name: "timescale/pg-aiguide",
  url: "https://github.com/timescale/pg-aiguide",
  source: "github",
  category: "mcp_server",
  subcategory: "database",
  description: "MCP server and Claude plugin for Postgres skills and documentation. Helps AI coding tools generate better SQL.",
  readme_excerpt: null,
  language: "Python",
  stars: 1700,
  license: "Apache-2.0",
  last_updated: "2026-04-20T00:00:00Z",
  first_seen: "2025-09-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: "uvx pg-aiguide",
  tags: ["postgres", "database", "claude-code-plugin"],
  grade: baseGrade("A", 18),
};

export const TOOL_GENERIC_DB: Tool = {
  id: "generic_db_id",
  name: "googleapis/mcp-toolbox",
  url: "https://github.com/googleapis/mcp-toolbox",
  source: "github",
  category: "mcp_server",
  subcategory: "database",
  description: "MCP Toolbox for Databases is an open source MCP server for databases.",
  readme_excerpt: null,
  language: "Go",
  stars: 2200,
  license: "Apache-2.0",
  last_updated: "2026-04-18T00:00:00Z",
  first_seen: "2025-08-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: null,
  tags: ["database", "mcp"],
  grade: baseGrade("B", 17),
};

// ── Auth ───────────────────────────────────────────────────────────────────
export const TOOL_FASTAPI_MCP: Tool = {
  id: "fastapi_mcp_id",
  name: "tadata-org/fastapi_mcp",
  url: "https://github.com/tadata-org/fastapi_mcp",
  source: "github",
  category: "mcp_server",
  subcategory: null,
  description: "Expose your FastAPI endpoints as Model Context Protocol (MCP) tools, with Auth!",
  readme_excerpt: null,
  language: "Python",
  stars: 11800,
  license: "MIT",
  last_updated: "2026-04-22T00:00:00Z",
  first_seen: "2025-11-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: "pip install fastapi-mcp",
  tags: ["mcp", "fastapi", "auth"],
  grade: baseGrade("B", 17),
};

// ── Code execution (real vs misclassified) ────────────────────────────────
export const TOOL_PYTHON_NOTEBOOK: Tool = {
  id: "py_notebook_id",
  name: "UsamaK98/python-notebook-mcp",
  url: "https://github.com/UsamaK98/python-notebook-mcp",
  source: "github",
  category: "mcp_server",
  subcategory: null,
  description: "Lightweight Python Notebook MCP - Enable AI assistants to create, edit, run Jupyter notebooks with kernel exec via MCP.",
  readme_excerpt: null,
  language: "Python",
  stars: 220,
  license: "MIT",
  last_updated: "2026-04-12T00:00:00Z",
  first_seen: "2025-12-15T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: "uvx python-notebook-mcp",
  tags: ["jupyter", "python", "mcp"],
  grade: baseGrade("B", 16),
};

export const TOOL_CONTEXT_OPTIMIZER: Tool = {
  id: "ctx_opt_id",
  name: "mksglu/context-mode",
  url: "https://github.com/mksglu/context-mode",
  source: "github",
  category: "mcp_server",
  subcategory: null,
  description: "Context window optimization for AI coding agents. Sandboxes tool output, 98% reduction. 14 platforms.",
  readme_excerpt: null,
  language: "TypeScript",
  stars: 800,
  license: "MIT",
  last_updated: "2026-04-15T00:00:00Z",
  first_seen: "2025-12-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: null,
  tags: ["mcp"],
  grade: baseGrade("A", 18),
};

// ── Method skill: TDD vs vague debug ──────────────────────────────────────
export const TOOL_TDD_GUARD: Tool = {
  id: "tdd_guard_id",
  name: "nizos/tdd-guard",
  url: "https://github.com/nizos/tdd-guard",
  source: "github",
  category: "claude_plugin",
  subcategory: null,
  description: "Automated TDD enforcement for Claude Code",
  readme_excerpt: null,
  language: null,
  stars: 2056,
  license: "MIT",
  last_updated: "2026-04-25T00:00:00Z",
  first_seen: "2025-11-01T00:00:00Z",
  compatibility: "native_claude_code",
  install_hint: "npx tdd-guard install",
  tags: ["tdd", "test-driven", "claude-plugin"],
  grade: baseGrade("A", 18),
};

export const TOOL_NO_NO_DEBUG: Tool = {
  id: "no_no_debug_id",
  name: "summerliuuu/no-no-debug",
  url: "https://github.com/summerliuuu/no-no-debug",
  source: "github",
  category: "skill",
  subcategory: null,
  description: "No-No Debug — Self-evolution system for AI coding assistants. 10 minutes writing code, 2 hours debugging.",
  readme_excerpt: null,
  language: "Python",
  stars: 90,
  license: "MIT",
  last_updated: "2026-04-10T00:00:00Z",
  first_seen: "2026-01-01T00:00:00Z",
  compatibility: "native_claude_code",
  install_hint: null,
  tags: ["debug", "skill"],
  grade: baseGrade("B", 16),
};

// ── QoL plugin: real hook vs off-topic ────────────────────────────────────
export const TOOL_PITH: Tool = {
  id: "pith_id",
  name: "abhisekjha/pith",
  url: "https://github.com/abhisekjha/pith",
  source: "github",
  category: "claude_plugin",
  subcategory: null,
  description: "Pith is the hook that makes Claude Code sessions last 3x longer.",
  readme_excerpt: null,
  language: "Python",
  stars: 480,
  license: "MIT",
  last_updated: "2026-04-26T00:00:00Z",
  first_seen: "2026-02-01T00:00:00Z",
  compatibility: "native_claude_code",
  install_hint: "npx pith install",
  tags: ["claude-plugin", "hook", "claude-code"],
  grade: baseGrade("B", 17),
};

export const TOOL_PPTX_GEN: Tool = {
  id: "pptx_id",
  name: "seulee26/mckinsey-pptx",
  url: "https://github.com/seulee26/mckinsey-pptx",
  source: "github",
  category: "claude_plugin",
  subcategory: null,
  description: "McKinsey-style PPTX generator — Claude Code plugin with 40 slide templates and subagents.",
  readme_excerpt: null,
  language: "Python",
  stars: 320,
  license: "MIT",
  last_updated: "2026-04-22T00:00:00Z",
  first_seen: "2026-02-01T00:00:00Z",
  compatibility: "native_claude_code",
  install_hint: null,
  tags: ["claude-plugin", "pptx"],
  grade: baseGrade("B", 17),
};

// ── Noise / regression cases ──────────────────────────────────────────────
export const TOOL_XHS_DOWNLOADER: Tool = {
  id: "xhs_id",
  name: "JoeanAmier/XHS-Downloader",
  url: "https://github.com/JoeanAmier/XHS-Downloader",
  source: "github",
  category: "mcp_server",
  subcategory: null,
  // Mostly Chinese — must be filtered by the non-English guard
  description: "小红书（XiaoHongShu、RedNote）链接提取/作品采集工具：提取账号发布、收藏、点赞、专辑作品链接，支持采集作品信息和文件，含命令行模式、Web API 模式、Web UI 模式、监听模式。",
  readme_excerpt: null,
  language: "Python",
  stars: 14000,
  license: "GPL-3.0",
  last_updated: "2026-04-25T00:00:00Z",
  first_seen: "2024-08-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: null,
  tags: ["scraper", "xiaohongshu", "docker"],
  grade: baseGrade("A", 20),
};

export const TOOL_FULL_AGENT: Tool = {
  id: "full_agent_id",
  name: "FullAgent/fulling",
  url: "https://github.com/FullAgent/fulling",
  source: "github",
  category: "claude_plugin",
  subcategory: null,
  description: "Fulling is an AI-powered Full-stack Engineer Agent. Built with Next.js, Claude, shadcn/ui, and PostgreSQL.",
  readme_excerpt: null,
  language: "TypeScript",
  stars: 600,
  license: "MIT",
  last_updated: "2026-04-20T00:00:00Z",
  first_seen: "2026-01-01T00:00:00Z",
  compatibility: "native_claude_code",
  install_hint: null,
  tags: ["claude-plugin"],
  grade: baseGrade("A", 18),
};

export const TOOL_HARNESS_AS_PLUGIN: Tool = {
  id: "nano_claude_id",
  name: "shareAI-lab/learn-claude-code",
  url: "https://github.com/shareAI-lab/learn-claude-code",
  source: "github",
  category: "harness",
  subcategory: null,
  description: "Bash is all you need - A nano claude code-like 「agent harness」, built from 0 to 1.",
  readme_excerpt: null,
  language: "Shell",
  stars: 1200,
  license: "MIT",
  last_updated: "2026-04-23T00:00:00Z",
  first_seen: "2026-01-01T00:00:00Z",
  compatibility: "native_claude_code",
  install_hint: null,
  tags: ["claude-code", "agent-harness"],
  grade: baseGrade("A", 18),
};

export const TOOL_INCOMPATIBLE: Tool = {
  id: "incompat_id",
  name: "broken/abandoned",
  url: "https://github.com/broken/abandoned",
  source: "github",
  category: "mcp_server",
  subcategory: "filesystem",
  description: "Listed in punkpeye/awesome-mcp-servers",
  readme_excerpt: null,
  language: null,
  stars: 0,
  license: null,
  last_updated: null,
  first_seen: "2024-01-01T00:00:00Z",
  compatibility: "incompatible",
  install_hint: null,
  tags: ["filesystem"],
  grade: baseGrade("C", 13),
};

export const TOOL_AWESOME_STUB: Tool = {
  id: "awesome_stub_id",
  name: "someone/random-fs-mcp",
  url: "https://github.com/someone/random-fs-mcp",
  source: "awesome",
  category: "mcp_server",
  subcategory: "filesystem",
  description: "Listed in punkpeye/awesome-mcp-servers",
  readme_excerpt: null,
  language: null,
  stars: 5,
  license: null,
  last_updated: null,
  first_seen: "2026-04-01T00:00:00Z",
  compatibility: "mcp_ready",
  install_hint: null,
  tags: ["filesystem"],
  grade: baseGrade("C", 13),
};

// ── Domain skill (off-topic, like the v2 stock-analysis pick) ─────────────
export const TOOL_OFFTOPIC_SKILL: Tool = {
  id: "stock_skill_id",
  name: "xvary-research/claude-code-stock-analysis",
  url: "https://github.com/xvary-research/claude-code-stock-analysis",
  source: "github",
  category: "skill",
  subcategory: null,
  description: "Claude Code stock analysis skill: SEC EDGAR + market data, /analyze /score /compare — free, local, written in Python.",
  readme_excerpt: null,
  language: "Python",
  stars: 220,
  license: "MIT",
  last_updated: "2026-04-15T00:00:00Z",
  first_seen: "2026-02-01T00:00:00Z",
  compatibility: "native_claude_code",
  install_hint: null,
  tags: ["skill", "finance"],
  grade: baseGrade("B", 17),
};

export const ALL_FIXTURE_TOOLS: Tool[] = [
  TOOL_FASTMCP, TOOL_MCP_USE_TS, TOOL_FS_PYTHON, TOOL_GIT, TOOL_PLUGIN_MARKETPLACE,
  TOOL_PG_AIGUIDE, TOOL_GENERIC_DB, TOOL_FASTAPI_MCP, TOOL_PYTHON_NOTEBOOK, TOOL_CONTEXT_OPTIMIZER,
  TOOL_TDD_GUARD, TOOL_NO_NO_DEBUG, TOOL_PITH, TOOL_PPTX_GEN,
  TOOL_XHS_DOWNLOADER, TOOL_FULL_AGENT, TOOL_HARNESS_AS_PLUGIN, TOOL_INCOMPATIBLE, TOOL_AWESOME_STUB,
  TOOL_OFFTOPIC_SKILL,
];
