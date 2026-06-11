# Spec 50: anthropic-provider-adapter — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

---

## Tasks

### Task 1: Install `@anthropic-ai/sdk` dependency

**Objective:** Add the Anthropic SDK npm package.

**Requirements Covered:** FR-001

**Design References:** Component 1 in design.md.

**Actions:**
1. Run `npm install @anthropic-ai/sdk@latest` in the project root.
2. Verify `package.json` now has `@anthropic-ai/sdk` in `dependencies`.
3. Verify `package-lock.json` is updated.
4. Run `npm run typecheck` — must pass with zero errors (the package is installed but not yet imported).
5. Run `git diff package.json` — confirm only `@anthropic-ai/sdk` was added.

**Validation:**
- [ ] `@anthropic-ai/sdk` in `package.json` dependencies.
- [ ] `package-lock.json` updated.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes (no regressions from new dependency alone).

**Status:** [x] done

---

### Task 2: Add HTTP 529 to retryable status codes

**Objective:** Add Anthropic's `overloaded_error` HTTP 529 to the retry logic.

**Requirements Covered:** FR-004 (error handling for overloaded)

**Design References:** Component 2 in design.md.

**Actions:**
1. Open `src/common/api-retry.ts`.
2. Change `const RETRYABLE_STATUS_CODES = new Set([429, 502, 503]);` to `const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 529]);`.
3. In the `isRetryableError` function, find the line containing `message.includes("429") || message.includes("502") || message.includes("503")`.
4. Add `|| message.includes("529")` to the condition.
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `529` is in `RETRYABLE_STATUS_CODES`.
- [ ] `"529"` is checked in `isRetryableError` string matching.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 3: Create `AnthropicMessageConverter` with tool conversion

**Objective:** Create the message converter class that transforms `SessionMessage[]` to Anthropic `MessageParam[]`.

**Requirements Covered:** FR-002, FR-005

**Design References:** Component 4, Component 7 in design.md.

**Actions:**
1. Create file `src/common/anthropic-message-converter.ts`.
2. Add imports:
   ```typescript
   import type { SessionMessage } from "../session";
   import type { ToolDefinition } from "../prompt";
   import { isMultimodalModel } from "./model-capabilities";
   ```
3. Define Anthropic types inline (avoid importing from `@anthropic-ai/sdk` at the type level, but the types are needed — import them):
   ```typescript
   import type AnthropicSdk from "@anthropic-ai/sdk";

   type MessageParam = AnthropicSdk.MessageParam;
   type ContentBlock = AnthropicSdk.ContentBlock;
   type TextBlock = { type: "text"; text: string };
   type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
   type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
   type ThinkingBlock = { type: "thinking"; thinking: string; signature: string };
   type ImageBlockParam = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
   ```
4. Implement and export `convertToolsToAnthropic` function:
   ```typescript
   export function convertToolsToAnthropic(
     tools: ToolDefinition[],
   ): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
     return tools.map((tool) => ({
       name: tool.function.name,
       description: tool.function.description,
       input_schema: {
         type: "object" as const,
         properties: (tool.function.parameters.properties ?? {}) as Record<string, unknown>,
         ...(tool.function.parameters.required?.length
           ? { required: tool.function.parameters.required }
           : {}),
       },
     }));
   }
   ```
5. Implement `AnthropicMessageConverter` class with:
   - `private systemPrompt = ""`
   - `buildMessages(messages, thinkingEnabled, model): MessageParam[]`
     - Filter compacted messages.
     - Pair tool calls using `pairToolMessages()` (copy algorithm from `OpenAIMessageConverter.pairToolMessages()` — ~50 lines, extracted from `openai-message-converter.ts` and adapted for Anthropic content blocks).
     - Convert each message via `convertMessage()`.
     - Return `MessageParam[]` (does NOT include system messages).
   - `private convertMessage(message, thinkingEnabled, model, index, toolPairings, messages): MessageParam | null`
     - `system` role: accumulate to `this.systemPrompt`, return null.
     - `user` role: build content blocks array with text + images.
     - `assistant` role: build content blocks with text + tool_use + thinking.
     - `tool` role: build `{ role: "user", content: [{ type: "tool_result", ... }] }`.
   - `getSystemPrompt(): string` — returns `this.systemPrompt`.
   - `private pairToolMessages(messages)` — copied from OpenAIMessageConverter.
   - `private findPairableToolMessageIndex(...)` — copied.
   - `private getAssistantToolCalls(...)` — copied.
   - `private getToolCallId(...)` — copied.
   - `private getToolMessageCallId(...)` — copied.
   - `private buildToolPairingKey(...)` — copied.
   - `private isInterruptedToolMessage(...)` — copied.
   - `private buildInterruptedAnthropicToolResult(...)` — adapted for `ToolResultBlock`.
   - `private findToolFunction(...)` — copied.
   - `private buildInterruptedToolResult(...)` — copied (same JSON format).
