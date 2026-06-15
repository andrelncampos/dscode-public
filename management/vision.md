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

### V15: Steering Management Commands

Full lifecycle management of steering rules within `AGENTS.md`:

- `/steering-add` — add a new steering rule to the `## Steering` section. Detects conflicts with existing rules and asks the user before adding contradictory rules.
- `/steering-list` — list all steering rules with positional numbering (1-based).
- `/steering-remove <N>` — remove the Nth steering rule by position. The AI reads the file, locates the bullet, and removes it without touching other content.
- `/steering-alter <N>` — replace the Nth steering rule with new text. Same position-based approach — reads, replaces, writes.

Steering rules are always loaded into every session context (`inclusion: always`). They are short, concise, imperative guidelines (one to two sentences each) stored as bullet points under `## Steering` in `AGENTS.md`. The file is compatible with the open `AGENTS.md` standard used by Kiro and other AI coding tools.

**Design decisions:**
- Position-based referencing (1, 2, 3...) — no persistent IDs in the file. Keeps `AGENTS.md` clean and interoperable.
- Steering is separate from skills: steering = "how to behave" (always loaded, small), skills = "what to do" (on-demand, can be large).
- The AI performs the file edits using its existing file tools (Read, Write, Edit) — no new tool implementations needed.

**Delivered by:** Spec 100 (steering-management).

---

### V16: Skills Inclusion Modes

Fine-grained control over when skills are loaded into the AI context:

- **`inclusion: auto`** (default, current behavior) — skill is loaded automatically via keyword matching against the user's prompt, and is also available via slash command and dropdown.
- **`inclusion: manual`** — skill is NEVER loaded by keyword matching. It is only activated explicitly by the user through:
  - `#skill-name` prefix in the prompt input (new syntax, distinct from `/` for commands).
  - The `/skills` dropdown menu.
  - Typing `#skill-name` and pressing Enter.

The `inclusion` field is optional YAML frontmatter in `SKILL.md`. When absent, defaults to `auto` (backward compatible — all existing skills continue working unchanged).

**Design decisions:**
- `#` prefix for manual skills is semantically distinct from `/` (slash commands = system actions, `#` = load knowledge/instructions). Precedent: Kiro uses `#steering-file-name` for manual inclusion.
- `fileMatch` (glob-based conditional loading) is intentionally deferred — requires additional design around "current file" tracking.
- `always` mode for skills is intentionally omitted — use `AGENTS.md` steering for always-loaded content.
- No new commands for skill lifecycle management — the AI's existing file tools (Write, Bash) already handle create/edit/delete of `SKILL.md` files.

**Delivered by:** Spec 110 (skills-inclusion-modes).

---

### V17: Subagent Architecture & Context Isolation

Specialized AI assistants that execute tasks in isolated context windows, preserving
the main conversation context and reducing token costs:

- **Context isolation:** Subagents run with their own message array, system prompt,
  and tool set. Only the final summary is returned to the main conversation —
  exploration logs, search results, and intermediate reasoning never pollute the
  main context.
- **Built-in Explore subagent:** A read-only codebase explorer using the cheap model
  (`deepseek-v4-flash`, thinking disabled). Handles file discovery, code search, and
  architecture mapping. Configurable thoroughness levels (quick, medium, thorough).
  The main agent auto-delegates when a task matches exploration patterns.
- **Skills as subagents:** The existing `SKILL.md` system gains a `mode` field.
  `mode: prompt` (default, current behavior) injects the skill as a system message.
  `mode: agent` spawns the skill as an isolated subagent with its own model, tools,
  and thinking settings — it does the work and returns only the result.
- **Cost optimization:** Subagents default to cheap models (`deepseek-v4-flash`)
  with thinking disabled. Budget tracking records subagent API calls separately.
- **Tool restrictions:** Subagents can be limited to read-only tools (Read, Grep,
  Glob) to prevent unintended modifications.
- **Auto-delegation:** The main agent decides when to delegate based on subagent
  descriptions (for custom skills) or built-in heuristics (for Explore).
- **Backward compatible:** All existing skills continue working unchanged. Skills
  without `mode` default to `prompt`. The Explore subagent is always available and
  requires no configuration.

