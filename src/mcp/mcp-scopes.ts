import * as fs from "node:fs";
import * as os from "node:os";
import type { McpServerConfig } from "../settings";
import { getErrorMessage } from "../common/error-utils.js";

export class McpScopeResolver {
  private globalPath: string;
  private projectPath: string;
  private sessionServers: Record<string, McpServerConfig> = {};
  private skillServers = new Map<string, Record<string, McpServerConfig>>();

  constructor(globalPath?: string, projectPath?: string) {
    this.globalPath = globalPath ?? `${os.homedir()}/.dscode/mcp.json`;
    this.projectPath = projectPath ?? "";
  }

  /** Return effective server config from all scopes + legacy fallback. */
  resolve(legacyServers?: Record<string, McpServerConfig>): Record<string, McpServerConfig> {
    const result: Record<string, McpServerConfig> = {};

    // Layer 1 (lowest): legacy servers from settings.json
    if (legacyServers) {
      Object.assign(result, legacyServers);
    }

    // Layer 2: global config
    const global = this.readConfigFile(this.globalPath);
    if (global) Object.assign(result, global);

    // Layer 3: project config
    if (this.projectPath) {
      const project = this.readConfigFile(this.projectPath);
      if (project) Object.assign(result, project);
    }

    // Layer 3.5: skill servers (between project and session)
    for (const [, servers] of this.skillServers) {
      Object.assign(result, servers);
    }

    // Layer 4 (highest): session servers
    Object.assign(result, this.sessionServers);

    // Remove disabled servers
    for (const name of Object.keys(result)) {
      if (result[name].disabled === true) {
        delete result[name];
      }
    }

    return result;
  }

  /** Add/override a server for current session only. */
  addSessionServer(name: string, config: McpServerConfig): void {
    this.sessionServers[name] = config;
  }

  /** Remove a session-scoped server. */
  removeSessionServer(name: string): void {
    delete this.sessionServers[name];
  }

  /** Register skill-scoped servers. Last-added wins on name collision within the skill layer. */
  addSkillServers(skillName: string, servers: Record<string, McpServerConfig>): void {
    this.skillServers.set(skillName, { ...servers });
  }

  /** Remove all servers registered by a skill. */
  removeSkillServers(skillName: string): void {
    this.skillServers.delete(skillName);
  }

  /** Get names of skills that currently have servers registered. */
  getActiveSkillNames(): string[] {
    return Array.from(this.skillServers.keys());
  }

  /** Re-read config files from disk. File references are re-read on next resolve(). */
  reload(): void {
    // No explicit cache — files are read fresh on each resolve() call.
    // reload() exists for API symmetry; future caching may be added here.
  }

  private readConfigFile(filePath: string): Record<string, McpServerConfig> | null {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        parsed.servers &&
        typeof parsed.servers === "object"
      ) {
        return parsed.servers as Record<string, McpServerConfig>;
      }
      if (!parsed || typeof parsed !== "object" || !("servers" in parsed)) {
        // Missing "servers" key — not a valid mcp.json
        return null;
      }
      return null;
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
        // File not found → empty scope, no error
        return null;
      }
      // JSON parse error or other I/O error
      console.warn(`McpScopeResolver: invalid JSON in ${filePath}: ${getErrorMessage(err)}`);
      return null;
    }
  }
}
