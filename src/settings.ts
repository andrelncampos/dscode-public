import { defaultsToThinkingMode, type ModelPricing } from "./common/model-capabilities";
import { deepcodingSettingsSchema, formatZodErrors, type EngineEntry } from "./common/settings-schema";
import { getUserDscodeDir, getProjectDscodeDir } from "./common/dscode-paths";
import { resolveMemorySettings } from "./memory/memory-settings";
import type { MemorySettings } from "./memory/turn-transcript-types";
import { atomicWriteJsonFileSync } from "./common/file-utils";
import { isEncryptedCredential, decryptCredential, encryptCredential } from "./common/credential-vault";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type DeepcodingEnv = Record<string, string | undefined> & {
  MODEL?: string;
  BASE_URL?: string;
  API_KEY?: string;
  TEMPERATURE?: string;
  THINKING_ENABLED?: string;
  REASONING_EFFORT?: string;
  DEBUG_LOG_ENABLED?: string;
  TELEMETRY_ENABLED?: string;
  MAX_TOKENS?: string;
};

import type { ThinkingEffort } from "./common/model-catalog";
export type { ThinkingEffort };
/** @deprecated Use ThinkingEffort instead. */
export type ReasoningEffort = ThinkingEffort;

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type PermissionScope =
  | "read-in-cwd"
  | "read-out-cwd"
  | "write-in-cwd"
  | "write-out-cwd"
  | "delete-in-cwd"
  | "delete-out-cwd"
  | "query-git-log"
  | "mutate-git-log"
  | "network"
  | "mcp";

export type PermissionDefaultMode = "allowAll" | "askAll";

export type PermissionSettings = {
  allow?: PermissionScope[];
  deny?: PermissionScope[];
  ask?: PermissionScope[];
  defaultMode?: PermissionDefaultMode;
};

export type BudgetSettings = {
  dailyLimit?: number;
  monthlyLimit?: number;
};

export type DeepcodingSettings = {
  env?: DeepcodingEnv;
  model?: string;
  temperature?: number;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  debugLogEnabled?: boolean;
  telemetryEnabled?: boolean;
  maxTokens?: number;
  notify?: string;
  mcpServers?: Record<string, McpServerConfig>;
  engines?: Record<string, EngineEntry>;
  permissions?: PermissionSettings;
  modelPricing?: Record<string, ModelPricing>;
  memory?: Partial<MemorySettings>;
  budget?: BudgetSettings;
  terminalTitleTemplate?: string;
  topP?: number;
  thinkingBudgets?: Record<string, number>;
};

export type ResolvedDeepcodingSettings = {
  env: Record<string, string>;
  apiKey?: string;
  baseURL: string;
  model: string;
  temperature?: number;
  thinkingEnabled: boolean;
  reasoningEffort: ThinkingEffort;
  debugLogEnabled: boolean;
  telemetryEnabled: boolean;
  maxTokens: number;
  notify?: string;
  mcpServers?: Record<string, McpServerConfig>;
  engines: Record<string, EngineEntry>;
  permissions: Required<PermissionSettings>;
  modelPricing?: Record<string, ModelPricing>;
  memory: MemorySettings;
  budget: BudgetSettings;
  terminalTitleTemplate?: string;
  topP?: number;
  thinkingBudgets: Record<string, number>;
};

export type ModelConfigSelection = {
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: ThinkingEffort;
};

export type SettingsProcessEnv = Record<string, string | undefined>;

function resolveApiKey(rawKey: string | undefined, engineName: string): string | undefined {
  if (!rawKey) return undefined;
  if (isEncryptedCredential(rawKey)) {
    return decryptCredential(rawKey, engineName);
  }
  return rawKey;
}

function resolveReasoningEffort(value: unknown): ThinkingEffort | undefined {
  if (typeof value !== "string") return undefined;
  const valid = new Set<string>(["none", "low", "medium", "high", "max", "xhigh"]);
  return valid.has(value) ? (value as ThinkingEffort) : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "enabled", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "disabled", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseTemperature(value: unknown): number | undefined {
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw < 0 || raw > 2) {
    return undefined;
  }
  return raw;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const VALID_PERMISSION_SCOPES = new Set<PermissionScope>([
  "read-in-cwd",
  "read-out-cwd",
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "mcp",
]);

function normalizePermissionList(value: unknown): PermissionScope[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: PermissionScope[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !VALID_PERMISSION_SCOPES.has(item as PermissionScope)) {
      continue;
    }
    const scope = item as PermissionScope;
    if (!result.includes(scope)) {
      result.push(scope);
    }
  }
  return result;
}

