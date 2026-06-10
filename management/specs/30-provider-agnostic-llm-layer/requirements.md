# Spec 30: provider-agnostic-llm-layer — Requirements

## Value Delivery

Delivers value block **V12** (Provider-Agnostic LLM Architecture) and refines **V6** (Multi-Model Support) from vision.md.

> **V12:** *"A clean internal boundary between DsCode's orchestration layer and any specific LLM provider SDK. Defined by the `ILlmProvider` interface: single contract `chat(options) → AsyncIterable<LlmStreamEvent>`, canonical message format `SessionMessage`, unified stream events, provider registry, zero new behavior."*

> **V6:** *"Support for multiple LLM providers beyond DeepSeek. Thinking/reasoning mode is provider-aware. Tool calling uses each provider's native format, converted from a canonical internal representation."*

---

## Functional Requirements

### FR-001: Define `ILlmProvider` Interface

**What:** Create a TypeScript interface `ILlmProvider` at `src/common/llm-provider.ts` that defines the contract every LLM provider must implement. The interface SHALL have exactly these methods:

- `readonly providerName: string` — unique name for debugging and logging.
- `supportsModel(model: string): boolean` — returns `true` if this provider can handle the given model name.
- `chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent>` — the core streaming chat method.
- `getTimeoutMs(model: string): number` — returns the recommended API timeout for a model.
- `isMultimodal(model: string): boolean` — returns `true` if the model supports image inputs.

**Why:** ADR-002 requires interface-first design. Every future provider (OpenAI, Anthropic) implements this contract. SessionManager depends only on this interface.

**Acceptance Criteria:**
- [ ] File `src/common/llm-provider.ts` exists.
- [ ] It exports `ILlmProvider` interface with exactly the 5 members listed above.
- [ ] It exports `LlmStreamEvent` discriminated union type with 6 variants: `text_delta`, `reasoning_delta`, `tool_call_start`, `tool_call_delta`, `usage`, `error`.
- [ ] It exports `LlmChatOptions` type with fields: `model`, `messages` (SessionMessage[]), `tools?`, `temperature?`, `maxTokens?`, `signal?`, `providerOptions?`.
- [ ] All types pass `tsc --noEmit` with zero errors.

---

### FR-002: Define `LlmStreamEvent` Unified Event Types

**What:** Define a discriminated union `LlmStreamEvent` with exactly these variants:

```typescript
type LlmStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; arguments: string }
  | { type: "usage"; usage: ModelUsage }
  | { type: "error"; error: unknown };
```

**Why:** The stream from every provider MUST emit the same event types so SessionManager can consume them without provider-specific parsing logic.

**Acceptance Criteria:**
- [ ] All 6 variants are defined exactly as above in `src/common/llm-provider.ts`.
- [ ] `tool_call_delta` provides incremental arguments (JSON string fragment), not the complete arguments.
- [ ] `usage` carries the full `ModelUsage` object (already imported from session.ts).
- [ ] `error` is emitted when an error occurs during streaming (non-fatal, does not replace `throw`).

---

### FR-003: Define `LlmChatOptions` Input Type

**What:** Define the input options type for `ILlmProvider.chat()`:

```typescript
type LlmChatOptions = {
  model: string;
  messages: SessionMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  providerOptions?: Record<string, unknown>;
};
```

**Why:** This is the single input shape SessionManager passes to `provider.chat()`. It carries only canonical types — no OpenAI or Anthropic types leak in.

**Acceptance Criteria:**
- [ ] `messages` is `SessionMessage[]` (not `ChatCompletionMessageParam[]`).
- [ ] `tools` is `ToolDefinition[]` (the same type already exported from `prompt.ts`).
- [ ] `providerOptions` is an opaque bag — providers interpret it internally.
- [ ] `signal` is an `AbortSignal` for user-initiated cancellation (Esc key, session switch).

---

### FR-004: Create `DeepSeekProvider` Class

**What:** Create class `DeepSeekProvider` implementing `ILlmProvider` at `src/providers/deepseek-provider.ts`. This is a **mechanical extraction** — it moves existing logic from `session.ts`, `openai-client.ts`, `openai-message-converter.ts`, and `openai-thinking.ts` behind the interface.

