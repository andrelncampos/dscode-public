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

---

### V29: Operational Robustness & Debuggability

The product must fail visibly and informatively — never silently. When something goes
wrong (API error, file I/O failure, unexpected exception), DsCode surfaces actionable
information instead of swallowing the error in a bare `catch {}` block.

- **Error visibility:** Every `catch {}` block in the codebase must either log the error
  to stderr (development) or surface a classified message to the user (production).
  Silent failures are treated as bugs.
- **Error classification:** API errors are classified into user-friendly categories —
  authentication failure, rate limit, quota exceeded, model not found, network timeout,
  context length exceeded. Raw provider error JSON is never shown to the user.
- **Test infrastructure reliability:** The CI test runner must report actual import and
  load errors, not mask them as "No test suite found." Every test failure must be
  attributable to a specific file and error message.
- **Logger resilience:** The error logger itself must not be a source of silent failures.
  If `logApiError` fails, it writes to stderr before giving up.

**Delivered by:**
- Spec 280 (error-handling-hardening) — catch logging, error classification, logger resilience.
- Spec 290 (test-infra-error-visibility) — worker stderr capture, real error reporting.

---

### V30: UI Discoverability & Polish

Small but high-impact refinements to the terminal UI that make the product feel
complete and professional — every feature is discoverable, every interaction has
clear feedback.

- **Dynamic help modal:** The `?` help screen is generated automatically from the
  slash command registry (`BUILTIN_SLASH_COMMANDS`). Adding a new slash command
  requires changes in only one place — the command definition. The help screen never
  drifts from reality.
- **Code cleanup:** Dead code, unused parameters, outdated comments, and duplicated
  logic are systematically removed. The codebase tells the truth — comments match
  behavior, functions are used where exported, no copy-paste drift between slash
  and hash command infrastructure.

**Delivered by:**
- Spec 300 (dynamic-help-modal) — auto-generate help from command registry.
- Spec 270 (code-quality-cleanup) — DRY fixes, dead code removal, comment correction.

---

### V31: Session Module Architecture

The session manager (`session.ts`) has grown to 4147 lines — a monolithic file that
mixes session lifecycle, LLM chat orchestration, context compaction, skill discovery,
MCP lifecycle, and terminal title management. This creates maintenance friction:
every change to session behavior requires navigating a single massive file, and
merge conflicts are frequent.

- **Focused modules:** Session CRUD, chat orchestration, context compaction, and
  skill discovery are extracted into separate files with clear interfaces.
- **Zero behavior change:** The split is purely mechanical — no user-visible
  difference, no API changes, no test regressions. The existing test suite serves
  as the acceptance criteria.
- **Gradual extraction:** Modules are extracted one at a time, each in its own PR,
  following the layering pattern from L1 (layer work, never a single "multi-module" PR).

**Delivered by:**
- Spec 320 (session-module-split) — phase 1: skill discovery extraction (`src/session/skills.ts`).
- Spec 330 (compaction-pure-extract) — phase 2: pure compaction functions (~140 lines, zero coupling).
- Spec 340 (mcp-lifecycle-extract) — phase 3: MCP lifecycle extraction (`initMcpServers`, `disableMcpServer`, `reconnectMcpServer`).
- Spec 350 (session-cleanup) — phase 4: dead import removal, old method cleanup, final verification.

---

### V32: Context Visibility & Reset

Users need to see what's happening inside their session — how much context they've consumed,
what the cache hit rate is, how much cost has accumulated — without leaving the TUI. They
also need a quick way to reset the conversation when the context becomes cluttered.

- **`/context` — zero-cost status dashboard:** Displays active tokens vs context window,
  message count, input/output/cached tokens, cache hit rate, session and project cost,
  compaction threshold, and session status. All data comes from in-memory state; no LLM
  call is made.
- **`/clear` — session reset without restart:** Discards all messages in the current
  session while keeping the session alive (same sessionId, same settings, same MCP
  connections). Requires explicit "yes" confirmation to prevent accidental data loss.

**Delivered by:** Spec 360 (context-status-and-clear).

---

### V33: SDD Workflow UX — Planejamento com Demarcação Explícita

O fluxo SDD depende de comandos que o usuário precisa descobrir e usar no momento certo. O `/spec-plan` atual tem ambiguidade de UX: o usuário não sabe se deve fazer brainstorming primeiro e depois chamar o comando, ou chamar o comando primeiro e depois fazer brainstorming. O modo sem argumentos depende de "analisar o histórico da conversa", o que é frágil quando a conversa mistura brainstorming com código, debug ou outras tarefas.

