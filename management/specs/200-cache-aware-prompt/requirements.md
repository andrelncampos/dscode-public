# Spec 200: Cache-Aware Prompt — Requirements

## Value Delivery

Delivers **V22: Cache-Aware Prompt Construction** (vision.md §V22):

Deterministic, cache-friendly system prompt assembly that preserves DeepSeek's KV cache prefix across consecutive turns — without sacrificing the richness of skills, steering, or MCP tools.

- **Deterministic tool ordering:** Built-in tools, MCP tools, skills, and steering rules are serialized in a fixed, deterministic order (alphabetical by name). No variation between calls.
- **Stable prefix builder:** Separates the prompt into a "Stable Prefix" (tools, steering, skills — changes only on config change) and a "Dynamic Tail" (conversation history, user messages, runtime context — changes every turn).
- **`cacheMode` setting:** `"off"` (current behavior), `"aware"` (deterministic ordering, safe for all providers), `"strict"` (stable prefix, removes volatile content like model name and project root path from the prefix).
- **Prefix hash verification:** In `strict` mode, the system computes a hash of the Stable Prefix and logs it — enabling automated tests that verify prefix stability across turns.
- **Multi-provider safe:** `cacheMode` only activates when `providerName === "deepseek"`. OpenAI, Anthropic, and Gemini are unaffected.
- **No SDD/steering/skills removal:** All governance features remain in the prompt — they are simply ordered deterministically.

Additionally delivers a small follow-up from V21 (Spec 180) — cache savings persistence in `budget.md` for project-level cost tracking.

---

## Functional Requirements

### FR-001: Deterministic System Prompt Assembly

**What:** The system prompt content concatenated in `createSession()` must produce identical output given identical inputs — tool docs, default skills, agent instructions (AGENTS.md), and runtime context. Currently the order of system messages appended is fixed but individual components (tool docs, skill docs) may vary due to filesystem read order.

**Why:** DeepSeek's KV cache is prefix-based. If the system prompt changes between calls — even by one byte — the entire cache is invalidated and all input tokens must be recomputed. Deterministic assembly ensures the cache is preserved across turns.

**Acceptance Criteria:**
- [ ] `getSystemPrompt()` returns tool docs in alphabetical order by filename (the `.sort()` already exists, verify it is the sole source of order).
- [ ] `getDefaultSkillPrompt()` returns skill docs in alphabetical order by `name` field.
- [ ] `buildSystemMessage()` calls in `createSession()` are appended in a fixed sequence: (1) system prompt, (2) default skill prompt, (3) runtime context, (4) agent instructions, (5) memory context.
- [ ] When AGENTS.md has not changed, the concatenation of steps 1-4 produces identical `SessionMessage.content` across consecutive `createSession()` calls.
- [ ] Test: hash of system messages (1-4) is identical across two back-to-back `createSession()` calls when no config changed.

### FR-002: Alphabetical Serialization of Tool Document Blocks

**What:** `readToolDocs()` reads `.md` and `.md.ejs` files from `templates/tools/`, calls `.sort()` on the filenames, then joins them. This already produces alphabetical order. FR-002 ensures this deterministic order is preserved and tested.

**Why:** The `.sort()` call on line ~259 of `prompt.ts` is the mechanism. It must not be removed, and there must be a test that verifies deterministic output.

**Acceptance Criteria:**
- [ ] `readToolDocs()` result is identical when called twice with the same `options`.
- [ ] A unit test reads tool docs twice and asserts string equality.
- [ ] The `.sort()` call in `readToolDocs()` is annotated with a comment explaining it exists for KV cache stability.
- [ ] Tool docs XML blocks within the system prompt appear in alphabetical order by filename (e.g., `AskUserQuestion`, `bash`, `edit`, `Explore`, `glob`, `grep`, `read`, `UpdatePlan`, `WebFetch`, `WebSearch`, `write`).

### FR-003: Skill Document Deterministic Ordering

