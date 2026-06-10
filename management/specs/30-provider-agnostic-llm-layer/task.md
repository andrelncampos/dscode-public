# Spec 30: provider-agnostic-llm-layer — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

---

## Tasks

### Task 1: Create `ILlmProvider` interface and types

**Objective:** Create the core interface and type definitions that all providers implement.

**Requirements Covered:** FR-001, FR-002, FR-003

**Design References:** Component 1 in design.md — exact interface and types specified.

**Actions:**
1. Create file `src/common/llm-provider.ts`.
2. Import `SessionMessage`, `ModelUsage` from `../session`.
3. Import `ToolDefinition` from `../prompt`.
4. Define `LlmStreamEvent` discriminated union with 6 variants exactly as in design.md Component 1.
5. Define `LlmChatOptions` type exactly as in design.md Component 1.
6. Define `ILlmProvider` interface with exactly 5 members as in design.md Component 1.

**Validation:**
- [ ] `npm run typecheck` passes (types compile).
- [ ] File `src/common/llm-provider.ts` exists with correct exports.

**Status:** [x] done

---

### Task 2: Clean up `api-timeout.ts`

**Objective:** Remove model-specific timeout logic from shared utility. Constants stay for provider use.

**Requirements Covered:** FR-007

**Design References:** Component 5 in design.md.

**Actions:**
1. Open `src/common/api-timeout.ts`.
2. Remove lines 37-43 (the `if (model)` block checking `"deepseek-v4-pro"` and `"deepseek-v4-flash"`).
3. The function `resolveApiTimeoutMs()` now: parses env var → returns parsed value or DEFAULT_API_TIMEOUT_MS.
4. Keep all 4 exported constants (`DEFAULT_API_TIMEOUT_MS`, `FLASH_API_TIMEOUT_MS`, `PRO_API_TIMEOUT_MS`, `MIN_API_TIMEOUT_MS`).

**Existing code to remove (lines 37-43):**
```typescript
  if (model) {
    if (model === "deepseek-v4-pro") {
      return PRO_API_TIMEOUT_MS;
    }
    if (model === "deepseek-v4-flash") {
      return FLASH_API_TIMEOUT_MS;
    }
  }
```

**Validation:**
- [ ] `resolveApiTimeoutMs()` no longer references `"deepseek-v4-pro"` or `"deepseek-v4-flash"`.
- [ ] `resolveApiTimeoutMs("deepseek-v4-pro")` returns `180_000` (DEFAULT, not 300_000).
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 3: Clean up `model-capabilities.ts`

**Objective:** Remove `DEEPSEEK_V4_MODELS` export. Everything else stays.

**Requirements Covered:** FR-008

**Design References:** Component 6 in design.md.

**Actions:**
1. Open `src/common/model-capabilities.ts`.
2. Remove the `export` keyword from `DEEPSEEK_V4_MODELS` declaration (line 5), making it private.
3. If `DEEPSEEK_V4_MODELS` is no longer used locally, remove the entire line.
4. Verify no other file imports `DEEPSEEK_V4_MODELS` from this module.

**Validation:**
- [ ] `npm run typecheck` passes.
- [ ] `grep -r "DEEPSEEK_V4_MODELS" src/ --include="*.ts"` shows zero results outside `model-capabilities.ts` (and possibly `deepseek-provider.ts` if added later).

**Status:** [x] done

---

### Task 4: Create `DeepSeekProvider` class

**Objective:** Create the DeepSeek provider implementing `ILlmProvider`, assembling existing logic.

**Requirements Covered:** FR-004

**Design References:** Component 2 in design.md — exact constructor, methods, and chat() logic.

