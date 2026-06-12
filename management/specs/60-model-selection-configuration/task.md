# Spec 60: model-selection-configuration — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

---

## Tasks

### Task 1: Create `model-catalog.ts` with full catalog and types

**Objective:** Create the centralized model catalog that becomes the single source of truth for all model metadata.

**Requirements Covered:** FR-001, FR-009

**Design References:** Component 1 in design.md.

**Actions:**
1. Create file `src/common/model-catalog.ts`.
2. Copy the exact implementation from design.md Component 1 (the full `MODEL_CATALOG` array, `ModelEntry` type, `ModelReasoning` type, `ModelCapabilities` type, `THINKING_OPTIONS_BY_TYPE`, `getModelCapabilities()` function). Ensure imports for `ModelPricing` type and `DEFAULT_MODEL_PRICING` value use static `import` at the top of the file — there is no circular dependency with `model-capabilities.ts` at this point.
3. Run `npm run typecheck` — must pass with zero errors.

**Validation:**
- [ ] File `src/common/model-catalog.ts` exists.
- [ ] Exports `MODEL_CATALOG`, `ModelEntry`, `ThinkingEffort`, `ReasoningType`, `ModelReasoning`, `ModelCapabilities`, `THINKING_OPTIONS_BY_TYPE`, `getModelCapabilities`.
- [ ] `MODEL_CATALOG` has exactly 11 entries.
- [ ] Exactly one entry has `isDefault: true`.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 2: Widen `ReasoningEffort` to `ThinkingEffort` in settings types

**Objective:** Replace the DeepSeek-specific `ReasoningEffort = "high" | "max"` with the provider-agnostic `ThinkingEffort`.

**Requirements Covered:** FR-002, FR-008

**Design References:** Component 2 in design.md.

**Actions:**
1. Open `src/settings.ts`.
2. On line 23, replace `export type ReasoningEffort = "high" | "max";` with:
   ```typescript
   import type { ThinkingEffort } from "./common/model-catalog";
   export type { ThinkingEffort };
   /** @deprecated Use ThinkingEffort instead. */
   export type ReasoningEffort = ThinkingEffort;
   ```
   (The `ThinkingEffort` type is defined once in `model-catalog.ts` — Task 1. This file imports and re-exports it.)
3. Update the `resolveReasoningEffort()` function on line 105 to validate against the new wider set (use a `Set<string>` check for all 6 values).
4. Update the return type of `resolveReasoningEffort()` from `ReasoningEffort | undefined` to `ThinkingEffort | undefined`.
5. Update the `reasoningEffort` field type in `ResolvedDeepcodingSettings` (line ~83) from `ReasoningEffort` to `ThinkingEffort`.
6. Open `src/common/settings-schema.ts`.
7. On line 5, replace `const reasoningEffortSchema = z.enum(["high", "max"] as const);` with:
   ```typescript
   const thinkingEffortSchema = z.enum(["none", "low", "medium", "high", "max", "xhigh"] as const);
   ```
8. In the Zod schema object (line 88), update `reasoningEffort: reasoningEffortSchema.optional()` to `reasoningEffort: thinkingEffortSchema.optional()`.
9. Run `npm run typecheck` — must pass. The `ReasoningEffort` alias ensures all existing imports still work.

**Validation:**
- [ ] `ThinkingEffort` type accepts all 6 values.
- [ ] `ReasoningEffort` is a type alias of `ThinkingEffort`.
- [ ] `resolveReasoningEffort("medium")` returns `"medium"`.
- [ ] `resolveReasoningEffort("xhigh")` returns `"xhigh"`.
- [ ] `resolveReasoningEffort("invalid")` returns `undefined`.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 3: Extend `buildThinkingRequestOptions` for full effort range

**Objective:** Handle all `ThinkingEffort` values in the OpenAI thinking options builder.

**Requirements Covered:** FR-002, FR-008

**Design References:** Component 3 in design.md.

