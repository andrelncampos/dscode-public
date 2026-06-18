import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { McpClient, type McpToolDefinition, type McpPromptDefinition, type McpResourceDefinition } from "./mcp-client";
import { McpHttpClient } from "./mcp-http-client";
import type { McpPolicy } from "./mcp-policy";
import type { McpServerConfig } from "../settings";

const MCP_STARTUP_TIMEOUT_MS = process.env.DEEPCODE_MCP_TIMEOUT
  ? parseInt(process.env.DEEPCODE_MCP_TIMEOUT, 10)
  : 30_000;
const MCP_CALL_TOOL_TIMEOUT_MS = 60_000;
const API_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const API_TOOL_NAME_MAX_LENGTH = 64;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60_000;

type McpToolEntry = {
  serverName: string;
  originalName: string;
  namespacedName: string;
  definition: McpToolDefinition;
  client: McpClient | McpHttpClient;
  skillName?: string;
};

export type McpServerStatus = {
  name: string;
  status: "starting" | "ready" | "failed" | "reconnecting";
  connected: boolean;
  error?: string;
  toolCount: number;
  tools: string[];
  promptCount: number;
  prompts: string[];
  resourceCount: number;
  resources: string[];
  reconnectAttempt?: number;
  scope?: { kind: string; label: string };
  policyStats?: { allowed: number; total: number };
  disabled?: boolean;
};

export type McpServerScopeKind = "global" | "project" | "session" | "skill" | "spec" | "legacy";

export interface McpServerScope {
  kind: McpServerScopeKind;
  label: string; // e.g. "~/.dscode/mcp.json", "skill: postgres-dba", "spec: 160"
}

export interface McpExecutionRecord {
  timestamp: number; // Date.now() at call time
  toolName: string; // namespaced name (mcp__server__tool)
  originalName: string; // original tool name
  serverName: string; // server name
  ok: boolean; // call result
  error?: string; // error message if !ok
  outputSnippet: string; // first 200 chars of output
  durationMs: number; // call duration
}

export interface McpErrorRecord {
  timestamp: number; // Date.now() when error occurred
  message: string; // error message
}

function buildMcpNamespacedName(
  serverName: string,
  toolName: string,
  usedNames: ReadonlySet<string> = new Set()
): string {
  const rawName = buildRawMcpNamespacedName(serverName, toolName);
  const sanitizedName = `mcp__${sanitizeApiToolNamePart(serverName)}__${sanitizeApiToolNamePart(toolName)}`;
  let candidate = fitApiToolName(sanitizedName, rawName);
  if (!usedNames.has(candidate)) {
    return candidate;
  }
  const hash = hashToolName(rawName);
  candidate = fitApiToolNameWithSuffix(sanitizedName, `_${hash}`);
  if (!usedNames.has(candidate)) {
    return candidate;
  }
  for (let index = 2; ; index += 1) {
    candidate = fitApiToolNameWithSuffix(sanitizedName, `_${hash}_${index}`);
    if (!usedNames.has(candidate)) {
      return candidate;
    }
  }
}

export interface McpCompactToolEntry {
  name: string;
  serverName: string;
  description: string;
  inputSummary: string;
  policyAction: "allow" | "ask" | "deny";
}

export class McpManager {
  private clients: (McpClient | McpHttpClient)[] = [];
  private tools: McpToolEntry[] = [];
  private prompts: Array<{
    serverName: string;
    namespacedName: string;
    definition: McpPromptDefinition;
    client: McpClient | McpHttpClient;
    skillName?: string;
  }> = [];
  private resources: Array<{
    serverName: string;
    namespacedName: string;
    definition: McpResourceDefinition;
    client: McpClient | McpHttpClient;
    skillName?: string;
  }> = [];
  private initialized = false;
  private disposed = false;
  private configuredServerNames: string[] = [];
  private serverStatuses: McpServerStatus[] = [];
  private onToolsListChanged: (() => void) | null = null;
  private onStatusChanged: (() => void) | null = null;
  private serverConfigs: Record<string, McpServerConfig> = {};
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private policy?: McpPolicy;
  private specMcpFilter: Set<string> | null = null;
  private executionHistory = new Map<string, McpExecutionRecord[]>();
  private errorLog = new Map<string, McpErrorRecord[]>();
  private serverScopes = new Map<string, McpServerScope>();