function mergePermissionLists(...lists: Array<PermissionScope[] | undefined>): PermissionScope[] {
  const result: PermissionScope[] = [];
  for (const list of lists) {
    for (const scope of list ?? []) {
      if (!result.includes(scope)) {
        result.push(scope);
      }
    }
  }
  return result;
}

function normalizePermissionDefaultMode(value: unknown): PermissionDefaultMode | undefined {
  return value === "allowAll" || value === "askAll" ? value : undefined;
}

function normalizePermissions(settings: PermissionSettings | null | undefined): Required<PermissionSettings> {
  return {
    allow: normalizePermissionList(settings?.allow),
    deny: normalizePermissionList(settings?.deny),
    ask: normalizePermissionList(settings?.ask),
    defaultMode: normalizePermissionDefaultMode(settings?.defaultMode) ?? "allowAll",
  };
}

function mergePermissions(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined
): Required<PermissionSettings> {
  const userPermissions = normalizePermissions(userSettings?.permissions);
  const projectPermissions = normalizePermissions(projectSettings?.permissions);
  return {
    allow: mergePermissionLists(userPermissions.allow, projectPermissions.allow),
    deny: mergePermissionLists(userPermissions.deny, projectPermissions.deny),
    ask: mergePermissionLists(userPermissions.ask, projectPermissions.ask),
    defaultMode: projectSettings?.permissions
      ? projectPermissions.defaultMode
      : userSettings?.permissions
        ? userPermissions.defaultMode
        : "allowAll",
  };
}

function normalizeEnv(env: DeepcodingSettings["env"]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!env) {
    return result;
  }

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

export function collectDeepcodeEnv(processEnv: SettingsProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (!key.startsWith("DEEPCODE_") || typeof value !== "string") {
      continue;
    }
    const strippedKey = key.slice("DEEPCODE_".length);
    if (strippedKey) {
      result[strippedKey] = value;
    }
  }
  return result;
}

function collectEngineEnv(processEnv: SettingsProcessEnv): Record<string, { apiKey?: string; baseURL?: string }> {
  const engines: Record<string, { apiKey?: string; baseURL?: string }> = {};
  const prefix = "DEEPCODE_ENGINE_";
  const apiKeySuffix = "_API_KEY";
  const baseUrlSuffix = "_BASE_URL";
  for (const [key, value] of Object.entries(processEnv)) {
    if (!key.startsWith(prefix) || typeof value !== "string" || !value) continue;
    const rest = key.slice(prefix.length);
    // Match known field suffixes (they may contain underscores, e.g. API_KEY, BASE_URL)
    if (rest.endsWith(apiKeySuffix)) {
      const engineName = rest.slice(0, rest.length - apiKeySuffix.length).toLowerCase();
      if (!engineName) continue;
      engines[engineName] ??= {};
      engines[engineName].apiKey = value;
    } else if (rest.endsWith(baseUrlSuffix)) {
      const engineName = rest.slice(0, rest.length - baseUrlSuffix.length).toLowerCase();
      if (!engineName) continue;
      engines[engineName] ??= {};
      engines[engineName].baseURL = value;
    }
  }
  return engines;
}

function extractMcpEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("MCP_")) {
      continue;
    }
    const strippedKey = key.slice("MCP_".length);
    if (strippedKey) {
      result[strippedKey] = value;
    }
  }
  return result;
}

