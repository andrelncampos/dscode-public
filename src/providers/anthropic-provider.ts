import type AnthropicSdk from "@anthropic-ai/sdk";
import { AnthropicMessageConverter, convertToolsToAnthropic } from "../common/anthropic-message-converter";
import { DEFAULT_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
import type { ModelUsage } from "../session";
import { withRetry } from "../common/api-retry";
import { createAnthropicClient } from "../common/anthropic-client";
import { getAuxiliaryModel } from "../common/model-catalog";

// Map DsCode ThinkingEffort to Anthropic adaptive effort.
// Anthropic adaptive thinking supports: "low", "medium", "high".
// "xhigh" / "max" → "high" (top tier)
// "none" → disable thinking entirely
function toAnthropicEffort(effort: string | undefined): string | undefined {
  if (!effort || effort === "none") return undefined;
  if (effort === "xhigh" || effort === "max") return "high";
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  return "high";
}

const CLAUDE_MODEL_PREFIX = "claude-";
// Reasoning models: opus and sonnet get longer timeouts
const CLAUDE_REASONING_PATTERN = /^claude-(opus|sonnet)/;
// Models that use adaptive thinking (thinking: { type: "adaptive" })
// instead of manual extended thinking (thinking: { type: "enabled", budget_tokens: N }).
// Opus 4.8+, Sonnet 4.6+ — manual extended thinking returns 400 on Opus 4.8/4.7.
const ADAPTIVE_THINKING_PATTERN = /^claude-(opus-(4\.[78]|[5-9])|sonnet-(4\.[6-9]|[5-9]))/;

function isAdaptiveThinkingModel(model: string): boolean {
  return ADAPTIVE_THINKING_PATTERN.test(model.toLowerCase());
}

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

  getAuxiliaryModel(model: string): string | null {
    return getAuxiliaryModel(model);
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
    // Fable 5 / Mythos 5: adaptive thinking always on — override for converter and request.
    const isFableOrMythos = /^claude-(fable|mythos)/.test(options.model.toLowerCase());
    const effectiveThinking = thinkingEnabled || isFableOrMythos;

    // Build Anthropic messages
    const anthropicMessages = this.messageConverter.buildMessages(options.messages, effectiveThinking, options.model);
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
      // Automatic prompt caching — cache reads cost 10% of base input price.
      cache_control: { type: "ephemeral" },
    };

    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }
    if (anthropicTools) {
      requestBody.tools = anthropicTools;
    }

    // Model-aware thinking configuration.
    // Fable 5 / Mythos 5: adaptive thinking always on (cannot be disabled).
    // Opus 4.8+/Sonnet 4.6+: adaptive thinking with effort control.
    // Haiku 4.5: extended thinking with budget_tokens.
    const useAdaptive = isFableOrMythos || isAdaptiveThinkingModel(options.model);

    if (effectiveThinking) {
      if (useAdaptive) {
        const effort = toAnthropicEffort(providerOpts?.reasoningEffort);
        const thinkingBlock: Record<string, unknown> = { type: "adaptive" };
        if (effort) thinkingBlock.effort = effort;
        requestBody.thinking = thinkingBlock;
      } else {
        // Extended thinking budget: Haiku 4.5 max output is 64K, use 16K thinking budget.
        requestBody.thinking = { type: "enabled", budget_tokens: 16384 };
      }
    } else {
      requestBody.thinking = { type: "disabled" };
    }

    if (options.temperature !== undefined && !effectiveThinking) {
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
    let outputTokens: number;
    let currentToolUseId = "";
    let pendingSignature = "";

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
              pendingSignature += delta.signature;
            }
            break;
          }

          case "content_block_stop": {
            // Emit accumulated signature (needed for multi-turn echo-back to Anthropic API).
            if (pendingSignature) {
              yield { type: "signature", signature: pendingSignature };
              pendingSignature = "";
            }
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
