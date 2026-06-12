# Spec 70: google-gemini-provider — Design

## Design Approach

This spec follows the **add-don't-rewrite** principle with a critical innovation: Gemini is the FIRST provider that uses **zero SDK** — pure Node 24 `fetch()` with manual SSE parsing. This is the ultimate proof that the `ILlmProvider` interface from Spec 30 is truly provider-agnostic.

Key design decisions:
1. **No SDK** — Raw HTTP fetch (Node 24 built-in) instead of `@google/genai` SDK. Gemini's REST API is simple enough: POST JSON, receive SSE.
2. **New message converter** — `GeminiMessageConverter` (parts-based format).
3. **New client factory** — `createGeminiClient()` returns configuration, not an SDK instance.
4. **New stream parser** — SSE `data:` line parser → `LlmStreamEvent` converter.
5. **New thinking config** — `thinkingConfig` in `generationConfig` (Gemini-specific).

**Principles applied:**
- **P1 (Interface-First):** `GeminiProvider` implements `ILlmProvider`. SessionManager never imports or references Gemini-specific code.
- **P2 (Canonical Types):** Uses `SessionMessage` → Gemini `Content` conversion internally. Emits `LlmStreamEvent`.
- **P3 (Streaming-First):** SSE streaming via fetch `ReadableStream`, converted to `AsyncIterable<LlmStreamEvent>`.
- **P4 (Surgical Changes):** Only files that must change are changed. Existing providers untouched.
- **P5 (Test Integrity):** All existing tests pass. New tests for new code only.
- **P6 (Zero New Dependencies Without Justification):** ZERO new dependencies — `fetch()` is built into Node 24.
- **P7 (Provider-Agnostic Configuration):** Gemini uses the `engines` namespace.

---

## Architecture Decisions

### AD-SPEC70-001: No Google GenAI SDK — Raw Fetch Instead

**Decision:** Do NOT install `@google/genai`. Use Node 24's built-in `fetch()` for all HTTP calls to the Gemini REST API.

**Rationale:**
- The `@google/genai` SDK is ~60KB and wraps a straightforward REST API.
- Gemini's streaming protocol is simple SSE (each `data:` line is a complete JSON response) — no complex event types like Anthropic's `content_block_start/delta/stop`.
- P6 requires justification for any new dependency. The justification for Anthropic's SDK was "complex SSE with typed events, content block tracking, thinking signatures." Gemini has none of this complexity.
- Node 24 has native `fetch()` with `ReadableStream` support — no polyfill needed.

**Consequences:**
- ~200 lines of fetch + SSE parsing code in `GeminiProvider` instead of a 60KB SDK dependency.
- Must handle TCP-level chunking manually (SSE lines split across packets).
- Must construct URLs and headers manually.

### AD-SPEC70-002: GeminiProvider Does NOT Extend BaseOpenAICompatibleProvider

**Decision:** `GeminiProvider` is a standalone class implementing `ILlmProvider`. It does not extend `BaseOpenAICompatibleProvider`.

**Rationale:** `BaseOpenAICompatibleProvider` wraps the `openai` SDK — it calls `client.chat.completions.create()`, uses `OpenAIMessageConverter`, and emits OpenAI-style stream events. Gemini uses raw fetch, `GeminiMessageConverter`, and a completely different streaming model. Forcing Gemini into the OpenAI base class would defeat the purpose.

**Consequence:** `GeminiProvider` has its own complete `chat()` implementation (~200 lines). No code is shared with the OpenAI-compatible providers — and that's intentional. The `ILlmProvider` interface proves its value precisely because it allows completely independent implementations.

### AD-SPEC70-003: Gemini Thinking Config Is Inline

**Decision:** `GeminiProvider.chat()` constructs `generationConfig.thinkingConfig` directly. It does NOT call `buildThinkingRequestOptions()`.

**Rationale:** `buildThinkingRequestOptions()` returns OpenAI/DeepSeek-specific options (`thinking`, `extra_body`, `reasoning_effort`). Gemini uses `thinkingConfig: { thinkingBudget, includeThoughts }` — a different shape with different semantics. Per AD-SPEC50-003, each provider handles its own thinking configuration.

**Consequence:** `GeminiProvider.chat()` builds `generationConfig` inline. `buildThinkingRequestOptions` is not modified.

### AD-SPEC70-004: Tool Call IDs Are Generated Client-Side

