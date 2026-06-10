# Spec 30: provider-agnostic-llm-layer — Design

## Design Approach

This spec follows **extract-don't-rewrite**: all existing logic is moved, not changed. The `DeepSeekProvider.chat()` method is assembled from code that currently lives in three places:

1. `SessionManager.createChatCompletionStream()` — stream calling and chunk parsing.
2. `OpenAIMessageConverter.buildMessages()` — message format conversion.
3. `buildThinkingRequestOptions()` — thinking mode configuration.

The assembly point is `DeepSeekProvider.chat()`, which becomes a self-contained async generator. `SessionManager` is reduced to an orchestrator that iterates `LlmStreamEvent` and handles cross-cutting concerns (debug logging, budget tracking, progress emission).

**Principles applied:**
- **P1 (Interface-First):** `SessionManager` depends on `ILlmProvider`, never on `DeepSeekProvider`.
- **P2 (Canonical Types):** `SessionMessage` flows in; `LlmStreamEvent` flows out. No OpenAI types cross the boundary.
- **P3 (Streaming-First):** `chat()` returns `AsyncIterable<LlmStreamEvent>` — every response is streaming.
- **P4 (Surgical Changes):** Only code that must move is moved. Adjacent code is untouched.
- **P5 (Test Integrity):** All existing tests pass; only mocks are updated.

---

## Architecture Decisions

### AD-SPEC30-001: Provider handles timeouts internally

The provider applies API timeouts using `AbortSignal.any([options.signal, timeoutSignal])`. SessionManager does NOT wrap the signal — it passes the user's abort signal directly. The rationale: timeout duration is model-specific knowledge (pro = 5min, flash = 3min), which belongs in the provider via `getTimeoutMs()`.

### AD-SPEC30-002: Provider handles message conversion internally

`SessionManager` passes raw `SessionMessage[]` to `provider.chat()`. The provider creates its own `OpenAIMessageConverter` instance and calls `buildMessages()` internally. This means:
- `SessionManager` no longer imports `ChatCompletionMessageParam`.
- `SessionManager` no longer calls `buildMessages()`.
- `SectionManager` keeps its own `OpenAIMessageConverter` instance solely for `findToolFunction()`, `getTrailingPendingToolCallMessage()`, and `buildInterruptedToolResult()`.

### AD-SPEC30-003: `createOpenAIClient` stays for backward compatibility

The `ToolExecutor` and tool handlers (WebSearch) still need raw OpenAI client access. Rather than abstracting the entire tool layer in this spec, we keep `createOpenAIClient` as a separate return value from the factory. The factory returns both `{ provider: ILlmProvider | null, createOpenAIClient: CreateOpenAIClient }`. SessionManager passes `createOpenAIClient` to `ToolExecutor` unchanged. This is documented tech debt to be resolved in Spec 40.

### AD-SPEC30-004: Compaction goes through provider

`compactSession()` uses `provider.chat()` like the main loop. It constructs a minimal `SessionMessage` for the compaction prompt and passes it to the provider. The compaction model resolution (`resolvedModel.includes("pro") ? resolvedModel.replace("pro", "flash") : resolvedModel`) stays in `SessionManager` for now — it will move to a provider method in Spec 60.

---

## Component / Module Breakdown

### Component 1: `ILlmProvider` Interface

**File:** `src/common/llm-provider.ts` (NEW)

**Purpose:** Define the contract all LLM providers must implement.

**Interface:**

```typescript
import type { SessionMessage, ModelUsage } from "../session";
import type { ToolDefinition } from "../prompt";

export type LlmStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; arguments: string }
  | { type: "usage"; usage: ModelUsage }
  | { type: "error"; error: unknown };

export type LlmChatOptions = {
  model: string;
  messages: SessionMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  providerOptions?: Record<string, unknown>;
};

export interface ILlmProvider {
  readonly providerName: string;
  supportsModel(model: string): boolean;
  chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent>;
  getTimeoutMs(model: string): number;
  isMultimodal(model: string): boolean;
}
```

Note: `providerOptions` carries opaque provider-specific data. For `DeepSeekProvider`, it will contain `{ thinkingEnabled: boolean, reasoningEffort?: "high" | "max" }`.

**Dependencies:**
- `session.ts` (imports `SessionMessage`, `ModelUsage` types).
- `prompt.ts` (imports `ToolDefinition` type).

**Error Handling:** The interface itself has no error handling. Implementations may `throw` from `chat()` (network errors, auth errors) or yield `{ type: "error" }` events for non-fatal stream errors.

