# Spec 70: google-gemini-provider — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

---

## Tasks

### Task 1: Create `GeminiMessageConverter` with tool conversion

**Objective:** Create the message converter class that transforms `SessionMessage[]` to Gemini `Content[]` arrays, plus the `convertToolsToGemini` function.

**Requirements Covered:** FR-001, FR-004

**Design References:** Component 1, Component 2 in design.md.

**Actions:**
1. Create file `src/common/gemini-message-converter.ts`.
2. Add imports:
   ```typescript
   import type { SessionMessage } from "../session";
   import type { ToolDefinition } from "../prompt";
   import { isMultimodalModel } from "./model-capabilities";
   ```
3. Define Gemini types (inline — no SDK):
   ```typescript
   export type GeminiContent = {
     role: "user" | "model" | "tool";
     parts: GeminiPart[];
   };

   export type GeminiPart =
     | { text: string }
     | { thought: string }
     | { functionCall: { name: string; args: Record<string, unknown> } }
     | { functionResponse: { name: string; response: Record<string, unknown> } }
     | { inlineData: { mimeType: string; data: string } };

   export type GeminiSystemInstruction = {
     parts: Array<{ text: string }>;
   };

   export type GeminiTool = {
     functionDeclarations: Array<{
       name: string;
       description: string;
       parameters: Record<string, unknown>;
     }>;
   };
   ```
4. Implement and export `convertToolsToGemini` function:
   ```typescript
   export function convertToolsToGemini(tools: ToolDefinition[]): GeminiTool[] {
     if (tools.length === 0) return [];
     return [{
       functionDeclarations: tools.map((tool) => ({
         name: tool.function.name,
         description: tool.function.description,
         parameters: tool.function.parameters as Record<string, unknown>,
       })),
     }];
   }
   ```
5. Implement `GeminiMessageConverter` class with:
   - `private systemInstructionParts: Array<{ text: string }> = []`
   - `buildMessages(messages, thinkingEnabled, model): GeminiContent[]`
     - Create new converter instance per call (no state leakage).
     - Filter compacted messages.
     - Pair tool calls using `pairToolMessages()` (copy algorithm from `OpenAIMessageConverter.pairToolMessages()` — ~50 lines, Map-based O(n) algorithm).
     - Convert each message via `convertMessage()`.
     - Return `GeminiContent[]` (does NOT include system messages).
   - `private convertMessage(message, thinkingEnabled, model, index, toolPairings, messages): GeminiContent | null`
     - `system` role: accumulate text to `systemInstructionParts`, return null.
     - `user` role: build parts array with text + images (inlineData).
     - `assistant` role: build parts array with thought (if reasoning_content) + text + functionCall(s).
     - `tool` role: build `{ role: "tool", parts: [{ functionResponse: {...} }] }` — resolve tool name by cross-referencing paired assistant message's tool_calls.
   - `getSystemInstruction(): GeminiSystemInstruction | null` — returns `{ parts: this.systemInstructionParts }` or `null` if empty.
   - `private pairToolMessages(messages)` — copied from OpenAIMessageConverter.
   - `private findPairableToolMessageIndex(...)` — copied.
   - `private getAssistantToolCalls(...)` — copied.
   - `private getToolCallId(...)` — copied.
   - `private getToolMessageCallId(...)` — copied.
   - `private buildToolPairingKey(...)` — copied.
   - `private isInterruptedToolMessage(...)` — copied.
   - `private buildInterruptedGeminiFunctionResponse(...)` — adapted for `functionResponse` format.
   - `private findToolFunction(...)` — copied.
   - `private buildInterruptedToolResult(...)` — copied (same JSON format).
6. Image conversion helper: parse `contentParams` images → extract MIME type and base64 → `{ inlineData: { mimeType, data } }`.
7. Run `npm run typecheck` — must pass.
8. Run `npm test` — all existing tests must pass (new converter is not yet imported anywhere).