**Actions:**
1. Create directory `src/providers/`.
2. Create file `src/providers/deepseek-provider.ts`.
3. Import required dependencies:
   - `createOpenAIClient`, `CreateOpenAIClient` from `../common/openai-client`
   - `OpenAIMessageConverter`, `OpenAIMessageConverterOptions` from `../common/openai-message-converter`
   - `buildThinkingRequestOptions` from `../common/openai-thinking`
   - `ILlmProvider`, `LlmStreamEvent`, `LlmChatOptions` from `../common/llm-provider`
   - `ModelUsage`, `SessionMessage` from `../session`
   - `ChatCompletionMessageParam` from `openai/resources/chat/completions`
   - Timeout constants from `../common/api-timeout`
4. Define private constant `DEEPSEEK_MODEL_PREFIX = "deepseek-"`.
5. Define private constant `NON_MULTIMODAL_DEEPSEEK_MODELS` with `["deepseek-v4-pro", "deepseek-v4-flash"]`.
6. Implement constructor taking `(createOpenAIClient: CreateOpenAIClient, converterOptions: OpenAIMessageConverterOptions = {})`.
7. In constructor, create `this.messageConverter = new OpenAIMessageConverter(converterOptions)`.
8. Implement `supportsModel(model: string): boolean` — returns `model.toLowerCase().startsWith("deepseek-")`.
9. Implement `getTimeoutMs(model: string): number` — returns 300_000 for pro, 180_000 for flash, 180_000 default.
10. Implement `isMultimodal(model: string): boolean` — returns `!NON_MULTIMODAL_DEEPSEEK_MODELS.has(model.trim())`.
11. Implement `async *chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent>`:
    a. Call `this.createOpenAIClient()` → destructure `{ client, baseURL }`.
    b. If `client` is null: throw `new Error("DeepSeek API key not configured")`.
    c. Resolve `thinkingEnabled` and `reasoningEffort` from `options.providerOptions as { thinkingEnabled?: boolean; reasoningEffort?: "high" | "max" } | undefined`.
    d. Call `this.messageConverter.buildMessages(options.messages, thinkingEnabled ?? false, options.model)`.
    e. Call `buildThinkingRequestOptions(thinkingEnabled ?? false, baseURL, reasoningEffort)`.
    f. Build timeout signal: `AbortSignal.timeout(this.getTimeoutMs(options.model))`.
    g. Compose signal: if `options.signal`, use `AbortSignal.any([options.signal, timeoutSignal])`; else use `timeoutSignal`.
    h. Build `streamRequest` object conditionally:
       - Always include `model`, `messages`, `tools`, `stream: true`, `stream_options: { include_usage: true }`, spread `thinkingOptions`.
       - Include `temperature` ONLY when `options.temperature !== undefined && !thinkingEnabled`.
       - Include `max_tokens` ONLY when `(options.maxTokens ?? 0) > 0`.
       - Do NOT include `user_id` (provider has no sessionId).
    i. Call `client.chat.completions.create(streamRequest, { signal: composedSignal })`.
    j. Wrap in try/catch. On error, yield `{ type: "error", error }` and throw.
    k. For each chunk in stream:
       - If `chunk.usage != null`: yield `{ type: "usage", usage: chunk.usage as ModelUsage }`.
       - For each choice in `(chunk.choices ?? [])`:
         - Extract `delta`.
         - If `typeof delta?.content === "string"`: yield `{ type: "text_delta", text: delta.content }`.
         - If `typeof delta?.reasoning_content === "string"` or `typeof delta?.reasoning === "string"`: yield `{ type: "reasoning_delta", text: delta.reasoning_content ?? delta.reasoning }`.
         - If `typeof delta?.refusal === "string"`: yield `{ type: "text_delta", text: delta.refusal }`.
         - If `Array.isArray(delta?.tool_calls)`: for each `rawToolCall`:
           - If `typeof rawToolCall.id === "string"`: yield `{ type: "tool_call_start", id: rawToolCall.id, name: rawToolCall.function?.name ?? "" }`.
           - If `typeof rawToolCall.function?.arguments === "string"`: yield `{ type: "tool_call_delta", id: rawToolCall.id ?? "", arguments: rawToolCall.function.arguments }`.

