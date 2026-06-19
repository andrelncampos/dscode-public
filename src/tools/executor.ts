import type OpenAI from "openai";
import type { ReasoningEffort } from "../settings";
import { handleAskUserQuestionTool } from "./ask-user-question-handler";
import { handleBashTool } from "./bash-handler";
import { handleEditTool } from "./edit-handler";
import { handleGlobTool } from "./glob-handler";
import { handleGrepTool } from "./grep-handler";
import { handleReadTool } from "./read-handler";
import { handleWebFetchTool } from "./web-fetch-handler";
import { handleUpdatePlanTool } from "./update-plan-handler";
import { handleWebSearchTool } from "./web-search-handler";
import { handleWriteTool } from "./write-handler";
import { parseBashSideEffects } from "../common/permissions";
import type { McpManager } from "../mcp/mcp-manager";
import type { McpPolicy } from "../mcp/mcp-policy";
import { repairToolCall, createRepairMetrics } from "./tool-call-repair";
import type { ToolCallRepairMetrics, ToolRegistry } from "./tool-call-repair";
import { getBuiltInToolDefinitions } from "../prompt";
import type { ToolDefinition } from "../prompt";
import { getErrorMessage } from "../common/error-utils.js";

export type CreateOpenAIClient = () => {
  client: OpenAI | null;
  model: string;
  baseURL?: string;
  temperature?: number;
  thinkingEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
  debugLogEnabled?: boolean;
  telemetryEnabled?: boolean;
  maxTokens?: number;
  notify?: string;
  env?: Record<string, string>;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolExecutionContext = {
  sessionId: string;
  projectRoot: string;
  toolCall: ToolCall;
  createOpenAIClient?: CreateOpenAIClient;
  onProcessStart?: (processId: string | number, command: string) => void;
  onProcessExit?: (processId: string | number) => void;
  onProcessStdout?: (processId: string | number, chunk: string) => void;
  onProcessTimeoutControl?: (processId: string | number, control: ProcessTimeoutControl | null) => void;
  onBackgroundProcessComplete?: (completion: BackgroundProcessCompletion) => void;
  onBeforeFileMutation?: (filePath: string) => void;
  onAfterFileMutation?: (filePath: string) => void;
  bashTimeoutMs?: number;
  bashMinTimeoutMs?: number;
};

export type ToolExecutionHooks = {
  onProcessStart?: (processId: string | number, command: string) => void;
  onProcessExit?: (processId: string | number) => void;
  onProcessStdout?: (processId: string | number, chunk: string) => void;
  onProcessTimeoutControl?: (processId: string | number, control: ProcessTimeoutControl | null) => void;
  onBackgroundProcessComplete?: (completion: BackgroundProcessCompletion) => void;
  onBeforeFileMutation?: (filePath: string) => void;
  onAfterFileMutation?: (filePath: string) => void;
  shouldStop?: () => boolean;
};

export type BackgroundProcessCompletion = {
  taskId: string;
  processId: number;
  command: string;
  outputPath: string;
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  error?: string;
  cwd: string | null;
  shellPath: string;
  startedAtMs: number;
  completedAtMs: number;
};

export type ProcessTimeoutInfo = {
  timeoutMs: number;
  startedAtMs: number;
  deadlineAtMs: number;
  timedOut: boolean;
};

export type ProcessTimeoutControl = {
  getInfo: () => ProcessTimeoutInfo;
  setTimeoutMs: (timeoutMs: number) => ProcessTimeoutInfo;
};

export type ToolExecutionResult = {
  ok: boolean;
  name: string;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  awaitUserResponse?: boolean;
  followUpMessages?: ToolExecutionFollowUpMessage[];
};

export type ToolExecutionFollowUpMessage = {
  role: "system";
  content: string;
  contentParams?: unknown | null;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolExecutionResult>;

function normalizeToolArguments(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      // fall through to empty string
    }
  }
  return "";
}

export type ToolCallExecution = {
  toolCallId: string;
  content: string;
  result: ToolExecutionResult;
};

export class ToolExecutor {
  private readonly projectRoot: string;
  private readonly createOpenAIClient?: CreateOpenAIClient;
  private readonly mcpManager?: McpManager;
  private readonly mcpPolicy?: McpPolicy;
  private readonly toolHandlers = new Map<string, ToolHandler>();
  private mcpAuditContext?: { specNumber: string };
  private repairMetrics: ToolCallRepairMetrics;
  private readonly toolRegistry: ToolRegistry;
  private elicitationMode: boolean = false;

