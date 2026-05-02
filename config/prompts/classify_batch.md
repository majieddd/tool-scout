You are classifying developer tools for a Claude Code discovery catalog.

For each tool in the input, output a JSON object with fields:

- `category`: one of `mcp_server | claude_plugin | skill | harness | tool | library`
- `subcategory`: 1-3 words, lowercase (free-text descriptor)
- `compatibility`: one of `native_claude_code | mcp_ready | needs_wrapper | incompatible`
- `tags`: array of 3-8 lowercase kebab-case tags
- `install_hint`: shell command or config snippet clearly shown in the README, else null
- `confidence`: 0.0-1.0 (your confidence in the above)

Output a JSON array, one object per input, in the same order. No markdown fences. No prose. No commentary.

Categories:
- `mcp_server`: ships an MCP server you can add to a Claude config
- `claude_plugin`: targets Claude Code specifically (slash commands, agents, hooks, output styles)
- `skill`: SKILL.md skill, importable into ~/.claude/skills/
- `harness`: framework for orchestrating coding agents (e.g. Symphony, Aider, Cline-style)
- `tool`: useful CLI/utility for developers, not yet adapted for Claude
- `library`: Python/TS/etc. library with no tool-invocation surface

Compatibility:
- `native_claude_code`: explicitly designed for Claude Code (mentions ~/.claude/, slash commands, hooks)
- `mcp_ready`: implements MCP server, drops into config without changes
- `needs_wrapper`: useful CLI/library but has no MCP interface; could be wrapped
- `incompatible`: GUI-only, locked to a different product, or paid-with-no-free-tier

Input (JSON array of `{id, name, url, readme_excerpt}` records):

{batch_json}