**Decision:** Gemini's streaming API does NOT emit unique tool call IDs. The provider generates a UUID for each `functionCall` when its `name` first appears. This UUID is used for `tool_call_start`, `tool_call_delta`, and stored in `messageParams` for later pairing.

**Rationale:** Gemini 3+ generates a unique `id` for function calls in non-streaming responses, but the streaming endpoint (`streamGenerateContent`) does not emit these IDs progressively. To maintain the `tool_call_start` → `tool_call_delta` → `tool_call_end` event sequence that `SessionManager` expects, we generate IDs client-side.

**Consequence:** Tool call IDs are UUIDs like `"gemini-tc-<random>"` instead of Google-generated IDs. This is acceptable because the IDs are only used internally for pairing tool results to tool calls within a single turn.

### AD-SPEC70-005: SSE Parsing Is Handled Inline, Not via a Library

**Decision:** SSE parsing is implemented as a private method `parseSSELines()` within `GeminiProvider`. No external SSE parser library is used.

**Rationale:** Gemini's SSE format is the simplest possible: each `data:` line is a complete JSON object. There are no `event:`, `id:`, or `retry:` fields. Implementing a parser for this is ~30 lines of code. Adding an SSE parser dependency would violate P6 without justification.

**Consequence:** The parser must handle: partial lines (TCP chunking), empty lines (heartbeats), malformed JSON (skip+warn), and stream termination.

---

## Component / Module Breakdown

### Component 1: `GeminiMessageConverter` Class

**File:** `src/common/gemini-message-converter.ts` (NEW)

**Purpose:** Convert `SessionMessage[]` → Gemini `Content[]`. Extract system instruction to separate top-level field.

**Type definitions (inline, no SDK import):**

```typescript
// Gemini API types — defined inline since no SDK is used
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

**Class interface:**

```typescript
export class GeminiMessageConverter {
  private systemInstructionParts: Array<{ text: string }> = [];

  constructor() {}

  /**
   * Build Gemini Content array from session messages.
   * System messages are extracted to `systemInstructionParts` — not included in the array.
   */
  buildMessages(
    messages: SessionMessage[],
    thinkingEnabled: boolean,
    model: string,
  ): GeminiContent[];

  /**
   * Returns the accumulated system instruction, or null if no system messages exist.
   */
  getSystemInstruction(): GeminiSystemInstruction | null;
}
```

**Conversion logic — `convertMessage()`:**

| SessionMessage role | GeminiContent |
|---|---|
| `system` | NOT emitted. Text content accumulated as separate `{ text: content }` parts in `systemInstructionParts`. |
| `user` | `{ role: "user", parts: [{ text: message.content }, ...imageParts] }` |
| `assistant` (no tool_calls) | `{ role: "model", parts: [{ text: message.content }] }` (+ thought part if reasoning_content). |
| `assistant` (with tool_calls) | `{ role: "model", parts: [{ text: message.content }, ...functionCallParts] }` (+ thought part). |
| `tool` | `{ role: "tool", parts: [{ functionResponse: { name: toolName, response: { content: message.content } } }] }` |

**Key conversion rules:**

1. **System messages:** Extract text content, push each as a separate `{ text: content }` part into `systemInstructionParts`. Do NOT add to `contents` array. The Gemini API accepts multiple parts in `systemInstruction`.
2. **User text:** Convert to `{ text: message.content }` part.
3. **User images:** Parse `contentParams` array. For `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }`, extract MIME type and base64 data. Convert to `{ inlineData: { mimeType: "image/png", data: "<base64>" } }` part.
4. **Assistant text:** Convert to `{ text: message.content }` part.
5. **Assistant tool calls:** Extract from `messageParams.tool_calls`. Each tool call → `{ functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) } }` part.
6. **Assistant thinking:** When `thinkingEnabled` and `messageParams.reasoning_content` is a string, emit `{ thought: reasoning_content }` part BEFORE the text part.
7. **Tool results:** Parse `messageParams.tool_call_id`. Resolve tool name by cross-referencing the paired assistant message's tool calls. Content: `{ functionResponse: { name: toolName, response: { content: message.content ?? "" } } }`. Role MUST be `"tool"`.

**Tool pairing:** Copy the `pairToolMessages()` algorithm from `OpenAIMessageConverter`:
- Map-based: scan messages, build `Map<toolCallId, toolCallIndex>` for assistant tool calls.
- For each tool message, look up the paired assistant index.
- If no pair found → interrupted → inject fallback `functionResponse`.

**Multimodal filtering:** When `!isMultimodalModel(model)`, `inlineData` parts are filtered out of user content arrays.

**Dependencies:**
- `session.ts` (`SessionMessage` type).
- `model-capabilities.ts` (`isMultimodalModel`).

---

### Component 2: `convertToolsToGemini` Function

**File:** `src/common/gemini-message-converter.ts` (NEW — co-located)

**Purpose:** Convert internal `ToolDefinition[]` to Gemini `GeminiTool[]`.

**Implementation:**

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

**Note:** All tools are grouped into a single `{ functionDeclarations: [...] }` object. Gemini allows multiple `functionDeclarations` arrays across multiple tool objects, but grouping simplifies the code.

**Dependencies:**
- `prompt.ts` (`ToolDefinition` type).

---

### Component 3: `createGeminiClient` Factory

**File:** `src/common/gemini-client.ts` (NEW)

**Purpose:** Resolve Gemini-specific configuration from settings. Return configuration object (not an SDK instance).

**Full implementation:**

```typescript
import { resolveCurrentSettings } from "../settings";