function mergeMcpServers(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined,
  userEnv: Record<string, string>,
  projectEnv: Record<string, string>,
  systemEnv: Record<string, string>
): Record<string, McpServerConfig> | undefined {
  const userServers = userSettings?.mcpServers ?? {};
  const projectServers = projectSettings?.mcpServers ?? {};
  const serverNames = new Set([...Object.keys(userServers), ...Object.keys(projectServers)]);
  if (serverNames.size === 0) {
    return undefined;
  }

  const userMcpEnv = extractMcpEnv(userEnv);
  const projectMcpEnv = extractMcpEnv(projectEnv);
  const systemMcpEnv = extractMcpEnv(systemEnv);
  const merged: Record<string, McpServerConfig> = {};

  for (const name of serverNames) {
    const userConfig = userServers[name];
    const projectConfig = projectServers[name];
    const command = projectConfig?.command ?? userConfig?.command;
    if (!command) {
      continue;
    }

    const env = {
      ...userEnv,
      ...(userConfig?.env ?? {}),
      ...userMcpEnv,
      ...projectEnv,
      ...(projectConfig?.env ?? {}),
      ...projectMcpEnv,
      ...systemEnv,
      ...systemMcpEnv,
    };
    const config: McpServerConfig = {
      command,
      args: projectConfig?.args ?? userConfig?.args,
    };
    if (Object.keys(env).length > 0) {
      config.env = env;
    }
    merged[name] = config;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 1 ? Math.round(value) : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : undefined;
  }
  return undefined;
}

export function resolveSettingsSources(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined,
  defaults: { model: string; baseURL: string },
  processEnv: SettingsProcessEnv = process.env
): ResolvedDeepcodingSettings {
  const userEnv = normalizeEnv(userSettings?.env);
  const projectEnv = normalizeEnv(projectSettings?.env);
  const systemEnv = collectDeepcodeEnv(processEnv);
  const env = {
    ...userEnv,
    ...projectEnv,
    ...systemEnv,
  };

  const engines = {
    ...(userSettings?.engines ?? {}),
    ...(projectSettings?.engines ?? {}),
    ...collectEngineEnv(processEnv),
  };

  // Decrypt any encrypted API keys in engine configs
  for (const [engineName, config] of Object.entries(engines)) {
    if (config.apiKey) {
      config.apiKey = resolveApiKey(config.apiKey, engineName);
    }
  }

  const model =
    trimString(systemEnv.MODEL) ||
    trimString(projectSettings?.model) ||
    trimString(projectEnv.MODEL) ||
    trimString(userSettings?.model) ||
    trimString(userEnv.MODEL) ||
    defaults.model;

  const thinkingEnabled =
    parseBoolean(systemEnv.THINKING_ENABLED) ??
    parseBoolean(projectSettings?.thinkingEnabled) ??
    parseBoolean(projectEnv.THINKING_ENABLED) ??
    parseBoolean(userSettings?.thinkingEnabled) ??
    parseBoolean(userEnv.THINKING_ENABLED) ??
    defaultsToThinkingMode(model);

  const reasoningEffort =
    resolveReasoningEffort(systemEnv.REASONING_EFFORT) ??
    resolveReasoningEffort(projectSettings?.reasoningEffort) ??
    resolveReasoningEffort(projectEnv.REASONING_EFFORT) ??
    resolveReasoningEffort(userSettings?.reasoningEffort) ??
    resolveReasoningEffort(userEnv.REASONING_EFFORT) ??
    (model === "deepseek-v4-pro" ? "max" : "high");

  const temperature =
    parseTemperature(systemEnv.TEMPERATURE) ??
    parseTemperature(projectSettings?.temperature) ??
    parseTemperature(projectEnv.TEMPERATURE) ??
    parseTemperature(userSettings?.temperature) ??
    parseTemperature(userEnv.TEMPERATURE);

  const debugLogEnabled =
    parseBoolean(systemEnv.DEBUG_LOG_ENABLED) ??
    parseBoolean(projectSettings?.debugLogEnabled) ??
    parseBoolean(projectEnv.DEBUG_LOG_ENABLED) ??
    parseBoolean(userSettings?.debugLogEnabled) ??
    parseBoolean(userEnv.DEBUG_LOG_ENABLED) ??
    false;

  const telemetryEnabled =
    parseBoolean(systemEnv.TELEMETRY_ENABLED) ??
    parseBoolean(projectSettings?.telemetryEnabled) ??
    parseBoolean(projectEnv.TELEMETRY_ENABLED) ??
    parseBoolean(userSettings?.telemetryEnabled) ??
    parseBoolean(userEnv.TELEMETRY_ENABLED) ??
    false;

  const maxTokens =
    parsePositiveInt(systemEnv.MAX_TOKENS) ??
    parsePositiveInt(projectSettings?.maxTokens) ??
    parsePositiveInt(projectEnv.MAX_TOKENS) ??
    parsePositiveInt(userSettings?.maxTokens) ??
    parsePositiveInt(userEnv.MAX_TOKENS) ??
    (model === "deepseek-v4-pro"
      ? 131072
      : model.startsWith("deepseek-") || model.startsWith("claude-") || model.startsWith("gpt-")
        ? 65536
        : 32768);

  const notify =
    trimString(systemEnv.NOTIFY) || trimString(projectSettings?.notify) || trimString(userSettings?.notify) || "";

  const memory: MemorySettings = resolveMemorySettings(projectSettings?.memory ?? userSettings?.memory);

  const budget: BudgetSettings = {
    dailyLimit: projectSettings?.budget?.dailyLimit ?? userSettings?.budget?.dailyLimit,
    monthlyLimit: projectSettings?.budget?.monthlyLimit ?? userSettings?.budget?.monthlyLimit,
  };

  const terminalTitleTemplate =
    trimString(projectSettings?.terminalTitleTemplate) ||
    trimString(userSettings?.terminalTitleTemplate) ||
    DEFAULT_SETTINGS.terminalTitleTemplate;

  const topP = projectSettings?.topP ?? userSettings?.topP;

  const thinkingBudgets = projectSettings?.thinkingBudgets ?? userSettings?.thinkingBudgets ?? {};

  return {
    env,
    apiKey: trimString(env.API_KEY) || undefined,
    baseURL: trimString(env.BASE_URL) || defaults.baseURL,
    model,
    temperature,
    thinkingEnabled,
    reasoningEffort,
    debugLogEnabled,
    telemetryEnabled,
    maxTokens,
    notify: notify || undefined,
    mcpServers: mergeMcpServers(userSettings, projectSettings, userEnv, projectEnv, systemEnv),
    engines,
    permissions: mergePermissions(userSettings, projectSettings),
    modelPricing: projectSettings?.modelPricing ?? userSettings?.modelPricing,
    memory,
    budget,
    terminalTitleTemplate,
    topP,
    thinkingBudgets,
  };
}