---

### Component 2: `DeepSeekProvider` Class

**File:** `src/providers/deepseek-provider.ts` (NEW)

**Purpose:** Implement `ILlmProvider` for the DeepSeek API (OpenAI-compatible). This is the only provider in Spec 30.

**Constructor:**

```typescript
import { createOpenAIClient, type CreateOpenAIClient } from "../common/openai-client";
import { OpenAIMessageConverter, type OpenAIMessageConverterOptions } from "../common/openai-message-converter";
import { buildThinkingRequestOptions } from "../common/openai-thinking";
import { DEFAULT_API_TIMEOUT_MS, FLASH_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
import { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
import type { ModelUsage, SessionMessage } from "../session";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const DEEPSEEK_MODEL_PREFIX = "deepseek-";
const NON_MULTIMODAL_DEEPSEEK_MODELS = new Set(["deepseek-v4-pro", "deepseek-v4-flash"]);

export class DeepSeekProvider implements ILlmProvider {
  readonly providerName = "deepseek";
  private readonly messageConverter: OpenAIMessageConverter;

  constructor(
    private readonly createOpenAIClient: CreateOpenAIClient,
    converterOptions: OpenAIMessageConverterOptions = {},
  ) {
    this.messageConverter = new OpenAIMessageConverter(converterOptions);
  }

  supportsModel(model: string): boolean {
    return model.toLowerCase().startsWith(DEEPSEEK_MODEL_PREFIX);
  }

  getTimeoutMs(model: string): number {
    if (model === "deepseek-v4-pro") return PRO_API_TIMEOUT_MS;   // 300_000
    if (model === "deepseek-v4-flash") return FLASH_API_TIMEOUT_MS; // 180_000
    return DEFAULT_API_TIMEOUT_MS;                                 // 180_000
  }

  isMultimodal(model: string): boolean {
    return !NON_MULTIMODAL_DEEPSEEK_MODELS.has(model.trim());
  }

  // Primary method — see Component 3 for data flow
  async *chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent> {
    // ... implementation detailed in Data Flow section
  }
}
```

**Internal Logic (chat method):**

```
1. Call this.createOpenAIClient() → get { client, baseURL, ... }
2. If client is null: throw Error("DeepSeek API key not configured")
3. Resolve thinkingEnabled and reasoningEffort from options.providerOptions
4. Convert messages: this.messageConverter.buildMessages(options.messages, thinkingEnabled, options.model)
5. Build thinking options: buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort)
6. Build timeout signal: AbortSignal.timeout(this.getTimeoutMs(options.model))
7. Compose abort signal: if options.signal, use AbortSignal.any([options.signal, timeoutSignal]), else use timeoutSignal
8. Build streamRequest body with conditional fields:
   const streamRequest: Record<string, unknown> = {
     model: options.model,
     messages: openaiMessages,
     tools: options.tools ?? [],
     stream: true,
     stream_options: { include_usage: true },
     ...thinkingOptions,
   };
   if (options.temperature !== undefined && !thinkingEnabled) {
     streamRequest.temperature = options.temperature;
   }
   if ((options.maxTokens ?? 0) > 0) {
     streamRequest.max_tokens = options.maxTokens;
   }
   // NOTE: user_id is intentionally NOT included (provider has no sessionId).
9. Call client.chat.completions.create(streamRequest, { signal: composedSignal })
10. For each chunk in the stream:
    a. If chunk has "usage": yield { type: "usage", usage: chunk.usage as ModelUsage }
    b. For each choice in chunk.choices:
       - Extract delta = choice.delta
       - If delta.content is string: yield { type: "text_delta", text: delta.content }
       - If delta.reasoning_content or delta.reasoning is string: yield { type: "reasoning_delta", text: delta.reasoning_content ?? delta.reasoning }
       - If delta.refusal is string: yield { type: "text_delta", text: delta.refusal }
       - If delta.tool_calls is array:
         For each rawToolCall in delta.tool_calls:
           - Extract id, function.name, function.arguments
           - If id is present (first chunk for this tool call): yield { type: "tool_call_start", id, name: function.name ?? "" }
           - If function.arguments is present: yield { type: "tool_call_delta", id: id ?? "", arguments: function.arguments }
11. If any error occurs during iteration: yield { type: "error", error: formatError(error) } then throw
```