**Actions:**
1. Open `src/common/openai-thinking.ts`.
2. The OpenAI branch at lines 22-27 currently maps "max"→"xhigh". Ensure all new values pass through correctly:
   - "none" → `{ reasoning_effort: "none" }`
   - "low" → `{ reasoning_effort: "low" }`
   - "medium" → `{ reasoning_effort: "medium" }`
   - "high" → `{ reasoning_effort: "high" }` (unchanged)
   - "xhigh" → `{ reasoning_effort: "xhigh" }` (unchanged)
   - "max" → `{ reasoning_effort: "xhigh" }` (existing mapping preserved)
3. The existing code already handles this: `const openaiEffort = reasoningEffort === "max" ? "xhigh" : reasoningEffort;`. Since only "max" is specially mapped, all other values pass through. No code change needed — verify this is correct.
4. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `buildThinkingRequestOptions(true, undefined, "none", "openai")` returns `{ reasoning_effort: "none" }`.
- [ ] `buildThinkingRequestOptions(true, undefined, "low", "openai")` returns `{ reasoning_effort: "low" }`.
- [ ] `buildThinkingRequestOptions(true, undefined, "medium", "openai")` returns `{ reasoning_effort: "medium" }`.
- [ ] Existing tests for "high", "max"/"xhigh", and disabled pass unchanged.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 4: Add adaptive effort mapping to AnthropicProvider

**Objective:** Map `ThinkingEffort` values to Anthropic-compatible effort levels for adaptive thinking models.

**Requirements Covered:** FR-002, FR-008

**Design References:** Component 4 in design.md.

**Actions:**
1. Open `src/providers/anthropic-provider.ts`.
2. Before the `chat()` method (or as a module-level helper), add:
   ```typescript
   function toAnthropicEffort(effort: string | undefined): string | undefined {
     if (!effort || effort === "none") return undefined;
     if (effort === "xhigh" || effort === "max") return "high";
     if (effort === "low" || effort === "medium" || effort === "high") return effort;
     return "high";
   }
   ```
3. Find the line where `effort` is computed for adaptive thinking (currently `const effort = providerOpts?.reasoningEffort === "max" ? "high" : (providerOpts?.reasoningEffort ?? "high")`). Replace with:
   ```typescript
   const effort = toAnthropicEffort(providerOpts?.reasoningEffort);
   ```
4. When `effort` is `undefined`, the adaptive thinking block should omit the `effort` field (Anthropic uses its default). The current code always sets `effort` — update to conditionally include it:
   ```typescript
   const thinkingBlock: Record<string, unknown> = { type: "adaptive" };
   if (effort) thinkingBlock.effort = effort;
   requestBody.thinking = thinkingBlock;
   ```
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `toAnthropicEffort("xhigh")` returns `"high"`.
- [ ] `toAnthropicEffort("max")` returns `"high"`.
- [ ] `toAnthropicEffort("medium")` returns `"medium"`.
- [ ] `toAnthropicEffort("low")` returns `"low"`.
- [ ] `toAnthropicEffort("none")` returns `undefined`.
- [ ] `toAnthropicEffort(undefined)` returns `undefined`.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 5: Rewrite `ModelsDropdown` with catalog-driven model list

**Objective:** Replace the hardcoded 2-model dropdown with a catalog-driven dropdown showing all 11 models grouped by provider with provider-aware thinking options.

**Requirements Covered:** FR-001, FR-002, FR-004

**Design References:** Component 5 in design.md.

**Actions:**
1. Open `src/ui/components/ModelsDropdown/index.tsx`.
2. Remove `MODEL_COMMAND_MODELS` constant (line 14).
3. Remove `MODEL_COMMAND_THINKING_OPTIONS` constant (lines 16-20).
4. Remove `ThinkingModeOption` type (lines 8-12) — use `THINKING_OPTIONS_BY_TYPE` from catalog instead.
5. Add imports:
   ```typescript
   import { MODEL_CATALOG, THINKING_OPTIONS_BY_TYPE, getModelCapabilities } from "../../../common/model-catalog";
   import { DEFAULT_MODEL_PRICING } from "../../../common/model-capabilities";
   import type { ModelEntry, ThinkingEffort } from "../../../common/model-catalog";
   ```
