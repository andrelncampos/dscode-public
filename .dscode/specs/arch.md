# Architecture

## 1. Technical Architecture

- **Stack:** TypeScript (strict mode), Node.js 22+, React via Ink (terminal UI framework), esbuild (bundling), ESLint + Prettier (code quality).
- **Database:** No persistent database. Session history stored as JSON files in `~/.deepcode/sessions/`. File history managed via Git branches with `.deepcode-file-history.json` manifest. Settings stored in `~/.deepcode/settings.json`.
- **Deployment:** Published as npm package (`@andrelncampos/dscode`) and as standalone binaries via Node.js SEA for Windows (x64), Linux (x64), macOS (Intel x64 + Apple Silicon ARM64). Binaries are self-contained, requiring no Node.js installation.
- **Platform:** CLI application — runs in any terminal on Windows (Git Bash, PowerShell, CMD), Linux, and macOS. Distributed as ESM (ES modules) targeting Node 18+.

## 2. Conceptual Architecture

### Layers

```
┌─────────────────────────────────────────────────┐
│  UI Layer (Ink/React)                           │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │ Views    │ │Components│ │ Core (hooks,     │ │
│  │ (App,    │ │(Message, │ │  contexts,       │ │
│  │ Prompt,  │ │ Dropdown,│ │  prompt-buffer,  │ │
│  │ Session) │ │ Skills)  │ │  slash-commands) │ │
│  └──────────┘ └──────────┘ └─────────────────┘ │
├─────────────────────────────────────────────────┤
│  Session Layer                                  │
│  ┌────────────────────────────────────────────┐ │
│  │ SessionManager — LLM loop, compaction,     │ │
│  │ tool orchestration, template rendering,    │ │
│  │ image handling, skills injection           │ │
│  └────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│  Tool Layer                                     │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │ Executor │ │ Handlers │ │ Permissions     │ │
│  │(dispatch)│ │(bash,    │ │ (scope control, │ │
│  │          │ │ read,    │ │  allow/deny/ask)│ │
│  │          │ │ write,   │ │                 │ │
│  │          │ │ edit,    │ │                 │ │
│  │          │ │ web, MCP)│ │                 │ │
│  └──────────┘ └──────────┘ └─────────────────┘ │
├─────────────────────────────────────────────────┤
│  Common Layer                                   │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │ OpenAI   │ │ File     │ │ Settings &      │ │
│  │ Client   │ │ History  │ │ Environment     │ │
│  │ (keep-   │ │ (Git     │ │ (settings.json, │ │
│  │ alive,   │ │ branches)│ │ env vars)       │ │
│  │ stream)  │ │          │ │                 │ │
│  └──────────┘ └──────────┘ └─────────────────┘ │
├─────────────────────────────────────────────────┤
│  External                                       │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │ LLM API  │ │ MCP      │ │ npm Registry    │ │
│  │(DeepSeek,│ │ Servers  │ │ (update check)  │ │
│  │ OpenAI)  │ │          │ │                 │ │
│  └──────────┘ └──────────┘ └─────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Fundamental Principles

These principles MUST be followed by ALL specs and implementations:

1. **Extreme Detail & Determinism:** All specs must be created, maintained, and evolved with extreme detail, total completeness, and absolute determinism. No decision may be left pending for implementation time. Every spec must be implementable 100% by autonomous AI.

2. **KISS (Keep It Simple, Stupid):** All implementations must be as simple as possible. Avoid unnecessary abstractions, patterns, or complexity. The AI must be able to implement, maintain, and evolve the code easily.

3. **DRY (Don't Repeat Yourself):** Avoid duplication whenever possible, provided it does not conflict with KISS. Simplicity takes precedence over deduplication when they conflict.

4. **AI-First Documentation:** All spec documents (requirements.md, design.md, task.md) are written exclusively for AI engines (especially DeepSeek V4 Pro). Human readability is secondary. Precision, completeness, and determinism are paramount.
