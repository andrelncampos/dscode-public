import { resolveCurrentSettings } from "../settings";

export type GeminiClientConfig = {
  apiKey: string | null;
  baseURL: string;
  model: string;
  thinkingEnabled: boolean;
  debugLogEnabled: boolean;
  telemetryEnabled: boolean;
  maxTokens: number;
  notify?: string;
  env: Record<string, string>;
};

const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export function createGeminiClient(
  projectRoot: string = process.cwd(),
  engineName: string = "gemini"
): GeminiClientConfig {
  const settings = resolveCurrentSettings(projectRoot);

  // Resolve API key: engine-specific → none
  let apiKey: string | undefined;
  let baseURL: string;

  const engineConfig = settings.engines[engineName];
  if (engineConfig) {
    apiKey = engineConfig.apiKey;
    baseURL = engineConfig.baseURL || GEMINI_DEFAULT_BASE_URL;
  } else {
    baseURL = GEMINI_DEFAULT_BASE_URL;
  }

  return {
    apiKey: apiKey || null,
    baseURL: baseURL || GEMINI_DEFAULT_BASE_URL,
    model: settings.model,
    thinkingEnabled: settings.thinkingEnabled,
    debugLogEnabled: settings.debugLogEnabled,
    telemetryEnabled: settings.telemetryEnabled,
    maxTokens: settings.maxTokens,
    notify: settings.notify,
    env: settings.env,
  };
}
