# Spec 40: openai-provider-adapter — Design

## Design Approach

This spec follows **add-don't-rewrite**: the `OpenAIProvider` is a new class structurally mirrored from `DeepSeekProvider`. The existing provider, settings, and registry code is modified minimally — new branches, not rewrites. The `DeepSeekProvider` code is the template; `OpenAIProvider` is a sibling, not a replacement.

**Principles applied:**
- **P1 (Interface-First):** `OpenAIProvider` implements `ILlmProvider`. SessionManager never imports it directly.
- **P2 (Canonical Types):** Both providers use the same `SessionMessage` → `ChatCompletionMessageParam` conversion.
- **P3 (Streaming-First):** Same `AsyncIterable<LlmStreamEvent>` pattern as DeepSeek.
- **P4 (Surgical Changes):** Only files that must change are changed. Adjacent code is untouched.
- **P5 (Test Integrity):** All existing tests pass. New tests for new behavior only.
- **P6 (Zero New Dependencies):** No npm packages added.
- **P7 (Provider-Agnostic Configuration):** `engines` field in settings namespaces per-provider credentials.

---

## Architecture Decisions

### AD-SPEC40-001: OpenAIProvider is a structural mirror of DeepSeekProvider, not a shared base class (yet)

**Decision:** `OpenAIProvider.chat()` duplicates `DeepSeekProvider.chat()` structurally. The two files are ~80% identical (streaming loop, tool call tracking, retry, non-streaming fallback, error handling). A shared base class would reduce ~120 lines of duplicated code.

**Rationale for deferring extraction:** With only 2 providers, the duplication is manageable. If Spec 50 (Anthropic) requires significant streaming loop changes, the base class abstraction would need revision. Extract only when 3 providers exist (Spec 50) and the shared pattern is stable.

**Consequence:** Bugfixes to the streaming loop must be applied to both files. A comment at the top of each file cross-references the other.

### AD-SPEC40-002: `buildThinkingRequestOptions` gets a `providerName` parameter, does not split into two functions

**Decision:** Extend the existing function with an optional `providerName` parameter rather than creating `buildOpenAIThinkingOptions` and `buildDeepSeekThinkingOptions`.

**Rationale:** The function is 26 lines. Splitting would create 2 functions of ~15 lines each, plus a dispatch function. The single function with a switch is simpler and keeps the thinking logic co-located. If providers diverge further in Spec 50, split then.

**Consequence:** All existing callers work unchanged (optional parameter defaults to `"deepseek"`).

### AD-SPEC40-003: `getCheapModel` is optional on `ILlmProvider`

**Decision:** `getCheapModel?()` is optional, not required. Providers that don't have a cheaper model simply don't implement it. `SessionManager` defaults to the main model when `getCheapModel` is undefined or returns `null`.

**Rationale:** Making it required would force every future provider to implement a method that may always return `null`. Optional with a fallback is cleaner and matches TypeScript idioms.

**Consequence:** `SessionManager.compactSession()` uses `provider.getCheapModel?.(model) ?? model`.

### AD-SPEC40-004: `engines` config uses flat env vars, not nested JSON in env

**Decision:** Engine-specific environment variables use the pattern `DEEPCODE_ENGINE_<NAME>_<KEY>` (e.g., `DEEPCODE_ENGINE_OPENAI_API_KEY`). This is readable in `.env` files and shell exports, unlike nested JSON which would require quoting and escaping.

**Rationale:** Environment variables are flat key-value pairs. Nested config belongs in `settings.json`. System env vars are always flat.

**Consequence:** `collectDeepcodeEnv()` parses `DEEPCODE_ENGINE_*` env vars into an `engines` record during settings resolution.

---

## Component / Module Breakdown

### Component 1: `EngineEntry` Type and Settings Schema Updates

**File:** `src/common/settings-schema.ts` (MODIFY)

**Purpose:** Add `engines` field to the Zod schema and export the `EngineEntry` type.

**Changes:**

```typescript
// NEW: export type
export type EngineEntry = {
  apiKey?: string;
  baseURL?: string;
};

// In the Zod schema object, ADD:
engines: z.record(z.string(), z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
})).optional(),
```

**Dependencies:** None (settings-schema.ts has no internal dependencies).

---

### Component 2: `DeepcodingSettings` and `ResolvedDeepcodingSettings` Updates

