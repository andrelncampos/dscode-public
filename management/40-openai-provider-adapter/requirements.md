# Spec 40: openai-provider-adapter — Requirements

## Value Delivery

Delivers value block **V6** (Multi-Model Support) and refines **V12** (Provider-Agnostic LLM Architecture) from vision.md.

> **V6:** *"Support for multiple LLM providers beyond DeepSeek: OpenAI (GPT-5.x family) via Responses API. Thinking/reasoning mode is provider-aware: DeepSeek uses `thinking {type: "enabled"|"disabled"}` + `reasoning_effort` in `extra_body`; OpenAI uses `reasoning_effort` as top-level parameter. Tool calling uses each provider's native format, converted from a canonical internal representation."*

> **V12:** *"A clean internal boundary between DsCode's orchestration layer and any specific LLM provider SDK. Defined by the `ILlmProvider` interface: single contract `chat(options) → AsyncIterable<LlmStreamEvent>`, canonical message format `SessionMessage`, unified stream events, provider registry."*

---

## Functional Requirements

### FR-001: Multi-Engine Configuration in Settings

**What:** The settings schema SHALL support a new `engines` field mapping engine names to per-engine configuration. Each engine entry SHALL have `apiKey` (string, optional) and `baseURL` (string, optional). The top-level `API_KEY` and `BASE_URL` SHALL act as fallback defaults when an engine lacks explicit configuration. The resolution order SHALL be: engine-specific env var → engine-specific settings → top-level env var → top-level settings → hardcoded default.

**Why:** Per arch.md P7, provider-specific options MUST be namespaced. OpenAI requires a different API key and base URL than DeepSeek. Arch.md P7 explicitly specifies `providers.<name>` namespace — this spec uses `engines` as the namespace key matching the current settings ecosystem terminology.

**Acceptance Criteria:**
- [ ] `settings-schema.ts` exports `EngineEntry` type: `{ apiKey?: string; baseURL?: string }`.
- [ ] `settings-schema.ts` exports `engines?: Record<string, EngineEntry>` on the settings schema object.
- [ ] `DeepcodingSettings` type gains `engines?: Record<string, EngineEntry>` field.
- [ ] `ResolvedDeepcodingSettings` type gains `engines: Record<string, EngineEntry>` field.
- [ ] `resolveSettingsSources()` resolves `engines` by merging project → user → system env, with empty object default.
- [ ] `DEFAULT_SETTINGS` includes `engines: {}` (empty — no default engine configs).
- [ ] Engine env vars follow pattern `DEEPCODE_ENGINE_<NAME>_API_KEY` and `DEEPCODE_ENGINE_<NAME>_BASE_URL`.
- [ ] `createOpenAIClient()` accepts optional `engineName` parameter. When provided, resolves `apiKey` and `baseURL` from the named engine's config, falling back to top-level settings.

---

### FR-002: Create `OpenAIProvider` Class

**What:** Create class `OpenAIProvider` at `src/providers/openai-provider.ts` implementing `ILlmProvider`. The class SHALL be structurally analogous to `DeepSeekProvider` — it uses the same `openai` SDK, the same `OpenAIMessageConverter`, and the same streaming pattern. The differences are:

1. **Model matching:** `supportsModel()` returns `true` for model names starting with `"gpt-"`, `"o1"`, `"o3"`, `"o4"`, `"openai-"` (case-insensitive).
2. **Timeout:** `getTimeoutMs()` returns provider-appropriate values (default: `180_000` for standard models, `300_000` for reasoning models like `o1`/`o3`/`o4`/`gpt-5.*`).
3. **Multimodal:** `isMultimodal()` returns `true` for all known OpenAI models (GPT-4+, GPT-5, o-series). The only non-multimodal OpenAI models are `o1-mini`, `o3-mini` — all others support images.
4. **Thinking options format:** The provider SHALL call `buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort, "openai")` — the same function as DeepSeekProvider but with `providerName: "openai"`. This returns OpenAI-native options: `reasoning_effort` as a top-level parameter (NOT inside `extra_body` or `thinking` envelope). The `buildThinkingRequestOptions` function is provider-aware (see FR-004).
5. **No `user_id` field:** Same as DeepSeekProvider — the `user_id` field is intentionally omitted.
6. **Provider name:** `readonly providerName = "openai"`.

