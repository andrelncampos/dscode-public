import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { maskSensitive } from "./sensitive-data";

const DEBUG_LOG_FILE = "debug.log";

const MAX_STRING_LENGTH = 200;
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const LOG_FILE_PERMISSIONS = 0o600;

let debugLogWarningEmitted = false;

export type OpenAIChatCompletionDebugEntry = {
  timestamp: string;
  location: string;
  requestId?: string;
  sessionId?: string;
  model?: string;
  baseURL?: string;
  durationMs?: number;
  params?: Record<string, unknown>;
  request: Record<string, unknown>;
  response?: unknown;
  responseChunks?: unknown[];
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
};

// ── Shared utilities (also used by error-logger.ts) ──────────────

/**
 * Recursively truncate all string values in an object tree to `maxLength`
 * characters.  Returns a new object — never mutates the original.
 *
 * Truncated strings are formatted as:
 *   "{first maxLength chars}...(total {original length} chars)"
 */
export function truncateStrings(obj: unknown, maxLength: number): unknown {
  if (typeof obj === "string") {
    if (obj.length <= maxLength) {
      return obj;
    }
    return `${obj.slice(0, maxLength)}...(total ${obj.length} chars)`;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => truncateStrings(item, maxLength));
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = truncateStrings(val, maxLength);
    }
    return result;
  }

  return obj;
}

/**
 * Apply restrictive file permissions (owner read/write only).
 * Silently ignores errors (e.g. on Windows where chmod is limited).
 */
export function ensureRestrictivePermissions(filePath: string): void {
  try {
    fs.chmodSync(filePath, LOG_FILE_PERMISSIONS);
  } catch {
    // Ignore — platform may not support chmod (Windows) or we lack privileges.
  }
}

/**
 * Rotate a log file if it exceeds `maxSizeBytes`.
 * Renames current file to `<filePath>.old` (overwriting any previous .old)
 * so the next write creates a fresh file.
 */
export function rotateLogIfNeeded(filePath: string, maxSizeBytes: number): void {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > maxSizeBytes) {
        const oldPath = `${filePath}.old`;
        fs.renameSync(filePath, oldPath);
      }
    }
  } catch {
    // Ignore rotation failures — logging must not break the CLI.
  }
}

// ── Debug logger ─────────────────────────────────────────────────

export function logOpenAIChatCompletionDebug(entry: OpenAIChatCompletionDebugEntry): void {
  try {
    if (!debugLogWarningEmitted) {
      debugLogWarningEmitted = true;
      const logPath = getDebugLogPath();
      console.warn(
        `[dscode] DEBUG LOGGING ENABLED. Code and prompts will be written to ${logPath}.\n` +
          `Disable by setting debugLogEnabled=false in settings.json or unset DEEPCODE_DEBUG_LOG_ENABLED.`
      );
    }

    const logPath = getDebugLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    rotateLogIfNeeded(logPath, MAX_LOG_SIZE_BYTES);

    const sanitized = truncateStrings(maskSensitive(entry), MAX_STRING_LENGTH);
    fs.appendFileSync(logPath, `${JSON.stringify(sanitized)}\n`, "utf8");

    ensureRestrictivePermissions(logPath);
  } catch {
    // Debug logging must never affect CLI behavior.
  }
}

export function getDebugLogPath(): string {
  return path.join(os.homedir(), ".dscode", "logs", DEBUG_LOG_FILE);
}

export function normalizeDebugError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: "UnknownError",
    message: String(error),
  };
}
