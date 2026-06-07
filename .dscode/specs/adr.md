# Architecture Decision Records (ADR)

## ADR-001: TypeScript + Ink + esbuild Stack

**Date:** 2026-06-07
**Status:** accepted

**Context:** The DsCode project needed a technology stack for a terminal-native AI coding assistant. Requirements: cross-platform (Windows, Linux, macOS), responsive terminal UI with streaming text, LLM API integration, and ability to distribute as both npm package and standalone binary.

**Decision:** Adopt TypeScript (strict mode) with Ink (React for terminals) as the UI framework and esbuild for bundling. Target Node.js 22+ with ESM output.

**Rationale:**
- TypeScript provides type safety and improved developer experience over plain JavaScript, critical for a codebase that must be maintainable by autonomous AI.
- Ink is the most mature React-based terminal UI framework in the Node.js ecosystem, providing component-based architecture, hooks, and context APIs familiar to React developers.
- esbuild is significantly faster than tsc/webpack for bundling and produces clean ESM output suitable for Node.js.
- Node.js SEA (Single Executable Application) enables standalone binary distribution without requiring users to install Node.js.
- Alternatives considered: plain Node.js with blessed/neo-blessed (less flexible UI), Python with Textual (different ecosystem), Go with Bubble Tea (no React component model, harder for AI to reason about).

**Consequences:**
- Positive: Strong type safety reduces runtime errors. Component-based architecture enables reusable UI elements. esbuild is extremely fast for development iteration. SEA binaries simplify user installation.
- Negative: Ink adds a dependency layer on React in a terminal context. esbuild bundle size is larger than a pure Node.js script. TypeScript compilation step adds build complexity.

---

## ADR-002: Git-Based File History with Lightweight Branches

**Date:** 2026-06-07
**Status:** accepted

**Context:** The AI assistant needs to modify files and provide undo/checkpoint functionality. A simple file backup system would be fragile; a full database would be overkill.

**Decision:** Use Git lightweight branches per session for file history tracking. The `GitFileHistory` class manages blob storage and branch references via a `.deepcode-file-history.json` manifest.

**Rationale:**
- Git is already present on developer machines and provides reliable file versioning.
- Lightweight branches are cheap to create and switch between.
- The manifest file tracks which branches correspond to which undo checkpoints.
- Alternatives considered: file copy backups (fragile, no diff capability), Git stashes (not persistent enough), SQLite database (overkill for the use case).

**Consequences:**
- Positive: Reliable undo/restore with full Git diff capability. Zero additional dependencies. Familiar workflow for developers.
- Negative: Requires Git to be installed. Branch-based approach may interact unexpectedly with the user's own Git operations.

---

## ADR-003: OpenAI-Compatible API with DeepSeek Optimization

**Date:** 2026-06-07
**Status:** accepted

**Context:** The project needs to support multiple LLM providers while being optimized for DeepSeek V4 models, which offer thinking mode, reasoning effort control, and KV Cache.

**Decision:** Use an OpenAI-compatible API client (`openai` npm package) with a singleton pattern and 180-second keep-alive timeout. Model-specific behavior (thinking mode, reasoning content injection) is handled by `model-capabilities.ts` and `openai-thinking.ts`.

**Rationale:**
- OpenAI-compatible API is the industry standard, supported by DeepSeek, Anthropic (via proxy), and many other providers.
- Singleton client avoids re-creating connections on each API call.
- Keep-alive timeout prevents connection leaks while maintaining reuse.
- Model capabilities module centralizes provider-specific logic.

**Consequences:**
- Positive: Broad provider compatibility. Clean separation of provider-specific logic. Efficient connection reuse.
- Negative: Tied to OpenAI message format; providers with radically different APIs may require adapter layers.

---

## ADR-004: EJS Templates for Slash Command Prompts

**Date:** 2026-06-07
**Status:** accepted

**Context:** Slash commands (like `/spec-init`, `/spec-plan`, `/init`) need to inject structured prompts into the LLM conversation. These prompts must be maintainable and allow parameterization.

**Decision:** Use EJS templates stored in `templates/prompts/` for slash command prompt generation. The `SessionManager` renders templates with command-specific parameters (e.g., spec number, brainstorming text) and the `OpenAIMessageConverter` substitutes the rendered content for the user message.

**Rationale:**
- EJS is simple, well-known, and has zero learning curve.
- Templates are plain text files that can be read, reviewed, and edited without tooling.
- Parameterization via `<%= variable %>` syntax is sufficient for all use cases.
- Alternatives considered: Handlebars (more features but heavier), string concatenation (unmaintainable), embedded markdown with regex replacement (fragile).

**Consequences:**
- Positive: Clean separation of prompt logic from application code. Templates are human-readable and easy to maintain. Simple parameterization.
- Negative: EJS has limited logic capabilities compared to full templating engines. Templates must be carefully reviewed to avoid injection issues.
