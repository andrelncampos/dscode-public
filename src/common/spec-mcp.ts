import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";
import type { McpServerConfig } from "../settings";

/** Parse MCP server declarations from a spec directory's requirements.md frontmatter. */
export function parseSpecMcp(specDir: string): Record<string, McpServerConfig> | undefined {
  const reqPath = path.join(specDir, "requirements.md");
  let content: string;
  try {
    content = fs.readFileSync(reqPath, "utf8");
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }

  const parsed = matter(content);
  const mcp = parsed.data.mcp;
  if (mcp === undefined || mcp === null) return undefined;
  if (typeof mcp !== "object" || Array.isArray(mcp)) {
    console.warn(`parseSpecMcp: 'mcp' must be an object in ${reqPath}`);
    return undefined;
  }

  const servers = (mcp as Record<string, unknown>).servers;
  if (servers === undefined || servers === null) return undefined;
  if (typeof servers !== "object" || Array.isArray(servers)) {
    console.warn(`parseSpecMcp: 'mcp.servers' must be an object in ${reqPath}`);
    return undefined;
  }

  return servers as Record<string, McpServerConfig>;
}