**File:** `src/settings.ts` (MODIFY)

**Purpose:** Add `engines` field to both settings types and to resolution logic.

**Changes to types:**

```typescript
// In DeepcodingSettings type, ADD (after `mcpServers`):
engines?: Record<string, EngineEntry>;

// In ResolvedDeepcodingSettings type, ADD (after `mcpServers`):
engines: Record<string, EngineEntry>;
```

Export `EngineEntry` from settings-schema.ts via settings.ts re-export or import directly.

**Changes to `resolveSettingsSources()`:**

Add engine env var parsing in `collectDeepcodeEnv()` or a new helper:

```typescript
function collectEngineEnv(processEnv: SettingsProcessEnv): Record<string, { apiKey?: string; baseURL?: string }> {
  const engines: Record<string, { apiKey?: string; baseURL?: string }> = {};
  const prefix = "DEEPCODE_ENGINE_";
  const apiKeySuffix = "_API_KEY";
  const baseUrlSuffix = "_BASE_URL";
  for (const [key, value] of Object.entries(processEnv)) {
    if (!key.startsWith(prefix) || typeof value !== "string" || !value) continue;
    const rest = key.slice(prefix.length);
    // Match known field suffixes (they may contain underscores, e.g. API_KEY, BASE_URL)
    if (rest.endsWith(apiKeySuffix)) {
      const engineName = rest.slice(0, rest.length - apiKeySuffix.length).toLowerCase();
      if (!engineName) continue;
      engines[engineName] ??= {};
      engines[engineName].apiKey = value;
    } else if (rest.endsWith(baseUrlSuffix)) {
      const engineName = rest.slice(0, rest.length - baseUrlSuffix.length).toLowerCase();
      if (!engineName) continue;
      engines[engineName] ??= {};
      engines[engineName].baseURL = value;
    }
  }
  return engines;
}
```

In `resolveSettingsSources()`, resolve `engines`:

```typescript
const engines = {
  ...(userSettings?.engines ?? {}),
  ...(projectSettings?.engines ?? {}),
  ...collectEngineEnv(processEnv),
};
```

Add `engines` to the return object.

**Changes to `DEFAULT_SETTINGS`:**

```typescript
engines: {},
```

**Import added:**
```typescript
import type { EngineEntry } from "./common/settings-schema";
```

**Dependencies:** `settings-schema.ts` (Component 1).

---

### Component 3: `createOpenAIClient` Engine-Awareness

**File:** `src/common/openai-client.ts` (MODIFY)

**Purpose:** Accept optional `engineName` parameter. When provided, read `apiKey` and `baseURL` from the named engine config, falling back to top-level settings.

**Changes:**

```typescript
// Modified function signature:
export function createOpenAIClient(
  projectRoot: string = process.cwd(),
  engineName?: string,
): { /* same return type */ } {
  const settings = resolveCurrentSettings(projectRoot);

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

  if (!apiKey) {
    return { client: null, model: settings.model, baseURL, /* ... */ };
  }

  // Cache key includes apiKey + baseURL so different engines get different cached clients
  const cacheKey = `${apiKey}::${baseURL}`;
  // ... rest unchanged ...
}
```

**Cache invalidation:** The existing `cachedOpenAI` and `cachedOpenAIKey` module-level cache uses `apiKey::baseURL` as key. Since different engines have different keys, this naturally creates separate clients. No cache changes needed.

**Return type unchanged** — always returns `{ client, model, baseURL, temperature, thinkingEnabled, reasoningEffort, debugLogEnabled, telemetryEnabled, maxTokens, notify, env }`. The `model` field always reflects the resolved `settings.model` (global), not an engine-specific model. This is correct — the provider uses `options.model` from `LlmChatOptions`, not from `createOpenAIClient()`.

**Dependencies:** `settings.ts` (Component 2).

---

### Component 4: Provider-Aware `buildThinkingRequestOptions`

**File:** `src/common/openai-thinking.ts` (MODIFY)

**Purpose:** Accept optional `providerName` parameter and return provider-appropriate thinking options.

**Changes:**

