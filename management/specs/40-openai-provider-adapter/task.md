# Spec 40: openai-provider-adapter — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

---

## Tasks

### Task 1: Add `EngineEntry` type and `engines` to settings schema

**Objective:** Update `settings-schema.ts` and `settings.ts` to support the `engines` configuration field.

**Requirements Covered:** FR-001

**Design References:** Component 1, Component 2 in design.md.

**Actions:**
1. Open `src/common/settings-schema.ts`.
2. Add export before the Zod schema:
   ```typescript
   export type EngineEntry = {
     apiKey?: string;
     baseURL?: string;
   };
   ```
3. In the Zod schema object (the argument to `z.object({...})`), add after `mcpServers`:
   ```typescript
   engines: z.record(z.string(), z.object({
     apiKey: z.string().optional(),
     baseURL: z.string().optional(),
   })).optional(),
   ```
4. Open `src/settings.ts`.
5. Import `EngineEntry`:
   ```typescript
   import { deepcodingSettingsSchema, formatZodErrors, type EngineEntry } from "./common/settings-schema";
   ```
6. In `DeepcodingSettings` type, add after `mcpServers`:
   ```typescript
   engines?: Record<string, EngineEntry>;
   ```
7. In `ResolvedDeepcodingSettings` type, add after `mcpServers`:
   ```typescript
   engines: Record<string, EngineEntry>;
   ```
8. Add helper function `collectEngineEnv` before `resolveSettingsSources`:
   ```typescript
   function collectEngineEnv(processEnv: SettingsProcessEnv): Record<string, { apiKey?: string; baseURL?: string }> {
     const engines: Record<string, { apiKey?: string; baseURL?: string }> = {};
     const prefix = "DEEPCODE_ENGINE_";
     for (const [key, value] of Object.entries(processEnv)) {
       if (!key.startsWith(prefix) || typeof value !== "string" || !value) continue;
       const rest = key.slice(prefix.length);
       const lastUnderscore = rest.lastIndexOf("_");
       if (lastUnderscore <= 0) continue;
       const engineName = rest.slice(0, lastUnderscore).toLowerCase();
       const fieldName = rest.slice(lastUnderscore + 1).toLowerCase();
       if (fieldName === "api_key" || fieldName === "apikey") {
         engines[engineName] ??= {};
         engines[engineName].apiKey = value;
       } else if (fieldName === "base_url" || fieldName === "baseurl") {
         engines[engineName] ??= {};
         engines[engineName].baseURL = value;
       }
     }
     return engines;
   }
   ```
9. In `resolveSettingsSources`, before the `const model =` line, add:
   ```typescript
   const engines = {
     ...(userSettings?.engines ?? {}),
     ...(projectSettings?.engines ?? {}),
     ...collectEngineEnv(processEnv),
   };
   ```
10. Add `engines,` to the return object of `resolveSettingsSources()` (after `mcpServers`).
11. In `DEFAULT_SETTINGS`, add after `mcpServers: {}`:
    ```typescript
    engines: {},
    ```
12. Run `npm run typecheck` — must pass with zero errors.

**Validation:**
- [ ] `settings-schema.ts` exports `EngineEntry` type.
- [ ] `DeepcodingSettings` and `ResolvedDeepcodingSettings` have `engines` field.
- [ ] `DEFAULT_SETTINGS.engines` is `{}`.
- [ ] `npm run typecheck` passes with zero errors.

**Status:** [x] done

---

### Task 2: Make `createOpenAIClient` engine-aware

**Objective:** Add optional `engineName` parameter to `createOpenAIClient` so it reads API key and base URL from the named engine config.

**Requirements Covered:** FR-001, FR-009

**Design References:** Component 3 in design.md.

**Actions:**
1. Open `src/common/openai-client.ts`.
2. Change function signature from `export function createOpenAIClient(projectRoot: string = process.cwd())` to:
   ```typescript
   export function createOpenAIClient(
     projectRoot: string = process.cwd(),
     engineName?: string,
   )
   ```
