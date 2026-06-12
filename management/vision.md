# DsCode Vision

## Product Vision

DsCode is a terminal-native conversational AI coding assistant. It brings the power of
modern LLMs directly into the developer's terminal — no browser, no IDE plugin, no
context-switching. The user describes what they need in natural language, and DsCode
reads, writes, edits, searches, and executes code in their project.

## Target Audience

Individual developers and small teams who:

- Prefer the terminal over GUI-based coding assistants.
- Want full control over which LLM provider processes their code.
- Need transparent cost tracking and budget controls.
- Value reproducible, auditable AI-assisted development workflows.

## Value Proposition

- **Zero context-switching:** Stay in the terminal. Chat, code, and execute without
  leaving the keyboard.
- **Provider freedom:** Choose your LLM provider — DeepSeek, OpenAI, Anthropic, or any
  OpenAI-compatible endpoint. No lock-in.
- **Cost transparency:** Every API call is tracked, priced, and budgeted per session.
- **Full audit trail:** Every tool execution, file mutation, and permission decision is
  recorded for review.

---

## Value Blocks

### V1: Terminal-Native Conversational Interface

A full TUI (Terminal User Interface) built with React/Ink that provides:

- Real-time streaming of LLM responses.
- Session management (create, switch, list, delete sessions).
- Slash-command system for quick actions (`/init`, `/model`, `/spec`, `/steering`).
- Permission prompts inline, no popups or separate windows.
- Markdown rendering with syntax highlighting.

**Delivered by:** Spec 20 (TUI Scalability) — refactored App.tsx and PromptInput.tsx
for maintainability.

---

### V6: Multi-Model Support

Support for multiple LLM providers beyond DeepSeek:

- DeepSeek V4 (flash + pro) via OpenAI-compatible API — current default.
- OpenAI (GPT-5.x family) via Responses API.
- Anthropic (Claude family) via Messages API.
- Any OpenAI-compatible endpoint via custom `baseURL`.

Thinking/reasoning mode is provider-aware:
- DeepSeek: `thinking {type: "enabled"|"disabled"}` + `reasoning_effort` in `extra_body`.
- OpenAI: `reasoning_effort` as top-level parameter (when supported).
- Anthropic: `thinking` content blocks with signature verification.

Tool calling uses each provider's native format, converted from a canonical internal
representation (`SessionMessage`).

**Delivered by:**
- Spec 30 (Provider-Agnostic LLM Layer) — architectural foundation.
- Spec 40 (OpenAI Provider Adapter) — GPT-5.x via Responses API.
- Spec 50 (Anthropic Provider Adapter) — Claude via Messages API.

---

### V8: Session Management & Context Optimization

Long-running sessions stay within token budgets through:

- Context compaction: summarization of earlier conversation segments.
- Smart pruning of redundant `reasoning_content` between non-tool turns.
- Token-aware prompt buffer that injects only what fits in the context window.
- Session persistence across process restarts.

**Delivered by:** Spec 10 (More Effectiveness and Economy).

---

### V11: Cost-Optimized AI Operations

Systematic minimization of API token consumption:

- Eliminate redundant `reasoning_content` transmission between non-tool turns.
- Use cheaper models (flash) for auxiliary tasks like context compaction.
- Replace LLM-based skill matching with zero-cost heuristic keyword matching.
- Remove duplicated tool documentation between system prompt and JSON schema.
- Compact built-in skill documents to essential rules only.

**Delivered by:** Spec 10 (More Effectiveness and Economy).

---

### V12: Provider-Agnostic LLM Architecture

A clean internal boundary between DsCode's orchestration layer and any specific LLM
provider SDK. Defined by the `ILlmProvider` interface:

- **Single contract:** `chat(options) → AsyncIterable<LlmStreamEvent>` is the only
  method `SessionManager` calls. It never touches an SDK directly.
- **Canonical message format:** `SessionMessage` is the single source of truth.
  Each provider converts to its own wire format internally.
- **Unified stream events:** All providers emit the same event types (`text`,
  `reasoning`, `tool_call_start`, `tool_call_delta`, `tool_call_end`, `usage`).
- **Provider registry:** Model name → provider resolution is centralized and testable.
- **Zero new behavior:** The first implementation (DeepSeekProvider) is a mechanical
  extraction of existing code behind the interface. No user-visible change.

**Delivered by:** Spec 30 (Provider-Agnostic LLM Layer).

---

### V13: Model Selection & Configuration

User-facing controls for choosing and configuring LLM providers:

- `/model` slash command to switch models mid-session.
- `/model-add`, `/model-remove`, `/model-list`, `/model-info` for provider management.
- `/model-key` to update API keys without editing `settings.json` manually.
- `/model-default` to set the default model.
- `/model-params` to configure generation parameters (temperature, max tokens, top_p).
- `/model-thinking` to tune per-model thinking budgets.
- Settings schema for provider-specific configuration (API keys, base URLs, model
  names, pricing overrides).
- Provider-aware capability detection (multimodal support, thinking mode availability,
  max context window).
- Graceful fallback when a configured provider is unreachable.

**Delivered by:**
- Spec 60 (Model Selection & Configuration) — model catalog, `/model` dropdown, thinking mode selection, graceful fallback.
- Spec 80 (Model & Engine Configuration UX) — provider management commands, API key configuration, generation parameters, thinking budget tuning.

---

### V14: Multi-Language Product UI

The DsCode CLI product interface (menus, wizards, tips, error messages) speaks the user's language, detected automatically from the operating system locale.

- **Zero-cost translation lookup:** All UI strings are served from static dictionaries — no API calls, no dynamic translation. Detection via `process.env.LANG` / `LC_ALL` / `Intl` on POSIX, `GetUserDefaultUILanguage` on Windows.
- **Locale override:** Users can force a specific language via `settings.json` (`"locale": "pt"`) or environment variable (`DEEPCODE_LOCALE=pt`), bypassing OS detection.
- **Idiomatic translations:** Each language has a single dictionary file with all UI strings. No placeholder or machine-translated text.
- **Backward compatible:** Non-translated languages fall back to English. Existing English UI is the default and zero behavior changes when locale detection fails.
- **~120 strings:** Covers slash command descriptions, welcome screen tips, keyboard shortcuts, model command wizard messages, and error messages.

**Delivered by:** Spec 90 (product-i18n) — locale detection, dictionary files, React context injection, and translation of all ~120 UI strings to Portuguese and Spanish.

**Intentionally out of scope:**
- AI conversation language — the LLM system prompt and tool descriptions remain in English.
- README localization — already handled separately.
- RTL language support (Arabic, Hebrew, etc.).

---
