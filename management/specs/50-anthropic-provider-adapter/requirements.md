# Spec 50: anthropic-provider-adapter — Requirements

## Value Delivery

Delivers value block **V6** (Multi-Model Support) and refines **V12** (Provider-Agnostic LLM Architecture) from vision.md.

> **V6:** *"Support for multiple LLM providers beyond DeepSeek: Anthropic (Claude family) via Messages API. Thinking/reasoning mode is provider-aware: Anthropic: `thinking` content blocks with signature verification. Tool calling uses each provider's native format, converted from a canonical internal representation."*

> **V12:** *"A clean internal boundary between DsCode's orchestration layer and any specific LLM provider SDK. Defined by the `ILlmProvider` interface: single contract `chat(options) → AsyncIterable<LlmStreamEvent>`, canonical message format `SessionMessage`, unified stream events, provider registry."*

---

## Functional Requirements

### FR-001: Add `@anthropic-ai/sdk` npm Dependency

**What:** The project SHALL install `@anthropic-ai/sdk` as a runtime dependency. This is the official Anthropic SDK for Node.js, required because Anthropic's Messages API has a fundamentally different wire format from OpenAI's Chat Completions API (SSE events, content blocks, different tool schema, thinking blocks with signatures). Per ADR-001: *"Anthropic requires its own SDK (`@anthropic-ai/sdk`) due to incompatible API shape."*

**Why:** ADR-001 explicitly mandates the Anthropic SDK for Anthropic provider support. The SDK handles SSE parsing, stream lifecycle, message accumulation, and error handling — reimplementing this in-tree would be hundreds of lines of battle-tested code duplicated unnecessarily.

**Acceptance Criteria:**
- [ ] `package.json` has `@anthropic-ai/sdk` in `dependencies` with a version range `^0.60.0` (or latest stable).
- [ ] `package-lock.json` is updated by `npm install`.
- [ ] `npm run build` succeeds with the new dependency.
- [ ] `npm test` passes — no regressions from the new dependency.

---

### FR-002: Create `AnthropicMessageConverter` Class

**What:** Create class `AnthropicMessageConverter` at `src/common/anthropic-message-converter.ts` that converts internal `SessionMessage[]` arrays into Anthropic `MessageParam[]` arrays. This is a NEW converter — it is NOT shared with `OpenAIMessageConverter` because the wire format is fundamentally different (content blocks vs. object with string content).

The Anthropic Messages API wire format:
```
// User message
{ role: "user", content: [{ type: "text", text: "Hello" }] }

// Assistant message with tool use
{ role: "assistant", content: [
  { type: "text", text: "Let me search..." },
  { type: "tool_use", id: "toolu_01...", name: "read", input: { file_path: "/foo" } }
] }

// Tool result message
{ role: "user", content: [
  { type: "tool_result", tool_use_id: "toolu_01...", content: "..." }
] }
```

The converter SHALL:
1. Filter compacted messages (same as `OpenAIMessageConverter`).
2. Extract `system` role messages — accumulate their content to a separate `systemPrompt` string (NOT included in the messages array). Anthropic uses a top-level `system` parameter in the API request, NOT system messages in the conversation. The accumulated prompt is exposed via `getSystemPrompt()`.
3. Convert `user` role messages to Anthropic content blocks (text + images).
4. Convert `assistant` role messages to Anthropic content blocks (text + tool_use + thinking).
5. Convert `tool` role messages to Anthropic content blocks (tool_result — MUST be wrapped in a `user` role message per Anthropic API requirements).
6. Handle tool pairing (assistant tool_call → tool result) same as OpenAIMessageConverter.
7. Handle multimodal content (images) filtering by model capability.
8. Handle thinking content: when `thinkingEnabled` is true and message has `reasoning_content`, emit a `thinking` content block with signature.

**Why:** ADR-004 establishes `SessionMessage` as canonical format. Each provider converts to its own wire format. Anthropic's format is incompatible with OpenAI's — content is an array of typed blocks, tool results are user messages, and system prompts are a top-level API parameter.