export function resolveSettings(
  settings: DeepcodingSettings | null | undefined,
  defaults: { model: string; baseURL: string },
  processEnv: SettingsProcessEnv = process.env
): ResolvedDeepcodingSettings {
  return resolveSettingsSources(settings, null, defaults, processEnv);
}

export function modelConfigKey(config: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">): string {
  return config.thinkingEnabled ? `thinking:${config.reasoningEffort}` : "thinking:none";
}

export function applyModelConfigSelection(
  settings: DeepcodingSettings | null | undefined,
  current: ModelConfigSelection,
  selected: ModelConfigSelection
): { settings: DeepcodingSettings; changed: boolean } {
  const changed = selected.model !== current.model || modelConfigKey(selected) !== modelConfigKey(current);
  const next: DeepcodingSettings = { ...(settings ?? {}) };

  if (!changed) {
    return { settings: next, changed: false };
  }

  if (selected.model !== current.model || Object.hasOwn(next, "model")) {
    next.model = selected.model;
  } else {
    delete next.model;
  }

  next.thinkingEnabled = selected.thinkingEnabled;
  if (selected.thinkingEnabled) {
    next.reasoningEffort = selected.reasoningEffort;
  }

  return { settings: next, changed: true };
}

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "deepseek-v4-pro";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";

/**
 * Canonical default settings with ALL recognised keys populated.
 * Used as the reference to fill missing keys in user/project settings files
 * and as documentation of every supported setting.
 */
export const DEFAULT_SETTINGS: DeepcodingSettings = {
  env: {},
  model: DEFAULT_MODEL,
  maxTokens: 131072,
  thinkingEnabled: true,
  reasoningEffort: "max",
  debugLogEnabled: false,
  telemetryEnabled: false,
  permissions: {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "allowAll",
  },
  memory: {
    enabled: true,
    mode: "turn-transcript",
    recentTurns: 10,
    maxTurnFiles: 500,
    maxContextChars: 30000,
    maxUserCharsPerTurn: 6000,
    maxAssistantCharsPerTurn: 8000,
    maxStdoutCharsPerTurn: 4000,
    maxStderrCharsPerTurn: 6000,
    maxDiffCharsPerTurn: 8000,
    compression: "zstd",
    compressionLevel: 10,
    stripAnsi: true,
    collapseWhitespace: true,
    dedupeRepeatedLines: true,
    storeTurnTranscripts: true,
  },
  budget: {},
  mcpServers: {},
  engines: {},
  modelPricing: {
    "deepseek-v4-pro": { inputPrice: 0.435, outputPrice: 0.87, cacheReadPrice: 0.003625 },
    "deepseek-v4-flash": { inputPrice: 0.14, outputPrice: 0.28, cacheReadPrice: 0.0028 },
  },
  terminalTitleTemplate: "DsCode - {{cwd}}",
};