6. Run `npm run typecheck` — must pass.
7. Run `npm test` — all existing tests must pass (new converter is not yet imported anywhere).

**Validation:**
- [ ] `src/common/anthropic-message-converter.ts` exists.
- [ ] `convertToolsToAnthropic` function exported.
- [ ] `AnthropicMessageConverter` class exported.
- [ ] `buildMessages` returns `MessageParam[]`.
- [ ] `getSystemPrompt` returns accumulated system content.
- [ ] Tool pairing logic matches `OpenAIMessageConverter` behavior.
- [ ] Interrupted tool fallback works.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 4: Create `createAnthropicClient` factory

**Objective:** Create the Anthropic client factory function.

**Requirements Covered:** FR-003, FR-010

**Design References:** Component 5 in design.md.

**Actions:**
1. Create file `src/common/anthropic-client.ts`.
2. Add imports:
   ```typescript
   import Anthropic from "@anthropic-ai/sdk";
   import { resolveCurrentSettings } from "../settings";
   ```
3. Implement the full function as specified in design.md Component 5:
   - Module-level cache variables: `cachedAnthropic`, `cachedAnthropicKey`.
   - `ENGINE_DEFAULT_BASE_URLS` map with only `anthropic: "https://api.anthropic.com"`.
   - Engine-specific API key and base URL resolution from `engines.anthropic` (full resolution: engine-specific → engine default → global fallback).
   - Global fallback to `settings.apiKey` and `settings.baseURL`.
   - Return `{ client: null, ... }` when no key.
   - Cache hit → return cached `Anthropic` instance (cache key: `${apiKey}::${baseURL}`).
   - Cache miss → `new Anthropic({ apiKey, baseURL: baseURL || undefined })`, cache, return.
   - Return type includes `client`, `model`, `thinkingEnabled`, `debugLogEnabled`, `telemetryEnabled`, `maxTokens`, `notify`, `env`.
4. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `src/common/anthropic-client.ts` exists.
- [ ] `createAnthropicClient(projectRoot, "anthropic")` returns `client: Anthropic` when API key configured.
- [ ] `createAnthropicClient(projectRoot, "anthropic")` returns `client: null` when no API key.
- [ ] Client cached — second call with same key returns same instance.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 5: Create `AnthropicProvider` class

**Objective:** Create the Anthropic provider implementing `ILlmProvider`.

**Requirements Covered:** FR-004, FR-006, FR-007

**Design References:** Component 6 in design.md.

**Actions:**
1. Create file `src/providers/anthropic-provider.ts`.
2. Add imports:
   ```typescript
   import type AnthropicSdk from "@anthropic-ai/sdk";
   import {
     AnthropicMessageConverter,
     convertToolsToAnthropic,
   } from "../common/anthropic-message-converter";
   import { DEFAULT_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
   import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
   import type { ModelUsage } from "../session";
   import { withRetry } from "../common/api-retry";
   import { createAnthropicClient } from "../common/anthropic-client";
   ```
3. Define constants:
   ```typescript
   const CLAUDE_MODEL_PREFIX = "claude-";
   const CLAUDE_HAIKU_PATTERN = /^claude-haiku/;
   const CLAUDE_REASONING_PATTERN = /^claude-(opus|sonnet)/;
   ```