**Why:** OpenAI is an OpenAI-compatible provider (ADR-001). Its API is the same shape as DeepSeek (Chat Completions API). The provider class is a thin wrapper that handles model routing, timeout, and thinking format differences — everything else is shared infrastructure.

**Acceptance Criteria:**
- [ ] File `src/providers/openai-provider.ts` exists.
- [ ] `OpenAIProvider` class exports and implements `ILlmProvider` (TypeScript verifiable).
- [ ] `chat()` uses `client.chat.completions.create()` with identical streaming flow to `DeepSeekProvider.chat()`.
- [ ] `chat()` uses `OpenAIMessageConverter.buildMessages()` for message conversion (same as DeepSeek).
- [ ] `chat()` calls `buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort, "openai")`.
- [ ] `chat()` uses `withRetry()` for transient errors (same as DeepSeekProvider).
- [ ] `chat()` yields the same 6 `LlmStreamEvent` variants in the same order as DeepSeekProvider.
- [ ] `getTimeoutMs()` returns `300_000` for models matching `o[134]` or `gpt-5`, `180_000` otherwise.
- [ ] `isMultimodal()` returns `false` only for `o1-mini` and `o3-mini`; `true` for all others.
- [ ] `supportsModel()` returns `true` for `gpt-*`, `o1*`, `o3*`, `o4*`, `openai-*` prefixes.

---

### FR-003: Provider Registry Routing

**What:** `createLlmProvider()` in `src/common/llm-provider-registry.ts` SHALL route model names to the correct provider by prefix:

| Model prefix (case-insensitive) | Provider class |
|---|---|
| `deepseek-` | `DeepSeekProvider` |
| `gpt-`, `o1`, `o3`, `o4`, `openai-` | `OpenAIProvider` |
| Unknown / no match | DeepSeekProvider (backward-compatible default) |

When creating `OpenAIProvider`, the factory SHALL pass an engine-aware `createOpenAIClient` function that reads from the `openai` engine config. When creating `DeepSeekProvider`, the factory SHALL pass the existing `createOpenAIClient` function (unchanged — reads top-level settings).

**Why:** Centralized routing per arch.md P1 and P7. The provider registry is the single point where model → provider resolution happens. SessionManager never knows which provider class it's using.

**Acceptance Criteria:**
- [ ] `createLlmProvider()` inspects `settings.model` prefix and instantiates the correct provider.
- [ ] `OpenAIProvider` receives a `createOpenAIClient` function configured for the `"openai"` engine.
- [ ] `DeepSeekProvider` receives a `createOpenAIClient` function configured for the top-level settings (existing behavior).
- [ ] When model doesn't match any known prefix, `DeepSeekProvider` is created (backward compatibility).
- [ ] `npm run typecheck` passes.

---

### FR-004: Provider-Aware Thinking/Reasoning Options

**What:** `buildThinkingRequestOptions()` in `src/common/openai-thinking.ts` SHALL be extended to accept an optional `providerName` parameter. When `providerName` is `"openai"` or not `"deepseek"`, the function SHALL return OpenAI-native options: `reasoning_effort` as a top-level parameter (NOT inside `extra_body`). When `providerName` is `"deepseek"` (or default), existing DeepSeek format is returned unchanged.

The exact formats:

**DeepSeek format (unchanged):**
```typescript
// thinkingEnabled = true, reasoningEffort = "max"
{ thinking: { type: "enabled" }, extra_body: { reasoning_effort: "max" } }
// thinkingEnabled = false
{ thinking: { type: "disabled" } }
```

**OpenAI format (new):**
```typescript
// thinkingEnabled = true, reasoningEffort = "high"
{ reasoning_effort: "high" }
// thinkingEnabled = false
{}  // empty — no thinking-related fields
```

**Why:** V6 explicitly describes the difference: "DeepSeek: `thinking {type: "enabled"|"disabled"}` + `reasoning_effort` in `extra_body`. OpenAI: `reasoning_effort` as top-level parameter (when supported)."

