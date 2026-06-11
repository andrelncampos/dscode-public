import { resolveCurrentSettings } from "../settings";
import { createOpenAIClient } from "./openai-client";
import { DeepSeekProvider } from "../providers/deepseek-provider";
import { AnthropicProvider } from "../providers/anthropic-provider";
import type { ILlmProvider } from "./llm-provider";
import type { OpenAIMessageConverterOptions } from "./openai-message-converter";
import type { CreateOpenAIClient } from "../tools/executor";

export type CreateLlmProviderReturn = {
  provider: ILlmProvider | null;
  createOpenAIClient: CreateOpenAIClient;
};

function isAnthropicModel(model: string): boolean {
  return model.toLowerCase().startsWith("claude-");
}

export function createLlmProvider(
  projectRoot: string = process.cwd(),
  converterOptions?: OpenAIMessageConverterOptions
): CreateLlmProviderReturn {
  const settings = resolveCurrentSettings(projectRoot);
  const createClient: CreateOpenAIClient = () => createOpenAIClient(projectRoot);

  if (!settings.apiKey) {
    return { provider: null, createOpenAIClient: createClient };
  }

  // Anthropic routing
  if (isAnthropicModel(settings.model)) {
    const provider = new AnthropicProvider();
    return { provider, createOpenAIClient: createClient };
  }

  // Default: DeepSeek (backward compatible)
  const provider = new DeepSeekProvider(createClient, converterOptions);
  return { provider, createOpenAIClient: createClient };
}