**Validation:**
- [ ] `npm run typecheck` passes.
- [ ] File `src/providers/deepseek-provider.ts` exists.
- [ ] `DeepSeekProvider` satisfies `ILlmProvider` (TypeScript verifies this).

**Status:** [x] done

---

### Task 5: Create provider factory

**Objective:** Create factory function that returns the correct provider for the current settings.

**Requirements Covered:** FR-005

**Design References:** Component 3 in design.md.

**Actions:**
1. Create file `src/common/llm-provider-registry.ts`.
2. Import `resolveCurrentSettings` from `../settings`.
3. Import `createOpenAIClient` from `../common/openai-client`.
4. Import `DeepSeekProvider` from `../providers/deepseek-provider`.
5. Import `ILlmProvider` from `./llm-provider`.
6. Import `OpenAIMessageConverterOptions` from `./openai-message-converter`.
7. Import `CreateOpenAIClient` from `../tools/executor`.
8. Define `CreateLlmProviderReturn` type: `{ provider: ILlmProvider | null; createOpenAIClient: CreateOpenAIClient }`.
9. Implement and export `createLlmProvider(projectRoot: string = process.cwd(), converterOptions?: OpenAIMessageConverterOptions): CreateLlmProviderReturn`:
   - Call `resolveCurrentSettings(projectRoot)`.
   - Create `const createClient = () => createOpenAIClient(projectRoot)`.
   - If `!settings.apiKey`: return `{ provider: null, createOpenAIClient: createClient }`.
   - Else: `const provider = new DeepSeekProvider(createClient, converterOptions)`.
   - Return `{ provider, createOpenAIClient: createClient }`.

**Validation:**
- [ ] `npm run typecheck` passes.
- [ ] File `src/common/llm-provider-registry.ts` exists.

**Status:** [x] done

---

### Task 6: Update `SessionManager` constructor and imports

**Objective:** Add `createLlmProvider` to constructor options. Remove dead imports.

**Requirements Covered:** FR-006, FR-009

**Design References:** Component 4a, 4c, 4d in design.md.

**Actions:**
1. Open `src/session.ts`.
2. In imports section (top of file):
   - REMOVE: `import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";`
   - REMOVE: `import { buildThinkingRequestOptions } from "./common/openai-thinking";`
   - ADD: `import type { ILlmProvider, LlmStreamEvent } from "./common/llm-provider";`
   - ADD: `import { createLlmProvider, type CreateLlmProviderReturn } from "./common/llm-provider-registry";`
3. In `SessionManagerOptions` type:
   - ADD field: `createLlmProvider: (converterOptions?: OpenAIMessageConverterOptions) => CreateLlmProviderReturn;`
   - KEEP existing `createOpenAIClient: CreateOpenAIClient;` (unchanged).
4. In `SessionManager` class body:
   - ADD field: `private readonly createLlmProvider: (converterOptions?: OpenAIMessageConverterOptions) => CreateLlmProviderReturn;`
   - In constructor, ADD: `this.createLlmProvider = options.createLlmProvider;`

**Validation:**
- [ ] `npm run typecheck` passes.
- [ ] `session.ts` no longer imports `ChatCompletionMessageParam` or `buildThinkingRequestOptions`.

**Status:** [x] done

---

### Task 7: Replace `activateSession` main loop with `ILlmProvider.chat()`

**Objective:** Rewrite the main conversation loop to use `provider.chat()` instead of `createChatCompletionStream()`.

**Requirements Covered:** FR-006

**Design References:** Component 4e in design.md — exact new loop code.

