# Spec 70: google-gemini-provider — Requirements

## Value Delivery

Delivers value block **V6** (Multi-Model Support) and refines **V12** (Provider-Agnostic LLM Architecture) from vision.md.

> **V6:** *"Support for multiple LLM providers beyond DeepSeek: OpenAI (GPT-5.x family) via Responses API. Anthropic (Claude family) via Messages API. Thinking/reasoning mode is provider-aware. Tool calling uses each provider's native format, converted from a canonical internal representation."*

> **V12:** *"A clean internal boundary between DsCode's orchestration layer and any specific LLM provider SDK. Defined by the `ILlmProvider` interface: single contract `chat(options) → AsyncIterable<LlmStreamEvent>`, canonical message format `SessionMessage`, unified stream events, provider registry."*

This spec adds Google Gemini as the FOURTH provider, using the `generativelanguage.googleapis.com` REST API via native `fetch()` (Node 24 built-in). Unlike Anthropic (which required `@anthropic-ai/sdk`) and OpenAI/DeepSeek (which share the `openai` npm package), Gemini's REST API is consumed via raw HTTP with JSON request/response and SSE streaming — zero new npm dependencies required.

---

## Functional Requirements

### FR-001: Create `GeminiMessageConverter` Class

**What:** Create class `GeminiMessageConverter` at `src/common/gemini-message-converter.ts` that converts internal `SessionMessage[]` arrays into Gemini API `Content[]` arrays. The Gemini API uses a fundamentally different wire format from both OpenAI and Anthropic: parts-based content arrays with distinct roles (`user`, `model`, `tool`), system instruction as a top-level `systemInstruction` field, and function calls/responses embedded within parts.

The Gemini generateContent API wire format:
```
// System instruction (NOT a message — top-level field)
{ systemInstruction: { parts: [{ text: "You are a helpful assistant." }] } }

// User message
{ role: "user", parts: [{ text: "Hello" }] }

// Model/assistant message
{ role: "model", parts: [{ text: "Let me search..." }] }

// Model message with function call
{ role: "model", parts: [
  { text: "Let me search..." },
  { functionCall: { name: "read", args: { file_path: "/foo" } } }
] }

// Tool result message
{ role: "tool", parts: [
  { functionResponse: { name: "read", response: { content: "..." } } }
] }
```