  constructor(
    projectRoot: string,
    createOpenAIClient?: CreateOpenAIClient,
    mcpManager?: McpManager,
    mcpPolicy?: McpPolicy
  ) {
    this.projectRoot = projectRoot;
    this.createOpenAIClient = createOpenAIClient;
    this.mcpManager = mcpManager;
    this.mcpPolicy = mcpPolicy;
    this.registerToolHandlers();
    this.repairMetrics = createRepairMetrics();
    this.toolRegistry = this.buildToolRegistry();
  }

  /** Set audit context for MCP tool calls during spec commands. */
  setMcpAuditContext(ctx: { specNumber: string } | undefined): void {
    this.mcpAuditContext = ctx;
  }

  setElicitationMode(enabled: boolean): void {
    this.elicitationMode = enabled;
  }

  private buildToolRegistry(): ToolRegistry {
    const builtInDefs = getBuiltInToolDefinitions();
    const builtInNames = new Map<string, ToolDefinition>();
    for (const def of builtInDefs) {
      builtInNames.set(def.function.name, def);
    }

    return {
      resolve: (name: string) => {
        const trimmed = name.trim();
        // 1. Exact match (case-sensitive) in built-in tools
        if (builtInNames.has(trimmed)) {
          return { canonicalName: trimmed, definition: builtInNames.get(trimmed) };
        }
        // 2. Case-insensitive match in built-in tools
        const lower = trimmed.toLowerCase();
        for (const [canonical, def] of builtInNames) {
          if (canonical.toLowerCase() === lower) {
            return { canonicalName: canonical, definition: def };
          }
        }
        // 3. MCP tools — exact match
        if (this.mcpManager?.isMcpTool(trimmed)) {
          return { canonicalName: trimmed, definition: undefined };
        }
        // 4. Case-insensitive MCP match
        const mcpNames = this.mcpManager?.getAllToolNames?.() ?? [];
        const lowerName = trimmed.toLowerCase();
        const match = mcpNames.find((n) => n.toLowerCase() === lowerName);
        if (match) {
          return { canonicalName: match, definition: undefined };
        }
        return undefined;
      },
      getAllNames: () => {
        const builtIn = [...builtInNames.keys()];
        const mcp = this.mcpManager?.getAllToolNames?.() ?? [];
        return [...builtIn, ...mcp].sort();
      },
    };
  }

  async executeToolCalls(
    sessionId: string,
    toolCalls: unknown[],
    hooks?: ToolExecutionHooks
  ): Promise<ToolCallExecution[]> {
    const parsedCalls = toolCalls
      .map((toolCall) => this.parseToolCall(toolCall))
      .filter((toolCall): toolCall is ToolCall => Boolean(toolCall));

    const executions: ToolCallExecution[] = [];
    for (const toolCall of parsedCalls) {
      if (hooks?.shouldStop?.()) {
        break;
      }
      const result = await this.executeToolCall(sessionId, toolCall, hooks);
      executions.push({
        toolCallId: toolCall.id,
        content: this.formatToolResult(result),
        result,
      });
      if (hooks?.shouldStop?.()) {
        break;
      }
    }
    return executions;
  }

  private registerToolHandlers(): void {
    this.toolHandlers.set("bash", handleBashTool);
    this.toolHandlers.set("read", handleReadTool);
    this.toolHandlers.set("write", handleWriteTool);
    this.toolHandlers.set("edit", handleEditTool);
    this.toolHandlers.set("glob", handleGlobTool);
    this.toolHandlers.set("grep", handleGrepTool);
    this.toolHandlers.set("WebFetch", handleWebFetchTool);
    this.toolHandlers.set("AskUserQuestion", handleAskUserQuestionTool);
    this.toolHandlers.set("UpdatePlan", handleUpdatePlanTool);
    this.toolHandlers.set("WebSearch", handleWebSearchTool);
  }

  private checkElicitationBlock(toolName: string, args: Record<string, unknown>): ToolExecutionResult | null {
    if (toolName === "write" || toolName === "edit") {
      return {
        ok: false,
        name: toolName,
        error:
          "Elicitation mode active. File modifications are blocked until /spec-plan-end is called. Ask clarifying questions instead.",
      };
    }
    if (toolName === "bash") {
      const sideEffects = parseBashSideEffects(args.sideEffects);
      const writeScopes = [
        "write-in-cwd",
        "write-out-cwd",
        "delete-in-cwd",
        "delete-out-cwd",
        "mutate-git-log",
        "unknown",
      ];
      if (sideEffects.some((s) => writeScopes.includes(s))) {
        return {
          ok: false,
          name: "bash",
          error:
            "Elicitation mode active. File modifications and mutations are blocked until /spec-plan-end is called. Read-only bash commands are allowed.",
        };
      }
    }
    return null;
  }