**What:** `buildSkillDocumentsPrompt()` receives an array of `SkillPromptDocument` objects. The order of these objects in the concatenated prompt must be deterministic — alphabetical by `name`.

**Why:** Skills are loaded from filesystem scan. `fs.readdirSync` order is filesystem-dependent and varies across OS, filesystem, and directory mutations. If skill order varies, the system prompt content varies, invalidating DeepSeek's KV cache.

**Acceptance Criteria:**
- [ ] `buildSkillDocumentsPrompt()` sorts `skills` array by `name.toLowerCase()` before rendering.
- [ ] Existing callers (`getDefaultSkillPrompt`, skill injection in `createSession`) produce identical output when called with identical inputs.
- [ ] Unit test: `buildSkillDocumentsPrompt([{name:"B"}, {name:"A"}])` produces output starting with skill A block before skill B block.

### FR-004: Stable Prefix / Dynamic Tail Separation

**What:** The system messages appended during `createSession()` are logically partitioned into two regions: **Stable Prefix** (system prompt, default skills, steering/AGENTS.md — changes only on config/settings mutation) and **Dynamic Tail** (runtime context with model name + project root, memory context with recent turn transcripts — changes every turn).

This separation is a logical annotation; no structural message format change. The prompt continues to be `system`-role messages in `SessionMessage[]`.

**Why:** The vision.md V22 specification requires two modes beyond "off": "aware" (deterministic ordering) and "strict" (stable prefix with volatile content removed). The stable prefix concept is also required by Spec 210 (cache-aware compaction) and Spec 220 (pro-first modes).

**Acceptance Criteria:**
- [ ] A new function `getStablePrefixContent(projectRoot, model, ...)` returns the concatenated content of non-volatile system messages.
- [ ] The stable prefix includes: `${SYSTEM_PROMPT_BASE} + tool docs + default skill prompt + agent instructions`.
- [ ] The dynamic tail includes: `runtime context (model name + project root + env JSON) + memory context + theme messages`.
- [ ] When called twice without changing AGENTS.md, skills, or settings, `getStablePrefixContent()` returns identical content.
- [ ] When called after changing `settings.json` model, `getStablePrefixContent()` returns identical content (model name is in dynamic tail, not stable prefix).

### FR-005: cacheMode Setting Schema

**What:** A new optional `cacheMode` field in the DeepSeek settings namespace, resolved via `ResolvedDeepcodingSettings`. The field accepts one of three string values: `"off"`, `"aware"`, `"strict"`.

**Why:** Users need control over cache optimization level. "off" preserves current behavior; "aware" enables deterministic ordering at zero risk; "strict" maximizes cache hit rate for advanced users.

**Acceptance Criteria:**
- [ ] `DeepcodingSettings` gains optional field: `cacheMode?: "off" | "aware" | "strict"`.
- [ ] `ResolvedDeepcodingSettings` gains required field: `cacheMode: "off" | "aware" | "strict"`.
- [ ] Default value when absent from `settings.json`: `"off"` (backward compatible — no behavior change).
- [ ] Invalid values (e.g., `"enabled"`, `"true"`) are silently coerced to `"off"` with a debug log warning.
- [ ] The field is NOT namespaced under `deepseek` in settings.json — it lives at the top level of DeepcodingSettings because provider-agnostic settings must not leak provider names. The field IS only honored when the active provider is DeepSeek (see FR-008).
- [ ] Settings migration: existing `settings.json` files without `cacheMode` continue to work with `"off"` as default.

### FR-006: cacheMode "aware" — Deterministic Ordering Only

**What:** When `cacheMode === "aware"`, the system prompt assembly is fully deterministic: tool docs sorted alphabetically, skill docs sorted alphabetically, system messages appended in fixed order. No content is removed or reordered beyond the deterministic guarantee.

**Why:** This is the safe default for users who want cache benefits without any risk of altered behavior. Compatible with all providers (OpenAI, Anthropic, Gemini) but only activated for DeepSeek.