**Internal behavior:**
- `supportsModel()` returns `true` for model names starting with `"deepseek-"` (case-insensitive).
- `getTimeoutMs()` returns 300_000 (5 min) for pro models, 180_000 (3 min) for flash models, 180_000 (default).
- `isMultimodal()` returns `true` for models NOT in the `NON_MULTIMODAL_DEEPSEEK_MODELS` set. Currently all DeepSeek V4 models (pro, flash) are non-multimodal, so this returns `false`.
- `chat()` MUST:
  1. Accept `LlmChatOptions`.
  2. Internally call `createOpenAIClient()` (existing function, imported from `openai-client.ts`).
  3. Resolve `thinkingEnabled` and `reasoningEffort` from `options.providerOptions` (cast to `{ thinkingEnabled?: boolean; reasoningEffort?: "high" | "max" }`).
  4. Convert `options.messages` (SessionMessage[]) to OpenAI format using `OpenAIMessageConverter.buildMessages(options.messages, thinkingEnabled ?? false, options.model)`.
  5. Build thinking request options using `buildThinkingRequestOptions(thinkingEnabled ?? false, baseURL, reasoningEffort)`.
  6. Build the stream request body with EXACTLY these fields AND these conditionals:
     - `model: options.model`
     - `messages: openaiMessages`
     - `tools: options.tools ?? []`
     - `temperature`: ONLY included when `options.temperature !== undefined && !thinkingEnabled` (mirrors existing SessionManager behavior — temperature is not sent when thinking is enabled).
     - `max_tokens`: ONLY included when `(options.maxTokens ?? 0) > 0`.
     - `stream: true`
     - `stream_options: { include_usage: true }`
     - Spread `...thinkingOptions` (adds `thinking` and optionally `extra_body`).
     - Do NOT include `user_id` (the existing `user_id: sessionId` field from the old code is intentionally dropped — the provider does not have access to sessionId).
  7. Call `client.chat.completions.create(streamRequest, { signal: composedSignal })` where `composedSignal` is the user's abort signal combined with a timeout signal from `getTimeoutMs()`.
  8. Iterate stream chunks and yield `LlmStreamEvent` objects.

**Why:** This is the core of spec 30. Existing code is moved, not rewritten. The behavior of the system after this change MUST be identical to before — only the internal wiring changes.

**Acceptance Criteria:**
- [ ] File `src/providers/deepseek-provider.ts` exists.
- [ ] `DeepSeekProvider` class implements `ILlmProvider` (TypeScript verifies this).
- [ ] `chat()` yields `LlmStreamEvent` objects in the correct order: `text_delta` events as text arrives, `reasoning_delta` for reasoning content, `tool_call_start`/`tool_call_delta` for tool calls, `usage` for usage info chunk, `error` for stream errors.
- [ ] `tool_call_start` is emitted once per tool call (when `id` and `name` first appear).
- [ ] `tool_call_delta` is emitted for each incremental `arguments` chunk (delta.arguments string).
- [ ] `usage` is emitted when a chunk with `usage` field arrives (typically the last chunk).
- [ ] The method respects `options.signal` — aborts the API call when signalled.
- [ ] The method applies a timeout using `getTimeoutMs(options.model)`.

---

### FR-005: Create Provider Factory Function

**What:** Create a factory function `createLlmProvider()` at `src/common/llm-provider-registry.ts` that:

1. Calls `resolveCurrentSettings(projectRoot)` to get API key, base URL, and model.
2. If `apiKey` is missing, returns `{ provider: null, createOpenAIClient: (existing function) }`.
3. Otherwise, instantiates `DeepSeekProvider` and returns `{ provider, createOpenAIClient }`.
4. The `createOpenAIClient` return value is the EXISTING function (unchanged) — kept for tool executor backward compatibility.

**Why:** Centralizes provider creation. In future specs (40, 50), this function will check model name and instantiate OpenAIProvider or AnthropicProvider.

**Acceptance Criteria:**
- [ ] File `src/common/llm-provider-registry.ts` exists.
- [ ] Exports `createLlmProvider(projectRoot: string): { provider: ILlmProvider | null; createOpenAIClient: (existing return type) }`.
- [ ] When `settings.apiKey` is missing, `provider` is `null` but `createOpenAIClient` is still returned (for consistency with existing null-check pattern).
- [ ] When `settings.apiKey` exists, `provider` is a `DeepSeekProvider` instance.