**Acceptance Criteria:**
- [ ] `buildThinkingRequestOptions()` accepts optional 4th parameter: `providerName?: string`.
- [ ] When `providerName === "openai"` and `thinkingEnabled === true`, returns `{ reasoning_effort: reasoningEffort }`.
- [ ] When `providerName === "openai"` and `thinkingEnabled === false`, returns `{}`.
- [ ] When `providerName` is `"deepseek"` or omitted, returns existing DeepSeek format (backward compatible).
- [ ] `DeepSeekProvider.chat()` passes `"deepseek"` as the providerName.
- [ ] `OpenAIProvider.chat()` passes `"openai"` as the providerName.
- [ ] Existing tests for `buildThinkingRequestOptions` pass unchanged.
- [ ] New tests cover OpenAI format for all combinations: thinking on/off, high/max effort.

---

### FR-005: Compaction Model Per Provider

**What:** The compaction model resolution in `SessionManager.compactSession()` SHALL be provider-aware. Currently it hardcodes `resolvedModel.replace("pro", "flash")`. After this spec:

1. `ILlmProvider` interface gains a new method: `getCheapModel?(model: string): string | null`. Returns the cheapest thinking-disabled model for the given model, or `null` if no cheaper model exists.
2. `DeepSeekProvider.getCheapModel("deepseek-v4-pro")` returns `"deepseek-v4-flash"`.
3. `OpenAIProvider.getCheapModel("gpt-5.4")` returns `"gpt-5.4-mini"` (or equivalent cheap model).
4. `OpenAIProvider.getCheapModel("gpt-5.4-mini")` returns `null` (no cheaper model for mini variants).
5. `SessionManager.compactSession()` calls `const compactionModel = provider.getCheapModel?.(model) ?? model`.
6. If `compactionModel === model` and no cheaper model exists, compaction proceeds with the main model (no fallback error).

**Why:** ADR-005 hardcoded `"deepseek-v4-flash"` and noted: "When provider-agnostic architecture lands, this must be generalized." Spec 30 moved the hardcoded string to SessionManager. Spec 40 makes it provider-aware.

**Acceptance Criteria:**
- [ ] `ILlmProvider` interface has optional `getCheapModel?(model: string): string | null`.
- [ ] `DeepSeekProvider.getCheapModel()` returns `"deepseek-v4-flash"` when given `"deepseek-v4-pro"`, `null` for `"deepseek-v4-flash"`.
- [ ] `OpenAIProvider.getCheapModel()` returns `"gpt-5.4-mini"` for `"gpt-5.4"`, `null` for `"gpt-5.4-mini"`.
- [ ] `SessionManager.compactSession()` uses `provider.getCheapModel?.(model) ?? model` for compaction model.
- [ ] The `DEEPSEEK_V4_FLASH` constant and string replacement logic in `compactSession()` is removed.

---

### FR-006: Token Estimation Per Provider

**What:** The `estimateStreamTokens()` method in `SessionManager` SHALL NOT change (chars → tokens heuristics are language-dependent, not model-dependent). No provider-specific token estimation is required — the existing 0.3/0.6 heuristic is sufficient for cost estimation purposes. Actual token counts come from API `usage` responses.

**Why:** Token estimation is a coarse heuristic. The API always returns exact counts via `usage`. The heuristic only needs to be approximately correct for compaction threshold decisions.

**Acceptance Criteria:**
- [ ] `estimateStreamTokens()` has zero changes.
- [ ] `estimateContextTokens()` has zero changes.

---

### FR-007: Budget Tracking Compatibility

**What:** Budget tracking (`recordBudgetCost`) SHALL work unchanged with OpenAI models. The `ModelUsage` object from OpenAI API responses has the same shape as DeepSeek (`prompt_tokens`, `completion_tokens`, `total_tokens`). `ModelPricing` entries for OpenAI models SHALL be added to `DEFAULT_MODEL_PRICING` in `model-capabilities.ts`.

**Why:** Budget integrity must be maintained across all providers. If OpenAI usage is not tracked, cost visibility is compromised (V6 "Cost transparency").