**Acceptance Criteria:**
- [ ] When `cacheMode === "aware"`, `getSystemPrompt()` applies alphabetical sort to tool docs.
- [ ] When `cacheMode === "aware"`, `buildSkillDocumentsPrompt()` applies alphabetical sort to skills.
- [ ] When `cacheMode === "aware"`, the system message append order in `createSession()` is identical to `"off"` — no reordering of message blocks.
- [ ] When `cacheMode === "aware"` and provider is NOT DeepSeek, the mode is silently ignored (acts as `"off"`). Logged at debug level.
- [ ] Unit test: two consecutive `getSystemPrompt()` calls with `cacheMode: "aware"` return identical strings.

### FR-007: cacheMode "strict" — Stable Prefix with Volatile Content Removal

**What:** When `cacheMode === "strict"`, in addition to deterministic ordering (FR-006), volatile content is moved from the stable prefix to the dynamic tail. Specifically:
1. The model name line (`The current LLM model is ${model}`) is extracted from the stable prefix and appended after the prefix.
2. The runtime context JSON block (project root, homedir, system info, etc.) is moved to the dynamic tail.
3. The memory context (recent turn transcripts) remains in the dynamic tail.
4. Only `SYSTEM_PROMPT_BASE` + tool docs + default skill docs + agent instructions form the stable prefix.

**Why:** The runtime context contains the project root path and model name — both can change between runs. Moving them out of the stable prefix ensures the KV cache prefix is identical across sessions on the same project with the same config.

**Acceptance Criteria:**
- [ ] When `cacheMode === "strict"`, `getRuntimeContext()` output is appended as a separate system message AFTER the stable prefix messages.
- [ ] The model name line is not embedded in the stable prefix — it appears only in the runtime context message.
- [ ] `getSystemPrompt()` in strict mode does NOT include the model name line.
- [ ] The stable prefix content (FR-004) does NOT include the project root path.
- [ ] `getStablePrefixContent()` called twice with different `process.cwd()` paths returns identical content (paths are in dynamic tail).
- [ ] When provider is NOT DeepSeek, `"strict"` degrades to `"aware"` behavior. Logged at debug level.
- [ ] Unit test: hash of stable prefix is identical across two calls with different project roots but same AGENTS.md + tools.

### FR-008: Multi-Provider Guard

**What:** `cacheMode` settings only take effect when the resolved provider for the active model is `"deepseek"`. When the provider is OpenAI, Anthropic, or Gemini, all cache mode behavior is silently disabled (treated as `"off"`).

**Why:** Prompt caching behavior is provider-specific. Forcing deterministic ordering on providers that don't benefit from it is unnecessary constraint. The guard also prevents confusing behavior if a user switches to a non-DeepSeek model.

**Acceptance Criteria:**
- [ ] `getResolvedSettings()` provides `providerName` (resolved via model → provider registry).
- [ ] `resolveCacheMode(settings)` returns `"off"` when `providerName !== "deepseek"`.
- [ ] Debug log emitted when cacheMode is suppressed due to non-DeepSeek provider.
- [ ] No effect on OpenAI, Anthropic, or Gemini prompt construction — they continue using current behavior regardless of `cacheMode` value.

### FR-009: Prefix Hash Computation and Logging

**What:** When `cacheMode !== "off"`, the system computes a SHA-256 hash of the stable prefix content and logs it at debug level. This enables automated tests to verify prefix stability and helps debugging cache misses.

**Why:** Without a hash, users cannot determine if their prompt is actually stable. The hash is a verifiable fingerprint of the prefix — if it changes, the KV cache was invalidated.

**Acceptance Criteria:**
- [ ] `getStablePrefixHash(content: string): string` returns a SHA-256 hex digest.
- [ ] When `cacheMode !== "off"`, the hash is logged: `[cache-aware] Stable prefix hash: <hex>`.
- [ ] The hash is computed AFTER volatile content removal (in strict mode) or after deterministic sorting (in aware mode).
- [ ] Hash computation is O(n) where n = content length — no performance regression.
- [ ] Unit test: same content → same hash. Different content → different hash.