---

### FR-006: Update `SessionManager` to Use `ILlmProvider`

**What:** Modify `SessionManager` so that its main conversation loop (`activateSession`) and compaction method (`compactSession`) use `ILlmProvider.chat()` instead of the current `createChatCompletionStream()` + raw OpenAI client.

**Changes to `SessionManager`:**
1. Constructor accepts `createLlmProvider` (factory) in addition to `createOpenAIClient`.
2. `createChatCompletionStream()` method is **removed** — its logic is split between `DeepSeekProvider.chat()` (stream parsing) and the new inline loop in `activateSession` (aggregation + logging).
3. `activateSession` loop:
   - Calls `createLlmProvider()` to get `{ provider }`.
   - If `provider` is null, handles as today (returns early, no API key).
   - Calls `provider.chat(options)` to get an async iterable.
   - Iterates the stream, aggregating: `text`, `reasoning`, `tool_calls`, `usage`.
   - Emits stream progress events (`emitLlmStreamProgress`) during iteration.
   - Logs debug info and API errors (existing logging calls preserved).
   - After iteration, builds the final message from aggregated data (identical to current behavior).
4. `compactSession()`:
   - Uses `provider.chat()` with a minimal SessionMessage for the compaction prompt.
   - Aggregates the response, parses the summary JSON (existing logic preserved).
5. `messageConverter` instance stays (used for `findToolFunction()`, `getTrailingPendingToolCallMessage()`, `buildInterruptedToolResult()`).
6. `buildThinkingRequestOptions()` import is REMOVED (no longer called from SessionManager).
7. `ChatCompletionMessageParam` import is REMOVED (no longer needed).

**Why:** This is the payoff of the interface — SessionManager no longer knows about OpenAI SDK types or API shapes. It only knows about `ILlmProvider` and `LlmStreamEvent`.

**Acceptance Criteria:**
- [ ] `session.ts` no longer imports `ChatCompletionMessageParam` from `openai`.
- [ ] `session.ts` no longer imports `buildThinkingRequestOptions`.
- [ ] `createChatCompletionStream()` method no longer exists as a private method.
- [ ] The stream parsing logic (`delta.content`, `delta.reasoning_content`, `delta.tool_calls`, `delta.refusal`) in the old `createChatCompletionStream` is REMOVED from `session.ts`.
- [ ] `activateSession` loop iterates `LlmStreamEvent` instead of raw OpenAI chunks.
- [ ] `compactSession` uses `provider.chat()` instead of `createChatCompletionStream()`.
- [ ] Debug logging (`logChatCompletionDebug`) and API error logging (`logApiError`) are preserved — same calls, same data.
- [ ] Stream progress (`emitLlmStreamProgress`) is preserved — same events, same format.
- [ ] The final message built after stream consumption has the same shape as before: `{ content, tool_calls, reasoning_content? }`.
- [ ] The `refusal` field from the old `createChatCompletionStream` is intentionally NOT set in the new message. Refusal text is emitted by the provider as `text_delta` and merged into `content`. This is a deliberate simplification — `refusal` (content moderation rejection) is extremely rare and the text is more useful as visible content than hidden metadata. The old code's separate `refusal` tracking is removed.

---

### FR-007: Remove Model-Specific Logic from `api-timeout.ts`

**What:** Replace hardcoded model name checks in `resolveApiTimeoutMs()` with a generic fallback:

```typescript
export function resolveApiTimeoutMs(model?: string): number {
  const raw = process.env.DEEPCODE_API_TIMEOUT_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= MIN_API_TIMEOUT_MS) {
      return Math.round(parsed);
    }
  }
  return DEFAULT_API_TIMEOUT_MS;
}
```

The model-specific logic (`deepseek-v4-pro` → 300_000, `deepseek-v4-flash` → 180_000) MOVES to `DeepSeekProvider.getTimeoutMs()`.

**Why:** Model-specific knowledge belongs in the provider, not in a shared utility.