  private parseToolCall(toolCall: unknown): ToolCall | null {
    if (!toolCall || typeof toolCall !== "object") {
      return null;
    }

    const record = toolCall as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };

    if (typeof record.id !== "string") {
      return null;
    }

    const functionRecord = record.function;
    if (!functionRecord || typeof functionRecord !== "object") {
      return null;
    }

    if (typeof functionRecord.name !== "string") {
      return null;
    }

    const rawArguments = normalizeToolArguments(functionRecord.arguments);

    return {
      id: record.id,
      type: "function",
      function: {
        name: functionRecord.name,
        arguments: rawArguments,
      },
    };
  }

  private async executeToolCall(
    sessionId: string,
    toolCall: ToolCall,
    hooks?: ToolExecutionHooks
  ): Promise<ToolExecutionResult> {
    // --- REPAIR PIPELINE (NEW) ---
    const repairResult = repairToolCall(toolCall, this.toolRegistry, this.repairMetrics);
    if ("error" in repairResult) {
      return {
        ok: false,
        name: toolCall.function.name,
        error: repairResult.error,
      };
    }
    const { toolCall: repaired, args } = repairResult;
    // --- END REPAIR PIPELINE ---

    // Elicitation mode guard
    if (this.elicitationMode) {
      const blockResult = this.checkElicitationBlock(repaired.function.name, args);
      if (blockResult) return blockResult;
    }

    const toolName = repaired.function.name;
    const handlerName = toolName;
    const handler = this.toolHandlers.get(handlerName);
    if (!handler) {
      // Try MCP tools
      if (this.mcpManager?.isMcpTool(toolName)) {
        // Evaluate MCP policy before execution
        const policyAction = this.mcpPolicy?.evaluate(toolName) ?? "ask";
        if (policyAction === "deny") {
          const reason = this.mcpPolicy?.findDenyReason(toolName) ?? "unknown";
          return {
            ok: false,
            name: toolName,
            error: `Tool ${toolName} blocked by steering policy: ${reason}`,
          };
        }
        if (policyAction === "allow") {
          // Execute directly — bypass permission prompt (args already repaired)
          return this.mcpManager.executeMcpTool(toolName, args, undefined, this.mcpAuditContext);
        }
        // "ask" → fall through to existing permission flow (args already repaired)
        return this.mcpManager.executeMcpTool(toolName, args, undefined, this.mcpAuditContext);
      }
      return {
        ok: false,
        name: toolName,
        error: `Unknown tool: ${toolName}`,
      };
    }

    // Execute handler with repaired args
    try {
      return await handler(args, {
        sessionId,
        projectRoot: this.projectRoot,
        toolCall: repaired,
        createOpenAIClient: this.createOpenAIClient,
        onProcessStart: hooks?.onProcessStart,
        onProcessExit: hooks?.onProcessExit,
        onProcessStdout: hooks?.onProcessStdout,
        onProcessTimeoutControl: hooks?.onProcessTimeoutControl,
        onBackgroundProcessComplete: hooks?.onBackgroundProcessComplete,
        onBeforeFileMutation: hooks?.onBeforeFileMutation,
        onAfterFileMutation: hooks?.onAfterFileMutation,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      return {
        ok: false,
        name: toolName,
        error: message,
      };
    }
  }

  getRepairMetrics(): ToolCallRepairMetrics {
    return this.repairMetrics;
  }

  resetRepairMetrics(): void {
    this.repairMetrics = createRepairMetrics();
  }

  private formatToolResult(result: ToolExecutionResult): string {
    const payload: Record<string, unknown> = {
      ok: result.ok,
      name: result.name,
    };

    if (typeof result.output !== "undefined") {
      payload.output = result.output;
    }

    if (result.error) {
      payload.error = result.error;
    }

    if (result.metadata && Object.keys(result.metadata).length > 0) {
      payload.metadata = result.metadata;
    }

    if (result.awaitUserResponse === true) {
      payload.awaitUserResponse = true;
    }

    return JSON.stringify(payload, null, 2);
  }
}
