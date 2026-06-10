# DsCode Architecture Principles

## Layer Diagram

```
┌──────────────────────────────────────────┐
│              UI Layer (React/Ink)         │
│  App.tsx, PromptInput.tsx, views/, hooks/ │
├──────────────────────────────────────────┤
│          Orchestration Layer              │
│  SessionManager (session.ts)              │
│  ToolExecutor (tools/executor.ts)         │
│  McpManager (mcp/mcp-manager.ts)          │
├──────────────┬───────────────────────────┤
│   Provider   │   Common Services          │
│   Interface  │   (budget, permissions,    │
│   (ILlm)     │    state, telemetry,       │
│              │    debug, errors)          │
├──────────────┤                            │
│ DeepSeek     │                            │
│ OpenAI       │                            │
│ Anthropic    │                            │
└──────────────┴────────────────────────────┘
```

## Principles

### P1: Interface-First Design

Every boundary between layers is defined by a TypeScript interface, not a concrete
class. `SessionManager` depends on `ILlmProvider`, never on `DeepSeekProvider` or
`OpenAI`. `ToolExecutor` depends on tool handler functions, never on specific tool
implementations.

### P2: Canonical Internal Types

All internal state uses canonical types (`SessionMessage`, `ToolCall`, `ToolDefinition`)
that are provider-agnostic. Conversion to provider-specific wire formats happens at the
boundary, inside each provider implementation. No OpenAI or Anthropic types leak into
`SessionManager` or `ToolExecutor`.

### P3: Streaming-First

All LLM communication is streaming. Non-streaming responses are treated as the
degenerate case (single-chunk stream). This ensures:
- Real-time UI updates during generation.
- Graceful handling of connection drops mid-stream.
- Unified error handling for timeouts and aborts.

### P4: Surgical Changes

Every change to existing code:
- Touches only what is required for the task.
- Does not reformat, refactor, or "improve" adjacent code.
- Matches existing code style even if different from personal preference.
- Removes only imports/variables the change made unused.

### P5: Test Integrity

All behavioral changes must:
- Pass the existing test suite (`npm test`) with zero regressions.
- Add new tests only for new behavior, never for refactored internals.
- Never alter existing tests to hide regressions unless the test is proven obsolete
  by an intentional, documented decision.

### P6: Zero New Dependencies Without Justification

No npm package is added without:
- An ADR documenting the evaluation of alternatives.
- Proof that the dependency cannot be reasonably implemented in-tree.
- Confirmation that the package is actively maintained with acceptable license.

### P7: Provider-Agnostic Configuration

Settings schemas are provider-agnostic. Provider-specific options (API keys, base URLs,
model maps) are namespaced under `providers.<name>` in `settings.json`. The base
`model` field is a logical model identifier, resolved to a provider and model string
by the provider registry.

---