3. After `const settings = resolveCurrentSettings(projectRoot);`, add engine-aware resolution (copy exactly from design.md Component 3):
   ```typescript
   // Engine-specific default base URLs (not falling through to global DeepSeek default)
   const ENGINE_DEFAULT_BASE_URLS: Record<string, string> = {
     openai: "https://api.openai.com/v1",
   };

   // Resolve API key and base URL: engine-specific → engine default → global
   let apiKey = settings.apiKey;
   let baseURL = settings.baseURL;
   if (engineName) {
     const engineConfig = settings.engines[engineName];
     if (engineConfig) {
       apiKey = engineConfig.apiKey || apiKey;
       baseURL = engineConfig.baseURL || ENGINE_DEFAULT_BASE_URLS[engineName] || baseURL;
     } else {
       // No engine config at all — use engine-specific default base URL
       baseURL = ENGINE_DEFAULT_BASE_URLS[engineName] || baseURL;
     }
   }
   ```
4. Replace `if (!settings.apiKey)` (the null return guard, the FIRST occurrence after `const settings = resolveCurrentSettings`) with `if (!apiKey)`.
5. Replace `baseURL: settings.baseURL || undefined` (in the `new OpenAI({...})` call) with `baseURL: baseURL || undefined`.
6. In the two non-null return statements (the cached-client return block and the new-client return block), replace `baseURL: settings.baseURL` with `baseURL`.
7. In all non-null return statements, keep `model: settings.model` unchanged (model always comes from global settings).
8. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `createOpenAIClient()` with no engine name works identically to before.
- [ ] `createOpenAIClient(projectRoot, "openai")` reads from `engines.openai`.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 3: Add `getCheapModel` to `ILlmProvider` interface

**Objective:** Add optional `getCheapModel` method to the provider interface.

**Requirements Covered:** FR-005

**Design References:** Component 6 in design.md.

**Actions:**
1. Open `src/common/llm-provider.ts`.
2. Add to `ILlmProvider` interface, after `isMultimodal`:
   ```typescript
   /** Return the cheapest thinking-disabled model for the given model, or null if none. */
   getCheapModel?(model: string): string | null;
   ```
3. Open `src/tests/session.test.ts`.
4. Find all `createMockProvider` calls or inline mock objects that implement `ILlmProvider`.
5. Add `getCheapModel: () => null` to each mock provider object (fixes the typecheck error introduced by the interface change).
6. Run `npm run typecheck` — must pass with zero errors.

**Validation:**
- [ ] `ILlmProvider` interface has optional `getCheapModel` method.
- [ ] All mock providers in `session.test.ts` have `getCheapModel: () => null`.
- [ ] `npm run typecheck` passes with zero errors.

**Status:** [x] done

---

### Task 4: Make `buildThinkingRequestOptions` provider-aware

**Objective:** Add optional `providerName` parameter. Return OpenAI-native format when provider is `"openai"`.

**Requirements Covered:** FR-004

**Design References:** Component 4 in design.md.

**Actions:**
1. Open `src/common/openai-thinking.ts`.
2. Add `providerName` parameter:
   ```typescript
   export function buildThinkingRequestOptions(
     thinkingEnabled: boolean,
     _baseURL?: string,
     reasoningEffort: ReasoningEffort = "max",
     providerName?: string,
   ): ThinkingRequestOptions | Record<string, unknown> {
   ```
3. Add OpenAI branch at the top of the function body (before the DeepSeek logic):
   ```typescript
   if (providerName === "openai") {
     if (thinkingEnabled) {
       return { reasoning_effort: reasoningEffort };
     }
     return {};
   }
   ```
4. The existing DeepSeek logic remains unchanged below the OpenAI branch.
5. Run `npm run typecheck` — must pass (existing callers don't pass the new parameter, defaults to DeepSeek).

**Validation:**
- [ ] `buildThinkingRequestOptions(true, undefined, "high", "openai")` returns `{ reasoning_effort: "high" }`.
- [ ] `buildThinkingRequestOptions(false, undefined, undefined, "openai")` returns `{}`.
- [ ] `buildThinkingRequestOptions(true, undefined, "max")` returns DeepSeek format (backward compatible).
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 5: Create `OpenAIProvider` class

**Objective:** Create the `OpenAIProvider` class implementing `ILlmProvider`.

**Requirements Covered:** FR-002

**Design References:** Component 5 in design.md — full implementation specified verbatim.

**Actions:**
1. Create file `src/providers/openai-provider.ts`.
2. Copy the full implementation from design.md Component 5.
3. Ensure the cross-reference comment at the top of `chat()`:
   ```typescript
   // NOTE: This method is structurally mirrored from DeepSeekProvider.chat().
   // Bugfixes applied to one MUST be applied to the other.
   // See: src/providers/deepseek-provider.ts
   ```
4. Also open `src/providers/deepseek-provider.ts` and add a similar cross-reference comment at the top of its `chat()` method:
   ```typescript
   // NOTE: This method is structurally mirrored from OpenAIProvider.chat().
   // Bugfixes applied to one MUST be applied to the other.
   // See: src/providers/openai-provider.ts
   ```
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] File `src/providers/openai-provider.ts` exists.
- [ ] `OpenAIProvider` exports and TypeScript verifies it implements `ILlmProvider`.
- [ ] Cross-reference comments exist in both provider files.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 6: Add `getCheapModel` to `DeepSeekProvider`

