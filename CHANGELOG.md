# Changelog

## v1.0.15

- **`--version`** now shows version + node + platform info.
- **`--update`** command: explicit update check with install prompt.
- **MCP-TUI**: full inspection panel with scope labels, policy badges, execution history, error log, and keyboard shortcuts (approve/deny/disable/reconnect).
- **README**: MCP section covering skills (spec 150), SDD (spec 160), and TUI (spec 170).
- Auto-update now prompts in the same session after discovering a new version.
- npm install feedback: spinner message before running `npm install -g`.

## v1.0.14

- MCP skills support: skills can carry `mcp.json` with server declarations.
- SDD + MCP: specs declare MCP dependencies in YAML frontmatter.

## v1.0.13

- Multi-provider thinking mode per model.
- Gemini provider (zero SDK).
- Anthropic provider with adaptive/extended thinking.

## v1.0.0

- Initial release. DeepSeek V4 Pro and Flash support.
- Terminal-native TUI with React/Ink.
- Full tool suite: bash, file read/write/edit, glob/grep, web search.
- Slash commands, skills system, steering, SDD workflow.