**Actions:**
1. Open `src/session.ts`.
2. Locate the `activateSession` method (around line 1260).
3. Find the block where `createOpenAIClient()` is called and `createChatCompletionStream()` follows.
4. Replace the block with:
   a. Call `const { provider } = this.createLlmProvider(this.buildConverterOptions());`
   b. If `!provider`: handle same as null client today (emit error, return early).
   c. Get model and settings from `this.createOpenAIClient()`: destructure `{ model, temperature, maxTokens, thinkingEnabled, reasoningEffort, debugLogEnabled, baseURL }`.
      NOTE: `this.createOpenAIClient()` NOT `this.getResolvedSettings()`. The latter only returns `{ model, mcpServers, permissions, modelPricing, memory, budget }` — it does NOT include `temperature`, `maxTokens`, `thinkingEnabled`, etc.
   d. Call `provider.chat({...})` with messages, tools, temperature, maxTokens, signal, providerOptions.
   e. Iterate `for await (const event of stream)`:
      - Switch on `event.type`:
        - `"text_delta"`: `content += event.text; trackText(event.text);`
        - `"reasoning_delta"`: `reasoningContent += event.text; trackText(event.text);`
        - `"tool_call_start"`: assign to `toolCallsByIndex` map; `trackText(event.name);`
        - `"tool_call_delta"`: find tool call by id in map, append arguments; `trackText(event.arguments);`
        - `"usage"`: `usage = event.usage;`
        - `"error"`: throw `event.error;`
   f. After loop: normalize tool calls, build final message (same as existing code after `createChatCompletionStream`).
5. Debug logging (`logChatCompletionDebug`) and API error logging (`logApiError`): wrap appropriately.
   - Defensive: log at start (request info), log on error, log at end (response info).
   - Keep same location strings (`"SessionManager.activateSession"`).
6. Stream progress (`emitLlmStreamProgress`): keep same pattern — emit "start" before loop, "update" in loop, "end" after loop.
7. Keep budget tracking (`recordBudgetCost`) unchanged — called after stream with `responseUsage`.
8. Create `buildConverterOptions()` helper. In the constructor, extract the converter options into a named constant BEFORE creating `this.messageConverter`, and store it as a private field:

```typescript
// In constructor:
const converterOptions: OpenAIMessageConverterOptions = {
  renderInitPrompt: () => this.renderInitCommandPrompt(),
  renderSteeringAddPrompt: (steeringText: string) => this.renderSteeringAddCommandPrompt(steeringText),
  renderSteeringListPrompt: () => this.renderSteeringListCommandPrompt(),
  renderSpecInitPrompt: () => this.renderSpecInitPrompt(),
  renderSpecPlanPrompt: (planText: string) => this.renderSpecPlanPrompt(planText),
  renderSpecNewPrompt: (specNumber: number) => this.renderSpecNewPrompt(specNumber),
  renderSpecVerifyPrompt: (specNumber: number) => this.renderSpecVerifyPrompt(specNumber),
  renderSpecImplementPrompt: (specNumber: number) => this.renderSpecImplementPrompt(specNumber),
  renderSpecAuditPrompt: (specNumber: number) => this.renderSpecAuditPrompt(specNumber),
  renderSpecListPrompt: () => this.renderSpecListPrompt(),
  renderSpecStatusPrompt: (specNumber: number | null) => this.renderSpecStatusPrompt(specNumber),
};
this.converterOptions = converterOptions;
this.messageConverter = new OpenAIMessageConverter(converterOptions);
```

Add a new private field: `private readonly converterOptions: OpenAIMessageConverterOptions;`

Then add the helper method:
```typescript
private buildConverterOptions(): OpenAIMessageConverterOptions {
  return this.converterOptions;
}
```

This ensures the same options are passed to both the existing `messageConverter` (for `findToolFunction()` etc.) and the new `DeepSeekProvider` (for message conversion in `chat()`).

**Validation:**
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes with zero new warnings.

**Status:** [x] done

---

### Task 8: Replace `compactSession` with `ILlmProvider.chat()`

**Objective:** Rewrite compaction to use `provider.chat()`.

**Requirements Covered:** FR-006

**Design References:** Component 4f in design.md.