### FR-010: Budget Cache Savings Persistence

**What:** The `budget.md` file in `.dscode/` gains two additional columns: `Cache Saved (USD)` and `Cache Hit %`. The daily total row includes project-level cache savings.

**Why:** Spec 180 added cache tracking in the TUI and exit summary, but cache savings are not persisted in the project budget file. Without persistence, users cannot track cumulative cache savings across sessions. The `DailyCost` type already accumulates `cacheSaved` in memory — it just needs to be written to and read from the markdown file.

**Acceptance Criteria:**
- [ ] `buildBudgetMarkdown()` outputs columns: `| Data | Custo (USD) | Cache Saved (USD) | Cache Hit % |`.
- [ ] Each daily row: `| 2026-06-14 | $1.23 | $0.45 | 87.3% |`.
- [ ] Total row: `| **Total** | **$3.33** | **$1.37** | **89.4%** |`.
- [ ] `parseBudgetFile()` parses the two new columns from existing budget.md files.
- [ ] Backward compatibility: budget.md files without cache columns parse successfully (cache fields default to 0/0/0).
- [ ] Round-trip integrity: write budget → read budget → `cacheSaved` values match within $0.01 tolerance.
- [ ] `recordBudgetCost()` continues to accumulate `cacheSaved` as it already does — no changes needed to accumulation logic.
- [ ] Unit test: writing a budget with cache entries and reading it back preserves all values.

---

## Non-Functional Requirements

### NFR-001: Zero Performance Regression

**What:** Prompt assembly time must not regress by more than 5ms per `createSession()` call.

**Acceptance Criteria:**
- [ ] `getSystemPrompt()` with `cacheMode: "aware"` or `"strict"` completes in <10ms (excluding filesystem I/O).
- [ ] SHA-256 hash computation adds <1ms for typical system prompt size (~50KB).
- [ ] Deterministic sorting adds no measurable overhead since `.sort()` already exists in `readToolDocs()`.

### NFR-002: Deterministic Output

**What:** Same inputs → same system prompt. This must be verifiable via automated tests.

**Acceptance Criteria:**
- [ ] A test suite verifies that `getSystemPrompt()` + `getDefaultSkillPrompt()` + `loadAgentInstructions()` produce identical output across 10 consecutive calls with identical inputs.
- [ ] A test suite verifies that `getStablePrefixHash()` returns identical hash across 10 consecutive calls.
- [ ] The only sources of non-determinism are: AGENTS.md content (user-editable), skill files content (user-editable), tool templates content (repo-managed).

### NFR-003: Backward Compatibility

**What:** Existing `settings.json` files without `cacheMode` continue to work identically.

**Acceptance Criteria:**
- [ ] All existing tests pass with zero modifications when `cacheMode` is absent from settings.
- [ ] All existing tests pass with zero modifications when `cacheMode: "off"` is explicitly set.
- [ ] `npm test` shows zero regressions (currently 173+ tests pass).

### NFR-004: Zero New Dependencies

**What:** No npm packages added. SHA-256 uses Node.js built-in `crypto` module.

**Acceptance Criteria:**
- [ ] `package.json` and `package-lock.json` unchanged.
- [ ] `npm ls --depth=0` shows identical output before and after implementation.

---

## Constraints

