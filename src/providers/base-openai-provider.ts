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
    converterOptions: OpenAIMessageConverterOptions = {}
  ) {
    this.messageConverter = new OpenAIMessageConverter(converterOptions);
  }

  abstract supportsModel(model: string): boolean;
  abstract getTimeoutMs(model: string): number;
  abstract isMultimodal(model: string): boolean;
  getAuxiliaryModel?(_model: string): string | null;

  /** Subclasses override this to provide provider-specific request options. */
  protected abstract buildChatCompletionRequest(
    options: LlmChatOptions,
    openaiMessages: unknown[],
    client: ReturnType<CreateOpenAIClient>["client"],
    baseURL: string
  ): Record<string, unknown>;

  async *chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent> {
    const { client, baseURL } = this.createOpenAIClient();

    if (!client) {
      throw new Error(`${this.providerName} API key not configured`);
    }

    const openaiMessages = this.messageConverter.buildMessages(
      options.messages,
      (options.providerOptions as { thinkingEnabled?: boolean } | undefined)?.thinkingEnabled ?? false,
      options.model
    );

    const streamRequest = this.buildChatCompletionRequest(options, openaiMessages, client, baseURL ?? "");

    // Retry transient failures (429, 502, 503, network errors) with exponential backoff.
    // Timeout signals are recreated per attempt so each retry gets a fresh timeout window.
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

    // DeepSeek/OpenAI API only includes `id` on the first chunk of each tool call.
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

              // Track index→id mapping (only sent on first chunk per tool call)
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