```typescript
export function buildThinkingRequestOptions(
  thinkingEnabled: boolean,
  _baseURL?: string,
  reasoningEffort: ReasoningEffort = "high",  // NOTE: default changes from "max" to "high" (spec 10 optimize-deepseek-v4 task 4)
  providerName?: string,
): ThinkingRequestOptions | Record<string, unknown> {
  // Return type widens to allow OpenAI's flat format

  if (providerName === "openai") {
    // OpenAI format: reasoning_effort as top-level parameter
    if (thinkingEnabled) {
      return { reasoning_effort: reasoningEffort };
    }
    return {};
  }

  // DeepSeek format (default, backward compatible)
  const thinking: ThinkingConfig = { type: thinkingEnabled ? "enabled" : "disabled" };
  return {
    thinking,
    ...(thinkingEnabled ? { extra_body: { reasoning_effort: reasoningEffort } } : {}),
  };
}
```

**Return type change:** The return type widens from `ThinkingRequestOptions` to `ThinkingRequestOptions | Record<string, unknown>`. This is because OpenAI format is `{ reasoning_effort: string }` which doesn't match the existing `ThinkingRequestOptions` type. Both providers spread the result into `streamRequest`, which is `Record<string, unknown>`, so the widening is type-safe.

**Default `reasoningEffort`:** Per optimize-deepseek-v4 spec, the default is already `"high"` (line 17 of openai-thinking.ts currently has `= "max"` but optimize-deepseek-v4 task 4 changes it to `= "high"`). This spec uses whichever default is current.

**Dependencies:** `settings.ts` (imports `ReasoningEffort` type).

---

### Component 5: `OpenAIProvider` Class

**File:** `src/providers/openai-provider.ts` (NEW)

**Purpose:** Implement `ILlmProvider` for OpenAI models.

**Full implementation:**