// ---------------------------------------------------------------------------
// Settings file I/O
// ---------------------------------------------------------------------------

export function getUserSettingsPath(): string {
  return path.join(getUserDscodeDir(), "settings.json");
}

export function getProjectSettingsPath(projectRoot: string): string {
  return path.join(getProjectDscodeDir(projectRoot), "settings.json");
}

/**
 * Ensure a settings object has all canonical keys, filling in missing ones
 * from DEFAULT_SETTINGS.  Existing values are never overwritten.
 *
 * Nested objects under `permissions`, `memory`, and `budget` are merged
 * shallowly so that individual sub-keys (e.g. permissions.defaultMode)
 * are filled when missing.
 */
export function ensureSettingsDefaults(settings: DeepcodingSettings): DeepcodingSettings {
  const result = { ...settings };

  // Fill missing top-level keys
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof DeepcodingSettings>) {
    if (!(key in result)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = DEFAULT_SETTINGS[key];
    }
  }

  // Shallow-merge known nested objects so their sub-keys are also guaranteed.
  if (result.permissions) {
    result.permissions = { ...DEFAULT_SETTINGS.permissions, ...result.permissions };
  }
  if (result.memory) {
    result.memory = { ...DEFAULT_SETTINGS.memory, ...result.memory };
  }
  if (result.budget) {
    result.budget = { ...DEFAULT_SETTINGS.budget, ...result.budget };
  }
  if (result.modelPricing) {
    result.modelPricing = { ...DEFAULT_SETTINGS.modelPricing, ...result.modelPricing };
  }

  return result;
}

/**
 * Read, validate, and fill in defaults for an on-disk settings file.
 * Writes the enriched settings back if any keys were added.
 */
function readSettingsAndEnsureDefaults(settingsPath: string): DeepcodingSettings | null {
  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw);

    const result = deepcodingSettingsSchema.safeParse(parsed);

    if (!result.success) {
      const errorMessage = formatZodErrors(result.error, settingsPath);
      process.stderr.write(errorMessage + "\n");
      // Zod strictObject rejects unrecognized keys entirely — result.data is typically undefined.
      // Fall back to extracting known fields from the raw parsed JSON so critical settings
      // like env.API_KEY are not lost.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const partial = (result as any).data as DeepcodingSettings | undefined;
      if (partial && Object.keys(partial).length > 0) {
        return partial;
      }
      // Manually extract known settings keys from the raw parsed JSON.
      const rawObj = parsed as Record<string, unknown>;
      const rescued: DeepcodingSettings = {};
      const KNOWN_KEYS = new Set(Object.keys(deepcodingSettingsSchema.shape));
      for (const key of Object.keys(rawObj)) {
        if (KNOWN_KEYS.has(key)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rescued as any)[key] = rawObj[key];
        }
      }
      return Object.keys(rescued).length > 0 ? rescued : null;
    }

    const validated = result.data as DeepcodingSettings;
    const enriched = ensureSettingsDefaults(validated);

    // Write back only if keys were actually added
    if (Object.keys(enriched).length > Object.keys(validated).length) {
      try {
        atomicWriteJsonFileSync(settingsPath, enriched);
      } catch {
        // Non-fatal — the in-memory enriched settings will be used regardless.
      }
    }

    return enriched;
  } catch (error) {
    if (error instanceof SyntaxError) {
      process.stderr.write(`\x1b[31mInvalid JSON in settings file: ${settingsPath}\n  ${error.message}\x1b[0m\n`);
    }
    return null;
  }
}

export function readSettingsFile(settingsPath: string): DeepcodingSettings | null {
  // Delegate to the ensure-defaults variant.  This also transparently upgrades
  // any settings.json that was written before a key was introduced.
  return readSettingsAndEnsureDefaults(settingsPath);
}