**Acceptance Criteria:**
- [ ] `resolveApiTimeoutMs()` no longer checks `model === "deepseek-v4-pro"` or `model === "deepseek-v4-flash"`.
- [ ] The function still respects the `DEEPCODE_API_TIMEOUT_MS` env var.
- [ ] `DeepSeekProvider.getTimeoutMs()` returns the same values the old code returned: 300_000 for pro, 180_000 for flash, 180_000 default.
- [ ] All existing callers of `resolveApiTimeoutMs()` still work — if any remain, they get the default timeout.

---

### FR-008: Clean Up `model-capabilities.ts`

**What:** Remove `DEEPSEEK_V4_MODELS` export from `model-capabilities.ts`. Keep the set as a private constant if `DeepSeekProvider` needs it, or move it into `DeepSeekProvider`.

**Keep unchanged:**
- `NON_MULTIMODAL_MODELS` (used by `isMultimodalModel()` which is used by `OpenAIMessageConverter`).
- `ModelPricing` type.
- `DEFAULT_MODEL_PRICING` record.
- `computeUsageCost()`, `computeSessionCost()`, `formatTokenCount()`, `formatCost()`.
- `defaultsToThinkingMode()`.
- `isMultimodalModel()`.

**Why:** `DEEPSEEK_V4_MODELS` was kept "as documentation" per AD-HOC-003 from spec 10. Now that we have a proper provider, the model registry belongs inside the provider.

**Acceptance Criteria:**
- [ ] `DEEPSEEK_V4_MODELS` is no longer exported from `model-capabilities.ts`.
- [ ] `DeepSeekProvider.supportsModel()` uses its own model list (or prefix matching).
- [ ] No other file imports `DEEPSEEK_V4_MODELS` from `model-capabilities.ts`.
- [ ] `npm run typecheck` passes.

---

### FR-009: Backward Compatibility — `ToolExecutor` and `CreateOpenAIClient`

**What:** The `CreateOpenAIClient` type in `tools/executor.ts` SHALL remain unchanged. The tool executor SHALL continue to receive the same `createOpenAIClient` function as before. The factory function `createLlmProvider()` SHALL return both the new `provider` (ILlmProvider) and the old `createOpenAIClient` function.

**Why:** Tool handlers (especially WebSearch) call `client.chat.completions.create()` directly with raw parameters. Abstracting this is out of scope for spec 30 — it belongs in spec 40/60. Spec 30 is a mechanical extraction, not a tool refactor.

**Acceptance Criteria:**
- [ ] `CreateOpenAIClient` type in `tools/executor.ts` has zero changes.
- [ ] `WebSearchHandler` and any other tool that uses `createOpenAIClient` continues to work unchanged.
- [ ] `SessionManager` constructor still accepts `createOpenAIClient` and passes it to `ToolExecutor`.
- [ ] The new `createLlmProvider` option in SessionManager constructor is separate from `createOpenAIClient` — both are accepted.

---

## Non-Functional Requirements

### NFR-001: Behavior Preservation

**What:** The system's user-visible behavior MUST be identical before and after this spec. This is a mechanical refactoring — zero functional changes.

**Acceptance Criteria:**
- [ ] All 555 existing tests pass with zero failures (`npm test`).
- [ ] No test assertions are modified except mocks that reference `createOpenAIClient` internals (which must be updated to mock `ILlmProvider` instead).
- [ ] No behavior change in: streaming speed, tool call handling, error messages, budget tracking, session persistence, compaction.

### NFR-002: Type Safety

**What:** All code must pass TypeScript type checking with zero errors.