6. Rewrite the component:
   - Keep the two-step flow (model select → thinking select).
   - **Step 1 model list:** Group `MODEL_CATALOG` by provider. Sort providers in order: DeepSeek, OpenAI, Anthropic. Within each provider, sort models by `contextWindow` descending (most capable first). Insert non-selectable header rows with provider names (dimmed). Each model row shows: `"displayName  $indicator  (current)?"`.
   - Pricing indicator: `"$$$"` for inputPrice ≥ 5, `"$$"` for ≥ 1, `"$"` for < 1, `"?"` for no pricing entry.
   - Current model marker: `"(current)"` if model ID matches `modelConfig.model`.
   - API key check: Accept a new optional prop `engineKeys?: Record<string, boolean>` (or check inside component). If a model's provider has no key, append `" (no key)"`. For simplicity, accept a `Set<string>` of providers with keys.
   - **Step 2 thinking options:** Read `THINKING_OPTIONS_BY_TYPE[selectedModel.reasoning.type]`. Render each option. Pre-select the option matching the current `modelConfig.thinkingEnabled` and `modelConfig.reasoningEffort`.
   - Escape in Step 2 → back to Step 1. Escape in Step 1 → close.
7. Keep the `useInput` hook with arrow key navigation and Space/Enter selection (structure unchanged, only the item list changes).
8. The `onModelConfigChange` callback is unchanged — the consumer (`AppStateContext`) already handles writing settings.
9. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `MODEL_COMMAND_MODELS` and `MODEL_COMMAND_THINKING_OPTIONS` are removed from the file.
- [ ] Step 1 shows all 11 models with provider headers.
- [ ] Pricing indicators are displayed.
- [ ] Current model is marked "(current)".
- [ ] Step 2 shows correct thinking options for each reasoning type.
- [ ] Arrow key navigation works in both steps.
- [ ] Escape in Step 2 returns to Step 1.
- [ ] Selecting a model and thinking mode calls `onModelConfigChange`.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 6: Update `formatModelConfig` to use display names

**Objective:** Replace raw model IDs in the status bar with human-readable display names from the catalog, and add thinking indicator.

**Requirements Covered:** FR-006

**Design References:** Component 6 in design.md.

**Actions:**
1. Open `src/ui/utils/index.ts`.
2. Add import:
   ```typescript
   import { getModelCapabilities } from "../../common/model-catalog";
   ```
3. Update `formatModelConfig()` function (approximately line 105):
   ```typescript
   export function formatModelConfig(settings: ModelConfigSelection): string {
     const caps = getModelCapabilities(settings.model);
     const name = caps?.displayName ?? settings.model;
     if (!settings.thinkingEnabled) return name;
     const indicator = "\u0394"; // 𝚫
     return `${name} ${indicator}${settings.reasoningEffort}`;
   }
   ```
4. In `buildStatusLine()` (approximately line 84), add the formatted model config to the status line parts. The status line format becomes:
   ```
   status: completed · ModelName 𝚫effort · ⚡14.4K · message_truncated
   ```
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `formatModelConfig({ model: "deepseek-v4-pro", thinkingEnabled: true, reasoningEffort: "max" })` returns `"DeepSeek V4 Pro 𝚫max"`.
- [ ] `formatModelConfig({ model: "gpt-5.5", thinkingEnabled: false, reasoningEffort: "high" })` returns `"GPT-5.5"`.
- [ ] Status bar shows display name, not raw model ID.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 7: Add API key warning to `handleModelConfigChange`

**Objective:** Warn the user when switching to a model whose provider has no API key configured.

**Requirements Covered:** FR-003, FR-005

**Design References:** Component 8 in design.md.