**Acceptance Criteria:**
- [ ] `DEFAULT_MODEL_PRICING` gains entries for `gpt-5.4` and `gpt-5.4-mini` (prices from official OpenAI pricing page).
- [ ] `recordBudgetCost()` in session.ts has zero changes (already provider-agnostic).
- [ ] OpenAI API responses contain `usage` with standard fields — verified by integration test.

---

### FR-008: Backward Compatibility — Existing Behavior Preserved

**What:** When `settings.model` starts with `"deepseek-"`, the system SHALL behave identically to the pre-spec behavior. No user-visible change for DeepSeek users. The `engines` field is optional — absence means the top-level API_KEY and BASE_URL are used for all providers (current behavior).

**Why:** Per L1 (layer multi-provider work), each spec must be independently shippable without regressions. NFR-001 from spec 30 applies here too.

**Acceptance Criteria:**
- [ ] All existing tests pass with zero failures (`npm test`).
- [ ] DeepSeek chat sessions work identically to before (tested manually or via integration mock).
- [ ] `settings.json` without `engines` field works identically.
- [ ] `engines` field with only `openai` entry doesn't affect DeepSeek sessions.

---

### FR-009: OpenAI API Key Resolution

**What:** The API key for OpenAI SHALL be resolved in this priority order:

1. `DEEPCODE_ENGINE_OPENAI_API_KEY` environment variable (system env, not settings env).
2. `settings.json` → `engines.openai.apiKey`.
3. `DEEPCODE_API_KEY` environment variable (existing global key).
4. `settings.json` → top-level API_KEY (existing global key).

Same priority for `BASE_URL` (using `DEEPCODE_ENGINE_OPENAI_BASE_URL` and `engines.openai.baseUrl`).

**Why:** Allows per-engine credentials without breaking the existing single-key configuration. Users can add an OpenAI key without changing their DeepSeek setup.

**Acceptance Criteria:**
- [ ] Engine-specific env vars (`DEEPCODE_ENGINE_OPENAI_*`) override global env vars for that engine.
- [ ] Engine-specific settings override global settings for that engine.
- [ ] Missing engine config falls back to global config — no error.
- [ ] `createOpenAIClient("openai")` returns `client: null` when no OpenAI API key is configured anywhere.

---

## Non-Functional Requirements

### NFR-001: Code Reuse Maximization

**What:** The `OpenAIProvider.chat()` method SHALL share the maximum possible code with `DeepSeekProvider.chat()`. Stream parsing, tool call tracking (`toolIndexToId` map), non-streaming fallback, error handling — all identical logic SHALL be either shared or structurally mirrored. If the two `chat()` methods share >80% of their implementation, consider extracting a shared base class or helper function (but only if it reduces total line count).

**Acceptance Criteria:**
- [ ] `OpenAIProvider.chat()` and `DeepSeekProvider.chat()` have identical streaming loop structure.
- [ ] Decision documented: either shared base class, shared helper functions, or intentional duplication with justification.
- [ ] If duplicated, both files have the same bugfixes and improvements — no divergence.

### NFR-002: Type Safety

**What:** All code must pass TypeScript type checking with zero errors.