```typescript
import { OpenAIMessageConverter, type OpenAIMessageConverterOptions } from "../common/openai-message-converter";
import { buildThinkingRequestOptions } from "../common/openai-thinking";
import { DEFAULT_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
import type { ModelUsage } from "../session";
import type { CreateOpenAIClient } from "../tools/executor";
import { withRetry } from "../common/api-retry";

const OPENAI_MODEL_PREFIXES = ["gpt-", "o1", "o3", "o4", "openai-"] as const;
const OPENAI_NON_MULTIMODAL_MODELS = new Set(["o1-mini", "o3-mini"]);
const OPENAI_REASONING_MODELS_PATTERN = /^(o[134]|gpt-5\.[0-9]+)$/;  // base reasoning models (excludes -mini variants)

export class OpenAIProvider implements ILlmProvider {
  readonly providerName = "openai";
  private readonly messageConverter: OpenAIMessageConverter;

  constructor(
    private readonly createOpenAIClient: CreateOpenAIClient,
    converterOptions: OpenAIMessageConverterOptions = {},
  ) {
    this.messageConverter = new OpenAIMessageConverter(converterOptions);
  }

  supportsModel(model: string): boolean {
    const lower = model.toLowerCase();
    return OPENAI_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
  }

  getTimeoutMs(model: string): number {
    // Reasoning models get longer timeout (5 min vs 3 min)
    if (OPENAI_REASONING_MODELS_PATTERN.test(model)) {
      return PRO_API_TIMEOUT_MS;  // 300_000
    }
    return DEFAULT_API_TIMEOUT_MS;  // 180_000
  }

  isMultimodal(model: string): boolean {
    return !OPENAI_NON_MULTIMODAL_MODELS.has(model.trim());
  }

  getCheapModel(model: string): string | null {
    // GPT-5.4 → gpt-5.4-mini
    if (model === "gpt-5.4") return "gpt-5.4-mini";
    // gpt-5.4-mini → null (already cheap)
    if (model === "gpt-5.4-mini") return null;
    // o-series → o-series-mini
    if (model === "o4") return "o4-mini";
    if (model === "o3") return "o3-mini";
    // o1, o1-mini, o3-mini, o4-mini → null (already cheap or no cheaper variant)
    if (model === "o1" || model === "o1-mini" || model === "o3-mini" || model === "o4-mini") return null;
    // Heuristic: already a mini/cheap variant
    if (model.endsWith("-mini")) return null;
    // Fallback: unknown model, no cheap variant
    return null;
  }

  async *chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent> {
    // NOTE: This method is structurally mirrored from DeepSeekProvider.chat().
    // Bugfixes applied to one MUST be applied to the other.
    // See: src/providers/deepseek-provider.ts

    const { client, baseURL } = this.createOpenAIClient();

    if (!client) {
      throw new Error("OpenAI API key not configured");
    }

    const providerOpts = options.providerOptions as
      | { thinkingEnabled?: boolean; reasoningEffort?: "high" | "max" }
      | undefined;
    const thinkingEnabled = providerOpts?.thinkingEnabled ?? false;
    const reasoningEffort = providerOpts?.reasoningEffort;

    const openaiMessages = this.messageConverter.buildMessages(
      options.messages,
      thinkingEnabled,
      options.model,
    );

    const thinkingOptions = buildThinkingRequestOptions(
      thinkingEnabled,
      baseURL,
      reasoningEffort,
      "openai",  // ← KEY DIFFERENCE from DeepSeekProvider
    );

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

    // Retry transient failures with exponential backoff.
    // Timeout signals are recreated per attempt.
    const rawResponse = await withRetry(
      () => {
        const attemptTimeout = AbortSignal.timeout(this.getTimeoutMs(options.model));
        const attemptSignal = options.signal
          ? AbortSignal.any([options.signal, attemptTimeout])
          : attemptTimeout;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return client.chat.completions.create(streamRequest as any, {
          signal: attemptSignal,
        });
      },
      { userSignal: options.signal },
    );

    // Handle non-streaming responses (tests, older API versions)
    const response = rawResponse as unknown as Record<string, unknown>;
    if (
      !rawResponse ||
      typeof (rawResponse as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== "function"
    ) {
      if (response.usage != null) {
        yield { type: "usage", usage: response.usage as ModelUsage };
      }
      const choices = Array.isArray(response.choices) ? response.choices : [];
      for (const choice of choices) {
        const record = choice as Record<string, unknown>;
        const message = record.message as Record<string, unknown> | undefined;
        if (!message) continue;

        if (typeof message.content === "string") {
          yield { type: "text_delta", text: message.content };
        }
        if (typeof message.reasoning_content === "string") {
          yield { type: "reasoning_delta", text: message.reasoning_content };
        }
        if (typeof message.refusal === "string") {
          yield { type: "text_delta", text: message.refusal };
        }
        if (Array.isArray(message.tool_calls)) {
          for (const rawToolCall of message.tool_calls) {
            const tc = rawToolCall as Record<string, unknown>;
            const tcFn = tc.function as Record<string, unknown> | undefined;
            const toolId = typeof tc.id === "string" ? tc.id : "";
            yield {
              type: "tool_call_start",
              id: toolId,
              name: typeof tcFn?.name === "string" ? (tcFn.name as string) : "",
            };
            if (typeof tcFn?.arguments === "string") {
              yield { type: "tool_call_delta", id: toolId, arguments: tcFn.arguments as string };
            } else if (tcFn?.arguments !== null && typeof tcFn?.arguments === "object") {
              yield { type: "tool_call_delta", id: toolId, arguments: JSON.stringify(tcFn.arguments) };
            }
          }
        }
      }
      return;
    }

    const stream = rawResponse as unknown as AsyncIterable<Record<string, unknown>>;

    // OpenAI API only includes `id` on the first chunk of each tool call.
    // Subsequent chunks carry only `index` + `function.arguments` (no `id`).
    const toolIndexToId = new Map<number, string>();

    try {
      for await (const chunk of stream) {
        if (chunk.usage != null) {
          yield { type: "usage", usage: chunk.usage as ModelUsage };
        }

        const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
        for (const choice of choices) {
          const record = choice as Record<string, unknown>;
          const delta = record.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          if (typeof delta.content === "string") {
            yield { type: "text_delta", text: delta.content };
          }

          const reasoning = (delta.reasoning_content ?? delta.reasoning) as unknown;
          if (typeof reasoning === "string") {
            yield { type: "reasoning_delta", text: reasoning };
          }

          if (typeof delta.refusal === "string") {
            yield { type: "text_delta", text: delta.refusal };
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const rawToolCall of delta.tool_calls) {
              const tc = rawToolCall as Record<string, unknown>;
              const tcFn = tc.function as Record<string, unknown> | undefined;

              if (typeof tc.id === "string" && typeof tc.index === "number") {
                toolIndexToId.set(tc.index, tc.id);
              }

              if (typeof tc.id === "string") {
                yield {
                  type: "tool_call_start",
                  id: tc.id,
                  name: typeof tcFn?.name === "string" ? (tcFn.name as string) : "",
                };
              }

              const effectiveId =
                typeof tc.id === "string"
                  ? tc.id
                  : typeof tc.index === "number"
                    ? (toolIndexToId.get(tc.index) ?? "")
                    : "";

              if (typeof tcFn?.arguments === "string") {
                yield { type: "tool_call_delta", id: effectiveId, arguments: tcFn.arguments as string };
              } else if (tcFn?.arguments !== null && typeof tcFn?.arguments === "object") {
                yield { type: "tool_call_delta", id: effectiveId, arguments: JSON.stringify(tcFn.arguments) };
              }
            }
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

**Dependencies:**
- `openai-client.ts` — `createOpenAIClient`, `CreateOpenAIClient` types.
- `openai-message-converter.ts` — `OpenAIMessageConverter` class.
- `openai-thinking.ts` — `buildThinkingRequestOptions` function.
- `api-timeout.ts` — `DEFAULT_API_TIMEOUT_MS`, `PRO_API_TIMEOUT_MS` constants.
- `api-retry.ts` — `withRetry` function.
- `llm-provider.ts` — `ILlmProvider`, `LlmStreamEvent`, `LlmChatOptions` types.
- `session.ts` — `ModelUsage` type.
- `tools/executor.ts` — `CreateOpenAIClient` type.

**Error Handling:**
- Missing API key → throw `Error("OpenAI API key not configured")`.
- Network errors during streaming → caught by `withRetry`, thrown if retries exhausted.
- Stream errors during iteration → yield `{ type: "error" }` then throw.
- Invalid/empty chunks → skip, continue.

---

### Component 6: `ILlmProvider` Interface Addition — `getCheapModel`

**File:** `src/common/llm-provider.ts` (MODIFY)

**Purpose:** Add optional `getCheapModel` method to the interface.

**Changes:**

```typescript
export interface ILlmProvider {
  readonly providerName: string;
  supportsModel(model: string): boolean;
  chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent>;
  getTimeoutMs(model: string): number;
  isMultimodal(model: string): boolean;
  /** Return the cheapest thinking-disabled model for the given model, or null if none. */
  getCheapModel?(model: string): string | null;
}
```

**Dependencies:** None (interface change, implementations updated separately).

---

### Component 7: `getCheapModel` Implementations

**File:** `src/providers/deepseek-provider.ts` (MODIFY)

**Add method:**
```typescript
getCheapModel(model: string): string | null {
  if (model === "deepseek-v4-pro") return "deepseek-v4-flash";
  if (model === "deepseek-v4-flash") return null;
  // Unknown DeepSeek model: try replacing "pro" with "flash" as heuristic
  if (model.includes("pro")) return model.replace("pro", "flash");
  return null;
}
```

**File:** `src/providers/openai-provider.ts` (NEW — `getCheapModel` already included in Component 5)

**Add method:**
```typescript
getCheapModel(model: string): string | null {
  // GPT-5.4 → gpt-5.4-mini
  if (model === "gpt-5.4") return "gpt-5.4-mini";
  // gpt-5.4-mini → null (already cheap)
  if (model === "gpt-5.4-mini") return null;
  // o-series → o-series-mini (if exists)
  if (model === "o4") return "o4-mini";
  if (model === "o3") return "o3-mini";
  // o1, o1-mini, o3-mini → null (already cheap or no cheaper variant)
  if (model === "o1" || model === "o1-mini" || model === "o3-mini" || model === "o4-mini") return null;
  // Heuristic: try appending "-mini" or replacing with known patterns
  if (model.endsWith("-mini")) return null;  // already mini
  // Fallback: unknown model, no cheap variant
  return null;
}
```

---

### Component 8: Provider Registry Routing

**File:** `src/common/llm-provider-registry.ts` (MODIFY)

**Purpose:** Route model names to the correct provider. Create engine-aware `createOpenAIClient` for OpenAI.

**Changes:**

```typescript
import { resolveCurrentSettings } from "../settings";
import { createOpenAIClient } from "./openai-client";
import { DeepSeekProvider } from "../providers/deepseek-provider";
import { OpenAIProvider } from "../providers/openai-provider";
import type { ILlmProvider } from "./llm-provider";
import type { OpenAIMessageConverterOptions } from "./openai-message-converter";
import type { CreateOpenAIClient } from "../tools/executor";