  setPolicy(policy: McpPolicy): void {
    this.policy = policy;
  }

  /** Set the spec-scoped MCP tool filter. Only tools from these server names are visible. */
  setSpecMcpFilter(serverNames: string[] | null): void {
    this.specMcpFilter = serverNames ? new Set(serverNames) : null;
  }

  /** Get current spec filter server names (for audit/logging). */
  getSpecMcpFilter(): string[] | null {
    return this.specMcpFilter ? Array.from(this.specMcpFilter) : null;
  }

  /** Connect MCP servers scoped to a skill. Connections happen in parallel. */
  async initializeSkillServers(skillName: string, servers: Record<string, McpServerConfig>): Promise<void> {
    if (this.disposed) return;
    Object.assign(this.serverConfigs, servers);
    this.prepare(servers);
    for (const name of Object.keys(servers)) {
      this.setServerScope(name, { kind: "skill", label: `skill: ${skillName}` });
    }

    const promises = Object.entries(servers).map(async ([name, config]) => {
      // Skip if server already connected globally (no skillName)
      const hasGlobal = this.tools.some((t) => t.serverName === name && !t.skillName);
      if (hasGlobal) return;
      // Skip if already connected with same skillName (idempotent)
      const hasSkill = this.tools.some((t) => t.serverName === name && t.skillName === skillName);
      if (hasSkill) return;
      await this.connectServer(name, config, skillName);
    });

    await Promise.allSettled(promises);
    this.onToolsListChanged?.();
  }

  /** Disconnect all MCP servers belonging to a skill. */
  disconnectSkillServers(skillName: string): void {
    const skillTools = this.tools.filter((t) => t.skillName === skillName);
    const uniqueClients = new Set(skillTools.map((t) => t.client));
    for (const client of uniqueClients) client.disconnect();
    this.clients = this.clients.filter((c) => !uniqueClients.has(c));
    this.tools = this.tools.filter((t) => t.skillName !== skillName);
    this.prompts = this.prompts.filter((p) => p.skillName !== skillName);
    this.resources = this.resources.filter((r) => r.skillName !== skillName);
    // Remove server configs that belong only to this skill
    for (const name of Object.keys(this.serverConfigs)) {
      const hasOtherRef = this.tools.some((t) => t.serverName === name);
      if (!hasOtherRef) delete this.serverConfigs[name];
    }
    this.onToolsListChanged?.();
  }

  /** Get namespaced tool names for a skill. */
  getSkillToolNames(skillName: string): string[] {
    return this.tools.filter((t) => t.skillName === skillName).map((t) => t.namespacedName);
  }

  /** Get all namespaced MCP tool names across all servers, sorted alphabetically. */
  getAllToolNames(): string[] {
    return [...new Set(this.tools.map((t) => t.namespacedName))].sort();
  }