**Acceptance Criteria:**
- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npm run lint` passes with zero new warnings.
- [ ] `npm run format:check` passes (no unformatted files).

### NFR-003: No New npm Dependencies

**What:** No npm packages may be added, removed, or updated. The `openai` SDK already handles OpenAI API communication.

**Acceptance Criteria:**
- [ ] `package.json` has zero changes.
- [ ] `package-lock.json` has zero changes.

### NFR-004: Test Coverage

**What:** New code must be covered by tests. Existing tests must not be weakened.

**Acceptance Criteria:**
- [ ] New tests for `OpenAIProvider.chat()`: at minimum streaming text, reasoning delta, tool calls, usage, timeout, abort.
- [ ] New tests for `buildThinkingRequestOptions()` with `providerName = "openai"`.
- [ ] New tests for `createLlmProvider()` routing (model → correct provider class).
- [ ] New tests for engine config resolution.
- [ ] New tests for `getCheapModel()` on both providers.
- [ ] Existing test count (555+) preserved; no more than 5 existing tests modified (mock updates only).

---

## Constraints

1. **C1:** `SessionMessage` type MUST NOT change — canonical format per ADR-004.
2. **C2:** `ToolDefinition` type MUST NOT change.
3. **C3:** `ModelUsage` type MUST NOT change.
4. **C4:** `ILlmProvider` interface MAY add optional methods (like `getCheapModel`) but MUST NOT change or remove existing methods.
5. **C5:** `OpenAIMessageConverter` MUST NOT be duplicated — both providers share the same instance class.
6. **C6:** The `openai` npm package stays at current version — no upgrade.
7. **C7:** Node.js version requirement stays at `>=24`.
8. **C8:** Bundle target stays at `--target=node24`.
9. **C9:** `createOpenAIClient` function signature change is allowed (adding optional `engineName` parameter) but all existing call sites must work without changes (default parameter behavior).

---

## Edge Cases & Error States

| # | Scenario | Expected Behavior |
|---|---|---|
| EC1 | User sets model to `gpt-5.4` but has no OpenAI API key | `createLlmProvider()` creates `OpenAIProvider`, `createOpenAIClient("openai")` returns `client: null`, provider throws `Error("OpenAI API key not configured")`. |
| EC2 | User sets model to `gpt-5.4` with OpenAI key but OpenAI API is down | `withRetry()` retries transient failures (429, 502, 503, network errors). After max attempts, throws last error. SessionManager catches and displays error. |
| EC3 | User switches from DeepSeek to OpenAI mid-session (`/model gpt-5.4`) | Spec 60 handles `/model` command. This spec only ensures the infrastructure supports the switch — `createLlmProvider()` returns the correct provider for the current `settings.model`. |
| EC4 | `engines.openai.apiKey` is set but `engines.openai.baseURL` is not | Uses default OpenAI base URL (`https://api.openai.com/v1`). Does NOT fall through to the global `DEFAULT_BASE_URL` (which is `https://api.deepseek.com`). The engine-specific default is resolved in `createOpenAIClient` by checking the engine name. |
| EC5 | `engines.openai.apiKey` is empty string | Treated same as missing — falls back to global API_KEY. If global is also missing, `client: null`. |
| EC6 | Compaction with OpenAI model that has no cheap variant | `provider.getCheapModel?.(model)` returns `null`. SessionManager uses `model` directly for compaction. |
| EC7 | OpenAI stream returns `refusal` | Provider yields `text_delta` with refusal text (same behavior as DeepSeek EC-11 from spec 30). |
| EC8 | OpenAI model name with unusual casing (e.g., `GPT-5.4`) | `supportsModel()` is case-insensitive — matches correctly. |
| EC9 | `engines` field has a typo'd engine name that doesn't match any provider | Ignored — only `"openai"` and `"deepseek"` engine names are meaningful. Extra entries are benign. |
| EC10 | Both global API_KEY and engine-specific API_KEY are set | Engine-specific key takes priority for that engine. Global key used for engines without explicit config. |

---

## Dependencies

- **Spec 30** (provider-agnostic-llm-layer): Completed (`audited`). This spec adds a second `ILlmProvider` implementation.
- **ADR-001** (OpenAI SDK): This spec uses the same `openai` SDK.
- **ADR-002** (Provider Interface Pattern): This spec adds a second implementation, validating the interface.
- **ADR-004** (SessionMessage Canonical): Preserved — both providers use `OpenAIMessageConverter`.
- **ADR-005** (Flash Compaction): Generalized from hardcoded string to `getCheapModel()`.

---

## Out of Scope

- Adding Anthropic provider (→ Spec 50).
- `/model` slash command for switching models mid-session (→ Spec 60).
- Full `engines` UX in settings UI (→ Spec 60).
- Provider-specific pricing overrides per engine (uses global `modelPricing`).
- Automatic provider detection from model name without prefix matching (→ Spec 60).
- OpenAI-specific features like structured outputs, function calling format differences, or parallel tool calls.
- Streaming event types beyond the current 6 `LlmStreamEvent` variants.
- Rate limit handling per provider beyond `withRetry()`.
- OpenAI tokenizer for accurate pre-flight token counting.
- Documentation files.
- Changes to `session.ts` beyond: `getCheapModel()` usage in compaction, `import` updates for `OpenAIProvider`.
