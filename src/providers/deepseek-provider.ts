import { OpenAIMessageConverter, type OpenAIMessageConverterOptions } from "../common/openai-message-converter";
import { buildThinkingRequestOptions } from "../common/openai-thinking";
import { DEFAULT_API_TIMEOUT_MS, FLASH_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
import type { ModelUsage } from "../session";
import type { CreateOpenAIClient } from "../tools/executor";
import { isMultimodalModel } from "../common/model-capabilities";

const DEEPSEEK_MODEL_PREFIX = "deepseek-";

export class DeepSeekProvider implements ILlmProvider {
  readonly providerName = "deepseek";
  private readonly messageConverter: OpenAIMessageConverter;

  constructor(
    private readonly createOpenAIClient: CreateOpenAIClient,
    converterOptions: OpenAIMessageConverterOptions = {}
  ) {
    this.messageConverter = new OpenAIMessageConverter(converterOptions);
  }

  supportsModel(model: string): boolean {
    return model.toLowerCase().startsWith(DEEPSEEK_MODEL_PREFIX);
  }

  getTimeoutMs(model: string): number {
    if (model === "deepseek-v4-pro") return PRO_API_TIMEOUT_MS; // 300_000
    if (model === "deepseek-v4-flash") return FLASH_API_TIMEOUT_MS; // 180_000
    return DEFAULT_API_TIMEOUT_MS; // 180_000
  }

  isMultimodal(model: string): boolean {
    return isMultimodalModel(model);
  }

  async *chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent> {
    const { client, baseURL } = this.createOpenAIClient();

    if (!client) {
      throw new Error("DeepSeek API key not configured");
    }

    const providerOpts = options.providerOptions as
      | { thinkingEnabled?: boolean; reasoningEffort?: "high" | "max" }
      | undefined;
    const thinkingEnabled = providerOpts?.thinkingEnabled ?? false;
    const reasoningEffort = providerOpts?.reasoningEffort;

    const openaiMessages = this.messageConverter.buildMessages(options.messages, thinkingEnabled, options.model);

    const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);

    const timeoutSignal = AbortSignal.timeout(this.getTimeoutMs(options.model));
    const composedSignal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawResponse = await client.chat.completions.create(streamRequest as any, {
      signal: composedSignal,
    });

    // Handle non-streaming responses (tests, older API versions)
    const response = rawResponse as unknown as Record<string, unknown>;
    if (
      !rawResponse ||
      typeof (rawResponse as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== "function"
    ) {
      // Non-streaming: extract usage and message content directly
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
            // Use the given id (even empty) — normalizeLlmToolCalls handles ID generation
            const toolId = typeof tc.id === "string" ? tc.id : "";
            yield {
              type: "tool_call_start",
              id: toolId,
              name: typeof tcFn?.name === "string" ? (tcFn.name as string) : "",
            };
            if (typeof tcFn?.arguments === "string") {
              yield {
                type: "tool_call_delta",
                id: toolId,
                arguments: tcFn.arguments as string,
              };
            } else if (tcFn?.arguments !== null && typeof tcFn?.arguments === "object") {
              yield {
                type: "tool_call_delta",
                id: toolId,
                arguments: JSON.stringify(tcFn.arguments),
              };
            }
          }
        }
      }
      return;
    }

    const stream = rawResponse as unknown as AsyncIterable<Record<string, unknown>>;

    // DeepSeek API only includes `id` on the first chunk of each tool call.
    // Subsequent chunks carry only `index` + `function.arguments` (no `id`).
    // This map tracks index→id so delta events always carry the correct id.
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

              // Track index→id mapping (DeepSeek only sends id on first chunk per tool call)
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

              // Resolve the effective id: use tc.id directly if present, otherwise fallback to index→id map
              const effectiveId =
                typeof tc.id === "string"
                  ? tc.id
                  : typeof tc.index === "number"
                    ? (toolIndexToId.get(tc.index) ?? "")
                    : "";

              if (typeof tcFn?.arguments === "string") {
                yield {
                  type: "tool_call_delta",
                  id: effectiveId,
                  arguments: tcFn.arguments as string,
                };
              } else if (tcFn?.arguments !== null && typeof tcFn?.arguments === "object") {
                yield {
                  type: "tool_call_delta",
                  id: effectiveId,
                  arguments: JSON.stringify(tcFn.arguments),
                };
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