export type CreateLlmProviderReturn = {
  provider: ILlmProvider | null;
  createOpenAIClient: CreateOpenAIClient;
};

const OPENAI_MODEL_PREFIXES = ["gpt-", "o1", "o3", "o4", "openai-"];

function isOpenAIModel(model: string): boolean {
  const lower = model.toLowerCase();
  return OPENAI_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function createLlmProvider(
  projectRoot: string = process.cwd(),
  converterOptions?: OpenAIMessageConverterOptions,
): CreateLlmProviderReturn {
  const settings = resolveCurrentSettings(projectRoot);

  // Determine engine from model prefix
  const engineName = isOpenAIModel(settings.model) ? "openai" : undefined;

  // Create engine-aware client factory
  const createClient: CreateOpenAIClient = () => createOpenAIClient(projectRoot, engineName);

  if (!settings.apiKey) {
    return { provider: null, createOpenAIClient: createClient };
  }

  if (engineName === "openai") {
    // Check if OpenAI API key is available (engine-specific or global fallback)
    const { client } = createClient();
    if (!client) {
      return { provider: null, createOpenAIClient: createClient };
    }
    const provider = new OpenAIProvider(createClient, converterOptions);
    return { provider, createOpenAIClient: createClient };
  }

  // Default: DeepSeek (backward compatible)
  const provider = new DeepSeekProvider(createClient, converterOptions);
  return { provider, createOpenAIClient: createClient };
}
```

**Key design decisions:**
1. Engine name is derived from model prefix, NOT from settings — the model determines the engine.
2. When model matches OpenAI prefixes, `createOpenAIClient` is called with `engineName = "openai"`, which reads `engines.openai.apiKey` (with fallback to global `apiKey`).
3. When model matches DeepSeek (or unknown), `engineName` is `undefined`, which preserves existing behavior.
4. API key null check on `settings.apiKey` guards the global key. For OpenAI, a second null check on the engine-resolved client handles per-engine key absence.

---

### Component 9: `SessionManager` — Compaction Model

**File:** `src/session.ts` (MODIFY)

**Purpose:** Replace hardcoded compaction model resolution with `provider.getCheapModel()`.

**Current code (spec 30, line ~1473 in compactSession):**
```typescript
const resolvedModel = (this.createOpenAIClient()).model;
const compactionModel = resolvedModel.includes("pro")
  ? resolvedModel.replace("pro", "flash")
  : resolvedModel;
```

**New code:**
```typescript
const { provider } = this.createLlmProvider();
const resolvedModel = (this.createOpenAIClient()).model;
const compactionModel = provider?.getCheapModel?.(resolvedModel) ?? resolvedModel;
```

If `provider` is null (no API key), `compactionModel` defaults to `resolvedModel`. If provider has no `getCheapModel` method, same fallback. If `getCheapModel` returns `null`, same fallback.

**Dependencies:** `ILlmProvider` interface (Component 6).

---

### Component 10: `model-capabilities.ts` — Default Pricing

**File:** `src/common/model-capabilities.ts` (MODIFY)

**Purpose:** Add default pricing entries for OpenAI models.

**Changes to `DEFAULT_MODEL_PRICING`:**

```typescript
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  "deepseek-v4-pro":   { inputPrice: 0.435, outputPrice: 0.87, cacheReadPrice: 0.003625 },
  "deepseek-v4-flash": { inputPrice: 0.14,  outputPrice: 0.28, cacheReadPrice: 0.0028 },
  // NEW: OpenAI GPT-5.4 family pricing (USD per 1M tokens)
  "gpt-5.4":       { inputPrice: 1.25, outputPrice: 10.00, cacheReadPrice: 0.625 },
  "gpt-5.4-mini":  { inputPrice: 0.15, outputPrice: 0.60, cacheReadPrice: 0.075 },
};
```

**Note:** Prices are placeholders and MUST be verified against the official OpenAI pricing page during implementation. The spec declares the requirement — the implementer validates actual prices.

---

## Data Flow

### Main Conversation Turn (OpenAI)

```
User sends message with model: "gpt-5.4"
  →