**Delivered by:**
- Spec 120 (explore-subagent) — built-in Explore subagent for codebase exploration.
- Spec 130 (skills-as-subagents) — skills with `mode: agent` run as isolated subagents.

---

### V18: MCP Runtime & Policy Layer

MCP (Model Context Protocol) treated as an execution runtime — the DsCode application
enforces policy deterministically; the LLM never decides what MCP tools are allowed.

**Foundation (already built):**
- `McpManager` — full lifecycle: prepare, initialize, connect, disconnect.
- `McpClient` — stdio transport, JSON-RPC 2.0, `tools/list`, `tools/call`,
  `prompts/list`, `resources/list`.
- Tool namespacing (`mcp__<server>__<tool>`), collision avoidance, status tracking.
- `notifications/tools/list_changed` support and server crash detection.
- Integration with `ToolExecutor` and permission scoping.

**What this value block adds:**

- **Policy layer — steering declares, runtime enforces:** The steering documents intent
  (`MCP: deny mcp__shell__*`). The runtime compiles, validates, normalizes, and applies
  `allow/ask/deny` rules **before** any `tools/call`. Denied tools return a synthetic
  error — the MCP server is never contacted. Allowed tools bypass the permission prompt
  entirely. The LLM reads the policy from steering for awareness, but DsCode enforces it.

- **Tool Search — compact inventory:** Instead of dumping all MCP tool schemas into the
  LLM context, send only tool names and short descriptions initially. Full JSON schemas
  are loaded on-demand when a tool is about to be called. Ranking is lexical in the first
  iteration; embedding-based semantic discovery is deferred.

- **Configuration scopes:** Three formally separated levels — global
  (`~/.dscode/mcp.json`), project (`.dscode/mcp.json`), session (temporary).
  Precedence: session > project > global. `"disabled": true` removes a server;
  `"disabledTools"` filters specific tools.

- **Auto-reconnect with backoff:** Servers that crash reconnect automatically
  (2s → 4s → 8s → 16s, max 60s). After 5 failures, status moves to `failed` permanently.
  Successful reconnection resets the counter and re-lists tools.

- **HTTP transport (basic):** Remote MCP servers via Streamable HTTP with static
  token/API key authentication. Same interface as stdio. OAuth deferred.

**Intentionally deferred:** MCP input channels (webhooks, events), OAuth login flow,
embedding-based semantic Tool Search, TUI inspection panel.

**Implementation approach — 2 phases:**

**Phase 1: MCP Hardening Layer** — Transform MCP from "it works" to "it's governable."
Policy, scopes, and Tool Search are designed together because they're interdependent:
scopes say where a tool came from (global, project, skill, session), policy decides
if it can run, and Tool Search decides what the LLM sees. If these three aren't
coherent, the model sees tools it can't call, policy blocks things without
explanation, and skills inject tools without traceability. This phase is a
consolidation, not a build-from-scratch — the existing `McpManager` and `McpClient`
already provide ~70% of the runtime.

**Phase 2: MCP Methodological Layer** — Integrate MCP into the DsCode methodology.
Skills carry `mcp.json`, specs declare relevant MCP sources, resources and prompts
are exposed with policy control, and the TUI shows servers, tools, scopes, policies,
errors, and execution history. Implementation is broken into small, testable
sub-deliveries: first skills loading `mcp.json`, then SDD consuming declared MCP,
then TUI inspection, then TUI actions (reconnect, disable, approve).

---

### V19: Skills as MCP-Enabled Capabilities

Skills become installable, context-aware capability packs that carry MCP servers,
steering rules, hooks, and permissions together. A skill is no longer just instructions —
it is a complete runtime capability.

- **`mcp.json` inside skills:** A skill declares its MCP servers. Servers start when the
  skill activates (keyword match or `#skill-name`) and stop when the session moves away.
  No global tool catalog pollution.

- **Capability packs:** `SKILL.md` (instructions) + `mcp.json` (tools) + steering rules +
  permission policies + hooks. Example: `postgres-dba` brings `query`, `list_tables`,
  `describe`, plus safety steering (`MCP: deny mcp__postgres__drop_table`), all in one
  installable unit.