**Validation:**
- [ ] `src/common/gemini-message-converter.ts` exists.
- [ ] `convertToolsToGemini` function exported.
- [ ] `GeminiMessageConverter` class exported.
- [ ] All Gemini types exported.
- [ ] `buildMessages` returns `GeminiContent[]`.
- [ ] `getSystemInstruction` returns correct shape or null.
- [ ] Tool pairing logic matches `OpenAIMessageConverter` behavior.
- [ ] Interrupted tool fallback works with `functionResponse` format.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 2: Create `createGeminiClient` factory

**Objective:** Create the Gemini client factory that resolves credentials and returns configuration.

**Requirements Covered:** FR-002, FR-009

**Design References:** Component 3 in design.md.

**Actions:**
1. Create file `src/common/gemini-client.ts`.
2. Add imports:
   ```typescript
   import { resolveCurrentSettings } from "../settings";
   ```
3. Define and export the `GeminiClientConfig` type with all fields: `apiKey`, `baseURL`, `model`, `thinkingEnabled`, `debugLogEnabled`, `telemetryEnabled`, `maxTokens`, `notify?`, `env`.
4. Define constant: `const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"`.
5. Implement `createGeminiClient(projectRoot?, engineName?): GeminiClientConfig`:
   - Read settings via `resolveCurrentSettings(projectRoot)`.
   - Default `engineName` to `"gemini"`.
   - Resolve `apiKey`: `engines[engineName].apiKey` → `settings.apiKey`.
   - Resolve `baseURL`: `engines[engineName].baseURL` → `GEMINI_DEFAULT_BASE_URL` → `settings.baseURL`.
   - Return config object with resolved values.
   - `apiKey` is `null` when not available (not `undefined`).
6. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `src/common/gemini-client.ts` exists.
- [ ] `GeminiClientConfig` type exported.
- [ ] `createGeminiClient(projectRoot, "gemini")` returns config with API key when configured.
- [ ] `createGeminiClient(projectRoot, "gemini")` returns `apiKey: null` when no key.
- [ ] Base URL defaults to `https://generativelanguage.googleapis.com/v1beta`.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 3: Create `GeminiProvider` class

**Objective:** Create the Gemini provider implementing `ILlmProvider` with raw fetch and SSE parsing.

**Requirements Covered:** FR-003, FR-005, FR-006

**Design References:** Component 4 in design.md.

**Actions:**
1. Create file `src/providers/gemini-provider.ts`.
2. Add imports:
   ```typescript
   import {
     GeminiMessageConverter,
     convertToolsToGemini,
   } from "../common/gemini-message-converter";
   import type {
     GeminiContent,
     GeminiSystemInstruction,
     GeminiTool,
   } from "../common/gemini-message-converter";
   import { DEFAULT_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
   import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
   import type { ModelUsage } from "../session";
   import { withRetry } from "../common/api-retry";
   import { createGeminiClient } from "../common/gemini-client";
   ```
3. Define constants:
   ```typescript
   const GEMINI_MODEL_PREFIX = "gemini-";
   const GEMINI_PRO_MODEL_PATTERN = /^gemini-2\.5-pro/;
   ```