4. Implement `AnthropicProvider` class with:
   - `readonly providerName = "anthropic"`.
   - `private readonly messageConverter = new AnthropicMessageConverter()`.
   - `constructor()` — no parameters needed (creates own client).
   - `supportsModel(model)` — lowercase starts with `"claude-"`.
   - `getTimeoutMs(model)` — 300000 for opus/sonnet, 180000 for haiku.
   - `isMultimodal(_model)` — always `true`.
   - `getCheapModel(model)` — opus/sonnet → haiku-4-5, haiku → null, heuristic for unknown.
   - `async *chat(options)` — full implementation:
     a. `createAnthropicClient(process.cwd(), "anthropic")` → check `client` null → throw.
     b. Extract `thinkingEnabled` from `providerOptions`.
     c. `messageConverter.buildMessages(options.messages, thinkingEnabled, options.model)`.
     d. `messageConverter.getSystemPrompt()`.
     e. `convertToolsToAnthropic(options.tools ?? [])` or `undefined`.
     f. Build request body: `model`, `messages`, `stream: true`, `max_tokens`, `system`, `tools`, `thinking`, optional `temperature`.
     g. `withRetry(() => client.messages.create(requestBody, { signal }))`.
     h. `yield* this.streamToEvents(stream)`.
   - `private async *streamToEvents(stream)` — full implementation from design.md Component 6:
     a. Track `inputTokens`, `outputTokens`, `currentToolUseId`, `thinkingContent`, `thinkingSignature`.
     b. `for await (const event of stream)` → switch on `event.type`:
        - `message_start` → save `inputTokens`.
        - `content_block_start` (tool_use) → yield `tool_call_start`, set `currentToolUseId`.
        - `content_block_start` (thinking) → save initial thinking/signature.
        - `content_block_delta` (text_delta) → yield `text_delta`.
        - `content_block_delta` (input_json_delta) → yield `tool_call_delta`.
        - `content_block_delta` (thinking_delta) → accumulate, yield `reasoning_delta`.
        - `content_block_delta` (signature_delta) → save `thinkingSignature`.
        - `message_delta` → build `ModelUsage`, yield `usage`.
        - `ping` → ignore.
        - `default` → ignore.
     c. `catch (error)` → yield `error`, throw.
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `src/providers/anthropic-provider.ts` exists.
- [ ] `AnthropicProvider` implements `ILlmProvider` (TypeScript verifiable).
- [ ] `supportsModel("claude-sonnet-4-5")` → `true`.
- [ ] `supportsModel("deepseek-v4-pro")` → `false`.
- [ ] `getCheapModel("claude-opus-4-8")` → `"claude-haiku-4-5"`.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 6: Extract `BaseOpenAICompatibleProvider` from DeepSeek and OpenAI providers

**Objective:** Extract the shared streaming loop into an abstract base class to reduce duplication.

**Requirements Covered:** NFR-001 (from FR-004 — maintainable code)

**Design References:** Component 8 in design.md.

**Actions:**
1. Create file `src/providers/base-openai-provider.ts`.
2. Add imports:
   ```typescript
   import {
     OpenAIMessageConverter,
     type OpenAIMessageConverterOptions,
   } from "../common/openai-message-converter";
   import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
   import type { ModelUsage } from "../session";
   import type { CreateOpenAIClient } from "../tools/executor";
   import { withRetry } from "../common/api-retry";
   ```
3. Define abstract class:
   ```typescript
   export abstract class BaseOpenAICompatibleProvider implements ILlmProvider {
     abstract readonly providerName: string;
     protected readonly messageConverter: OpenAIMessageConverter;

     constructor(
       protected readonly createOpenAIClient: CreateOpenAIClient,
       converterOptions: OpenAIMessageConverterOptions = {},
     ) {
       this.messageConverter = new OpenAIMessageConverter(converterOptions);
     }

     abstract supportsModel(model: string): boolean;
     abstract getTimeoutMs(model: string): number;
     abstract isMultimodal(model: string): boolean;
     getCheapModel?(_model: string): string | null;

     protected abstract buildChatCompletionRequest(
       options: LlmChatOptions,
       openaiMessages: unknown[],
       client: ReturnType<CreateOpenAIClient>["client"],
       baseURL: string,
     ): Record<string, unknown>;

     async *chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent> {
       // ... COPY the ENTIRE chat() method from DeepSeekProvider verbatim ...
       // ... but replace the thinking+message+request construction block ...
       // ... with a call to this.buildChatCompletionRequest(...) ...
     }
   }
   ```