  /** Get full tool definitions for a skill (for subagent injection). */
  getMcpToolDefinitionsForSkill(skillName: string): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
      };
    };
  }> {
    return this.tools
      .filter((t) => t.skillName === skillName)
      .map((t) => ({
        type: "function" as const,
        function: {
          name: t.namespacedName,
          description: this.buildMcpToolDescription(t),
          parameters: {
            type: "object" as const,
            properties: t.definition.inputSchema.properties,
            required: t.definition.inputSchema.required,
            ...(t.definition.inputSchema.additionalProperties !== undefined
              ? { additionalProperties: t.definition.inputSchema.additionalProperties }
              : {}),
          },
        },
      }));
  }

  prepare(servers?: Record<string, McpServerConfig>, scope?: McpServerScope): void {
    if (!servers || Object.keys(servers).length === 0) return;
    this.disposed = false;
    for (const name of Object.keys(servers)) {
      if (!this.configuredServerNames.includes(name)) {
        this.configuredServerNames.push(name);
      }
      if (scope) this.setServerScope(name, scope);
      if (this.serverStatuses.some((status) => status.name === name)) {
        continue;
      }
      this.setStatus({
        name,
        status: "starting",
        connected: false,
        toolCount: 0,
        tools: [],
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
      });
    }
  }

  async initialize(servers?: Record<string, McpServerConfig>, scope?: McpServerScope): Promise<void> {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    if (!servers || Object.keys(servers).length === 0) return;
    this.serverConfigs = servers;
    this.prepare(servers, scope);
    for (const [name, config] of Object.entries(servers)) {
      if (this.disposed) break;
      await this.connectServer(name, config);
    }
  }

  async reconnect(name: string, config?: McpServerConfig): Promise<void> {
    if (this.disposed) return;
    const effectiveConfig = config ?? this.serverConfigs[name];
    if (!effectiveConfig) return;
    if (config) this.serverConfigs[name] = config;
    this.reconnectAttempts.delete(name);
    this.setStatus({
      name,
      status: "reconnecting",
      connected: false,
      error: "Reconnecting...",
      toolCount: 0,
      tools: [],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
    });
    await this.connectServer(name, effectiveConfig);
  }

  private async connectServer(name: string, config: McpServerConfig, skillName?: string): Promise<void> {
    if (this.disposed) return;
    this.clients = this.clients.filter((c) => c.isConnected());
    this.tools = this.tools.filter((t) => t.serverName !== name);
    this.prompts = this.prompts.filter((p) => p.serverName !== name);
    this.resources = this.resources.filter((r) => r.serverName !== name);

    let client: McpClient | McpHttpClient | null = null;
    try {
      if (config.type === "http" && config.url) {
        client = new McpHttpClient(name, config.url, config.headers);
        await client.connect(MCP_STARTUP_TIMEOUT_MS);
      } else {
        client = new McpClient(
          name,
          config.command,
          config.args ?? [],
          config.env,
          (method) => {
            if (method === "notifications/tools/list_changed") {
              this.refreshServerTools(name, client!).catch(() => {});
            }
          },
          (reason) => {
            if (!this.disposed && this.serverConfigs[name]) {
              this.onServerCrash(name, reason);
            }
          }
        );
        await client.connect(MCP_STARTUP_TIMEOUT_MS);
      }
      if (this.disposed) {
        client.disconnect();
        return;
      }
      this.clients.push(client);

      let serverTools = await client.listTools(MCP_STARTUP_TIMEOUT_MS);
      if (this.disposed) return;

      if (config.disabledTools && config.disabledTools.length > 0) {
        serverTools = serverTools.filter((t) => !config.disabledTools!.includes(t.name));
      }

      const toolNamespacedNames: string[] = [];
      const usedToolNames = new Set(this.tools.map((tool) => tool.namespacedName));
      for (const tool of serverTools) {
        const namespacedName = buildMcpNamespacedName(name, tool.name, usedToolNames);
        usedToolNames.add(namespacedName);
        this.tools.push({
          serverName: name,
          originalName: tool.name,
          namespacedName,
          definition: tool,
          client,
          ...(skillName ? { skillName } : {}),
        });
        toolNamespacedNames.push(namespacedName);
      }

      let serverPrompts: McpPromptDefinition[] = [];
      try {
        serverPrompts = await client.listPrompts(MCP_STARTUP_TIMEOUT_MS);
      } catch {
        /* not supported */
      }
      if (this.disposed) return;
      const promptNamespacedNames: string[] = [];
      for (const prompt of serverPrompts) {
        const namespacedName = `mcp__${name}__${prompt.name}`;
        this.prompts.push({
          serverName: name,
          namespacedName,
          definition: prompt,
          client,
          ...(skillName ? { skillName } : {}),
        });
        promptNamespacedNames.push(namespacedName);
      }

      let serverResources: McpResourceDefinition[] = [];
      try {
        serverResources = await client.listResources(MCP_STARTUP_TIMEOUT_MS);
      } catch {
        /* not supported */
      }
      if (this.disposed) return;
      const resourceNamespacedNames: string[] = [];
      for (const resource of serverResources) {
        const namespacedName = `mcp__${name}__${resource.name}`;
        this.resources.push({
          serverName: name,
          namespacedName,
          definition: resource,
          client,
          ...(skillName ? { skillName } : {}),
        });
        resourceNamespacedNames.push(namespacedName);
      }

      this.reconnectAttempts.delete(name);
      this.setStatus({
        name,
        status: "ready",
        connected: true,
        toolCount: serverTools.length,
        tools: toolNamespacedNames,
        promptCount: serverPrompts.length,
        prompts: promptNamespacedNames,
        resourceCount: serverResources.length,
        resources: resourceNamespacedNames,
      });
    } catch (err) {
      client?.disconnect();
      const message = err instanceof Error ? err.message : String(err);
      this.recordError(name, message);
      this.setStatus({
        name,
        status: "failed",
        connected: false,
        error: message,
        toolCount: 0,
        tools: [],
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
      });
    }
  }

  private onServerCrash(name: string, reason: string): void {
    if (this.disposed) return;
    this.clients = this.clients.filter((c) => c.isConnected());
    this.tools = this.tools.filter((t) => t.serverName !== name);
    this.prompts = this.prompts.filter((p) => p.serverName !== name);
    this.resources = this.resources.filter((r) => r.serverName !== name);
    this.onToolsListChanged?.();

    const attempt = this.reconnectAttempts.get(name) ?? 0;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      this.recordError(name, reason);
      this.setStatus({
        name,
        status: "failed",
        connected: false,
        error: reason,
        toolCount: 0,
        tools: [],
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
        reconnectAttempt: attempt,
      });
      return;
    }
    this.scheduleReconnect(name);
  }

  private scheduleReconnect(name: string): void {
    const existing = this.reconnectTimers.get(name);
    if (existing) clearTimeout(existing);

    const attempt = this.reconnectAttempts.get(name) ?? 0;
    const delay = Math.min(INITIAL_RECONNECT_DELAY_MS * Math.pow(2, attempt), MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts.set(name, attempt + 1);

    this.setStatus({
      name,
      status: "reconnecting",
      connected: false,
      error: `Reconnecting in ${delay}ms...`,
      toolCount: 0,
      tools: [],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
      reconnectAttempt: attempt,
    });

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(name);
      if (this.disposed) return;
      const config = this.serverConfigs[name];
      if (config) this.connectServer(name, config).catch(() => {});
    }, delay);

    this.reconnectTimers.set(name, timer);
  }

  getStatus(): McpServerStatus[] {
    const result = [...this.serverStatuses];
    const knownNames = new Set(result.map((s) => s.name));
    for (const name of this.configuredServerNames) {
      if (!knownNames.has(name)) {
        result.push({
          name,
          status: "starting",
          connected: false,
          toolCount: 0,
          tools: [],
          promptCount: 0,
          prompts: [],
          resourceCount: 0,
          resources: [],
        });
      }
    }
    for (const status of result) {
      status.scope = this.getServerScope(status.name);
      status.policyStats = this.getServerPolicyStats(status.name);
    }
    return result;
  }

  getMcpToolDefinitions(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
      };
    };
  }> {
    return this.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.namespacedName,
        description: this.buildMcpToolDescription(t),
        parameters: {
          type: "object" as const,
          properties: t.definition.inputSchema.properties,
          required: t.definition.inputSchema.required,
          ...(t.definition.inputSchema.additionalProperties !== undefined
            ? { additionalProperties: t.definition.inputSchema.additionalProperties }
            : {}),
        },
      },
    }));
  }

  getMcpToolCompactInventory(): McpCompactToolEntry[] {
    return this.tools.map((t) => ({
      name: t.namespacedName,
      serverName: t.serverName,
      description: t.definition.description ?? `${t.serverName}: ${t.originalName}`,
      inputSummary: buildInputSummary(t.definition.inputSchema),
      policyAction: this.policy?.evaluate(t.namespacedName) ?? "ask",
    }));
  }

  getMcpToolFullSchema(name: string): McpToolDefinition | null {
    const tool = this.tools.find((t) => t.namespacedName === name);
    return tool ? tool.definition : null;
  }

  getMcpToolCompactInventoryForPrompt(): McpCompactToolEntry[] {
    return this.getMcpToolCompactInventory().filter((t) => t.policyAction !== "deny");
  }

  getMcpToolDefinitionsForPrompt(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
      };
    };
  }> {
    return this.tools
      .filter((t) => {
        const action = this.policy?.evaluate(t.namespacedName) ?? "ask";
        return action !== "deny";
      })
      .filter((t) => !this.specMcpFilter || this.specMcpFilter.has(t.serverName))
      .map((t) => {
        const action = this.policy?.evaluate(t.namespacedName) ?? "ask";
        const label = action === "allow" ? " [auto-approved]" : " [requires approval]";
        return {
          type: "function" as const,
          function: {
            name: t.namespacedName,
            description: this.buildMcpToolDescription(t) + label,
            parameters: {
              type: "object" as const,
              properties: t.definition.inputSchema.properties,
              required: t.definition.inputSchema.required,
              ...(t.definition.inputSchema.additionalProperties !== undefined
                ? { additionalProperties: t.definition.inputSchema.additionalProperties }
                : {}),
            },
          },
        };
      });
  }

  isMcpTool(name: string): boolean {
    return name.startsWith("mcp__");
  }

  async executeMcpTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = MCP_CALL_TOOL_TIMEOUT_MS,
    auditContext?: { specNumber: string }
  ): Promise<{ ok: boolean; name: string; output?: string; error?: string }> {
    const auditStartMs = auditContext ? Date.now() : 0;
    const tool = this.tools.find((t) => t.namespacedName === name);
    if (!tool) return { ok: false, name, error: `Unknown MCP tool: ${name}` };
    try {
      const result = await tool.client.callTool(tool.originalName, args, timeoutMs);
      const text = result.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
      const r = { ok: !result.isError, name, output: text || JSON.stringify(result.content) };
      this.recordExecution({
        timestamp: auditStartMs || Date.now(),
        toolName: name,
        originalName: tool.originalName,
        serverName: tool.serverName,
        ok: !result.isError,
        outputSnippet: (text || JSON.stringify(result.content) || "").slice(0, 200),
        durationMs: Date.now() - (auditStartMs || Date.now()),
      });
      if (auditContext) {
        const durationMs = Date.now() - auditStartMs;
        console.log(`[MCP-AUDIT spec=${auditContext.specNumber}] tool=${name} result=ok duration=${durationMs}ms`);
      }
      return r;
    } catch (err) {
      const r = { ok: false, name, error: err instanceof Error ? err.message : String(err) };
      this.recordExecution({
        timestamp: auditStartMs || Date.now(),
        toolName: name,
        originalName: tool.originalName,
        serverName: tool.serverName,
        ok: false,
        error: r.error,
        outputSnippet: "",
        durationMs: Date.now() - (auditStartMs || Date.now()),
      });
      if (auditContext) {
        const durationMs = Date.now() - auditStartMs;
        console.log(`[MCP-AUDIT spec=${auditContext.specNumber}] tool=${name} result=error duration=${durationMs}ms`);
      }
      return r;
    }
  }

  async getMcpPrompt(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; name: string; output?: string; error?: string }> {
    const prompt = this.prompts.find((p) => p.namespacedName === name);
    if (!prompt) return { ok: false, name, error: `Unknown MCP prompt: ${name}` };
    try {
      const result = await prompt.client.getPrompt(prompt.definition.name, args);
      const text = result.messages
        .filter((m) => m.content.type === "text" && m.content.text)
        .map((m) => `[${m.role}] ${m.content.text}`)
        .join("\n");
      return { ok: true, name, output: text || JSON.stringify(result) };
    } catch (err) {
      return { ok: false, name, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async readMcpResource(
    name: string,
    uri: string
  ): Promise<{ ok: boolean; name: string; output?: string; error?: string }> {
    const resource = this.resources.find((r) => r.namespacedName === name);
    if (!resource) return { ok: false, name, error: `Unknown MCP resource: ${name}` };
    try {
      const result = await resource.client.readResource(uri);
      const text = result.contents
        .filter((c) => c.text)
        .map((c) => c.text)
        .join("\n");
      return { ok: true, name, output: text || JSON.stringify(result.contents) };
    } catch (err) {
      return { ok: false, name, error: err instanceof Error ? err.message : String(err) };
    }
  }

  disconnect(): void {
    this.disposed = true;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
    for (const client of this.clients) client.disconnect();
    this.clients = [];
    this.tools = [];
    this.prompts = [];
    this.resources = [];
    this.serverStatuses = [];
    this.configuredServerNames = [];
    this.serverConfigs = {};
    this.initialized = false;
    this.executionHistory.clear();
    this.errorLog.clear();
    this.serverScopes.clear();
  }

  // ── Execution History ──────────────────────────────────────────────────

  recordExecution(record: McpExecutionRecord): void {
    const arr = this.executionHistory.get(record.serverName) ?? [];
    arr.push(record);
    if (arr.length > 100) arr.splice(0, arr.length - 100);
    this.executionHistory.set(record.serverName, arr);
  }

  getExecutionHistory(serverName: string): McpExecutionRecord[] {
    return (this.executionHistory.get(serverName) ?? []).slice().reverse();
  }

  getAllExecutionHistory(): Map<string, McpExecutionRecord[]> {
    return new Map(this.executionHistory);
  }

  // ── Error Log ──────────────────────────────────────────────────────────

  recordError(serverName: string, message: string): void {
    const arr = this.errorLog.get(serverName) ?? [];
    arr.push({ timestamp: Date.now(), message });
    if (arr.length > 50) arr.splice(0, arr.length - 50);
    this.errorLog.set(serverName, arr);
  }

  getErrorLog(serverName: string): McpErrorRecord[] {
    return (this.errorLog.get(serverName) ?? []).slice().reverse();
  }

  getAllErrorLogs(): Map<string, McpErrorRecord[]> {
    return new Map(this.errorLog);
  }

  // ── Scope Tracking ─────────────────────────────────────────────────────

  setServerScope(name: string, scope: McpServerScope): void {
    this.serverScopes.set(name, scope);
  }

  getServerScope(name: string): McpServerScope | undefined {
    return this.serverScopes.get(name);
  }

  // ── Policy Stats ───────────────────────────────────────────────────────

  getServerPolicyStats(serverName: string): { allowed: number; total: number } {
    const serverTools = this.tools.filter((t) => t.serverName === serverName);
    const total = serverTools.length;
    const allowed = serverTools.filter((t) => this.policy?.evaluate(t.namespacedName) === "allow").length;
    return { allowed, total };
  }

  // ── Disconnect Single Server ───────────────────────────────────────────

  disconnectServer(name: string, keepDisabledStatus = false): void {
    this.tools = this.tools.filter((t) => t.serverName !== name);
    this.prompts = this.prompts.filter((p) => p.serverName !== name);
    this.resources = this.resources.filter((r) => r.serverName !== name);
    this.clients = this.clients.filter((c) => {
      const stillUsed =
        this.tools.some((t) => t.client === c) ||
        this.prompts.some((p) => p.client === c) ||
        this.resources.some((r) => r.client === c);
      if (!stillUsed) c.disconnect();
      return stillUsed;
    });
    delete this.serverConfigs[name];
    if (!keepDisabledStatus) {
      this.configuredServerNames = this.configuredServerNames.filter((n) => n !== name);
      this.serverStatuses = this.serverStatuses.filter((s) => s.name !== name);
    } else {
      const existing = this.serverStatuses.find((s) => s.name === name);
      if (existing) {
        existing.connected = false;
        existing.disabled = true;
        existing.toolCount = 0;
        existing.tools = [];
        existing.promptCount = 0;
        existing.prompts = [];
        existing.resourceCount = 0;
        existing.resources = [];
      }
    }
    this.serverScopes.delete(name);
    this.executionHistory.delete(name);
    this.errorLog.delete(name);
    const timer = this.reconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }
    this.onToolsListChanged?.();
    this.onStatusChanged?.();
  }

  // ── Steering Rule Management ───────────────────────────────────────────

  addSteeringRule(projectRoot: string, action: "allow" | "deny", toolName: string): void {
    if (!toolName.startsWith("mcp__")) return;
    const agentsPath = path.join(projectRoot, "AGENTS.md");
    let content: string;
    try {
      content = fs.readFileSync(agentsPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        fs.writeFileSync(agentsPath, `## Steering\n\n- MCP: ${action} ${toolName}\n`, "utf8");
        this.policy?.reload([`- MCP: ${action} ${toolName}`]);
        return;
      }
      throw err;
    }

    const steeringIdx = content.indexOf("\n## Steering\n");
    const newLine = `- MCP: ${action} ${toolName}`;

    if (steeringIdx === -1) {
      // No Steering section — append at end
      fs.writeFileSync(agentsPath, `${content}\n## Steering\n\n${newLine}\n`, "utf8");
      this.policy?.reload([newLine]);
      return;
    }

    // Find end of Steering section
    const sectionStart = steeringIdx + 1;
    const nextHeadingIdx = content.indexOf("\n## ", sectionStart + 1);
    const before = content.slice(0, sectionStart);
    const section = content.slice(sectionStart, nextHeadingIdx === -1 ? undefined : nextHeadingIdx);
    const after = nextHeadingIdx === -1 ? "" : content.slice(nextHeadingIdx);

    // Check for duplicates
    if (section.includes(newLine)) return;

    // Append the new rule
    const newSection = section.endsWith("\n") ? `${section}${newLine}\n` : `${section}\n${newLine}\n`;
    fs.writeFileSync(agentsPath, `${before}${newSection}${after}`, "utf8");
    this.policy?.reload(this.extractSteeringLines(section + newLine + "\n"));
  }

  removeSteeringRule(projectRoot: string, toolName: string): void {
    const agentsPath = path.join(projectRoot, "AGENTS.md");
    let content: string;
    try {
      content = fs.readFileSync(agentsPath, "utf8");
    } catch {
      return;
    }

    const steeringIdx = content.indexOf("\n## Steering\n");
    if (steeringIdx === -1) return;

    const sectionStart = steeringIdx + 1;
    const nextHeadingIdx = content.indexOf("\n## ", sectionStart + 1);
    const before = content.slice(0, sectionStart);
    const section = content.slice(sectionStart, nextHeadingIdx === -1 ? undefined : nextHeadingIdx);
    const after = nextHeadingIdx === -1 ? "" : content.slice(nextHeadingIdx);

    // Remove exact-match lines
    const newSection = section
      .split("\n")
      .filter((line) => !line.startsWith(`- MCP: allow ${toolName}`) && !line.startsWith(`- MCP: deny ${toolName}`))
      .join("\n");

    if (newSection !== section.replace(/\n$/, "")) {
      fs.writeFileSync(agentsPath, `${before}${newSection}\n${after}`, "utf8");
      this.policy?.reload(this.extractSteeringLines(newSection));
    }
  }

  private extractSteeringLines(text: string): string[] {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- MCP:"));
  }

  private async refreshServerTools(serverName: string, client: McpClient | McpHttpClient): Promise<void> {
    const serverTools = await client.listTools(MCP_STARTUP_TIMEOUT_MS);
    this.tools = this.tools.filter((t) => t.serverName !== serverName);
    const toolNamespacedNames: string[] = [];
    const usedToolNames = new Set(this.tools.map((tool) => tool.namespacedName));
    for (const tool of serverTools) {
      const namespacedName = buildMcpNamespacedName(serverName, tool.name, usedToolNames);
      usedToolNames.add(namespacedName);
      this.tools.push({ serverName, originalName: tool.name, namespacedName, definition: tool, client });
      toolNamespacedNames.push(namespacedName);
    }
    const existing = this.serverStatuses.find((s) => s.name === serverName);
    if (existing) {
      existing.toolCount = serverTools.length;
      existing.tools = toolNamespacedNames;
    }
    this.onToolsListChanged?.();
  }

  setOnToolsListChanged(handler: () => void): void {
    this.onToolsListChanged = handler;
  }
  setOnStatusChanged(handler: () => void): void {
    this.onStatusChanged = handler;
  }

  private setStatus(status: McpServerStatus): void {
    if (this.disposed) return;
    const index = this.serverStatuses.findIndex((s) => s.name === status.name);
    if (index === -1) this.serverStatuses.push(status);
    else this.serverStatuses[index] = status;
    this.onStatusChanged?.();
  }

  private buildMcpToolDescription(tool: McpToolEntry): string {
    const description = tool.definition.description?.trim();
    const source = `${tool.serverName}: ${tool.originalName}`;
    if (!description) return source;
    if (tool.namespacedName === buildRawMcpNamespacedName(tool.serverName, tool.originalName)) return description;
    return `${description}\nMCP source: ${source}`;
  }
}

function buildRawMcpNamespacedName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}
function sanitizeApiToolNamePart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized || "unnamed";
}
function fitApiToolName(name: string, rawName: string): string {
  if (API_TOOL_NAME_PATTERN.test(name) && name.length <= API_TOOL_NAME_MAX_LENGTH) return name;
  return fitApiToolNameWithSuffix(name, `_${hashToolName(rawName)}`);
}
function fitApiToolNameWithSuffix(name: string, suffix: string): string {
  const maxPrefixLength = API_TOOL_NAME_MAX_LENGTH - suffix.length;
  const prefix = name.slice(0, Math.max(1, maxPrefixLength));
  return `${prefix}${suffix}`;
}
function hashToolName(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function buildInputSummary(schema: { properties: Record<string, unknown> }): string {
  const keys = Object.keys(schema.properties ?? {});
  if (keys.length === 0) return "params: (none)";
  const joined = keys.slice(0, 20).join(", ");
  const prefix = `params: ${joined}`;
  return prefix.length > 120 ? prefix.slice(0, 117) + "..." : prefix;
}
