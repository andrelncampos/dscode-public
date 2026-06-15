import type {
  McpToolDefinition,
  CallToolResult,
  McpPromptDefinition,
  McpPromptMessage,
  McpResourceDefinition,
  McpResourceContent,
} from "./mcp-client";
import pkg from "../../package.json" with { type: "json" };

export class McpHttpClient {
  private url: string;
  private headers: Record<string, string>;
  private connected = false;
  private serverName: string;

  constructor(serverName: string, url: string, headers?: Record<string, string>) {
    this.serverName = serverName;
    this.url = url;
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    };
  }

  async connect(timeoutMs: number): Promise<void> {
    const initResult = await this.sendRequest(
      "initialize",
      {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "dscode", version: pkg.version },
      },
      timeoutMs
    );

    if (initResult && typeof initResult === "object" && "error" in initResult) {
      throw new Error(`MCP initialize error: ${JSON.stringify((initResult as { error: unknown }).error)}`);
    }
    await this.sendRequest("notifications/initialized", {}, timeoutMs);
    this.connected = true;
  }

  async listTools(timeoutMs: number): Promise<McpToolDefinition[]> {
    const result = await this.sendRequest("tools/list", {}, timeoutMs);
    if (result && typeof result === "object" && "tools" in result) {
      return (result as { tools: McpToolDefinition[] }).tools;
    }
    return [];
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<CallToolResult> {
    const result = await this.sendRequest("tools/call", { name, arguments: args }, timeoutMs ?? 60_000);
    if (result && typeof result === "object" && "content" in result) {
      return result as CallToolResult;
    }
    return { content: [], isError: true };
  }

  async listPrompts(timeoutMs: number): Promise<McpPromptDefinition[]> {
    const result = await this.sendRequest("prompts/list", {}, timeoutMs);
    if (result && typeof result === "object" && "prompts" in result) {
      return (result as { prompts: McpPromptDefinition[] }).prompts;
    }
    return [];
  }

  async getPrompt(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 30_000
  ): Promise<{ description?: string; messages: McpPromptMessage[] }> {
    const result = await this.sendRequest("prompts/get", { name, arguments: args }, timeoutMs);
    if (result && typeof result === "object" && "messages" in result) {
      return result as { description?: string; messages: McpPromptMessage[] };
    }
    return { messages: [] };
  }

  async listResources(timeoutMs: number): Promise<McpResourceDefinition[]> {
    const result = await this.sendRequest("resources/list", {}, timeoutMs);
    if (result && typeof result === "object" && "resources" in result) {
      return (result as { resources: McpResourceDefinition[] }).resources;
    }
    return [];
  }

  async readResource(uri: string, timeoutMs = 30_000): Promise<{ contents: McpResourceContent[] }> {
    const result = await this.sendRequest("resources/read", { uri }, timeoutMs);
    if (result && typeof result === "object" && "contents" in result) {
      return result as { contents: McpResourceContent[] };
    }
    return { contents: [] };
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async sendRequest(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      method,
      params,
    });

    const response = await fetch(`${this.url}/message`, {
      method: "POST",
      headers: this.headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data && typeof data === "object" && "error" in data && data.error) {
      throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
    }

    return data;
  }
}