export type GeminiClientConfig = {
  apiKey: string | null;
  baseURL: string;
  model: string;
  thinkingEnabled: boolean;
  debugLogEnabled: boolean;
  telemetryEnabled: boolean;
  maxTokens: number;
  notify?: string;
  env: Record<string, string>;
};

const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export function createGeminiClient(
  projectRoot: string = process.cwd(),
  engineName: string = "gemini",
): GeminiClientConfig {
  const settings = resolveCurrentSettings(projectRoot);

  // Resolve API key: engine-specific env → engine config → global env → global config
  let apiKey = settings.apiKey;
  let baseURL = settings.baseURL;

  const engineConfig = settings.engines[engineName];
  if (engineConfig) {
    apiKey = engineConfig.apiKey || apiKey;
    baseURL = engineConfig.baseURL || GEMINI_DEFAULT_BASE_URL;
  } else {
    baseURL = GEMINI_DEFAULT_BASE_URL;
  }

  return {
    apiKey: apiKey || null,
    baseURL: baseURL || GEMINI_DEFAULT_BASE_URL,
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

**Design notes:**
- No caching — unlike SDK-based client factories, there's no client instance to cache.
- The function is called once per `chat()` invocation (lightweight — just settings resolution).
- Returns `apiKey: null` when no key is configured — provider handles this.

**Dependencies:**
- `settings.ts` (`resolveCurrentSettings`).

---

### Component 4: `GeminiProvider` Class

**File:** `src/providers/gemini-provider.ts` (NEW)

**Purpose:** Implement `ILlmProvider` for Google Gemini models using raw HTTP fetch.

**Full implementation:**

```typescript
import { GeminiMessageConverter, convertToolsToGemini } from "../common/gemini-message-converter";
import { DEFAULT_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
import type { ModelUsage } from "../session";
import { withRetry } from "../common/api-retry";
import { createGeminiClient } from "../common/gemini-client";

const GEMINI_MODEL_PREFIX = "gemini-";
const GEMINI_PRO_MODEL_PATTERN = /^gemini-2\.5-pro/;

export class GeminiProvider implements ILlmProvider {
  readonly providerName = "gemini";

  constructor() {}

  supportsModel(model: string): boolean {
    return model.toLowerCase().startsWith(GEMINI_MODEL_PREFIX);
  }

  getTimeoutMs(model: string): number {
    if (GEMINI_PRO_MODEL_PATTERN.test(model.toLowerCase())) {
      return PRO_API_TIMEOUT_MS;  // 300_000 for Pro models
    }
    return DEFAULT_API_TIMEOUT_MS;  // 180_000
  }

  isMultimodal(_model: string): boolean {
    return true;  // All Gemini text models support image inputs
  }

  getCheapModel(model: string): string | null {
    switch (model) {
      case "gemini-3.5-flash": return "gemini-3.1-flash-lite";
      case "gemini-3-flash":   return "gemini-3.1-flash-lite";
      case "gemini-2.5-pro":   return "gemini-2.5-flash";
      case "gemini-2.5-flash": return "gemini-3.1-flash-lite";
      case "gemini-3.1-flash-lite": return null;
      default: {
        if (model.toLowerCase().startsWith("gemini-")) return "gemini-3.1-flash-lite";
        return null;
      }
    }
  }

  async *chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent> {
    const config = createGeminiClient(process.cwd(), "gemini");

    if (!config.apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const providerOpts = options.providerOptions as
      | { thinkingEnabled?: boolean }
      | undefined;
    const thinkingEnabled = providerOpts?.thinkingEnabled ?? false;

    // Build Gemini messages — fresh converter per call avoids state leakage
    const converter = new GeminiMessageConverter();
    const geminiContents = converter.buildMessages(
      options.messages,
      thinkingEnabled,
      options.model,
    );
    const systemInstruction = converter.getSystemInstruction();

    // Convert tools to Gemini format
    const geminiTools = options.tools && options.tools.length > 0
      ? convertToolsToGemini(options.tools)
      : undefined;

    // Build request body
    const generationConfig: Record<string, unknown> = {};

    if (thinkingEnabled) {
      generationConfig.thinkingConfig = {
        thinkingBudget: 8192,
        includeThoughts: true,
      };
    }
    if (options.temperature !== undefined && !thinkingEnabled) {
      generationConfig.temperature = options.temperature;
    }
    if ((options.maxTokens ?? 0) > 0) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }

    const requestBody: Record<string, unknown> = {
      contents: geminiContents,
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }
    if (geminiTools) {
      requestBody.tools = geminiTools;
    }
    if (Object.keys(generationConfig).length > 0) {
      requestBody.generationConfig = generationConfig;
    }

    // Build streaming URL
    const url = `${config.baseURL}/models/${options.model}:streamGenerateContent?alt=sse`;

    // Use withRetry for transient failures
    const response = await withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutMs = this.getTimeoutMs(options.model);
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        // Combine user signal with timeout
        if (options.signal) {
          options.signal.addEventListener("abort", () => controller.abort(), { once: true });
        }

        try {
          const resp = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": config.apiKey!,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          if (!resp.ok) {
            const errorText = await resp.text().catch(() => "");
            throw new Error(`Gemini API error ${resp.status}: ${errorText}`);
          }

          if (!resp.body) {
            throw new Error("Gemini API returned empty response body");
          }

          return resp.body;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      { userSignal: options.signal },
    );

    // Convert ReadableStream to SSE events
    yield* this.streamToEvents(response, options.signal);
  }

  private async *streamToEvents(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";
    let accumulatedThought = "";
    let currentToolCallId = "";
    let currentToolCallName = "";
    let accumulatedToolArgs = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        // Check abort signal
        if (signal?.aborted) {
          yield { type: "error", error: new DOMException("Aborted", "AbortError") };
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";  // Keep incomplete line in buffer

        for (const line of lines) {
          // Strip \r (handle \r\n line endings) and skip non-data lines
          const trimmed = line.replace(/\r$/, "");
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6).trim();
          if (data === "" || data === "[DONE]") continue;

          let chunk: Record<string, unknown>;
          try {
            chunk = JSON.parse(data);
          } catch {
            console.warn("Gemini SSE: failed to parse JSON chunk:", data.slice(0, 200));
            continue;
          }

          // Check for safety filter block
          const promptFeedback = chunk.promptFeedback as Record<string, unknown> | undefined;
          if (promptFeedback?.blockReason) {
            yield {
              type: "error",
              error: new Error(`Content blocked: ${promptFeedback.blockReason}`),
            };
            return;
          }

          // Check finish reason for safety
          const candidates = chunk.candidates as Array<Record<string, unknown>> | undefined;
          if (candidates?.[0]?.finishReason === "SAFETY") {
            yield {
              type: "error",
              error: new Error(`Response blocked by safety filter`),
            };
            return;
          }

          // Process parts from candidates[0].content.parts[]
          const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>> | undefined;
          if (!parts) continue;

          for (const part of parts) {
            if (typeof part.text === "string" && part.text.length > 0) {
              const textDelta = part.text.slice(accumulatedText.length);
              if (textDelta.length > 0) {
                accumulatedText += textDelta;
                yield { type: "text_delta", text: textDelta };
              }
            }

            if (typeof part.thought === "string" && part.thought.length > 0) {
              const thoughtDelta = part.thought.slice(accumulatedThought.length);
              if (thoughtDelta.length > 0) {
                accumulatedThought += thoughtDelta;
                yield { type: "reasoning_delta", text: thoughtDelta };
              }
            }

            if (part.functionCall && typeof part.functionCall === "object") {
              const fc = part.functionCall as Record<string, unknown>;
              if (typeof fc.name === "string" && fc.name !== currentToolCallName) {
                // New tool call — generate ID
                currentToolCallId = `gemini-tc-${crypto.randomUUID()}`;
                currentToolCallName = fc.name as string;
                accumulatedToolArgs = "";
                yield {
                  type: "tool_call_start",
                  id: currentToolCallId,
                  name: currentToolCallName,
                };
              }

              if (fc.args && typeof fc.args === "object") {
                const newArgs = JSON.stringify(fc.args);
                if (newArgs !== accumulatedToolArgs) {
                  const argsDelta = newArgs.slice(accumulatedToolArgs.length);
                  accumulatedToolArgs = newArgs;
                  if (argsDelta.length > 0) {
                    yield {
                      type: "tool_call_delta",
                      id: currentToolCallId,
                      arguments: argsDelta,
                    };
                  }
                }
              }
            }
          }

          // Extract usage metadata
          const usageMetadata = chunk.usageMetadata as Record<string, number> | undefined;
          if (usageMetadata) {
            inputTokens = usageMetadata.promptTokenCount ?? inputTokens;
            outputTokens = usageMetadata.candidatesTokenCount ?? outputTokens;
            const usage: ModelUsage = {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens,
            };
            yield { type: "usage", usage };
          }
        }
      }

      // Flush remaining buffer
      if (buffer.startsWith("data: ")) {
        const data = buffer.slice(6).trim();
        if (data !== "" && data !== "[DONE]") {
          try {
            const chunk = JSON.parse(data);
            const usageMetadata = chunk.usageMetadata as Record<string, number> | undefined;
            if (usageMetadata) {
              const usage: ModelUsage = {
                prompt_tokens: usageMetadata.promptTokenCount ?? inputTokens,
                completion_tokens: usageMetadata.candidatesTokenCount ?? outputTokens,
                total_tokens: (usageMetadata.promptTokenCount ?? inputTokens) + (usageMetadata.candidatesTokenCount ?? outputTokens),
              };
              yield { type: "usage", usage };
            }
          } catch {
            // Ignore malformed final line
          }
        }
      }
    } catch (error) {
      yield { type: "error", error };
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
}
```

**Design notes for `chat()`:**
- Returns `AsyncIterable<LlmStreamEvent>` via `streamToEvents()`.
- Uses `GeminiMessageConverter.buildMessages()` for message conversion.
- Uses `convertToolsToGemini()` for tool definition conversion.
- Thinking: `thinkingConfig: { thinkingBudget: 8192, includeThoughts: true }` in `generationConfig`.
- Streaming endpoint: `POST :streamGenerateContent?alt=sse`.
- `withRetry()` wraps the fetch call.
- Timeout via `AbortController` + `setTimeout`.
- SSE parsing: line-by-line `data:` prefix detection + JSON parse.
- Tool call ID generation: `crypto.randomUUID()` prefixed with `gemini-tc-`.

**Error Handling:**
- Missing API key → throw `Error("Gemini API key not configured")`.
- HTTP error status → throw with status code and body.
- SSE parse failure → `console.warn()`, skip chunk.
- Safety filter block → yield `error`, return.
- Stream abort → yield `error`, return.
- Network errors → caught by `withRetry()`.

**Dependencies:**
- `gemini-message-converter.ts` (Component 1, 2).
- `gemini-client.ts` (Component 3).
- `api-timeout.ts` (constants).
- `api-retry.ts` (`withRetry`).
- `llm-provider.ts` (types).
- `session.ts` (`ModelUsage` type).
- Node 24 built-in: `fetch`, `crypto.randomUUID`, `TextDecoder`, `ReadableStream`, `AbortController`.

---

### Component 5: Provider Registry Routing — Gemini

**File:** `src/common/llm-provider-registry.ts` (MODIFY)

**Purpose:** Add `gemini-` prefix routing to `GeminiProvider`.

**Changes:**

```typescript
import { GeminiProvider } from "../providers/gemini-provider";

function isGeminiModel(model: string): boolean {
  return model.toLowerCase().startsWith("gemini-");
}

// In createLlmProvider():
const engineName =
  isOpenAIModel(settings.model) ? "openai"
  : isAnthropicModel(settings.model) ? "anthropic"
  : isGeminiModel(settings.model) ? "gemini"
  : undefined;

// Add Gemini routing branch (after Anthropic, before DeepSeek default):
if (isGeminiModel(settings.model)) {
  const provider = new GeminiProvider();
  return { provider, createOpenAIClient: createClient };
}
```

**Dependencies:**
- `GeminiProvider` (Component 4).

---

### Component 6: `DEFAULT_MODEL_PRICING` — Gemini Entries

**File:** `src/common/model-capabilities.ts` (MODIFY)

**Purpose:** Add default pricing entries for Gemini models.

**Changes:**

```typescript
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // ... existing entries ...
  "gemini-3.5-flash":      { inputPrice: 1.50, outputPrice: 9.00, cacheReadPrice: 0.15 },
  "gemini-3-flash":        { inputPrice: 1.00, outputPrice: 6.00, cacheReadPrice: 0.10 },
  "gemini-3.1-flash-lite": { inputPrice: 0.25, outputPrice: 1.50, cacheReadPrice: 0.025 },
  "gemini-2.5-pro":        { inputPrice: 2.50, outputPrice: 15.00, cacheReadPrice: 0.25 },
  "gemini-2.5-flash":      { inputPrice: 0.50, outputPrice: 3.00, cacheReadPrice: 0.05 },
};
```

---

### Component 7: `MODEL_CATALOG` — Gemini Entries

**File:** `src/common/model-catalog.ts` (MODIFY)

**Purpose:** Add model catalog entries for Gemini models and extend the `provider` type.

**Changes:**

```typescript
// Extend provider type:
export type ModelEntry = {
  id: string;
  provider: "deepseek" | "openai" | "anthropic" | "gemini";  // ← ADD "gemini"
  // ... rest unchanged
};

// Add entries to MODEL_CATALOG:
export const MODEL_CATALOG: ModelEntry[] = [
  // ... existing entries ...
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
];
```

---

### Component 8: Test Files

**File:** `src/tests/gemini-message-converter.test.ts` (NEW)
**File:** `src/tests/gemini-provider.test.ts` (NEW)

Exact test structure is specified in `task.md`.

---

## Data Flow

### Main Conversation Turn (Gemini)

```
User sends message with model: "gemini-3.5-flash"
  →
SessionManager.activateSession()
  →
createLlmProvider(projectRoot, converterOptions)
  → settings.model = "gemini-3.5-flash"
  → isGeminiModel("gemini-3.5-flash") → true
  → engineName = "gemini"
  → createClient = () => createOpenAIClient(projectRoot, "gemini")
  → new GeminiProvider()
  →
provider.chat({
  model: "gemini-3.5-flash",
  messages: [SessionMessage, ...],
  tools: [ToolDefinition, ...],
  providerOptions: { thinkingEnabled: true },
  signal: abortSignal,
})
  →
GeminiProvider.chat():
  1. createGeminiClient(process.cwd(), "gemini")
     → resolveCurrentSettings(projectRoot)
     → engines.gemini.apiKey ?? apiKey → "AIza..."
     → engines.gemini.baseURL ?? "https://generativelanguage.googleapis.com/v1beta"
     → config: { apiKey: "AIza...", baseURL: "...", ... }
  2. messageConverter.buildMessages(messages, true, "gemini-3.5-flash")
     → system messages → accumulated to systemInstructionParts
     → user messages → [{ role: "user", parts: [{ text: "..." }] }]
     → assistant messages with tool_calls → [{ role: "model", parts: [{ text: "..." }, { functionCall: {...} }] }]
     → tool messages → [{ role: "tool", parts: [{ functionResponse: {...} }] }]
     → GeminiContent[]
  3. messageConverter.getSystemInstruction() → { parts: [{ text: "You are DsCode..." }] }
  4. convertToolsToGemini(tools) → [{ functionDeclarations: [{ name: "bash", ... }] }]
  5. fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse", {
       method: "POST",
       headers: { "Content-Type": "application/json", "x-goog-api-key": "AIza..." },
       body: JSON.stringify({
         contents: [...],
         systemInstruction: { parts: [{ text: "You are DsCode..." }] },
         tools: [{ functionDeclarations: [...] }],
         generationConfig: { thinkingConfig: { thinkingBudget: 8192, includeThoughts: true } },
       }),
       signal: controller.signal,
     })
  →
  streamToEvents(body, signal):
    SSE line: data: {"candidates":[{"content":{"parts":[{"thought":"Let me think..."}]}}]}
      → accumulatedThought = "Let me think..."
      → yield { type: "reasoning_delta", text: "Let me think..." }
    SSE line: data: {"candidates":[{"content":{"parts":[{"text":"I'll"}]}}]}
      → yield { type: "text_delta", text: "I'll" }
    SSE line: data: {"candidates":[{"content":{"parts":[{"text":" help you."}]}}]}
      → yield { type: "text_delta", text: " help you." }
    SSE line: data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read","args":{"file_path":"/foo"}}}]}}]}
      → New tool call: name "read" → generate UUID "gemini-tc-abc123"
      → yield { type: "tool_call_start", id: "gemini-tc-abc123", name: "read" }
      → yield { type: "tool_call_delta", id: "gemini-tc-abc123", arguments: '{"file_path":"/foo"}' }
    SSE line: data: {"usageMetadata":{"promptTokenCount":472,"candidatesTokenCount":89,"totalTokenCount":561}}
      → yield { type: "usage", usage: { prompt_tokens: 472, completion_tokens: 89, total_tokens: 561 } }
  →
SessionManager iterates, aggregates, builds SessionMessage (identical flow)
```

### Compaction Flow (Gemini)

```
SessionManager.compactSession()
  →
createLlmProvider() → GeminiProvider
  →
provider.getCheapModel?.("gemini-3.5-flash") → "gemini-3.1-flash-lite"
  →
provider.chat({
  model: "gemini-3.1-flash-lite",
  messages: [{ role: "user", content: compactionPrompt }],
  signal: abortSignal,
})
  →
GeminiProvider.chat():
  - providerOptions undefined → thinkingEnabled = false
  - thinkingConfig omitted from generationConfig
  - fetch(..., { model: "gemini-3.1-flash-lite", contents: [...], ... })
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
| `GeminiContent` | `src/common/gemini-message-converter.ts` | NEW type |
| `GeminiPart` | `src/common/gemini-message-converter.ts` | NEW type |
| `GeminiSystemInstruction` | `src/common/gemini-message-converter.ts` | NEW type |
| `GeminiTool` | `src/common/gemini-message-converter.ts` | NEW type |
| `GeminiClientConfig` | `src/common/gemini-client.ts` | NEW type |
| `GeminiMessageConverter` | `src/common/gemini-message-converter.ts` | NEW class |
| `convertToolsToGemini` | `src/common/gemini-message-converter.ts` | NEW function |
| `createGeminiClient` | `src/common/gemini-client.ts` | NEW function |
| `GeminiProvider` | `src/providers/gemini-provider.ts` | NEW class |
| `DEFAULT_MODEL_PRICING` | `src/common/model-capabilities.ts` | MODIFY (add 5 entries) |
| `MODEL_CATALOG` | `src/common/model-catalog.ts` | MODIFY (add 5 entries + extend provider type) |
| `createLlmProvider` | `src/common/llm-provider-registry.ts` | MODIFY (add gemini- routing) |
| `ModelEntry.provider` | `src/common/model-catalog.ts` | MODIFY (extend union type) |

---

## File / Module Layout

```
src/
├── common/
│   ├── gemini-message-converter.ts    (NEW — ~400 lines)
│   ├── gemini-client.ts               (NEW — ~60 lines)
│   ├── llm-provider-registry.ts       (MODIFY — add Gemini routing)
│   ├── model-capabilities.ts          (MODIFY — add Gemini pricing)
│   ├── model-catalog.ts               (MODIFY — add Gemini entries + extend provider type)
│   └── openai-message-converter.ts    (UNCHANGED)
│   └── anthropic-message-converter.ts (UNCHANGED)
│
├── providers/
│   ├── gemini-provider.ts             (NEW — ~300 lines)
│   ├── deepseek-provider.ts           (UNCHANGED)
│   ├── openai-provider.ts             (UNCHANGED)
│   ├── anthropic-provider.ts          (UNCHANGED)
│   └── base-openai-provider.ts        (UNCHANGED)
│
└── tests/
    ├── gemini-message-converter.test.ts (NEW — ~300 lines)
    ├── gemini-provider.test.ts          (NEW — ~350 lines)
    └── session.test.ts                  (UNCHANGED)
```

**ZERO changes to:**
- `session.ts`
- `api-retry.ts`
- `package.json`
- `package-lock.json`
- `settings.ts`
- All existing provider files (deepseek, openai, anthropic, base-openai)

---

## Testing Strategy

### `gemini-message-converter.test.ts`

| Test | What it verifies |
|---|---|
| System messages extracted, not in Content[] | `getSystemInstruction()` returns correct shape |
| User text message → `{ role: "user", parts: [{ text: "..." }] }` | Correct parts array structure |
| User image message → `{ role: "user", parts: [{ inlineData: {...} }] }` | Data URL parsed correctly |
| Assistant text message → `{ role: "model", parts: [{ text: "..." }] }` | No functionCall parts |
| Assistant with tool calls → `{ parts: [{ text: "..." }, { functionCall: {...} }] }` | functionCall with correct name and args |
| Assistant with thinking → `{ parts: [{ thought: "..." }, { text: "..." }] }` | Thought part before text |
| Tool result → `{ role: "tool", parts: [{ functionResponse: {...} }] }` | Correct role and response shape |
| Interrupted tool → functionResponse with error data | Fallback injection with metadata.interrupted |
| Compaction filtering → compacted messages excluded | Same as other converters |
| Multimodal filtering → images removed for non-multimodal model | `isMultimodalModel()` respected |
| Empty messages → empty array | No crash |
| `convertToolsToGemini` converts format | `function.name` → `name`, `function.parameters` → `parameters` |
| `convertToolsToGemini` handles empty array | Returns `[]` |
| `convertToolsToGemini` groups into single functionDeclarations | All tools in one object |

### `gemini-provider.test.ts`

| Test | What it verifies |
|---|---|
| `supportsModel("gemini-3.5-flash")` → true | Prefix matching |
| `supportsModel("gpt-5.4")` → false | Non-gemini models |
| `getTimeoutMs("gemini-2.5-pro")` → 300000 | Pro models |
| `getTimeoutMs("gemini-3.5-flash")` → 180000 | Non-pro models |
| `isMultimodal()` → true for all models | All Gemini models |
| `getCheapModel("gemini-3.5-flash")` → "gemini-3.1-flash-lite" | Premium → Lite |
| `getCheapModel("gemini-3.1-flash-lite")` → null | Already cheapest |
| `chat()` yields `text_delta` events | Mock fetch response, verify text |
| `chat()` yields `reasoning_delta` events | Mock thought parts in stream |
| `chat()` yields `tool_call_start` + `tool_call_delta` | Mock functionCall parts |
| `chat()` yields `usage` event | Mock usageMetadata |
| `chat()` throws when API key missing | Mock null apiKey |
| `chat()` throws on HTTP error status | Mock HTTP 503 response |
| `chat()` respects abort signal | AbortController signal |
| `chat()` retries on 429/503 | withRetry test |
| `chat()` sets `thinkingConfig` when enabled | Verify request body |
| `chat()` omits `thinkingConfig` when disabled | Verify request body |
| `chat()` handles safety filter blockReason | Mock blockReason in response |
| `chat()` handles security filter finishReason | Mock SAFETY finishReason |
| `chat()` handles empty candidates | No yield, continues |
| `chat()` handles multiple function calls | Both tool_call_start events |
| SSE buffer handles partial lines | Incomplete data: line |
| SSE handles malformed JSON | Warn and skip |
| SSE handles [DONE] marker | Clean termination |
| Tool call ID generation is deterministic pattern | UUID prefixed with `gemini-tc-` |

---

## Migration / Rollback

**Migration:** Users with existing `settings.json` need no changes. The `engines.gemini` field is optional — the Gemini provider is only instantiated when the model starts with `gemini-`.

To use Gemini, a user must:
1. Obtain a Google Gemini API key from `https://aistudio.google.com/apikey`.
2. Set `DEEPCODE_ENGINE_GEMINI_API_KEY` env var or add `engines.gemini.apiKey` to `settings.json`.
3. Set the model to `gemini-3.5-flash` (or any `gemini-*` model) via `/model` or `settings.json`.

**Rollback:** Revert to the commit before this spec. No dependency changes, no database migrations, no settings file changes are required.

**Breaking changes:** None. Existing providers continue to work identically. All new files are additive — no existing files have behavioral changes other than `model-catalog.ts` (adds entries), `model-capabilities.ts` (adds pricing), and `llm-provider-registry.ts` (adds routing branch accessible only with `gemini-` model prefix).
