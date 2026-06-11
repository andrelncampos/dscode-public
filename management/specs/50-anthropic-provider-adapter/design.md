# Spec 50: anthropic-provider-adapter — Design

## Design Approach

This spec follows the **add-don't-rewrite** principle but with a critical difference from Spec 40: Anthropic is the FIRST non-OpenAI-compatible provider. While Spec 40's `OpenAIProvider` was a structural mirror of `DeepSeekProvider` (sharing the `openai` SDK, message converter, streaming loop, and thinking function), `AnthropicProvider` requires its own:

1. **SDK** — `@anthropic-ai/sdk` (per ADR-001).
2. **Message converter** — `AnthropicMessageConverter` (content block array format).
3. **Client factory** — `createAnthropicClient()` (anthropic-specific).
4. **Stream parser** — SSE event → `LlmStreamEvent` converter.
5. **Thinking config** — Inline (not via `buildThinkingRequestOptions`).

Despite these differences, the `ILlmProvider` interface is proven sufficient — `SessionManager` sees no difference between `DeepSeekProvider.chat()`, `OpenAIProvider.chat()`, and `AnthropicProvider.chat()`.

**Principles applied:**
- **P1 (Interface-First):** `AnthropicProvider` implements `ILlmProvider`. SessionManager never imports or references `@anthropic-ai/sdk` directly.
- **P2 (Canonical Types):** Uses `SessionMessage` → `AnthropicMessageParam` conversion internally. Emits `LlmStreamEvent`.
- **P3 (Streaming-First):** SSE streaming via `AnthropicStream` from the SDK, converted to `AsyncIterable<LlmStreamEvent>`.
- **P4 (Surgical Changes):** Only files that must change are changed. Existing provider code is untouched.
- **P5 (Test Integrity):** All existing tests pass. New tests for new code only.
- **P6 (Zero New Dependencies Without Justification):** One new dependency (`@anthropic-ai/sdk`) justified by ADR-001.
- **P7 (Provider-Agnostic Configuration):** Anthropic uses the `engines` namespace already established in Spec 40.

---

## Architecture Decisions

### AD-SPEC50-001: Extract shared streaming-loop base class now (3 providers)

**Decision:** After implementing `AnthropicProvider`, extract a `BaseOpenAICompatibleProvider` from the common code in `DeepSeekProvider` and `OpenAIProvider` (which share ~80% of their streaming loop). `AnthropicProvider` is NOT included in this extraction — its streaming model is fundamentally different.

**Rationale:** With 2 OpenAI-compatible providers in Spec 40, the duplication was acceptable (AD-SPEC40-001 deferred extraction). With 3 providers now (2 OpenAI-compatible + 1 Anthropic), the OpenAl-compatible duplicated streaming loop is a maintenance liability. Extract now as part of this spec.

**Extracted base class (`BaseOpenAICompatibleProvider`):**
```typescript
// src/providers/base-openai-provider.ts
// Contains: chat() streaming loop, non-streaming fallback, toolIndexToId tracking
// DeepSeekProvider extends BaseOpenAICompatibleProvider
// OpenAIProvider extends BaseOpenAICompatibleProvider
```

**Consequence:** Task list includes extraction as a separate task. Bugfixes to the OpenAI-compatible streaming loop are made once in the base class.

### AD-SPEC50-002: AnthropicProvider does NOT extend any base class (yet)

**Decision:** `AnthropicProvider` is a standalone class implementing `ILlmProvider`. It does not extend `BaseOpenAICompatibleProvider` because its streaming model is incompatible.

**Rationale:** The Anthropic SDK uses `client.messages.create()` with `stream: true`, SSE events (`message_start`, `content_block_*`, `message_delta`, `message_stop`), and content block arrays. Trying to force-fit this into the OpenAI-compatible streaming loop would create more complexity than it removes.

**Consequence:** `AnthropicProvider` has its own `chat()` implementation with its own streaming loop. If additional providers in the future use the Anthropic SDK (unlikely), the extraction would happen then.

### AD-SPEC50-003: Anthropic thinking configuration is inline, not via `buildThinkingRequestOptions`

**Decision:** `AnthropicProvider.chat()` constructs the `thinking` parameter directly. It does NOT call `buildThinkingRequestOptions()`.

**Rationale:** `buildThinkingRequestOptions()` returns OpenAI/DeepSeek-specific options (`thinking`, `extra_body`, `reasoning_effort`). Anthropic's thinking parameter (`{ type: "enabled" | "disabled", budget_tokens: number }`) is a different shape and semantics. Adding yet another `providerName` case to `buildThinkingRequestOptions` would make it handle three incompatible formats. Instead, each provider handles its own thinking configuration in its `chat()` method.

**Consequence:** `AnthropicProvider.chat()` builds `thinking` inline. The `buildThinkingRequestOptions` function is not modified in this spec.

### AD-SPEC50-004: Anthropic engine shares the `engines` infrastructure from Spec 40

**Decision:** No new settings schema or resolution logic is added. The `engines` field and `collectEngineEnv()` from Spec 40 already support arbitrary engine names. Only the `ENGINE_DEFAULT_BASE_URLS` map gains an `anthropic` entry.

**Rationale:** Spec 40's `engines` design is engine-agnostic — it's a `Record<string, EngineEntry>`. Adding `anthropic` is just another key, not a schema change.