**Acceptance Criteria:**
- [ ] File `src/common/anthropic-message-converter.ts` exists.
- [ ] Exports `AnthropicMessageConverter` class.
- [ ] Method `buildMessages(messages: SessionMessage[], thinkingEnabled: boolean, model: string): MessageParam[]`.
- [ ] `system` role messages are NOT emitted as `MessageParam` — the converter collects them separately to be exposed via `getSystemPrompt(): string`.
- [ ] `user` role messages convert to `{ role: "user", content: [{ type: "text", text: "..." }] }`.
- [ ] `assistant` role messages with tool calls convert to `{ role: "assistant", content: [{ type: "text", ... }, { type: "tool_use", ... }] }`.
- [ ] `tool` role messages convert to `{ role: "user", content: [{ type: "tool_result", tool_use_id: "...", content: "..." }] }`.
- [ ] Tool pairing logic matches `OpenAIMessageConverter.pairToolMessages()`.
- [ ] Multimodal content filtering respects `isMultimodalModel()`.
- [ ] Interrupted tool calls produce injected fallback `tool_result` blocks.
- [ ] `getSystemPrompt()` returns concatenated system message content (or empty string if none).
- [ ] `npm run typecheck` passes.

---

### FR-003: Create `AnthropicClient` Factory Function

**What:** Create function `createAnthropicClient()` at `src/common/anthropic-client.ts` that returns an `Anthropic` SDK client instance. The function SHALL:

1. Read settings via `resolveCurrentSettings(projectRoot)`.
2. Accept optional `engineName` parameter for engine-specific credentials (same pattern as `createOpenAIClient(projectRoot, engineName)` in Spec 40).
3. Resolve API key and base URL from: engine-specific config → engine default → global fallback.
4. Engine default base URL for `anthropic`: `https://api.anthropic.com`.
5. Cache the `Anthropic` client instance by `apiKey::baseURL` key.
6. Return `{ client: Anthropic | null, model: string, thinkingEnabled: boolean, debugLogEnabled: boolean, telemetryEnabled: boolean, maxTokens: number, notify?: string, env: Record<string, string> }` — a shape similar to `createOpenAIClient` but omitting provider-irrelevant fields (`baseURL`, `temperature`).
7. Return `client: null` when no API key is configured.

**Why:** The client factory follows the same pattern as `createOpenAIClient` (Spec 40 Component 3) for consistency. Engine-specific credential resolution is necessary because Anthropic requires a different API key than DeepSeek or OpenAI.

**Acceptance Criteria:**
- [ ] File `src/common/anthropic-client.ts` exists.
- [ ] Exports `createAnthropicClient(projectRoot?: string, engineName?: string)`.
- [ ] Returns `client: null` when no Anthropic API key configured.
- [ ] API key resolution: `DEEPCODE_ENGINE_ANTHROPIC_API_KEY` → `engines.anthropic.apiKey` → `DEEPCODE_API_KEY` → `settings.apiKey`.
- [ ] Base URL resolution: `DEEPCODE_ENGINE_ANTHROPIC_BASE_URL` → `engines.anthropic.baseURL` → `https://api.anthropic.com` → `settings.baseURL`.
- [ ] Engine-specific default base URL constant `ENGINE_DEFAULT_BASE_URLS` in the new `anthropic-client.ts` includes `anthropic: "https://api.anthropic.com"` (NOT added to `openai-client.ts` — each client file manages its own defaults).
- [ ] Client cached per `apiKey::baseURL` key.
- [ ] `npm run typecheck` passes.

---

### FR-004: Create `AnthropicProvider` Class

**What:** Create class `AnthropicProvider` at `src/providers/anthropic-provider.ts` implementing `ILlmProvider`. This is the THIRD provider (after DeepSeek and OpenAI). Unlike DeepSeekProvider and OpenAIProvider which share the OpenAI SDK and streaming pattern, AnthropicProvider uses:

1. **SDK:** `@anthropic-ai/sdk` (not `openai`).
2. **Messages API:** `client.messages.create()` (not `client.chat.completions.create()`).
3. **Streaming:** `client.messages.stream()` returns SSE events via `AnthropicStream` helper (different from OpenAI's `for await (const chunk of stream)`).
4. **Thinking:** `thinking` content blocks with `thinking_delta` and `signature_delta` events. The signature MUST be echoed back in subsequent messages for verification.
5. **Tool calls:** Emitted via `content_block_start` with `type: "tool_use"` and `content_block_delta` with `type: "input_json_delta"` — fundamentally different from OpenAI's `delta.tool_calls[].function.arguments`.
6. **Usage:** Available from `message_start` event (input tokens) and accumulated `message_delta` events (output tokens) — NOT from `include_usage` per-chunk like OpenAI.

The provider SHALL:
- Implement all `ILlmProvider` methods: `supportsModel`, `chat`, `getTimeoutMs`, `isMultimodal`, `getCheapModel`.
- Have `readonly providerName = "anthropic"`.
- Support models with prefix `claude-` (case-insensitive).
- Yield the SAME 6 `LlmStreamEvent` variants as DeepSeek and OpenAI.
- Use `withRetry()` for transient failures.
- Convert Anthropic stream events to `LlmStreamEvent` via a private `*streamToEvents()` generator.

**Why:** This is the first provider that uses a non-OpenAI-compatible SDK. It validates the `ILlmProvider` interface for providers with fundamentally different APIs — proof that the spec 30 architecture abstracts correctly.

**Acceptance Criteria:**
- [ ] File `src/providers/anthropic-provider.ts` exists.
- [ ] `AnthropicProvider` class exports and implements `ILlmProvider` (TypeScript verifiable).
- [ ] `supportsModel()` returns `true` for model names starting with `claude-`.
- [ ] `getTimeoutMs()` returns `300_000` for reasoning models (opus/sonnet), `180_000` for haiku.
- [ ] `isMultimodal()` returns `true` for all Claude models (Claude 3+ supports vision).
- [ ] `getCheapModel()` maps opus/sonnet → haiku, returns `null` for haiku or unknown.
- [ ] `chat()` calls `client.messages.create()` with `stream: true`.
- [ ] `chat()` uses `AnthropicMessageConverter.buildMessages()` for message conversion.
- [ ] `chat()` sends `system` parameter from `converter.getSystemPrompt()` when non-empty.
- [ ] `chat()` converts Anthropic SSE stream events to `LlmStreamEvent` via `streamToEvents()`.
- [ ] `chat()` yields all 6 `LlmStreamEvent` variants: `text_delta`, `reasoning_delta`, `tool_call_start`, `tool_call_delta`, `usage`, `error`.
- [ ] `chat()` accumulates `thinking_delta` events and yields as `reasoning_delta`.
- [ ] `chat()` accumulates `signature_delta` — attaches to the final reasoning content for later echo-back.
- [ ] `chat()` extracts usage from `message_start.input_tokens` + `message_delta.usage.output_tokens` → converts to `ModelUsage` shape.
- [ ] `npm run typecheck` passes.

---

### FR-005: Anthropic Tool Definition Converter

**What:** Create function `convertToolsToAnthropic()` at `src/common/anthropic-message-converter.ts` that converts the internal `ToolDefinition[]` format (OpenAI-style) to Anthropic's tool format.

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

Anthropic format:
```typescript
type AnthropicTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};
```

**Why:** Anthropic uses a flat tool schema (`name`, `description`, `input_schema`) vs OpenAI's nested schema (`{ type: "function", function: { name, description, parameters } }`). The conversion is mechanical but must be explicit and tested.

**Acceptance Criteria:**
- [ ] Function `convertToolsToAnthropic(tools: ToolDefinition[]): AnthropicTool[]` exists.
- [ ] `ToolDefinition.function.name` → `AnthropicTool.name`.
- [ ] `ToolDefinition.function.description` → `AnthropicTool.description`.
- [ ] `ToolDefinition.function.parameters` → `AnthropicTool.input_schema`.
- [ ] `additionalProperties` is NOT forwarded to `input_schema` (Anthropic doesn't support it).
- [ ] Empty tools array returns empty array.
- [ ] `npm run typecheck` passes.

---

### FR-006: Anthropic Stream Event to LlmStreamEvent Conversion

**What:** The `AnthropicProvider.chat()` SHALL internally iterate over Anthropic SSE stream events and convert them to the canonical `LlmStreamEvent` type. The conversion logic SHALL be in a private `*streamToEvents()` generator method.

Anthropic SSE event types and their `LlmStreamEvent` mappings:

| Anthropic Event | LlmStreamEvent |
|---|---|
| `message_start` | NO yield (save input_tokens) |
| `content_block_start` (type: `text`) | NO yield (track that content block is text) |
| `content_block_start` (type: `tool_use`) | `tool_call_start` { id, name } |
| `content_block_start` (type: `thinking`) | NO yield (track thinking block) |
| `content_block_delta` (type: `text_delta`) | `text_delta` { text } |
| `content_block_delta` (type: `input_json_delta`) | `tool_call_delta` { id, arguments: partial_json } |
| `content_block_delta` (type: `thinking_delta`) | `reasoning_delta` { text: thinking } |
| `content_block_delta` (type: `signature_delta`) | NO yield (save signature for echo-back) |
| `content_block_stop` | NO yield (finalize accumulated block) |
| `message_delta` (usage, stop_reason) | `usage` (emit cumulative usage as `ModelUsage`) |
| `message_stop` | NO yield (stream end) |
| `error` | `error` { error } |

Usage accumulation: The `message_start` event carries `{ input_tokens: N, output_tokens: 1 }`. The `message_delta` event carries `{ usage: { output_tokens: M } }` where M is the cumulative output. The emitted `ModelUsage` SHALL be:
```typescript
{
  prompt_tokens: input_tokens_from_message_start,
  completion_tokens: output_tokens_from_message_delta,
  total_tokens: input_tokens + output_tokens,
}
```

**Why:** The `LlmStreamEvent` type is the canonical contract between provider and `SessionManager`. Converting Anthropic's unique SSE event stream to this format ensures `SessionManager` works unchanged.

**Acceptance Criteria:**
- [ ] `message_start` → extracts `input_tokens`, stores for later `usage` event.
- [ ] `content_block_start` with `tool_use` → yields `{ type: "tool_call_start", id: block.id, name: block.name }`.
- [ ] `content_block_delta` with `text_delta` → yields `{ type: "text_delta", text: delta.text }`.
- [ ] `content_block_delta` with `input_json_delta` → yields `{ type: "tool_call_delta", id: currentToolUseId, arguments: delta.partial_json }`.
- [ ] `content_block_delta` with `thinking_delta` → yields `{ type: "reasoning_delta", text: delta.thinking }`.
- [ ] `content_block_delta` with `signature_delta` → stored for echo-back, NOT yielded.
- [ ] `message_delta` with usage → yields `{ type: "usage", usage: { prompt_tokens: N, completion_tokens: M, total_tokens: N+M } }`.
- [ ] `error` event → yields `{ type: "error", error }` then throws.
- [ ] Independent tool_use blocks are correctly associated via the current block index tracking.
- [ ] `npm run typecheck` passes.

---

### FR-007: Anthropic Thinking / Extended Thinking Support

**What:** When `thinkingEnabled` is `true` and model supports extended thinking, the provider SHALL pass the `thinking` parameter in the API request:

```typescript
// thinking enabled
thinking: { type: "enabled", budget_tokens: 32768 }

// thinking disabled (compaction, tool-only)
thinking: { type: "disabled" }
```

The `AnthropicProvider` SHALL NOT use `buildThinkingRequestOptions()` — that function is specific to the OpenAI/DeepSeek Chat Completions wire format. Instead, Anthropic thinking configuration is built inline in `AnthropicProvider.chat()`.

When thinking is enabled:
- The provider sends `thinking: { type: "enabled", budget_tokens: 32768 }` as a top-level parameter.
- The provider accumulates `thinking_delta` events and yields them as `reasoning_delta`.
- The provider accumulates `signature_delta` events and stores the signature for echo-back in subsequent messages.
- The subsequent `assistant` message MUST include the thinking block with the signature when sent back to the API. This is handled by `AnthropicMessageConverter` which includes thinking blocks in assistant messages when `reasoning_content` + `signature` are present.

When thinking is disabled:
- The provider sends `thinking: { type: "disabled" }`.
- No thinking blocks are expected in the stream response.

**Why:** V6 explicitly describes: *"Anthropic: `thinking` content blocks with signature verification."* The signature is a cryptographic commitment that must be echoed back to the API unchanged. The converter stores the signature in the assistant message's `messageParams` so it can be reconstructed in future calls.

**Acceptance Criteria:**
- [ ] When `thinkingEnabled: true`, request includes `thinking: { type: "enabled", budget_tokens: 32768 }`.
- [ ] When `thinkingEnabled: false`, request includes `thinking: { type: "disabled" }`.
- [ ] `thinking_delta` events are accumulated and yielded as `reasoning_delta`.
- [ ] `signature_delta` events are accumulated and stored.
- [ ] `AnthropicMessageConverter` includes thinking block with signature in assistant messages when available.
- [ ] `npm run typecheck` passes.

---

### FR-008: Provider Registry Routing — Anthropic

**What:** `createLlmProvider()` in `src/common/llm-provider-registry.ts` SHALL route model names starting with `claude-` to `AnthropicProvider`.

**Updated routing table:**

| Model prefix (case-insensitive) | Provider class | Engine name |
|---|---|---|
| `deepseek-` | `DeepSeekProvider` | (undefined — uses global) |
| `gpt-`, `o1`, `o3`, `o4`, `openai-` | `OpenAIProvider` | `"openai"` |
| `claude-` | `AnthropicProvider` | `"anthropic"` |
| Unknown / no match | `DeepSeekProvider` (backward-compatible default) | (undefined) |

The registry SHALL:
1. Import `AnthropicProvider`.
2. Import `createAnthropicClient` for engine-aware client creation.
3. Create a `CreateAnthropicClient` type export (similar to `CreateOpenAIClient`).
4. When model starts with `claude-`, instantiate `AnthropicProvider` with an anthropic client factory.

**Why:** Per P1 (Interface-First) and P7 (Provider-Agnostic Configuration), the registry is the single routing point.

**Acceptance Criteria:**
- [ ] `createLlmProvider()` with model `"claude-opus-4-8"` creates `AnthropicProvider`.
- [ ] `createLlmProvider()` with model `"claude-sonnet-4-5"` creates `AnthropicProvider`.
- [ ] `createLlmProvider()` with model `"claude-haiku-4-5"` creates `AnthropicProvider`.
- [ ] Anthropic provider internally uses `engineName = "anthropic"` when creating its client (hardcoded in `chat()`). No factory injection from registry.
- [ ] `npm run typecheck` passes.

---

### FR-009: Anthropic Model Capabilities and Pricing

**What:** `model-capabilities.ts` SHALL gain entries for Anthropic Claude models:

```typescript
// DEFAULT_MODEL_PRICING entries
"claude-opus-4-8":   { inputPrice: 15.00, outputPrice: 75.00, cacheReadPrice: 1.50 },
"claude-sonnet-4-5":  { inputPrice: 3.00,  outputPrice: 15.00, cacheReadPrice: 0.30 },
"claude-haiku-4-5":   { inputPrice: 0.80,  outputPrice: 4.00,  cacheReadPrice: 0.08 },
```

The `isMultimodalModel()` function SHALL NOT require changes — Claude 3+ models all support vision, so the default `true` return is correct.

The `getCompactPromptTokenThreshold()` function SHALL return the default threshold for Claude models (128K tokens, same as the `DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD`).

**Why:** Budget tracking (FR-007 in Spec 40) requires pricing data. Claude pricing is per 1M tokens in USD. All Claude 3+ models support multimodal.

**Acceptance Criteria:**
- [ ] `DEFAULT_MODEL_PRICING` has entries for 3 Claude models.
- [ ] Prices verified against official Anthropic pricing page (`https://www.anthropic.com/pricing`).
- [ ] `isMultimodalModel()` returns `true` for all Claude models (default behavior works).
- [ ] `getCompactPromptTokenThreshold("claude-sonnet-4-5")` returns `128 * 1024`.
- [ ] `npm run typecheck` passes.

---

### FR-010: Anthropic API Key Resolution and Engine Config

**What:** The `engines.anthropic` entry in settings SHALL follow the same pattern as `engines.openai` (Spec 40 FR-001, FR-009):

1. Engine-specific env vars: `DEEPCODE_ENGINE_ANTHROPIC_API_KEY`, `DEEPCODE_ENGINE_ANTHROPIC_BASE_URL`.
2. Engine settings: `settings.json` → `engines.anthropic.apiKey`, `engines.anthropic.baseURL`.
3. Global fallback: `DEEPCODE_API_KEY` and `BASE_URL`.

The `collectEngineEnv()` function in `settings.ts` already supports arbitrary engine names — no changes needed. The new `anthropic-client.ts` file includes its own `ENGINE_DEFAULT_BASE_URLS` map with `"anthropic": "https://api.anthropic.com"`.

**Why:** Per arch.md P7, provider-specific options are namespaced under `engines.<name>`. The Anthropic engine follows the exact same pattern established in Spec 40.

**Acceptance Criteria:**
- [ ] `DEEPCODE_ENGINE_ANTHROPIC_API_KEY` env var populates `engines.anthropic.apiKey`.
- [ ] `DEEPCODE_ENGINE_ANTHROPIC_BASE_URL` env var populates `engines.anthropic.baseURL`.
- [ ] `engines.anthropic` in `settings.json` resolves correctly.
- [ ] Missing Anthropic API key results in `client: null` from `createAnthropicClient("anthropic")`.
- [ ] `npm run typecheck` passes.

---

### FR-011: `getCheapModel` for AnthropicProvider

**What:** `AnthropicProvider.getCheapModel()` SHALL map premium Claude models to `claude-haiku-4-5`:

```typescript
getCheapModel(model: string): string | null {
  if (model === "claude-opus-4-8") return "claude-haiku-4-5";
  if (model === "claude-sonnet-4-5") return "claude-haiku-4-5";
  if (model === "claude-haiku-4-5") return null;
  // Heuristic: try replacing "opus" or "sonnet" with "haiku"
  if (model.includes("opus") || model.includes("sonnet")) {
    return model.replace(/opus|sonnet/g, "haiku");
  }
  return null;
}
```

**Why:** Per Spec 40 FR-005 and ADR-005, compaction uses the cheapest model available. For Anthropic, Claude Haiku is the cost-optimized model.

**Acceptance Criteria:**
- [ ] `getCheapModel("claude-opus-4-8")` returns `"claude-haiku-4-5"`.
- [ ] `getCheapModel("claude-sonnet-4-5")` returns `"claude-haiku-4-5"`.
- [ ] `getCheapModel("claude-haiku-4-5")` returns `null`.
- [ ] Heuristic handles unknown Claude models with "opus"/"sonnet" in the name.
- [ ] `npm run typecheck` passes.

---

### FR-012: Backward Compatibility — Existing Behavior Preserved

**What:** When `settings.model` does NOT start with `claude-`, the system SHALL behave identically to pre-spec behavior. DeepSeek and OpenAI providers are untouched. The `engines.anthropic` field is optional — absence means no Anthropic provider is created (when model doesn't match Claude prefix).

**Why:** Per L1 (layer multi-provider work), each spec must be independently shippable without regressions.

**Acceptance Criteria:**
- [ ] All existing tests pass with zero failures (`npm test`).
- [ ] DeepSeek chat sessions work identically.
- [ ] OpenAI chat sessions work identically (if Spec 40 code is present).
- [ ] `settings.json` without `engines.anthropic` entry works identically.
- [ ] `npm test` returns exit code 0.

---

### FR-013: SessionManager — No Structural Changes for Anthropic

**What:** `SessionManager` SHALL work with `AnthropicProvider` without any code changes beyond what Spec 40 already introduced. The `ILlmProvider` interface already abstracts all provider-specific behavior. `AnthropicProvider.chat()` yields the same `LlmStreamEvent` types, so `SessionManager`'s stream consumption loop is unchanged.

The ONLY change to `session.ts` beyond Spec 40 is the `import` of `AnthropicProvider` if directly referenced (which it should NOT be — the registry handles instantiation).

**Why:** This is the validation of Spec 30's architecture. If `SessionManager` needs changes for Anthropic, the `ILlmProvider` abstraction is insufficient.

**Acceptance Criteria:**
- [ ] `session.ts` has ZERO changes beyond what Spec 40 already made.
- [ ] `SessionManager.createChatCompletionStream()` works with `AnthropicProvider` via the `ILlmProvider` interface.
- [ ] Compaction works with Anthropic models via `getCheapModel()`.
- [ ] Budget tracking works with Anthropic usage data.
- [ ] `npm run typecheck` passes.

---

## Non-Functional Requirements

### NFR-001: One New npm Dependency — `@anthropic-ai/sdk`

**What:** Exactly ONE npm package is added: `@anthropic-ai/sdk`. No other dependencies may be added, removed, or updated.

**Why:** ADR-001 mandates the Anthropic SDK. P6 (Zero New Dependencies Without Justification) is satisfied by ADR-001's explicit justification.

**Acceptance Criteria:**
- [ ] `package.json` changes: only `@anthropic-ai/sdk` added to `dependencies`.
- [ ] `package-lock.json` reflects the new dependency tree.
- [ ] No other packages changed versions.

### NFR-002: Type Safety

**What:** All code must pass TypeScript type checking with zero errors.

**Acceptance Criteria:**
- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npm run lint` passes with zero new warnings.
- [ ] `npm run format:check` passes (no unformatted files).

### NFR-003: Test Coverage

**What:** New code must be covered by tests. Existing tests must not be weakened.

**Acceptance Criteria:**
- [ ] New tests for `AnthropicMessageConverter`: tool pairing, system-to-user conversion, content block generation, thinking block inclusion.
- [ ] New tests for `AnthropicProvider.chat()`: streaming text, reasoning (thinking) delta, tool call start/delta, usage accumulation, abort, missing API key.
- [ ] New tests for `convertToolsToAnthropic()`: empty array, single tool, multiple tools, additionalProperties stripping.
- [ ] New tests for `buildMessages()`: multimodal filtering, interrupted tool backfill.
- [ ] New tests for `createLlmProvider()` routing with `claude-` prefix models.
- [ ] New tests for `AnthropicProvider.getCheapModel()`.
- [ ] New tests for `createAnthropicClient()`: engine key resolution, default base URL, missing key → null.
- [ ] Existing test count preserved; no more than 5 existing tests modified (register mocks for new interface members only).
- [ ] All tests for `AnthropicProvider` MUST use mock stream events — no real API calls.

### NFR-004: Message Converter Performance

**What:** `AnthropicMessageConverter.buildMessages()` must handle sessions with 500+ messages efficiently (under 10ms amortized per call). The implementation SHALL avoid O(n^2) patterns, using maps for tool pairing same as `OpenAIMessageConverter`.

**Acceptance Criteria:**
- [ ] `buildMessages` uses `pairToolMessages` with Map-based O(n) pairing (same algorithm as OpenAIMessageConverter).
- [ ] No nested loops scanning all messages per tool call.

---

## Constraints

1. **C1:** `SessionMessage` type MUST NOT change — canonical format per ADR-004.
2. **C2:** `ToolDefinition` type MUST NOT change — used by all providers.
3. **C3:** `ModelUsage` type MUST NOT change — Anthropic usage is normalized to this shape.
4. **C4:** `ILlmProvider` interface MUST NOT change — already has `getCheapModel` from Spec 40.
5. **C5:** `OpenAIMessageConverter` MUST NOT be modified — Anthropic uses its own converter.
6. **C6:** The `openai` npm package stays at current version.
7. **C7:** The `@anthropic-ai/sdk` package version must be `^0.60.0` or latest stable at time of implementation.
8. **C8:** Node.js version requirement stays at `>=24`.
9. **C9:** Bundle target stays at `--target=node24`.
10. **C10:** `session.ts` MUST NOT be modified beyond what Spec 40 already changed — Anthropic must work through the interface.

---

## Edge Cases & Error States

| # | Scenario | Expected Behavior |
|---|---|---|
| EC1 | User sets model to `claude-sonnet-4-5` but has no Anthropic API key | `createLlmProvider()` creates `AnthropicProvider`, `createAnthropicClient("anthropic")` returns `client: null`, provider throws `Error("Anthropic API key not configured")`. |
| EC2 | Anthropic API is overloaded (HTTP 529) | `withRetry()` must retry on 529 status. Anthropic's overloaded_error maps to HTTP 529 — add `529` to `RETRYABLE_STATUS_CODES` in `api-retry.ts`. |
| EC3 | Anthropic stream contains a `ping` event | Ignored silently — ping events have no semantic meaning and are just keepalives. |
| EC4 | Anthropic stream contains an unknown event type | Ignored silently — per Anthropic docs: "your code should handle unknown event types gracefully." |
| EC5 | User sends an image with a multimodal Claude model | `AnthropicMessageConverter` includes `{ type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }` blocks in the content array. |
| EC6 | User sends an image with a non-multimodal Claude model | Image is filtered out (though all Claude 3+ models support images, the check is still performed). |
| EC7 | Compaction with Claude model | `provider.getCheapModel("claude-sonnet-4-5")` returns `"claude-haiku-4-5"`. Compaction proceeds with Haiku. |
| EC8 | Streaming connection drops mid-response | Anthropic SDK handles SSE disconnection, throws error. `withRetry()` retries if transient. SessionManager catches and displays error. |
| EC9 | Anthropic returns `refusal` content block | The SDK may surface refusals as text content with stop_reason "refusal". Treat refusal text same as regular text content (yield as `text_delta`). |
| EC10 | Multiple `content_block_start` for multiple tool calls in parallel | Each `tool_use` block has a unique `id`. The converter tracks the current block index → tool_use_id mapping to correctly associate `input_json_delta` events. |
| EC11 | Claude thinking with `budget_tokens` exhausted before completion | API returns partial thinking content. The signature at content_block_stop is still valid. Echo the partial thinking + signature back as-is. |
| EC12 | Claude model name with unusual casing (`Claude-Sonnet-4-5`) | `supportsModel()` is case-insensitive using `model.toLowerCase().startsWith("claude-")`. |
| EC13 | Both global API_KEY and engine-specific ANTHROPIC_API_KEY are set | Engine-specific key takes priority for Anthropic. Global key used for engines without explicit config. |
| EC14 | `tool_choice` parameter conflict with spec | Not used — the provider passes `tool_choice: { type: "auto" }` by default (SDK default). |

---

## Dependencies

- **Spec 30** (provider-agnostic-llm-layer): Completed (`audited`). This spec adds a third `ILlmProvider` implementation.
- **Spec 40** (openai-provider-adapter): Completed or in-progress on `openai-on-road`. This spec adds a third provider alongside the first two.
  - `engines` field and `EngineEntry` type already exist (Spec 40 FR-001).
  - `ILlmProvider.getCheapModel` already exists (Spec 40 FR-005).
  - `buildThinkingRequestOptions` with `providerName` already exists (Spec 40 FR-004) — Anthropic does NOT use this function.
  - Provider registry routing infrastructure already exists (Spec 40 FR-003).
- **ADR-001** (OpenAI SDK): Anthropic SDK is the ADDITION for the third provider.
- **ADR-002** (Provider Interface Pattern): This spec adds a third implementation, further validating the interface.
- **ADR-004** (SessionMessage Canonical): Preserved — Anthropic uses `AnthropicMessageConverter`.
- **ADR-005** (Flash Compaction): Already generalized by Spec 40's `getCheapModel()`.
- **ADR-006** (Synchronous Keyword Matching): Unchanged.
- **Spec 50 DOES NOT depend on Spec 60** (model selection configuration).

---

## Out of Scope

- Adding Anthropic to the `/model` command (→ Spec 60).
- Prompt caching for Anthropic (→ separate optimization spec).
- Anthropic-specific features: Computer use, web search tool, files API, batch processing.
- Structured outputs with Anthropic.
- Thinking budget configuration per model (hardcoded as 32768).
- Token counting using Anthropic's tokenizer (uses heuristic from session.ts).
- Documentation files.
- Changes to `session.ts` beyond what Spec 40 already introduced.
- Multiple `tool_choice` options beyond `{ type: "auto" }` (SDK default).
- Anthropic prompt caching (cache_control on content blocks).