**Actions:**
1. Open `src/ui/contexts/AppStateContext.tsx`.
2. Add import:
   ```typescript
   import { getModelCapabilities } from "../../common/model-catalog";
   ```
3. In `handleModelConfigChange`, after writing settings and re-resolving (lines 497-498), add:
   ```typescript
   const next = resolveCurrentSettings(projectRoot);
   const caps = getModelCapabilities(next.model);
   const provider = caps?.provider;
   if (provider && provider !== "deepseek") {
     const engineKey = next.engines[provider]?.apiKey;
     if (!engineKey && !next.apiKey) {
       // Append warning to the return message
     }
   }
   ```
4. The warning text: `` `\nWarning: No API key configured for ${provider}. Set engines.${provider}.apiKey.` ``
5. Append this to the status message returned from the callback.
6. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] Switching to an OpenAI model with no OpenAI key shows the warning in the status message.
- [ ] Switching to a DeepSeek model never shows the warning (uses global key).
- [ ] Switching to a model whose provider has a key shows no warning.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 8: Add targeted error for missing provider key in SessionManager

**Objective:** When `createLlmProvider()` returns null provider, show a message identifying which provider is missing a key.

**Requirements Covered:** FR-003, FR-005

**Design References:** Component 9 in design.md.

**Actions:**
1. Open `src/session.ts`.
2. Find the null-provider error path in `activateSession()` (where `result.provider` is null).
3. Before throwing or returning the error, compute a provider-specific message:
   ```typescript
   import { getModelCapabilities } from "./common/model-catalog";
   // ... in the null-provider branch:
   const caps = getModelCapabilities(this.getResolvedSettings().model);
   const name = caps?.provider ?? "unknown";
   ```
4. Use the provider name in the error message: `` `No API key configured for ${name}. Set engines.${name}.apiKey in settings.json or the DEEPCODE_ENGINE_${name.toUpperCase()}_API_KEY environment variable.` ``
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] When DeepSeek has no key: message says "No API key configured for deepseek...".
- [ ] When OpenAI has no key: message says "No API key configured for openai...".
- [ ] The message includes the environment variable name.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 9: Update `PromptInput` to pass engine keys to dropdown

**Objective:** Provide the `ModelsDropdown` with information about which providers have configured API keys.

**Requirements Covered:** FR-004

**Design References:** Component 5 in design.md (API key check).

**Actions:**
1. Open `src/ui/views/PromptInput.tsx`.
2. The component already receives `resolvedSettings` or can compute it. Check the props — `PromptInput` receives `modelConfig` which includes model/thinking but not engine keys.
3. Add a new optional prop to `ModelsDropdown`: `providerKeys?: Set<string>` — a set of provider names that have API keys.
4. In `PromptInput`, compute which providers have keys from `resolvedSettings`:
   - DeepSeek: key exists if `resolvedSettings.apiKey` is truthy.
   - OpenAI: key exists if `resolvedSettings.engines.openai?.apiKey` is truthy OR `resolvedSettings.apiKey` is truthy (fallback).
   - Anthropic: key exists if `resolvedSettings.engines.anthropic?.apiKey` is truthy (Anthropic uses separate SDK, not shared key).
5. Pass the `Set` to `ModelsDropdown`.
6. In `ModelsDropdown`, use this set to show "(no key)" suffix on models whose providers aren't in the set.
7. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] Models for providers with keys don't show "(no key)".
- [ ] Models for providers without keys show "(no key)".
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 10: Create `model-catalog.test.ts`

**Objective:** Test the model catalog and its helper functions.

**Requirements Covered:** FR-001, FR-009 (validation)

**Design References:** Testing Strategy in design.md.

