# Tool Scout

> Daily crawler + public catalog + on-demand wrapper generator for Claude-compatible tools.

[![Vercel](https://img.shields.io/badge/Vercel-deployed-black?logo=vercel)](https://tool-scout.vercel.app)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What this is

Tool Scout crawls the web every day for tools that work with Claude Code — MCP servers, Claude plugins, SKILL.md skills, agentic harnesses, and developer libraries that can be adapted into one of the above. It grades them, recommends the best ones, and on demand generates Claude-compatible wrappers for tools that don't ship one.

The site at [tool-scout.vercel.app](https://tool-scout.vercel.app) is the public face. The discovery engine, classifier, and wrapper generator all run locally on the maintainer's machine, billed against an existing Claude Max subscription, so the service is free to operate and free to use.

## How it works

```
┌──── Daily Crawl (03:00) ────────────────────────────────────────────┐
│                                                                     │
│  GitHub topic + code search   ┐                                     │
│  npm + PyPI keyword search    │                                     │
│  MCP registries (pulsemcp,    │                                     │
│    mcp.so, smithery)          ├─→ heuristics → Claude Code → grades │
│  awesome-* lists (weekly)     │                                     │
│  Reddit, HN, Anthropic blog   ┘                                     │
│                                            │                        │
└─────────────────────────────────────────────┼────────────────────────┘
                                              ▼
                              ┌─────────────────────────────────┐
                              │  SQLite database (local)        │
                              └────┬───────────┬───────────┬────┘
                                   ▼           ▼           ▼
                              CLI         Sheets      JSON export
                                                          │
                                                          ▼
                                    ┌────────────────────────────────┐
                                    │  Public site (Vercel + GitHub) │
                                    │  + Symphony orchestrator       │
                                    │    for wrapper requests        │
                                    └────────────────────────────────┘
```

Powered by:

- **Claude Code** (Max subscription) — classifier and wrapper generator
- **Vercel Hobby** — Next.js web app + serverless wrapper-request endpoint
- **GitHub Pages-style** static-data hosting (data lives in the same repo)
- **Google Sheets** — monthly workbook with letter grades for at-a-glance scanning
- **ngrok free** — tunnel for the Vercel→local-machine webhook
- **Docker Desktop** — sandboxed wrapper smoke testing
- **NSSM** — Symphony orchestrator runs as a Windows Service

## Catalog grades

Every tool gets one grade, S through F, computed from five axes:

| Letter | Score | Color | Meaning |
|---|---|---|---|
| S | 22–25 | 🟣 | Stop what you're doing |
| A | 18–21 | 🟢 | Install this week |
| B | 14–17 | 🔵 | Solid; try when free |
| C | 10–13 | 🟡 | Situational |
| D | 6–9 | 🟠 | Probably skip |
| F | 0–5 | ⚪ | Irrelevant or dead |

Axes: **R**elevance, **Q**uality, **N**ovelty, **I**nstall ease, **F**it for stack.

## Installing locally (advanced)

You almost certainly don't need to do this — Tool Scout is one person's daily crawler that happens to be public. But if you want to run your own:

1. Read [`docs/03_PREFLIGHT_SETUP.md`](docs/03_PREFLIGHT_SETUP.md)
2. Fill in `.env` from `.env.example`
3. `pip install -e ".[dev]"`
4. `scout doctor`
5. `scout schedule install all`

## Requesting a wrapper for a tool

If you find a tool in the catalog that's marked `needs_wrapper`, click "Request Claude Code wrapper" on its detail page. The generation runs on Majied's machine; expect ~5–15 minutes if a slot is free.

Per-IP limit: 3 requests / 24h. Global cap: 10 / day. Be considerate — this is one person's spare compute.

## Takedowns

If you maintain a tool indexed here and want it removed, [open an issue](../../issues/new?template=takedown.yml) with the tool URL. Removal typically within 48 hours.

## License

MIT. See [LICENSE](LICENSE).

Generated wrappers are also MIT. The wrapped tools keep their own licenses — you are responsible for complying with each.

## Acknowledgments

- The orchestrator is inspired by [OpenAI Symphony](https://github.com/openai/symphony) — adapted to use Claude Code via subprocess instead of Codex App-Server, and a local SQLite tracker instead of Linear.
- The harness-engineering philosophy guiding repo structure comes from Anthropic's Claude Code documentation.

## Status

Engineering preview. Provided as-is. See [SECURITY.md](SECURITY.md) for vulnerability reporting.
