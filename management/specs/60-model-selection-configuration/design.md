# Spec 60: model-selection-configuration — Design

## Design Approach

This spec follows **centralize-don't-duplicate**: a single `MODEL_CATALOG` in `src/common/model-catalog.ts` becomes the source of truth for all model metadata. The `ModelsDropdown` component reads from the catalog instead of maintaining its own hardcoded arrays. Provider-aware thinking options are derived from the catalog entry's `reasoning` field.

**Principles applied:**
- **P1 (Interface-First):** The catalog is a plain TypeScript array with a strict type — no class, no constructor, no DI.
- **P2 (Canonical Types):** `ModelEntry` is the single canonical type for model metadata. All consumers import it.
- **P3 (Streaming-First):** No async operations in dropdown rendering or model switching.
- **P4 (Surgical Changes):** `ModelsDropdown` is rewritten but `DropdownMenu` base component is untouched. Settings types are widened, not replaced. Existing providers are unchanged.
- **P7 (Provider-Agnostic Configuration):** The catalog separates model identity from provider configuration. Provider-specific settings (API keys) remain in `engines` field.

---

## Architecture Decisions

### AD-SPEC60-001: Centralized model catalog, not distributed model lists

**Decision:** All model metadata lives in a single `MODEL_CATALOG: ModelEntry[]` array in `src/common/model-catalog.ts`. Components read from it; they do not maintain their own model lists.

**Rationale:** Currently model IDs are duplicated across `MODEL_COMMAND_MODELS` (dropdown), `DEFAULT_MODEL_PRICING` (budget), `supportsModel()` prefix checks (providers), and `getCheapModel()` (compaction). A centralized catalog eliminates inconsistency — when a model is added, only the catalog needs updating.

**Consequence:** The catalog grows linearly with new models. At 11 entries, lookup is O(n) which is negligible. If the catalog exceeds ~100 entries, a `Map<string, ModelEntry>` index can be added.

### AD-SPEC60-002: Reasoning type enum drives thinking options, not provider name

**Decision:** The dropdown thinking options are derived from `model.reasoning.type` ("effort", "adaptive", "extended", "none"), NOT from `model.provider`. This allows providers to have models with different reasoning mechanisms (e.g., Anthropic has both "adaptive" and "extended" models).

**Rationale:** Provider name is an implementation detail. Reasoning type is the semantic distinction. Two providers could share the same reasoning type in the future.

**Consequence:** A new `THINKING_OPTIONS_BY_TYPE` map in `model-catalog.ts` defines the available efforts for each reasoning type.

### AD-SPEC60-003: `ThinkingEffort` is the widened type; `ReasoningEffort` is a backward-compatible alias

**Decision:** The new type `ThinkingEffort = "none" | "low" | "medium" | "high" | "max" | "xhigh"` replaces `ReasoningEffort = "high" | "max"`. A temporary alias `type ReasoningEffort = ThinkingEffort` keeps existing code compiling without massive diffs. The alias is removed in a follow-up cleanup.

**Rationale:** The name "ThinkingEffort" is provider-agnostic. "ReasoningEffort" was DeepSeek-specific. The alias avoids touching 30+ files that import `ReasoningEffort`. These files are updated to use `ThinkingEffort` as part of normal maintenance, not in this spec.

