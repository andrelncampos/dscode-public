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
  converterOptions?: OpenAIMessageConverterOptions
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