- **P6 (Zero New Dependencies):** SHA-256 via `node:crypto`. No `hash-utils` npm package.
- **P7 (Provider-Agnostic Configuration):** `cacheMode` at top level of settings (not `providers.deepseek.cacheMode`). The field name is provider-agnostic; the activation guard (FR-008) prevents non-DeepSeek usage.
- **P4 (Surgical Changes):** Only `src/prompt.ts`, `src/session.ts`, `src/settings.ts`, `src/common/budget-tracker.ts`, and their test files are modified. No refactoring adjacent code.
- **P5 (Test Integrity):** Zero modifications to existing test assertions. New tests added for new behavior only.
- **ADR-001 (OpenAI SDK):** The `openai` package's `chat.completions.create` parameters are unaffected — system prompt is sent as a message, not an API parameter.
- **ADR-004 (SessionMessage Canonical):** No changes to `SessionMessage` interface. Stable prefix is a logical concept, not a new message type.
- **Architecture Layer:** Changes limited to Prompt layer (`src/prompt.ts`) and Session configuration (`src/settings.ts`). No provider layer changes.

---

## Edge Cases & Error States

1. **`cacheMode` set to invalid value (e.g., `"enabled"`, `true`, `1`, `null`):** Silently coerced to `"off"`. Debug log: `[cache-aware] Invalid cacheMode "enabled" — defaulting to "off"`.
2. **`cacheMode: "strict"` with non-DeepSeek provider:** Degrades to `"aware"` behavior. Debug log: `[cache-aware] cacheMode "strict" requires DeepSeek provider — degrading to "aware"`.
3. **`cacheMode: "aware"` with non-DeepSeek provider:** Silently treated as `"off"`. Debug log: `[cache-aware] cacheMode suppressed — provider "openai" does not benefit from cache-aware ordering`.
4. **AGENTS.md changes mid-session:** `reloadAgentInstructions()` detects hash change → injects new system message → next turn has different stable prefix → KV cache invalidated. Acceptable — user explicitly changed configuration.
5. **MCP server connects/disconnects mid-session:** MCP tools are NOT part of the stable prefix (they're sent as API-level tools, not system message content). No impact on cache.
6. **Skill files added/deleted during session:** New skills found by `listSkills()` in next `createSession()` → stable prefix changes → KV cache invalidated. Acceptable — skills are configuration.
7. **Tool template files modified:** `readToolDocs()` reads from disk → content changes → stable prefix changes. Acceptable — tool templates are repo-managed and change only on version upgrade.
8. **`budget.md` file from previous version (no cache columns):** `parseBudgetFile()` sets `cacheSaved: 0, cacheHitTokens: 0, cacheMissTokens: 0` for rows missing these columns. No error.
9. **`budget.md` with malformed cache column (e.g., `N/A`):** Parse as 0, log warning.
10. **Empty project (no AGENTS.md, no skills):** Stable prefix still deterministic — includes system prompt base + tool docs only.
11. **`cacheMode` changed during a session:** Takes effect on next `createSession()` call. Does not reorder existing messages.
12. **Very large project root path (500+ chars):** Moved to dynamic tail in strict mode — does not affect stable prefix. Hash still computed correctly.
13. **Concurrent session creation (multiple tabs):** Each `createSession()` reads settings independently. No shared mutable state between sessions for prompt content.

---

## Dependencies

- **None.** Spec 200 is standalone. It modifies prompt construction in `src/prompt.ts` and settings resolution in `src/settings.ts`.
- Spec 210 (cache-aware-compaction) depends on this spec for the stable prefix concept.
- Spec 220 (pro-first-modes) depends on this spec for the `cacheMode` setting.

---

## Out of Scope

- **Compaction strategy modification:** This spec does not change how context compaction works — only how the initial system prompt is assembled.
- **MCP tool ordering in API-level tools:** The `getTools()` function assembles tool definitions for the API `tools` parameter. This spec only concerns system prompt text content, not JSON tool schemas sent to the API.
- **Cache invalidation detection:** The prefix hash is computed and logged but not compared against previous hashes automatically. A future spec could add automated cache invalidation alerts.
- **Embedding-based tool search:** Tool Search (V18) is a separate value block. This spec maintains current tool document inclusion behavior.
- **Per-provider cacheMode configuration:** Only one `cacheMode` value for all providers. Multi-provider multi-mode is out of scope.
- **`/model-info` cache display:** Spec 180's deviated FR-007 (cache per model in ModelCommandContext) remains out of scope.