- **`/spec-plan-begin`:** Marca o início de um bloco de brainstorming. Opcionalmente injeta um system prompt leve instruindo o LLM a entrar em modo de elicitação — explorar, perguntar, entender o que o usuário quer construir, sem implementar nada.
- **`/spec-plan-end`:** Extrai as mensagens entre `begin` e `end` do histórico da sessão, consolida como `planText` e alimenta o template existente `spec_plan.md.ejs`, que executa os Steps 1-6 normalmente (ler documentos → alinhar com visão → planejar specs → estimar/dividir → atualizar roadmap → reportar).
- **`/spec-plan <texto>`:** Modo rápido existente preservado — para quando o usuário já sabe exatamente o que quer e não precisa de conversa exploratória.

**Design decisions:**
- O template `spec_plan.md.ejs` não muda — a diferença é apenas a origem do `planText` (texto direto vs. bloco extraído do histórico).
- `begin` e `end` são marcadores armazenados como mensagens do usuário na sessão — zero estado novo para persistir.
- O bloco entre `begin` e `end` é extraído deterministicamente (primeira mensagem após `begin` até a mensagem imediatamente anterior a `end`).

**Delivered by:** Spec 310 (spec-plan-demarcation).

---

### V34: Validação de Build Automática

O `/spec-implement` frequentemente reporta "tsc passa ✅" sem ter executado o compilador — o LLM deduz que passou porque seguiu o design. Isso gera surpresas quando o usuário tenta compilar depois.

- **`tsc --noEmit` ao final do `/spec-implement`:** O sistema executa `tsc --noEmit` uma vez após todas as tasks. Se houver erros, injeta o output como feedback e o LLM corrige (loop de até 3 tentativas, similar ao verify/audit). Só depois de `tsc` passar marca `implemented`.
- **Escopo mínimo:** Apenas `tsc` — não `eslint`, não testes. Uma validação, uma vez, no final. Custo: ~3s por spec.
- **Auto-correção reativa:** Se falhar, o LLM recebe o erro real do compilador e corrige. Se for irrecuperável após 3 tentativas, reporta e para.

**Delivered by:** Spec 370 (build-validation).

---

### V35: Resiliência Operacional

Mecanismos de segurança que protegem o usuário contra comportamentos indesejados do LLM durante sessões longas.

- **Detecção de loops:** O sistema guarda um fingerprint das últimas 3 respostas do assistant (tool calls + erro). Se forem idênticas, interrompe automaticamente e reporta: "Detectei 3 tentativas iguais falhando — mudei de abordagem?". Evita queimar tokens em ciclos infinitos.
- **`elicitationMode`:** Estado no `AppStateContext` ativado por `/spec-plan-begin`. Enquanto ativo, tool calls de `write`, `edit` e `bash` com side effects de escrita são bloqueadas no executor — o LLM **não consegue** modificar arquivos. Resolve o problema de o LLM executar o fluxo de `/spec-plan-end` antes da hora. Desativado por `/spec-plan-end` ou `/spec-plan-reset`.
- **`/spec-plan-reset`:** Novo comando que descarta um brainstorming em andamento: compacta o marcador `/spec-plan-begin` (some do contexto ativo, permanece no arquivo de sessão), sai do `elicitationMode`, e não consolida nada. O histórico da sessão fica preservado para auditoria.

**Delivered by:** Spec 380 (operational-resilience).

---

### V36: Rastreabilidade e Integridade de Specs

Ferramentas programáticas que garantem a qualidade dos documentos SDD sem depender exclusivamente do julgamento do LLM.

- **Tracing FR→Component→Task→Código:** Durante `/spec-audit`, o sistema parseia `requirements.md`, `design.md` e `task.md`, e faz grep no código por referências. Verifica: cada FR tem pelo menos um componente no design? Cada componente tem pelo menos uma task? Cada FR tem código que a implementa? Roda offline, ~200ms.
- **Backup de specs:** Antes de qualquer `write`/`edit` em arquivos dentro de `management/specs/`, o sistema cria um backup com timestamp (`.bak.YYYY-MM-DDTHH-mm-ss`). Se o LLM reescrever algo errado, o anterior está preservado.
- **Validação estrutural de docs:** Durante `/spec-verify`, um parser verifica se os documentos de spec têm: YAML frontmatter válido, seções obrigatórias (`## Functional Requirements`, `## Non-Functional Requirements`, `## Constraints`, `## Edge Cases`), e se FRs seguem o formato `### FR-XXX: Nome`. Roda offline, ~100ms.

