import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import matter from "gray-matter";
import ejs from "ejs";
import type { CreateLlmProviderReturn } from "./common/llm-provider-registry";
import { getModelCapabilities } from "./common/model-catalog";
import { DeepSeekProvider } from "./providers/deepseek-provider";
import { launchNotifyScript } from "./common/notify";
import { readTextFileWithMetadata, atomicWriteFileSync, atomicWriteJsonFileSync } from "./common/file-utils";
import {
  buildSkillDocumentsPrompt,
  getCompactPrompt,
  getDefaultSkillPrompt,
  getExtensionRoot,
  getRuntimeContext,
  getSystemPrompt,
  getTools,
  type ToolDefinition,
} from "./prompt";
import {
  ToolExecutor,
  type CreateOpenAIClient,
  type ProcessTimeoutControl,
  type ProcessTimeoutInfo,
  type ToolCall,
  type ToolCallExecution,
  type ToolExecutionHooks,
} from "./tools/executor";
import { McpManager } from "./mcp/mcp-manager";
import { RuntimeReasoningEffortManager } from "./common/reasoning-effort-manager";
import type { BudgetSettings, McpServerConfig, PermissionScope, PermissionSettings, ReasoningEffort } from "./settings";
import { clearSettingsCache } from "./settings";
import { resolveApiTimeoutMs } from "./common/api-timeout";
import { logApiError } from "./common/error-logger";
import { logOpenAIChatCompletionDebug } from "./common/debug-logger";
import { killProcessTree } from "./common/process-tree";
import { GitFileHistory, type FileHistoryCheckpointResult } from "./common/file-history";
import { clearSessionState, getSnippet, rebuildSessionStateFromHistory } from "./common/state";
import {
  appendProjectPermissionAllows,
  buildPermissionToolExecution,
  computeToolCallPermissions,
  hasUserPermissionReplies,
  normalizeAskPermissions,
  parseToolCallForPermissions,
  type AskPermissionRequest,
  type MessageToolPermission,
  type PermissionToolCall,
  type UserToolPermission,
} from "./common/permissions";
import { clearSessionWorkingDir } from "./tools/bash-handler";
import { reportNewPrompt } from "./common/telemetry";
import { OpenAIMessageConverter, type OpenAIMessageConverterOptions } from "./common/openai-message-converter";
import { recordBudgetCost } from "./common/budget-tracker";
import type { ModelPricing } from "./common/model-capabilities";
import { runWithExecCtx } from "./common/execution-context";
import { TerminalTitleManager } from "./common/terminal-title";
import { storeTurn, readRecentTurns } from "./memory/turn-memory-store";
import { buildTurnContext } from "./memory/turn-memory-context-builder";
import { canonicalizeText, canonicalizeShellOutput } from "./memory/turn-canonicalizer";
import type { CanonicalizeOptions } from "./memory/turn-canonicalizer";
import { redactSecrets } from "./memory/turn-secret-redactor";
import type {
  TurnTranscript,
  TurnAction,
  TurnFileRecord,
  TurnErrorRecord,
  MemorySettings,
} from "./memory/turn-transcript-types";

import * as ModelCommandHandlers from "./ui/core/model-command-handlers";
import { MODEL_CATALOG } from "./common/model-catalog";

export type { PermissionScope } from "./settings";
export type {
  AskPermissionRequest,
  AskPermissionScope,
  BashPermissionScope,
  MessageToolPermission,
  PermissionDecision,
  UserToolPermission,
} from "./common/permissions";

const MAX_SESSION_ENTRIES = 50;
const MAX_PROJECT_CODE_LENGTH = 64;
const PROJECT_CODE_HASH_LENGTH = 16;
const BACKGROUND_FAILURE_LOG_TAIL_CHARS = 4000;
const DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD = 384 * 1024;
const DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD = 128 * 1024;

type ChatCompletionDebugOptions = {
  enabled?: boolean;
  location: string;
  baseURL?: string;
  params?: Record<string, unknown>;
};

export function getCompactPromptTokenThreshold(model: string): number {
  if (model.startsWith("deepseek-v4")) {
    return DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD;
  }
  return DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD;
}

// Keep project storage paths short enough for Git's internal files on Windows.
export function getProjectCode(projectRoot: string): string {
  const legacyCode = getLegacyProjectCode(projectRoot);
  if (legacyCode.length <= MAX_PROJECT_CODE_LENGTH) {
    return legacyCode;
  }

  const normalizedRoot = path.resolve(projectRoot);
  const hashInput = process.platform === "win32" ? normalizedRoot.toLowerCase() : normalizedRoot;
  const hash = crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, PROJECT_CODE_HASH_LENGTH);
  const prefixLimit = MAX_PROJECT_CODE_LENGTH - PROJECT_CODE_HASH_LENGTH - 1;
  const basename = path.basename(normalizedRoot);
  const prefix =
    sanitizeProjectCodePart(basename)
      .slice(0, prefixLimit)
      .replace(/[-.]+$/g, "") || "project";
  return `${prefix}-${hash}`;
}

function getLegacyProjectCode(projectRoot: string): string {
  return projectRoot.replace(/[\\/]/g, "-").replace(/:/g, "");
}

function sanitizeProjectCodePart(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

function isUsageRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addUsageValue(current: unknown, next: unknown): unknown {
  if (typeof next === "number") {
    return (typeof current === "number" ? current : 0) + next;
  }

  if (isUsageRecord(next)) {
    const currentRecord = isUsageRecord(current) ? current : {};
    const result: Record<string, unknown> = { ...currentRecord };
    for (const [key, value] of Object.entries(next)) {
      result[key] = addUsageValue(currentRecord[key], value);
    }
    return result;
  }

  return next;
}

function accumulateUsage(current: ModelUsage | null, next: unknown | null | undefined): ModelUsage | null {
  if (next == null) {
    return current ?? null;
  }
  return addUsageValue(current, next) as ModelUsage;
}

function usageWithRequestCount(usage: ModelUsage): ModelUsage {
  const totalReqs = typeof usage.total_reqs === "number" ? usage.total_reqs + 1 : 1;
  return {
    ...usage,
    total_reqs: totalReqs,
  };
}

function accumulateUsagePerModel(
  current: Record<string, ModelUsage> | null | undefined,
  model: string,
  next: ModelUsage | null | undefined
): Record<string, ModelUsage> | null {
  if (next == null) {
    return current ?? null;
  }

  const usagePerModel = { ...(current ?? {}) };
  const modelName = model.trim() || "unknown";
  usagePerModel[modelName] = accumulateUsage(usagePerModel[modelName] ?? null, usageWithRequestCount(next))!;
  return usagePerModel;
}

export type SessionStatus =
  | "failed"
  | "pending"
  | "processing"
  | "waiting_for_user"
  | "completed"
  | "interrupted"
  | "ask_permission"
  | "permission_denied";

export type ModelUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  completion_tokens_details?: Record<string, unknown>;
  prompt_tokens_details?: Record<string, unknown>;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  total_reqs?: number;
};

export type SessionProcessEntry = {
  startTime: string;
  command: string;
  timeoutMs?: number;
  deadlineAt?: string;
  timedOut?: boolean;
};

export type BashTimeoutAdjustment = {
  processId: string;
  timeoutMs: number;
  deadlineAt: string;
  timedOut: boolean;
};

export type SessionEntry = {
  id: string;
  summary: string | null;
  assistantReply: string | null;
  assistantThinking: string | null;
  assistantRefusal: string | null;
  toolCalls: unknown[] | null;
  status: SessionStatus;
  failReason: string | null;
  usage: ModelUsage | null;
  usagePerModel: Record<string, ModelUsage> | null;
  activeTokens: number;
  cwd: string | null;
  lastBashCommand: string | null;
  lastUserPrompt: string | null;
  createTime: string;
  updateTime: string;
  processes: Map<string, SessionProcessEntry> | null; // {pid: process info}
  askPermissions?: AskPermissionRequest[];
};

export type SessionsIndex = {
  version: 1;
  entries: SessionEntry[];
  originalPath: string;
};

export type SessionMessageRole = "system" | "user" | "assistant" | "tool";

export type MessageMeta = {
  function?: unknown;
  paramsMd?: string;
  resultMd?: string;
  asThinking?: boolean;
  isSummary?: boolean;
  isModelChange?: boolean;
  skill?: SkillInfo;
  permissions?: MessageToolPermission[];
  userPrompt?: UserPromptContent;
};

export type SessionMessage = {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  content: string | null;
  contentParams: unknown | null;
  messageParams: unknown | null;
  compacted: boolean;
  visible: boolean;
  createTime: string;
  updateTime: string;
  meta?: MessageMeta;
  html?: string;
  checkpointHash?: string;
};

export type UndoTarget = {
  message: SessionMessage;
  index: number;
  canRestoreCode: boolean;
};

export type UserPromptContent = {
  text?: string;
  imageUrls?: string[];
  skills?: SkillInfo[];
  permissions?: UserToolPermission[];
  alwaysAllows?: PermissionScope[];
};

export type SkillInfo = {
  name: string;
  path: string;
  description: string;
  isLoaded?: boolean;
};

type SessionManagerOptions = {
  projectRoot: string;
  createOpenAIClient: CreateOpenAIClient;
  createLlmProvider?: (converterOptions?: OpenAIMessageConverterOptions) => CreateLlmProviderReturn;
  getResolvedSettings: () => {
    model: string;
    mcpServers?: Record<string, McpServerConfig>;
    permissions?: Required<PermissionSettings>;
    modelPricing?: Record<string, ModelPricing>;
    memory?: MemorySettings;
    budget?: BudgetSettings;
  };
  renderMarkdown: (text: string) => string;
  onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
  onSessionEntryUpdated?: (entry: SessionEntry) => void;
  onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
  onMcpStatusChanged?: () => void;
  onProcessStdout?: (pid: number, chunk: string) => void;
  terminalTitleTemplate?: string;
};

export type LlmStreamProgress = {
  requestId: string;
  sessionId?: string;
  startedAt: string;
  estimatedTokens: number;
  formattedTokens: string;
  phase: "start" | "update" | "end";
  /** What the LLM is currently emitting in the stream. */
  activity?: "reasoning" | "generating";
  /** How many tool calls have been seen in this stream so far. */
  toolCallCount?: number;
  /** Name of the most recent tool call (e.g. "glob", "read"). */
  toolCallName?: string;
};

export class SessionManager {
  private readonly projectRoot: string;
  private readonly createOpenAIClient: CreateOpenAIClient;
  private readonly createLlmProvider: (converterOptions?: OpenAIMessageConverterOptions) => CreateLlmProviderReturn;
  private readonly converterOptions: OpenAIMessageConverterOptions;
  private readonly getResolvedSettings: () => {
    model: string;
    mcpServers?: Record<string, McpServerConfig>;
    permissions?: Required<PermissionSettings>;
    modelPricing?: Record<string, ModelPricing>;
    memory?: MemorySettings;
    budget?: BudgetSettings;
  };
  private readonly onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
  private readonly onSessionEntryUpdated?: (entry: SessionEntry) => void;
  private readonly onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
  private readonly onMcpStatusChanged?: () => void;
  private readonly onProcessStdout?: (pid: number, chunk: string) => void;
  private activeSessionId: string | null = null;
  private activePromptController: AbortController | null = null;
  private pendingCommandWizard: { command: string; wizardState: Record<string, unknown> } | null = null;
  private readonly sessionControllers = new Map<string, AbortController>();
  private readonly processTimeoutControls = new Map<string, ProcessTimeoutControl>();
  private readonly liveProcessKeys = new Set<string>();
  private readonly toolExecutor: ToolExecutor;
  private readonly mcpManager = new McpManager();
  private mcpToolDefinitions: ToolDefinition[] = [];
  private readonly messageConverter: OpenAIMessageConverter;
  private static systemPromptCache = new Map<string, string>();
  private lastInjectedAgentInstructionsHash: string | null = null;
  private fileHistoryCheckpointCount = 0;
  private readonly terminalTitleTemplate: string | undefined;
  private readonly titleManager: TerminalTitleManager | null = null;