**Consequence:** Zero changes to `settings-schema.ts`. The `createAnthropicClient` function reads from `engines.anthropic` using the same pattern as `createOpenAIClient` reads from `engines.openai`.

### AD-SPEC50-005: Anthropic uses `client.messages.stream()` helper, NOT raw SSE iteration

**Decision:** Use `client.messages.stream()` from the SDK, which provides typed event iteration via `for await (const event of stream)`. Do NOT use raw HTTP SSE parsing.

**Rationale:** The SDK's `stream()` method handles SSE parsing, reconnection, ping events, and provides typed `MessageStreamEvent` discriminated union. Reimplementing this in-tree would be complex and fragile.

**Consequence:** The provider imports `Anthropic` from `@anthropic-ai/sdk` and uses `stream()` for streaming.

### AD-SPEC50-006: `tool_choice: { type: "auto" }` is the default, not configurable

**Decision:** Anthropic's `tool_choice` is hardcoded to `{ type: "auto" }` (the SDK default when tools are provided). No `tool_choice` configuration is exposed.

**Rationale:** Per YAGNI from P4. No user has asked for fine-grained tool choice control. The Anthropic SDK defaults to `auto` which allows the model to decide whether to use a tool or not.

**Consequence:** `AnthropicProvider.chat()` passes `tools: anthropicTools` without `tool_choice` (implicit `auto`).

---

## Component / Module Breakdown

### Component 1: Install `@anthropic-ai/sdk`

**File:** `package.json` (MODIFY), `package-lock.json` (MODIFY)

**Purpose:** Add the Anthropic SDK as a runtime dependency.

**Action:** `npm install @anthropic-ai/sdk@^0.60.0`

**Dependencies:** None (npm install operation).

---

### Component 2: `RetryableStatusCodes` Update — 529 Overloaded

**File:** `src/common/api-retry.ts` (MODIFY)