**Consequence:** The `reasoningEffort` field in `ResolvedDeepcodingSettings` retains its name (settings keys don't change). Only the TypeScript type changes. `settings-schema.ts` Zod schema is updated to accept all 6 values.

### AD-SPEC60-004: Dropdown items are sync-computed, not pre-built

**Decision:** The `ModelsDropdown` component builds the model list synchronously from `MODEL_CATALOG` on every render when `open=true`. No `useMemo` caching — the list is 11 items, computation is O(n), and the dropdown re-renders only when open state changes.

**Rationale:** Premature optimization. Memoizing an 11-item array that's only computed when a dropdown opens is unnecessary complexity. If performance issues arise (unlikely at this scale), add `useMemo` then.

**Consequence:** The dropdown reads `DEFAULT_MODEL_PRICING` and `resolveCurrentSettings()` at render time. `resolveCurrentSettings()` reads from disk, which could be slow. The dropdown SHALL accept `resolvedSettings` as a prop (already passed as `modelConfig`) to avoid disk I/O during rendering.

---

## Component / Module Breakdown

### Component 1: `model-catalog.ts` — Centralized Model Catalog

**File:** `src/common/model-catalog.ts` (NEW)

**Purpose:** Single source of truth for all supported model metadata.

**Interface:**

```typescript
import type { ModelPricing } from "./model-capabilities";
import { DEFAULT_MODEL_PRICING } from "./model-capabilities";

export type ThinkingEffort = "none" | "low" | "medium" | "high" | "max" | "xhigh";

export type ReasoningType = "effort" | "adaptive" | "extended" | "none";

export type ModelReasoning = {
  type: ReasoningType;
  /** Default effort when thinking is enabled. */
  defaultEffort: ThinkingEffort;
  /** Budget tokens for extended thinking (Claude Haiku). */
  budgetTokens?: number;
};

export type ModelEntry = {
  id: string;
  provider: "deepseek" | "openai" | "anthropic";
  displayName: string;
  reasoning: ModelReasoning;
  contextWindow: number;
  maxOutput: number;
  multimodal: boolean;
  isDefault: boolean;
};

export type ModelCapabilities = ModelEntry & {
  pricing: ModelPricing | null;
};

export const MODEL_CATALOG: ModelEntry[] = [
  // DeepSeek
  { id: "deepseek-v4-pro",   provider: "deepseek",  displayName: "DeepSeek V4 Pro",   reasoning: { type: "extended", defaultEffort: "max" },  contextWindow: 1_000_000, maxOutput: 131_072, multimodal: true,  isDefault: true },
  { id: "deepseek-v4-flash", provider: "deepseek",  displayName: "DeepSeek V4 Flash", reasoning: { type: "extended", defaultEffort: "high" }, contextWindow: 1_000_000, maxOutput: 65_536,  multimodal: true,  isDefault: false },
  // OpenAI
  { id: "gpt-5.5",      provider: "openai", displayName: "GPT-5.5",      reasoning: { type: "effort", defaultEffort: "medium" }, contextWindow: 1_000_000, maxOutput: 131_072, multimodal: true,  isDefault: false },
  { id: "gpt-5.4",      provider: "openai", displayName: "GPT-5.4",      reasoning: { type: "effort", defaultEffort: "high" },   contextWindow: 1_000_000, maxOutput: 131_072, multimodal: true,  isDefault: false },
  { id: "gpt-5.4-mini", provider: "openai", displayName: "GPT-5.4 Mini", reasoning: { type: "effort", defaultEffort: "high" },   contextWindow: 400_000,   maxOutput: 131_072, multimodal: true,  isDefault: false },
  { id: "gpt-5.4-nano", provider: "openai", displayName: "GPT-5.4 Nano", reasoning: { type: "effort", defaultEffort: "high" },   contextWindow: 400_000,   maxOutput: 131_072, multimodal: true,  isDefault: false },
  // Anthropic
  { id: "claude-opus-4-8",  provider: "anthropic", displayName: "Claude Opus 4.8",  reasoning: { type: "adaptive", defaultEffort: "high" },                    contextWindow: 1_000_000, maxOutput: 131_072, multimodal: true, isDefault: false },
  { id: "claude-sonnet-4-6", provider: "anthropic", displayName: "Claude Sonnet 4.6", reasoning: { type: "adaptive", defaultEffort: "high" },                   contextWindow: 1_000_000, maxOutput: 65_536,  multimodal: true, isDefault: false },
  { id: "claude-haiku-4-5",  provider: "anthropic", displayName: "Claude Haiku 4.5",  reasoning: { type: "extended", defaultEffort: "high", budgetTokens: 16384 }, contextWindow: 200_000,   maxOutput: 65_536,  multimodal: true, isDefault: false },
  { id: "claude-fable-5",    provider: "anthropic", displayName: "Claude Fable 5",    reasoning: { type: "adaptive", defaultEffort: "high" },                    contextWindow: 1_000_000, maxOutput: 131_072, multimodal: true, isDefault: false },
  { id: "claude-mythos-5",   provider: "anthropic", displayName: "Claude Mythos 5",   reasoning: { type: "adaptive", defaultEffort: "high" },                    contextWindow: 1_000_000, maxOutput: 131_072, multimodal: true, isDefault: false },
];

/** Thinking options per reasoning type. */
export const THINKING_OPTIONS_BY_TYPE: Record<ReasoningType, { label: string; effort: ThinkingEffort; thinkingEnabled: boolean }[]> = {
  effort: [
    { label: "Thinking: xhigh",  effort: "xhigh",  thinkingEnabled: true },
    { label: "Thinking: high",   effort: "high",   thinkingEnabled: true },
    { label: "Thinking: medium", effort: "medium", thinkingEnabled: true },
    { label: "Thinking: low",    effort: "low",    thinkingEnabled: true },
    { label: "Thinking: none",   effort: "none",   thinkingEnabled: true },
    { label: "No thinking",      effort: "high",   thinkingEnabled: false },
  ],
  adaptive: [
    { label: "Adaptive: high",   effort: "high",   thinkingEnabled: true },
    { label: "Adaptive: medium", effort: "medium", thinkingEnabled: true },
    { label: "Adaptive: low",    effort: "low",    thinkingEnabled: true },
    { label: "No thinking",      effort: "high",   thinkingEnabled: false },
  ],
  extended: [
    { label: "Thinking: max",  effort: "max",  thinkingEnabled: true },
    { label: "Thinking: high", effort: "high", thinkingEnabled: true },
    { label: "No thinking",    effort: "high", thinkingEnabled: false },
  ],
  none: [
    { label: "No thinking", effort: "high", thinkingEnabled: false },
  ],
};

/** Get full capabilities for a model, including pricing. */
export function getModelCapabilities(modelId: string): ModelCapabilities | null {
  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!entry) return null;
  return { ...entry, pricing: DEFAULT_MODEL_PRICING[modelId] ?? null };
}
```

**Dependencies:** `model-capabilities.ts` (imports `ModelPricing` type and `DEFAULT_MODEL_PRICING`).

**Error Handling:** `getModelCapabilities()` returns `null` for unknown model IDs. Callers handle null by falling back to raw model ID display.

---

### Component 2: `ThinkingEffort` Type Widening

**File:** `src/settings.ts` (MODIFY)

**Purpose:** Replace `ReasoningEffort = "high" | "max"` with `ThinkingEffort` and keep backward-compatible alias.

**Changes:**

```typescript
// OLD (line 23):
export type ReasoningEffort = "high" | "max";

// NEW:
import type { ThinkingEffort } from "./common/model-catalog";
export type { ThinkingEffort };
/** @deprecated Use ThinkingEffort instead. */
export type ReasoningEffort = ThinkingEffort;
```

The `ThinkingEffort` type is defined ONCE in `src/common/model-catalog.ts` (Component 1) and re-exported via `settings.ts` for backward compatibility. No duplicate definition.

**File:** `src/common/settings-schema.ts` (MODIFY)

```typescript
// OLD (line 5):
const reasoningEffortSchema = z.enum(["high", "max"] as const);

// NEW:
const thinkingEffortSchema = z.enum(["none", "low", "medium", "high", "max", "xhigh"] as const);
```

Update all references from `reasoningEffortSchema` to `thinkingEffortSchema` in the schema object.

**File:** `src/settings.ts` — `resolveReasoningEffort()` function (MODIFY)

```typescript
// OLD (line 105):
function resolveReasoningEffort(value: unknown): ReasoningEffort | undefined {

// NEW:
function resolveReasoningEffort(value: unknown): ThinkingEffort | undefined {
  if (typeof value !== "string") return undefined;
  const valid = new Set<string>(["none", "low", "medium", "high", "max", "xhigh"]);
  return valid.has(value) ? (value as ThinkingEffort) : undefined;
}
```

All other references to `ReasoningEffort` in return types and variable declarations remain working via the alias. The `ResolvedDeepcodingSettings.reasoningEffort` field type changes from `ReasoningEffort` to `ThinkingEffort`.

**Dependencies:** None (type-level change only).

---

### Component 3: `buildThinkingRequestOptions` — Extended Effort Handling

**File:** `src/common/openai-thinking.ts` (MODIFY)

**Purpose:** Handle all `ThinkingEffort` values for OpenAI provider.

**Changes (current lines 22-27):**

```typescript
if (providerName === "openai") {
  if (thinkingEnabled) {
    // Map DsCode effort values to OpenAI-compatible values.
    // "max" → "xhigh" (OpenAI has no "max"; xhigh is the highest tier).
    // "none" → reasoning_effort: "none" (model doesn't think at all).
    const openaiEffort = reasoningEffort === "max" ? "xhigh" : reasoningEffort;
    return { reasoning_effort: openaiEffort };
  }
  return {};
}
```

The existing mapping "max"→"xhigh" is preserved. New values "none", "low", "medium" pass through unchanged. "xhigh" passes through unchanged.

**Validation:** When `thinkingEnabled=true` and `reasoningEffort="none"`, returns `{ reasoning_effort: "none" }`. This is valid — OpenAI supports `reasoning_effort: "none"` which means the model processes without internal reasoning tokens.

**Dependencies:** `settings.ts` (imports `ThinkingEffort`/`ReasoningEffort` type).

---

### Component 4: AnthropicProvider — Adaptive Effort Mapping

**File:** `src/providers/anthropic-provider.ts` (MODIFY)

**Purpose:** Map `ThinkingEffort` values to Anthropic-compatible effort for adaptive thinking models.

**Current code (line ~107):**
```typescript
const effort = providerOpts?.reasoningEffort === "max" ? "high" : (providerOpts?.reasoningEffort ?? "high");
```

**New code:**
```typescript
// Map DsCode ThinkingEffort to Anthropic adaptive effort.
// Anthropic adaptive thinking supports: "low", "medium", "high".
// "xhigh" / "max" → "high" (top tier)
// "none" → disable thinking entirely
function toAnthropicEffort(effort: string | undefined): string | undefined {
  if (!effort || effort === "none") return undefined;
  if (effort === "xhigh" || effort === "max") return "high";
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  return "high";
}
const effort = toAnthropicEffort(providerOpts?.reasoningEffort);
```

When `effort` is undefined (from "none" or disabled), the adaptive thinking block still includes `effort: undefined` which is equivalent to omitting it (Anthropic uses default "high").

**Dependencies:** `settings.ts` (type alias).

---

### Component 5: `ModelsDropdown` Rewrite

**File:** `src/ui/components/ModelsDropdown/index.tsx` (REWRITE)

**Purpose:** Show all catalog models grouped by provider, with provider-aware thinking options.

**Interface (unchanged from current, plus one new optional prop):**

```typescript
type Props = {
  open: boolean;
  modelConfig: ModelConfigSelection;
  width: number;
  onClose: () => void;
  onModelConfigChange: (selection: ModelConfigSelection) => string | Promise<string>;
  onStatusMessage?: (message: string | null) => void;
  /** Set of provider names that have configured API keys. Models for providers NOT in this set show "(no key)" suffix. If omitted, no key status is shown (graceful degradation). */
  providerKeys?: Set<string>;
};
```

**Internal Logic:**

1. On open, set `step = "model"` and compute model list from `MODEL_CATALOG`.
2. Build model items: for each provider, insert a header row, then model rows sorted by capability (high to low, approximated by `contextWindow` descending).
3. Each model row: `"displayName  $indicator  (current)?  (no key)?"`.
4. Pricing indicator: count of `"$"` based on `DEFAULT_MODEL_PRICING[model.id].inputPrice`:
   - `>= 5` → `"$$$"`
   - `>= 1` → `"$$"`
   - `< 1` → `"$"`
   - No pricing entry → `"?"`
5. Provider API key check: if `providerKeys` is provided and the model's provider is NOT in the set, append `" (no key)"`. The set is computed in `PromptInput` (Task 9) based on resolved settings: DeepSeek has key if global `apiKey` is truthy; OpenAI has key if `engines.openai.apiKey` or global `apiKey` is truthy; Anthropic has key if `engines.anthropic.apiKey` is truthy (no global fallback).
6. On model select (Step 1, Space/Enter): set `pendingModel`, advance to `step = "thinking"`.
7. On thinking select (Step 2, Space/Enter): build `ModelConfigSelection`, call `onModelConfigChange(selection)`, close.
8. Escape in Step 2: return to Step 1. Escape in Step 1: close.

**Dependencies:**
- `model-catalog.ts` — `MODEL_CATALOG`, `THINKING_OPTIONS_BY_TYPE`, `getModelCapabilities`.
- `model-capabilities.ts` — `DEFAULT_MODEL_PRICING` (for pricing indicator).
- `settings.ts` — `ModelConfigSelection`, `ResolvedDeepcodingSettings`, `ThinkingEffort` types.
- `DropdownMenu` base component.

**Error Handling:**
- If `MODEL_CATALOG` is empty (should never happen), show single item `"No models available"`.
- If `getModelCapabilities()` returns null for the current model, display the raw model ID.
- If `onModelConfigChange` throws, catch and display via `onStatusMessage`.

---

### Component 6: Status Bar Model Display Update

**File:** `src/ui/utils/index.ts` (MODIFY)

**Purpose:** Show model display name and thinking indicator in status bar.

**Current `formatModelConfig()` (line 105):**
```typescript
export function formatModelConfig(settings: ModelConfigSelection): string {
  return settings.thinkingEnabled
    ? `${settings.model} (${settings.reasoningEffort})`
    : `${settings.model} (no thinking)`;
}
```

**New implementation:**
```typescript
export function formatModelConfig(settings: ModelConfigSelection): string {
  const caps = getModelCapabilities(settings.model);
  const name = caps?.displayName ?? settings.model;
  if (!settings.thinkingEnabled) return name;
  const indicator = "\u0394"; // 𝚫 — mathematical bold capital delta for "thinking"
  return `${name} ${indicator}${settings.reasoningEffort}`;
}
```

**`buildStatusLine()` update (line ~84):** Replace raw model ID with `formatModelConfig()` output on the right side of the status line.

The current status bar format is: `status: completed · ⚡14.4K · last_user_prompt_truncated`. Add model info as: `status: completed · DeepSeek V4 Pro 𝚫max · ⚡14.4K`.

**Dependencies:** `model-catalog.ts` — `getModelCapabilities`.

---

### Component 7: Command Handler — No Changes

**File:** `src/ui/core/command-handlers.ts` (NO CHANGE)

The `model` handler at line 32 already opens the dropdown:
```typescript
model: (_item, ctx) => {
  ctx.clearSlashToken();
  ctx.setShowSkillsDropdown(false);
  ctx.setShowModelDropdown(true);
},
```

No changes needed — the handler just toggles the dropdown visibility. The dropdown itself handles all model selection logic.

---

### Component 8: `handleModelConfigChange` — Add Provider Error Message

**File:** `src/ui/contexts/AppStateContext.tsx` (MODIFY)

**Purpose:** Improve the status message when switching to a provider with no API key.

**Current code (line 494-527):** Already writes model config and shows a success message. No change to the core logic.

**Addition:** After writing settings and before returning the message, check if the new model's provider has a configured API key. If not, append a warning:

```typescript
const next = resolveCurrentSettings(projectRoot);
const caps = getModelCapabilities(next.model);
const provider = caps?.provider;
if (provider && provider !== "deepseek") {
  const engineKey = next.engines[provider]?.apiKey;
  if (!engineKey && !next.apiKey) {
    message += `\nWarning: No API key configured for ${provider}. Set engines.${provider}.apiKey.`;
  }
}
```

**Dependencies:** `model-catalog.ts` — `getModelCapabilities`.

---

### Component 9: SessionManager — Error Message for Missing Provider Key

**File:** `src/session.ts` (MODIFY, minimal)

**Purpose:** When `createLlmProvider()` returns `provider: null`, show a provider-specific error message.

**Current behavior:** `createLlmProvider()` returns `{ provider: null }`. `SessionManager.activateSession()` already handles null provider by showing an error. The error message is generic.

**Change:** In the null-provider path, read the resolved model and its provider, then show a targeted message:

```typescript
if (!result.provider) {
  const settings = this.getResolvedSettings();
  const caps = getModelCapabilities(settings.model);
  const providerName = caps?.provider ?? "unknown";
  const msg = `No API key configured for ${providerName}. Set engines.${providerName}.apiKey in settings.json or the DEEPCODE_ENGINE_${providerName.toUpperCase()}_API_KEY environment variable.`;
  // add as system message or throw
}
```

**Dependencies:** `model-catalog.ts` — `getModelCapabilities`.

---

## Data Flow

### Model Switch Flow

```
User types /model
  → executeSlashCommand("model", ctx)
  → ctx.setShowModelDropdown(true)
  → ModelsDropdown renders with open=true
  → Reads MODEL_CATALOG, DEFAULT_MODEL_PRICING, resolvedSettings
  → Step 1: Shows all models grouped by provider
  → User selects "GPT-5.5" (Space/Enter)
  → Step 2: Shows effort options: "Thinking: xhigh" through "No thinking"
  → User selects "Thinking: high" (Space/Enter)
  → Builds ModelConfigSelection: { model: "gpt-5.5", thinkingEnabled: true, reasoningEffort: "high" }
  → Calls onModelConfigChange(selection)
  → handleModelConfigChange in AppStateContext:
    1. writeModelConfigSelection(selection, current, projectRoot) → writes to settings.json
    2. resolveCurrentSettings(projectRoot) → reads fresh settings
    3. setResolvedSettings(next) → updates React state
    4. Adds system message: "/model\n└ Set model to gpt-5.5 (high)"
    5. Checks if OpenAI API key is configured; warns if not
    6. Returns status message
  → Dropdown closes
  → Status bar updates: shows "GPT-5.5 𝚫high"
```

### Next Message After Model Switch

```
User sends message "hello"
  → SessionManager.replySession()
  → Reads fresh settings via this.getResolvedSettings()
  → createLlmProvider(projectRoot, converterOptions)
  → Registry: isOpenAIModel("gpt-5.5") → true
  → engineName = "openai"
  → createOpenAIClient(projectRoot, "openai") → reads engines.openai.apiKey
  → If key exists: new OpenAIProvider(createClient)
  → If key absent: provider = null
  → If provider null: show error "No API key configured for openai..."
  → If provider valid: provider.chat() with thinkingEnabled=true, reasoningEffort="high"
```

---

## Data Structures

| Type | File | Change |
|---|---|---|
| `ThinkingEffort` | `model-catalog.ts` | NEW: `"none" \| "low" \| "medium" \| "high" \| "max" \| "xhigh"`; re-exported from `settings.ts` |
| `ReasoningEffort` | `settings.ts` | MODIFY: type alias of `ThinkingEffort` |
| `ModelEntry` | `model-catalog.ts` | NEW |
| `ModelReasoning` | `model-catalog.ts` | NEW |
| `ModelCapabilities` | `model-catalog.ts` | NEW |
| `MODEL_CATALOG` | `model-catalog.ts` | NEW: `ModelEntry[]` |
| `THINKING_OPTIONS_BY_TYPE` | `model-catalog.ts` | NEW |

---

## File / Module Layout

```
src/
├── common/
│   ├── model-catalog.ts              ← NEW: MODEL_CATALOG, ModelEntry, getModelCapabilities
│   ├── model-capabilities.ts         ← KEEP (DEFAULT_MODEL_PRICING, isMultimodalModel unchanged)
│   ├── openai-thinking.ts            ← MODIFY: handle full ThinkingEffort range
│   ├── settings-schema.ts            ← MODIFY: thinkingEffortSchema widened
│   └── ... all other files unchanged
├── providers/
│   ├── anthropic-provider.ts         ← MODIFY: toAnthropicEffort helper
│   └── ... all other files unchanged
├── settings.ts                       ← MODIFY: ThinkingEffort type, resolveReasoningEffort widened
├── session.ts                        ← MODIFY: targeted error for missing provider key
├── ui/
│   ├── components/
│   │   └── ModelsDropdown/
│   │       └── index.tsx             ← REWRITE: catalog-driven, provider-aware
│   ├── contexts/
│   │   └── AppStateContext.tsx        ← MODIFY: API key warning in handleModelConfigChange
│   ├── utils/
│   │   └── index.ts                  ← MODIFY: formatModelConfig uses display names
│   └── core/
│       └── command-handlers.ts       ← NO CHANGE
└── tests/
    ├── model-catalog.test.ts          ← NEW: tests for MODEL_CATALOG and getModelCapabilities
    └── models-dropdown.test.ts        ← NEW: tests for dropdown rendering with catalog
```

---

## Testing Strategy

### New Tests

**`model-catalog.test.ts` (NEW):**
1. `MODEL_CATALOG has exactly 11 entries` — verifies catalog completeness.
2. `MODEL_CATALOG has exactly one default model` — verifies `isDefault` consistency.
3. `getModelCapabilities returns correct capabilities for each model` — iterates all 11 models, checks provider, displayName, multimodal, reasoning type.
4. `getModelCapabilities returns pricing from DEFAULT_MODEL_PRICING` — checks pricing is correctly linked.
5. `getModelCapabilities returns null for unknown model` — `getModelCapabilities("nonexistent")` → null.
6. `THINKING_OPTIONS_BY_TYPE has entries for all reasoning types` — verifies coverage.
7. `THINKING_OPTIONS_BY_TYPE["effort"] has 6 options` — verifies OpenAI effort count.
8. `THINKING_OPTIONS_BY_TYPE["adaptive"] has 4 options` — verifies Anthropic adaptive count.
9. `THINKING_OPTIONS_BY_TYPE["extended"] has 3 options` — verifies DeepSeek/Haiku count.

**`models-dropdown.test.ts` (NEW):**
10. `ModelsDropdown renders model list grouped by provider` — integration test.
11. `ModelsDropdown shows thinking options for selected model type` — selects an "effort" model, verifies 6 options.

### Modified Tests

**`openai-thinking.test.ts` (MODIFY):**
12. `buildThinkingRequestOptions returns OpenAI format with "none" effort` — new test: `{ reasoning_effort: "none" }`.
13. `buildThinkingRequestOptions returns OpenAI format with "low" effort` — new test.

**`openai-provider.test.ts` (NO CHANGE):** All existing tests pass without modification.

**`anthropic-provider.test.ts` (NO CHANGE):** All existing tests pass without modification.

---

## Migration / Rollback

**Migration:** No data migration required. The `MODEL_CATALOG` is new code. The widened `ThinkingEffort` type accepts all values the old `ReasoningEffort` type accepted (`"high"`, `"max"`), so existing `settings.json` files are valid. The `reasoningEffort` field in `settings.json` keeps its name — only the TypeScript type changes.

**Rollback:** Revert the commit. The `MODEL_CATALOG` file is deleted. `ModelsDropdown` reverts to the previous hardcoded implementation. `ThinkingEffort` type narrows back to `"high" | "max"`. No persistent state is affected.
