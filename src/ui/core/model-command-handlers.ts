import type { ResolvedDeepcodingSettings } from "../../settings";
import type { ModelEntry } from "../../common/model-catalog";
import type { I18nTFunction } from "../../i18n/translate";
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
  t: I18nTFunction;
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
  const { catalog, settings, t } = ctx;
  if (catalog.length === 0) {
    return { message: t("model.no-models-in-catalog"), needsMoreInput: false, settingsChanged: false };
  }

  const providers = [...new Set(catalog.map((m) => m.provider))];
  const lines: string[] = [];

  for (const provider of providers) {
    const models = getProviderModels(catalog, provider);
    const keyOk = hasKeyForProvider(settings, provider);
    const keyStatus = keyOk ? t("model.status-key") : t("model.status-no-key");
    const baseUrl =
      settings.engines[provider]?.baseURL || PROVIDER_DEFAULT_BASE_URLS[provider] || t("model.unknown-base-url");
    const prices = models
      .map((m) => DEFAULT_MODEL_PRICING[m.id]?.inputPrice)
      .filter((p): p is number => p !== undefined);
    const priceRange =
      prices.length > 0
        ? `$${Math.min(...prices).toFixed(2)}–$${Math.max(...prices).toFixed(2)}/1M`
        : t("model.status-no-pricing");

    lines.push(t("model.format-section-header", { provider }));
    const keyIcon = keyOk ? "✅" : "❌";
    lines.push(
      t("model.format-provider-line", {
        keyStatus: `${keyIcon} ${keyStatus}`,
        baseUrl,
        modelCount: String(models.length),
        priceRange,
      })
    );
    for (const m of models) {
      const pData = DEFAULT_MODEL_PRICING[m.id];
      const priceStr = pData ? `$${pData.inputPrice}/${pData.outputPrice}` : t("model.status-no-pricing");
      lines.push(
        t("model.format-model-line", {
          modelId: m.id.padEnd(22),
          displayName: m.displayName.padEnd(20),
          pricing: priceStr,
        })
      );
    }
    lines.push("");
  }

  return { message: lines.join("\n").trimEnd(), needsMoreInput: false, settingsChanged: false };
}

export function handleModelAdd(ctx: ModelCommandContext): ModelCommandResult {
  const { t } = ctx;
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
        message: t("model.usage-model-add", {
          providers: unconfigured.length > 0 ? unconfigured.join(", ") : t("model.label-no"),
        }),
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    if (!MODEL_CATALOG.some((m) => m.provider === provName)) {
      const valid = [...new Set(MODEL_CATALOG.map((m) => m.provider))].join(", ");
      return {
        message: t("model.unknown-provider", { provider: provName, valid }),
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    if (hasKeyForProvider(ctx.settings, provName)) {
      return {
        message: t("model.already-configured", { provider: provName }),
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    const defaultBaseUrl = PROVIDER_DEFAULT_BASE_URLS[provName] || "";
    return {
      message: t("model.wizard-base-url", { defaultBaseUrl }),
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
          message: t("model.wizard-invalid-url"),
          needsMoreInput: true,
          wizardState: { ...ws },
          settingsChanged: false,
        };
      }
      return {
        message: t("model.wizard-api-key-prompt", {
          keyUrl: PROVIDER_KEY_URLS[provider] || t("model.unknown-base-url"),
        }),
        needsMoreInput: true,
        wizardState: { step: "apiKey", provider, baseUrl: input, defaultBaseUrl },
        settingsChanged: false,
      };
    }
    return {
      message: t("model.wizard-api-key-prompt", { keyUrl: PROVIDER_KEY_URLS[provider] || t("model.unknown-base-url") }),
      needsMoreInput: true,
      wizardState: { step: "apiKey", provider, baseUrl: defaultBaseUrl, defaultBaseUrl },
      settingsChanged: false,
    };
  }

  if (step === "apiKey") {
    const apiKey = ctx.input.trim();
    if (!apiKey || apiKey.length < 8) {
      return {
        message: t("model.wizard-key-too-short"),
        needsMoreInput: true,
        wizardState: { ...ws },
        settingsChanged: false,
      };
    }
    const baseUrl = (ws.baseUrl as string) || "";
    return {
      message: t("model.wizard-confirm", { provider, baseUrl, maskedKey: maskKey(apiKey) }),
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
        message: t("model.wizard-base-url", { defaultBaseUrl }),
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
      const pData = DEFAULT_MODEL_PRICING[m.id];
      const priceStr = pData ? `$${pData.inputPrice}/$${pData.outputPrice}` : t("model.status-no-pricing");
      return t("model.format-model-line", {
        modelId: m.id.padEnd(22),
        displayName: m.displayName.padEnd(20),
        pricing: priceStr,
      });
    });

    const successLines = [
      t("model.format-provider", { provider }),
      t("model.format-base-url", { baseUrl }),
      t("model.format-api-key", { maskedKey: maskKey(apiKey) }),
      "",
      t("model.format-available-models", { count: String(models.length) }),
      ...modelLines,
      "",
      t("model.format-use-model", { provider }),
    ];

    return { message: successLines.join("\n"), needsMoreInput: false, settingsChanged: true };
  }

  return { message: t("model.wizard-unexpected"), needsMoreInput: false, settingsChanged: false };
}