**Purpose:** Add HTTP 529 (Anthropic's `overloaded_error`) to the retryable status codes set.

**Changes:**

```typescript
// Change from:
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503]);

// To:
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 529]);
```

And in the `isRetryableError` string matching block, add `"529"`:
```typescript
if (message.includes("429") || message.includes("502") || message.includes("503") || message.includes("529")) {
  return true;
}
```

**Dependencies:** None (pure constant change).

---

### Component 3: `ENGINE_DEFAULT_BASE_URLS` — Add Anthropic

**File:** `src/common/openai-client.ts` (MODIFY) or `src/common/anthropic-client.ts` (NEW)

**Decision:** Place in new file `src/common/anthropic-client.ts` per Component 5. The `ENGINE_DEFAULT_BASE_URLS` map in `openai-client.ts` is NOT modified — each client file manages its own defaults.

---

### Component 4: `AnthropicMessageConverter` Class

**File:** `src/common/anthropic-message-converter.ts` (NEW)

**Purpose:** Convert `SessionMessage[]` → Anthropic `MessageParam[]`. Separate system prompt extraction.

**Type imports from Anthropic SDK:**
```typescript
import type { Anthropic } from "@anthropic-ai/sdk";
type MessageParam = Anthropic.MessageParam;
type ContentBlock = Anthropic.ContentBlock;
type ToolUseBlock = Anthropic.ToolUseBlock;
type ToolResultBlock = Anthropic.ToolResultBlock;
type ThinkingBlock = Anthropic.ThinkingBlock;
type TextBlock = Anthropic.TextBlock;
type ImageBlockParam = Anthropic.ImageBlockParam;
```

**Class interface:**

```typescript
export class AnthropicMessageConverter {
  /** Cached system prompt extracted from system messages */
  private systemPrompt: string = "";

  constructor() {}

  /**
   * Build Anthropic MessageParam array from session messages.
   * System messages are extracted to `this.systemPrompt` — not included in the array.
   */
  buildMessages(
    messages: SessionMessage[],
    thinkingEnabled: boolean,
    model: string,
  ): MessageParam[];

  /**
   * Returns the accumulated system prompt from system-role messages.
   * Empty string if there are no system messages.
   */
  getSystemPrompt(): string;
}
```

**Note:** `convertToolsToAnthropic()` is a STANDALONE exported function (see Component 7), NOT a method on this class.

**Conversion logic — `convertMessage()`:**

| SessionMessage role | Anthropic MessageParam |
|---|---|
| `system` | NOT emitted. Content accumulated to `this.systemPrompt`. |
| `user` | `{ role: "user", content: [text_block, ...image_blocks] }` |
| `assistant` (no tool_calls) | `{ role: "assistant", content: [text_block] }` (+ thinking_block if reasoning) |
| `assistant` (with tool_calls) | `{ role: "assistant", content: [text_block, ...tool_use_blocks] }` (+ thinking_block) |
| `tool` | `{ role: "user", content: [tool_result_block] }` |

**Key conversion rules:**

1. **System messages:** Accumulate content with `\n\n` separator. Do NOT add to output array.
2. **User text:** Convert to `{ type: "text", text: message.content }`.
3. **User images:** Convert from `contentParams` array (which contains `{ type: "image_url", image_url: { url: "data:..." } }`) to `{ type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }`. Extract base64 data from data URL.
4. **Assistant text:** Convert to `{ type: "text", text: message.content }`.
5. **Assistant tool calls:** Extract from `messageParams.tool_calls` array. Each tool call: `{ type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) }`.
6. **Assistant thinking:** When `thinkingEnabled` and `messageParams.reasoning_content` is a string, emit `{ type: "thinking", thinking: reasoning_content, signature: signature }` block. The signature comes from `messageParams.signature` (stored during streaming).
7. **Tool results:** Extract from `messageParams.tool_call_id`. Content: `{ type: "tool_result", tool_use_id: toolCallId, content: message.content ?? "" }`. MUST be wrapped in `{ role: "user", content: [...] }` per Anthropic API.

**Storage of thinking signature:** When the message converter creates an assistant message with thinking, it includes the `signature` field. The signature is stored in `messageParams` of the `SessionMessage` by the `AnthropicProvider` during stream processing. The converter reads it:
```typescript
const messageParams = message.messageParams as {
  tool_calls?: unknown[];
  reasoning_content?: string;
  signature?: string;  // NEW: stored by AnthropicProvider
} | null | undefined;
```

**Tool pairing:** Uses the SAME `pairToolMessages()` algorithm as `OpenAIMessageConverter`. The pairing logic is extracted to a shared utility in `anthropic-message-converter.ts` (copied, not shared — the code is ~50 lines and shared utility would add import coupling).

**Interrupted tool fallback:** Same as `OpenAIMessageConverter` — injects a `tool_result` block with error JSON and `metadata.interrupted: true`.

```typescript
private buildInterruptedAnthropicToolResult(
  toolCalls: unknown[],
  toolCallId: string,
): ToolResultBlock {
  const toolFunction = this.findToolFunction(toolCalls, toolCallId);
  const toolName = /* extract name from toolFunction */;
  return {
    type: "tool_result",
    tool_use_id: toolCallId,
    content: JSON.stringify({
      ok: false,
      name: toolName,
      error: "Previous tool call did not complete.",
      metadata: { interrupted: true },
    }),
  };
}
```

**Multimodal filtering:** When `!isMultimodalModel(model)`, image blocks are filtered out of user message content arrays.

**Dependencies:**
- `@anthropic-ai/sdk` (types only — no runtime constructor call).
- `model-capabilities.ts` (`isMultimodalModel`).
- `session.ts` (`SessionMessage` type).

---

### Component 5: `createAnthropicClient` Factory

**File:** `src/common/anthropic-client.ts` (NEW)

**Purpose:** Create and cache `Anthropic` SDK client instances, resolving engine-specific credentials.

**Full implementation:**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { resolveCurrentSettings } from "../settings";

// Custom undici agent settings are shared — reuse from openai-client or create similar
// For now, use a fresh agent or the default fetch
let cachedAnthropic: Anthropic | null = null;
let cachedAnthropicKey = "";

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

export function createAnthropicClient(
  projectRoot: string = process.cwd(),
  engineName?: string,
): {
  client: Anthropic | null;
  model: string;
  thinkingEnabled: boolean;
  debugLogEnabled: boolean;
  telemetryEnabled: boolean;
  maxTokens: number;
  notify?: string;
  env: Record<string, string>;
} {
  const settings = resolveCurrentSettings(projectRoot);

  // Engine-specific default base URLs (not falling through to global DeepSeek default)
  const ENGINE_DEFAULT_BASE_URLS: Record<string, string> = {
    anthropic: "https://api.anthropic.com",
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
      baseURL = ENGINE_DEFAULT_BASE_URLS[engineName] || baseURL;
    }
  }

  if (!apiKey) {
    return {
      client: null,
      model: settings.model,
      thinkingEnabled: settings.thinkingEnabled,
      debugLogEnabled: settings.debugLogEnabled,
      telemetryEnabled: settings.telemetryEnabled,
      maxTokens: settings.maxTokens,
      notify: settings.notify,
      env: settings.env,
    };
  }

  const cacheKey = `${apiKey}::${baseURL}`;
  if (cachedAnthropic && cachedAnthropicKey === cacheKey) {
    return {
      client: cachedAnthropic,
      model: settings.model,
      thinkingEnabled: settings.thinkingEnabled,
      debugLogEnabled: settings.debugLogEnabled,
      telemetryEnabled: settings.telemetryEnabled,
      maxTokens: settings.maxTokens,
      notify: settings.notify,
      env: settings.env,
    };
  }

  cachedAnthropic = new Anthropic({ apiKey, baseURL: baseURL || undefined });
  cachedAnthropicKey = cacheKey;

  return {
    client: cachedAnthropic,
    model: settings.model,
    thinkingEnabled: settings.thinkingEnabled,
    debugLogEnabled: settings.debugLogEnabled,
    telemetryEnabled: settings.telemetryEnabled,
    maxTokens: settings.maxTokens,
    notify: settings.notify,
    env: settings.env,
  };
}
```

**Dependencies:**
- `@anthropic-ai/sdk` (runtime — constructs `Anthropic` instances).
- `settings.ts` (`resolveCurrentSettings`).

---

### Component 6: `AnthropicProvider` Class

**File:** `src/providers/anthropic-provider.ts` (NEW)

**Purpose:** Implement `ILlmProvider` for Anthropic Claude models using the `@anthropic-ai/sdk`.

**Full implementation:**

```typescript
import type AnthropicSdk from "@anthropic-ai/sdk";
import { AnthropicMessageConverter, convertToolsToAnthropic } from "../common/anthropic-message-converter";
import { DEFAULT_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
import type { ModelUsage } from "../session";
import { withRetry } from "../common/api-retry";
import { createAnthropicClient } from "../common/anthropic-client";

const CLAUDE_MODEL_PREFIX = "claude-";
const CLAUDE_HAIKU_PATTERN = /^claude-haiku/;
// Reasoning models: opus and sonnet get longer timeouts
const CLAUDE_REASONING_PATTERN = /^claude-(opus|sonnet)/;

export class AnthropicProvider implements ILlmProvider {
  readonly providerName = "anthropic";
  private readonly messageConverter: AnthropicMessageConverter;

  constructor() {
    this.messageConverter = new AnthropicMessageConverter();
  }

  supportsModel(model: string): boolean {
    return model.toLowerCase().startsWith(CLAUDE_MODEL_PREFIX);
  }

  getTimeoutMs(model: string): number {
    // Reasoning models get longer timeout (5 min vs 3 min)
    if (CLAUDE_REASONING_PATTERN.test(model.toLowerCase())) {
      return PRO_API_TIMEOUT_MS;  // 300_000
    }
    return DEFAULT_API_TIMEOUT_MS;  // 180_000
  }

  isMultimodal(_model: string): boolean {
    // All Claude 3+ models support vision
    return true;
  }

  getCheapModel(model: string): string | null {
    if (model === "claude-opus-4-8") return "claude-haiku-4-5";
    if (model === "claude-sonnet-4-5") return "claude-haiku-4-5";
    if (CLAUDE_HAIKU_PATTERN.test(model.toLowerCase())) return null;
    // Heuristic: replace "opus" or "sonnet" with "haiku"
    if (model.includes("opus") || model.includes("sonnet")) {
      return model.replace(/opus|sonnet/g, "haiku");
    }
    return null;
  }

  async *chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent> {
    const { client } = createAnthropicClient(process.cwd(), "anthropic");

    if (!client) {
      throw new Error("Anthropic API key not configured");
    }

    const providerOpts = options.providerOptions as
      | { thinkingEnabled?: boolean; reasoningEffort?: "high" | "max" }
      | undefined;
    const thinkingEnabled = providerOpts?.thinkingEnabled ?? false;

    // Build Anthropic messages
    const anthropicMessages = this.messageConverter.buildMessages(
      options.messages,
      thinkingEnabled,
      options.model,
    );
    const systemPrompt = this.messageConverter.getSystemPrompt();

    // Convert tools to Anthropic format
    const anthropicTools = options.tools && options.tools.length > 0
      ? convertToolsToAnthropic(options.tools)
      : undefined;

    // Build request body
    const requestBody: Record<string, unknown> = {
      model: options.model,
      messages: anthropicMessages,
      stream: true as const,
      max_tokens: (options.maxTokens ?? 0) > 0 ? options.maxTokens : 32768,
    };

    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }
    if (anthropicTools) {
      requestBody.tools = anthropicTools;
    }
    if (thinkingEnabled) {
      requestBody.thinking = { type: "enabled", budget_tokens: 32768 };
    } else {
      requestBody.thinking = { type: "disabled" };
    }

    if (options.temperature !== undefined && !thinkingEnabled) {
      requestBody.temperature = options.temperature;
    }

    // Use withRetry for transient failures
    const stream = await withRetry(
      async () => {
        const attemptTimeout = AbortSignal.timeout(this.getTimeoutMs(options.model));
        const attemptSignal = options.signal
          ? AbortSignal.any([options.signal, attemptTimeout])
          : attemptTimeout;
        // The Anthropic SDK's messages.create with stream:true returns a Stream
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return client.messages.create(requestBody as any, {
          signal: attemptSignal,
        });
      },
      { userSignal: options.signal },
    );

    // Convert Anthropic stream to LlmStreamEvent
    yield* this.streamToEvents(stream as AsyncIterable<AnthropicSdk.MessageStreamEvent>);
  }

  private async *streamToEvents(
    stream: AsyncIterable<AnthropicSdk.MessageStreamEvent>,
  ): AsyncIterable<LlmStreamEvent> {
    let inputTokens = 0;
    let outputTokens = 0;
    let currentToolUseId = "";
    let thinkingContent = "";
    let thinkingSignature = "";

    try {
      for await (const event of stream) {
        switch (event.type) {
          case "message_start": {
            inputTokens = event.message.usage?.input_tokens ?? 0;
            break;
          }

          case "content_block_start": {
            const block = event.content_block;
            if (block.type === "tool_use") {
              currentToolUseId = block.id;
              yield {
                type: "tool_call_start",
                id: block.id,
                name: block.name,
              };
            } else if (block.type === "thinking") {
              thinkingContent = block.thinking || "";
              thinkingSignature = block.signature || "";
            }
            break;
          }

          case "content_block_delta": {
            const delta = event.delta;
            if (delta.type === "text_delta") {
              yield { type: "text_delta", text: delta.text };
            } else if (delta.type === "input_json_delta") {
              yield {
                type: "tool_call_delta",
                id: currentToolUseId,
                arguments: delta.partial_json,
              };
            } else if (delta.type === "thinking_delta") {
              thinkingContent += delta.thinking;
              yield { type: "reasoning_delta", text: delta.thinking };
            } else if (delta.type === "signature_delta") {
              thinkingSignature = delta.signature;
            }
            break;
          }

          case "content_block_stop": {
            // Block complete — no action needed
            break;
          }

          case "message_delta": {
            outputTokens = event.usage.output_tokens;
            const usage: ModelUsage = {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens,
            };
            yield { type: "usage", usage };
            break;
          }

          case "message_stop": {
            // Stream complete
            break;
          }

          case "ping": {
            // Ignore — keepalive event
            break;
          }

          default: {
            // Unknown event type — ignore per Anthropic docs
            break;
          }
        }
      }
    } catch (error) {
      yield { type: "error", error };
      throw error;
    }
  }
}
```

**Design notes for `chat()`:**
- Returns `AsyncIterable<LlmStreamEvent>` via `streamToEvents()`.
- Uses `AnthropicMessageConverter.buildMessages()` that also separates system prompt via `getSystemPrompt()`.
- Uses `convertToolsToAnthropic()` for tool definition conversion.
- Thinking: `{ type: "enabled", budget_tokens: 32768 }` or `{ type: "disabled" }`.
- `max_tokens`: Always set (required by Anthropic API). Uses `options.maxTokens` if >0, else `32768`.
- Streaming via `client.messages.create({ stream: true })` which returns `AnthropicStream<RawMessageStreamEvent>`.
- `withRetry()` wraps the API call.
- Timeout signal is recreated per attempt.

**Error Handling:**
- Missing API key → `createAnthropicClient()` returns `client: null` → throw `Error("Anthropic API key not configured")`.
- API errors (529, 429, 502, 503) → caught by `withRetry()`, retried with backoff.
- Stream errors → yield `{ type: "error" }` then throw.

**Dependencies:**
- `@anthropic-ai/sdk` (runtime — imports `Anthropic` types and uses `client.messages.create()`).
- `anthropic-message-converter.ts` (Component 4).
- `anthropic-client.ts` (Component 5).
- `api-timeout.ts` (constants).
- `api-retry.ts` (`withRetry`).
- `llm-provider.ts` (types).

---

### Component 7: `convertToolsToAnthropic` Function

**File:** `src/common/anthropic-message-converter.ts` (NEW — co-located with converter)

**Purpose:** Convert internal `ToolDefinition[]` to Anthropic tool format.

**Implementation:**

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
      ...(tool.function.parameters.required && tool.function.parameters.required.length > 0
        ? { required: tool.function.parameters.required }
        : {}),
    },
  }));
}
```