SessionManager.activateSession()
  →
createLlmProvider(projectRoot, converterOptions)
  → settings.model = "gpt-5.4"
  → isOpenAIModel("gpt-5.4") → true
  → engineName = "openai"
  → createClient = () => createOpenAIClient(projectRoot, "openai")
  → new OpenAIProvider(createClient, converterOptions)
  →
provider.chat({
  model: "gpt-5.4",
  messages: [SessionMessage, ...],
  tools: [ToolDefinition, ...],
  providerOptions: { thinkingEnabled: true, reasoningEffort: "high" },
  signal: abortSignal,
})
  →
OpenAIProvider.chat():
  1. createOpenAIClient(projectRoot, "openai")
     → resolveCurrentSettings(projectRoot)
     → engines.openai.apiKey ?? apiKey → "sk-openai-..."
     → engines.openai.baseURL ?? baseURL → "https://api.openai.com/v1"
     → client: OpenAI instance with openai key + base url
  2. messageConverter.buildMessages(messages, true, "gpt-5.4")
     → ChatCompletionMessageParam[]
  3. buildThinkingRequestOptions(true, baseURL, "high", "openai")
     → { reasoning_effort: "high" }
  4. client.chat.completions.create({
       model: "gpt-5.4",
       messages: [...],
       tools: [...],
       stream: true,
       stream_options: { include_usage: true },
       reasoning_effort: "high",
       // NO thinking, NO extra_body (OpenAI format)
     })
  →
  yield { type: "reasoning_delta", text: "..." }
  yield { type: "text_delta", text: "..." }
  yield { type: "tool_call_start", id: "call_1", name: "read" }
  yield { type: "usage", usage: { prompt_tokens: 500, completion_tokens: 80 } }
  →
