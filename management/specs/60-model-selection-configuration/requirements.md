# Spec 60: model-selection-configuration — Requirements

## Value Delivery

Delivers value block **V13** (Model Selection & Configuration) and completes **V6** (Multi-Model Support) from vision.md.

> **V13:** *"User-facing controls for choosing and configuring LLM providers: `/model` slash command to switch models mid-session. Settings schema for provider-specific configuration (API keys, base URLs, model names, pricing overrides). Provider-aware capability detection (multimodal support, thinking mode availability, max context window). Graceful fallback when a configured provider is unreachable."*

> **V6:** *"Support for multiple LLM providers beyond DeepSeek: OpenAI (GPT-5.x family) via Responses API. Anthropic (Claude family) via Messages API. Any OpenAI-compatible endpoint via custom baseURL. Thinking/reasoning mode is provider-aware."*

---

## Functional Requirements

### FR-001: Provider-Aware Model Catalog

**What:** The system SHALL maintain a catalog of all supported models with their provider, capabilities, and pricing. This catalog SHALL be the single source of truth for the `/model` dropdown, the status bar model display, and the `buildStatusLine()` model info. The catalog SHALL be defined in `src/common/model-catalog.ts` and exported as `MODEL_CATALOG: ModelEntry[]`.

Each `ModelEntry` SHALL contain:
- `id: string` — model identifier string (e.g., `"deepseek-v4-pro"`, `"gpt-5.5"`)
- `provider: "deepseek" | "openai" | "anthropic"` — which provider handles this model
- `displayName: string` — human-readable name (e.g., `"DeepSeek V4 Pro"`)
- `reasoning: { type: "adaptive" | "extended" | "effort" | "none"; defaultEffort: ThinkingEffort; budgetTokens?: number }` — thinking mode configuration
- `contextWindow: number` — max context window in tokens
- `maxOutput: number` — max output tokens
- `multimodal: boolean` — whether the model supports image inputs
- `isDefault: boolean` — true for exactly one model (the default)

**Why:** Currently `MODEL_COMMAND_MODELS` in `ModelsDropdown/index.tsx` is a hardcoded array of `["deepseek-v4-pro", "deepseek-v4-flash"]`. The dropdown only shows DeepSeek models. Users cannot switch to OpenAI or Anthropic from the UI. A centralized catalog eliminates scattered model lists across the codebase.

**Acceptance Criteria:**
- [ ] File `src/common/model-catalog.ts` exists exporting `MODEL_CATALOG` and `ModelEntry` type.
- [ ] `MODEL_CATALOG` contains all 11 currently supported models: deepseek-v4-pro, deepseek-v4-flash, gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.4-nano, claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5, claude-fable-5, claude-mythos-5.
- [ ] `MODEL_COMMAND_MODELS` in `ModelsDropdown/index.tsx` is REMOVED — replaced by imports from `model-catalog.ts`.
- [ ] `MODEL_COMMAND_THINKING_OPTIONS` in `ModelsDropdown/index.tsx` is REMOVED — thinking options are derived per-model from the catalog.
- [ ] `DEFAULT_MODEL_PRICING` in `model-capabilities.ts` is NOT removed (used by budget tracker), but the `model-catalog.ts` is NOT a replacement for pricing — it complements it with capability metadata.
- [ ] `npm run typecheck` passes with zero errors.

---

### FR-002: Provider-Aware Thinking Mode Options

**What:** The `/model` dropdown thinking mode step SHALL show different options depending on the selected model's provider and reasoning type, based on the model catalog entry:

| Reasoning type | Options shown | Parameter sent |
|---|---|---|
| `"effort"` (OpenAI GPT-5.x) | `"Thinking: xhigh"`, `"Thinking: high"`, `"Thinking: medium"`, `"Thinking: low"`, `"Thinking: none"`, `"No thinking"` | `reasoning_effort` as top-level param |
| `"adaptive"` (Claude Opus 4.8+, Sonnet 4.6+, Fable 5, Mythos 5) | `"Adaptive thinking: high"`, `"Adaptive thinking: medium"`, `"Adaptive thinking: low"`, `"No thinking"` | `thinking: { type: "adaptive", effort }` or `thinking: { type: "disabled" }` |
| `"extended"` (DeepSeek, Claude Haiku 4.5) | `"Thinking: max"`, `"Thinking: high"`, `"No thinking"` | DeepSeek: `thinking: { type: "enabled"/"disabled" }` + `extra_body: { reasoning_effort }`. Claude: `thinking: { type: "enabled", budget_tokens: N }` / `thinking: { type: "disabled" }` |
| `"none"` | `"No thinking"` only | No thinking parameters |