4. The `chat()` method in the base class:
   - Gets `{ client, baseURL }` from `createOpenAIClient()`.
   - Checks `client` null → throw (use `${this.providerName} API key not configured`).
   - Calls `this.buildChatCompletionRequest(options, openaiMessages, client, baseURL)`.
   - Everything else (withRetry, non-streaming fallback, streaming loop, toolIndexToId, error handling) is identical to current `DeepSeekProvider.chat()`.
5. Open `src/providers/deepseek-provider.ts`:
   - Change `class DeepSeekProvider implements ILlmProvider` → `class DeepSeekProvider extends BaseOpenAICompatibleProvider`.
   - Remove the `messageConverter` field, `constructor`, and `chat()` method (now in base class).
   - Add constructor calling `super(createClient, converterOptions)`.
   - Add `protected buildChatCompletionRequest(...)` method:
     ```typescript
     protected buildChatCompletionRequest(
       options: LlmChatOptions,
       openaiMessages: unknown[],
       _client: ReturnType<CreateOpenAIClient>["client"],
       baseURL: string,
     ): Record<string, unknown> {
       const providerOpts = options.providerOptions as
         | { thinkingEnabled?: boolean; reasoningEffort?: "high" | "max" }
         | undefined;
       const thinkingEnabled = providerOpts?.thinkingEnabled ?? false;
       const reasoningEffort = providerOpts?.reasoningEffort;

       const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);

       const streamRequest: Record<string, unknown> = {
         model: options.model,
         messages: openaiMessages,
         tools: options.tools ?? [],
         stream: true as const,
         stream_options: { include_usage: true },
         ...thinkingOptions,
       };

       if (options.temperature !== undefined && !thinkingEnabled) {
         streamRequest.temperature = options.temperature;
       }
       if ((options.maxTokens ?? 0) > 0) {
         streamRequest.max_tokens = options.maxTokens;
       }

       return streamRequest;
     }
     ```
   - Keep: `supportsModel`, `getTimeoutMs`, `isMultimodal`, `getCheapModel`.
   - Remove the `buildThinkingRequestOptions` import if no longer needed directly (check if any other method uses it — if not, remove).
6. Open `src/providers/openai-provider.ts`:
   - Change `class OpenAIProvider implements ILlmProvider` → `class OpenAIProvider extends BaseOpenAICompatibleProvider`.
   - Remove the `messageConverter` field, `constructor`, and `chat()` method body.
   - Add constructor calling `super(createClient, converterOptions)`.
   - Add `protected buildChatCompletionRequest(...)` method:
     ```typescript
     protected buildChatCompletionRequest(
       options: LlmChatOptions,
       openaiMessages: unknown[],
       _client: ReturnType<CreateOpenAIClient>["client"],
       baseURL: string,
     ): Record<string, unknown> {
       const providerOpts = options.providerOptions as
         | { thinkingEnabled?: boolean; reasoningEffort?: "high" | "max" }
         | undefined;
       const thinkingEnabled = providerOpts?.thinkingEnabled ?? false;
       const reasoningEffort = providerOpts?.reasoningEffort;

       const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort, "openai");

       const streamRequest: Record<string, unknown> = {
         model: options.model,
         messages: openaiMessages,
         tools: options.tools ?? [],
         stream: true as const,
         stream_options: { include_usage: true },
         ...thinkingOptions,
       };

       if (options.temperature !== undefined && !thinkingEnabled) {
         streamRequest.temperature = options.temperature;
       }
       if ((options.maxTokens ?? 0) > 0) {
         streamRequest.max_tokens = options.maxTokens;
       }

       return streamRequest;
     }
     ```
   - Keep: `supportsModel`, `getTimeoutMs`, `isMultimodal`, `getCheapModel`.
7. Update imports in both files to include `BaseOpenAICompatibleProvider`.
8. Run `npm run typecheck` — must pass with zero errors.
9. Run `npm test` — ALL existing tests must pass. This is a pure refactoring — zero behavior change.