**Dependencies:**
- `openai-client.ts` — `createOpenAIClient` function (existing).
- `openai-message-converter.ts` — `OpenAIMessageConverter` class (existing).
- `openai-thinking.ts` — `buildThinkingRequestOptions` function (existing).
- `api-timeout.ts` — `DEFAULT_API_TIMEOUT_MS`, `FLASH_API_TIMEOUT_MS`, `PRO_API_TIMEOUT_MS` constants (existing).
- `llm-provider.ts` — `ILlmProvider`, `LlmStreamEvent`, `LlmChatOptions` types (new).
- `session.ts` — `ModelUsage`, `SessionMessage` types (existing).

**Error Handling:**
- Missing API key → throw `Error("DeepSeek API key not configured")`.
- Network errors during `client.chat.completions.create()` → thrown, caught by SessionManager.
- Stream errors during iteration → yield `{ type: "error" }` then throw.
- Invalid/empty chunks → skip, continue to next chunk.

---

### Component 3: Provider Factory

**File:** `src/common/llm-provider-registry.ts` (NEW)

**Purpose:** Create the correct `ILlmProvider` instance based on settings. In Spec 30, always returns `DeepSeekProvider`. Future specs will add model-based dispatch.

**Interface:**

```typescript
import { resolveCurrentSettings } from "../settings";
import { createOpenAIClient } from "./openai-client";
import { DeepSeekProvider } from "../providers/deepseek-provider";
import type { ILlmProvider } from "./llm-provider";
import type { OpenAIMessageConverterOptions } from "./openai-message-converter";
import type { CreateOpenAIClient } from "../tools/executor";

export type CreateLlmProviderReturn = {
  provider: ILlmProvider | null;
  createOpenAIClient: CreateOpenAIClient;
};

export function createLlmProvider(
  projectRoot: string = process.cwd(),
  converterOptions?: OpenAIMessageConverterOptions,
): CreateLlmProviderReturn {
  const settings = resolveCurrentSettings(projectRoot);
  const createClient = () => createOpenAIClient(projectRoot);

  if (!settings.apiKey) {
    return { provider: null, createOpenAIClient: createClient };
  }

  const provider = new DeepSeekProvider(createClient, converterOptions);
  return { provider, createOpenAIClient: createClient };
}
```

**Dependencies:**
- `settings.ts` — `resolveCurrentSettings` function (existing).
- `openai-client.ts` — `createOpenAIClient` function (existing).
- `deepseek-provider.ts` — `DeepSeekProvider` class (new).
- `llm-provider.ts` — `ILlmProvider` type (new).

---

### Component 4: `SessionManager` Modifications

**File:** `src/session.ts` (MODIFY)

**Purpose:** Replace direct OpenAI SDK usage with `ILlmProvider.chat()`.

**Changes:**

#### 4a. Constructor

Add `createLlmProvider` option:

```typescript
type SessionManagerOptions = {
  // ... existing fields unchanged ...
  createOpenAIClient: CreateOpenAIClient;        // KEPT for tool executor
  createLlmProvider?: (converterOptions?: OpenAIMessageConverterOptions) => CreateLlmProviderReturn;  // NEW (optional)
};
```

When `createLlmProvider` is not provided, the constructor defaults to a factory that:
1. Calls `this.createOpenAIClient()` to check for a valid client.
2. If the client is null, returns `{ provider: null, createOpenAIClient }` — same behavior as old null-client check.
3. If the client exists, creates a `DeepSeekProvider` with the configured `createOpenAIClient` and `converterOptions`.

This default ensures backward compatibility with existing tests and UI code that don't pass `createLlmProvider`, while still enabling the provider-based flow when a valid client is configured.
```

Store in instance:

```typescript
private readonly createLlmProvider: (converterOptions?: OpenAIMessageConverterOptions) => CreateLlmProviderReturn;
```

#### 4b. Removed method

- `createChatCompletionStream()` — ENTIRELY REMOVED. Its logic moves to `DeepSeekProvider.chat()`.

#### 4c. Removed imports from session.ts

```
- import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";   // REMOVE
- import { buildThinkingRequestOptions } from "./common/openai-thinking";                 // REMOVE
```

#### 4d. New imports in session.ts

```
+ import type { ILlmProvider, LlmStreamEvent } from "./common/llm-provider";
+ import { createLlmProvider, type CreateLlmProviderReturn } from "./common/llm-provider-registry";
```

#### 4e. Modified `activateSession` main loop

Old code (conceptual):

```typescript
const { client, model, baseURL, thinkingEnabled, reasoningEffort, ... } = this.createOpenAIClient();
const messages = this.messageConverter.buildMessages(sessionMessages, thinkingEnabled, model);
const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, currentReasoningEffort);
const response = await this.createChatCompletionStream(client, {
  model, messages, tools: cachedTools, ...thinkingOptions
}, { signal }, sessionId, debug);
const message = response.choices?.[0]?.message;
const content = message?.content;
const toolCalls = message?.tool_calls;
const thinking = message?.reasoning_content;
```

New code:

```typescript
const { provider } = this.createLlmProvider(this.buildConverterOptions());
if (!provider) { /* handle missing API key — same as today */ return; }