The converter SHALL:
1. Filter compacted messages (same as `OpenAIMessageConverter` and `AnthropicMessageConverter`).
2. Extract `system` role messages — accumulate their text content into a `systemInstruction` object (`{ parts: [{ text: "..." }] }`) exposed via `getSystemInstruction()`. Gemini uses `systemInstruction` as a top-level field, NOT as a message in the `contents` array.
3. Convert `user` role messages to Gemini content: `{ role: "user", parts: [{ text: message.content }] }`. Images in `contentParams` SHALL be converted to inline `{ inlineData: { mimeType: "...", data: "..." } }` parts for multimodal models.
4. Convert `assistant` role messages to Gemini content: `{ role: "model", parts: [...] }`. If the message has tool calls, append `{ functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) } }` parts. If `thinkingEnabled` is true and `reasoning_content` is present in `messageParams`, include a `thought` part (Gemini 3's thinking representation).
5. Convert `tool` role messages to Gemini content: `{ role: "tool", parts: [{ functionResponse: { name: toolCallName, response: { content: message.content } } }] }`. The `name` MUST be resolved by cross-referencing the tool call from the paired assistant message.
6. Handle tool pairing (assistant functionCall → tool functionResponse) same algorithm as `OpenAIMessageConverter.pairToolMessages()` and `AnthropicMessageConverter` — copy the O(n) Map-based algorithm.
7. Handle multimodal content (images) filtering by model capability via `isMultimodalModel()`.
8. Handle interrupted tool calls: inject fallback `functionResponse` parts with `{ error: "Previous tool call did not complete.", metadata: { interrupted: true } }`.

**Why:** ADR-004 establishes `SessionMessage` as canonical format. Each provider converts to its own wire format. Gemini's format is neither OpenAI-compatible (no `ChatCompletionMessageParam`) nor Anthropic-compatible (no content blocks array) — it uses `parts[]` with inline `functionCall`/`functionResponse` and a `systemInstruction` top-level field.

**Acceptance Criteria:**
- [ ] File `src/common/gemini-message-converter.ts` exists.
- [ ] Exports `GeminiMessageConverter` class.
- [ ] Method `buildMessages(messages: SessionMessage[], thinkingEnabled: boolean, model: string): GeminiContent[]`.
- [ ] `system` role messages are NOT emitted as `Content` — the converter collects them separately, exposed via `getSystemInstruction(): { parts: Array<{ text: string }> }`.
- [ ] `getSystemInstruction()` returns `{ parts: [{ text: "..." }] }` (or `null` if no system messages).
- [ ] `user` role messages convert to `{ role: "user", parts: [{ text: "..." }] }`.
- [ ] `assistant` role messages with tool calls convert to `{ role: "model", parts: [{ text: "..." }, { functionCall: { name: "...", args: {...} } }] }`.
- [ ] `tool` role messages convert to `{ role: "tool", parts: [{ functionResponse: { name: "...", response: { content: "..." } } }] }`.
- [ ] Tool pairing logic matches `OpenAIMessageConverter.pairToolMessages()` algorithm.
- [ ] Multimodal content filtering respects `isMultimodalModel()`.
- [ ] Interrupted tool calls produce injected fallback `functionResponse` parts with error data.
- [ ] `npm run typecheck` passes.

---

### FR-002: Create `createGeminiClient` Factory Function

**What:** Create function `createGeminiClient()` at `src/common/gemini-client.ts` that returns configuration for calling the Gemini REST API. The function SHALL:

1. Read settings via `resolveCurrentSettings(projectRoot)`.
2. Accept optional `engineName` parameter for engine-specific credentials (defaults to `"gemini"`).
3. Resolve API key and base URL from: `DEEPCODE_ENGINE_GEMINI_API_KEY` env var → `engines.gemini.apiKey` → `DEEPCODE_API_KEY` → `settings.apiKey`.
4. Engine default base URL for `gemini`: `https://generativelanguage.googleapis.com/v1beta` (NOT `https://api.gemini.com` — the correct endpoint is `generativelanguage.googleapis.com`).
5. Return `{ apiKey: string | null; baseURL: string; model: string; thinkingEnabled: boolean; debugLogEnabled: boolean; telemetryEnabled: boolean; maxTokens: number; notify?: string; env: Record<string, string> }`.
6. Return `apiKey: null` when no API key is configured.
7. NO client instantiation — Gemini uses raw HTTP fetch, not an SDK. The returned config is consumed by `GeminiProvider.chat()` to build request URLs and headers.

**Why:** Follows the same pattern as `createOpenAIClient` (Spec 40) and `createAnthropicClient` (Spec 50). Engine-specific credential resolution is necessary because Google requires a different API key than DeepSeek, OpenAI, or Anthropic. Unlike the other client factories, this one returns configuration rather than an SDK client instance because Gemini is accessed via raw HTTP fetch (Node 24 built-in).

**Acceptance Criteria:**
- [ ] File `src/common/gemini-client.ts` exists.
- [ ] Exports `createGeminiClient(projectRoot?: string, engineName?: string): GeminiClientConfig`.
- [ ] Returns `apiKey: null` when no Gemini API key configured.
- [ ] API key resolution order: `DEEPCODE_ENGINE_GEMINI_API_KEY` → `engines.gemini.apiKey` → `DEEPCODE_API_KEY` → `settings.apiKey`.
- [ ] Base URL resolution order: `DEEPCODE_ENGINE_GEMINI_BASE_URL` → `engines.gemini.baseURL` → `https://generativelanguage.googleapis.com/v1beta` → `settings.baseURL`.
- [ ] File contains `const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"` as the engine default.
- [ ] Return type `GeminiClientConfig` exported with fields: `apiKey: string | null`, `baseURL: string`, `model: string`, `thinkingEnabled: boolean`, `debugLogEnabled: boolean`, `telemetryEnabled: boolean`, `maxTokens: number`, `notify?: string`, `env: Record<string, string>`.
- [ ] `npm run typecheck` passes.

---

### FR-003: Create `GeminiProvider` Class

**What:** Create class `GeminiProvider` at `src/providers/gemini-provider.ts` implementing `ILlmProvider`. This is the FOURTH provider (after DeepSeek, OpenAI, Anthropic). Unlike all previous providers, GeminiProvider uses:

1. **No SDK — raw HTTP:** `fetch()` (Node 24 built-in) to call `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` and `:streamGenerateContent` for streaming.
2. **Endpoint:** `POST {baseURL}/models/{model}:streamGenerateContent?alt=sse` for streaming.
3. **Auth:** API key via `x-goog-api-key` HTTP header (or `?key=` query parameter as fallback).
4. **Thinking:** `thinkingConfig: { thinkingBudget: number, includeThoughts: boolean }` in `generationConfig`. Gemini uses "thinking budget" (token limit for internal reasoning) rather than "thinking type" (enabled/disabled).
5. **Tool calls:** Emitted via parts with `functionCall` objects in the stream. The stream yields `candidates[0].content.parts[]` progressively — each part can be `text` or `functionCall`.
6. **Usage:** Available from `usageMetadata` in stream chunks: `{ promptTokenCount, candidatesTokenCount, totalTokenCount }`. Thought tokens are included in `candidatesTokenCount`.

The provider SHALL:
- Implement all `ILlmProvider` methods: `supportsModel`, `chat`, `getTimeoutMs`, `isMultimodal`, `getCheapModel`.
- Have `readonly providerName = "gemini"`.
- Support models with prefix `gemini-` (case-insensitive).
- Yield the applicable `LlmStreamEvent` variants: `text_delta`, `reasoning_delta`, `tool_call_start`, `tool_call_delta`, `usage`, `error`. The `signature` event is NOT applicable (Anthropic-specific).
- Use `withRetry()` for transient failures (already supports HTTP 429, 502, 503, 529 — Gemini uses standard HTTP status codes).
- Convert Gemini SSE stream chunks to `LlmStreamEvent` via a private `*streamToEvents()` generator.

The streaming endpoint for Gemini returns SSE (Server-Sent Events) with JSON chunks:
```
data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}],"usageMetadata":{...}}
data: {"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]}}],"usageMetadata":{...}}
```

Each SSE `data:` line is a complete `GenerateContentResponse` JSON object. The provider SHALL accumulate parts progressively and emit:

| Gemini stream field | LlmStreamEvent |
|---|---|
| `parts[].text` (new non-empty text) | `text_delta` { text } |
| `parts[].thought` (thinking content) | `reasoning_delta` { text: thought } |
| `parts[].functionCall.name` (first occurrence) | `tool_call_start` { id, name } |
| `parts[].functionCall.args` (incremental JSON) | `tool_call_delta` { id, arguments: partial_json } |
| `usageMetadata` (cumulative) | `usage` { usage: ModelUsage } |

**Why:** This is the first provider that uses raw HTTP fetch instead of an SDK. It proves the `ILlmProvider` interface works with providers that have no SDK at all — the ultimate validation of Spec 30's architecture. Zero new npm dependencies demonstrates P6 compliance at the highest level.

**Acceptance Criteria:**
- [ ] File `src/providers/gemini-provider.ts` exists.
- [ ] `GeminiProvider` class exports and implements `ILlmProvider` (TypeScript verifiable).
- [ ] `supportsModel()` returns `true` for model names starting with `gemini-`.
- [ ] `supportsModel()` returns `false` for non-`gemini-` models.
- [ ] `getTimeoutMs()` returns `300_000` for `gemini-2.5-pro` (reasoning model), `180_000` for all other Gemini models.
- [ ] `isMultimodal()` returns `true` for all Gemini models (Gemini is natively multimodal for text+images).
- [ ] `getCheapModel()` maps `gemini-3.5-flash` → `gemini-3.1-flash-lite`, `gemini-2.5-pro` → `gemini-2.5-flash`, `gemini-3-flash` → `gemini-3.1-flash-lite`. Returns `null` for `gemini-3.1-flash-lite` and `gemini-2.5-flash`.
- [ ] `chat()` calls `fetch()` with endpoint `{baseURL}/models/{model}:streamGenerateContent?alt=sse`.
- [ ] `chat()` uses `GeminiMessageConverter.buildMessages()` for message conversion.
- [ ] `chat()` sends `systemInstruction` from `converter.getSystemInstruction()` when non-null.
- [ ] `chat()` sends `generationConfig.thinkingConfig` with `{ thinkingBudget: 8192, includeThoughts: true }` when thinking enabled, or omits `thinkingConfig` entirely when disabled.
- [ ] `chat()` sends `x-goog-api-key` header for authentication.
- [ ] `chat()` converts Gemini SSE chunks to `LlmStreamEvent` via `streamToEvents()`.
- [ ] `chat()` yields the applicable `LlmStreamEvent` variants: `text_delta`, `reasoning_delta`, `tool_call_start`, `tool_call_delta`, `usage`, `error`.
- [ ] `chat()` accumulates thought content from `parts[].thought` and yields as `reasoning_delta`.
- [ ] `chat()` extracts usage from `usageMetadata` → converts to `ModelUsage` shape `{ prompt_tokens, completion_tokens, total_tokens }`.
- [ ] `npm run typecheck` passes.

---

### FR-004: Gemini Tool Definition Converter

**What:** Create function `convertToolsToGemini()` at `src/common/gemini-message-converter.ts` that converts the internal `ToolDefinition[]` format (OpenAI-style) to Gemini's tool format.

Internal format (unchanged):
```typescript
type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; };
  };
};
```

Gemini format:
```json
[{
  "functionDeclarations": [{
    "name": "bash",
    "description": "Executes a bash command.",
    "parameters": {
      "type": "object",
      "properties": { "command": { "type": "string", "description": "..." } },
      "required": ["command"]
    }
  }]
}]
```

Note: Gemini wraps function declarations within `functionDeclarations` arrays inside `tools[]`. Multiple tools can be grouped into a single `{ functionDeclarations: [...] }` object, or split across multiple objects. This spec groups ALL tools into ONE `{ functionDeclarations: [...] }` object for simplicity.

**Why:** Gemini's function calling format differs from both OpenAI (`{ type: "function", function: { name, description, parameters } }`) and Anthropic (`{ name, description, input_schema }`). Gemini uses `functionDeclarations[]` nested within a `tools[]` array. The conversion is mechanical but must be explicit and tested.

**Acceptance Criteria:**
- [ ] Function `convertToolsToGemini(tools: ToolDefinition[]): GeminiTool[]` exists.
- [ ] Returns `[]` when tools array is empty (no tools sent to API).
- [ ] Returns `[{ functionDeclarations: [...] }]` with all tools in a single object.
- [ ] `ToolDefinition.function.name` → `functionDeclarations[].name`.
- [ ] `ToolDefinition.function.description` → `functionDeclarations[].description`.
- [ ] `ToolDefinition.function.parameters` → `functionDeclarations[].parameters` (passed through as-is).
- [ ] `additionalProperties` is forwarded (Gemini accepts it in JSON Schema).
- [ ] `npm run typecheck` passes.

---

### FR-005: Gemini Stream Event to LlmStreamEvent Conversion

**What:** The `GeminiProvider.chat()` SHALL internally iterate over SSE `data:` lines from the Gemini streaming endpoint and convert them to the canonical `LlmStreamEvent` type. The conversion logic SHALL be in a private `*streamToEvents()` generator method.

Gemini SSE stream format:
```
data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}
```

Each `data:` line contains a complete `GenerateContentResponse` JSON object. The provider SHALL:
1. Parse each SSE `data:` line as JSON.
2. Extract `candidates[0].content.parts[]` array.
3. For each part:
   - `text` → accumulate text, diff against previous accumulated text → yield `text_delta` with incremental text.
   - `thought` → accumulate thought, diff against previous → yield `reasoning_delta`.
   - `functionCall` with `name` → yield `tool_call_start` { id: generated UUID, name }.
   - `functionCall` with `args` → diff args JSON string against previous → yield `tool_call_delta` { id, arguments: partial_json }.
4. Extract `usageMetadata` → yield `usage` with normalized `ModelUsage`.
5. Handle edge cases: empty chunks, missing candidates, safety filters (promptFeedback.blockReason).

Tool call ID generation: Gemini does NOT emit tool call IDs in the stream. The provider SHALL generate a UUID for each tool call when `functionCall.name` is first seen. This UUID is used internally for the `tool_call_start` and `tool_call_delta` events, and is stored in `messageParams` for later pairing.

**Why:** The `LlmStreamEvent` type is the canonical contract between provider and `SessionManager`. Converting Gemini's unique SSE chunk format to this event stream ensures `SessionManager` works unchanged — it sees the same 6 event types regardless of provider.

**Acceptance Criteria:**
- [ ] `text` parts → yield `text_delta` with incremental text (diff against previously accumulated text).
- [ ] `thought` parts → yield `reasoning_delta` with incremental thought text.
- [ ] First occurrence of `functionCall.name` → yield `tool_call_start` with generated UUID and function name.
- [ ] `functionCall.args` → yield `tool_call_delta` with incremental arguments JSON diff.
- [ ] `usageMetadata` → yield `usage` with `{ prompt_tokens: N, completion_tokens: M, total_tokens: N+M }`.
- [ ] `promptFeedback.blockReason` present → yield `error` with block reason, then throw.
- [ ] Empty chunks (no candidates, no parts) → no yield, continue.
- [ ] Multiple parts in a single chunk (text + functionCall) → yield all events in order.
- [ ] `npm run typecheck` passes.

---

### FR-006: Gemini Thinking / Reasoning Support

**What:** When `thinkingEnabled` is `true` and the model supports thinking (all Gemini 3 models), the provider SHALL pass `thinkingConfig` in `generationConfig`:

```json
{
  "generationConfig": {
    "thinkingConfig": {
      "thinkingBudget": 8192,
      "includeThoughts": true
    }
  }
}
```

When thinking is disabled:
- `thinkingConfig` is OMITTED entirely (not set to `null` or `{ thinkingBudget: 0 }` — absence means no thinking).

The `GeminiProvider` SHALL NOT use `buildThinkingRequestOptions()` — that function is specific to OpenAI/DeepSeek. Instead, Gemini thinking configuration is built inline in `GeminiProvider.chat()`.

When thinking is enabled:
- The provider sends `thinkingConfig: { thinkingBudget: 8192, includeThoughts: true }` in `generationConfig`.
- The provider accumulates `thought` parts from the stream and yields them as `reasoning_delta`.
- The thought content is stored in `messageParams.reasoning_content` on the resulting `SessionMessage` for future echo-back (same pattern as Anthropic and OpenAI).

When thinking is disabled:
- `thinkingConfig` is absent from the request.
- No `thought` parts are expected in the stream response.
- If thought parts ARE present (Gemini may still reason internally), they are accumulated but NOT yielded as `reasoning_delta` (preserved for echo-back only).

**Why:** V6 mandates provider-aware thinking. Gemini 3 models natively support "thinking" (extended reasoning). The `thinkingBudget` token limit controls how long the model spends reasoning before producing the visible response. `budget_tokens: 8192` is a reasonable default that balances reasoning depth with latency.

**Acceptance Criteria:**
- [ ] When `thinkingEnabled: true`, request includes `generationConfig.thinkingConfig: { thinkingBudget: 8192, includeThoughts: true }`.
- [ ] When `thinkingEnabled: false`, `thinkingConfig` is absent from `generationConfig`.
- [ ] `thought` parts from stream are accumulated and yielded as `reasoning_delta` when thinking is enabled.
- [ ] `thought` parts are stored in `messageParams.reasoning_content` for echo-back in subsequent messages.
- [ ] `npm run typecheck` passes.

---

### FR-007: Provider Registry Routing — Gemini

**What:** `createLlmProvider()` in `src/common/llm-provider-registry.ts` SHALL route model names starting with `gemini-` to `GeminiProvider`.

**Updated routing table:**

| Model prefix (case-insensitive) | Provider class | Engine name |
|---|---|---|
| `deepseek-` | `DeepSeekProvider` | (undefined — uses global) |
| `gpt-`, `o1`, `o3`, `o4`, `openai-` | `OpenAIProvider` | `"openai"` |
| `claude-` | `AnthropicProvider` | `"anthropic"` |
| `gemini-` | `GeminiProvider` | `"gemini"` |
| Unknown / no match | `DeepSeekProvider` (backward-compatible default) | (undefined) |

The registry SHALL:
1. Import `GeminiProvider`.
2. Add `isGeminiModel()` helper function (lowercase starts with `"gemini-"`).
3. Add Gemini routing branch: when `isGeminiModel(settings.model)`, create `new GeminiProvider()`.
4. Gemini routing is checked AFTER Anthropic and BEFORE the DeepSeek default.

**Why:** Per P1 (Interface-First) and P7 (Provider-Agnostic Configuration), the registry is the single routing point. Adding a 4th provider follows the same pattern as specs 40 and 50.

**Acceptance Criteria:**
- [ ] `createLlmProvider()` with model `"gemini-3.5-flash"` creates `GeminiProvider`.
- [ ] `createLlmProvider()` with model `"gemini-2.5-pro"` creates `GeminiProvider`.
- [ ] `createLlmProvider()` with model `"gemini-3.1-flash-lite"` creates `GeminiProvider`.
- [ ] `createLlmProvider()` with model `"deepseek-v4-pro"` still creates `DeepSeekProvider` (no regression).
- [ ] `npm run typecheck` passes.

---

### FR-008: Gemini Model Capabilities and Pricing

**What:** `model-capabilities.ts` and `model-catalog.ts` SHALL gain entries for Google Gemini models.

**`DEFAULT_MODEL_PRICING` additions** (`src/common/model-capabilities.ts`):
```typescript
"gemini-3.5-flash":      { inputPrice: 1.50, outputPrice: 9.00, cacheReadPrice: 0.15 },
"gemini-3-flash":         { inputPrice: 1.00, outputPrice: 6.00, cacheReadPrice: 0.10 },
"gemini-3.1-flash-lite":  { inputPrice: 0.25, outputPrice: 1.50, cacheReadPrice: 0.025 },
"gemini-2.5-pro":         { inputPrice: 2.50, outputPrice: 15.00, cacheReadPrice: 0.25 },
"gemini-2.5-flash":       { inputPrice: 0.50, outputPrice: 3.00, cacheReadPrice: 0.05 },
```

Prices are USD per 1M tokens, sourced from `https://ai.google.dev/gemini-api/docs/pricing` as of June 2026. Output price INCLUDES thinking tokens per Google's pricing model.

**`MODEL_CATALOG` additions** (`src/common/model-catalog.ts`):
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

The `ModelEntry.provider` type SHALL be extended to include `"gemini"`:
```typescript
export type ModelEntry = {
  ...
  provider: "deepseek" | "openai" | "anthropic" | "gemini";
  ...
};
```

**Why:** Budget tracking requires pricing data. Model catalog enables the `/model` dropdown and capability detection. Gemini pricing is per 1M tokens, with output price including thinking tokens.

**Acceptance Criteria:**
- [ ] `DEFAULT_MODEL_PRICING` has entries for 5 Gemini models with correct prices per official Google pricing.
- [ ] `MODEL_CATALOG` has entries for 5 Gemini models with correct capabilities.
- [ ] `ModelEntry.provider` type union includes `"gemini"`.
- [ ] `isMultimodalModel()` returns `true` for Gemini models (default behavior — no changes needed).
- [ ] `getModelCapabilities("gemini-3.5-flash")` returns complete `ModelCapabilities` with pricing.
- [ ] `npm run typecheck` passes.

---

### FR-009: Gemini API Key Resolution and Engine Config

**What:** The `engines.gemini` entry in settings SHALL follow the same pattern as `engines.openai` (Spec 40 FR-001) and `engines.anthropic` (Spec 50 FR-010):

1. Engine-specific env vars: `DEEPCODE_ENGINE_GEMINI_API_KEY`, `DEEPCODE_ENGINE_GEMINI_BASE_URL`.
2. Engine settings: `settings.json` → `engines.gemini.apiKey`, `engines.gemini.baseURL`.
3. Global fallback: `DEEPCODE_API_KEY` and `BASE_URL`.

The `collectEngineEnv()` function in `settings.ts` already supports arbitrary engine names — no changes needed.

**Why:** Per arch.md P7, provider-specific options are namespaced under `engines.<name>`. The Gemini engine follows the exact same pattern established in Spec 40 and extended in Spec 50.

**Acceptance Criteria:**
- [ ] `DEEPCODE_ENGINE_GEMINI_API_KEY` env var populates `engines.gemini.apiKey`.
- [ ] `DEEPCODE_ENGINE_GEMINI_BASE_URL` env var populates `engines.gemini.baseURL`.
- [ ] `engines.gemini` in `settings.json` resolves correctly.
- [ ] Missing Gemini API key results in `apiKey: null` from `createGeminiClient()`.
- [ ] `npm run typecheck` passes.

---

### FR-010: `getCheapModel` for GeminiProvider

**What:** `GeminiProvider.getCheapModel()` SHALL map Gemini models to the cheapest alternative that still supports the same API features:

```typescript
getCheapModel(model: string): string | null {
  if (model === "gemini-3.5-flash") return "gemini-3.1-flash-lite";
  if (model === "gemini-3-flash") return "gemini-3.1-flash-lite";
  if (model === "gemini-2.5-pro") return "gemini-2.5-flash";
  if (model === "gemini-2.5-flash") return "gemini-3.1-flash-lite";
  if (model === "gemini-3.1-flash-lite") return null;
  // Heuristic: try "gemini-3.1-flash-lite" for any unknown Gemini model
  if (model.toLowerCase().startsWith("gemini-")) return "gemini-3.1-flash-lite";
  return null;
}
```

**Why:** Per ADR-005 and Spec 40 FR-005, compaction uses the cheapest available model. For Gemini, `gemini-3.1-flash-lite` at $0.25/$1.50 per 1M tokens is the most cost-efficient option. It's also the fastest and designed for "high-frequency, lightweight tasks" — ideal for compaction.

**Acceptance Criteria:**
- [ ] `getCheapModel("gemini-3.5-flash")` returns `"gemini-3.1-flash-lite"`.
- [ ] `getCheapModel("gemini-2.5-pro")` returns `"gemini-2.5-flash"`.
- [ ] `getCheapModel("gemini-3.1-flash-lite")` returns `null` (already the cheapest).
- [ ] Heuristic handles unknown Gemini models by returning `"gemini-3.1-flash-lite"`.
- [ ] `npm run typecheck` passes.

---

### FR-011: Retry Status Code 529 Already Supported

**What:** The `withRetry()` function in `api-retry.ts` already includes HTTP 529 (added in Spec 50 for Anthropic). Gemini's REST API uses standard HTTP status codes — 429 (rate limit), 502/503/529 (server errors). No changes to `api-retry.ts` are required.

**Verification:** `RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 529])` — already present. Gemini's `fetch()` errors will include HTTP status codes in error messages, which `isRetryableError()` already pattern-matches.

**Acceptance Criteria:**
- [ ] ZERO changes to `src/common/api-retry.ts`.
- [ ] `withRetry()` handles fetch errors with 429/502/503/529 status codes.

---

### FR-012: Backward Compatibility — Existing Behavior Preserved

**What:** When `settings.model` does NOT start with `gemini-`, the system SHALL behave identically to pre-spec behavior. DeepSeek, OpenAI, and Anthropic providers are untouched. The `engines.gemini` field is optional — absence means no Gemini provider is created (unless model starts with `gemini-`, in which case it throws "Gemini API key not configured").

**Why:** Per L1 (layer multi-provider work), each spec must be independently shippable without regressions.

**Acceptance Criteria:**
- [ ] All existing tests pass with zero failures (`npm test`).
- [ ] DeepSeek chat sessions work identically.
- [ ] OpenAI chat sessions work identically.
- [ ] Anthropic chat sessions work identically.
- [ ] `settings.json` without `engines.gemini` entry works identically.
- [ ] `npm test` returns exit code 0.

---

### FR-013: SessionManager — No Structural Changes for Gemini

**What:** `SessionManager` SHALL work with `GeminiProvider` without any code changes. The `ILlmProvider` interface already abstracts all provider-specific behavior. `GeminiProvider.chat()` yields the same `LlmStreamEvent` types, so `SessionManager`'s stream consumption loop is unchanged.

**Why:** This is the ultimate validation of Spec 30's architecture. If `SessionManager` needs changes for a 4th provider (especially one using raw HTTP fetch with no SDK), the `ILlmProvider` abstraction is insufficient.

**Acceptance Criteria:**
- [ ] `session.ts` has ZERO changes.
- [ ] `SessionManager.createChatCompletionStream()` works with `GeminiProvider` via `ILlmProvider` interface.
- [ ] Compaction works with Gemini models via `getCheapModel()`.
- [ ] Budget tracking works with Gemini usage data (normalized to `ModelUsage` shape).
- [ ] `npm run typecheck` passes.

---

## Non-Functional Requirements

### NFR-001: Zero New npm Dependencies

**What:** NO npm packages are added, removed, or updated. Gemini API access uses Node 24's built-in `fetch()`.

**Why:** P6 (Zero New Dependencies Without Justification). Unlike Anthropic (which required `@anthropic-ai/sdk` for complex SSE parsing with typed events, content block tracking, and thinking signature verification), Gemini's REST API is simple enough to consume with standard `fetch()` + SSE line parsing. Adding `@google/genai` SDK would be ≈60KB of unnecessary weight for functionality achievable in ~200 lines of fetch-based code.

**Acceptance Criteria:**
- [ ] `package.json` has zero changes.
- [ ] `package-lock.json` has zero changes.
- [ ] `npm ls` shows no new packages.

### NFR-002: Type Safety

**What:** All code must pass TypeScript type checking with zero errors.

**Acceptance Criteria:**
- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npm run lint` passes with zero new warnings.
- [ ] `npm run format:check` passes (no unformatted files).

### NFR-003: Test Coverage

**What:** New code must be covered by tests. Existing tests must not be weakened.

**Acceptance Criteria:**
- [ ] New tests for `GeminiMessageConverter`: tool pairing, system-to-systemInstruction conversion, parts array generation, multimodal filtering, interrupted tool backfill.
- [ ] New tests for `GeminiProvider.chat()`: streaming text, thought/reasoning delta, tool call start/delta, usage accumulation, abort, missing API key, blocked content.
- [ ] New tests for `convertToolsToGemini()`: empty array, single tool, multiple tools, parameter passthrough.
- [ ] New tests for `buildMessages()`: user message → `{ role: "user", parts: [...] }`, assistant → `{ role: "model", parts: [...] }`, tool → `{ role: "tool", parts: [...] }`.
- [ ] New tests for `createLlmProvider()` routing with `gemini-` prefix models.
- [ ] New tests for `GeminiProvider.getCheapModel()`.
- [ ] New tests for `createGeminiClient()`: engine key resolution, default base URL, missing key → null.
- [ ] New tests for `streamToEvents()`: all SSE chunk patterns, empty chunks, multi-part chunks, safety filter blocks.
- [ ] All tests for `GeminiProvider` MUST use mock fetch responses — no real API calls.
- [ ] Existing test count preserved; no more than 3 existing tests modified (only to register Gemini in registry mocks).
- [ ] `npm test` passes all tests (existing + new).

### NFR-004: SSE Parsing Robustness

**What:** The Gemini SSE parser SHALL handle:
- Chunks split across TCP packets (partial `data:` lines).
- Empty `data:` lines (heartbeats / keepalives).
- Malformed JSON in `data:` lines (log warning, skip chunk, continue).
- `data:` lines with `[DONE]` signal (stream end marker, if present).

**Why:** SSE over raw HTTP is less robust than SDK-handled SSE. The parser must be resilient to network-level chunking and protocol edge cases.

**Acceptance Criteria:**
- [ ] Incomplete `data:` lines are buffered and completed when the remainder arrives.
- [ ] Empty `data:` lines (just `data: ` or `data: {}`) are skipped without error.
- [ ] Malformed JSON logs warning and continues (does not crash the stream).
- [ ] `[DONE]` signal (if sent by Gemini) cleanly terminates the stream.
- [ ] `npm run typecheck` passes.

### NFR-005: Message Converter Performance

**What:** `GeminiMessageConverter.buildMessages()` must handle sessions with 500+ messages efficiently (under 10ms amortized per call). Implementation SHALL avoid O(n^2) patterns, using Map-based O(n) tool pairing (same algorithm as `OpenAIMessageConverter` and `AnthropicMessageConverter`).

**Acceptance Criteria:**
- [ ] `buildMessages` uses `pairToolMessages` with Map-based O(n) pairing.
- [ ] No nested loops scanning all messages per tool call.

---

## Constraints

1. **C1:** `SessionMessage` type MUST NOT change — canonical format per ADR-004.
2. **C2:** `ToolDefinition` type MUST NOT change — used by all providers.
3. **C3:** `ModelUsage` type MUST NOT change — Gemini usage is normalized to this shape (`prompt_tokens`, `completion_tokens`, `total_tokens`).
4. **C4:** `ILlmProvider` interface MUST NOT change — already has `getCheapModel` from Spec 40.
5. **C5:** No existing converter (`OpenAIMessageConverter`, `AnthropicMessageConverter`) may be modified.
6. **C6:** No npm packages may be added or updated (NFR-001).
7. **C7:** Node.js version requirement stays at `>=24` (native `fetch()` is required).
8. **C8:** Bundle target stays at `--target=node24`.
9. **C9:** `session.ts` MUST NOT be modified — Gemini must work through the `ILlmProvider` interface.
10. **C10:** `api-retry.ts` MUST NOT be modified — already has 529 support.
11. **C11:** Zero new files outside `src/common/`, `src/providers/`, and `src/tests/`.
12. **C12:** The provider prefix for Gemini is `gemini-` (lowercase), matching Google's model naming convention.

---

## Edge Cases & Error States

| # | Scenario | Expected Behavior |
|---|---|---|
| EC1 | User sets model to `gemini-3.5-flash` but has no Google API key | `createGeminiClient()` returns `apiKey: null`. `GeminiProvider.chat()` throws `Error("Gemini API key not configured")`. |
| EC2 | Gemini API returns HTTP 429 (rate limit) | `withRetry()` retries up to 3 times with exponential backoff. Already handled by `api-retry.ts`. |
| EC3 | Gemini API returns HTTP 503 (service unavailable) | `withRetry()` retries up to 3 times. |
| EC4 | Gemini SSE stream contains a `promptFeedback.blockReason` (content filtered by safety) | Provider yields `{ type: "error", error: "Content blocked: {blockReason}" }` and throws. |
| EC5 | Gemini SSE `data:` line is split across TCP packets | SSE parser buffers incomplete lines. When `\n` is received, processes the complete line. Also handles `\r\n` line endings by stripping `\r` during line processing. |
| EC6 | Gemini SSE `data:` line is empty or malformed JSON | Empty: skipped silently. Malformed: `console.warn()` and skip chunk. Stream continues. |
| EC7 | Gemini returns multiple `candidates` (unlikely but possible) | Only `candidates[0]` is processed. Additional candidates are ignored. |
| EC8 | Gemini stream has `candidates` but no `content` or `parts` | Chunk is skipped (no yield). Stream continues to next chunk. |
| EC9 | Multiple function calls in a single turn (parallel tool use) | Each `functionCall` part gets its own generated UUID. Both `tool_call_start` events are yielded, then `tool_call_delta` events for each. |
| EC10 | Function call args arrive across multiple chunks (incremental JSON) | Provider accumulates args per tool call ID. Diffs between previous and current accumulated args → yields `tool_call_delta` with incremental JSON string. |
| EC11 | First chunk of stream has no text but directly starts with function call | Provider yields `tool_call_start` immediately. No `text_delta` is yielded until text parts appear. |
| EC12 | Stream ends without `usageMetadata` in the final chunk | Provider yields `usage` with `{ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }`. Not ideal but safe — budget tracking will show $0 cost for that turn. |
| EC13 | Gemini model name with unusual casing (`Gemini-3.5-Flash`) | `supportsModel()` uses `toLowerCase().startsWith("gemini-")` — case-insensitive. |
| EC14 | Both global API_KEY and engine-specific GEMINI_API_KEY are set | Engine-specific key takes priority per `createGeminiClient()` resolution order. |
| EC15 | User sends an image with a multimodal Gemini model | Converter includes `{ inlineData: { mimeType: "...", data: "..." } }` part in the `user` content. |
| EC16 | User sends an image with a non-multimodal Gemini model | Images filtered out by `isMultimodalModel()` check (though all Gemini text models are multimodal). |
| EC17 | Compaction with Gemini model | `provider.getCheapModel("gemini-3.5-flash")` returns `"gemini-3.1-flash-lite"`. Compaction proceeds with Flash-Lite. |
| EC18 | Streaming connection drops mid-response | `fetch()` throws `TypeError`. `withRetry()` retries if network error. `SessionManager` catches and displays error. |
| EC19 | Gemini returns `finishReason: "SAFETY"` in final chunk | Provider yields `{ type: "error", error: "Response blocked by safety filter: {reason}" }`. |
| EC20 | Thinking budget exhausted (model produces less reasoning than budgeted) | Normal behavior — thought content may be shorter than `thinkingBudget`. No error — just less reasoning content yielded. |
| EC21 | `gemini-3.1-flash-lite` with thinking enabled (it shouldn't support thinking) | Provider sends `thinkingConfig` anyway — if Gemini API rejects it, the error is caught by `withRetry()` and surfaced. If Gemini silently ignores it, no thinking content is returned. |
| EC22 | SSE `data:` line ends with `[DONE]` marker | Stream terminates cleanly. Final usage metadata (if any) has already been emitted. |

---

## Dependencies

- **Spec 30** (provider-agnostic-llm-layer): Completed (`audited`). This spec adds a fourth `ILlmProvider` implementation.
- **Spec 40** (openai-provider-adapter): Completed (`audited`). `engines` field and `EngineEntry` type already exist. `ILlmProvider.getCheapModel` already exists.
- **Spec 50** (anthropic-provider-adapter): Completed (`audited`). HTTP 529 support already in `api-retry.ts`. Provider registry already has multi-provider routing.
- **Spec 60** (model-selection-configuration): Completed (`audited`). Model catalog infrastructure already exists.
- **ADR-001** (OpenAI SDK): Not directly relevant — Gemini uses raw fetch, not any SDK.
- **ADR-002** (Provider Interface Pattern): This spec adds a fourth implementation, further validating the interface.
- **ADR-004** (SessionMessage Canonical): Preserved — Gemini uses `GeminiMessageConverter`.
- **ADR-005** (Flash Compaction): Already generalized by Spec 40's `getCheapModel()`.
- **Node 24 built-in `fetch()`**: Required for raw HTTP calls without additional dependencies.

---

## Out of Scope

- Adding Gemini to the `/model` command dropdown (→ Spec 60 already handles this via `MODEL_CATALOG`).
- Gemini-specific features: Google Search grounding, code execution, URL context, computer use, files API, batch processing.
- Prompt caching for Gemini (context caching is a separate feature).
- Live API (real-time audio/video) — text-only generateContent API only.
- Multimodal input beyond images (audio, video, PDF uploads via Files API).
- Thinking budget configuration per model (hardcoded as 8192 tokens).
- Token counting using Gemini's tokenizer (`countTokens` endpoint is out of scope).
- Documentation files.
- Changes to `session.ts`.
- Gemma open models (Gemma is a different API/product from Gemini).
- Vertex AI Gemini API (enterprise Google Cloud platform) — consumer Gemini API only.
- `safetySettings` configuration (uses Gemini API defaults).
