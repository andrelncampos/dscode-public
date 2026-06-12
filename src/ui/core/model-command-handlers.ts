import type { ResolvedDeepcodingSettings } from "../../settings";
import type { ModelEntry } from "../../common/model-catalog";
import { MODEL_CATALOG, getModelCapabilities } from "../../common/model-catalog";
import { DEFAULT_MODEL_PRICING, formatTokenCount } from "../../common/model-capabilities";
import { encryptCredential, decryptCredential, isEncryptedCredential } from "../../common/credential-vault";
import { readSettings, writeSettings } from "../../settings";

// ── Types ─────────────────────────────────────────────────────────

export type ModelCommandContext = {
  settings: ResolvedDeepcodingSettings;
  catalog: ModelEntry[];
  input: string;
  settingsDir: string;
  wizardState?: Record<string, unknown>;
};

export type ModelCommandResult = {
  message: string;
  needsMoreInput: boolean;
  wizardState?: Record<string, unknown>;
  settingsChanged: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────

const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

const PROVIDER_KEY_URLS: Record<string, string> = {
  deepseek: "https://platform.deepseek.com/api_keys",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/apikey",
};

function hasKeyForProvider(settings: ResolvedDeepcodingSettings, provider: string): boolean {
  if (provider === "deepseek") return Boolean(settings.apiKey);
  if (provider === "openai") return Boolean(settings.engines.openai?.apiKey) || Boolean(settings.apiKey);
  return Boolean(settings.engines[provider]?.apiKey);
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function getProviderModels(catalog: ModelEntry[], provider: string): ModelEntry[] {
  return catalog.filter((m) => m.provider === provider);
}

function getCurrentProvider(settings: ResolvedDeepcodingSettings): string {
  const entry = MODEL_CATALOG.find((m) => m.id === settings.model);
  return entry?.provider ?? "unknown";
}

function listExtendedThinkingModels(): string {
  const models = MODEL_CATALOG.filter((m) => m.reasoning.type === "extended");
  return models.map((m) => `${m.id} (${m.displayName})`).join(", ");
}

// ── Handlers ──────────────────────────────────────────────────────

export function handleModelList(ctx: ModelCommandContext): ModelCommandResult {
  const { catalog, settings } = ctx;
  if (catalog.length === 0) {
    return { message: "No models in catalog.", needsMoreInput: false, settingsChanged: false };
  }

  const providers = [...new Set(catalog.map((m) => m.provider))];
  const lines: string[] = [];

  for (const provider of providers) {
    const models = getProviderModels(catalog, provider);
    const keyOk = hasKeyForProvider(settings, provider);
    const keyStatus = keyOk ? "key" : "no key";
    const baseUrl = settings.engines[provider]?.baseURL || PROVIDER_DEFAULT_BASE_URLS[provider] || "unknown";
    const prices = models
      .map((m) => DEFAULT_MODEL_PRICING[m.id]?.inputPrice)
      .filter((p): p is number => p !== undefined);
    const priceRange =
      prices.length > 0 ? `$${Math.min(...prices).toFixed(2)}–$${Math.max(...prices).toFixed(2)}/1M` : "no pricing";

    lines.push(`── ${provider} ──`);
    lines.push(`  ${keyOk ? "✅" : "❌"} ${keyStatus}  ·  ${baseUrl}  ·  ${models.length} models  ·  ${priceRange}`);
    for (const m of models) {
      const p = DEFAULT_MODEL_PRICING[m.id];
      const priceStr = p ? `$${p.inputPrice}/${p.outputPrice}` : "no pricing";
      lines.push(`    ${m.id.padEnd(22)} ${m.displayName.padEnd(20)} ${priceStr}`);
    }
    lines.push("");
  }

  return { message: lines.join("\n").trimEnd(), needsMoreInput: false, settingsChanged: false };
}

export function handleModelAdd(ctx: ModelCommandContext): ModelCommandResult {
  const ws = (ctx.wizardState ?? {}) as Record<string, unknown>;
  const step = (ws.step as string) || "init";
  const provider = (ws.provider as string) || "";

  if (step === "init") {
    const parts = ctx.input.trim().split(/\s+/);
    const provName = parts[1]?.toLowerCase();
    if (!provName) {
      const unconfigured = [...new Set(MODEL_CATALOG.map((m) => m.provider))].filter(
        (p) => !hasKeyForProvider(ctx.settings, p)
      );
      return {
        message: `Usage: /model-add <provider>. Valid providers: ${unconfigured.length > 0 ? unconfigured.join(", ") : "none available"}.`,
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    if (!MODEL_CATALOG.some((m) => m.provider === provName)) {
      const valid = [...new Set(MODEL_CATALOG.map((m) => m.provider))].join(", ");
      return {
        message: `Unknown provider '${provName}'. Valid providers: ${valid}.`,
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    if (hasKeyForProvider(ctx.settings, provName)) {
      return {
        message: `Provider '${provName}' already has an API key configured. Use /model-key ${provName} to update it.`,
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    const defaultBaseUrl = PROVIDER_DEFAULT_BASE_URLS[provName] || "";
    return {
      message: `Base URL: ${defaultBaseUrl}. Press ENTER to accept default, or type a custom URL:`,
      needsMoreInput: true,
      wizardState: { step: "baseUrl", provider: provName, defaultBaseUrl },
      settingsChanged: false,
    };
  }

  if (step === "baseUrl") {
    const input = ctx.input.trim();
    const defaultBaseUrl = (ws.defaultBaseUrl as string) || PROVIDER_DEFAULT_BASE_URLS[provider] || "";
    if (input) {
      if (!input.startsWith("http://") && !input.startsWith("https://")) {
        return {
          message: "Invalid URL. Must start with http:// or https://.",
          needsMoreInput: true,
          wizardState: { ...ws },
          settingsChanged: false,
        };
      }
      return {
        message: `API Key required. Obtain one at: ${PROVIDER_KEY_URLS[provider] || "the provider's website"}.\nEnter API key (or ESC to cancel):`,
        needsMoreInput: true,
        wizardState: { step: "apiKey", provider, baseUrl: input, defaultBaseUrl },
        settingsChanged: false,
      };
    }
    return {
      message: `API Key required. Obtain one at: ${PROVIDER_KEY_URLS[provider] || "the provider's website"}.\nEnter API key (or ESC to cancel):`,
      needsMoreInput: true,
      wizardState: { step: "apiKey", provider, baseUrl: defaultBaseUrl, defaultBaseUrl },
      settingsChanged: false,
    };
  }

  if (step === "apiKey") {
    const apiKey = ctx.input.trim();
    if (!apiKey || apiKey.length < 8) {
      return {
        message: "API key must be at least 8 characters.",
        needsMoreInput: true,
        wizardState: { ...ws },
        settingsChanged: false,
      };
    }
    const baseUrl = (ws.baseUrl as string) || "";
    return {
      message: `Press ENTER to confirm, or type "retry" to re-enter:\n  Provider: ${provider}\n  Base URL: ${baseUrl}\n  API Key: ${maskKey(apiKey)}`,
      needsMoreInput: true,
      wizardState: { step: "confirm", provider, baseUrl, apiKey },
      settingsChanged: false,
    };
  }

  if (step === "confirm") {
    const input = ctx.input.trim();
    if (input === "retry") {
      const defaultBaseUrl = PROVIDER_DEFAULT_BASE_URLS[provider] || "";
      return {
        message: `Base URL: ${defaultBaseUrl}. Press ENTER to accept default, or type a custom URL:`,
        needsMoreInput: true,
        wizardState: { step: "baseUrl", provider, defaultBaseUrl },
        settingsChanged: false,
      };
    }

    const apiKey = (ws.apiKey as string) || "";
    const baseUrl = (ws.baseUrl as string) || "";
    const defaultBaseUrl = PROVIDER_DEFAULT_BASE_URLS[provider] || "";

    const encrypted = encryptCredential(apiKey, provider);
    const settings = readSettings() ?? {};
    settings.engines = settings.engines ?? {};
    settings.engines[provider] = { apiKey: encrypted, apiKeyEncrypted: true };
    if (baseUrl && baseUrl !== defaultBaseUrl) {
      settings.engines[provider].baseURL = baseUrl;
    }
    writeSettings(settings);

    const models = getProviderModels(MODEL_CATALOG, provider);
    const modelLines = models.map((m) => {
      const p = DEFAULT_MODEL_PRICING[m.id];
      const priceStr = p ? `$${p.inputPrice}/$${p.outputPrice}` : "no pricing";
      return `  ${m.id}  ${m.displayName}  ${priceStr}`;
    });

    const successLines = [
      `Provider:  ${provider}`,
      `Base URL:  ${baseUrl}`,
      `API Key:   ${maskKey(apiKey)}`,
      ``,
      `Available models (${models.length}):`,
      ...modelLines,
      ``,
      `Use /model to select a ${provider} model.`,
    ];

    return { message: successLines.join("\n"), needsMoreInput: false, settingsChanged: true };
  }

  return { message: "Unexpected wizard state.", needsMoreInput: false, settingsChanged: false };
}

export function handleModelRemove(ctx: ModelCommandContext): ModelCommandResult {
  const ws = (ctx.wizardState ?? {}) as Record<string, unknown>;
  const step = (ws.step as string) || "init";

  if (step === "confirmRemove") {
    if (ctx.input.trim() === "yes") {
      const provider = (ws.provider as string) || "";
      const settings = readSettings() ?? {};
      if (settings.engines) {
        delete settings.engines[provider];
      }
      writeSettings(settings);
      return {
        message: `✅ Provider '${provider}' removed. Models from this provider are still listed in /model but will need an API key to use.`,
        needsMoreInput: false,
        settingsChanged: true,
      };
    }
    return { message: "Cancelled.", needsMoreInput: false, settingsChanged: false };
  }

  const parts = ctx.input.trim().split(/\s+/);
  const provider = parts[1]?.toLowerCase();
  if (!provider) {
    const configured = Object.keys(ctx.settings.engines).filter((p) => ctx.settings.engines[p]?.apiKey);
    return {
      message: `Usage: /model-remove <provider>. Currently configured: ${configured.length > 0 ? configured.join(", ") : "none"}.`,
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  if (!MODEL_CATALOG.some((m) => m.provider === provider)) {
    const valid = [...new Set(MODEL_CATALOG.map((m) => m.provider))].join(", ");
    return {
      message: `Unknown provider '${provider}'. Valid providers: ${valid}.`,
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  // Check raw settings (not resolved) to see if there's an entry to remove
  const rawSettings = readSettings();
  if (!rawSettings?.engines?.[provider]) {
    return {
      message: `Provider '${provider}' is not configured. Nothing to remove.`,
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  const currentProvider = getCurrentProvider(ctx.settings);
  const providersWithKeys = [...new Set(MODEL_CATALOG.map((m) => m.provider))].filter((p) =>
    hasKeyForProvider(ctx.settings, p)
  );
  const isCurrentProvider = currentProvider === provider;
  const isSoleProvider = providersWithKeys.length === 1 && hasKeyForProvider(ctx.settings, provider);

  let warning: string;
  if (isSoleProvider && isCurrentProvider) {
    warning = `Warning: ${provider} is the only configured provider and is currently active. Removing it will leave no API keys. Continue? Type 'yes' to confirm.`;
  } else if (isCurrentProvider) {
    warning = `Warning: the current model '${ctx.settings.model}' uses ${provider}. After removal, switch to another model with /model. Continue? Type 'yes' to confirm.`;
  } else {
    warning = `Remove provider '${provider}'? Type 'yes' to confirm.`;
  }

  return {
    message: warning,
    needsMoreInput: true,
    wizardState: { step: "confirmRemove", provider },
    settingsChanged: false,
  };
}

export function handleModelInfo(ctx: ModelCommandContext): ModelCommandResult {
  const parts = ctx.input.trim().split(/\s+/);
  const modelId = parts[1]?.toLowerCase();
  if (!modelId) {
    return {
      message: "Usage: /model-info <model-id>. Example: /model-info gpt-5.5",
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  const caps = getModelCapabilities(modelId);
  if (!caps) {
    return {
      message: `Unknown model '${modelId}'. Use /model to see available models.`,
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!entry) {
    return { message: `Unknown model '${modelId}'.`, needsMoreInput: false, settingsChanged: false };
  }

  const keyOk = hasKeyForProvider(ctx.settings, entry.provider);
  const lines = [
    `Model:       ${caps.displayName} (${caps.id})`,
    `Provider:    ${caps.provider}`,
    `Context:     ${formatTokenCount(caps.contextWindow)}`,
    `Max Output:  ${formatTokenCount(caps.maxOutput)}`,
    `Multimodal:  ${caps.multimodal ? "yes" : "no"}`,
    `Thinking:    ${caps.reasoning.type}`,
  ];
  if (caps.reasoning.type !== "none") {
    lines.push(`  Default:   ${caps.reasoning.defaultEffort}`);
    if (caps.reasoning.budgetTokens) {
      lines.push(`  Budget:    ${formatTokenCount(caps.reasoning.budgetTokens)}`);
    }
  }
  const p = caps.pricing;
  if (p) {
    lines.push(`Pricing:     $${p.inputPrice}/$${p.outputPrice} per 1M tokens (cached: $${p.cacheReadPrice}/1M)`);
  } else {
    lines.push(`Pricing:     not available`);
  }
  lines.push(`Status:      ${keyOk ? "✅ API key configured" : "❌ No API key configured"}`);

  return { message: lines.join("\n"), needsMoreInput: false, settingsChanged: false };
}

export function handleModelDefault(ctx: ModelCommandContext): ModelCommandResult {
  const parts = ctx.input.trim().split(/\s+/);
  const modelId = parts[1]?.toLowerCase();
  const currentModel = ctx.settings.model;
  const currentEntry = MODEL_CATALOG.find((m) => m.id === currentModel);
  const currentDisplay = currentEntry?.displayName ?? currentModel;

  if (!modelId) {
    return {
      message: `Usage: /model-default <model-id>. Current default: ${currentDisplay} (${currentModel}).`,
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!entry) {
    return {
      message: `Unknown model '${modelId}'. Use /model to see available models.`,
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  if (modelId === currentModel) {
    return {
      message: `${entry.displayName} is already the default model.`,
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  const keyOk = hasKeyForProvider(ctx.settings, entry.provider);
  let message = `✅ Default model set to ${entry.displayName} (${entry.id}).`;
  if (!keyOk) {
    message += `\nWarning: No API key configured for ${entry.provider}. This model won't work until you configure one with /model-add ${entry.provider} or /model-key ${entry.provider}.`;
  }

  const settings = readSettings() ?? {};
  settings.model = modelId;
  writeSettings(settings);

  return { message, needsMoreInput: false, settingsChanged: true };
}

export function handleModelKey(ctx: ModelCommandContext): ModelCommandResult {
  const ws = (ctx.wizardState ?? {}) as Record<string, unknown>;
  const step = (ws.step as string) || "init";
  const parts = ctx.input.trim().split(/\s+/);
  const provider = (ws.provider as string) || parts[1]?.toLowerCase() || "";

  if (step === "init") {
    if (!provider) {
      const configured = Object.keys(ctx.settings.engines).filter((p) => ctx.settings.engines[p]?.apiKey);
      return {
        message: `Usage: /model-key <provider>. Configured providers: ${configured.length > 0 ? configured.join(", ") : "none"}.`,
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    if (!MODEL_CATALOG.some((m) => m.provider === provider)) {
      const valid = [...new Set(MODEL_CATALOG.map((m) => m.provider))].join(", ");
      return {
        message: `Unknown provider '${provider}'. Valid providers: ${valid}.`,
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    if (!ctx.settings.engines[provider]) {
      const envVar = `DEEPCODE_ENGINE_${provider.toUpperCase()}_API_KEY`;
      const envHint = process.env[envVar]
        ? `\nNote: ${provider} may have a key set via environment variable ${envVar}. Setting a key in settings.json will override the env var.`
        : "";
      return {
        message: `Provider '${provider}' is not configured. Use /model-add ${provider} first.${envHint}`,
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    // Show current key status
    const settings = readSettings();
    const rawKey = settings?.engines?.[provider]?.apiKey;
    let currentStatus: string;
    if (rawKey) {
      if (isEncryptedCredential(rawKey)) {
        try {
          const decrypted = decryptCredential(rawKey, provider);
          currentStatus = `Current key: ${maskKey(decrypted)}`;
        } catch {
          currentStatus = "Current key: encrypted (cannot decrypt — keyfile may be missing).";
        }
      } else {
        currentStatus = `Current key: ${maskKey(rawKey)}`;
      }
    } else if (ctx.settings.engines[provider]?.apiKey) {
      currentStatus = `Current key: set via environment variable DEEPCODE_ENGINE_${provider.toUpperCase()}_API_KEY.`;
    } else {
      currentStatus = "Current key: not set.";
    }

    return {
      message: `${currentStatus}\nEnter new API key (or ESC to cancel):`,
      needsMoreInput: true,
      wizardState: { step: "enterKey", provider },
      settingsChanged: false,
    };
  }

  if (step === "enterKey") {
    const apiKey = ctx.input.trim();
    if (!apiKey || apiKey.length < 8) {
      return {
        message: "API key must be at least 8 characters.",
        needsMoreInput: true,
        wizardState: { ...ws },
        settingsChanged: false,
      };
    }

    const encrypted = encryptCredential(apiKey, provider);
    const settings = readSettings() ?? {};
    settings.engines = settings.engines ?? {};
    const existing = settings.engines[provider] ?? {};
    settings.engines[provider] = { ...existing, apiKey: encrypted, apiKeyEncrypted: true };
    writeSettings(settings);

    return {
      message: `✅ API key for ${provider} updated. ${maskKey(apiKey)}`,
      needsMoreInput: false,
      settingsChanged: true,
    };
  }

  return { message: "Unexpected wizard state.", needsMoreInput: false, settingsChanged: false };
}

export function handleModelParams(ctx: ModelCommandContext): ModelCommandResult {
  const ws = (ctx.wizardState ?? {}) as Record<string, unknown>;
  const step = (ws.step as string) || "init";

  if (step === "init") {
    const modelEntry = MODEL_CATALOG.find((m) => m.id === ctx.settings.model);
    const modelMaxOutput = modelEntry?.maxOutput ?? 131072;
    const temperature = ctx.settings.temperature ?? 1.0;
    const maxTokens = ctx.settings.maxTokens ?? modelMaxOutput;
    const topP = ctx.settings.topP;

    const lines = [
      "Current generation parameters:",
      `  Temperature:  ${temperature} (range: 0.0–2.0)`,
      `  Max Tokens:   ${maxTokens} (range: 1–${modelMaxOutput})`,
      `  Top P:        ${topP !== undefined ? topP : "not set"} (range: 0.0–1.0, or "not set")`,
      "",
      "Which parameter? (temperature/max_tokens/top_p) or 'done' to finish:",
    ];

    return {
      message: lines.join("\n"),
      needsMoreInput: true,
      wizardState: {
        step: "chooseParam",
        pending: { temperature, maxTokens, topP },
        currentModel: ctx.settings.model,
        modelMax: modelMaxOutput,
      },
      settingsChanged: false,
    };
  }

  const pending = (ws.pending as Record<string, number | undefined>) ?? {};
  const modelMax = (ws.modelMax as number) ?? 131072;

  if (step === "chooseParam") {
    const choice = ctx.input.trim().toLowerCase();
    if (choice === "done") {
      const settings = readSettings() ?? {};
      settings.temperature = pending.temperature;
      settings.maxTokens = typeof pending.maxTokens === "number" ? Math.round(pending.maxTokens) : undefined;
      settings.topP = pending.topP;
      writeSettings(settings);

      const parts: string[] = [];
      if (pending.temperature !== undefined) parts.push(`temperature=${pending.temperature}`);
      if (pending.maxTokens !== undefined) parts.push(`max_tokens=${pending.maxTokens}`);
      if (pending.topP !== undefined) parts.push(`top_p=${pending.topP}`);
      else parts.push("top_p=not set");

      return {
        message: `✅ Generation parameters updated: ${parts.join(", ")}.`,
        needsMoreInput: false,
        settingsChanged: true,
      };
    }

    if (choice === "temperature" || choice === "max_tokens" || choice === "top_p") {
      const prompts: Record<string, string> = {
        temperature: `Enter temperature (0.0–2.0, current: ${pending.temperature ?? 1.0}):`,
        max_tokens: `Enter max tokens (1–${modelMax}, current: ${pending.maxTokens ?? modelMax}):`,
        top_p: `Enter top_p (0.0–1.0, or 'none' to unset, current: ${pending.topP !== undefined ? pending.topP : "not set"}):`,
      };
      return {
        message: prompts[choice],
        needsMoreInput: true,
        wizardState: { step: "enterValue", param: choice, pending, currentModel: ws.currentModel, modelMax },
        settingsChanged: false,
      };
    }

    return {
      message: "Invalid parameter. Choose temperature, max_tokens, top_p, or 'done'.",
      needsMoreInput: true,
      wizardState: { ...ws },
      settingsChanged: false,
    };
  }

  if (step === "enterValue") {
    const param = (ws.param as string) || "";
    const input = ctx.input.trim();

    if (param === "temperature") {
      const val = parseFloat(input);
      if (isNaN(val) || val < 0 || val > 2) {
        return {
          message: "Temperature must be between 0.0 and 2.0.",
          needsMoreInput: true,
          wizardState: { ...ws },
          settingsChanged: false,
        };
      }
      pending.temperature = val;
    } else if (param === "max_tokens") {
      const val = parseInt(input, 10);
      if (isNaN(val) || val < 1 || val > modelMax) {
        return {
          message: `Max tokens must be between 1 and ${modelMax}.`,
          needsMoreInput: true,
          wizardState: { ...ws },
          settingsChanged: false,
        };
      }
      pending.maxTokens = val;
    } else if (param === "top_p") {
      if (input === "none") {
        pending.topP = undefined;
      } else {
        const val = parseFloat(input);
        if (isNaN(val) || val < 0 || val > 1) {
          return {
            message: "Top P must be between 0.0 and 1.0, or 'none' to unset.",
            needsMoreInput: true,
            wizardState: { ...ws },
            settingsChanged: false,
          };
        }
        pending.topP = val;
      }
    }

    const lines = [
      "Current generation parameters:",
      `  Temperature:  ${pending.temperature ?? 1.0} (range: 0.0–2.0)`,
      `  Max Tokens:   ${pending.maxTokens ?? modelMax} (range: 1–${modelMax})`,
      `  Top P:        ${pending.topP !== undefined ? pending.topP : "not set"} (range: 0.0–1.0, or "not set")`,
      "",
      "Which parameter? (temperature/max_tokens/top_p) or 'done' to finish:",
    ];

    return {
      message: lines.join("\n"),
      needsMoreInput: true,
      wizardState: { step: "chooseParam", pending, currentModel: ws.currentModel, modelMax },
      settingsChanged: false,
    };
  }

  return { message: "Unexpected wizard state.", needsMoreInput: false, settingsChanged: false };
}

export function handleModelThinking(ctx: ModelCommandContext): ModelCommandResult {
  const ws = (ctx.wizardState ?? {}) as Record<string, unknown>;
  const step = (ws.step as string) || "init";

  if (step === "init") {
    const parts = ctx.input.trim().split(/\s+/);
    const modelId = parts[1]?.toLowerCase();
    if (!modelId) {
      return {
        message: `Usage: /model-thinking <model-id>. Models with configurable thinking budget: ${listExtendedThinkingModels()}.`,
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    const entry = MODEL_CATALOG.find((m) => m.id === modelId);
    if (!entry) {
      return {
        message: `Unknown model '${modelId}'. Use /model to see available models.`,
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    if (entry.reasoning.type !== "extended") {
      return {
        message: `Model '${entry.displayName}' has reasoning type '${entry.reasoning.type}'. Thinking budget is only configurable for extended thinking models. Models with configurable budgets: ${listExtendedThinkingModels()}.`,
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    const currentBudget = ctx.settings.thinkingBudgets[modelId] ?? entry.reasoning.budgetTokens ?? 8192;
    const maxOutput = entry.maxOutput;

    return {
      message: `Current thinking budget: ${currentBudget} tokens\nMax output tokens: ${maxOutput}\n\nEnter thinking budget in tokens (1024–${maxOutput}, or ENTER for default 8192):`,
      needsMoreInput: true,
      wizardState: { step: "enterBudget", modelId, maxOutput, displayName: entry.displayName },
      settingsChanged: false,
    };
  }

  if (step === "enterBudget") {
    const modelId = (ws.modelId as string) || "";
    const maxOutput = (ws.maxOutput as number) || 131072;
    const displayName = (ws.displayName as string) || modelId;
    const input = ctx.input.trim();

    let budget: number;
    if (!input) {
      budget = 8192;
    } else {
      budget = parseInt(input, 10);
      if (isNaN(budget) || budget < 1024 || budget > maxOutput) {
        return {
          message: `Budget must be between 1024 and ${maxOutput}.`,
          needsMoreInput: true,
          wizardState: { ...ws },
          settingsChanged: false,
        };
      }
    }

    const settings = readSettings() ?? {};
    settings.thinkingBudgets = settings.thinkingBudgets ?? {};
    settings.thinkingBudgets[modelId] = budget;
    writeSettings(settings);

    return {
      message: `✅ Thinking budget for ${displayName} set to ${budget} tokens.`,
      needsMoreInput: false,
      settingsChanged: true,
    };
  }

  return { message: "Unexpected wizard state.", needsMoreInput: false, settingsChanged: false };
}