// Get settings from createOpenAIClient (model, temperature, maxTokens, thinkingEnabled, etc.)
// getResolvedSettings() does NOT include these — they come from settings → openai-client.
const { model, temperature, maxTokens, thinkingEnabled, reasoningEffort, debugLogEnabled, baseURL } = this.createOpenAIClient();

const stream = provider.chat({
  model,
  messages: this.listSessionMessages(sessionId),
  tools: cachedTools,
  temperature: thinkingEnabled ? undefined : temperature,
  maxTokens: maxTokens > 0 ? maxTokens : undefined,
  signal: sessionController.signal,
  providerOptions: { thinkingEnabled, reasoningEffort: currentReasoningEffort },
});

// Iterate and aggregate
let content = "";
let reasoningContent = "";
let usage: ModelUsage | null = null;
const toolCallsByIndex = new Map<number, { id?: string; type?: string; function?: { name?: string; arguments?: string } }>();

// NOTE: refusal text is emitted as text_delta by the provider (see EC-11).
// This is an intentional simplification — refusal content is merged into the main
// content stream rather than tracked separately. The old `message.refusal` field
// is no longer set. This is acceptable because refusal is extremely rare in
// practice (content moderation only) and the text is more useful as visible
// content than hidden metadata.

for await (const event of stream) {
  if (event.type === "usage") {
    usage = event.usage;
    continue;
  }
  if (event.type === "text_delta") {
    content += event.text;
    trackText(event.text);
    continue;
  }
  if (event.type === "reasoning_delta") {
    reasoningContent += event.text;
    trackText(event.text);
    continue;
  }
  if (event.type === "tool_call_start") {
    const index = toolCallsByIndex.size;  // approximate index assignment
    toolCallsByIndex.set(index, { id: event.id, type: "function", function: { name: event.name, arguments: "" } });
    trackText(event.name);
    continue;
  }
  if (event.type === "tool_call_delta") {
    // Find the tool call by id and append arguments
    for (const [, tc] of toolCallsByIndex) {
      if (tc.id === event.id) {
        tc.function!.arguments! += event.arguments;
        trackText(event.arguments);
        break;
      }
    }
    continue;
  }
  if (event.type === "error") {
    // Error already logged by provider; break out
    throw event.error;
  }
}

// Build final message (same as before, except refusal is no longer set)
const toolCallsArray = Array.from(toolCallsByIndex.entries())
  .sort(([a], [b]) => a - b)
  .map(([, tc]) => tc);
const normalizedToolCalls = this.normalizeLlmToolCalls(toolCallsArray);
const message: Record<string, unknown> = { content };
if (normalizedToolCalls) message.tool_calls = normalizedToolCalls;
if (reasoningContent.length > 0) message.reasoning_content = reasoningContent;
// refusal is intentionally not set — refusal text flows through text_delta into content
```

#### 4f. Modified `compactSession`

Old code:

```typescript
const response = await this.createChatCompletionStream(
  client,
  { model: compactionModel, messages: [{ role: "user", content: compactPrompt }] },
  signal ? { signal } : undefined,
  sessionId,
  debug
);
```

New code:

```typescript
const { provider } = this.createLlmProvider();
if (!provider) return;

const compactMessage: SessionMessage = {
  id: crypto.randomUUID(),
  sessionId,
  role: "user",
  content: compactPrompt,
  contentParams: null,
  messageParams: null,
  compacted: false,
  visible: false,
  createTime: new Date().toISOString(),
  updateTime: new Date().toISOString(),
};

let compactedContent = "";
let compactionUsage: ModelUsage | null = null;
for await (const event of provider.chat({
  model: compactionModel,
  messages: [compactMessage],
  signal: signal ?? undefined,
})) {
  if (event.type === "text_delta") compactedContent += event.text;
  if (event.type === "usage") compactionUsage = event.usage;
}
// compactionUsage is used by recordBudgetCost (existing logic, same as before)

