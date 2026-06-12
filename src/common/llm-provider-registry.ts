import { resolveCurrentSettings } from "../settings";
import { createOpenAIClient } from "./openai-client";
import { DeepSeekProvider } from "../providers/deepseek-provider";
import { OpenAIProvider } from "../providers/openai-provider";
import { AnthropicProvider } from "../providers/anthropic-provider";
import type { ILlmProvider } from "./llm-provider";
import type { OpenAIMessageConverterOptions } from "./openai-message-converter";
import type { CreateOpenAIClient } from "../tools/executor";

export type CreateLlmProviderReturn = {
  provider: ILlmProvider | null;
  createOpenAIClient: CreateOpenAIClient;
};

const OPENAI_MODEL_PREFIXES = ["gpt-", "o1", "o3", "o4", "openai-"] as const;

function isOpenAIModel(model: string): boolean {
  const lower = model.toLowerCase();
  return OPENAI_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function isAnthropicModel(model: string): boolean {
  return model.toLowerCase().startsWith("claude-");
}

export function createLlmProvider(
  projectRoot: string = process.cwd(),
  converterOptions?: OpenAIMessageConverterOptions
): CreateLlmProviderReturn {
  const settings = resolveCurrentSettings(projectRoot);

  // Determine engine name from model prefix for API key / base URL resolution.
  // DeepSeek and OpenAI share createOpenAIClient; Anthropic uses its own client.
  const engineName = isOpenAIModel(settings.model) ? "openai" : undefined;
  const createClient: CreateOpenAIClient = () => createOpenAIClient(projectRoot, engineName);

  if (!settings.apiKey && !settings.engines[engineName ?? ""]?.apiKey) {
    return { provider: null, createOpenAIClient: createClient };
  }

  // OpenAI routing
  if (isOpenAIModel(settings.model)) {
    // Check if engine-specific API key is available (or global fallback)
    const { client } = createClient();
    if (!client) {
      return { provider: null, createOpenAIClient: createClient };
    }
    const provider = new OpenAIProvider(createClient, converterOptions);
    return { provider, createOpenAIClient: createClient };
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