**Actions:**
1. Create file `src/tests/model-catalog.test.ts`.
2. Add these tests (minimum 9):
   - `MODEL_CATALOG has exactly 11 entries`
   - `MODEL_CATALOG has exactly one default model`
   - `getModelCapabilities returns correct capabilities for deepseek-v4-pro`
   - `getModelCapabilities returns correct capabilities for gpt-5.5`
   - `getModelCapabilities returns correct capabilities for claude-opus-4-8`
   - `getModelCapabilities returns pricing from DEFAULT_MODEL_PRICING`
   - `getModelCapabilities returns null for unknown model`
   - `THINKING_OPTIONS_BY_TYPE has entries for all 4 reasoning types`
   - `THINKING_OPTIONS_BY_TYPE["effort"] has 6 options`
   - `THINKING_OPTIONS_BY_TYPE["adaptive"] has 4 options`
   - `THINKING_OPTIONS_BY_TYPE["extended"] has 3 options`
3. Run `npm test -- --grep model-catalog` — all must pass.

**Validation:**
- [ ] File `src/tests/model-catalog.test.ts` exists with at least 9 tests.
- [ ] All new tests pass.

**Status:** [x] done

---

### Task 11: Add new tests to `openai-thinking.test.ts`

**Objective:** Test `buildThinkingRequestOptions` with new `ThinkingEffort` values.

**Requirements Covered:** FR-008 (validation)

**Design References:** Testing Strategy in design.md.

**Actions:**
1. Open `src/tests/openai-thinking.test.ts`.
2. Add 4 new tests (do NOT remove or modify existing tests):
   - `returns OpenAI format with "none" effort` — `buildThinkingRequestOptions(true, undefined, "none", "openai")` → `{ reasoning_effort: "none" }`.
   - `returns OpenAI format with "low" effort` — `buildThinkingRequestOptions(true, undefined, "low", "openai")` → `{ reasoning_effort: "low" }`.
   - `returns OpenAI format with "medium" effort` — `buildThinkingRequestOptions(true, undefined, "medium", "openai")` → `{ reasoning_effort: "medium" }`.
   - `returns OpenAI format with "xhigh" effort` — `buildThinkingRequestOptions(true, undefined, "xhigh", "openai")` → `{ reasoning_effort: "xhigh" }`.
3. Verify the existing "max"→"xhigh" test still passes.
4. Run `npm test -- --grep openai-thinking` — all must pass.

**Validation:**
- [ ] 4 new tests added.
- [ ] All existing and new tests pass.

**Status:** [x] done

---

### Task 12: Run full validation suite

**Objective:** Verify the complete change set compiles and passes all tests.

**Requirements Covered:** NFR-002, NFR-003, NFR-004

**Actions:**
1. Run `npm run typecheck` — must pass with zero errors.
2. Run `npm test` — must pass with zero failures.
3. Run `npm run build` — must produce `dist/cli.js` without errors.
4. Verify `package.json` has zero changes (`git diff HEAD -- package.json`).
5. Verify `package-lock.json` has zero changes.
6. Run `git diff --stat` to review all changed files — confirm only expected files are modified:
   - `src/common/model-catalog.ts` (NEW)
   - `src/common/settings-schema.ts`
   - `src/common/openai-thinking.ts`
   - `src/settings.ts`
   - `src/providers/anthropic-provider.ts`
   - `src/session.ts`
   - `src/ui/components/ModelsDropdown/index.tsx`
   - `src/ui/contexts/AppStateContext.tsx`
   - `src/ui/utils/index.ts`
   - `src/ui/views/PromptInput.tsx` (minor)
   - `src/tests/model-catalog.test.ts` (NEW)
   - `src/tests/openai-thinking.test.ts`
7. Smoke test: Launch DsCode, type `/model`, verify the dropdown shows all 11 models grouped by provider.

**Validation:**
- [ ] All commands return exit code 0.
- [ ] `package.json` unchanged.
- [ ] `package-lock.json` unchanged.
- [ ] Only expected files modified.

**Status:** [x] done

---

### Task 13: Update roadmap status

**Objective:** Mark spec 60 status in roadmap.

**Actions:**
1. Open `management/roadmap.md`.
2. Find the row for spec 60.
3. Change status from `planned` to `created`.

**Validation:**
- [ ] Roadmap shows `created` for spec 60.

**Status:** [x] done