4. Implement `GeminiProvider` class with:
   - `readonly providerName = "gemini"`.
   - `constructor()` — no parameters, no fields.
   - `supportsModel(model)` — lowercase starts with `"gemini-"`.
   - `getTimeoutMs(model)` — 300000 for Pro, 180000 for others.
   - `isMultimodal(_model)` — always `true`.
   - `getCheapModel(model)` — full switch/case as specified in FR-010.
   - `async *chat(options)` — full implementation:
     a. `createGeminiClient(process.cwd(), "gemini")` → check `apiKey` null → throw `Error("Gemini API key not configured")`.
     b. Extract `thinkingEnabled` from `providerOptions`.
     c. Create `new GeminiMessageConverter()` per call (no field, no state leakage).
     d. `converter.buildMessages(options.messages, thinkingEnabled, options.model)`.
     e. `converter.getSystemInstruction()`.
     f. `convertToolsToGemini(options.tools ?? [])` or `undefined`.
     g. Build request body: `contents`, `systemInstruction` (if non-null), `tools` (if non-empty), `generationConfig`.
     h. In `generationConfig`: `thinkingConfig` when enabled, `temperature` when set and thinking disabled, `maxOutputTokens` when >0.
     i. Remove empty `generationConfig` from body if no keys were set.
     j. Build URL: `${config.baseURL}/models/${options.model}:streamGenerateContent?alt=sse`.
     k. `withRetry(() => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey }, body: JSON.stringify(requestBody), signal }))`.
     l. Check `resp.ok` → throw with status and body if not.
     m. Check `resp.body` → throw if null.
     n. `yield* this.streamToEvents(resp.body, options.signal)`.
   - `private async *streamToEvents(body, signal)` — full implementation:
     a. `body.getReader()` + `TextDecoder`.
     b. Loop: `reader.read()` → check `signal?.aborted` → decode chunk → split `\n` → process complete lines.
     c. For each line: check `data: ` prefix → trim → skip empty/`[DONE]` → `JSON.parse`.
     d. Check `promptFeedback.blockReason` → yield `error`, return.
     e. Check `candidates[0].finishReason === "SAFETY"` → yield `error`, return.
     f. Extract `candidates[0].content.parts[]`.
     g. For each part:
        - `text` → yield `text_delta`.
        - `thought` → diff against accumulated, yield `reasoning_delta`.
        - `functionCall.name` (new) → generate `gemini-tc-<uuid>` ID, yield `tool_call_start`.
        - `functionCall.args` (changed) → diff JSON string, yield `tool_call_delta`.
     h. Extract `usageMetadata` → yield `usage` with `ModelUsage` shape.
     i. Catch errors → yield `error`, throw.
     j. Finally: `reader.releaseLock()`.
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `src/providers/gemini-provider.ts` exists.
- [ ] `GeminiProvider` implements `ILlmProvider` (TypeScript verifiable).
- [ ] `supportsModel("gemini-3.5-flash")` → `true`.
- [ ] `supportsModel("deepseek-v4-pro")` → `false`.
- [ ] `getCheapModel("gemini-3.5-flash")` → `"gemini-3.1-flash-lite"`.
- [ ] `getCheapModel("gemini-3.1-flash-lite")` → `null`.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 4: Add Gemini pricing to `DEFAULT_MODEL_PRICING`

**Objective:** Add pricing entries for Gemini models.

**Requirements Covered:** FR-008 (pricing portion)

**Design References:** Component 6 in design.md.

**Actions:**
1. Open `src/common/model-capabilities.ts`.
2. Locate `DEFAULT_MODEL_PRICING` record.
3. Add five entries at the end of the record:
   ```typescript
   "gemini-3.5-flash":      { inputPrice: 1.50, outputPrice: 9.00, cacheReadPrice: 0.15 },
   "gemini-3-flash":        { inputPrice: 1.00, outputPrice: 6.00, cacheReadPrice: 0.10 },
   "gemini-3.1-flash-lite": { inputPrice: 0.25, outputPrice: 1.50, cacheReadPrice: 0.025 },
   "gemini-2.5-pro":        { inputPrice: 2.50, outputPrice: 15.00, cacheReadPrice: 0.25 },
   "gemini-2.5-flash":      { inputPrice: 0.50, outputPrice: 3.00, cacheReadPrice: 0.05 },
   ```
4. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `DEFAULT_MODEL_PRICING["gemini-3.5-flash"]` exists with `{ inputPrice: 1.50, outputPrice: 9.00, ... }`.
- [ ] All five Gemini entries added.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 5: Add Gemini entries to `MODEL_CATALOG` and extend provider type

