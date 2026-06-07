import { z, type ZodError } from "zod";

// ── Shared primitives ────────────────────────────────────────────

const reasoningEffortSchema = z.enum(["high", "max"] as const);

const permissionScopeSchema = z.enum([
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
] as const);

const permissionDefaultModeSchema = z.enum(["allowAll", "askAll"] as const);

// ── Sub-schemas ──────────────────────────────────────────────────

const permissionSettingsSchema = z.object({
  allow: z.array(permissionScopeSchema).optional(),
  deny: z.array(permissionScopeSchema).optional(),
  ask: z.array(permissionScopeSchema).optional(),
  defaultMode: permissionDefaultModeSchema.optional(),
});

const mcpServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

// ── Root schema (strict — rejects unknown keys) ──────────────────

export const deepcodingSettingsSchema = z.strictObject({
  env: z.record(z.string(), z.string()).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  thinkingEnabled: z.boolean().optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  debugLogEnabled: z.boolean().optional(),
  telemetryEnabled: z.boolean().optional(),
  notify: z.string().optional(),
  webSearchTool: z.string().optional(),
  mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),
  permissions: permissionSettingsSchema.optional(),
});

export type DeepcodingSettingsValidated = z.infer<typeof deepcodingSettingsSchema>;

// ── Levenshtein distance for key suggestions ─────────────────────

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/**
 * Suggest a valid key name for an unrecognized key, using
 * Levenshtein distance.  Returns null when no suggestion is close enough.
 */
function suggestKey(unknownKey: string, validKeys: string[]): string | null {
  if (unknownKey.length === 0) return null;

  let bestScore = Infinity;
  let bestKey: string | null = null;

  for (const key of validKeys) {
    const score = levenshtein(unknownKey.toLowerCase(), key.toLowerCase());
    const threshold = Math.min(3, Math.floor(key.length / 2));
    if (score <= threshold && score < bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestKey;
}

// ── Error formatting ─────────────────────────────────────────────

/**
 * Format Zod validation errors as human-readable, colourised stderr
 * output.  Returns the formatted string (does NOT write to stderr itself).
 */
export function formatZodErrors(error: ZodError, filePath: string): string {
  const validKeys = Object.keys(deepcodingSettingsSchema.shape);
  const lines: string[] = [];
  lines.push(`\x1b[33m╔══ Invalid settings.json: ${filePath}\x1b[0m`);

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";

    if (issue.code === "unrecognized_keys") {
      const unknownKeys: string[] = (issue as { keys?: string[] }).keys ?? [];
      for (const key of unknownKeys) {
        const suggestion = suggestKey(key, validKeys);
        const hint = suggestion ? ` (did you mean "\x1b[36m${suggestion}\x1b[0m"?)` : "";
        lines.push(`\x1b[31m║  ✗ unknown key "\x1b[33m${key}\x1b[31m" at \x1b[90m${path}\x1b[31m${hint}\x1b[0m`);
      }
    } else if (issue.code === "invalid_type") {
      const received = formatReceived((issue as { input?: unknown }).input);
      lines.push(
        `\x1b[31m║  ✗ \x1b[90m${path}\x1b[31m: expected \x1b[36m${issue.expected}\x1b[31m, got \x1b[33m${received}\x1b[0m`
      );
    } else if (issue.code === "invalid_value") {
      const received = formatReceived((issue as { input?: unknown }).input);
      const validValues = (issue as { values?: unknown[] }).values?.join(", ") ?? "unknown";
      lines.push(
        `\x1b[31m║  ✗ \x1b[90m${path}\x1b[31m: invalid value \x1b[33m${received}\x1b[31m. Valid: [\x1b[36m${validValues}\x1b[31m]\x1b[0m`
      );
    } else {
      lines.push(`\x1b[31m║  ✗ \x1b[90m${path}\x1b[31m: ${issue.message}\x1b[0m`);
    }
  }

  lines.push(`\x1b[33m╚══ These settings were ignored. Using defaults.\x1b[0m`);
  return lines.join("\n");
}

function formatReceived(value: unknown): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (value === undefined) {
    return "undefined";
  }
  return String(value);
}