**Note:** `additionalProperties` is NOT forwarded. Anthropic tool schemas do not accept this field.

**Dependencies:**
- `prompt.ts` (`ToolDefinition` type).

---

### Component 8: Extracted `BaseOpenAICompatibleProvider` (per AD-SPEC50-001)

**File:** `src/providers/base-openai-provider.ts` (NEW)

**Purpose:** Extract the shared streaming loop from `DeepSeekProvider.chat()` and `OpenAIProvider.chat()` into a common base class. This reduces ~120 lines of duplicated code.

**What moves to the base class:**
- Stream request construction (model, messages, tools, stream_options).
- Temperature handling (skip if thinking enabled).
- `max_tokens` handling.
- `withRetry()` call.
- Non-streaming response fallback.
- Streaming loop with `toolIndexToId` Map.
- All 6 `LlmStreamEvent` yield points.
- Error handling (yield `error`, throw).

**What stays in subclasses:**
- Constructor (client factory + converter options).
- `supportsModel()`.
- `getTimeoutMs()`.
- `isMultimodal()`.
- `getCheapModel()`.
- `buildChatCompletionRequest()` — new abstract method that subclasses implement to provide provider-specific options (thinking, providerName, etc.).

**Abstract method:**

```typescript
protected abstract buildChatCompletionRequest(
  options: LlmChatOptions,
  openaiMessages: ChatCompletionMessageParam[],
  client: OpenAI,
  baseURL: string,
): Record<string, unknown>;
```