For `"effort"` type, `reasoning_effort` values are `"xhigh"`, `"high"`, `"medium"`, `"low"`, `"none"`. The DsCode `ReasoningEffort` type (`"high" | "max"`) SHALL be widened to include these values in a new union `ThinkingEffort = "none" | "low" | "medium" | "high" | "max" | "xhigh"`.

**Why:** Different providers and models have fundamentally different thinking/reasoning mechanisms. DeepSeek uses `thinking {type:"enabled"/"disabled"}` + `extra_body.reasoning_effort`. OpenAI uses `reasoning_effort` as top-level parameter with 5 effort levels. Anthropic Opus 4.8+ uses `thinking {type:"adaptive", effort}` with 3 levels. Showing the wrong options would send invalid API parameters.

**Acceptance Criteria:**
- [ ] `ModelsDropdown` thinking step renders different options based on the selected model's `reasoning.type`.
- [ ] OpenAI models show 6 options: `"xhigh"`, `"high"`, `"medium"`, `"low"`, `"none"`, `"No thinking"`.
- [ ] DeepSeek models show 3 options: `"max"`, `"high"`, `"No thinking"` (unchanged behavior).
- [ ] Claude adaptive models show 4 options: adaptive `"high"`, `"medium"`, `"low"`, `"No thinking"`.
- [ ] Claude extended models (Haiku) show 3 options: `"max"`, `"high"`, `"No thinking"` (same labels as DeepSeek but different wire format).
- [ ] The `ReasoningEffort` type in `settings.ts` is renamed to `ThinkingEffort` and widened to `"none" | "low" | "medium" | "high" | "max" | "xhigh"`.
- [ ] All existing references to `ReasoningEffort` are updated to use the new type (or an alias is kept for backward compatibility).
- [ ] `buildThinkingRequestOptions()` in `openai-thinking.ts` handles `"none" | "low" | "medium"` effort values for OpenAI.
- [ ] Anthropic provider handles `"medium"` and `"low"` effort values in addition to `"high"` for adaptive thinking.

---

### FR-003: Mid-Session Model Switching with Provider Change

**What:** When the user changes the model via `/model` and the new model belongs to a DIFFERENT provider than the current active session's model, the system SHALL:

1. Write the new model/thinking configuration to `settings.json` via `writeModelConfigSelection()` (existing behavior).
2. Emit a system message recording the model change (existing behavior — `handleModelConfigChange` in `AppStateContext.tsx`).
3. On the NEXT user message, `SessionManager.replySession()` SHALL re-resolve the provider via `createLlmProvider()` (already happens — `replySession` reads fresh settings each call).
4. If the new provider's API key is not configured, `createLlmProvider()` returns `provider: null`. SessionManager SHALL display an error message: `"No API key configured for <provider-lowercase>. Set engines.<provider-lowercase>.apiKey in settings.json or the DEEPCODE_ENGINE_<PROVIDER_UPPERCASE>_API_KEY environment variable."` (e.g., `"No API key configured for openai. Set engines.openai.apiKey in settings.json or the DEEPCODE_ENGINE_OPENAI_API_KEY environment variable."`) and NOT attempt an API call.
5. If the new provider is reachable but returns an error on the first request, the standard `withRetry()` and error display logic applies (no special handling).

**Why:** Provider switching mid-session is the core use case of V13. Users should be able to switch from DeepSeek to OpenAI to Anthropic without restarting DsCode. The system must validate the new provider is configured and give clear error messages when it isn't.

**Acceptance Criteria:**
- [ ] Changing model via `/model` dropdown to a different provider writes the new model to settings and shows the system message (already works — verify no regression).
- [ ] Sending a message after switching to a provider with no API key shows a clear error: `"No API key configured for openai..."` (not a generic error).
- [ ] Sending a message after switching to a provider WITH an API key works correctly (the new provider handles the request).
- [ ] Session history (messages, tool calls, reasoning content) is preserved across provider switches (no messages lost).
- [ ] Cost tracking accumulates per-model across providers (already works via `usagePerModel` — verify no regression).