  constructor(options: SessionManagerOptions) {
    this.projectRoot = options.projectRoot;
    this.createOpenAIClient = options.createOpenAIClient;
    this.createLlmProvider =
      options.createLlmProvider ??
      ((converterOptions) => {
        const oaiResult = this.createOpenAIClient();
        if (!oaiResult.client) return { provider: null, createOpenAIClient: this.createOpenAIClient };
        const deepseekProvider = new DeepSeekProvider(this.createOpenAIClient, converterOptions);
        return { provider: deepseekProvider, createOpenAIClient: this.createOpenAIClient };
      });
    this.getResolvedSettings = options.getResolvedSettings;
    this.onAssistantMessage = options.onAssistantMessage;
    this.onSessionEntryUpdated = options.onSessionEntryUpdated;
    this.onLlmStreamProgress = options.onLlmStreamProgress;
    this.onMcpStatusChanged = options.onMcpStatusChanged;
    this.onProcessStdout = options.onProcessStdout;
    this.terminalTitleTemplate = options.terminalTitleTemplate;
    this.titleManager = options.terminalTitleTemplate
      ? new TerminalTitleManager(options.terminalTitleTemplate, {
          cwd: process.cwd(),
          model: this.getResolvedSettings().model,
        })
      : null;
    this.toolExecutor = new ToolExecutor(this.projectRoot, this.createOpenAIClient, this.mcpManager);
    this.mcpManager.prepare(this.getResolvedSettings().mcpServers);
    const converterOptions: OpenAIMessageConverterOptions = {
      renderInitPrompt: () => this.renderInitCommandPrompt(),
      renderSteeringAddPrompt: (steeringText: string) => this.renderSteeringAddCommandPrompt(steeringText),
      renderSteeringListPrompt: () => this.renderSteeringListCommandPrompt(),
      renderSpecInitPrompt: () => this.renderSpecInitPrompt(),
      renderSpecPlanPrompt: (planText: string) => this.renderSpecPlanPrompt(planText),
      renderSpecNewPrompt: (specNumber: number) => this.renderSpecNewPrompt(specNumber),
      renderSpecVerifyPrompt: (specNumber: number) => this.renderSpecVerifyPrompt(specNumber),
      renderSpecImplementPrompt: (specNumber: number) => this.renderSpecImplementPrompt(specNumber),
      renderSpecAuditPrompt: (specNumber: number) => this.renderSpecAuditPrompt(specNumber),
      renderSpecListPrompt: () => this.renderSpecListPrompt(),
      renderSpecStatusPrompt: (specNumber: number | null) => this.renderSpecStatusPrompt(specNumber),
    };
    this.converterOptions = converterOptions;
    this.messageConverter = new OpenAIMessageConverter(converterOptions);
  }

  /** @deprecated Kept for test compatibility. Returns OpenAI-format messages as unknown[]. */
  buildOpenAIMessages(messages: SessionMessage[], thinkingEnabled: boolean, model: string): unknown[] {
    return this.messageConverter.buildMessages(messages, thinkingEnabled, model) as unknown[];
  }

  private buildConverterOptions(): OpenAIMessageConverterOptions {
    return this.converterOptions;
  }

  async initMcpServers(servers?: Record<string, McpServerConfig>): Promise<void> {
    this.mcpManager.setOnToolsListChanged(() => {
      this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
    });
    // Set status change callback to notify UI updates
    this.mcpManager.setOnStatusChanged(() => {
      this.onMcpStatusChanged?.();
    });
    await this.mcpManager.initialize(servers);
    this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
  }

  getMcpStatus() {
    return this.mcpManager.getStatus();
  }

  async reconnectMcpServer(name: string, config?: McpServerConfig): Promise<void> {
    await this.mcpManager.reconnect(name, config);
    this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
  }

  dispose(): void {
    const controller = this.activePromptController;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    this.activePromptController = null;
    for (const sessionController of this.sessionControllers.values()) {
      if (!sessionController.signal.aborted) {
        sessionController.abort();
      }
    }
    this.killLiveProcesses();
    this.sessionControllers.clear();
    this.processTimeoutControls.clear();
    this.mcpManager.disconnect();
    this.titleManager?.dispose();
  }

  /** Update the terminal window title, typically after a CWD change. */
  updateTerminalTitle(cwd: string | null): void {
    if (!this.terminalTitleTemplate || !this.titleManager) return;
    this.titleManager.update(this.terminalTitleTemplate, {
      cwd: cwd ?? this.projectRoot,
      model: this.getResolvedSettings().model,
    });
  }

  private estimateStreamTokens(text: string): number {
    let tokens = 0;
    for (const char of text) {
      tokens += /[\u3400-\u9fff\uf900-\ufaff]/u.test(char) ? 0.6 : 0.3;
    }
    return tokens;
  }

  private estimateContextTokens(messages: SessionMessage[]): number {
    let estimatedTokens = 0;
    for (const msg of messages) {
      if (msg.compacted) continue;
      if (msg.content) {
        estimatedTokens += this.estimateStreamTokens(msg.content);
      }
      if (msg.messageParams) {
        estimatedTokens += this.estimateStreamTokens(JSON.stringify(msg.messageParams));
      }
    }
    return Math.ceil(estimatedTokens);
  }

  private formatEstimatedTokens(tokens: number): string {
    if (tokens <= 0) {
      return "0";
    }

    const roundedTokens = Math.round(tokens);
    if (roundedTokens <= 0) {
      return "0";
    }

    if (roundedTokens < 100) {
      return String(roundedTokens);
    }

    if (roundedTokens < 10000) {
      return `${Number((roundedTokens / 1000).toFixed(1))}k`;
    }

    return `${Math.round(roundedTokens / 1000)}k`;
  }

  private emitLlmStreamProgress(
    requestId: string,
    startedAt: string,
    estimatedTokens: number,
    phase: LlmStreamProgress["phase"],
    sessionId?: string,
    extra?: Partial<Pick<LlmStreamProgress, "activity" | "toolCallCount" | "toolCallName">>
  ): void {
    this.onLlmStreamProgress?.({
      requestId,
      sessionId,
      startedAt,
      estimatedTokens: Math.round(estimatedTokens),
      formattedTokens: this.formatEstimatedTokens(estimatedTokens),
      phase,
      ...extra,
    });
  }