**Base class `chat()`:**

```typescript
// src/providers/base-openai-provider.ts
import { OpenAIMessageConverter, type OpenAIMessageConverterOptions } from "../common/openai-message-converter";
import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
import type { ModelUsage } from "../session";
import type { CreateOpenAIClient } from "../tools/executor";
import { withRetry } from "../common/api-retry";

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

  /** Subclasses override this to provide provider-specific request options. */
  protected abstract buildChatCompletionRequest(
    options: LlmChatOptions,
    openaiMessages: unknown[],
    client: ReturnType<CreateOpenAIClient>["client"],
    baseURL: string,
  ): Record<string, unknown>;

  async *chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent> {
    const { client, baseURL } = this.createOpenAIClient();

    if (!client) {
      throw new Error(`${this.providerName} API key not configured`);
    }

    const openaiMessages = this.messageConverter.buildMessages(
      options.messages,
      (options.providerOptions as { thinkingEnabled?: boolean } | undefined)?.thinkingEnabled ?? false,
      options.model,
    );

    const streamRequest = this.buildChatCompletionRequest(
      options,
      openaiMessages,
      client,
      baseURL,
    );

    // ... (rest of streaming loop — identical to current DeepSeekProvider.chat())
    // ... (including toolIndexToId, non-streaming fallback, error handling)
  }
}
```