// Parse compactedContent as JSON (existing logic preserved)
```

#### 4g. Preserved in SessionManager

- `messageConverter` instance — KEPT for `findToolFunction()`, `getTrailingPendingToolCallMessage()`, `buildInterruptedToolResult()`.
- `createOpenAIClient` — KEPT and passed to `ToolExecutor` constructor.
- `buildAssistantMessage()`, `addSessionSystemMessage()`, `appendToolMessages()`, etc. — UNCHANGED.
- All debug logging (`logChatCompletionDebug`) and API error logging (`logApiError`) — PRESERVED with same call signatures.
- Stream progress (`emitLlmStreamProgress`) — PRESERVED.
- Budget tracking (`recordBudgetCost`) — PRESERVED.

---

### Component 5: `api-timeout.ts` Cleanup

**File:** `src/common/api-timeout.ts` (MODIFY)

**Purpose:** Remove model-specific timeout logic. The constants remain (imported by DeepSeekProvider).

**Changes:**

- `resolveApiTimeoutMs()` — remove the two `if (model === "deepseek-v4-...")` branches. Keep env var parsing and default return.
- `PRO_API_TIMEOUT_MS`, `FLASH_API_TIMEOUT_MS`, `DEFAULT_API_TIMEOUT_MS`, `MIN_API_TIMEOUT_MS` — keep exported, used by DeepSeekProvider.

**Old (lines 37-43):**

```typescript
  if (model) {
    if (model === "deepseek-v4-pro") { return PRO_API_TIMEOUT_MS; }
    if (model === "deepseek-v4-flash") { return FLASH_API_TIMEOUT_MS; }
  }
```

**New:** Remove these 5 lines.

---

### Component 6: `model-capabilities.ts` Cleanup

**File:** `src/common/model-capabilities.ts` (MODIFY)

**Purpose:** Remove `DEEPSEEK_V4_MODELS` export.

**Changes:**

- `export const DEEPSEEK_V4_MODELS` → remove the `export` keyword (or move to deepseek-provider.ts).
- All other exports unchanged (`NON_MULTIMODAL_MODELS`, `isMultimodalModel`, `defaultsToThinkingMode`, `ModelPricing`, `DEFAULT_MODEL_PRICING`, `computeUsageCost`, `computeSessionCost`, `formatTokenCount`, `formatCost`).

---

## Data Flow

### Main Conversation Turn

```
User sends message
  →
SessionManager.activateSession()
  →
createLlmProvider() → DeepSeekProvider
  →
provider.chat({
  model: "deepseek-v4-pro",
  messages: [SessionMessage, ...],
  tools: [ToolDefinition, ...],
  providerOptions: { thinkingEnabled: true, reasoningEffort: "max" },
  signal: abortSignal,
})
  →
DeepSeekProvider.chat():
  1. createOpenAIClient() → { client: OpenAI, baseURL, ... }
  2. messageConverter.buildMessages(messages, true, model) → ChatCompletionMessageParam[]
  3. buildThinkingRequestOptions(true, baseURL, "max") → { thinking: { type: "enabled" }, extra_body: { reasoning_effort: "max" } }
  4. client.chat.completions.create({ model, messages, tools, stream: true, ... })
  →
  yield { type: "reasoning_delta", text: "Let me think..." }
  yield { type: "text_delta", text: "I will read" }
  yield { type: "tool_call_start", id: "call_1", name: "read" }
  yield { type: "tool_call_delta", id: "call_1", arguments: "{\"file" }
  yield { type: "tool_call_delta", id: "call_1", arguments: "_path\":..." }
  yield { type: "usage", usage: { prompt_tokens: 1500, completion_tokens: 80, ... } }
  →
SessionManager iterates:
  - Aggregates text → "I will read"
  - Aggregates reasoning → "Let me think..."
  - Tracks tool calls → [{ id: "call_1", function: { name: "read", arguments: "..." } }]
  - Captures usage → ModelUsage object
  - Emits stream progress events → UI updates
  →
SessionManager builds final message:
  { content: "I will read", tool_calls: [...], reasoning_content: "Let me think..." }
  →
SessionManager appends message → UI renders → tool execution begins
```

### Compaction Flow

```
SessionManager.compactSession()
  →
createLlmProvider() → DeepSeekProvider
  →
