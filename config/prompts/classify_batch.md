You are classifying developer tools for a Claude Code discovery catalog.

For each tool in the input, output a JSON object with fields:

- `id`: COPY the `id` from the input record EXACTLY — required, must match
- `category`: one of `mcp_server | claude_plugin | skill | harness | tool | library`
- `subcategory`: 1-3 words, lowercase (free-text descriptor)
- `compatibility`: one of `native_claude_code | mcp_ready | needs_wrapper | incompatible`
- `tags`: array of 3-8 lowercase kebab-case tags
- `install_hint`: shell command or config snippet clearly shown in the README, else null
- `confidence`: 0.0-1.0 (your confidence in the above)

Output a JSON array with EXACTLY one object per input record, in the same order, with the `id` field echoed verbatim from the input. No markdown fences. No prose. No commentary. No truncation — even if there are 20 inputs, return all 20 outputs.

Categories:
- `mcp_server`: ships an MCP server you can add to a Claude config (mentions `mcp`, `mcpServers`, `model context protocol`, MCP SDK)
- `claude_plugin`: targets Claude Code specifically (slash commands like `/review`, agents, hooks, output styles, `~/.claude/plugins/`)
- `skill`: SKILL.md skill, importable into `~/.claude/skills/`, has YAML frontmatter with `name:` + `description:`
- `harness`: framework for orchestrating coding agents (Symphony, Aider, Cline-style — long-running agent loops)
- `tool`: useful CLI / GUI / utility for developers, not yet adapted for Claude
- `library`: Python/TS/etc. importable library with no end-user invocation surface

Compatibility:
- `native_claude_code`: explicitly designed for Claude Code (mentions `~/.claude/`, slash commands, hooks)
- `mcp_ready`: implements MCP server, drops into config without changes
- `needs_wrapper`: useful CLI/library but has no MCP interface; could be wrapped
- `incompatible`: GUI-only, locked to a different product, or paid-with-no-free-tier

Input (JSON array of `{id, name, url, readme_excerpt}` records):

{batch_json}

Output the JSON array now. Remember: one output object per input, `id` echoed verbatim, all fields present.