**Delivered by:** Spec 390 (spec-traceability).

---

### V37: Auto-Update via GitHub Releases

O sistema atual de update-check usa `npm view` + `npm install -g`, que não funciona para distribuição binária. O DsCode é distribuído como binário standalone (Node SEA `.exe`), não via npm.

- **Consulta via GitHub Releases API:** `GET /repos/andrelncampos/dscode-public/releases/latest` — detecta `tag_name` e compara com a versão instalada. Sem dependência de npm, sem token necessário (releases públicas, 60 req/h por IP — 1 chamada por startup, impossível estourar).
- **Download de binário:** Detecta OS/arch (`win-x64`, `linux-x64`) e baixa o asset correspondente do release. Salva em `~/.dscode/updates/dscode-v<version>.<ext>`.
- **Substituição atômica:** No Windows e Linux, é possível renomear um binário em execução. Fluxo: baixa novo → renomeia atual para `.old` → move novo para o lugar do atual → usuário reinicia. No próximo startup, deleta o `.old`.
- **Prompt interativo preservado:** Mesmo esquema atual (Install / Ignore Once / Ignore Version), com a diferença que Install baixa o binário do GitHub ao invés de rodar npm.
- **Token opcional:** Suporte a `githubToken` em `settings.json` para evitar rate limit em ambientes com muitos reinícios. Se ausente, usa acesso anônimo.

**Delivered by:** Spec 400 (github-auto-update).

---

### V38: Pipeline SDD Multi-Spec

O `/spec-pipe` atual executa o ciclo SDD completo (new → verify → implement → audit) para **um único spec** por vez. Para projetos com múltiplos specs independentes, o usuário precisa rodar o comando manualmente para cada um, aguardando a conclusão de cada ciclo.

- **Lista de specs:** `/spec-pipe 400,401,402` aceita uma sequência de números separados por vírgula. O pipeline executa o ciclo completo para cada spec em ordem sequencial.
- **Sumário de resultados:** Ao final, reporta quantos specs foram concluídos com sucesso e quais falharam (ex: `"3/4 concluídos. Spec 402 falhou na verificação."`).
- **Parada parcial:** Se um spec falha (verify nunca passa, implement quebra, audit nunca passa), o pipeline **continua** para o próximo spec. Nenhum spec individual bloqueia os demais.
- **Ordem determinística:** Os specs são processados na ordem informada. O usuário é responsável por ordenar specs com dependências entre si.
- **Backward compatible:** `/spec-pipe 42` (spec único) continua funcionando exatamente como antes — a mudança é uma extensão, não uma substituição.

**Design decisions:**
- A função `runSpecPipeline` existente não é alterada — um loop externo a chama para cada spec.
- O parsing da lista é feito no `AppStateContext.tsx` (regex que aceita `\d+(,\d+)*`).
- Números duplicados são processados uma única vez (deduplicação no parser).
- O formato de report é Markdown para consumo tanto pelo LLM (durante `/spec-audit`) quanto pelo usuário.

**Delivered by:** Spec 410 (multi-spec-pipeline).

---

### V39: Node.js Runtime Evolution

DsCode acompanha a evolução do Node.js, adotando APIs nativas modernas e comunicando
antecipadamente mudanças de requisito de runtime aos usuários.

- **Node 24 como baseline:** Todas as APIs nativas do Node 24 são usadas quando
  simplificam o código, reduzem dependências ou melhoram robustez (`fs.globSync`,
  `zlib.zstdCompress`, `structuredClone`, `Error.isError`). Não há polyfills
  nem fallback para versões anteriores.
- **Remoção de dependências obsoletas:** Pacotes npm que duplicam APIs nativas
  do Node 24 são removidos (`glob`, `minimatch`, `@mongodb-js/zstd`).
- **Aviso de depreciação antecipado:** O welcome screen exibe um aviso destacado
  (ícone ⚠️, borda laranja) sobre o próximo requisito mínimo de Node.js com 4+
  meses de antecedência. Ex: "A partir de Outubro/2026, o DsCode passará a exigir
  Node.js 26."
- **Verificação de migração completa:** Ferramentas de varredura confirmam zero
  referências a versões antigas em `package.json`, `tsconfig.json`, CI workflows,
  build scripts, e código fonte.