**Objective:** Add model catalog entries for Gemini models and extend the `ModelEntry.provider` type.

**Requirements Covered:** FR-008 (catalog portion)

**Design References:** Component 7 in design.md.

**Actions:**
1. Open `src/common/model-catalog.ts`.
2. Extend `ModelEntry.provider` type from `"deepseek" | "openai" | "anthropic"` to `"deepseek" | "openai" | "anthropic" | "gemini"`.
3. Add five entries to `MODEL_CATALOG` array:
   ```typescript
   {
     id: "gemini-3.5-flash",
     provider: "gemini",
     displayName: "Gemini 3.5 Flash",
     reasoning: { type: "adaptive", defaultEffort: "high" },
     contextWindow: 1_000_000,
     maxOutput: 65_536,
     multimodal: true,
     isDefault: false,
   },
   {
     id: "gemini-3-flash",
     provider: "gemini",
     displayName: "Gemini 3 Flash",
     reasoning: { type: "adaptive", defaultEffort: "high" },
     contextWindow: 1_000_000,
     maxOutput: 65_536,
     multimodal: true,
     isDefault: false,
   },
   {
     id: "gemini-3.1-flash-lite",
     provider: "gemini",
     displayName: "Gemini 3.1 Flash-Lite",
     reasoning: { type: "none", defaultEffort: "high" },
     contextWindow: 1_000_000,
     maxOutput: 65_536,
     multimodal: true,
     isDefault: false,
   },
   {
     id: "gemini-2.5-pro",
     provider: "gemini",
     displayName: "Gemini 2.5 Pro",
     reasoning: { type: "adaptive", defaultEffort: "high" },
     contextWindow: 1_000_000,
     maxOutput: 65_536,
     multimodal: true,
     isDefault: false,
   },
   {
     id: "gemini-2.5-flash",
     provider: "gemini",
     displayName: "Gemini 2.5 Flash",
     reasoning: { type: "adaptive", defaultEffort: "high" },
     contextWindow: 1_000_000,
     maxOutput: 65_536,
     multimodal: true,
     isDefault: false,
   },
   ```
4. Run `npm run typecheck` — must pass. NOTE: extending the `provider` union type may cause exhaustiveness checks in `switch` statements to flag missing `"gemini"` case. Fix any such errors by adding `case "gemini":` with appropriate handling.

**Validation:**
- [ ] `MODEL_CATALOG` includes 5 Gemini entries.
- [ ] `ModelEntry.provider` type includes `"gemini"`.
- [ ] `getModelCapabilities("gemini-3.5-flash")` returns complete object with pricing.
- [ ] No typecheck errors from exhaustiveness checks — all `switch` statements on `provider` handle `"gemini"`.

**Status:** [x] done

---

### Task 6: Update provider registry for Gemini routing

**Objective:** Route `gemini-` prefixed model names to `GeminiProvider`.

**Requirements Covered:** FR-007

**Design References:** Component 5 in design.md.

**Actions:**
1. Open `src/common/llm-provider-registry.ts`.
2. Add import:
   ```typescript
   import { GeminiProvider } from "../providers/gemini-provider";
   ```
3. Add helper after existing `isAnthropicModel`:
   ```typescript
   function isGeminiModel(model: string): boolean {
     return model.toLowerCase().startsWith("gemini-");
   }
   ```
4. In `createLlmProvider`, update `engineName` resolution:
   ```typescript
   const engineName =
     isOpenAIModel(settings.model) ? "openai"
     : isAnthropicModel(settings.model) ? "anthropic"
     : isGeminiModel(settings.model) ? "gemini"
     : undefined;
   ```
5. Add Gemini routing branch after the Anthropic branch and before the DeepSeek default:
   ```typescript
   if (isGeminiModel(settings.model)) {
     const provider = new GeminiProvider();
     return { provider, createOpenAIClient: createClient };
   }
   ```
6. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `createLlmProvider()` with model `"gemini-3.5-flash"` creates `GeminiProvider`.
- [ ] `createLlmProvider()` with model `"deepseek-v4-pro"` still creates `DeepSeekProvider` (no regression).
- [ ] `createLlmProvider()` with model `"claude-sonnet-4-6"` still creates `AnthropicProvider` (no regression).
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 7: Create `gemini-message-converter.test.ts`

**Objective:** Test the Gemini message converter and tool conversion function.

**Requirements Covered:** FR-001, FR-004 (validation), NFR-003

**Design References:** Testing Strategy section in design.md (gemini-message-converter.test.ts).

**Actions:**
1. Create file `src/tests/gemini-message-converter.test.ts`.
2. Import test infrastructure and `GeminiMessageConverter`, `convertToolsToGemini`.
3. Add these tests (minimum 15):
   - `convertToolsToGemini converts OpenAI format to Gemini format` — verify `function.name → name`, `function.description → description`, `function.parameters → parameters`.
   - `convertToolsToGemini groups all tools into single functionDeclarations` — verify output is `[{ functionDeclarations: [...] }]`.
   - `convertToolsToGemini handles empty array` — returns `[]`.
   - `convertToolsToGemini handles multiple tools` — all in one `functionDeclarations` array.
   - `buildMessages extracts system messages to getSystemInstruction()` — verify system messages NOT in `contents`, `getSystemInstruction()` returns `{ parts: [{ text: "..." }] }`.
   - `getSystemInstruction returns null when no system messages` — verify.
   - `buildMessages concatenates multiple system messages` — each system message becomes a separate `{ text: "..." }` part in `systemInstructionParts`.
   - `buildMessages converts user message to parts` — verify `{ role: "user", parts: [{ text: "..." }] }`.
   - `buildMessages converts assistant message with text` — verify `{ role: "model", parts: [{ text: "..." }] }`.
   - `buildMessages converts assistant message with tool calls` — verify `functionCall` parts with correct name and args.
   - `buildMessages converts assistant message with thinking` — verify `thought` part before `text` part when `thinkingEnabled` is true.
   - `buildMessages converts tool results to functionResponse` — verify `{ role: "tool", parts: [{ functionResponse: { name, response: { content } } }] }`.
   - `buildMessages injects interrupted tool results` — unpaired tool calls get fallback `functionResponse` with error JSON.
   - `buildMessages filters compacted messages` — compacted messages excluded from output.
   - `buildMessages filters images for non-multimodal model` — `inlineData` parts removed.
4. Run `npm test -- --grep gemini-message-converter` to verify.

**Validation:**
- [ ] File exists with at least 15 tests.
- [ ] All new tests pass.
- [ ] Existing tests still pass.

**Status:** [x] done

---

### Task 8: Create `gemini-provider.test.ts`

**Objective:** Test the GeminiProvider class with mocked `fetch()`.

**Requirements Covered:** FR-003, FR-005, FR-006, FR-010 (validation), NFR-003, NFR-004

**Design References:** Testing Strategy section in design.md (gemini-provider.test.ts).