**Validation:**
- [ ] `src/providers/base-openai-provider.ts` exists with abstract class.
- [ ] `DeepSeekProvider` extends `BaseOpenAICompatibleProvider`.
- [ ] `OpenAIProvider` extends `BaseOpenAICompatibleProvider`.
- [ ] Both providers only contain: `providerName`, model/prefix constants, `supportsModel`, `getTimeoutMs`, `isMultimodal`, `getCheapModel`, `buildChatCompletionRequest`.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes — ALL existing tests, zero failures.

**Status:** [x] done

---

### Task 7: Add Claude pricing to `DEFAULT_MODEL_PRICING`

**Objective:** Add pricing entries for Claude models.

**Requirements Covered:** FR-009

**Design References:** Component 10 in design.md.

**Actions:**
1. Open `src/common/model-capabilities.ts`.
2. Locate `DEFAULT_MODEL_PRICING` record.
3. Add three entries after the existing entries:
   ```typescript
   "claude-opus-4-8":   { inputPrice: 15.00, outputPrice: 75.00, cacheReadPrice: 1.50 },
   "claude-sonnet-4-5": { inputPrice: 3.00,  outputPrice: 15.00, cacheReadPrice: 0.30 },
   "claude-haiku-4-5":  { inputPrice: 0.80,  outputPrice: 4.00,  cacheReadPrice: 0.08 },
   ```
4. **IMPORTANT:** Before committing, verify prices against `https://www.anthropic.com/pricing`. Update values if official prices differ.
5. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `DEFAULT_MODEL_PRICING["claude-sonnet-4-5"]` exists with valid shape.
- [ ] Prices verified or marked as estimates.
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 8: Update provider registry for Anthropic routing

**Objective:** Route `claude-` prefixed model names to `AnthropicProvider`.

**Requirements Covered:** FR-008

**Design References:** Component 9 in design.md.

**Actions:**
1. Open `src/common/llm-provider-registry.ts`.
2. Add import:
   ```typescript
   import { AnthropicProvider } from "../providers/anthropic-provider";
   ```
3. Add helper after existing `isOpenAIModel`:
   ```typescript
   function isAnthropicModel(model: string): boolean {
     return model.toLowerCase().startsWith("claude-");
   }
   ```
4. In `createLlmProvider`, update `engineName` resolution:
   ```typescript
   const engineName =
     isOpenAIModel(settings.model) ? "openai"
     : isAnthropicModel(settings.model) ? "anthropic"
     : undefined;
   ```
5. Add Anthropic routing branch after the OpenAI branch:
   ```typescript
   if (engineName === "anthropic") {
     const provider = new AnthropicProvider();
     return { provider, createOpenAIClient: createClient };
   }
   ```
6. Run `npm run typecheck` — must pass.

**Validation:**
- [ ] `createLlmProvider()` with model `"claude-sonnet-4-5"` creates `AnthropicProvider`.
- [ ] `createLlmProvider()` with model `"deepseek-v4-pro"` creates `DeepSeekProvider` (no regression).
- [ ] `npm run typecheck` passes.

**Status:** [x] done

---

### Task 9: Create `anthropic-message-converter.test.ts`

**Objective:** Test the Anthropic message converter and tool conversion function.

**Requirements Covered:** FR-002, FR-005 (validation), NFR-003

**Design References:** Testing Strategy section in design.md (anthropic-message-converter.test.ts).

**Actions:**
1. Create file `src/tests/anthropic-message-converter.test.ts`.
2. Import `AnthropicMessageConverter`, `convertToolsToAnthropic`.
3. Import test helpers to construct `SessionMessage` objects.
4. Add these tests (minimum 12):
   - `convertToolsToAnthropic converts OpenAI format to Anthropic format` — verify `function.name → name`, `function.description → description`, `function.parameters → input_schema`.
   - `convertToolsToAnthropic strips additionalProperties` — verify `additionalProperties` not in `input_schema`.
   - `convertToolsToAnthropic handles required fields` — verify `required` array forwarded.
   - `convertToolsToAnthropic handles empty array` — returns `[]`.
   - `buildMessages extracts system messages to getSystemPrompt()` — verify system messages NOT in array, `getSystemPrompt()` returns concatenation.
   - `buildMessages converts user message to content blocks` — verify `{ role: "user", content: [{ type: "text", text: "..." }] }`.
   - `buildMessages converts assistant message with tool calls` — verify tool_use blocks with correct id, name, input.
   - `buildMessages wraps tool results in user role` — verify `{ role: "user", content: [{ type: "tool_result", ... }] }`.
   - `buildMessages includes thinking block when reasoning_content present` — verify `{ type: "thinking", thinking: "...", signature: "..." }` in content array.
   - `buildMessages filters compacted messages` — compacted messages excluded from output.
   - `buildMessages injects interrupted tool results` — unpaired tool calls get fallback tool_result with error JSON.
   - `buildMessages filters images for non-multimodal model` — image blocks removed.