SessionManager iterates, aggregates, builds message (identical to DeepSeek flow)
```

### Compaction Flow (OpenAI)

```
SessionManager.compactSession()
  →
createLlmProvider() → OpenAIProvider
  →
provider.getCheapModel?.("gpt-5.4") → "gpt-5.4-mini"
  →
provider.chat({
  model: "gpt-5.4-mini",
  messages: [{ role: "user", content: compactionPrompt }],
  signal: abortSignal,
})
  →
OpenAIProvider.chat():
  - No providerOptions → thinkingEnabled = false
  - buildThinkingRequestOptions(false, baseURL, undefined, "openai") → {}
  - client.chat.completions.create({ model: "gpt-5.4-mini", messages: [...], stream: true })
  →
  yield { type: "text_delta", text: '{"summary":"..."}' }
  yield { type: "usage", usage: { ... } }
  →
SessionManager aggregates, parses JSON summary
```

---

## Data Structures

All existing structures unchanged. New/modified:

| Type | File | Change |
|---|---|---|
| `EngineEntry` | `settings-schema.ts` | NEW: `{ apiKey?: string; baseURL?: string }` |
| `ILlmProvider` | `llm-provider.ts` | MODIFY: add optional `getCheapModel?(model: string): string \| null` |
| `buildThinkingRequestOptions` return | `openai-thinking.ts` | MODIFY: widens to `ThinkingRequestOptions \| Record<string, unknown>` |
| `DeepcodingSettings` | `settings.ts` | MODIFY: add `engines?: Record<string, EngineEntry>` |
| `ResolvedDeepcodingSettings` | `settings.ts` | MODIFY: add `engines: Record<string, EngineEntry>` |

---

## File / Module Layout

```
src/
├── common/
│   ├── llm-provider.ts              ← MODIFY: add getCheapModel? to interface
│   ├── llm-provider-registry.ts     ← MODIFY: route model → OpenAIProvider or DeepSeekProvider
│   ├── openai-client.ts             ← MODIFY: accept optional engineName param
│   ├── openai-message-converter.ts  ← KEEP (unchanged — shared by both providers)
│   ├── openai-thinking.ts           ← MODIFY: accept optional providerName param
│   ├── api-timeout.ts               ← KEEP (unchanged)
│   ├── api-retry.ts                 ← KEEP (unchanged — used by both providers)
│   ├── model-capabilities.ts        ← MODIFY: add OpenAI pricing to DEFAULT_MODEL_PRICING
│   ├── settings-schema.ts           ← MODIFY: add EngineEntry type + engines to schema
│   └── ... all other files unchanged
├── providers/
│   ├── deepseek-provider.ts         ← MODIFY: add getCheapModel method
│   └── openai-provider.ts           ← NEW: OpenAIProvider class (~220 lines)
├── settings.ts                      ← MODIFY: add engines to types + resolution
├── session.ts                       ← MODIFY: getCheapModel in compaction
└── tools/
    └── executor.ts                  ← KEEP (unchanged)