**Acceptance Criteria:**
- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npm run lint` passes with zero new warnings.
- [ ] `npm run format:check` passes (no unformatted files).

### NFR-003: No New Dependencies

**What:** No npm packages may be added, removed, or updated. This spec moves existing code, it does not add new capabilities.

**Acceptance Criteria:**
- [ ] `package.json` has zero changes.
- [ ] `package-lock.json` has zero changes.
- [ ] `node_modules/` is unchanged.

### NFR-004: File Count Minimization

**What:** Create the minimum number of new files. Extract, don't duplicate.

**Acceptance Criteria:**
- [ ] At most 3 new files created: `llm-provider.ts`, `llm-provider-registry.ts`, `deepseek-provider.ts`.
- [ ] `openai-client.ts` is NOT renamed or moved — kept as-is for backward compatibility.
- [ ] `openai-message-converter.ts` is NOT renamed or moved.
- [ ] `openai-thinking.ts` is NOT renamed or moved.

---

## Constraints

1. **C1:** `SessionMessage` type must not change — it is the canonical format per ADR-004.
2. **C2:** `ToolDefinition` type must not change — it is used by `prompt.ts` and tool handlers.
3. **C3:** `ModelUsage` type must not change — it is used by `budget-tracker.ts`.
4. **C4:** The `openai` npm package stays as a dependency — DeepSeekProvider uses it internally.
5. **C5:** The existing module-level cache in `openai-client.ts` (cachedOpenAI) must continue to work — DeepSeekProvider reuses the cached client.
6. **C6:** Node.js version requirement stays at `>=24` per `package.json`.
7. **C7:** Bundle target stays at `--target=node24`.

---

## Edge Cases & Error States

| # | Scenario | Expected Behavior |
|---|---|---|
| EC1 | `apiKey` is empty/missing in settings | `createLlmProvider()` returns `{ provider: null, createOpenAIClient }`. SessionManager handles null provider same as null client today (returns early). |
| EC2 | API returns non-streaming response | Provider's `chat()` should still yield events from the single response. If response is not iterable, yield a single `text_delta` and `usage` event. |
| EC3 | Stream chunk has no `choices` array | Skip the chunk, continue to next. Do not crash. |
| EC4 | Stream chunk has `choices` but no `delta` | Skip the choice, continue to next. Do not crash. |
| EC5 | Tool call arrives across multiple chunks (incremental) | First chunk with `id` emits `tool_call_start`. Subsequent chunks with `arguments` emit `tool_call_delta`. No `tool_call_end` event (aggregation happens in SessionManager from accumulated data). |
| EC6 | Tool call `index` is not a number | Treat as if index is `toolCallsByIndex.size` (current behavior). |
| EC7 | `usage` field arrives in a middle chunk (not final) | Yield `usage` event. SessionManager may receive multiple usage events; last one wins. |
| EC8 | User aborts mid-stream (Esc key) | The `AbortSignal` passed via `options.signal` is triggered. Provider's API call throws `AbortError`. SessionManager catches and handles as today. |
| EC9 | API timeout (no response from server) | Timeout signal fires, API call aborts. Provider throws `TimeoutError`. SessionManager catches and handles as today. |
| EC10 | `reasoning_content` is `undefined` (not present in delta) | Provider does NOT yield a `reasoning_delta` event. |
| EC11 | `refusal` field is present in delta | Provider yields a `text_delta` event with the refusal text (treating refusal as non-thinking text). |
| EC12 | Compaction uses a model not supported by current provider | SessionManager resolves a compaction model. If the provider's `supportsModel()` returns false, SessionManager falls back to `options.model`. |
| EC13 | `getTimeoutMs()` called with unknown model | Return `DEFAULT_API_TIMEOUT_MS` (180_000). |

---

## Dependencies

- **Spec 10** (more-effectiveness-and-economy): Completed. This spec builds on the existing `SessionManager`, `OpenAIMessageConverter`, and `openai-client.ts` that spec 10 modified.
- **Spec 20** (tui-scalability): Completed. No dependency — UI layer is unaffected.
- **ADR-002** (Provider Interface Pattern): This spec implements the interface pattern.
- **ADR-004** (SessionMessage as Canonical Format): This spec preserves SessionMessage as the canonical format.

---

## Out of Scope

- ❌ Adding OpenAI provider (→ Spec 40).
- ❌ Adding Anthropic provider (→ Spec 50).
- ❌ Model selection UI or `/model` command changes (→ Spec 60).
- ❌ Refactoring tool handlers to use `ILlmProvider` instead of raw OpenAI client.
- ❌ Abstracting `ToolExecutor` from the OpenAI SDK.
- ❌ Changing `SessionMessage` type or fields.
- ❌ Adding or removing npm dependencies.
- ❌ Changing the settings schema.
- ❌ User-facing configuration for providers.
- ❌ Automatic provider detection from model name (always returns DeepSeekProvider for now).
- ❌ Any performance optimization beyond preserving current behavior.
- ❌ Documentation changes.
