import { buildThinkingRequestOptions } from "../common/openai-thinking";
import { DEFAULT_API_TIMEOUT_MS, FLASH_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
import type { LlmChatOptions } from "../common/llm-provider";
import type { CreateOpenAIClient } from "../tools/executor";
import { isMultimodalModel } from "../common/model-capabilities";
import { getAuxiliaryModel } from "../common/model-catalog";
import { BaseOpenAICompatibleProvider } from "./base-openai-provider";
import type { OpenAIMessageConverterOptions } from "../common/openai-message-converter";

const DEEPSEEK_MODEL_PREFIX = "deepseek-";

// NOTE: This method is structurally mirrored from OpenAIProvider.chat().
// Bugfixes applied to one MUST be applied to the other.
// See: src/providers/openai-provider.ts (Spec 40)

export class DeepSeekProvider extends BaseOpenAICompatibleProvider {
  readonly providerName = "deepseek";

  constructor(createOpenAIClient: CreateOpenAIClient, converterOptions: OpenAIMessageConverterOptions = {}) {
    super(createOpenAIClient, converterOptions);
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

  getAuxiliaryModel(model: string): string | null {
    return getAuxiliaryModel(model);
  }

  protected buildChatCompletionRequest(
    options: LlmChatOptions,
    openaiMessages: unknown[],
    _client: ReturnType<CreateOpenAIClient>["client"],
    baseURL: string
  ): Record<string, unknown> {
    const providerOpts = options.providerOptions as
      | { thinkingEnabled?: boolean; reasoningEffort?: "high" | "max" }
      | undefined;
    const thinkingEnabled = providerOpts?.thinkingEnabled ?? false;
    const reasoningEffort = providerOpts?.reasoningEffort;

    const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);

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

    return streamRequest;
  }
}