  private isAbortLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.name === "AbortError" || error.constructor.name === "APIUserAbortError";
  }

  /**
   * Checks whether the error represents an API request timeout.
   */
  private isTimeoutError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "TimeoutError";
  }

  private throwIfAborted(signal?: AbortSignal | null): void {
    if (!signal?.aborted) {
      return;
    }

    const error = new Error("Request was aborted.");
    error.name = "AbortError";
    throw error;
  }

  private logChatCompletionDebug(
    debug: ChatCompletionDebugOptions | undefined,
    entry: Parameters<typeof logOpenAIChatCompletionDebug>[0]
  ): void {
    if (!debug?.enabled) {
      return;
    }
    logOpenAIChatCompletionDebug(entry);
  }

  private matchSkillsByKeywords(skills: SkillInfo[], userPrompt: string): string[] {
    if (!userPrompt || skills.length === 0) return [];
    const lowerPrompt = userPrompt.toLowerCase();
    const matched: string[] = [];

    for (const skill of skills) {
      if (skill.isLoaded) continue;

      // Rule 1: skill name matches (hyphens/spaces equivalent)
      const normalizedName = skill.name.toLowerCase().replace(/-/g, " ");
      const nameWithHyphens = skill.name.toLowerCase().replace(/ /g, "-");
      if (lowerPrompt.includes(normalizedName) || lowerPrompt.includes(nameWithHyphens)) {
        matched.push(skill.name);
        continue;
      }

      // Rule 2: at least one significant word from description matches
      if (skill.description) {
        const descWords = skill.description
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "") // strip punctuation except hyphens
          .split(/\s+/)
          .filter((w) => w.length >= 5); // only significant words
        if (descWords.some((word) => lowerPrompt.includes(word))) {
          matched.push(skill.name);
        }
      }
    }
    return matched;
  }

  private getSkillScanRoots(): Array<{ root: string; displayRoot: string }> {
    const homeDir = os.homedir();
    return [
      { root: path.join(this.projectRoot, ".dscode", "skills"), displayRoot: "./.dscode/skills" },
      { root: path.join(this.projectRoot, ".deepcode", "skills"), displayRoot: "./.deepcode/skills" },
      { root: path.join(this.projectRoot, ".agents", "skills"), displayRoot: "./.agents/skills" },
      { root: path.join(homeDir, ".dscode", "skills"), displayRoot: "~/.dscode/skills" },
      { root: path.join(homeDir, ".deepcode", "skills"), displayRoot: "~/.deepcode/skills" },
      { root: path.join(homeDir, ".agents", "skills"), displayRoot: "~/.agents/skills" },
    ];
  }

  async listSkills(sessionId?: string): Promise<SkillInfo[]> {
    const skillRoots = this.getSkillScanRoots();
    const skillsByName = new Map<string, SkillInfo>();

    const collectSkills = (root: string, displayRoot: string): SkillInfo[] => {
      if (!fs.existsSync(root)) {
        return [];
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        return [];
      }

      const results: SkillInfo[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }
        const skillName = entry.name;
        const skillPath = path.join(root, skillName, "SKILL.md");
        try {
          if (!fs.existsSync(skillPath)) {
            continue;
          }
          const stat = fs.statSync(skillPath);
          if (!stat.isFile()) {
            continue;
          }
        } catch {
          continue;
        }
        results.push(this.readSkillInfo(skillPath, `${displayRoot}/${skillName}/SKILL.md`, skillName));
      }
      return results;
    };

    for (const { root, displayRoot } of skillRoots) {
      for (const skill of collectSkills(root, displayRoot)) {
        if (!skillsByName.has(skill.name)) {
          skillsByName.set(skill.name, skill);
        }
      }
    }

    if (sessionId) {
      const loadedSkillKeys = this.getLoadedSkillKeys(sessionId);
      for (const skill of skillsByName.values()) {
        if (loadedSkillKeys.has(this.getSkillKey(skill)) || loadedSkillKeys.has(this.getSkillKeyByName(skill.name))) {
          skill.isLoaded = true;
        }
      }
    }

    return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private resolveSkillPath(skillPath: string): string {
    if (skillPath.startsWith("~/")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("~\\")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("./")) {
      return path.join(this.projectRoot, skillPath.slice(2));
    }
    if (skillPath.startsWith(".\\")) {
      return path.join(this.projectRoot, skillPath.slice(2));
    }
    if (path.isAbsolute(skillPath)) {
      return skillPath;
    }
    return path.join(os.homedir(), skillPath);
  }

  private buildSkillPrompt(skill: SkillInfo): string {
    const skillPath = this.resolveSkillPath(skill.path);
    return buildSkillDocumentsPrompt([
      {
        name: skill.name,
        content: fs.readFileSync(skillPath, "utf8"),
        path: skillPath,
        skillFilePath: skillPath,
      },
    ]);
  }

  private readSkillInfo(skillPath: string, displayPath: string, fallbackName: string): SkillInfo {
    const fallbackSkill: SkillInfo = {
      name: fallbackName.replace(/_/g, "-"),
      path: displayPath,
      description: "",
    };

    try {
      const skillMd = fs.readFileSync(skillPath, "utf8");
      const parsed = matter(skillMd);
      return {
        name:
          typeof parsed.data.name === "string" && parsed.data.name.trim()
            ? parsed.data.name.trim()
            : fallbackSkill.name,
        path: displayPath,
        description: typeof parsed.data.description === "string" ? parsed.data.description.trim() : "",
      };
    } catch {
      return fallbackSkill;
    }
  }

  private getSkillKey(skill: Pick<SkillInfo, "path">): string {
    return `path:${skill.path}`;
  }

  private getSkillKeyByName(name: string): string {
    return `name:${name}`;
  }

  private getLoadedSkillKeys(sessionId: string): Set<string> {
    const loadedSkillKeys = new Set<string>();
    for (const message of this.listSessionMessages(sessionId)) {
      if (message.role !== "system" || !message.meta?.skill) {
        continue;
      }
      loadedSkillKeys.add(this.getSkillKey(message.meta.skill));
      loadedSkillKeys.add(this.getSkillKeyByName(message.meta.skill.name));
    }
    return loadedSkillKeys;
  }

  private dedupeSkills(skills?: SkillInfo[]): SkillInfo[] | undefined {
    if (!skills || skills.length === 0) {
      return undefined;
    }

    const dedupedSkills = new Map<string, SkillInfo>();
    for (const skill of skills) {
      if (!skill?.name || !skill?.path) {
        continue;
      }
      const key = this.getSkillKey(skill);
      const existingSkill = dedupedSkills.get(key);
      dedupedSkills.set(key, {
        ...existingSkill,
        ...skill,
        description: skill.description ?? existingSkill?.description ?? "",
        isLoaded: Boolean(existingSkill?.isLoaded || skill.isLoaded),
      });
    }

    return Array.from(dedupedSkills.values());
  }

  private async normalizeSkills(skills?: SkillInfo[], sessionId?: string): Promise<SkillInfo[] | undefined> {
    const dedupedSkills = this.dedupeSkills(skills);
    if (!dedupedSkills || dedupedSkills.length === 0) {
      return undefined;
    }

    const availableSkills = await this.listSkills(sessionId);
    const availableSkillsByKey = new Map<string, SkillInfo>();
    for (const skill of availableSkills) {
      availableSkillsByKey.set(this.getSkillKey(skill), skill);
      availableSkillsByKey.set(this.getSkillKeyByName(skill.name), skill);
    }

    return dedupedSkills.map((skill) => {
      const matchedSkill =
        availableSkillsByKey.get(this.getSkillKey(skill)) ??
        availableSkillsByKey.get(this.getSkillKeyByName(skill.name));
      if (!matchedSkill) {
        return skill;
      }
      return {
        ...matchedSkill,
        ...skill,
        description: matchedSkill.description || skill.description,
        isLoaded: Boolean(matchedSkill.isLoaded || skill.isLoaded),
      };
    });
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  setActiveSessionId(sessionId: string | null): void {
    this.activeSessionId = sessionId;
  }

  addSessionSystemMessage(sessionId: string, content: string, visible?: boolean, meta?: MessageMeta): void {
    const message = this.buildSystemMessage(sessionId, content, null, visible, meta);
    if (sessionId) this.appendSessionMessage(sessionId, message);
    this.onAssistantMessage(message, false);
  }

  async handleUserPrompt(userPrompt: UserPromptContent): Promise<void> {
    const controller = new AbortController();
    this.activePromptController = controller;

    try {
      if (!this.activeSessionId || !this.getSession(this.activeSessionId)) {
        await this.createSession(userPrompt, controller);
      } else {
        await this.replySession(this.activeSessionId, userPrompt, controller);
      }
    } catch (error) {
      if (!this.isAbortLikeError(error) && !controller.signal.aborted) {
        throw error;
      }
    } finally {
      if (this.activePromptController === controller) {
        this.activePromptController = null;
      }
    }
  }

  async createSession(userPrompt: UserPromptContent, controller?: AbortController): Promise<string> {
    this.reportNewPrompt();
    const signal = controller?.signal;
    this.throwIfAborted(signal);

    const sessionId = crypto.randomUUID();
    this.ensureFileHistorySession(sessionId);
    const now = new Date().toISOString();
    const index = this.loadSessionsIndex();
    const entry: SessionEntry = {
      id: sessionId,
      summary: userPrompt.text ? userPrompt.text.slice(0, 100) : "[Image Prompt]",
      assistantReply: null,
      assistantThinking: null,
      assistantRefusal: null,
      toolCalls: null,
      status: "pending",
      failReason: null,
      usage: null,
      usagePerModel: null,
      activeTokens: 0,
      cwd: process.cwd(),
      lastBashCommand: null,
      lastUserPrompt: userPrompt.text ? userPrompt.text.slice(0, 200) : null,
      createTime: now,
      updateTime: now,
      processes: null,
    };

    this.titleManager?.update(this.terminalTitleTemplate!, {
      session: entry.summary ?? undefined,
      model: this.getResolvedSettings().model,
      cwd: process.cwd(),
    });

    index.entries.push(entry);
    const sortedEntries = index.entries.slice().sort((a, b) => {
      const aTime = Date.parse(a.updateTime);
      const bTime = Date.parse(b.updateTime);
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
        return b.updateTime.localeCompare(a.updateTime);
      }
      return bTime - aTime;
    });
    const keptEntries = sortedEntries.slice(0, MAX_SESSION_ENTRIES);
    const keptIds = new Set(keptEntries.map((item) => item.id));
    const droppedEntries = sortedEntries.filter((item) => !keptIds.has(item.id));
    index.entries = keptEntries;
    this.saveSessionsIndex(index);
    for (const dropped of droppedEntries) {
      this.cleanupSessionResources(dropped.id, {
        removeMessages: true,
        processIds: this.getProcessIds(dropped.processes ?? null),
      });
    }

    const promptToolOptions = this.getPromptToolOptions();
    const cacheKey = `${promptToolOptions.model}`;
    let systemPrompt = SessionManager.systemPromptCache.get(cacheKey);
    if (!systemPrompt) {
      systemPrompt = getSystemPrompt(this.projectRoot, promptToolOptions);
      SessionManager.systemPromptCache.set(cacheKey, systemPrompt);
    }
    const systemMessage = this.buildSystemMessage(sessionId, systemPrompt);
    this.appendSessionMessage(sessionId, systemMessage);

    const defaultSkillPrompt = getDefaultSkillPrompt();
    if (defaultSkillPrompt) {
      const defaultSkillMessage = this.buildSystemMessage(sessionId, defaultSkillPrompt);
      this.appendSessionMessage(sessionId, defaultSkillMessage);
    }

    const runtimeContextMessage = this.buildSystemMessage(
      sessionId,
      getRuntimeContext(this.projectRoot, promptToolOptions.model)
    );
    this.appendSessionMessage(sessionId, runtimeContextMessage);

    const agentInstructions = this.loadAgentInstructions();
    if (agentInstructions) {
      this.lastInjectedAgentInstructionsHash = this.hashContent(agentInstructions);
      const instructionsMessage = this.buildSystemMessage(sessionId, agentInstructions);
      this.appendSessionMessage(sessionId, instructionsMessage);
    }

    const memoryContext = await this.buildMemoryContextMessage();
    if (memoryContext) {
      this.appendSessionMessage(sessionId, memoryContext);
    }

    this.recordUserPromptCheckpoint(sessionId);
    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);

    if (userPrompt.text) {
      const skills = await this.listSkills();
      const skillNames = this.matchSkillsByKeywords(skills, userPrompt.text ?? "");
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills);
    this.throwIfAborted(signal);

    if (userPrompt.skills && userPrompt.skills.length > 0) {
      for (const skill of userPrompt.skills) {
        if (skill.isLoaded) {
          continue;
        }
        const skillPrompt = this.buildSkillPrompt(skill);
        const skillMessage = this.buildSkillMessage(sessionId, skillPrompt, skill);
        this.appendSessionMessage(sessionId, skillMessage);
        this.onAssistantMessage(skillMessage, true);
      }
    }

    this.activeSessionId = sessionId;
    await this.activateSession(sessionId, controller);
    return sessionId;
  }

  async replySession(sessionId: string, userPrompt: UserPromptContent, controller?: AbortController): Promise<void> {
    const signal = controller?.signal;
    this.throwIfAborted(signal);
    appendProjectPermissionAllows(this.projectRoot, userPrompt.alwaysAllows, {
      inheritedPermissions: this.getResolvedSettings().permissions,
    });
    const now = new Date().toISOString();
    const updated = this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "pending",
      failReason: null,
      askPermissions: undefined,
      lastUserPrompt: userPrompt.text ? userPrompt.text.slice(0, 200) : entry.lastUserPrompt,
      updateTime: now,
    }));

    if (!updated) {
      await this.createSession(userPrompt, controller);
      return;
    }

    if (hasUserPermissionReplies(userPrompt) && this.hasTrailingPendingToolCalls(sessionId)) {
      this.activeSessionId = sessionId;
      await this.activateSession(sessionId, controller, userPrompt);
      return;
    }

    if (this.isContinuePrompt(userPrompt)) {
      this.activeSessionId = sessionId;
      await this.activateSession(sessionId, controller, userPrompt);
      return;
    }

    this.reportNewPrompt();

    this.ensureFileHistorySession(sessionId);
    const checkpoint = this.recordUserPromptCheckpoint(sessionId);
    if (checkpoint.changedFilePaths.length) {
      const content = `Note that the user manually modified these files:\n${checkpoint.changedFilePaths.join("\n")}`;
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, content));
    }
    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);

    if (userPrompt.text) {
      const skills = await this.listSkills(sessionId);
      const skillNames = this.matchSkillsByKeywords(skills, userPrompt.text ?? "");
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills, sessionId);
    this.throwIfAborted(signal);

    if (userPrompt.skills && userPrompt.skills.length > 0) {
      for (const skill of userPrompt.skills) {
        if (skill.isLoaded) {
          continue;
        }
        const skillPrompt = this.buildSkillPrompt(skill);
        const skillMessage = this.buildSkillMessage(sessionId, skillPrompt, skill);
        this.appendSessionMessage(sessionId, skillMessage);
        this.onAssistantMessage(skillMessage, true);
      }

      // ── Model command dispatch ──────────────────────────────
      if (this.pendingCommandWizard || (userPrompt.text && userPrompt.text.trim().startsWith("/model-"))) {
        const text = userPrompt.text ?? "";
        let command: string;
        let wizardState: Record<string, unknown> | undefined;
        if (this.pendingCommandWizard) {
          command = this.pendingCommandWizard.command;
          wizardState = this.pendingCommandWizard.wizardState;
        } else {
          const cmdMatch = text.trim().match(/^\/(model-\w+)/);
          command = cmdMatch ? cmdMatch[1] : "model-list";
          wizardState = undefined;
        }
        const parts = command.split("-");
        const handlerName = "handle" + parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        const handler = (ModelCommandHandlers as Record<string, Function>)[handlerName];
        if (handler) {
          const ctx: ModelCommandHandlers.ModelCommandContext = {
            settings: this.getResolvedSettings() as unknown as ModelCommandHandlers.ModelCommandContext["settings"],
            catalog: MODEL_CATALOG,
            input: text,
            settingsDir: path.join(os.homedir(), ".dscode"),
            wizardState,
          };
          const result = handler(ctx);
          if (result.message) {
            const sysMsg = this.buildSystemMessage(sessionId, result.message);
            this.appendSessionMessage(sessionId, sysMsg);
          }
          if (result.settingsChanged) clearSettingsCache();
          if (result.needsMoreInput) {
            this.pendingCommandWizard = { command, wizardState: result.wizardState ?? {} };
          } else {
            this.pendingCommandWizard = null;
          }
          return;
        }
      }
    }
    this.activeSessionId = sessionId;
    await this.activateSession(sessionId, controller);
    if (this.isSteeringAddPrompt(userPrompt.text)) {
      this.reloadAgentInstructions(sessionId);
    }
  }

  private isContinuePrompt(userPrompt: UserPromptContent): boolean {
    return (
      typeof userPrompt.text === "string" &&
      userPrompt.text.trim() === "/continue" &&
      (!userPrompt.imageUrls || userPrompt.imageUrls.length === 0) &&
      (!userPrompt.skills || userPrompt.skills.length === 0)
    );
  }

  async activateSession(
    sessionId: string,
    controller?: AbortController,
    permissionPrompt?: UserPromptContent
  ): Promise<void> {
    const startedAt = Date.now();
    const { client, model, temperature, thinkingEnabled, reasoningEffort, notify, env, maxTokens } =
      this.createOpenAIClient();
    const { modelPricing } = this.getResolvedSettings();
    const effortManager = new RuntimeReasoningEffortManager();
    let currentReasoningEffort: ReasoningEffort = reasoningEffort ?? "max";
    const now = new Date().toISOString();
    rebuildSessionStateFromHistory(sessionId, this.listSessionMessages(sessionId));

    if (!client) {
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "failed",
        failReason: "API key not found",
        updateTime: now,
      }));
      this.onAssistantMessage(
        this.buildAssistantMessage(
          sessionId,
          "API key not found. Please configure ~/.dscode/settings.json or ./.dscode/settings.json.",
          null
        ),
        false
      );
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
      return;
    }

    const sessionController = controller ?? new AbortController();
    if (sessionController.signal.aborted) {
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "interrupted",
        failReason: "interrupted",
        updateTime: now,
      }));
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
      return;
    }

    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "processing",
      updateTime: now,
    }));

    this.sessionControllers.set(sessionId, sessionController);

    try {
      const maxIterations = 80000; // about 1K RMB cost
      let toolCalls: unknown[] | null = null;
      const cachedTools = getTools(this.getPromptToolOptions(), this.mcpToolDefinitions);

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (this.isInterrupted(sessionId)) {
          return;
        }

        const session = this.getSession(sessionId);
        if (session == null || session.status === "interrupted" || session.status === "failed") {
          return;
        }

        const pendingToolCallMessage = this.messageConverter.getTrailingPendingToolCallMessage(
          this.listSessionMessages(sessionId)
        );
        if (pendingToolCallMessage.toolCalls.length > 0) {
          const toolAppendResult = await this.appendToolMessages(sessionId, pendingToolCallMessage.toolCalls, {
            permissionOverrides: permissionPrompt?.permissions,
            messagePermissions: pendingToolCallMessage.message?.meta?.permissions,
          });
          await this.appendDeferredPermissionPrompt(sessionId, permissionPrompt, sessionController);
          // Permission replies are one-shot: do not reuse decisions or append the deferred user prompt again on later tool-call batches.
          permissionPrompt = undefined;
          if (this.isInterrupted(sessionId)) {
            return;
          }
          if (toolAppendResult.waitingForUser) {
            this.updateSessionEntry(sessionId, (entry) => ({
              ...entry,
              toolCalls: pendingToolCallMessage.toolCalls,
              status: "waiting_for_user",
              updateTime: new Date().toISOString(),
            }));
            return;
          }
        }

        const compactPromptTokenThreshold = getCompactPromptTokenThreshold(model);
        if (session.activeTokens > compactPromptTokenThreshold) {
          const message = this.buildAssistantMessage(
            sessionId,
            "The conversation is getting long, compacting...",
            null
          );
          message.meta = { asThinking: true };
          this.onAssistantMessage(message, false);
          await this.compactSession(sessionId, sessionController.signal);
        }

        const { provider } = this.createLlmProvider(this.buildConverterOptions());
        if (!provider) {
          const settings = this.createOpenAIClient();
          const caps = getModelCapabilities(settings.model);
          const providerName = caps?.provider ?? "unknown";
          const failMsg = `No API key configured for ${providerName}. Set engines.${providerName}.apiKey in settings.json or the DEEPCODE_ENGINE_${providerName.toUpperCase()}_API_KEY environment variable.`;
          this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            status: "failed",
            failReason: failMsg,
            updateTime: new Date().toISOString(),
          }));
          this.onAssistantMessage(this.buildAssistantMessage(sessionId, failMsg, null), false);
          return;
        }

        // Emit stream progress start
        const requestId = crypto.randomUUID();
        const streamStartedAt = new Date().toISOString();
        let estimatedTokens = 0;
        const trackText = (value: unknown) => {
          if (typeof value !== "string" || value.length === 0) return;
          estimatedTokens += this.estimateStreamTokens(value);
          this.emitLlmStreamProgress(requestId, streamStartedAt, estimatedTokens, "update", sessionId);
        };
        this.emitLlmStreamProgress(requestId, streamStartedAt, estimatedTokens, "start", sessionId);

        const stream = provider.chat({
          model,
          messages: this.listSessionMessages(sessionId),
          tools: cachedTools,
          temperature: thinkingEnabled ? undefined : temperature,
          maxTokens: (maxTokens ?? 0) > 0 ? maxTokens : undefined,
          signal: sessionController.signal,
          providerOptions: { thinkingEnabled, reasoningEffort: currentReasoningEffort },
        });

        let content = "";
        let reasoningContent = "";
        let signature = "";
        let streamUsage: ModelUsage | null = null;
        const toolCallsByIndex = new Map<
          number,
          { id?: string; type?: string; function?: { name?: string; arguments?: string } }
        >();
        let currentActivity: LlmStreamProgress["activity"] = undefined;
        let toolCallCount = 0;

        const emitActivity = () => {
          this.emitLlmStreamProgress(requestId, streamStartedAt, estimatedTokens, "update", sessionId, {
            activity: currentActivity,
            toolCallCount: toolCallCount > 0 ? toolCallCount : undefined,
          });
        };

        try {
          await runWithExecCtx({ sessionId, requestId, model, turnNumber: iteration }, async () => {
            for await (const event of stream) {
              if (event.type === "usage") {
                streamUsage = event.usage;
                continue;
              }
              if (event.type === "text_delta") {
                content += event.text;
                trackText(event.text);
                currentActivity = "generating";
                emitActivity();
                continue;
              }
              if (event.type === "reasoning_delta") {
                reasoningContent += event.text;
                trackText(event.text);
                currentActivity = "reasoning";
                emitActivity();
                continue;
              }
              if (event.type === "tool_call_start") {
                const index = toolCallsByIndex.size;
                toolCallsByIndex.set(index, {
                  id: event.id,
                  type: "function",
                  function: { name: event.name, arguments: "" },
                });
                trackText(event.name);
                toolCallCount = index + 1;
                this.emitLlmStreamProgress(requestId, streamStartedAt, estimatedTokens, "update", sessionId, {
                  activity: currentActivity,
                  toolCallCount,
                  toolCallName: event.name,
                });
                continue;
              }
              if (event.type === "tool_call_delta") {
                // Match by id, preferring the most recently added entry
                // (handles non-streaming responses where multiple tool calls share the same id)
                let lastMatchedIndex = -1;
                for (const [idx, tc] of toolCallsByIndex) {
                  if (tc.id === event.id) {
                    lastMatchedIndex = idx;
                  }
                }
                if (lastMatchedIndex >= 0) {
                  const tc = toolCallsByIndex.get(lastMatchedIndex);
                  if (tc) {
                    tc.function!.arguments! += event.arguments;
                    trackText(event.arguments);
                  }
                }
                continue;
              }
              if (event.type === "error") {
                throw event.error;
              }
              if (event.type === "signature") {
                signature = event.signature;
                continue;
              }
            }
          });
        } catch (error) {
          logApiError({
            timestamp: new Date().toISOString(),
            location: "SessionManager.activateSession:stream",
            requestId,
            sessionId,
            model,
            request: {},
            error: {
              name: error instanceof Error ? error.name : "UnknownError",
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
          });
          this.emitLlmStreamProgress(requestId, streamStartedAt, estimatedTokens, "end", sessionId);
          throw error;
        }

        this.emitLlmStreamProgress(requestId, streamStartedAt, estimatedTokens, "end", sessionId);

        const toolCallsArray = Array.from(toolCallsByIndex.entries())
          .sort(([a], [b]) => a - b)
          .map(([, tc]) => tc);
        toolCalls = this.normalizeLlmToolCalls(toolCallsArray);
        const thinking = reasoningContent.length > 0 ? reasoningContent : null;
        const refusal = null; // intentionally not tracked — refusal text merged into content
        // const html = content ? this.renderMarkdown(content) : "";

        // Record budget cost before checking isInterrupted, so interrupted
        // sessions still contribute to budget tracking.  When the API usage
        // event is missing because the stream was aborted, fall back to
        // estimated output tokens tracked during streaming.
        const responseUsage: ModelUsage | null =
          streamUsage ??
          (sessionController.signal.aborted && estimatedTokens > 0
            ? {
                prompt_tokens: 0,
                completion_tokens: Math.ceil(estimatedTokens),
                total_tokens: Math.ceil(estimatedTokens),
              }
            : null);
        if (responseUsage) {
          const budgetWarning = recordBudgetCost(
            this.projectRoot,
            model,
            responseUsage,
            modelPricing,
            this.getResolvedSettings().budget
          );
          if (budgetWarning) {
            this.addSessionSystemMessage(sessionId, budgetWarning, true);
          }
        }

        if (this.isInterrupted(sessionId)) {
          return;
        }
        const assistantMessage = this.buildAssistantMessage(sessionId, content, toolCalls, thinking, signature);
        const permissionPlan = toolCalls
          ? computeToolCallPermissions({
              sessionId,
              projectRoot: this.projectRoot,
              toolCalls,
              settings: this.getResolvedSettings().permissions,
              readPermissionExemptPaths: this.getSkillScanRoots().map((entry) => entry.root),
              resolveSnippetPath: (id, snippetId) => getSnippet(id, snippetId)?.filePath,
            })
          : null;
        if (permissionPlan) {
          assistantMessage.meta = {
            ...(assistantMessage.meta ?? {}),
            permissions: permissionPlan.permissions,
          };
        }
        this.appendSessionMessage(sessionId, assistantMessage);
        this.onAssistantMessage(assistantMessage, true);

        let waitingForUser = false;
        if (toolCalls) {
          if (permissionPlan?.askPermissions.length) {
            this.updateSessionEntry(sessionId, (entry) => ({
              ...entry,
              assistantReply: content,
              assistantThinking: thinking,
              assistantRefusal: refusal,
              toolCalls,
              usage: accumulateUsage(entry.usage, responseUsage),
              usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
              activeTokens: this.estimateContextTokens(this.listSessionMessages(sessionId)),
              status: "ask_permission",
              failReason: null,
              askPermissions: permissionPlan.askPermissions,
              updateTime: new Date().toISOString(),
            }));
            return;
          }
          const toolAppendResult = await this.appendToolMessages(sessionId, toolCalls, {
            messagePermissions: permissionPlan?.permissions,
          });
          waitingForUser = toolAppendResult.waitingForUser;

          if (toolCalls && toolCalls.length > 0 && toolAppendResult.executions.length > 0) {
            const turnInput = {
              toolCalls: toolCalls as ToolCall[],
              toolExecutions: toolAppendResult.executions.map((e) => e.result),
            };
            const nextEffort = effortManager.evaluate(turnInput);
            if (nextEffort !== null && nextEffort !== currentReasoningEffort) {
              currentReasoningEffort = nextEffort;
            }
          }
        }

        if (this.isInterrupted(sessionId)) {
          return;
        }

        this.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          assistantReply: content,
          assistantThinking: thinking,
          assistantRefusal: refusal,
          toolCalls,
          usage: accumulateUsage(entry.usage, responseUsage),
          usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
          activeTokens: this.estimateContextTokens(this.listSessionMessages(sessionId)),
          status: refusal ? "failed" : waitingForUser ? "waiting_for_user" : toolCalls ? "processing" : "completed",
          failReason: refusal ? refusal : entry.failReason,
          askPermissions: undefined,
          updateTime: new Date().toISOString(),
        }));

        if (refusal) {
          effortManager.reset();
          return;
        }

        if (waitingForUser) {
          effortManager.reset();
          return;
        }

        if (!toolCalls) {
          effortManager.reset();
          await this.compressAndStoreMemory(sessionId);
          return;
        }
      }

      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "completed",
        updateTime: new Date().toISOString(),
      }));
      this.onAssistantMessage(
        this.buildAssistantMessage(
          sessionId,
          "The AI agent has taken several steps but hasn't reached a conclusion yet. Do you want to continue?",
          null
        ),
        false
      );
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const aborted = this.isAbortLikeError(error) || sessionController.signal.aborted;
      const timedOut = this.isTimeoutError(error);

      const failReason = aborted
        ? "interrupted"
        : timedOut
          ? `Request timed out after ${Math.round(resolveApiTimeoutMs() / 1000)}s`
          : errMessage;

      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: aborted ? "interrupted" : "failed",
        failReason,
        updateTime: new Date().toISOString(),
      }));

      if (!aborted) {
        const userMessage = timedOut
          ? `Request timed out after ${Math.round(resolveApiTimeoutMs() / 1000)} seconds. You can retry by sending another message.`
          : `Request failed: ${errMessage}`;
        this.onAssistantMessage(this.buildAssistantMessage(sessionId, userMessage, null), false);
      }
    } finally {
      if (this.sessionControllers.get(sessionId) === sessionController) {
        this.sessionControllers.delete(sessionId);
      }
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
    }
  }

  async compactSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);
    const { provider } = this.createLlmProvider();
    if (!provider) {
      return;
    }
    const sessionMessages = this.listSessionMessages(sessionId).filter((message) => !message.compacted);
    if (sessionMessages.length === 0) {
      return;
    }

    const startIndex = sessionMessages.findIndex((message) => message.role !== "system");
    if (startIndex === -1) {
      return;
    }

    const searchStart = Math.floor(startIndex + ((sessionMessages.length - startIndex) * 2) / 3);
    let endIndex = -1;
    for (let i = Math.max(searchStart, startIndex); i < sessionMessages.length; i += 1) {
      if (sessionMessages[i].role !== "tool") {
        endIndex = i;
        break;
      }
    }
    // Fallback: if no non-tool message found forward, walk backward from end
    if (endIndex === -1) {
      for (let i = sessionMessages.length - 1; i > startIndex; i -= 1) {
        if (sessionMessages[i].role !== "tool") {
          endIndex = i;
          break;
        }
      }
    }
    if (endIndex === -1 || endIndex <= startIndex) {
      return;
    }

    // Selective compaction: preserve high-importance messages (errors, recent reads)
    // by adjusting the compaction boundary earlier.
    const adjustedEndIndex = this.findCompactionBoundary(sessionMessages, startIndex, endIndex);
    if (adjustedEndIndex <= startIndex) {
      return;
    }

    const compactPrompt = getCompactPrompt(sessionMessages.slice(startIndex, adjustedEndIndex));
    // Use a cheaper model variant for compaction, falling back to the current model
    const resolvedModel = this.createOpenAIClient().model;
    const compactionModel = provider?.getCheapModel?.(resolvedModel) ?? resolvedModel;

    const compactMessage: SessionMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role: "user",
      content: compactPrompt,
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: false,
      createTime: new Date().toISOString(),
      updateTime: new Date().toISOString(),
    };

    let compactedContent = "";
    let compactionUsage: ModelUsage | null = null;
    const stream = provider.chat({
      model: compactionModel,
      messages: [compactMessage],
      signal: signal ?? undefined,
    });
    for await (const event of stream) {
      if (event.type === "text_delta") compactedContent += event.text;
      if (event.type === "usage") compactionUsage = event.usage;
    }

    this.throwIfAborted(signal);
    const llmResponse = compactedContent;
    let compactedSummary: string;
    try {
      const parsed = JSON.parse(llmResponse);
      compactedSummary =
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? `Summary: ${parsed.summary.trim()}\nKey files: ${Array.isArray(parsed.keyFiles) ? parsed.keyFiles.join(", ") : "none"}\nPending: ${Array.isArray(parsed.pendingActions) ? parsed.pendingActions.join("; ") : "none"}`
          : llmResponse.trim();
    } catch {
      compactedSummary = llmResponse.trim();
    }

    const now = new Date().toISOString();
    // Use API-reported usage when available; fall back to estimated tokens from
    // response length so interrupted compactions still contribute to budget tracking.
    const responseUsage: ModelUsage | null =
      compactionUsage ??
      (compactedContent.length > 0
        ? {
            prompt_tokens: 0,
            completion_tokens: Math.ceil(compactedContent.length / 4),
            total_tokens: Math.ceil(compactedContent.length / 4),
          }
        : null);
    if (responseUsage) {
      const budgetWarning = recordBudgetCost(
        this.projectRoot,
        compactionModel,
        responseUsage,
        this.getResolvedSettings().modelPricing,
        this.getResolvedSettings().budget
      );
      if (budgetWarning) {
        this.addSessionSystemMessage(sessionId, budgetWarning, true);
      }
    }
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      usage: accumulateUsage(entry.usage, responseUsage),
      usagePerModel: accumulateUsagePerModel(entry.usagePerModel, compactionModel, responseUsage),
      activeTokens: this.estimateContextTokens(sessionMessages),
      updateTime: now,
    }));

    for (let i = startIndex; i < adjustedEndIndex; i += 1) {
      sessionMessages[i] = { ...sessionMessages[i], compacted: true, updateTime: now };
    }

    const summaryMessage: SessionMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content: `There are earlier parts of the conversation. Here is a summary: \n\n${compactedSummary}`,
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: false,
      createTime: now,
      updateTime: now,
      meta: {
        isSummary: true,
      },
    };
    sessionMessages.splice(adjustedEndIndex, 0, summaryMessage);
    this.saveSessionMessages(sessionId, sessionMessages);
  }

  /**
   * Find the optimal compaction boundary by walking backward from endIndex
   * and stopping before high-importance messages (errors, recent reads).
   * Returns the adjusted end index (exclusive).
   */
  private findCompactionBoundary(messages: SessionMessage[], startIndex: number, endIndex: number): number {
    let boundary = endIndex;
    for (let i = endIndex - 1; i > startIndex; i -= 1) {
      const msg = messages[i];
      if (!msg) continue;

      // Preserve tool messages that contain actual errors (not just the word in output)
      if (msg.role === "tool" && msg.content && hasToolError(msg.content)) {
        boundary = i;
        break;
      }

      // Preserve recent user and assistant messages (last 5 messages before endIndex)
      if (msg.role === "user" || msg.role === "assistant") {
        const distanceFromEnd = endIndex - i;
        if (distanceFromEnd <= 5) {
          boundary = i;
          break;
        }
      }
    }
    return boundary;
  }

  private async buildMemoryContextMessage(): Promise<SessionMessage | null> {
    const memorySettings = this.getResolvedSettings().memory;

    if (!memorySettings || !memorySettings.enabled) return null;

    // readRecentTurns estimates raw chars (u + a + actions + files + errors),
    // while buildTurnContext counts formatted output which adds prefixes, headers, and structure.
    // The formatted output is typically 1.3–2× the raw estimate, so 2× provides a safe read budget.
    const readBudget = memorySettings.maxContextChars * 2;
    const transcripts = await readRecentTurns(this.projectRoot, memorySettings.recentTurns, readBudget);
    const context = buildTurnContext(transcripts, memorySettings.maxContextChars);
    if (!context) return null;
    return this.buildSystemMessage(this.activeSessionId ?? "", context);
  }

  private async compressAndStoreMemory(sessionId: string): Promise<void> {
    const memorySettings = this.getResolvedSettings().memory;
    if (!memorySettings || !memorySettings.enabled || !memorySettings.storeTurnTranscripts) return;
    await this.storeTurnTranscript(sessionId, memorySettings);
  }

  /**
   * Capture turn data from session messages and persist as canonical transcript.
   */
  private async storeTurnTranscript(sessionId: string, memorySettings: MemorySettings): Promise<void> {
    try {
      const allMessages = this.listSessionMessages(sessionId);

      // Find the last user message
      let userContent = "";
      let lastUserIndex = -1;

      for (let i = allMessages.length - 1; i >= 0; i--) {
        if (allMessages[i].role === "user") {
          userContent = allMessages[i].content ?? "";
          lastUserIndex = i;
          break;
        }
      }

      if (lastUserIndex < 0) return;

      // Collect assistant response and tool results after the last user message
      let assistantContent = "";
      const actions: TurnAction[] = [];
      const fileRecords: TurnFileRecord[] = [];
      const errorRecords: TurnErrorRecord[] = [];

      for (let i = lastUserIndex + 1; i < allMessages.length; i++) {
        const msg = allMessages[i];
        if (msg.role === "assistant" && msg.content) {
          assistantContent = assistantContent ? `${assistantContent}\n\n${msg.content}` : msg.content;
        }
        if (msg.role === "tool") {
          const action = parseToolMessageAction(msg);
          if (action) actions.push(action);
          const files = parseToolMessageFiles(msg);
          for (const f of files) fileRecords.push(f);
          const errors = parseToolMessageErrors(msg);
          for (const e of errors) errorRecords.push(e);
        }
      }

      // Skip turns with no tool calls — they add minimal contextual value
      if (actions.length === 0 && fileRecords.length === 0) return;

      // Deduplicate file records
      const seen = new Set<string>();
      const dedupedFiles: TurnFileRecord[] = [];
      for (const f of fileRecords) {
        const key = `${f.p}|${f.op}`;
        if (!seen.has(key)) {
          seen.add(key);
          dedupedFiles.push(f);
        } else if (f.diff) {
          // Same path+op again: keep the latest diff
          const existing = dedupedFiles.find((df) => df.p === f.p && df.op === f.op);
          if (existing) existing.diff = f.diff;
        }
      }

      // Build canonicalization options (needed for diffs + text below)
      const limits = {
        maxUserChars: memorySettings.maxUserCharsPerTurn,
        maxAssistantChars: memorySettings.maxAssistantCharsPerTurn,
        maxStdoutChars: memorySettings.maxStdoutCharsPerTurn,
        maxStderrChars: memorySettings.maxStderrCharsPerTurn,
        maxDiffChars: memorySettings.maxDiffCharsPerTurn,
      };

      const c14nOptions = {
        stripAnsi: memorySettings.stripAnsi,
        collapseWhitespace: memorySettings.collapseWhitespace,
        dedupeRepeatedLines: memorySettings.dedupeRepeatedLines,
        limits,
      };

      // Canonicalize diffs (normalize line endings, strip ANSI, truncate — but never collapse
      // whitespace or dedupe inside diff content, as that would corrupt the diff format)
      const diffC14nOptions: CanonicalizeOptions = {
        ...c14nOptions,
        collapseWhitespace: false,
        dedupeRepeatedLines: false,
      };
      const maxDiffChars = memorySettings.maxDiffCharsPerTurn;
      for (const f of dedupedFiles) {
        if (f.diff) {
          f.diff = canonicalizeText(f.diff, maxDiffChars, diffC14nOptions);
        }
      }

      const redactedUser = redactSecrets(userContent);
      const redactedAssistant = redactSecrets(assistantContent);

      // Canonicalize actions
      const canonicalActions: TurnAction[] = actions.map((act) => {
        if (act.k === "shell") {
          return {
            ...act,
            out: redactSecrets(canonicalizeShellOutput(act.out, limits.maxStdoutChars, c14nOptions)),
            err: redactSecrets(canonicalizeShellOutput(act.err, limits.maxStderrChars, c14nOptions)),
            cmd: redactSecrets(act.cmd),
          };
        }
        return act;
      });

      // Redact secrets from error records (errors may contain tokens from tool output)
      const redactedErrors: TurnErrorRecord[] = errorRecords.map((e) => ({
        ...e,
        message: redactSecrets(e.message),
      }));

      const gitBranch = await this.getCurrentBranch();

      const transcript: TurnTranscript = {
        v: 1,
        id: "", // Will be assigned by storeTurn
        ts: new Date().toISOString(),
        cwd: this.projectRoot,
        git: gitBranch ? { branch: gitBranch } : null,
        env: {
          terminal: process.env.TERM ?? "unknown",
          platform: process.platform,
          node: process.version,
        },
        u: canonicalizeText(redactedUser, limits.maxUserChars, c14nOptions),
        a: canonicalizeText(redactedAssistant, limits.maxAssistantChars, c14nOptions),
        act: canonicalActions,
        files: dedupedFiles,
        err: redactedErrors,
      };

      const result = await storeTurn(this.projectRoot, transcript, memorySettings);
      if (!result.ok) {
        process.stderr.write(`[memory] Failed to store turn transcript: ${result.error}\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[memory] Error storing turn transcript: ${message}\n`);
    }
  }

  private async getCurrentBranch(): Promise<string | null> {
    try {
      const { execFile } = await import("node:child_process");
      const { promise, resolve } = Promise.withResolvers<string | null>();
      execFile(
        "git",
        ["branch", "--show-current"],
        {
          cwd: this.projectRoot,
          encoding: "utf8",
          timeout: 3000,
        },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          const trimmed = (stdout ?? "").trim();
          resolve(trimmed || null);
        }
      );
      return promise;
    } catch {
      return null;
    }
  }

  private getPromptToolOptions(): { model: string; webSearchEnabled: boolean } {
    return {
      model: this.getResolvedSettings().model,
      webSearchEnabled: true,
    };
  }

  private reportNewPrompt(): void {
    const { telemetryEnabled } = this.createOpenAIClient();
    reportNewPrompt({ enabled: telemetryEnabled ?? false });
  }

  interruptActiveSession(): void {
    const controller = this.activePromptController;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }

    const sessionId = this.activeSessionId;
    if (sessionId) {
      this.interruptSession(sessionId);
    }
  }

  interruptSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    const processIds = this.getProcessIds(session?.processes ?? null);
    const killedPids: number[] = [];
    const failedPids: number[] = [];
    for (const pid of processIds) {
      const processControlKey = this.getProcessControlKey(sessionId, pid);
      this.processTimeoutControls.delete(processControlKey);
      this.liveProcessKeys.delete(processControlKey);
      if (killProcessTree(pid, "SIGKILL")) {
        killedPids.push(pid);
        continue;
      }
      failedPids.push(pid);
    }

    const controller = this.sessionControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.sessionControllers.delete(sessionId);
    }

    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "interrupted",
      failReason: "interrupted",
      processes: null,
      updateTime: now,
    }));

    const contentParts = ["Interrupted."];
    if (session?.lastUserPrompt) {
      contentParts.push(
        `The prompt "${session.lastUserPrompt}" was cancelled by the human. Do NOT try to continue or re-execute it unless the human explicitly asks.`
      );
    }
    if (killedPids.length > 0) {
      const processDescriptions = killedPids
        .map((pid) => {
          const entry = session?.processes?.get(String(pid));
          const label = entry?.command ? `"${entry.command}" (pid ${pid})` : `pid ${pid}`;
          return label;
        })
        .join(", ");
      contentParts.push(`Killed processes: ${processDescriptions}.`);
    }
    if (failedPids.length > 0) {
      const processDescriptions = failedPids
        .map((pid) => {
          const entry = session?.processes?.get(String(pid));
          const label = entry?.command ? `"${entry.command}" (pid ${pid})` : `pid ${pid}`;
          return label;
        })
        .join(", ");
      contentParts.push(`Failed to kill processes: ${processDescriptions}.`);
    }

    this.onAssistantMessage(this.buildUserMessage(sessionId, { text: contentParts.join(" ") }), false);
  }

  private isInterrupted(sessionId: string): boolean {
    return !this.sessionControllers.has(sessionId);
  }

  /**
   * Mark a session's permission as denied by the user.
   * Updates the session entry status and failReason so the denial is visible in the session list.
   */
  denySessionPermission(sessionId: string, reason?: string): void {
    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "permission_denied",
      failReason: reason ?? "Permission denied by user",
      updateTime: now,
    }));
  }

  adjustActiveBashTimeout(deltaMs: number): BashTimeoutAdjustment | null {
    const sessionId = this.activeSessionId;
    if (!sessionId || !Number.isFinite(deltaMs)) {
      return null;
    }
    const session = this.getSession(sessionId);
    if (!session?.processes) {
      return null;
    }

    let selectedPid: string | null = null;
    for (const pid of session.processes.keys()) {
      if (this.processTimeoutControls.has(this.getProcessControlKey(sessionId, pid))) {
        selectedPid = pid;
      }
    }
    if (!selectedPid) {
      return null;
    }

    const control = this.processTimeoutControls.get(this.getProcessControlKey(sessionId, selectedPid));
    if (!control) {
      return null;
    }

    const current = control.getInfo();
    const next = control.setTimeoutMs(current.timeoutMs + deltaMs);
    this.updateSessionProcessTimeout(sessionId, selectedPid, next);
    return this.buildBashTimeoutAdjustment(selectedPid, next);
  }

  listSessions(): SessionEntry[] {
    const index = this.loadSessionsIndex();
    return index.entries;
  }

  getSession(sessionId: string): SessionEntry | null {
    const index = this.loadSessionsIndex();
    return index.entries.find((entry) => entry.id === sessionId) ?? null;
  }

  /**
   * Delete a session by its ID.
   * Removes the session entry from the index and cleans up associated resources
   * such as message files, in-memory state caches, working directory state,
   * session controllers, and tracked process timeout controls.
   * Returns true if the session was found and deleted, false otherwise.
   */
  deleteSession(sessionId: string): boolean {
    const index = this.loadSessionsIndex();
    const targetEntry = index.entries.find((entry) => entry.id === sessionId) ?? null;
    const nextEntries = index.entries.filter((entry) => entry.id !== sessionId);
    if (nextEntries.length === index.entries.length) {
      return false;
    }

    index.entries = nextEntries;
    this.saveSessionsIndex(index);
    this.cleanupSessionResources(sessionId, {
      removeMessages: true,
      processIds: this.getProcessIds(targetEntry?.processes ?? null),
    });
    return true;
  }

  /**
   * Rename a session by updating its summary (display title).
   * Returns true if the session was found and renamed, false otherwise.
   */
  renameSession(sessionId: string, summary: string): boolean {
    const trimmed = summary.trim();
    if (!trimmed) {
      return false;
    }
    const entry = this.getSession(sessionId);
    if (!entry) {
      return false;
    }
    this.updateSessionEntry(sessionId, (existing) => ({
      ...existing,
      summary: trimmed,
      updateTime: new Date().toISOString(),
    }));
    return true;
  }

  listSessionMessages(sessionId: string): SessionMessage[] {
    const messagePath = this.getSessionMessagesPath(sessionId);
    if (!fs.existsSync(messagePath)) {
      return [];
    }

    const raw = fs.readFileSync(messagePath, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const messages: SessionMessage[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as SessionMessage;
        messages.push(this.normalizeSessionMessage(parsed));
      } catch {
        // ignore malformed line
      }
    }
    return messages;
  }

  listUndoTargets(sessionId: string): UndoTarget[] {
    return this.listSessionMessages(sessionId)
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => this.isUndoTargetMessage(message))
      .map(({ message, index }) => ({
        message,
        index,
        canRestoreCode: Boolean(
          message.checkpointHash && this.canRestoreCheckpointHash(sessionId, message.checkpointHash)
        ),
      }));
  }

  restoreSessionConversation(sessionId: string, messageId: string): SessionMessage[] {
    const messages = this.listSessionMessages(sessionId);
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    if (targetIndex === -1) {
      throw new Error("Selected message was not found in this session.");
    }

    const keptMessages = messages.slice(0, targetIndex);
    this.saveSessionMessages(sessionId, keptMessages);
    const now = new Date().toISOString();
    const latestAssistant = [...keptMessages].reverse().find((message) => message.role === "assistant");
    const latestAssistantParams = latestAssistant?.messageParams as
      | { tool_calls?: unknown[]; reasoning_content?: string }
      | null
      | undefined;

    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      assistantReply: latestAssistant?.content ?? null,
      assistantThinking:
        typeof latestAssistantParams?.reasoning_content === "string" ? latestAssistantParams.reasoning_content : null,
      assistantRefusal: null,
      toolCalls: null,
      status: "completed",
      failReason: null,
      processes: null,
      updateTime: now,
    }));
    return keptMessages;
  }

  restoreSessionCode(sessionId: string, messageId: string): void {
    const message = this.listSessionMessages(sessionId).find((item) => item.id === messageId);
    if (!message) {
      throw new Error("Selected message was not found in this session.");
    }
    if (!message.checkpointHash) {
      throw new Error("Selected message has no code checkpoint.");
    }
    this.restoreCheckpointHash(sessionId, message.checkpointHash);
  }

  private normalizeSessionMessage(message: SessionMessage): SessionMessage {
    if (message.role !== "tool") {
      return message;
    }

    const nextMeta = message.meta ? { ...message.meta } : undefined;
    const normalizedParamsMd = this.buildToolParamsSnippet(nextMeta?.function ?? null);
    if (nextMeta && normalizedParamsMd) {
      nextMeta.paramsMd = normalizedParamsMd;
    }

    const normalizedResultMd = typeof message.content === "string" ? this.buildToolResultSnippet(message.content) : "";
    if (nextMeta && normalizedResultMd) {
      nextMeta.resultMd = normalizedResultMd;
    }

    return {
      ...message,
      visible: typeof message.content === "string" ? !this.isInvisibleExecution(message.content) : message.visible,
      meta: nextMeta,
    };
  }

  private getProjectStorage(): {
    projectCode: string;
    projectDir: string;
    sessionsIndexPath: string;
  } {
    const projectCode = getProjectCode(this.projectRoot);
    const projectDir = path.join(os.homedir(), ".dscode", "projects", projectCode);
    const sessionsIndexPath = path.join(projectDir, "sessions-index.json");
    return { projectCode, projectDir, sessionsIndexPath };
  }

  private getFileHistory(): GitFileHistory {
    return new GitFileHistory(this.projectRoot, this.getFileHistoryGitDir());
  }

  private getFileHistoryGitDir(): string {
    const { projectDir } = this.getProjectStorage();
    return path.join(projectDir, "file-history", ".git");
  }

  private ensureFileHistorySession(sessionId: string): string | undefined {
    return this.getFileHistory().ensureSession(sessionId);
  }

  private getCurrentCheckpointHash(sessionId: string): string | undefined {
    return this.getFileHistory().getCurrentCheckpointHash(sessionId);
  }

  private recordUserPromptCheckpoint(sessionId: string): FileHistoryCheckpointResult {
    return this.getFileHistory().recordTrackedFilesCheckpoint(sessionId, "User prompt checkpoint");
  }

  private prepareFileMutationCheckpoint(sessionId: string, filePath: string): void {
    const fileHistory = this.getFileHistory();
    const previousHash = fileHistory.ensureSession(sessionId);
    if (!previousHash) {
      return;
    }
    this.updateLatestUserCheckpointHash(sessionId, undefined, previousHash);
    const nextHash = fileHistory.recordCheckpoint(sessionId, [filePath], "Pre-mutation checkpoint");
    if (nextHash && nextHash !== previousHash) {
      this.updateLatestUserCheckpointHash(sessionId, previousHash, nextHash);
    }
  }

  private recordFileMutationCheckpoint(sessionId: string, filePath: string): void {
    const fileHistory = this.getFileHistory();
    fileHistory.ensureSession(sessionId);
    fileHistory.recordCheckpoint(sessionId, [filePath], "File mutation checkpoint");
    this.maybeGcFileHistory();
  }

  private maybeGcFileHistory(): void {
    this.fileHistoryCheckpointCount += 1;
    if (this.fileHistoryCheckpointCount % 50 === 0) {
      this.getFileHistory().gc();
    }
  }

  private updateLatestUserCheckpointHash(sessionId: string, previousHash: string | undefined, nextHash: string): void {
    const messages = this.listSessionMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || !this.isUndoTargetMessage(message)) {
        continue;
      }
      if (message.checkpointHash && message.checkpointHash !== previousHash) {
        return;
      }
      messages[index] = {
        ...message,
        checkpointHash: nextHash,
        updateTime: new Date().toISOString(),
      };
      this.saveSessionMessages(sessionId, messages);
      return;
    }
  }

  private canRestoreCheckpointHash(sessionId: string, checkpointHash: string): boolean {
    return this.getFileHistory().canRestore(sessionId, checkpointHash);
  }

  private restoreCheckpointHash(sessionId: string, checkpointHash: string): void {
    this.getFileHistory().restore(sessionId, checkpointHash);
  }

  private isUndoTargetMessage(message: SessionMessage): boolean {
    return message.role === "user" && message.visible && !message.compacted;
  }

  private ensureProjectDir(): string {
    const { projectDir } = this.getProjectStorage();
    fs.mkdirSync(projectDir, { recursive: true });
    return projectDir;
  }

  private loadSessionsIndex(): SessionsIndex {
    const { sessionsIndexPath } = this.getProjectStorage();
    this.ensureProjectDir();

    if (!fs.existsSync(sessionsIndexPath)) {
      return { version: 1, entries: [], originalPath: this.projectRoot };
    }

    try {
      const raw = fs.readFileSync(sessionsIndexPath, "utf8");
      const parsed = JSON.parse(raw) as SessionsIndex;
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries.map((entry) => this.normalizeSessionEntry(entry))
        : [];
      return {
        version: 1,
        entries,
        originalPath: parsed.originalPath || this.projectRoot,
      };
    } catch {
      return { version: 1, entries: [], originalPath: this.projectRoot };
    }
  }

  private saveSessionsIndex(index: SessionsIndex): void {
    const { sessionsIndexPath } = this.getProjectStorage();
    this.ensureProjectDir();
    const normalized = {
      version: 1,
      entries: index.entries.map((entry) => ({
        ...entry,
        processes: this.serializeProcesses(entry.processes),
      })),
      originalPath: this.projectRoot,
    };
    atomicWriteJsonFileSync(sessionsIndexPath, normalized);
  }

  private getSessionMessagesPath(sessionId: string): string {
    const { projectDir } = this.getProjectStorage();
    return path.join(projectDir, `${sessionId}.jsonl`);
  }

  private removeSessionMessages(sessionIds: string[]): void {
    for (const sessionId of sessionIds) {
      const messagePath = this.getSessionMessagesPath(sessionId);
      try {
        if (fs.existsSync(messagePath)) {
          fs.unlinkSync(messagePath);
        }
      } catch {
        // ignore delete failures
      }
    }
  }

  private cleanupSessionResources(
    sessionId: string,
    options: { removeMessages: boolean; processIds?: number[] }
  ): void {
    const processIds = options.processIds ?? [];
    for (const pid of processIds) {
      const processControlKey = this.getProcessControlKey(sessionId, pid);
      if (!this.processTimeoutControls.has(processControlKey) && !this.liveProcessKeys.has(processControlKey)) {
        continue;
      }

      this.killTrackedProcess(processControlKey, pid);
    }

    clearSessionState(sessionId);
    clearSessionWorkingDir(sessionId);
    const controller = this.sessionControllers.get(sessionId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    this.sessionControllers.delete(sessionId);
    if (options.removeMessages) {
      this.removeSessionMessages([sessionId]);
    }
  }

  private appendSessionMessage(sessionId: string, message: SessionMessage): void {
    this.ensureProjectDir();
    const messagePath = this.getSessionMessagesPath(sessionId);
    fs.appendFileSync(messagePath, `${JSON.stringify(message)}\n`, "utf8");
  }

  private saveSessionMessages(sessionId: string, messages: SessionMessage[]): void {
    this.ensureProjectDir();
    const messagePath = this.getSessionMessagesPath(sessionId);
    const payload = messages.map((message) => JSON.stringify(message)).join("\n");
    atomicWriteFileSync(messagePath, payload ? `${payload}\n` : "");
  }

  private updateSessionEntry(sessionId: string, updater: (entry: SessionEntry) => SessionEntry): SessionEntry | null {
    const index = this.loadSessionsIndex();
    const entryIndex = index.entries.findIndex((entry) => entry.id === sessionId);
    if (entryIndex === -1) {
      return null;
    }

    const updated = updater({ ...index.entries[entryIndex] });
    index.entries[entryIndex] = updated;
    this.saveSessionsIndex(index);
    this.onSessionEntryUpdated?.(updated);
    return updated;
  }

  private buildUserMessage(sessionId: string, prompt: UserPromptContent): SessionMessage {
    const now = new Date().toISOString();
    const imageParams =
      prompt.imageUrls
        ?.filter((url) => Boolean(url))
        .map((url) => ({
          type: "image_url",
          image_url: { url },
        })) ?? [];

    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "user",
      content: prompt.text ?? "",
      contentParams: imageParams.length > 0 ? imageParams : null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: now,
      updateTime: now,
      meta: { userPrompt: this.cloneUserPromptForMeta(prompt) },
      checkpointHash: this.getCurrentCheckpointHash(sessionId),
    };
  }

  private renderInitCommandPrompt(): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "init_command.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, {
      agentsMdFile: this.getEffectiveProjectAgentsMdFile(),
    });
  }

  private renderSteeringAddCommandPrompt(steeringText: string): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "steering_add.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, { steeringText });
  }

  private renderSteeringListCommandPrompt(): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "steering_list.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, {});
  }

  private renderSpecInitPrompt(): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "spec_init.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, {});
  }

  private renderSpecPlanPrompt(planText: string): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "spec_plan.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, { planText });
  }

  private renderSpecNewPrompt(specNumber: number): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "spec_new.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, { specNumber });
  }

  private renderSpecVerifyPrompt(specNumber: number): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "spec_verify.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, { specNumber });
  }

  private renderSpecImplementPrompt(specNumber: number): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "spec_implement.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, { specNumber });
  }

  private renderSpecAuditPrompt(specNumber: number): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "spec_audit.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, { specNumber });
  }

  private renderSpecListPrompt(): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "spec_list.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, {});
  }

  private renderSpecStatusPrompt(specNumber: number | null): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "spec_status.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, { specNumber });
  }

  private getEffectiveProjectAgentsMdFile(): string | null {
    return this.loadProjectAgentInstructions()?.displayPath ?? null;
  }

  private loadProjectAgentInstructions(): { content: string; displayPath: string } | null {
    const candidatePaths = [
      {
        absolutePath: path.join(this.projectRoot, ".dscode", "AGENTS.md"),
        displayPath: "./.dscode/AGENTS.md",
      },
      {
        absolutePath: path.join(this.projectRoot, ".deepcode", "AGENTS.md"),
        displayPath: "./.deepcode/AGENTS.md",
      },
      {
        absolutePath: path.join(this.projectRoot, "AGENTS.md"),
        displayPath: "./AGENTS.md",
      },
    ];

    for (const candidatePath of candidatePaths) {
      const content = this.readNonEmptyFile(candidatePath.absolutePath);
      if (content) {
        return {
          content,
          displayPath: candidatePath.displayPath,
        };
      }
    }

    return null;
  }

  private readNonEmptyFile(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, "utf8").trim();
      return content || null;
    } catch {
      return null;
    }
  }

  private loadAgentInstructions(): string | null {
    const projectInstructions = this.loadProjectAgentInstructions();
    if (projectInstructions) {
      return projectInstructions.content;
    }

    return (
      this.readNonEmptyFile(path.join(os.homedir(), ".dscode", "AGENTS.md")) ??
      this.readNonEmptyFile(path.join(os.homedir(), ".deepcode", "AGENTS.md"))
    );
  }

  private hashContent(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  private isSteeringAddPrompt(text: string | null | undefined): boolean {
    return typeof text === "string" && /^\/steering-add\s/.test(text);
  }

  private reloadAgentInstructions(sessionId: string): void {
    const agentInstructions = this.loadAgentInstructions();
    if (!agentInstructions) return;

    const hash = this.hashContent(agentInstructions);
    if (hash === this.lastInjectedAgentInstructionsHash) return;

    this.lastInjectedAgentInstructionsHash = hash;
    const message = this.buildSystemMessage(sessionId, agentInstructions);
    this.appendSessionMessage(sessionId, message);
  }

  private buildSystemMessage(
    sessionId: string,
    content: string,
    contentParams: unknown | null = null,
    visible = false,
    meta?: MessageMeta
  ): SessionMessage {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content,
      contentParams,
      messageParams: null,
      compacted: false,
      visible,
      createTime: now,
      updateTime: now,
      meta,
    };
  }

  private buildSkillMessage(sessionId: string, content: string, skill: SkillInfo): SessionMessage {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content,
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: now,
      updateTime: now,
      meta: { skill: { ...skill, isLoaded: true } },
    };
  }

  private buildAssistantMessage(
    sessionId: string,
    content: string | null,
    toolCalls: unknown[] | null,
    reasoningContent?: string | null,
    signature?: string
  ): SessionMessage {
    const now = new Date().toISOString();
    const hasReasoningContent = reasoningContent != null;
    const hasSignature = signature != null && signature !== "";
    const messageParams: { tool_calls?: unknown[]; reasoning_content?: string; signature?: string } | null =
      toolCalls || hasReasoningContent || hasSignature ? {} : null;
    if (toolCalls) {
      messageParams!.tool_calls = toolCalls;
    }
    if (hasReasoningContent) {
      messageParams!.reasoning_content = reasoningContent;
    }
    if (hasSignature) {
      messageParams!.signature = signature;
    }
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "assistant",
      content,
      contentParams: null,
      messageParams,
      compacted: false,
      visible: (content || reasoningContent || "").trim() ? true : false,
      createTime: now,
      updateTime: now,
      meta: toolCalls ? { asThinking: true } : undefined,
    };
  }

  private generateToolCallId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  private normalizeLlmToolCalls(rawToolCalls: unknown[] | null | undefined): unknown[] | null {
    if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) {
      return null;
    }

    return rawToolCalls.map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
        return toolCall;
      }

      const record = toolCall as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (id) {
        return toolCall;
      }

      return {
        ...record,
        id: this.generateToolCallId(),
      };
    });
  }

  private buildToolMessage(
    sessionId: string,
    toolCallId: string,
    content: string,
    toolFunction: unknown | null
  ): SessionMessage {
    const now = new Date().toISOString();
    const paramsMd = this.buildToolParamsSnippet(toolFunction);
    const resultMd = this.buildToolResultSnippet(content);
    const isInvisibleExecution = this.isInvisibleExecution(content);
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "tool",
      content,
      contentParams: null,
      messageParams: { tool_call_id: toolCallId },
      compacted: false,
      visible: !isInvisibleExecution,
      createTime: now,
      updateTime: now,
      meta: {
        function: toolFunction ?? undefined,
        paramsMd,
        resultMd,
      },
    };
  }

  private async appendToolMessages(
    sessionId: string,
    toolCalls: unknown[],
    options: {
      permissionOverrides?: UserToolPermission[];
      messagePermissions?: MessageToolPermission[];
    } = {}
  ): Promise<{ waitingForUser: boolean; executions: ToolCallExecution[] }> {
    const hooks: ToolExecutionHooks = {
      onProcessStart: (pid, command) => this.addSessionProcess(sessionId, pid, command),
      onProcessExit: (pid) => this.removeSessionProcess(sessionId, pid),
      onProcessStdout: (pid, chunk) => this.onProcessStdout?.(Number(pid), chunk),
      onProcessTimeoutControl: (pid, control) => this.setSessionProcessTimeoutControl(sessionId, pid, control),
      onBackgroundProcessComplete: (completion) => this.addBackgroundProcessCompletionMessage(sessionId, completion),
      onBeforeFileMutation: (filePath) => this.prepareFileMutationCheckpoint(sessionId, filePath),
      onAfterFileMutation: (filePath) => this.recordFileMutationCheckpoint(sessionId, filePath),
      shouldStop: () => this.isInterrupted(sessionId),
    };
    const parsedToolCalls = toolCalls
      .map((toolCall) => parseToolCallForPermissions(toolCall))
      .filter((toolCall): toolCall is PermissionToolCall => Boolean(toolCall));
    const toolExecutions: ToolCallExecution[] = [];
    for (const toolCall of parsedToolCalls) {
      if (hooks.shouldStop?.()) {
        break;
      }
      const blockedResult = buildPermissionToolExecution(toolCall, options);
      if (blockedResult) {
        toolExecutions.push(blockedResult);
        continue;
      }
      const executions = await this.toolExecutor.executeToolCalls(sessionId, [toolCall], hooks);
      toolExecutions.push(...executions);
    }
    if (this.isInterrupted(sessionId)) {
      return { waitingForUser: false, executions: toolExecutions };
    }
    let waitingForUser = false;
    const followUpMessages: SessionMessage[] = [];
    for (const execution of toolExecutions) {
      if (execution.result.awaitUserResponse === true) {
        waitingForUser = true;
      }
      const toolFunction = this.messageConverter.findToolFunction(toolCalls, execution.toolCallId);
      const toolMessage = this.buildToolMessage(sessionId, execution.toolCallId, execution.content, toolFunction);
      this.appendSessionMessage(sessionId, toolMessage);
      this.onAssistantMessage(toolMessage, true);

      // Update session CWD when a tool reports a new working directory
      if (execution.result.metadata?.cwd && typeof execution.result.metadata.cwd === "string") {
        this.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          cwd: execution.result.metadata!.cwd as string,
          updateTime: new Date().toISOString(),
        }));
      }

      for (const followUpMessage of execution.result.followUpMessages ?? []) {
        if (followUpMessage.role !== "system") {
          continue;
        }
        followUpMessages.push(
          this.buildSystemMessage(sessionId, followUpMessage.content, followUpMessage.contentParams ?? null)
        );
      }
    }

    for (const followUpMessage of followUpMessages) {
      this.appendSessionMessage(sessionId, followUpMessage);
    }
    return { waitingForUser, executions: toolExecutions };
  }

  private cloneUserPromptForMeta(prompt: UserPromptContent): UserPromptContent {
    return {
      text: prompt.text,
      imageUrls: prompt.imageUrls ? [...prompt.imageUrls] : undefined,
      skills: prompt.skills ? prompt.skills.map((skill) => ({ ...skill })) : undefined,
      permissions: prompt.permissions ? prompt.permissions.map((permission) => ({ ...permission })) : undefined,
      alwaysAllows: prompt.alwaysAllows ? [...prompt.alwaysAllows] : undefined,
    };
  }

  private hasTrailingPendingToolCalls(sessionId: string): boolean {
    return (
      this.messageConverter.getTrailingPendingToolCallMessage(this.listSessionMessages(sessionId)).toolCalls.length > 0
    );
  }

  private async appendDeferredPermissionPrompt(
    sessionId: string,
    userPrompt: UserPromptContent | undefined,
    controller: AbortController
  ): Promise<void> {
    if (!userPrompt || this.isContinuePrompt(userPrompt)) {
      return;
    }
    const text = userPrompt.text ?? "";
    const hasUserContent =
      text.trim().length > 0 ||
      (Array.isArray(userPrompt.imageUrls) && userPrompt.imageUrls.length > 0) ||
      (Array.isArray(userPrompt.skills) && userPrompt.skills.length > 0);
    if (!hasUserContent) {
      return;
    }
    this.reportNewPrompt();
    const signal = controller.signal;
    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);
    if (userPrompt.text) {
      const skills = await this.listSkills(sessionId);
      const skillNames = this.matchSkillsByKeywords(skills, userPrompt.text ?? "");
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills, sessionId);
    this.throwIfAborted(signal);
    if (userPrompt.skills && userPrompt.skills.length > 0) {
      for (const skill of userPrompt.skills) {
        if (skill.isLoaded) {
          continue;
        }
        const skillPrompt = this.buildSkillPrompt(skill);
        const skillMessage = this.buildSkillMessage(sessionId, skillPrompt, skill);
        this.appendSessionMessage(sessionId, skillMessage);
        this.onAssistantMessage(skillMessage, true);
      }
    }
  }

  private buildToolParamsSnippet(toolFunction: unknown | null): string {
    if (!toolFunction || typeof toolFunction !== "object") {
      return "";
    }
    const args = (toolFunction as { arguments?: unknown }).arguments;
    const toolName = (toolFunction as { name?: unknown }).name;
    if (typeof args !== "string") {
      return "";
    }
    const trimmed = args.trim();
    if (!trimmed) {
      return "";
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return this.formatToolParamsSnippet(
          typeof toolName === "string" ? toolName : null,
          parsed as Record<string, unknown>
        );
      }
    } catch {
      // fall back to raw string
    }
    return trimmed;
  }

  private formatToolParamsSnippet(toolName: string | null, args: Record<string, unknown>): string {
    if (toolName === "bash") {
      const command = typeof args.command === "string" ? args.command.trim() : "";
      const description = typeof args.description === "string" ? args.description.trim() : "";
      if (command && description) {
        return `${command}  # ${description}`;
      }
      if (command) {
        return command;
      }
      if (description) {
        return description;
      }
    } else if (toolName === "UpdatePlan") {
      return typeof args.explanation === "string" ? args.explanation.trim() : "";
    } else if (toolName === "write") {
      return typeof args.file_path === "string" ? args.file_path.trim() : "";
    } else if (toolName === "edit") {
      const filePath = typeof args.file_path === "string" ? args.file_path.trim() : "";
      if (filePath) {
        return filePath;
      }
      return typeof args.snippet_id === "string" ? args.snippet_id.trim() : "";
    }

    const firstKey = Object.keys(args)[0];
    if (!firstKey) {
      return "";
    }

    const value = args[firstKey];
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (toolName === "read" && text.startsWith(this.projectRoot)) {
      return text.slice(this.projectRoot.length).replace(/^[\\/]/, "");
    }
    return text;
  }

  private buildToolResultSnippet(content: string): string {
    const trimmed = content.trim();
    if (!trimmed) {
      return "";
    }

    const maxLength = 2000;

    try {
      const parsed = JSON.parse(content) as { output?: unknown };
      if (parsed.output !== undefined) {
        if (typeof parsed.output === "string") {
          return this.formatToolResultSnippet(parsed.output, maxLength);
        }
        return this.formatToolResultSnippet(JSON.stringify(parsed.output), maxLength);
      }
    } catch {
      // fall back to raw content
    }

    return this.formatToolResultSnippet(content, maxLength);
  }

  private formatToolResultSnippet(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}... (total ${value.length} chars)`;
  }

  private isInvisibleExecution(content: string): boolean {
    if (!content.trim()) {
      return false;
    }
    try {
      const parsed = JSON.parse(content) as { name?: unknown; ok?: unknown };
      return parsed.name === "bash" && parsed.ok !== true;
    } catch {
      return false;
    }
  }

  private maybeNotifyTaskCompletion(
    sessionId: string,
    notifyCommand: string | undefined,
    startedAt: number,
    configuredEnv: Record<string, string> = {}
  ): void {
    if (!notifyCommand) {
      return;
    }

    const session = this.getSession(sessionId);
    if (!session || (session.status !== "completed" && session.status !== "failed")) {
      return;
    }

    // Find the last assistant message body for the BODY env variable.
    let body: string | undefined;
    const messages = this.listSessionMessages(sessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === "assistant" && msg.content) {
        body = msg.content;
        break;
      }
    }

    launchNotifyScript(notifyCommand, Date.now() - startedAt, this.projectRoot, undefined, configuredEnv, {
      status: session.status,
      failReason: session.failReason ?? undefined,
      body,
      title: session.summary ?? undefined,
    });
  }

  private addSessionProcess(sessionId: string, processId: string | number, command: string): void {
    const now = new Date().toISOString();
    this.liveProcessKeys.add(this.getProcessControlKey(sessionId, processId));
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      processes.set(String(processId), { startTime: now, command });
      return {
        ...entry,
        processes,
        lastBashCommand: command,
        updateTime: now,
      };
    });
  }

  private addBackgroundProcessCompletionMessage(
    sessionId: string,
    completion: {
      command: string;
      outputPath: string;
      ok: boolean;
      exitCode: number | null;
      signal: string | null;
      error?: string;
      completedAtMs: number;
      startedAtMs: number;
    }
  ): void {
    const status = completion.ok ? "completed" : "failed";
    const exitText =
      completion.exitCode !== null
        ? `exit code ${completion.exitCode}`
        : completion.signal
          ? `signal ${completion.signal}`
          : completion.error || "unknown status";
    const durationMs = Math.max(0, completion.completedAtMs - completion.startedAtMs);
    const baseContent =
      `Background command "${completion.command}" ${status} with ${exitText} ` +
      `after ${this.formatBackgroundDuration(durationMs)}. Output: ${completion.outputPath}`;
    const logTail = completion.ok ? null : this.buildBackgroundFailureLogTailSlice(completion.outputPath);
    const content = logTail ? `${baseContent}\n${logTail}` : baseContent;
    this.addSessionSystemMessage(sessionId, content, true);
  }

  private buildBackgroundFailureLogTailSlice(outputPath: string): string | null {
    const tail = this.readTextFileTail(outputPath, BACKGROUND_FAILURE_LOG_TAIL_CHARS);
    if (!tail || !tail.content) {
      return null;
    }
    const prefix = tail.truncated ? `(${tail.totalBytes} bytes)...\n` : "";
    return [
      `<background_task_failure_log path="${outputPath}">`,
      `${prefix}${tail.content}`,
      "</background_task_failure_log>",
    ].join("\n");
  }

  private readTextFileTail(
    filePath: string,
    maxChars: number
  ): { content: string; totalBytes: number; truncated: boolean } | null {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size <= 0) {
        return null;
      }
      const content = readTextFileWithMetadata(filePath).content;
      return {
        content: content.slice(-maxChars).trimEnd(),
        totalBytes: stat.size,
        truncated: content.length > maxChars,
      };
    } catch {
      return null;
    }
  }

  private formatBackgroundDuration(durationMs: number): string {
    if (durationMs < 1000) {
      return `${durationMs}ms`;
    }
    const seconds = Math.round(durationMs / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  private removeSessionProcess(sessionId: string, processId: string | number): void {
    const now = new Date().toISOString();
    const processControlKey = this.getProcessControlKey(sessionId, processId);
    this.processTimeoutControls.delete(processControlKey);
    this.liveProcessKeys.delete(processControlKey);
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      processes.delete(String(processId));
      return {
        ...entry,
        processes: processes.size > 0 ? processes : null,
        updateTime: now,
      };
    });
  }

  private setSessionProcessTimeoutControl(
    sessionId: string,
    processId: string | number,
    control: ProcessTimeoutControl | null
  ): void {
    const key = this.getProcessControlKey(sessionId, processId);
    if (!control) {
      this.processTimeoutControls.delete(key);
      return;
    }

    this.processTimeoutControls.set(key, control);
    this.updateSessionProcessTimeout(sessionId, processId, control.getInfo());
  }

  private updateSessionProcessTimeout(sessionId: string, processId: string | number, info: ProcessTimeoutInfo): void {
    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      const pid = String(processId);
      const processInfo = processes.get(pid);
      if (!processInfo) {
        return entry;
      }
      processes.set(pid, {
        ...processInfo,
        timeoutMs: info.timeoutMs,
        deadlineAt: new Date(info.deadlineAtMs).toISOString(),
        timedOut: info.timedOut,
      });
      return {
        ...entry,
        processes,
        updateTime: now,
      };
    });
  }

  private buildBashTimeoutAdjustment(processId: string, info: ProcessTimeoutInfo): BashTimeoutAdjustment {
    return {
      processId,
      timeoutMs: info.timeoutMs,
      deadlineAt: new Date(info.deadlineAtMs).toISOString(),
      timedOut: info.timedOut,
    };
  }

  private getProcessControlKey(sessionId: string, processId: string | number): string {
    return `${sessionId}:${String(processId)}`;
  }

  private killLiveProcesses(): void {
    for (const processControlKey of Array.from(this.liveProcessKeys)) {
      const processId = this.getProcessIdFromControlKey(processControlKey);
      if (processId === null) {
        this.liveProcessKeys.delete(processControlKey);
        continue;
      }
      this.killTrackedProcess(processControlKey, processId);
    }
  }

  private killTrackedProcess(processControlKey: string, processId: number): void {
    const killedGroup = killProcessTree(processId, "SIGKILL");
    if (!killedGroup) {
      try {
        process.kill(processId, "SIGKILL");
      } catch {
        // Ignore process-kill failures during cleanup.
      }
    }
    this.processTimeoutControls.delete(processControlKey);
    this.liveProcessKeys.delete(processControlKey);
  }

  private getProcessIdFromControlKey(processControlKey: string): number | null {
    const separatorIndex = processControlKey.lastIndexOf(":");
    const rawProcessId = separatorIndex >= 0 ? processControlKey.slice(separatorIndex + 1) : processControlKey;
    const processId = Number(rawProcessId);
    return Number.isInteger(processId) && processId > 0 ? processId : null;
  }

  private getProcessIds(processes: Map<string, SessionProcessEntry> | null): number[] {
    if (!processes) {
      return [];
    }
    const ids: number[] = [];
    for (const pid of processes.keys()) {
      const parsed = Number(pid);
      if (Number.isInteger(parsed) && parsed > 0) {
        ids.push(parsed);
      }
    }
    return ids;
  }

  private normalizeSessionEntry(entry: unknown): SessionEntry {
    const value = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: typeof value.id === "string" ? value.id : crypto.randomUUID(),
      summary: typeof value.summary === "string" ? value.summary : null,
      assistantReply: typeof value.assistantReply === "string" ? value.assistantReply : null,
      assistantThinking: typeof value.assistantThinking === "string" ? value.assistantThinking : null,
      assistantRefusal: typeof value.assistantRefusal === "string" ? value.assistantRefusal : null,
      toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls : null,
      status: this.normalizeSessionStatus(value.status),
      failReason: typeof value.failReason === "string" ? value.failReason : null,
      usage: (value.usage as ModelUsage) ?? null,
      usagePerModel: this.normalizeUsagePerModel(value),
      activeTokens: typeof value.activeTokens === "number" ? value.activeTokens : 0,
      cwd: typeof value.cwd === "string" ? value.cwd : null,
      lastBashCommand: typeof value.lastBashCommand === "string" ? value.lastBashCommand : null,
      lastUserPrompt: typeof value.lastUserPrompt === "string" ? value.lastUserPrompt : null,
      createTime: typeof value.createTime === "string" ? value.createTime : new Date().toISOString(),
      updateTime: typeof value.updateTime === "string" ? value.updateTime : new Date().toISOString(),
      processes: this.deserializeProcesses(value.processes),
      askPermissions: normalizeAskPermissions(value.askPermissions),
    };
  }

  private normalizeSessionStatus(status: unknown): SessionStatus {
    if (
      status === "failed" ||
      status === "pending" ||
      status === "processing" ||
      status === "waiting_for_user" ||
      status === "completed" ||
      status === "interrupted" ||
      status === "ask_permission" ||
      status === "permission_denied"
    ) {
      return status;
    }
    return "pending";
  }

  private normalizeUsagePerModel(entry: Record<string, unknown>): Record<string, ModelUsage> | null {
    if (!Object.hasOwn(entry, "usagePerModel")) {
      return null;
    }
    if (!isUsageRecord(entry.usagePerModel)) {
      return null;
    }
    const usagePerModel: Record<string, ModelUsage> = {};
    for (const [model, usage] of Object.entries(entry.usagePerModel)) {
      if (!model || !isUsageRecord(usage)) {
        continue;
      }
      usagePerModel[model] = usage as ModelUsage;
    }
    return usagePerModel;
  }

  private deserializeProcesses(value: unknown): Map<string, SessionProcessEntry> | null {
    if (!value || typeof value !== "object") {
      return null;
    }
    const processes = new Map<string, SessionProcessEntry>();
    for (const [pid, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!pid) {
        continue;
      }
      if (typeof entry === "string") {
        // Backward compatibility for old format where just stored start time
        processes.set(pid, { startTime: entry, command: "Running process..." });
      } else if (typeof entry === "object" && entry !== null) {
        const obj = entry as {
          startTime?: unknown;
          command?: unknown;
          timeoutMs?: unknown;
          deadlineAt?: unknown;
          timedOut?: unknown;
        };
        const startTime = typeof obj.startTime === "string" ? obj.startTime : new Date().toISOString();
        const command = typeof obj.command === "string" ? obj.command : "Running process...";
        processes.set(pid, {
          startTime,
          command,
          timeoutMs: typeof obj.timeoutMs === "number" ? obj.timeoutMs : undefined,
          deadlineAt: typeof obj.deadlineAt === "string" ? obj.deadlineAt : undefined,
          timedOut: typeof obj.timedOut === "boolean" ? obj.timedOut : undefined,
        });
      }
    }
    return processes.size > 0 ? processes : null;
  }

  private serializeProcesses(
    processes: Map<string, SessionProcessEntry> | null
  ): Record<string, SessionProcessEntry> | null {
    if (!processes || processes.size === 0) {
      return null;
    }
    const serialized: Record<string, SessionProcessEntry> = {};
    for (const [pid, entry] of processes.entries()) {
      serialized[pid] = entry;
    }
    return serialized;
  }
}

// ── Tool message parsing helpers for turn transcript capture ───────────

interface ParsedToolMeta {
  name: string;
  args: Record<string, unknown>;
}

function extractToolMeta(msg: {
  contentParams?: unknown | null;
  meta?: { function?: unknown } | null;
}): ParsedToolMeta | null {
  // Try contentParams (structured tool definition)
  if (msg.contentParams && typeof msg.contentParams === "object") {
    const params = msg.contentParams as Record<string, unknown>;
    if (typeof params.name === "string") {
      return { name: params.name, args: (params.args as Record<string, unknown>) ?? {} };
    }
  }
  // Try meta.function
  if (msg.meta?.function && typeof msg.meta.function === "object") {
    const fn = msg.meta.function as Record<string, unknown>;
    if (typeof fn.name === "string") {
      return { name: fn.name, args: (fn.arguments as Record<string, unknown>) ?? {} };
    }
  }
  return null;
}

function parseToolMessageAction(msg: {
  content?: string | null;
  contentParams?: unknown | null;
  meta?: { function?: unknown } | null;
}): TurnAction | null {
  const meta = extractToolMeta(msg);
  if (!meta) return null;

  const output = msg.content ?? "";
  const name = meta.name;
  const args = meta.args;

  switch (name) {
    case "bash": {
      const cmd = typeof args.command === "string" ? args.command : "";
      const cwd = typeof args.cwd === "string" ? args.cwd : "";
      // Parse the tool result JSON to extract exit code, error, and clean output
      const parsed = parseBashToolOutput(output);
      return {
        k: "shell",
        cmd,
        cwd,
        exit: parsed.exitCode,
        out: parsed.stdout,
        err: parsed.stderr,
      };
    }
    case "read": {
      const filePath = typeof args.file_path === "string" ? args.file_path : "";
      return { k: "read", path: filePath };
    }
    case "write": {
      const filePath = typeof args.file_path === "string" ? args.file_path : "";
      return { k: "write", path: filePath };
    }
    case "edit": {
      const filePath = typeof args.file_path === "string" ? args.file_path : "";
      return { k: "edit", path: filePath };
    }
    default:
      return {
        k: "other",
        name,
        summary: output.slice(0, 200).replace(/\n/g, " "),
      };
  }
}

function parseToolMessageFiles(msg: {
  content?: string | null;
  contentParams?: unknown | null;
  meta?: { function?: unknown } | null;
}): TurnFileRecord[] {
  const meta = extractToolMeta(msg);
  if (!meta) return [];

  const files: TurnFileRecord[] = [];
  const args = meta.args;
  const diff = extractDiffFromToolContent(msg.content);

  switch (meta.name) {
    case "bash": {
      // Bash can touch files but we can't determine which from the tool call alone
      // The output may contain file paths, but we don't parse that here
      break;
    }
    case "read": {
      const p = typeof args.file_path === "string" ? args.file_path : "";
      if (p) files.push({ p, op: "read" });
      break;
    }
    case "write": {
      const p = typeof args.file_path === "string" ? args.file_path : "";
      if (p) files.push({ p, op: "write", diff });
      break;
    }
    case "edit": {
      const p = typeof args.file_path === "string" ? args.file_path : "";
      if (p) files.push({ p, op: "edit", diff });
      break;
    }
  }

  return files;
}

function extractDiffFromToolContent(content: string | null | undefined): string | undefined {
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content) as { metadata?: { diff_preview?: string } };
    return typeof parsed.metadata?.diff_preview === "string" ? parsed.metadata.diff_preview : undefined;
  } catch {
    return undefined;
  }
}

function hasToolError(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { ok?: boolean; error?: string };
    return parsed.ok === false || (typeof parsed.error === "string" && parsed.error.length > 0);
  } catch {
    return false;
  }
}

type ParsedBashOutput = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

/**
 * Parse a bash tool-result JSON string to extract the actual stdout,
 * stderr, and exit code. Falls back to raw content if parsing fails.
 */
function parseBashToolOutput(raw: string): ParsedBashOutput {
  try {
    const parsed = JSON.parse(raw) as {
      output?: string;
      error?: string;
      metadata?: { exitCode?: unknown; signal?: unknown };
    };
    const exitCode = typeof parsed.metadata?.exitCode === "number" ? parsed.metadata.exitCode : null;
    const stdout = typeof parsed.output === "string" ? parsed.output : "";
    const stderr = typeof parsed.error === "string" ? parsed.error : "";
    return { stdout, stderr, exitCode };
  } catch {
    return { stdout: raw, stderr: "", exitCode: null };
  }
}

function parseToolMessageErrors(msg: {
  content?: string | null;
  contentParams?: unknown | null;
  meta?: { function?: unknown } | null;
}): TurnErrorRecord[] {
  const content = msg.content ?? "";
  if (!content) return [];

  const errors: TurnErrorRecord[] = [];

  // Try to parse as JSON first to avoid false positives
  // (the word "Error:" in successful output should not count as an error)
  try {
    const parsed = JSON.parse(content) as { ok?: boolean; error?: string };
    if (parsed.ok === false || (typeof parsed.error === "string" && parsed.error.length > 0)) {
      const errMsg =
        typeof parsed.error === "string" && parsed.error.length > 0 ? parsed.error : "Tool returned ok: false";
      errors.push({ kind: "command", message: errMsg.slice(0, 200) });
    }
  } catch {
    // Non-JSON content — fall back to regex patterns
    if (/Error:/i.test(content) || /ENOENT/i.test(content) || /MODULE_NOT_FOUND/i.test(content)) {
      const firstLine = content.split("\n")[0].slice(0, 200);
      errors.push({ kind: "command", message: firstLine });
    }
  }

  if (/\[ERROR\]/i.test(content)) {
    const match = content.match(/\[ERROR\]\s*(.+)/i);
    if (match) {
      errors.push({ kind: "runtime", message: match[1].slice(0, 200) });
    }
  }

  return errors;
}