5. Run `npm test -- --grep anthropic-message-converter` to verify new tests pass.

**Validation:**
- [ ] File exists with at least 12 tests.
- [ ] All new tests pass.
- [ ] Existing tests still pass.

**Status:** [x] done

---

### Task 10: Create `anthropic-provider.test.ts`

**Objective:** Test the AnthropicProvider class with mocked Anthropic SDK.

**Requirements Covered:** FR-004, FR-006, FR-007 (validation), NFR-003

**Design References:** Testing Strategy section in design.md (anthropic-provider.test.ts).

**Actions:**
1. Create file `src/tests/anthropic-provider.test.ts`.
2. Import `AnthropicProvider`, `ILlmProvider`, `LlmStreamEvent`.
3. Mock `createAnthropicClient` to return a controlled `Anthropic` instance.
4. Mock `client.messages.create()` to return a controlled async iterable of SSE events.
5. Add these tests (minimum 16):
   - `supportsModel returns true for claude- prefixes` — test `claude-sonnet-4-5`, `claude-opus-4-8`, `claude-haiku-4-5`.
   - `supportsModel returns false for non-claude models` — test `gpt-5.4`, `deepseek-v4-pro`.
   - `getTimeoutMs returns 300_000 for opus/sonnet` — test `claude-opus-4-8`, `claude-sonnet-4-5`.
   - `getTimeoutMs returns 180_000 for haiku` — test `claude-haiku-4-5`.
   - `isMultimodal returns true for all models`.
   - `getCheapModel returns haiku for opus` — test `claude-opus-4-8` → `claude-haiku-4-5`.
   - `getCheapModel returns haiku for sonnet` — test `claude-sonnet-4-5` → `claude-haiku-4-5`.
   - `getCheapModel returns null for haiku`.
   - `getCheapModel heuristic replaces opus/sonnet with haiku` — test unknown model like `claude-opus-4-9` → `claude-haiku-4-9`.
   - `chat yields text_delta events` — mock text content block stream.
   - `chat yields reasoning_delta events` — mock thinking_delta events.
   - `chat yields tool_call_start and tool_call_delta` — mock tool_use content block stream.
   - `chat yields usage event with correct token counts` — mock message_start + message_delta.
   - `chat throws when API key missing` — mock `createAnthropicClient` → null client.
   - `chat throws when stream errors` — mock stream that throws mid-iteration.
   - `chat forwards signal to withRetry` — verify signal composition.
6. Run `npm test -- --grep anthropic-provider` to verify new tests pass.

**Validation:**
- [ ] File exists with at least 16 tests.
- [ ] All new tests pass.
- [ ] Existing tests still pass.

**Status:** [x] done

---

### Task 11: Add Anthropic stream event conversion tests

**Objective:** Test the SSE event → LlmStreamEvent conversion logic.

**Requirements Covered:** FR-006 (validation)

**Design References:** Testing Strategy section (stream converter tests).

