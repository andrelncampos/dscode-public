# Product Vision

## Target Audience

**DsCode** serves developers who want an AI coding assistant integrated directly into their terminal workflow:

- **Individual developers** performing daily coding tasks — code analysis, refactoring, debugging, feature implementation — who want AI assistance without leaving the terminal.
- **Tech leads and senior engineers** who need to rapidly understand, review, and assess large codebases.
- **AI-savvy developers** already using LLMs for programming and seeking a fast, terminal-native flow with minimal friction.
- **Teams** standardizing on prompts, skills, and agent behaviors to maintain consistency across contributors.
- **DeepSeek V4 users** who want to leverage thinking mode, reasoning effort control, and KV Cache optimization for cost-efficient high-quality results.

## Value Proposition

DsCode provides a **terminal-native AI coding assistant** that reads, analyzes, and modifies project files through an interactive conversation loop. It is optimized for DeepSeek V4 models with thinking-mode support, reasoning effort control, and KV Cache-aware context management, enabling autonomous multi-step task execution with structured planning and progress tracking.

## Value Blocks

### V1: Terminal-Native Conversational Interface

Delivers an interactive chat experience rendered directly in the terminal via Ink (React for terminals). The user types prompts in a text input field; the AI streams responses with markdown rendering, syntax-highlighted code blocks, and inline tool execution status. Supports Ctrl+O fullscreen process output, Ctrl+V image paste, and `@` file mentions for quick file references.

### V2: Autonomous Code Analysis & Modification

The AI uses built-in tools (read, write, edit, bash, grep, glob) to autonomously explore the codebase, analyze files, search for patterns, and make surgical edits. All changes are versioned through Git file history, enabling undo/checkpoint via lightweight Git branches per session.

### V3: Permission-Based Safety Controls

Configurable permission scoping (read, write, delete, network, git-log) allows users to control what the AI can do. Each scope supports allow/deny/ask decisions per session or globally. The interactive PermissionPrompt view presents a UI approval step when a tool requires user authorization.

### V4: Skills System for Behavioral Standardization

Skills are Markdown guides (with YAML frontmatter) that teach the AI to follow specific rules, workflows, or conventions. Skills can be project-level (`.agents/skills/`) or user-level (`~/.agents/skills/`). Built-in skills include agent-drift-guard, plan-and-execute, and karpathy-guidelines. Skills can be toggled per session or activated via slash commands.

### V5: Structured Task Planning & Execution (SDD Workflow)

The Spec-Driven Development workflow provides slash commands (`/spec-init`, `/spec-plan`, `/spec-new`, `/spec-verify`, `/spec-implement`, `/spec-audit`, `/spec-list`, `/spec-status`) for structured, deterministic feature planning and implementation. Specs are documented with extreme detail (requirements, design, task breakdown) enabling 100% autonomous AI implementation.

### V6: Multi-Model Support with Thinking Mode

Optimized for DeepSeek V4 Pro and Flash models, with support for any OpenAI-compatible provider (GPT 5.4 and later). Thinking mode enables the AI to reason internally before responding, controlled via reasoning effort settings (high/max). Raw display modes let users view or collapse reasoning content. DeepSeek V4 automatic context caching provides 120x input cost reduction on cache hits for Pro models and 50x for Flash. The `reasoning_content` field is only transmitted for turns with tool calls — per DeepSeek V4 API behavior, reasoning content between non-tool turns is ignored by the API and can be omitted to save input tokens. Web search uses the native DeepSeek `web_search` tool type when running on V4+ engines.

### V7: MCP Integration (Model Context Protocol)

Connects to external MCP servers for extended tool capabilities — database queries, browser automation, API integrations, and custom tooling. MCP servers are configured via settings and managed through the `/mcp` slash command for status display.

### V8: Session Management & Context Optimization

Persistent conversations with session resumption (`/resume`, `/continue`). Automatic context compaction when token thresholds are exceeded (384K default, matching the 1M context window of DeepSeek V4 and GPT 5.4+ engines). Compaction uses `deepseek-v4-flash` without thinking mode for cost-efficient summarization. The `/new` command starts fresh sessions, and `/undo` provides conversation + code restore points.

### V9: Cross-Platform CLI Distribution

Distributed as a standalone binary (via Node.js SEA — Single Executable Application) for Windows, Linux, and macOS (Intel and Apple Silicon), in addition to npm global installation. Self-contained installation requires no Node.js runtime.

### V10: Configuration & Extensibility

Settings resolution from `~/.deepcode/settings.json` (global) and project-local overrides. Environment variables with `DEEPCODE_` prefix. Configurable model, API key, thinking mode, reasoning effort, temperature, max tokens, permissions, notifications, and web search tool. Debug logging and error logging enable diagnostics.

### V11: Cost-Optimized AI Operations

Systematic minimization of API token consumption without sacrificing output quality. Targets include: eliminating redundant `reasoning_content` transmission between non-tool turns (per DeepSeek V4 thinking-mode behavior), using cheaper models (`deepseek-v4-flash` without thinking) for auxiliary tasks like context compaction, replacing LLM-based skill matching with heuristic keyword matching to eliminate an extra API call per user message, slimming the system prompt by removing tool documentation duplicated between `templates/tools/` and the JSON function schema, compacting built-in skill documents to essential rules only, and removing legacy code paths and configuration options (external `webSearchTool` script, multimodal capability checks, pre-V4 model conditionals) that exist only for engines predating DeepSeek V4 and GPT 5.4. DeepSeek V4 automatic context caching (120x input cost reduction on cache hits for Pro, 50x for Flash) is leveraged transparently through the existing singleton client.