provider.chat({
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: compactionPrompt }],
  signal: abortSignal,
})
  →
DeepSeekProvider.chat():
  - No providerOptions → thinking defaults to disabled
  - messageConverter.buildMessages([compactMsg], false, "deepseek-v4-flash") → simple user message
  - buildThinkingRequestOptions(false, ...) → { thinking: { type: "disabled" } }
  - client.chat.completions.create({ model: "deepseek-v4-flash", messages: [...], stream: true })
  →
  yield { type: "text_delta", text: '{"summary":"..."}' }
  yield { type: "usage", usage: { ... } }
  →
SessionManager iterates, aggregates, parses JSON summary
```

---

## Data Structures

All data structures remain unchanged from the existing codebase:

| Type | File | Changed? |
|---|---|---|
| `SessionMessage` | `session.ts` | ❌ No |
| `ModelUsage` | `session.ts` | ❌ No |
| `ToolDefinition` | `prompt.ts` | ❌ No |
| `ToolCall` | `tools/executor.ts` | ❌ No |
| `ModelPricing` | `model-capabilities.ts` | ❌ No |
| `CreateOpenAIClient` | `tools/executor.ts` | ❌ No |

New types (all in `src/common/llm-provider.ts`):

| Type | Description |
|---|---|
| `ILlmProvider` | Interface with 5 methods |
| `LlmStreamEvent` | Discriminated union, 6 variants |
| `LlmChatOptions` | Input options for `chat()` |

---

## File / Module Layout

```
src/
├── common/
│   ├── llm-provider.ts              ← NEW: interface + types
│   ├── llm-provider-registry.ts     ← NEW: factory function
│   ├── openai-client.ts             ← KEEP (unchanged)
│   ├── openai-message-converter.ts  ← KEEP (unchanged)
│   ├── openai-thinking.ts           ← KEEP (unchanged)
│   ├── api-timeout.ts               ← MODIFY (remove model checks)
│   ├── model-capabilities.ts        ← MODIFY (remove DEEPSEEK_V4_MODELS export)
│   └── ... all other files unchanged
├── providers/
│   └── deepseek-provider.ts         ← NEW: DeepSeekProvider class
├── session.ts                       ← MODIFY (use ILlmProvider)
└── tools/
    └── executor.ts                  ← KEEP (unchanged — CreateOpenAIClient stays)
```

---

## Testing Strategy

### Tests That MUST Pass Unchanged

All existing tests in these files pass without modification:
- `openai-message-converter.test.ts`
- `openai-thinking.test.ts`
- `prompt.test.ts`
- `budget-tracker.test.ts`
- `tool-executor.test.ts`
- `tool-handlers.test.ts`
- `web-search-handler.test.ts`
- All UI tests

### Tests That Need Mock Updates

**`session.test.ts`** — tests that mock `createOpenAIClient`:

1. Mocks that set `createOpenAIClient` to return `{ client: mockOpenAI, ... }` must also set `createLlmProvider` to return a mock provider.
2. The mock provider must implement `ILlmProvider` — a simple object with `chat()` returning an async generator.
3. `chat()` mock must yield `LlmStreamEvent` objects mimicking the OpenAI stream shape.
4. Tests for `createChatCompletionStream` are REMOVED (method no longer exists).

**New tests for `DeepSeekProvider.chat()`:**

1. Test that `chat()` yields `text_delta` events for text content.
2. Test that `chat()` yields `reasoning_delta` for reasoning content.
3. Test that `chat()` yields `tool_call_start` + `tool_call_delta` for tool calls.
4. Test that `chat()` yields `usage` for usage chunks.
5. Test that `chat()` respects `signal` (aborts when signalled).
6. Test that `chat()` applies timeout via `getTimeoutMs()`.
7. Test that `chat()` throws when API key is missing.

### Test Fixtures

A reusable mock provider factory for tests:

```typescript
function createMockProvider(events: LlmStreamEvent[]): ILlmProvider {
  return {
    providerName: "mock",
    supportsModel: () => true,
    getTimeoutMs: () => 180_000,
    isMultimodal: () => false,
    chat: async function* () {
      for (const event of events) {
        yield event;
      }
    },
  };
}
```

---

## Migration / Rollback

**Migration:** This spec is a pure refactoring — no data migration, no config migration, no user action required. The settings schema is unchanged. Session files are unchanged.

**Rollback:** Revert the commit. All changed files are internal wiring. No API contracts, data formats, or user-facing behavior changed.
