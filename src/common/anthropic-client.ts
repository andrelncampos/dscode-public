import Anthropic from "@anthropic-ai/sdk";
import { resolveCurrentSettings } from "../settings";

let cachedAnthropic: Anthropic | null = null;
let cachedAnthropicKey = "";

export function createAnthropicClient(
  projectRoot: string = process.cwd(),
  engineName?: string
): {
  client: Anthropic | null;
  model: string;
  thinkingEnabled: boolean;
  debugLogEnabled: boolean;
  telemetryEnabled: boolean;
  maxTokens: number;
  notify?: string;
  env: Record<string, string>;
} {
  const settings = resolveCurrentSettings(projectRoot);

  // Engine-specific default base URLs (not falling through to global DeepSeek default)
  const ENGINE_DEFAULT_BASE_URLS: Record<string, string> = {
    anthropic: "https://api.anthropic.com",
  };

  // Resolve API key and base URL: engine-specific → engine default → global
  let apiKey = settings.apiKey;
  let baseURL = settings.baseURL;
  if (engineName) {
    const engineConfig = settings.engines[engineName];
    if (engineConfig) {
      apiKey = engineConfig.apiKey || apiKey;
      baseURL = engineConfig.baseURL || ENGINE_DEFAULT_BASE_URLS[engineName] || baseURL;
    } else {
      baseURL = ENGINE_DEFAULT_BASE_URLS[engineName] || baseURL;
    }
  }

  if (!apiKey) {
    return {
      client: null,
      model: settings.model,
      thinkingEnabled: settings.thinkingEnabled,
      debugLogEnabled: settings.debugLogEnabled,
      telemetryEnabled: settings.telemetryEnabled,
      maxTokens: settings.maxTokens,
      notify: settings.notify,
      env: settings.env,
    };
  }

  const cacheKey = `${apiKey}::${baseURL}`;
  if (cachedAnthropic && cachedAnthropicKey === cacheKey) {
    return {
      client: cachedAnthropic,
      model: settings.model,
      thinkingEnabled: settings.thinkingEnabled,
      debugLogEnabled: settings.debugLogEnabled,
      telemetryEnabled: settings.telemetryEnabled,
      maxTokens: settings.maxTokens,
      notify: settings.notify,
      env: settings.env,
    };
  }

  cachedAnthropic = new Anthropic({ apiKey, baseURL: baseURL || undefined });
  cachedAnthropicKey = cacheKey;

  return {
    client: cachedAnthropic,
    model: settings.model,
    thinkingEnabled: settings.thinkingEnabled,
    debugLogEnabled: settings.debugLogEnabled,
    telemetryEnabled: settings.telemetryEnabled,
    maxTokens: settings.maxTokens,
    notify: settings.notify,
    env: settings.env,
  };
}