**DeepSeekProvider after extraction:**
```typescript
export class DeepSeekProvider extends BaseOpenAICompatibleProvider {
  readonly providerName = "deepseek";

  supportsModel(model: string): boolean { /* unchanged */ }
  getTimeoutMs(model: string): number { /* unchanged */ }
  isMultimodal(model: string): boolean { /* unchanged */ }
  getCheapModel(model: string): string | null { /* unchanged */ }

  protected buildChatCompletionRequest(options, messages, client, baseURL): Record<string, unknown> {
    // DeepSeek-specific: thinking options, extra_body
    const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);
    return { ...shared, ...thinkingOptions };
  }
}
```

**OpenAIProvider after extraction:**
```typescript
export class OpenAIProvider extends BaseOpenAICompatibleProvider {
  readonly providerName = "openai";

  supportsModel(model: string): boolean { /* unchanged */ }
  getTimeoutMs(model: string): number { /* unchanged */ }
  isMultimodal(model: string): boolean { /* unchanged */ }
  getCheapModel(model: string): string | null { /* unchanged */ }

  protected buildChatCompletionRequest(options, messages, client, baseURL): Record<string, unknown> {
    // OpenAI-specific: reasoning_effort as top-level parameter
    const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort, "openai");
    return { ...shared, ...thinkingOptions };
  }
}
```

**Dependencies:**
- Existing files: `deepseek-provider.ts`, `openai-provider.ts` (MODIFY — remove duplicated streaming code).
- New file: `base-openai-provider.ts`.
- `openai-message-converter.ts`, `llm-provider.ts`, `api-retry.ts`, `tools/executor.ts`.

---

### Component 9: Provider Registry Routing — Anthropic

**File:** `src/common/llm-provider-registry.ts` (MODIFY)

**Purpose:** Add `claude-` prefix routing to `AnthropicProvider`.

**Changes:**

```typescript
import { AnthropicProvider } from "../providers/anthropic-provider";

function isAnthropicModel(model: string): boolean {
  return model.toLowerCase().startsWith("claude-");
}

export function createLlmProvider(
  projectRoot: string = process.cwd(),
  converterOptions?: OpenAIMessageConverterOptions,
): CreateLlmProviderReturn {
  const settings = resolveCurrentSettings(projectRoot);

  // Route model → engine
  const engineName =
    isOpenAIModel(settings.model) ? "openai"
    : isAnthropicModel(settings.model) ? "anthropic"
    : undefined;

  // Create client factory (anthropic provider uses createAnthropicClient internally)
  const createClient: CreateOpenAIClient = () => createOpenAIClient(projectRoot, engineName);

  if (!settings.apiKey) {
    return { provider: null, createOpenAIClient: createClient };
  }

  if (engineName === "openai") {
    const { client } = createClient();
    if (!client) {
      return { provider: null, createOpenAIClient: createClient };
    }
    const provider = new OpenAIProvider(createClient, converterOptions);
    return { provider, createOpenAIClient: createClient };
  }

  if (engineName === "anthropic") {
    // AnthropicProvider does NOT use createClient (uses own createAnthropicClient).
    // It constructs its own client internally in chat().
    // createClient is still returned for backward compatibility but unused by AnthropicProvider.
    const provider = new AnthropicProvider();
    return { provider, createOpenAIClient: createClient };
  }

  // Default: DeepSeek (backward compatible)
  const provider = new DeepSeekProvider(createClient, converterOptions);
  return { provider, createOpenAIClient: createClient };
}
```

**Design decision:** `AnthropicProvider` does NOT accept a `createOpenAIClient` factory because it uses the Anthropic SDK internally. It creates its own `Anthropic` client via `createAnthropicClient()` in `chat()`. This breaks the factory injection pattern but is the correct approach — forcing Anthropic to use the OpenAI SDK would violate ADR-001.

**Dependencies:**
- `AnthropicProvider` (NEW).
- `settings.ts`, `openai-client.ts` (existing).

---

### Component 10: `DEFAULT_MODEL_PRICING` — Claude Entries

**File:** `src/common/model-capabilities.ts` (MODIFY)

**Purpose:** Add default pricing entries for Claude models.

**Changes:**

```typescript
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // ... existing DeepSeek and OpenAI entries ...
  "claude-opus-4-8":   { inputPrice: 15.00, outputPrice: 75.00, cacheReadPrice: 1.50 },
  "claude-sonnet-4-5": { inputPrice: 3.00,  outputPrice: 15.00, cacheReadPrice: 0.30 },
  "claude-haiku-4-5":  { inputPrice: 0.80,  outputPrice: 4.00,  cacheReadPrice: 0.08 },
};
```

**Note:** Prices are placeholders. MUST be verified against `https://www.anthropic.com/pricing` during implementation.

---

### Component 11: Test Files

**File:** `src/tests/anthropic-provider.test.ts` (NEW)
**File:** `src/tests/anthropic-message-converter.test.ts` (NEW)
**File:** `src/tests/anthropic-stream-converter.test.ts` (NEW — co-located or separate)

Exact test structure is specified in `task.md`.

---

## Data Flow

### Main Conversation Turn (Anthropic)