- **Skill-level permissions:** MCP tools brought by a skill inherit the skill's permission
  boundary. The user approves a skill once, not every tool individually. Policy rules
  from the skill's steering merge with the session's steering at activation time.

- **Context-aware lifecycle:** Idle servers from inactive skills can be suspended.
  Returning to a topic reconnects the skill's servers automatically.

**Differentiation:** Claude Code has strong MCP runtime but a flat tool catalog. Kiro has
Powers but less explicit SDD integration. DsCode combines both — skills carry MCP as
part of a capability pack, scoped and policy-governed.

---

### V20: MCP Integrated with SDD Workflow

MCP tools become first-class participants in the Spec-Driven Development cycle. The spec
defines which external tools are relevant; implementation uses them deterministically.

- **Specs reference MCP tools:** `requirements.md` and `design.md` declare which servers
  and tools are relevant for that spec. During `/spec-implement`, the LLM uses those
  tools because the spec's contract says they're needed — not because they're globally
  available.

- **MCP-assisted spec creation:** During `/spec-new`, the LLM queries real data sources —
  GitHub issues, Postgres schemas, internal docs, official documentation — producing
  requirements grounded in reality, not guesswork.

- **Spec-scoped tool access:** Each spec defines a temporary allowlist. During
  implementation, only declared tools are available. During verification, a different set
  may apply. Prevents tool sprawl and keeps the LLM focused.

- **Audit trail:** Every MCP call made during a spec's lifecycle is recorded against that
  spec — traceable evidence of which external data influenced which decisions.

**The DsCode triangle (competitive moat):**
```
        SDD (Spec Driven Development)
              /\
             /  \
            /    \
           /      \
          /________\
   MCP runtime    Skill System
   (policy)       (packaging)
```
Claude Code dominates MCP runtime. Kiro dominates packaging. Neither has SDD at the top.
DsCode combines all three — MCP is not a generic tool catalog; it's a spec-scoped,
skill-packaged, policy-governed capability system.

---

### V21: Cache Metrics Visibility

Real-time visibility into LLM prompt cache efficiency — showing users exactly how much
they save through cache hits, not just total token consumption.

- **Cache hit rate:** Percentage of input tokens served from cache (`hit / (hit + miss) * 100`).
  Displayed per-turn in the TUI and aggregated per-session in the exit summary.
- **Cache read cost:** Monetary savings from cached tokens, calculated using each provider's
  `cacheReadPrice`. Shown alongside total cost (e.g., `Cache: 91% hit | saved $0.42`).
- **Provider normalization:** Each provider reports cache differently (DeepSeek:
  `prompt_cache_hit_tokens`, OpenAI: `prompt_tokens_details.cached_tokens`, Anthropic:
  `cache_read_input_tokens`). All are normalized into a common `ModelUsage` field.
- **Per-session tracking:** Cache metrics recorded in `budget.md` for auditability.
- **Provider-aware display:** Metrics adapt to provider — show cache data when available,
  hide gracefully when the provider doesn't support prompt caching.

**Delivered by:** Spec 180 (cache-metrics-display).

---

### V22: Cache-Aware Prompt Construction

Deterministic, cache-friendly system prompt assembly that preserves DeepSeek's KV cache
prefix across consecutive turns — without sacrificing the richness of skills, steering,
or MCP tools.

- **Deterministic tool ordering:** Built-in tools, MCP tools, skills, and steering rules
  are serialized in a fixed, deterministic order (alphabetical by name). No variation
  between calls.
- **Stable prefix builder:** Separates the prompt into a "Stable Prefix" (tools, steering,
  skills — changes only on config change) and a "Dynamic Tail" (conversation history,
  user messages, runtime context — changes every turn).
- **`deepseek.cacheMode` setting:** `"off"` (current behavior), `"aware"` (deterministic
  ordering, safe for all providers), `"strict"` (stable prefix, removes volatile content
  like model name and project root path from the prefix).
- **Prefix hash verification:** In `strict` mode, the system computes a hash of the Stable
  Prefix and logs it — enabling automated tests that verify prefix stability across turns.