**Actions:**
1. Open `src/session.ts`, locate `compactSession` method.
2. Remove the block that calls `createChatCompletionStream(client, {...}, ...)`.
3. Replace with:
   a. `const { provider } = this.createLlmProvider();`
   b. `if (!provider) return;`
   c. Build minimal `SessionMessage` for compaction prompt.
   d. `const stream = provider.chat({ model: compactionModel, messages: [compactMessage], signal: signal ?? undefined });`
   e. Iterate stream, aggregating `text_delta` into `compactedContent` and capturing `usage` into `compactionUsage: ModelUsage | null`.
      ```
      let compactedContent = "";
      let compactionUsage: ModelUsage | null = null;
      for await (const event of stream) {
        if (event.type === "text_delta") compactedContent += event.text;
        if (event.type === "usage") compactionUsage = event.usage;
      }
      ```
   f. Parse `compactedContent` as JSON (existing logic preserved).
4. Keep budget tracking (`recordBudgetCost`) with `compactionUsage` (replaces `response.usage`).
5. Keep debug logging and API error logging.

**Validation:**
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 9: Remove `createChatCompletionStream` method

**Objective:** Delete the now-unused method from `SessionManager`.

**Requirements Covered:** FR-006

**Design References:** Component 4b in design.md.

**Actions:**
1. Open `src/session.ts`.
2. Locate `private async createChatCompletionStream(...)` method.
3. Delete the entire method (approximately lines 523-765).
4. Verify no remaining callers of this method in `session.ts`.

**Validation:**
- [ ] `npm run typecheck` passes.
- [ ] `grep "createChatCompletionStream" src/session.ts` returns zero results.

**Status:** [x] done

---

### Task 10: Update tests — mock `ILlmProvider` instead of `createOpenAIClient` internals

**Objective:** Update session tests to work with the new architecture.

**Requirements Covered:** NFR-001 (test integrity)

**Design References:** Testing Strategy section in design.md.

**Actions:**
1. Open `src/tests/session.test.ts`.
2. Locate test setup where `createOpenAIClient` mock is configured.
3. Add `createLlmProvider` mock alongside it:
   - Returns `{ provider: mockProvider, createOpenAIClient: existingMock }`.
   - `mockProvider` implements `ILlmProvider` with:
     - `providerName: "mock"`
     - `supportsModel: () => true`
     - `getTimeoutMs: () => 180_000`
     - `isMultimodal: () => false`
     - `chat: async function* () { yield { type: "text_delta", text: "mock response" }; yield { type: "usage", usage: { prompt_tokens: 0, completion_tokens: 0 } }; }`
4. For tests that need tool calls in response: add `tool_call_start` and `tool_call_delta` events to the mock stream.
5. For tests that need reasoning content: add `reasoning_delta` events.
6. Remove any test that specifically tests `createChatCompletionStream` (the method no longer exists).
7. If a test file imports `buildThinkingRequestOptions`: remove the import.

**Validation:**
- [ ] `npm test` passes with 0 failures (same 555 tests, possibly fewer if createChatCompletionStream tests removed).
- [ ] No test has `createChatCompletionStream` in its name or body.

**Status:** [x] done

---

### Task 11: Run full validation

**Objective:** Verify the entire change set compiles, lints, formats, and passes tests.

**Requirements Covered:** NFR-001, NFR-002, NFR-003

**Actions:**
1. Run `npm run typecheck` — must pass with zero errors.
2. Run `npm run lint` — must pass with zero new warnings.
3. Run `npm run format:check` — must show no unformatted files.
4. Run `npm test` — must pass with zero failures.
5. Verify zero changes to `package.json` and `package-lock.json`.

**Validation:**
- [ ] All 4 commands return exit code 0.

**Status:** [x] done

---

### Task 12: Update roadmap status

**Objective:** Mark spec 30 as `created` in the roadmap.

**Requirements Covered:** N/A (process)

**Actions:**
1. Open `.dscode/specs/roadmap.md`.
2. Change `| 30 | provider-agnostic-llm-layer | planned | ...` to `| 30 | provider-agnostic-llm-layer | created | ...`.

**Validation:**
- [ ] Roadmap shows `created` for spec 30.

**Status:** [x] done
