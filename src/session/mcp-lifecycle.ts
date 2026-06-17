import type { ToolDefinition } from "../prompt";
import type { McpServerConfig } from "../settings";
import type { McpManager } from "../mcp/mcp-manager";
import type { McpScopeResolver } from "../mcp/mcp-scopes";

export interface SessionMcpLifecycleDeps {
  mcpManager: McpManager;
  mcpScopeResolver: McpScopeResolver;
  onMcpStatusChanged?: () => void;
  projectRoot: string;
}

export class SessionMcpLifecycle {
  private mcpToolDefinitions: ToolDefinition[] = [];

  constructor(private deps: SessionMcpLifecycleDeps) {}

  async initMcpServers(servers?: Record<string, McpServerConfig>): Promise<void> {
    const scopedServers = this.deps.mcpScopeResolver.resolve(servers);
    this.deps.mcpManager.setOnToolsListChanged(() => {
      this.mcpToolDefinitions = this.deps.mcpManager.getMcpToolDefinitions();
    });
    // Set status change callback to notify UI updates
    this.deps.mcpManager.setOnStatusChanged(() => {
      this.deps.onMcpStatusChanged?.();
    });
    await this.deps.mcpManager.initialize(scopedServers);
    this.mcpToolDefinitions = this.deps.mcpManager.getMcpToolDefinitions();
  }

  getMcpStatus() {
    return this.deps.mcpManager.getStatus();
  }

  getMcpManager(): McpManager {
    return this.deps.mcpManager;
  }

  async disableMcpServer(name: string): Promise<void> {
    const scope = this.deps.mcpManager.getServerScope(name);
    if (scope && (scope.kind === "session" || scope.kind === "skill")) {
      throw new Error("Cannot disable session-scoped servers");
    }
    let filePath: string;
    if (scope?.kind === "global") {
      filePath = `${require("node:os").homedir()}/.dscode/mcp.json`;
    } else if (scope?.kind === "project") {
      filePath = `${this.deps.projectRoot}/.dscode/mcp.json`;
    } else {
      // legacy — skip for now, settings.json modification is complex
      return;
    }
    const raw = require("node:fs").readFileSync(filePath, "utf8");
    const config = JSON.parse(raw);
    if (!config.servers) config.servers = {};
    if (!config.servers[name]) config.servers[name] = {};
    config.servers[name].disabled = true;
    require("node:fs").writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf8");
    this.deps.mcpManager.disconnectServer(name, true);
  }

  async reconnectMcpServer(name: string, config?: McpServerConfig): Promise<void> {
    await this.deps.mcpManager.reconnect(name, config);
    this.mcpToolDefinitions = this.deps.mcpManager.getMcpToolDefinitions();
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.mcpToolDefinitions;
  }

  updateToolDefinitions(): void {
    this.mcpToolDefinitions = this.deps.mcpManager.getMcpToolDefinitions();
  }
}