export function readSettings(): DeepcodingSettings | null {
  const settings = readSettingsFile(getUserSettingsPath());
  if (settings) return settings;
  // Fall back to legacy .deepcode path so existing users are not broken.
  return readSettingsFile(path.join(os.homedir(), ".deepcode", "settings.json"));
}

export function readProjectSettings(projectRoot: string = process.cwd()): DeepcodingSettings | null {
  const settings = readSettingsFile(getProjectSettingsPath(projectRoot));
  if (settings) return settings;
  // Fall back to legacy .deepcode path so existing users are not broken.
  return readSettingsFile(path.join(projectRoot, ".deepcode", "settings.json"));
}

function encryptApiKeys(settings: DeepcodingSettings): DeepcodingSettings {
  if (!settings.engines) return settings;
  const engines = { ...settings.engines };
  for (const [name, config] of Object.entries(engines)) {
    if (config.apiKey && !isEncryptedCredential(config.apiKey)) {
      engines[name] = {
        ...config,
        apiKey: encryptCredential(config.apiKey, name),
        apiKeyEncrypted: true,
      };
    }
  }
  return { ...settings, engines };
}

function writeSettingsFile(settingsPath: string, settings: DeepcodingSettings): void {
  settings = encryptApiKeys(settings);
  atomicWriteJsonFileSync(settingsPath, settings);
}

export function writeSettings(settings: DeepcodingSettings): void {
  const settingsPath = getUserSettingsPath();
  writeSettingsFile(settingsPath, settings);
  clearSettingsCache();
}

export function writeProjectSettings(settings: DeepcodingSettings, projectRoot: string = process.cwd()): void {
  const settingsPath = getProjectSettingsPath(projectRoot);
  writeSettingsFile(settingsPath, settings);
  clearSettingsCache(projectRoot);
}

export function writeModelConfigSelection(
  selection: ModelConfigSelection,
  current: ModelConfigSelection = resolveCurrentSettings(),
  projectRoot: string = process.cwd()
): { changed: boolean; settings: DeepcodingSettings } {
  const projectSettingsPath = getProjectSettingsPath(projectRoot);
  const shouldWriteProjectSettings = fs.existsSync(projectSettingsPath);
  const rawSettings = shouldWriteProjectSettings ? readProjectSettings(projectRoot) : readSettings();
  const result = applyModelConfigSelection(rawSettings, current, selection);
  if (result.changed) {
    if (shouldWriteProjectSettings) {
      writeProjectSettings(result.settings, projectRoot);
    } else {
      writeSettings(result.settings);
    }
  }
  return result;
}

// ── Settings cache with mtime-based invalidation ─────────────────────

type SettingsCacheEntry = {
  mtimeMs: number;
  resolved: ResolvedDeepcodingSettings;
};

const settingsCache = new Map<string, SettingsCacheEntry>();

function getSettingsMaxMtime(userSettingsPath: string, projectSettingsPath: string): number {
  let maxMtime = 0;
  try {
    const userStat = fs.statSync(userSettingsPath);
    maxMtime = Math.max(maxMtime, userStat.mtimeMs);
  } catch {
    // file doesn't exist
  }
  try {
    const projStat = fs.statSync(projectSettingsPath);
    maxMtime = Math.max(maxMtime, projStat.mtimeMs);
  } catch {
    // file doesn't exist
  }
  return maxMtime;
}

export function resolveCurrentSettings(projectRoot: string = process.cwd()): ResolvedDeepcodingSettings {
  const userSettingsPath = getUserSettingsPath();
  const projectSettingsPath = getProjectSettingsPath(projectRoot);
  const currentMtime = getSettingsMaxMtime(userSettingsPath, projectSettingsPath);

  const cached = settingsCache.get(projectRoot);
  if (cached && cached.mtimeMs >= currentMtime) {
    return cached.resolved;
  }

  const resolved = resolveSettingsSources(
    readSettings(),
    readProjectSettings(projectRoot),
    {
      model: DEFAULT_MODEL,
      baseURL: DEFAULT_BASE_URL,
    },
    process.env
  );

  settingsCache.set(projectRoot, { mtimeMs: currentMtime, resolved });
  return resolved;
}

/** Clear the in-memory settings cache (useful after writing new settings). */
export function clearSettingsCache(projectRoot?: string): void {
  if (projectRoot) {
    settingsCache.delete(projectRoot);
  } else {
    settingsCache.clear();
  }
}