**Objective:** Implement `getCheapModel` on the existing `DeepSeekProvider` class.

**Requirements Covered:** FR-005

**Design References:** Component 7 in design.md.

**Actions:**
1. Open `src/providers/deepseek-provider.ts`.
2. Add method after `isMultimodal`:
   ```typescript
   getCheapModel(model: string): string | null {
     if (model === "deepseek-v4-pro") return "deepseek-v4-flash";
     if (model === "deepseek-v4-flash") return null;
     if (model.includes("pro")) return model.replace("pro", "flash");
     return null;
   }
   ```
3. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `new DeepSeekProvider(...).getCheapModel("deepseek-v4-pro")` returns `"deepseek-v4-flash"`.
- [ ] `new DeepSeekProvider(...).getCheapModel("deepseek-v4-flash")` returns `null`.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 7: Update provider registry for model routing

**Objective:** Route model names to `OpenAIProvider` or `DeepSeekProvider` based on prefix.

**Requirements Covered:** FR-003

**Design References:** Component 8 in design.md.

**Actions:**
1. Open `src/common/llm-provider-registry.ts`.
2. Add import:
   ```typescript
   import { OpenAIProvider } from "../providers/openai-provider";
   ```
3. Add constant and helper after imports:
   ```typescript
   const OPENAI_MODEL_PREFIXES = ["gpt-", "o1", "o3", "o4", "openai-"];

   function isOpenAIModel(model: string): boolean {
     const lower = model.toLowerCase();
     return OPENAI_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
   }
   ```
4. Replace the body of `createLlmProvider` with the implementation from design.md Component 8:
   - Determine `engineName` from model prefix.
   - Create `createClient` factory with `engineName`.
   - Check `settings.apiKey` (global fallback) — return null provider if missing.
   - If `engineName === "openai"`: create `OpenAIProvider` with engine-aware client.
   - Else: create `DeepSeekProvider` (backward compatible default).
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `createLlmProvider()` with model `"gpt-5.4"` creates `OpenAIProvider`.
- [ ] `createLlmProvider()` with model `"deepseek-v4-pro"` creates `DeepSeekProvider`.
- [ ] `createLlmProvider()` with unknown model creates `DeepSeekProvider`.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 8: Update `compactSession` to use `getCheapModel`

**Objective:** Replace hardcoded compaction model logic with `provider.getCheapModel()`.

**Requirements Covered:** FR-005

**Design References:** Component 9 in design.md.

**Actions:**
1. Open `src/session.ts`.
2. Locate `compactSession` method.
3. Find the compaction model resolution block (search for `resolvedModel.includes("pro")`).
4. Replace with:
   ```typescript
   const { provider } = this.createLlmProvider();
   const resolvedModel = (this.createOpenAIClient()).model;
   const compactionModel = provider?.getCheapModel?.(resolvedModel) ?? resolvedModel;
   ```
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] Compaction model logic no longer contains `"pro"` or `"flash"` string matching.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 9: Add OpenAI pricing to `DEFAULT_MODEL_PRICING`

**Objective:** Add default pricing entries for OpenAI models so budget tracking works.

**Requirements Covered:** FR-007

**Design References:** Component 10 in design.md.

**Actions:**
1. Open `src/common/model-capabilities.ts`.
2. Locate `DEFAULT_MODEL_PRICING` record.
3. Add entries after the DeepSeek entries:
   ```typescript
   "gpt-5.4":       { inputPrice: 1.25, outputPrice: 10.00, cacheReadPrice: 0.625 },
   "gpt-5.4-mini":  { inputPrice: 0.15, outputPrice: 0.60, cacheReadPrice: 0.075 },
   ```