```
User sends message with model: "claude-sonnet-4-5"
  →
SessionManager.activateSession()
  →
createLlmProvider(projectRoot, converterOptions)
  → settings.model = "claude-sonnet-4-5"
  → isAnthropicModel("claude-sonnet-4-5") → true
  → engineName = "anthropic"
  → createClient = () => createOpenAIClient(projectRoot, "anthropic")
  → new AnthropicProvider()
  →
provider.chat({
  model: "claude-sonnet-4-5",
  messages: [SessionMessage, ...],
  tools: [ToolDefinition, ...],
  providerOptions: { thinkingEnabled: true, reasoningEffort: "high" },
  signal: abortSignal,
})
  →
AnthropicProvider.chat():
  1. createAnthropicClient(projectRoot, "anthropic")
     → resolveCurrentSettings(projectRoot)
     → engines.anthropic.apiKey ?? apiKey → "sk-ant-..."
     → engines.anthropic.baseURL ?? "https://api.anthropic.com"
     → client: Anthropic instance
  2. messageConverter.buildMessages(messages, true, "claude-sonnet-4-5")
     → system messages → accumulated to systemPrompt
     → user messages → [{ type: "text", text: "..." }]
     → assistant messages with tool_calls → [{ type: "text", ... }, { type: "tool_use", ... }]
     → tool messages → { role: "user", content: [{ type: "tool_result", ... }] }
     → MessageParam[]
  3. messageConverter.getSystemPrompt() → "You are DsCode..."
  4. convertToolsToAnthropic(tools) → [{ name: "bash", description: "...", input_schema: {...} }]
  5. client.messages.create({
       model: "claude-sonnet-4-5",
       system: "You are DsCode...",
       messages: [...],
       tools: [...],
       stream: true,
       max_tokens: 65536,
       thinking: { type: "enabled", budget_tokens: 32768 },
     })
  →
  streamToEvents(stream):
    event: message_start → inputTokens = 472
    event: content_block_start { type: "thinking" } → start thinking accumulation
    event: content_block_delta { type: "thinking_delta", thinking: "..." }
      → yield { type: "reasoning_delta", text: "..." }
    event: content_block_delta { type: "signature_delta", signature: "EqQBCg..." }
      → thinkingSignature = "EqQBCg..."
    event: content_block_stop → thinking block complete
    event: content_block_start { type: "text", text: "" }
    event: content_block_delta { type: "text_delta", text: "I'll" }
      → yield { type: "text_delta", text: "I'll" }
    event: content_block_delta { type: "text_delta", text: " help" }
      → yield { type: "text_delta", text: " help" }
    event: content_block_stop
    event: content_block_start { type: "tool_use", id: "toolu_01...", name: "read" }
      → yield { type: "tool_call_start", id: "toolu_01...", name: "read" }
    event: content_block_delta { type: "input_json_delta", partial_json: "{\"file_path\":\"/foo\"}" }
      → yield { type: "tool_call_delta", id: "toolu_01...", arguments: "{\"file_path\":\"/foo\"}" }
    event: content_block_stop
    event: message_delta { usage: { output_tokens: 89 }, stop_reason: "tool_use" }
      → yield { type: "usage", usage: { prompt_tokens: 472, completion_tokens: 89, total_tokens: 561 } }
    event: message_stop
  →
SessionManager iterates, aggregates, builds SessionMessage (identical flow)
```

### Compaction Flow (Anthropic)

```
SessionManager.compactSession()
  →
createLlmProvider() → AnthropicProvider
  →
provider.getCheapModel?.("claude-sonnet-4-5") → "claude-haiku-4-5"
  →
provider.chat({
  model: "claude-haiku-4-5",
  messages: [{ role: "user", content: compactionPrompt }],
  signal: abortSignal,
})
  →
AnthropicProvider.chat():
  - providerOptions undefined → thinkingEnabled = false
  - thinking: { type: "disabled" }
  - client.messages.create({ model: "claude-haiku-4-5", messages: [...], stream: true, max_tokens: 32768, thinking: { type: "disabled" } })
  →
  yield { type: "text_delta", text: '{"summary":"..."}' }
  yield { type: "usage", usage: { ... } }
  →
SessionManager aggregates, parses JSON summary
```

---

## Data Structures

| Type | File | Change |
|---|---|---|
| `AnthropicMessageParam` | Anthropic SDK types | Existing (from `@anthropic-ai/sdk`) |
| `BaseOpenAICompatibleProvider` | `src/providers/base-openai-provider.ts` | NEW abstract class |
| `AnthropicMessageConverter` | `src/common/anthropic-message-converter.ts` | NEW class |
| `convertToolsToAnthropic` | `src/common/anthropic-message-converter.ts` | NEW function |
| `createAnthropicClient` | `src/common/anthropic-client.ts` | NEW function |
| `AnthropicProvider` | `src/providers/anthropic-provider.ts` | NEW class |
| `DEFAULT_MODEL_PRICING` | `src/common/model-capabilities.ts` | MODIFY (add 3 entries) |
| `RETRYABLE_STATUS_CODES` | `src/common/api-retry.ts` | MODIFY (add 529) |
| `createLlmProvider` | `src/common/llm-provider-registry.ts` | MODIFY (add claude- routing) |
| `DeepSeekProvider` | `src/providers/deepseek-provider.ts` | MODIFY (extend base class) |
| `OpenAIProvider` | `src/providers/openai-provider.ts` | MODIFY (extend base class) |

---

## File / Module Layout