- **Multi-provider safe:** `cacheMode` only activates when `providerName === "deepseek"`.
  OpenAI, Anthropic, and Gemini are unaffected.
- **No SDD/steering/skills removal:** All governance features remain in the prompt — they
  are simply ordered deterministically.

**Delivered by:** Spec 200 (cache-aware-prompt).

---

### V23: Automatic Tool-Call Repair

Deterministic repair of malformed LLM tool calls before execution — reducing silent
failures and improving robustness without adding LLM calls or compromising permissions.

- **Three-stage repair pipeline:**
  1. **Parse:** Attempt `JSON.parse` on string arguments. Handle object arguments directly.
     Recover from truncated JSON and unescaped characters.
  2. **Validate:** Check that the tool name exists in the tool registry. Verify required
     arguments are present. Detect type mismatches.
  3. **Repair:** Apply deterministic fixes — trim whitespace, lowercase tool names,
     inject default values for missing optional arguments.
- **Controlled retry:** Maximum 2 repair attempts per tool call. If repair fails, return
  a clear error to the LLM (not silent failure).
- **Permission-safe:** Repair does not bypass `allow/ask/deny` gates. Repaired tool calls
  go through the same permission pipeline as original calls.
- **Repair metrics:** Track how many tool calls were repaired, which stage succeeded, and
  repair latency — visible in debug logs and MCP execution history.
- **Provider-agnostic:** Works for all LLM providers. DeepSeek historically benefits most
  (common JSON escaping issues), but the pipeline is universal.

**Delivered by:** Spec 190 (tool-call-repair).

---

### V24: DeepSeek-Optimized Execution

DeepSeek-specific optimizations that go beyond generic OpenAI-compatible behavior — making
DsCode's DeepSeek integration native-level without sacrificing multi-provider architecture.

- **Dedicated response parser:** Extracts `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`,
  `reasoning_content`, and rate-limit headers with DeepSeek-specific field names.
- **Error handling:** Recognizes DeepSeek-specific errors (overload, billing, context length)
  and provides actionable messages.
- **Feature flags:** `deepseek.nativeParser = true/false` — falls back to generic
  OpenAI-compatible parsing when disabled. Safe default: `true`.
- **Multi-provider intact:** DeepSeekProvider remains behind the `ILlmProvider` interface.
  OpenAI, Anthropic, and Gemini providers are completely unaffected.
- **Contract-based testing:** Dedicated test suite with mocked DeepSeek API responses
  covering cache fields, reasoning content, error codes, and streaming edge cases.

**Delivered by:** Spec 230 (deepseek-native-parser).

---

### V25: Pro-First Execution Modes

Pre-configured execution modes that let users switch between "maximum capability" and
"cost-optimized with cache" without manually adjusting multiple settings.

- **`/mode pro-cache`:** DeepSeek Pro with `cacheMode: "aware"`, `reasoningEffort: "high"`,
  `thinkingEnabled: true`. Balanced for serious work with cache savings.
- **`/mode pro-max`:** DeepSeek Pro with `reasoningEffort: "max"`, `thinkingEnabled: true`,
  cacheMode at user preference. Maximum capability, no cost optimization.
- **`/mode economy`:** Flash model with thinking disabled, `cacheMode: "aware"`.
  For quick tasks where Pro is overkill. Opt-in, not default.
- **Per-mode settings:** Each mode sets `model`, `thinkingEnabled`, `reasoningEffort`,
  `cacheMode`, and `maxTokens` in one command. No need to run `/model` + manual config.
- **Pro-first by default:** The default mode remains Pro. Users opt into economy mode
  explicitly. This preserves the strategic position that DsCode prioritizes capability
  for serious engineering tasks.

**Delivered by:** Spec 220 (pro-first-modes).

---

### V26: Auditabilidade e Transparência

Public-facing trust signals for a closed-source product — proving what DsCode does
without revealing how it's built.

- **Release checksums:** SHA256 hashes for every npm package and binary release,
  published alongside the release. Users can verify integrity independently.
- **SBOM (Software Bill of Materials):** Machine-readable inventory of all dependencies
  (npm packages, Node.js runtime), generated at build time via `cyclonedx` or `spdx`.