4. **IMPORTANT — Verify prices:** Before committing, check the official OpenAI pricing page at `https://openai.com/api/pricing/` for correct GPT-5.4 family prices. Update the values above to match official pricing. If GPT-5.4 prices cannot be verified, use these conservative estimates and note the uncertainty in the commit message.
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `DEFAULT_MODEL_PRICING["gpt-5.4"]` exists with valid `ModelPricing` shape.
- [ ] Prices verified against official OpenAI pricing page, or noted as estimates.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 10: Create `openai-provider.test.ts`

**Objective:** Create comprehensive tests for the `OpenAIProvider` class.

**Requirements Covered:** FR-002 (validation), NFR-004

**Design References:** Testing Strategy section in design.md (openai-provider.test.ts).

**Actions:**
1. Create file `src/tests/openai-provider.test.ts`.
2. Import `OpenAIProvider` from `../providers/openai-provider`.
3. Import `ILlmProvider`, `LlmStreamEvent` from `../common/llm-provider`.
4. Import `CreateOpenAIClient` from `../tools/executor`.
5. Add these tests (minimum 14):
   - `supportsModel returns true for OpenAI model names` — test `gpt-5.4`, `o1`, `o3-mini`, `openai-custom-model`.
   - `supportsModel returns false for non-OpenAI model names` — test `deepseek-v4-pro`, `claude-sonnet`.
   - `getTimeoutMs returns 300_000 for reasoning models` — test `gpt-5.4`, `o1`, `o3`, `o4`.
   - `getTimeoutMs returns 180_000 for non-reasoning models` — test `gpt-5.4-mini`.
   - `isMultimodal returns false for non-multimodal models` — test `o1-mini`, `o3-mini`.
   - `isMultimodal returns true for multimodal models` — test `gpt-5.4`.
   - `getCheapModel returns gpt-5.4-mini for gpt-5.4` and `returns null for gpt-5.4-mini`.
   - `getCheapModel returns o3-mini for o3` and `null for o1-mini`.
   - `chat yields text_delta events` — mock OpenAI client, verify text streaming.
   - `chat yields reasoning_delta events` — mock reasoning content.
   - `chat yields tool_call_start and tool_call_delta events` — mock tool call streaming.
   - `chat yields usage event` — mock usage chunk.
   - `chat respects abort signal` — verify `AbortSignal.any` composition.
   - `chat throws when API key is missing` — mock client returning null.
   - `chat passes "openai" to buildThinkingRequestOptions` — verify via request body inspection.
6. Run `npm test -- --grep openai-provider` to verify new tests pass.

**Validation:**
- [ ] File `src/tests/openai-provider.test.ts` exists with at least 14 tests.
- [ ] All new tests pass.

**Status:** [x] done

---

### Task 11: Add OpenAI format tests to `openai-thinking.test.ts`

**Objective:** Add tests for the new `providerName: "openai"` behavior of `buildThinkingRequestOptions`.

**Requirements Covered:** FR-004 (validation)

**Design References:** Testing Strategy section in design.md (openai-thinking.test.ts).

**Actions:**
1. Open `src/tests/openai-thinking.test.ts`.
2. Add these 4 tests (do NOT remove or modify existing tests):
   - `returns OpenAI format with reasoning_effort when providerName is "openai" and thinking enabled` — verify `buildThinkingRequestOptions(true, undefined, "high", "openai")` returns `{ reasoning_effort: "high" }`.
   - `returns empty object for OpenAI when thinking disabled` — verify `buildThinkingRequestOptions(false, undefined, undefined, "openai")` returns `{}`.
   - `returns OpenAI format with "max" effort` — verify `buildThinkingRequestOptions(true, undefined, "max", "openai")` returns `{ reasoning_effort: "max" }`.
   - `returns DeepSeek format when providerName is not specified` — verify existing behavior preserved: `buildThinkingRequestOptions(true, undefined, "max")` returns `{ thinking: { type: "enabled" }, extra_body: { reasoning_effort: "max" } }`.
3. Run `npm test -- --grep openai-thinking` to verify all tests pass.

**Validation:**
- [ ] 4 new tests exist in `openai-thinking.test.ts`.
- [ ] All existing and new tests pass.

**Status:** [x] done

---

### Task 12: Create `llm-provider-registry.test.ts`

**Objective:** Test the provider registry routing logic.

**Requirements Covered:** FR-003 (validation)

**Design References:** Testing Strategy section in design.md (llm-provider-registry.test.ts).