```
src/
├── common/
│   ├── anthropic-message-converter.ts  (NEW — ~350 lines)
│   ├── anthropic-client.ts             (NEW — ~80 lines)
│   ├── api-retry.ts                    (MODIFY — add 529)
│   ├── llm-provider-registry.ts        (MODIFY — add Anthropic routing)
│   ├── model-capabilities.ts           (MODIFY — add Claude pricing)
│   └── openai-message-converter.ts     (UNCHANGED)
│
├── providers/
│   ├── base-openai-provider.ts         (NEW — ~180 lines, extracted from deepseek + openai)
│   ├── deepseek-provider.ts            (MODIFY — extend base, remove streaming loop)
│   ├── openai-provider.ts              (MODIFY — extend base, remove streaming loop)
│   └── anthropic-provider.ts           (NEW — ~250 lines)
│
└── tests/
    ├── anthropic-provider.test.ts      (NEW — ~200 lines)
    ├── anthropic-message-converter.test.ts (NEW — ~250 lines)
    ├── base-openai-provider.test.ts    (NEW — ~150 lines, or add to existing tests)
    └── session.test.ts                 (MODIFY — add Anthropic mocks)
```

---

## Testing Strategy

### `anthropic-message-converter.test.ts`

| Test | What it verifies |
|---|---|
| System messages extracted, not in MessageParam[] | `getSystemPrompt()` returns concatenated system content |
| User text message → `{ role: "user", content: [{ type: "text", text: "..." }] }` | Correct content block structure |
| User image message → `{ role: "user", content: [{ type: "image", source: {...} }] }` | Image data URL parsed correctly |
| Assistant text message → `{ role: "assistant", content: [{ type: "text", ... }] }` | No tool_use blocks |
| Assistant with tool calls → `{ content: [text_block, tool_use_block] }` | Tool calls converted to tool_use blocks |
| Assistant with thinking → `{ content: [thinking_block, text_block] }` | Reasoning content + signature in thinking block |
| Tool result → `{ role: "user", content: [{ type: "tool_result", ... }] }` | Correct role wrapping |
| Interrupted tool → `{ type: "tool_result", content: "..." }` with metadata.interrupted | Fallback injection |
| Compaction filtering → compacted messages excluded | Same as OpenAIMessageConverter |
| Multimodal filtering → images removed for non-multimodal model | `isMultimodalModel()` respected |
| Empty messages → empty array | No crash |

### `anthropic-provider.test.ts`

| Test | What it verifies |
|---|---|
| `supportsModel("claude-sonnet-4-5")` → true | Prefix matching |
| `supportsModel("gpt-5.4")` → false | Non-claude models |
| `getTimeoutMs("claude-sonnet-4-5")` → 300000 | Reasoning models |
| `getTimeoutMs("claude-haiku-4-5")` → 180000 | Non-reasoning models |
| `isMultimodal()` → true for all models | All Claude models multimodal |
| `getCheapModel("claude-opus-4-8")` → "claude-haiku-4-5" | Opus → Haiku |
| `getCheapModel("claude-haiku-4-5")` → null | Already cheap |
| `chat()` yields `text_delta` events | Mock stream, verify text |
| `chat()` yields `reasoning_delta` events | Mock thinking_delta stream |
| `chat()` yields `tool_call_start` + `tool_call_delta` | Mock tool_use stream |
| `chat()` yields `usage` event | Mock message_delta with usage |
| `chat()` throws when API key missing | Mock null client |
| `chat()` respects abort signal | Signal composition |
| `chat()` retries on 529 overloaded_error | withRetry test |
| `chat()` sets `thinking: { type: "disabled" }` when disabled | Verify request body |
| `chat()` sets `system` parameter when system prompt exists | Verify API call params |

### `anthropic-stream-converter.test.ts` (or inline in provider test)

| Test | What it verifies |
|---|---|
| `message_start` → stores input_tokens | No yield, token stored |
| `content_block_start (tool_use)` → yields `tool_call_start` | Correct id and name |
| `content_block_delta (text_delta)` → yields `text_delta` | Text passthrough |
| `content_block_delta (input_json_delta)` → yields `tool_call_delta` | Partial JSON passthrough |
| `content_block_delta (thinking_delta)` → yields `reasoning_delta` | Thinking → reasoning |
| `content_block_delta (signature_delta)` → stores signature | No yield |
| `message_delta with usage` → yields `usage` with combined tokens | Correct ModelUsage shape |
| `ping` event → ignored | No yield, no error |
| Unknown event → ignored | Graceful skip |
| Error event → yields `error`, throws | Error propagation |

### `base-openai-provider.test.ts`

| Test | What it verifies |
|---|---|
| DeepSeekProvider.chat() works after extraction | Backward compat |
| OpenAIProvider.chat() works after extraction | Backward compat |
| Stream parsing identical to before | Same yield sequence |

---

## Migration / Rollback

**Migration:** Users with existing `settings.json` need no changes. The `engines.anthropic` field is optional — the Anthropic provider is only instantiated when the model starts with `claude-`.

**Rollback:** Revert to the commit before this spec. The only persistent state change is the `@anthropic-ai/sdk` dependency in `package.json`. `npm install` restores previous state. No database or settings file migrations are required.

**Breaking changes:** None. Existing providers (DeepSeek, OpenAI) continue to work identically. The extraction of `BaseOpenAICompatibleProvider` is a refactoring that preserves behavior — all existing tests must pass after extraction.
