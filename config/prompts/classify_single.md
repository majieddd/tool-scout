Classify this developer tool for a Claude Code discovery catalog.

Output ONE JSON object with these fields:

- `id`: copy the input id verbatim
- `category`: one of `mcp_server | claude_plugin | skill | harness | tool | library`
- `subcategory`: 1-3 words, lowercase
- `compatibility`: one of `native_claude_code | mcp_ready | needs_wrapper | incompatible`
- `tags`: array of 3-8 lowercase kebab-case tags
- `install_hint`: shell command or config snippet from the README, else null
- `confidence`: 0.0-1.0

Categories:
- `mcp_server`: ships an MCP server (mentions `mcpServers`, `model context protocol`, MCP SDK)
- `claude_plugin`: targets Claude Code (slash commands like `/review`, agents, hooks, output styles, `~/.claude/plugins/`)
- `skill`: SKILL.md skill, importable into `~/.claude/skills/`, has YAML frontmatter with `name:` + `description:`
- `harness`: framework for orchestrating coding agents (Symphony, Aider, Cline-style — long-running agent loops)
- `tool`: useful CLI / GUI / utility for developers, not yet adapted for Claude
- `library`: importable Python/TS/etc. library with no end-user invocation surface

Compatibility:
- `native_claude_code`: explicitly designed for Claude Code (`~/.claude/`, slash commands, hooks)
- `mcp_ready`: implements MCP server, drops into config without changes
- `needs_wrapper`: useful CLI/library but no MCP interface — could be wrapped
- `incompatible`: GUI-only, locked to a different product, or paid-with-no-free-tier

Input record:
{record_json}

Output ONE JSON object now. No prose. No markdown. Just the object.
