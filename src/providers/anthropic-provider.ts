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
      return PRO_API_TIMEOUT_MS; // 300_000
    }
    return DEFAULT_API_TIMEOUT_MS; // 180_000
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
    const anthropicMessages = this.messageConverter.buildMessages(options.messages, thinkingEnabled, options.model);
    const systemPrompt = this.messageConverter.getSystemPrompt();

    // Convert tools to Anthropic format
    const anthropicTools =
      options.tools && options.tools.length > 0 ? convertToolsToAnthropic(options.tools) : undefined;

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
        const attemptSignal = options.signal ? AbortSignal.any([options.signal, attemptTimeout]) : attemptTimeout;
        // The Anthropic SDK's messages.create with stream:true returns a Stream
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return client.messages.create(requestBody as any, {
          signal: attemptSignal,
        });
      },
      { userSignal: options.signal }
    );

    // Convert Anthropic stream to LlmStreamEvent
    yield* this.streamToEvents(stream as unknown as AsyncIterable<AnthropicSdk.MessageStreamEvent>);
  }

  private async *streamToEvents(stream: AsyncIterable<AnthropicSdk.MessageStreamEvent>): AsyncIterable<LlmStreamEvent> {
    let inputTokens = 0;
    let outputTokens = 0;
    let currentToolUseId = "";

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
              // Track thinking block — content is accumulated from deltas
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
              yield { type: "reasoning_delta", text: delta.thinking };
            } else if (delta.type === "signature_delta") {
              // Signature stored for future echo-back (not yet communicated to SessionManager)
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

          default: {
            // Unknown event type (including "ping") — ignore per Anthropic docs
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