export function handleModelRemove(ctx: ModelCommandContext): ModelCommandResult {
  const { t } = ctx;
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
        message: t("model.removed", { provider }),
        needsMoreInput: false,
        settingsChanged: true,
      };
    }
    return { message: t("model.cancelled"), needsMoreInput: false, settingsChanged: false };
  }

  const parts = ctx.input.trim().split(/\s+/);
  const provider = parts[1]?.toLowerCase();
  if (!provider) {
    const configured = Object.keys(ctx.settings.engines).filter((p) => ctx.settings.engines[p]?.apiKey);
    return {
      message: t("model.usage-model-remove", {
        configured: configured.length > 0 ? configured.join(", ") : t("model.label-no"),
      }),
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  if (!MODEL_CATALOG.some((m) => m.provider === provider)) {
    const valid = [...new Set(MODEL_CATALOG.map((m) => m.provider))].join(", ");
    return {
      message: t("model.unknown-provider", { provider, valid }),
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  // Check raw settings (not resolved) to see if there's an entry to remove
  const rawSettings = readSettings();
  if (!rawSettings?.engines?.[provider]) {
    return {
      message: t("model.not-configured", { provider }),
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
    warning = t("model.remove-sole-warning", { provider });
  } else if (isCurrentProvider) {
    warning = t("model.remove-current-warning", { model: ctx.settings.model, provider });
  } else {
    warning = t("model.remove-confirm", { provider });
  }

  return {
    message: warning,
    needsMoreInput: true,
    wizardState: { step: "confirmRemove", provider },
    settingsChanged: false,
  };
}

export function handleModelInfo(ctx: ModelCommandContext): ModelCommandResult {
  const { t } = ctx;
  const parts = ctx.input.trim().split(/\s+/);
  const modelId = parts[1]?.toLowerCase();
  if (!modelId) {
    return {
      message: t("model.usage-model-info"),
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  const caps = getModelCapabilities(modelId);
  if (!caps) {
    return {
      message: t("model.unknown-model", { modelId }),
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!entry) {
    return { message: t("model.unknown-model", { modelId }), needsMoreInput: false, settingsChanged: false };
  }

  const keyOk = hasKeyForProvider(ctx.settings, entry.provider);
  const lines = [
    t("model.info-model", { displayName: caps.displayName, id: caps.id }),
    t("model.info-provider", { provider: caps.provider }),
    t("model.info-context", { context: formatTokenCount(caps.contextWindow) }),
    t("model.info-max-output", { maxOutput: formatTokenCount(caps.maxOutput) }),
    t("model.info-multimodal", { multimodal: caps.multimodal ? t("model.label-yes") : t("model.label-no") }),
    t("model.info-thinking", { type: caps.reasoning.type }),
  ];
  if (caps.reasoning.type !== "none") {
    lines.push(t("model.info-default", { effort: caps.reasoning.defaultEffort }));
    if (caps.reasoning.budgetTokens) {
      lines.push(t("model.info-budget", { budget: formatTokenCount(caps.reasoning.budgetTokens) }));
    }
  }
  const pData = caps.pricing;
  if (pData) {
    lines.push(
      t("model.info-pricing", {
        input: String(pData.inputPrice),
        output: String(pData.outputPrice),
        cached: String(pData.cacheReadPrice),
      })
    );
  } else {
    lines.push(t("model.info-pricing-na"));
  }
  lines.push(keyOk ? t("model.info-status-key-ok") : t("model.info-status-no-key"));

  return { message: lines.join("\n"), needsMoreInput: false, settingsChanged: false };
}

export function handleModelDefault(ctx: ModelCommandContext): ModelCommandResult {
  const { t } = ctx;
  const parts = ctx.input.trim().split(/\s+/);
  const modelId = parts[1]?.toLowerCase();
  const currentModel = ctx.settings.model;
  const currentEntry = MODEL_CATALOG.find((m) => m.id === currentModel);
  const currentDisplay = currentEntry?.displayName ?? currentModel;

  if (!modelId) {
    return {
      message: t("model.usage-model-default", { display: currentDisplay, modelId: currentModel }),
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!entry) {
    return {
      message: t("model.unknown-model", { modelId }),
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  if (modelId === currentModel) {
    return {
      message: t("model.already-default", { displayName: entry.displayName }),
      needsMoreInput: false,
      settingsChanged: false,
    };
  }

  const keyOk = hasKeyForProvider(ctx.settings, entry.provider);
  let message = t("model.set-default", { displayName: entry.displayName, modelId: entry.id });
  if (!keyOk) {
    message += "\n" + t("model.no-api-key-warning", { provider: entry.provider });
  }

  const settings = readSettings() ?? {};
  settings.model = modelId;
  writeSettings(settings);

  return { message, needsMoreInput: false, settingsChanged: true };
}

export function handleModelKey(ctx: ModelCommandContext): ModelCommandResult {
  const { t } = ctx;
  const ws = (ctx.wizardState ?? {}) as Record<string, unknown>;
  const step = (ws.step as string) || "init";
  const parts = ctx.input.trim().split(/\s+/);
  const provider = (ws.provider as string) || parts[1]?.toLowerCase() || "";

  if (step === "init") {
    if (!provider) {
      const configured = Object.keys(ctx.settings.engines).filter((p) => ctx.settings.engines[p]?.apiKey);
      return {
        message: t("model.usage-model-key", {
          providers: configured.length > 0 ? configured.join(", ") : t("model.label-no"),
        }),
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    if (!MODEL_CATALOG.some((m) => m.provider === provider)) {
      const valid = [...new Set(MODEL_CATALOG.map((m) => m.provider))].join(", ");
      return {
        message: t("model.unknown-provider", { provider, valid }),
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    if (!ctx.settings.engines[provider]) {
      const envVar = `DEEPCODE_ENGINE_${provider.toUpperCase()}_API_KEY`;
      const envHint = process.env[envVar] ? "\n" + t("model.env-var-hint", { provider, envVar }) : "";
      return {
        message: t("model.provider-unconfigured", { provider }) + envHint,
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    // Show current key status
    const settings = readSettings();
    const rawKey = settings?.engines?.[provider]?.apiKey;
    let currentKeyDisplay: string;
    if (rawKey) {
      if (isEncryptedCredential(rawKey)) {
        try {
          const decrypted = decryptCredential(rawKey, provider);
          currentKeyDisplay = maskKey(decrypted);
        } catch {
          currentKeyDisplay = t("model.key-encrypted");
        }
      } else {
        currentKeyDisplay = maskKey(rawKey);
      }
    } else if (ctx.settings.engines[provider]?.apiKey) {
      currentKeyDisplay = t("model.key-env-var", { providerUpper: provider.toUpperCase() });
    } else {
      currentKeyDisplay = t("model.key-not-set");
    }

    return {
      message: t("model.key-current", { display: currentKeyDisplay }) + "\n" + t("model.wizard-enter-key"),
      needsMoreInput: true,
      wizardState: { step: "enterKey", provider },
      settingsChanged: false,
    };
  }

  if (step === "enterKey") {
    const apiKey = ctx.input.trim();
    if (!apiKey || apiKey.length < 8) {
      return {
        message: t("model.wizard-key-too-short"),
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
      message: t("model.key-updated", { provider, maskedKey: maskKey(apiKey) }),
      needsMoreInput: false,
      settingsChanged: true,
    };
  }

  return { message: t("model.wizard-unexpected"), needsMoreInput: false, settingsChanged: false };
}

export function handleModelParams(ctx: ModelCommandContext): ModelCommandResult {
  const { t } = ctx;
  const ws = (ctx.wizardState ?? {}) as Record<string, unknown>;
  const step = (ws.step as string) || "init";

  if (step === "init") {
    const modelEntry = MODEL_CATALOG.find((m) => m.id === ctx.settings.model);
    const modelMaxOutput = modelEntry?.maxOutput ?? 131072;
    const temperature = ctx.settings.temperature ?? 0.3;
    const maxTokens = ctx.settings.maxTokens ?? modelMaxOutput;
    const topP = ctx.settings.topP;

    const lines = [
      t("model.params-current"),
      t("model.params-temperature", { value: String(temperature) }),
      t("model.params-max-tokens", { value: String(maxTokens), max: String(modelMaxOutput) }),
      t("model.params-top-p", { value: topP !== undefined ? String(topP) : t("model.params-not-set") }),
      "",
      t("model.params-choose"),
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
        message: t("model.params-updated", { params: parts.join(", ") }),
        needsMoreInput: false,
        settingsChanged: true,
      };
    }

    if (choice === "temperature" || choice === "max_tokens" || choice === "top_p") {
      const prompts: Record<string, string> = {
        temperature: t("model.params-enter-temperature", { current: String(pending.temperature ?? 0.3) }),
        max_tokens: t("model.params-enter-max-tokens", {
          max: String(modelMax),
          current: String(pending.maxTokens ?? modelMax),
        }),
        top_p: t("model.params-enter-top-p", {
          current: pending.topP !== undefined ? String(pending.topP) : t("model.params-not-set"),
        }),
      };
      return {
        message: prompts[choice],
        needsMoreInput: true,
        wizardState: { step: "enterValue", param: choice, pending, currentModel: ws.currentModel, modelMax },
        settingsChanged: false,
      };
    }

    return {
      message: t("model.params-invalid-choice"),
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
          message: t("model.params-error-temperature"),
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
          message: t("model.params-error-max-tokens", { max: String(modelMax) }),
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
            message: t("model.params-error-top-p"),
            needsMoreInput: true,
            wizardState: { ...ws },
            settingsChanged: false,
          };
        }
        pending.topP = val;
      }
    }

    const lines = [
      t("model.params-current"),
      t("model.params-temperature", { value: String(pending.temperature ?? 0.3) }),
      t("model.params-max-tokens", { value: String(pending.maxTokens ?? modelMax), max: String(modelMax) }),
      t("model.params-top-p", { value: pending.topP !== undefined ? String(pending.topP) : t("model.params-not-set") }),
      "",
      t("model.params-choose"),
    ];

    return {
      message: lines.join("\n"),
      needsMoreInput: true,
      wizardState: { step: "chooseParam", pending, currentModel: ws.currentModel, modelMax },
      settingsChanged: false,
    };
  }

  return { message: t("model.wizard-unexpected"), needsMoreInput: false, settingsChanged: false };
}

export function handleModelThinking(ctx: ModelCommandContext): ModelCommandResult {
  const { t } = ctx;
  const ws = (ctx.wizardState ?? {}) as Record<string, unknown>;
  const step = (ws.step as string) || "init";

  if (step === "init") {
    const parts = ctx.input.trim().split(/\s+/);
    const modelId = parts[1]?.toLowerCase();
    if (!modelId) {
      return {
        message: t("model.usage-model-thinking", { models: listExtendedThinkingModels() }),
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    const entry = MODEL_CATALOG.find((m) => m.id === modelId);
    if (!entry) {
      return {
        message: t("model.unknown-model", { modelId }),
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    if (entry.reasoning.type !== "extended") {
      return {
        message: t("model.thinking-not-extended", {
          displayName: entry.displayName,
          type: entry.reasoning.type,
          models: listExtendedThinkingModels(),
        }),
        needsMoreInput: false,
        settingsChanged: false,
      };
    }

    const currentBudget = ctx.settings.thinkingBudgets[modelId] ?? entry.reasoning.budgetTokens ?? 8192;
    const maxOutput = entry.maxOutput;

    return {
      message: t("model.thinking-current", {
        budget: String(currentBudget),
        maxOutput: String(maxOutput),
        default: "8192",
      }),
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
          message: t("model.thinking-error-range", { max: String(maxOutput) }),
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
      message: t("model.thinking-updated", { displayName, budget: String(budget) }),
      needsMoreInput: false,
      settingsChanged: true,
    };
  }

  return { message: t("model.wizard-unexpected"), needsMoreInput: false, settingsChanged: false };
}
