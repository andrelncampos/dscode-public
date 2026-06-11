import { OpenAIMessageConverter, type OpenAIMessageConverterOptions } from "../common/openai-message-converter";
import { buildThinkingRequestOptions } from "../common/openai-thinking";
import { DEFAULT_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
import type { ModelUsage } from "../session";
import type { CreateOpenAIClient } from "../tools/executor";
import { withRetry } from "../common/api-retry";

const OPENAI_MODEL_PREFIXES = ["gpt-", "o1", "o3", "o4", "openai-"] as const;
const OPENAI_NON_MULTIMODAL_MODELS = new Set(["o1-mini", "o3-mini"]);
const OPENAI_REASONING_MODELS_PATTERN = /^(o[134]|gpt-5\.[0-9]+)$/; // base reasoning models (excludes -mini variants)

export class OpenAIProvider implements ILlmProvider {
  readonly providerName = "openai";
  private readonly messageConverter: OpenAIMessageConverter;

  constructor(
    private readonly createOpenAIClient: CreateOpenAIClient,
    converterOptions: OpenAIMessageConverterOptions = {}
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
      return PRO_API_TIMEOUT_MS; // 300_000
    }
    return DEFAULT_API_TIMEOUT_MS; // 180_000
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

    const openaiMessages = this.messageConverter.buildMessages(options.messages, thinkingEnabled, options.model);

    const thinkingOptions = buildThinkingRequestOptions(
      thinkingEnabled,
      baseURL,
      reasoningEffort,
      "openai" // ← KEY DIFFERENCE from DeepSeekProvider
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
        const attemptSignal = options.signal ? AbortSignal.any([options.signal, attemptTimeout]) : attemptTimeout;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return client.chat.completions.create(streamRequest as any, {
          signal: attemptSignal,
        });
      },
      { userSignal: options.signal }
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