```

---

## Testing Strategy

### Tests That MUST Pass Unchanged

All existing tests in these files pass without modification:
- `openai-message-converter.test.ts`
- `openai-thinking.test.ts` (existing DeepSeek tests)
- `prompt.test.ts`
- `budget-tracker.test.ts`
- `tool-executor.test.ts`
- `tool-handlers.test.ts`
- `web-search-handler.test.ts`
- All UI tests

### Tests That Need Minor Updates

**`session.test.ts`:**
- Tests that reference `createOpenAIClient` mock: if any test now needs `createOpenAIClient` to accept a second argument, update mock signatures.
- Compaction tests: update expected model name resolution to go through `provider.getCheapModel`.

**`settings.test.ts` or `settings-and-notify.test.ts`:**
- Add assertions for `engines` field in resolved settings.

### New Tests Required

**`openai-provider.test.ts` (NEW):**
1. `supportsModel` returns true for `gpt-5.4`, `o1`, `o3-mini`, `openai-custom`; false for `deepseek-v4-pro`, `claude-sonnet`.
2. `getTimeoutMs` returns `300_000` for `gpt-5.4`, `o1`; `180_000` for `gpt-5.4-mini`.
3. `isMultimodal` returns `false` for `o1-mini`, `o3-mini`; `true` for `gpt-5.4`.
4. `chat()` yields `text_delta` events for text content.
5. `chat()` yields `reasoning_delta` for reasoning content.
6. `chat()` yields `tool_call_start` + `tool_call_delta` for tool calls.
7. `chat()` yields `usage` for usage chunks.
8. `chat()` respects `signal` (aborts when signalled).
9. `chat()` throws when API key is missing.
10. `getCheapModel` returns `"gpt-5.4-mini"` for `"gpt-5.4"`; `null` for `"gpt-5.4-mini"`; `"o3-mini"` for `"o3"`.
11. `chat()` passes `"openai"` as providerName to `buildThinkingRequestOptions`.

**`openai-thinking.test.ts` (MODIFY — add tests, don't remove existing):**
12. `buildThinkingRequestOptions(true, undefined, "high", "openai")` returns `{ reasoning_effort: "high" }`.
13. `buildThinkingRequestOptions(false, undefined, undefined, "openai")` returns `{}`.
14. `buildThinkingRequestOptions(true, undefined, "max", "openai")` returns `{ reasoning_effort: "max" }`.
15. `buildThinkingRequestOptions(true, undefined, undefined)` returns DeepSeek format (existing behavior preserved).

**`llm-provider-registry.test.ts` (NEW or add to existing):**
16. `createLlmProvider()` with model `"gpt-5.4"` returns `OpenAIProvider` instance.
17. `createLlmProvider()` with model `"deepseek-v4-pro"` returns `DeepSeekProvider` instance.
18. `createLlmProvider()` with model `"unknown-model"` returns `DeepSeekProvider` instance (default).

**`settings.test.ts` (MODIFY — add tests):**
19. `engines` field resolves from project settings.
20. Engine env var `DEEPCODE_ENGINE_OPENAI_API_KEY` populates `engines.openai.apiKey`.
21. Engine-specific API key overrides global API key for that engine.

### Mock Provider Pattern (Existing, Unchanged)

```typescript
function createMockProvider(events: LlmStreamEvent[]): ILlmProvider {
  return {
    providerName: "mock",
    supportsModel: () => true,
    getTimeoutMs: () => 180_000,
    isMultimodal: () => false,
    chat: async function* () {
      for (const event of events) yield event;
    },
    getCheapModel: () => null,  // NEW: trivial implementation
  };
}
```

---

## Migration / Rollback

**Migration:** No data migration required. The `engines` field is optional — existing `settings.json` files without `engines` work unchanged. Users must manually add `engines.openai.apiKey` to their settings to use OpenAI models. The spec does NOT auto-migrate existing API keys.

**Rollback:** Revert the commit. All changes are additive (new file + new branches in existing files). Removing the `OpenAIProvider` and registry routing reverts to DeepSeek-only behavior. The `engines` field in settings is benign if present but unused.