- **Build provenance:** GitHub Actions attestation linking each release to its source
  commit and build workflow — verifiable via `npm audit signatures`.
- **Provider documentation:** Public documentation of exactly what data is sent to each
  LLM provider, what headers are included, and how API keys are stored (AES-256-GCM).
- **Privacy policy:** Explicit, short privacy policy covering: no telemetry by default,
  opt-in telemetry scope, API key handling, log file locations, and data retention.
- **Threat model:** Documented security boundaries — what DsCode protects against
  (key exfiltration, prompt injection via MCP), what it doesn't (compromised npm
  packages, terminal emulator keyloggers).

**Intentionally out of scope:** Opening core algorithms (prompt orchestration, skill
matching heuristics, compaction strategy). These remain proprietary.

**Delivered by:** Spec 240 (auditabilidade).

---

### V27: Billing Completeness & Integrity

Garantia de que todos os pontos de consumo de API são contabilizados com precisão
no `budget.md`, incluindo custo de cache e economia real.

- **Normalização universal de cache:** Todos os 7 call sites de `recordBudgetCost`
  devem chamar `normalizeCacheTokens()` antes de gravar. Atualmente apenas o chat
  flow principal (1 de 7) o faz — compaction, edit handler, explore subagent e
  web-search handler gravam custo mas nunca registram economia.
- **Cache tokens no Gemini:** O provider Gemini emite `usageMetadata` mas não mapeia
  campos de cache (`cachedContentTokenCount`). Investigar e implementar.
- **Compaction budget tracking:** O caminho de compaction (`session.ts:1936`) registra
  custo mas não normaliza cache — corrigir para manter paridade com o chat principal.
- **Tool handlers budget tracking:** `edit-handler.ts`, `explore-subagent.ts` e
  `web-search-handler.ts` registram custo via `response.usage` direto sem normalização
  de cache — corrigir todos.
- **Helper extraction:** Extrair a dupla `normalizeCacheTokens` + `recordBudgetCost`
  em uma função helper para evitar regressão e garantir consistência em todos os
  call sites presentes e futuros.
- **Test coverage:** Adicionar testes que verificam que todo call site de
  `recordBudgetCost` produz `cacheSaved > 0` quando a resposta da API contém tokens
  de cache.

**Auditado em:** 2026-06-15 — 7 call sites, 6 com bug de normalização ausente.

**Delivered by:** Spec 250 (billing-completeness).

---

### V28: Developer Notes & Reminders

Ultra-light note-taking integrated into the terminal workflow. The developer
registers quick reminders without leaving the keyboard — no context-switching to
a separate app like Notion, Obsidian, or Jira.

- **`/note-add`** — create a note with optional deadline (`--deadline YYYY-MM-DD`)
  and tags (`--tag bug`, `--tag todo`). Returns a short ID for reference.
- **`/note-list`** — list notes filtered by status (`--status open|closed|paused|abandoned`),
  overdue items (`--overdue`), or linked spec (`--spec <id>`). Open notes first,
  sorted by deadline proximity. Overdue notes highlighted.
- **`/note-status <id> <status>`** — change status: `open`, `closed`, `paused`, `abandoned`.
- **`/note-edit <id> "new text"`** — edit note content in-place.
- **`/note-deadline <id> [YYYY-MM-DD|--remove]`** — set, change, or remove a deadline.
- **Spec linking** — notes can optionally reference a spec (`--spec <id>`)
  for traceability. `/note-list --spec 120` shows only notes for that spec.

**Storage:** `.dscode/notes.json` — a JSON array, one object per note. Simple
enough to hand-edit, structured enough for programmatic querying.

**Design philosophy:** Not a task manager, not a Jira replacement, not a
project tracker. Just a way to not forget what can't be done right now.
If the developer thinks "I should check that later" during a session, they
type `/note-add` and move on.

**Delivered by:**
- Spec 260A (notes-mvp) — `/note-add`, `/note-list`, `/note-status`.
- Spec 260B (notes-refinement) — `/note-edit`, `/note-deadline`, spec linking.