**Actions:**
1. Create file `src/tests/gemini-provider.test.ts`.
2. Import `GeminiProvider`, `ILlmProvider`, `LlmStreamEvent`.
3. Mock `global.fetch` to return controlled `ReadableStream` responses.
4. Add these tests (minimum 24):
   - `supportsModel returns true for gemini- prefixes` — test `gemini-3.5-flash`, `gemini-2.5-pro`, `gemini-3.1-flash-lite`.
   - `supportsModel returns false for non-gemini models` — test `gpt-5.4`, `deepseek-v4-pro`, `claude-sonnet-4-6`.
   - `getTimeoutMs returns 300_000 for gemini-2.5-pro` — Pro model.
   - `getTimeoutMs returns 180_000 for gemini-3.5-flash` — non-Pro model.
   - `isMultimodal returns true for all models`.
   - `getCheapModel returns flash-lite for 3.5-flash`.
   - `getCheapModel returns flash for 2.5-pro`.
   - `getCheapModel returns flash-lite for 2.5-flash`.
   - `getCheapModel returns null for flash-lite`.
   - `getCheapModel heuristic returns flash-lite for unknown gemini- model`.
   - `chat yields text_delta events` — mock SSE with text parts.
   - `chat yields reasoning_delta events from thought parts` — mock SSE with thought parts.
   - `chat yields tool_call_start with generated UUID` — mock SSE with functionCall.name.
   - `chat yields tool_call_delta with incremental args` — mock SSE with functionCall.args.
   - `chat yields usage event from usageMetadata` — mock SSE with usageMetadata.
   - `chat throws when API key missing` — mock `createGeminiClient` → `apiKey: null`.
   - `chat throws on HTTP error status` — mock `fetch` returning HTTP 503.
   - `chat yields error on promptFeedback.blockReason` — mock blockReason in response.
   - `chat yields error on SAFETY finishReason` — mock finishReason: "SAFETY".
   - `chat handles empty candidates array` — no yield, continues.
   - `chat handles multiple function calls in one turn` — both tool_call_start events yielded with different IDs.
   - `chat handles missing usageMetadata in final chunk` — yields usage with 0 tokens.
   - `SSE parser handles partial lines` — buffer and reassemble split `data:` lines.
   - `SSE parser skips malformed JSON` — warn and continue, stream not broken.
5. Run `npm test -- --grep gemini-provider` to verify.

**Validation:**
- [ ] File exists with at least 24 tests.
- [ ] All new tests pass.
- [ ] All tests use mock fetch — no real API calls.
- [ ] Existing tests still pass.

**Status:** [x] done

---

### Task 9: Run full validation suite

**Objective:** Verify the complete change set compiles, lints, formats, and passes all tests.

**Requirements Covered:** NFR-001, NFR-002, NFR-003, FR-012

**Actions:**
1. Run `npm run typecheck` — must pass with zero errors.
2. Run `npm run lint` — must pass with zero new warnings.
3. Run `npm run format:check` — must show no unformatted files.
4. Run `npm test` — must pass with zero failures.
5. Run `npm run build` — must produce `dist/cli.js` without errors.
6. Run `git diff --stat` to review all changed files — confirm only expected files are modified.
7. Confirm ZERO changes to:
   - `package.json`
   - `package-lock.json`
   - `session.ts`
   - `api-retry.ts`
   - `settings.ts`
   - All existing provider files (deepseek, openai, anthropic, base-openai)

**Validation:**
- [ ] All 5 commands return exit code 0.
- [ ] `package.json` and `package-lock.json` unchanged.
- [ ] Only expected files modified/created:
  - `src/common/gemini-message-converter.ts` (NEW)
  - `src/common/gemini-client.ts` (NEW)
  - `src/providers/gemini-provider.ts` (NEW)
  - `src/tests/gemini-message-converter.test.ts` (NEW)
  - `src/tests/gemini-provider.test.ts` (NEW)
  - `src/common/model-capabilities.ts` (MODIFY — 5 pricing entries)
  - `src/common/model-catalog.ts` (MODIFY — 5 catalog entries + provider type)
  - `src/common/llm-provider-registry.ts` (MODIFY — Gemini routing)

**Status:** [x] done

---

### Task 10: Update roadmap status

**Objective:** Update roadmap status for spec 70 from `created` to `done` (or `verified` as appropriate for the project's status system).

**Actions:**
1. Open `management/roadmap.md`.
2. Find the row for spec 70.
3. Verify current status is `created`. If so, mark implementation complete and update to `done`.
4. If status is already `verified` or `done`, confirm and skip (no change needed).

**Validation:**
- [ ] Roadmap shows `done` or `verified` for spec 70.

**Status:** [x] done