**Actions:**
1. Create file `src/tests/llm-provider-registry.test.ts`.
2. Import `createLlmProvider` from `../common/llm-provider-registry`.
3. Import `DeepSeekProvider` from `../providers/deepseek-provider`.
4. Import `OpenAIProvider` from `../providers/openai-provider`.
5. Add these tests (minimum 4):
   - `createLlmProvider with gpt-5.4 model creates OpenAIProvider` — mock settings with model `"gpt-5.4"` and valid API key; verify result.provider is instance of OpenAIProvider.
   - `createLlmProvider with deepseek-v4-pro model creates DeepSeekProvider` — mock settings with model `"deepseek-v4-pro"`; verify result.provider is instance of DeepSeekProvider.
   - `createLlmProvider with unknown model creates DeepSeekProvider` — mock settings with model `"some-unknown-model"`; verify result.provider is instance of DeepSeekProvider.
   - `createLlmProvider with OpenAI model and missing key returns null provider` — mock settings with model `"gpt-5.4"` but no API key configured; verify `result.provider` is `null`.
6. Run `npm test -- --grep llm-provider-registry` to verify new tests pass.

**Validation:**
- [ ] File `src/tests/llm-provider-registry.test.ts` exists with at least 4 tests.
- [ ] All new tests pass.

**Status:** [x] done

---

### Task 13: Add `engines` settings tests

**Objective:** Add tests for the new `engines` configuration behavior.

**Requirements Covered:** FR-001, FR-009 (validation)

**Design References:** Testing Strategy section in design.md (settings.test.ts).

**Actions:**
1. Open `src/tests/settings-and-notify.test.ts` (or the primary settings test file).
2. Add these tests (minimum 3):
   - `engines field resolves from project settings` — set `engines.openai.apiKey` in project settings; verify `resolveCurrentSettings().engines.openai.apiKey` matches.
   - `DEEPCODE_ENGINE_OPENAI_API_KEY populates engines.openai.apiKey` — set env var; verify it appears in resolved engines.
   - `Engine-specific API key overrides global API_KEY` — set both global API_KEY and engine-specific key; verify engine-specific key is used when engineName is passed.
3. Run `npm test -- --grep settings` to verify tests pass.

**Validation:**
- [ ] 3 new settings tests exist.
- [ ] All existing and new tests pass.

**Status:** [x] done

---

### Task 14: Run full validation suite

**Objective:** Verify the complete change set compiles, lints, formats, and passes all tests.

**Requirements Covered:** NFR-001, NFR-002, NFR-003

**Actions:**
1. Run `npm run typecheck` — must pass with zero errors.
2. Run `npm run lint` — must pass with zero new warnings.
3. Run `npm run format:check` — must show no unformatted files.
4. Run `npm test` — must pass with zero failures.
5. Run `npm run build` — must produce `dist/cli.js` without errors.
6. Verify `package.json` has zero changes (`git diff HEAD -- package.json`).
7. Verify `package-lock.json` has zero changes.
8. Run `git diff --stat` to review all changed files — confirm only expected files are modified.

**Validation:**
- [ ] All 4 commands return exit code 0.
- [ ] `package.json` unchanged.
- [ ] `package-lock.json` unchanged.
- [ ] Only expected files modified:
  - `src/common/settings-schema.ts`
  - `src/settings.ts`
  - `src/common/openai-client.ts`
  - `src/common/openai-thinking.ts`
  - `src/common/llm-provider.ts`
  - `src/common/llm-provider-registry.ts`
  - `src/common/model-capabilities.ts`
  - `src/providers/deepseek-provider.ts`
  - `src/providers/openai-provider.ts` (NEW)
  - `src/session.ts`
  - Test files: `session.test.ts`, `openai-thinking.test.ts`, `settings-and-notify.test.ts`, `openai-provider.test.ts` (NEW), `llm-provider-registry.test.ts` (NEW)

**Status:** [x] done

---

### Task 15: Update roadmap status

**Objective:** Update roadmap status for spec 40 if needed.

**Requirements Covered:** N/A (process)

**Actions:**
1. Open `management/roadmap.md`.
2. Find the row for spec 40.
3. If status is `planned`, change to `created`.
4. If status is already `created` or `verified`, confirm and skip (no change needed).

**Validation:**
- [ ] Roadmap shows `created` or `verified` for spec 40.

**Status:** [x] done