- **CI alinhado com runtime real:** A matriz de CI usa a mesma versão do Node
  exigida em `engines.node` — sem defasagem entre o que é testado e o que é exigido.

**Status:** Deprecation notice implementado (commit `2b165877`). Migração Node 22→24
verificada completa em 2026-06-20.

---

### V40: Performance-First Execution

Otimizações de I/O, CPU e memória que reduzem a latência percebida pelo usuário
em operações cotidianas — inicialização da sessão, salvamento de mensagens,
streaming de respostas, e leitura de histórico.

**Oportunidades identificadas (análise de 2026-06-20):**

- **Session I/O bottlenecks:**
  - `saveSessionMessages()` reescreve o arquivo inteiro de mensagens para cada
    nova mensagem — usar `appendFileSync` incremental.
  - `loadSessionsIndex()` é chamado 6× por turno sem cache em memória — cada
    chamada faz `readFileSync` + `JSON.parse` do disco.
  - `ensureProjectDir()` executa `mkdirSync` em toda operação de I/O — bastaria
    um booleano `dirEnsured`.
  - Concatenação de strings com `+=` nos loops de streaming (`content += event.text`)
    aloca novas strings a cada chunk — usar array `push` + `join` ao final.

- **Startup latency:**
  - Skills são carregadas com `readFileSync` + `statSync` sequencialmente —
    paralelizar com `Promise.all` + `fs/promises`.
  - Templates de prompt (`templates/tools/*.md`, `templates/skills/*.md`) são
    relidos do disco a cada turno — cache em memória (conteúdo imutável do pacote).

- **Compaction & storage performance:**
  - `findStablePrefixEndIndex()` recalcula hash SHA-256 do conteúdo acumulado
    para cada mensagem system (O(N²) em bytes processados) — usar uma única
    instância de hash incremental.
  - `readRecentTurns()` lê e descomprime arquivos de turn sequencialmente —
    paralelizar com `Promise.all` + early termination.
  - `backupSpecFile()` usa `copyFileSync` bloqueante — substituir por versão
    assíncrona com `fs/promises.copyFile`.

**Itens já otimizados (antes desta análise):**
- `glob-handler.ts` → `fs.globSync` nativo (-51 linhas, commit `79c4e25`)
- `grep-handler.ts` → paralelismo assíncrono, streaming, `fs.globSync` nativo
  (-143 linhas, -1 dependência, commit `c2087aa`)
- `turn-compressor.ts` → zstd nativo do Node 24 via `promisify`

**Delivered by:**
- Spec 420 (session-io-optimization)
- Spec 430 (startup-performance)
- Spec 440 (compaction-and-memory-perf)

**Correções pós-implementação (análise de 2026-06-20):**

Análise de efeitos colaterais das specs 420/430/440 identificou pontos de atenção
que não são regressões críticas, mas merecem hardening:

- **`readRecentTurns` — concorrência limitada com parada antecipada:** O `Promise.all`
  irrestrito da spec 440 lê e descomprime todos os arquivos candidatos em paralelo
  antes de aplicar o budget (`maxContextChars`). Com `recentTurns` até 100, isso
  desperdiça I/O e memória quando o budget é atingido nos primeiros arquivos.
  Correção: processar em lotes (5-10) com aplicação progressiva do budget, parando
  quando excedido. Preserva o ganho de paralelismo sem o desperdício.

- **`_cachedSessionsIndex` — invalidação por mtime:** O cache write-through da spec
  420 nunca invalida por mudança externa. No DsCode, é plausível ter dois terminais
  abertos no mesmo projeto ou automação tocando `.dscode/`. Correção: verificar o
  mtime do arquivo antes de usar o cache; se mais recente, recarregar.

- **`_projectDirEnsured` — recuperação de ENOENT:** Se o diretório `.dscode/` for
  deletado durante a sessão, a flag `true` impede a recriação. Cenário anormal, mas
  a correção é simples: em falha `ENOENT` numa operação dependente, resetar a flag
  e tentar recriar.

- **ESLint `no-floating-promises`:** A spec 440 tornou `backupSpecFile` assíncrono.
  TypeScript não garante detecção de Promise flutuante em call sites futuros —
  apenas ESLint com a regra `@typescript-eslint/no-floating-promises` ativa. Verificar
  e ativar a regra se ausente.

**Delivered by:**
- Spec 450 (v40-performance-hardening)