---

### FR-004: Model Catalog Display in `/model` Dropdown

**What:** The `/model` dropdown SHALL display models grouped by provider, with each model showing its display name, pricing tier indicator, and a marker for the currently active model. The dropdown SHALL have two steps:

**Step 1 — Model Selection:**
- All models from `MODEL_CATALOG` sorted by provider then by capability (most capable first).
- Provider header rows (non-selectable): `"── DeepSeek ──"`, `"── OpenAI ──"`, `"── Anthropic ──"`.
- Each model row shows: `"<displayName>  <pricing indicator>  <current marker>"`.
- Pricing indicator: `"$$$"` for >$5 input, `"$$"` for $1–5, `"$"` for <$1 (based on `DEFAULT_MODEL_PRICING`).
- Current model marker: `"(current)"` appended to the currently active model.
- If a provider has no API key configured, its models are shown but rendered with `<Text dimColor>` (Ink's dimmed style) with a suffix `"(no key)"`. They remain selectable — the error is shown on next message send (FR-003 item 4).
- The `width` prop passed to `DropdownMenu` SHALL be wide enough to accommodate the longest model row (estimated: 50 columns).

**Step 2 — Thinking Mode Selection:**
- Rendered per FR-002 with options specific to the model selected in Step 1.
- The currently active thinking mode is pre-selected (highlighted).
- If the user presses Escape in Step 2, return to Step 1 (don't close the dropdown).

**Why:** The current dropdown shows only 2 DeepSeek models with no provider grouping, no pricing indicators, and no visibility into which models have configured API keys. Users need to see all available models to make informed choices.

**Acceptance Criteria:**
- [ ] Step 1 shows all 11 models grouped under 3 provider headers.
- [ ] Each model row shows display name + pricing indicator + optionally "(current)".
- [ ] Models for providers without API keys are shown with "(no key)" suffix.
- [ ] Step 2 shows thinking options specific to the selected model's reasoning type.
- [ ] Escape in Step 2 returns to Step 1. Escape in Step 1 closes the dropdown.
- [ ] Dropdown width accommodates all rows without truncation (min 50 columns).
- [ ] Arrow key navigation wraps within each step independently.

---

### FR-005: Graceful Provider Fallback

**What:** When `createLlmProvider()` returns `provider: null` because no API key is configured for any provider, the system SHALL:

1. Display a system message in the chat: `"No LLM provider configured. Set API_KEY in settings.json or the DEEPCODE_API_KEY environment variable. For provider-specific keys, configure engines.<provider>.apiKey."`
2. NOT attempt an API call (already handled by existing null check).
3. When the user subsequently configures a valid API key and sends a message, the system SHALL use the appropriate provider for the current model (reads fresh settings each message — already works).

When `createLlmProvider()` returns a valid provider but the API call fails with a non-retryable error (e.g., 401 Unauthorized), the existing error display logic applies. No special handling for provider-specific errors.

**Why:** V13 explicitly requires "graceful fallback when a configured provider is unreachable." The current behavior already handles null providers. This requirement formalizes and tests that behavior.

**Acceptance Criteria:**
- [ ] When no API key is configured for any provider, sending a message shows the fallback system message (not a crash).
- [ ] When a provider-specific key is added while DsCode is running, the next message uses it (reads fresh settings).
- [ ] 401 errors from any provider are displayed via the existing error classification system (no crash).

---

### FR-006: Model Info in Status Bar

**What:** The status bar (rendered by `buildStatusLine()` in `src/ui/utils/index.ts`) SHALL display the current model's display name from `MODEL_CATALOG` instead of the model ID. The format SHALL be:

```
displayName thinkingIndicator
```

Where:
- `displayName` is `ModelEntry.displayName` (e.g., `"DeepSeek V4 Pro"`, `"GPT-5.5"`).
- `thinkingIndicator` is derived from the current `thinkingEnabled` and `reasoningEffort` settings:
  - `thinkingEnabled=false` → empty string (nothing shown).
  - `thinkingEnabled=true` → `" 𝚫"` + effort level (e.g., `" 𝚫max"`, `" 𝚫high"`, `" 𝚫xhigh"`, `" 𝚫medium"`).

The status bar already shows `thinkingEnabled` and `reasoningEffort` via `formatModelConfig()`. This requirement replaces the model ID with the display name and adds the thinking indicator symbol.

**Why:** The current status bar shows raw model IDs like `"deepseek-v4-pro"` which are technical and not user-friendly. Display names like `"DeepSeek V4 Pro"` are more readable. The thinking indicator gives at-a-glance visibility into the current reasoning configuration.

**Acceptance Criteria:**
- [ ] Status bar shows model display name from `MODEL_CATALOG`, not raw model ID.
- [ ] When thinking is enabled, a thinking indicator is shown next to the model name.
- [ ] When thinking is disabled, no thinking indicator is shown.
- [ ] `formatModelConfig()` in `src/ui/utils/index.ts` is updated to use display names from the catalog.

---

### FR-007: Backward Compatibility — Existing Behavior Preserved

**What:** All existing DeepSeek functionality MUST work identically after this spec. Specifically:

1. The `/model` dropdown with DeepSeek models shows the same 3 thinking options it shows today.
2. The dropdown interaction (arrow keys, Space/Enter to select, Escape to close) is unchanged.
3. `writeModelConfigSelection()` writes `thinkingEnabled` and `reasoningEffort` identically to before.
4. `buildStatusLine()` continues to show token count and status.
5. The `/model` command handler in `command-handlers.ts` continues to open the dropdown.
6. All existing tests pass with zero failures.

**Why:** Per L1 (layer multi-provider work), each spec must be independently shippable without regressions. The `/model` command is existing functionality that must not be degraded.

**Acceptance Criteria:**
- [ ] Selecting `"deepseek-v4-pro"` with `"Thinking: max"` in the new dropdown produces identical `settings.json` changes as the old dropdown.
- [ ] Selecting `"deepseek-v4-flash"` with `"No thinking"` produces identical behavior.
- [ ] Arrow key navigation, Enter/Space selection, Escape to close all work identically.
- [ ] All existing tests pass.

---

### FR-008: Thinking Effort Type Widening

**What:** The `ReasoningEffort` type in `src/settings.ts` (currently `"high" | "max"`) SHALL be widened to support all provider effort levels. The new type `ThinkingEffort` SHALL be `"none" | "low" | "medium" | "high" | "max" | "xhigh"`.

All code referencing `ReasoningEffort` SHALL be updated:
- `settings.ts`: Rename type, update `resolveReasoningEffort()` validation.
- `openai-thinking.ts`: Accept full effort range; map for OpenAI (already maps "max"→"xhigh").
- `anthropic-provider.ts`: Map effort values for adaptive thinking ("xhigh"/"max"→"high", "medium"→"medium", "low"→"low", "none"→disabled).
- `deepseek-provider.ts`: Pass effort through unchanged (DeepSeek API accepts "max"/"high").
- `reasoning-effort-manager.ts`: Update type references.
- `session.ts`: Update type references.
- All test files referencing `ReasoningEffort`.

A backward-compatible type alias `type ReasoningEffort = ThinkingEffort` SHALL be kept temporarily to minimize diff noise. This alias SHALL be removed in a follow-up cleanup PR.

**Why:** The current `"high" | "max"` type is DeepSeek-specific. OpenAI supports 5 effort levels ("none" through "xhigh"). Anthropic adaptive thinking supports 3 ("low", "medium", "high"). The type system must accommodate all providers.

**Acceptance Criteria:**
- [ ] `ThinkingEffort` type defined as `"none" | "low" | "medium" | "high" | "max" | "xhigh"`.
- [ ] `ReasoningEffort` is a type alias of `ThinkingEffort` (temporary).
- [ ] `resolveReasoningEffort()` validates against the new wider set.
- [ ] `buildThinkingRequestOptions()` handles all effort values for OpenAI: "none"→`{ reasoning_effort: "none" }`, "low"→`{ reasoning_effort: "low" }`, etc.
- [ ] Anthropic adaptive thinking maps "xhigh"/"max"→"high", "high"→"high", "medium"→"medium", "low"→"low", "none"→disabled.
- [ ] All existing tests pass without changing their assertion values for DeepSeek behavior.
- [ ] `settings-schema.ts` Zod schema updated to accept all 6 values.

---

### FR-009: Provider Capability Queries

**What:** The system SHALL expose a function `getModelCapabilities(modelId: string): ModelCapabilities` that returns the capabilities of a given model. This function SHALL read from `MODEL_CATALOG` (FR-001) and `DEFAULT_MODEL_PRICING` (existing). The return type `ModelCapabilities` SHALL contain:

```typescript
type ModelCapabilities = {
  provider: "deepseek" | "openai" | "anthropic";
  displayName: string;
  multimodal: boolean;
  contextWindow: number;
  maxOutput: number;
  reasoning: ModelEntry["reasoning"];
  pricing: ModelPricing | null; // null if no pricing entry
};
```

This function replaces the ad-hoc `isMultimodalModel()` in `model-capabilities.ts` for the dropdown and status bar. `isMultimodalModel()` itself SHALL remain for use in message converters (it's called in hot paths and is simpler).

**Why:** Currently model capability checks are scattered: `isMultimodalModel()` for multimodal detection, `DEFAULT_MODEL_PRICING` for pricing, hardcoded arrays for model lists. A single capability query function consolidates these and uses the catalog as the source of truth.

**Acceptance Criteria:**
- [ ] `getModelCapabilities(modelId)` function exists in `src/common/model-catalog.ts`.
- [ ] Returns full `ModelCapabilities` object for all 11 models.
- [ ] Returns `pricing: null` for models not in `DEFAULT_MODEL_PRICING`.
- [ ] `isMultimodalModel()` remains unchanged (used in message converters).
- [ ] Dropdown and status bar use `getModelCapabilities()` instead of direct `MODEL_CATALOG` access.

---

## Non-Functional Requirements

### NFR-001: UI Responsiveness

**What:** Opening the `/model` dropdown MUST render within 16ms (one frame at 60fps) on standard terminal emulators. Model list computation (filtering, sorting, grouping) MUST be O(n) where n is the number of models (11). No async operations during dropdown rendering.

**Acceptance Criteria:**
- [ ] Dropdown appears instantly when `/model` is typed — no visible delay.
- [ ] Model list is computed synchronously from `MODEL_CATALOG` (no I/O, no API calls).

### NFR-002: Zero New npm Dependencies

**What:** This spec MUST NOT add, remove, or update any npm packages. All functionality uses existing dependencies.

**Acceptance Criteria:**
- [ ] `package.json` has zero changes.
- [ ] `package-lock.json` has zero changes.

### NFR-003: Type Safety

**What:** All code MUST pass TypeScript type checking with zero errors.

**Acceptance Criteria:**
- [ ] `npm run typecheck` passes with zero errors.

### NFR-004: Test Coverage

**What:** New code must be covered by tests. Existing tests must not be weakened.

**Acceptance Criteria:**
- [ ] New tests for `getModelCapabilities()`: verify capabilities for all 11 models.
- [ ] New tests for thinking option generation: verify correct options per reasoning type.
- [ ] Updated tests for `ModelsDropdown` with multi-provider model list.
- [ ] Updated tests for `buildThinkingRequestOptions` with new effort values.
- [ ] Existing test suite passes with zero failures.

---

## Constraints

1. **C1:** `SessionMessage` type MUST NOT change (ADR-004).
2. **C2:** `ILlmProvider` interface MUST NOT change (ADR-002).
3. **C3:** `createOpenAIClient()` signature MUST NOT change (C9 from spec 40).
4. **C4:** `createAnthropicClient()` signature MUST NOT change.
5. **C5:** `DEFAULT_MODEL_PRICING` SHALL remain in `model-capabilities.ts` and MUST NOT be moved (budget tracker dependency).
6. **C6:** `isMultimodalModel()` MUST remain in `model-capabilities.ts` and MUST NOT be removed (message converter hot path).
7. **C7:** The dropdown components (`ModelsDropdown`, `RawModelDropdown`) MUST remain Ink/React components (no DOM/HTML).
8. **C8:** No modifications to `DropdownMenu` base component (shared by Skills, Raw, and Model dropdowns).

---

## Edge Cases & Error States

| # | Scenario | Expected Behavior |
|---|---|---|
| EC1 | User opens `/model` dropdown with no API key configured for any provider | All models shown. Models for providers without keys have "(no key)" suffix. User can still select any model — error shown on next message send (FR-005). |
| EC2 | User switches to a model whose provider has an API key, but the key is invalid (401) | First API call fails with 401. Error displayed via existing error classification: `"Authentication failed. Check your API key."`. Model switch is NOT rolled back. |
| EC3 | User switches model mid-session, then immediately switches back | Both switches are recorded as system messages. No state corruption. The second switch re-resolves settings from disk (reads the freshly written settings.json). |
| EC4 | User switches from a model with reasoning_content to a model without thinking mode | Existing reasoning_content in session history is preserved (stored in `messageParams`). The new model's messages won't include reasoning_content in API calls (handled by provider's `buildMessages()`). |
| EC5 | User switches from Anthropic (adaptive thinking always-on for Fable 5) to DeepSeek | The Fable 5 `thinking: "adaptive"` setting is written to settings.json. When switching to DeepSeek, the thinking mode defaults are applied per the new model's defaults. No error from incompatible settings. |
| EC6 | User types `/model` while a response is streaming | Command handler blocks non-exit commands when busy (existing behavior in `executeSlashCommand`). The dropdown does not open. Status message: `"wait for the current response or press esc to interrupt"`. |
| EC7 | Terminal window is narrower than dropdown width | `DropdownMenu` handles width clamping. Model names may be truncated. This is acceptable — the dropdown is a selection UI, not a documentation display. |
| EC8 | User has a custom model via `openai-` prefix with custom baseURL | The custom model is NOT in `MODEL_CATALOG` (unknown model ID). The `/model` dropdown only shows catalog entries. Custom models must be set via `settings.json` directly. A future spec may add custom model registration. |
| EC9 | `DEFAULT_MODEL_PRICING` is missing an entry for a catalog model | `getModelCapabilities()` returns `pricing: null` for that model. The dropdown shows no pricing indicator for that model. Budget tracking skips that model (existing behavior). |
| EC10 | User's `settings.json` has an invalid `reasoningEffort` value from a future version | Zod schema validation rejects it. `resolveReasoningEffort()` returns `undefined`. Falls back to model default. |
| EC11 | User switches from a provider with a key (e.g., DeepSeek via global `API_KEY`) to another provider with NO key (e.g., OpenAI with no `engines.openai.apiKey`) | `/model` dropdown shows the warning "No API key configured for openai" (Task 7). The model switch is still written to settings. Next message send shows the error from FR-003 item 4. The user can switch back via `/model` to restore functionality. |
| EC12 | User has `engines.openai.apiKey` set but switches to Anthropic model with no `engines.anthropic.apiKey` | Same as EC11 but for the Anthropic provider. The Anthropic provider does NOT fall back to the global `API_KEY` (Anthropic uses its own SDK). |

---

## Dependencies

- **Spec 30** (provider-agnostic-llm-layer): Completed (`audited`). Provides `ILlmProvider` interface used by `createLlmProvider()`.
- **Spec 40** (openai-provider-adapter): Completed (`audited`). Provides `OpenAIProvider` and `engineName` routing.
- **Spec 50** (anthropic-provider-adapter): Completed (`audited`). Provides `AnthropicProvider`.
- **ADR-002** (Provider Interface Pattern): `createLlmProvider()` is the single point of provider resolution.
- **P7** (Provider-Agnostic Configuration): `engines` field already exists in settings schema.

## Out of Scope

- Custom model registration outside the catalog (users editing `MODEL_CATALOG` directly or via settings).
- Model download, installation, or local model support.
- Provider health checks or latency measurement for model recommendations.
- Automatic provider selection based on task type or prompt content.
- Model-specific token counting (all models use the same estimation heuristic).
- Model list updates via network (the catalog is statically compiled).
- The `/model` command accepting arguments (e.g., `/model gpt-5.5` to quick-switch). This is a future enhancement.
- Model configuration beyond model ID, thinking mode, and reasoning effort (temperature, max_tokens, top_p are out of scope for this spec).
- Visual theme or color changes to the dropdown (uses existing `DropdownMenu` styling).