**Actions:**
1. Open `src/tests/anthropic-provider.test.ts` (add to the same file, or create a separate `src/tests/anthropic-stream-converter.test.ts`).
2. Add these tests (minimum 8):
   - `message_start stores input_tokens` — mock `message_start` event, verify no yield, token stored.
   - `content_block_start tool_use yields tool_call_start` — mock content_block_start with tool_use, verify yield.
   - `content_block_delta text_delta yields text_delta` — mock text_delta, verify text passthrough.
   - `content_block_delta input_json_delta yields tool_call_delta` — mock input_json_delta, verify partial_json passthrough with correct id.
   - `content_block_delta thinking_delta yields reasoning_delta` — mock thinking_delta, verify reasoning passthrough.
   - `content_block_delta signature_delta stores signature` — mock signature_delta, verify no yield but stored.
   - `message_delta with usage yields usage event` — mock message_delta, verify ModelUsage shape.
   - `ping event is ignored` — mock ping, verify no yield and no error.
   - `unknown event is ignored` — mock unknown event type, verify graceful skip.
   - `error event yields error and throws` — mock error event, verify error yield + throw.
3. Run `npm test -- --grep stream-converter` to verify.

**Validation:**
- [ ] At least 10 stream conversion tests.
- [ ] All new tests pass.

**Status:** [x] done

---

### Task 12: Add registry routing test for Anthropic

**Objective:** Test that the provider registry correctly routes `claude-` models.

**Requirements Covered:** FR-008 (validation)

**Design References:** Testing Strategy section.

**Actions:**
1. Open `src/tests/llm-provider-registry.test.ts`.
2. Add these tests (minimum 2):
   - `createLlmProvider with claude-sonnet-4-5 creates AnthropicProvider` — mock settings with model `"claude-sonnet-4-5"` and valid API key; verify `result.provider` is instance of `AnthropicProvider`.
   - `createLlmProvider with claude-haiku-4-5 creates AnthropicProvider` — same, verify routing.
3. If `llm-provider-registry.test.ts` doesn't yet exist (only created in Spec 40), create it now.
4. Run `npm test -- --grep llm-provider-registry` to verify.

**Validation:**
- [ ] Registry correctly routes `claude-` prefix to `AnthropicProvider`.
- [ ] All existing registry tests still pass.

**Status:** [x] done

---

### Task 13: Add `getCheapModel` test for base class refactoring backup

**Objective:** Ensure `DeepSeekProvider.chat()` and `OpenAIProvider.chat()` still work after extraction to base class.

**Requirements Covered:** FR-012 (backward compatibility)

**Design References:** Testing Strategy section.

**Actions:**
1. Run `npm test` — confirm ALL existing tests pass.
2. Specifically check:
   - DeepSeek streaming tests pass.
   - OpenAI streaming tests pass (if Spec 40 code is present).
   - Session tests pass.
   - Thinking option tests pass.
3. If any test fails, debug the base class extraction (Task 6). The extraction MUST be behavior-preserving.

**Validation:**
- [ ] `npm test` exit code 0.
- [ ] Zero test failures.
- [ ] Test count matches or exceeds pre-extraction count.

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
6. Verify `package.json` has exactly one change: `@anthropic-ai/sdk` added (`git diff HEAD -- package.json`).
7. Run `git diff --stat` to review all changed files — confirm only expected files are modified.

**Validation:**
- [ ] All 5 commands return exit code 0.
- [ ] `package.json` changed only by adding `@anthropic-ai/sdk`.
- [ ] Only expected files modified:
  - `package.json`, `package-lock.json`
  - `src/common/anthropic-message-converter.ts` (NEW)
  - `src/common/anthropic-client.ts` (NEW)
  - `src/common/api-retry.ts`
  - `src/common/llm-provider-registry.ts`
  - `src/common/model-capabilities.ts`
  - `src/providers/base-openai-provider.ts` (NEW)
  - `src/providers/anthropic-provider.ts` (NEW)
  - `src/providers/deepseek-provider.ts`
  - `src/providers/openai-provider.ts`
  - `src/tests/anthropic-message-converter.test.ts` (NEW)
  - `src/tests/anthropic-provider.test.ts` (NEW)
  - `src/tests/llm-provider-registry.test.ts` (NEW or MODIFY)

**Status:** [x] done

---

### Task 15: Update roadmap status

**Objective:** Update roadmap status for spec 50.

**Requirements Covered:** N/A (process)

**Actions:**
1. Open `management/roadmap.md`.
2. Find the row for spec 50.
3. If status is `planned`, change to `created`.
4. If status is already `created` or `verified`, confirm and skip (no change needed).

**Validation:**
- [ ] Roadmap shows `created` or `verified` for spec 50.

**Status:** [x] done
