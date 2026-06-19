import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { maskSensitive, maskSensitiveString } from "./sensitive-data";
import { ensureRestrictivePermissions, rotateLogIfNeeded, truncateStrings } from "./debug-logger";
import { getErrorMessage } from "./error-utils";

const LOG_DIR = path.join(os.homedir(), ".dscode", "logs");
const ERROR_LOG_PATH = path.join(LOG_DIR, "error.log");

const MAX_STRING_LENGTH = 200;
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export type ApiErrorLogEntry = {
  timestamp: string;
  location: string;
  requestId: string;
  sessionId?: string;
  model?: string;
  baseURL?: string;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
  category?: string;
  request: Record<string, unknown>;
  response?: unknown;
};

/** Inspect a caught API error and return a user-friendly category string. */
export function classifyApiError(err: unknown): string {
  let status: number | undefined;
  let message: string;
  let code: string | undefined;

  if (err instanceof Error) {
    message = err.message;
    code = (err as NodeJS.ErrnoException).code;
    status = (err as unknown as Record<string, unknown>).status as number | undefined;
    if (status === undefined) {
      const resp = (err as unknown as Record<string, unknown>).response as Record<string, unknown> | undefined;
      status = resp?.status as number | undefined;
    }
  } else if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    message = typeof e.message === "string" ? e.message : String(err);
    status = typeof e.status === "number" ? e.status : undefined;
    code = typeof e.code === "string" ? e.code : undefined;
    if (status === undefined) {
      const resp = e.response as Record<string, unknown> | undefined;
      status = resp?.status as number | undefined;
    }
  } else if (typeof err === "string") {
    message = err;
  } else {
    return "Unknown error: (no details)";
  }

  // Network errors (no HTTP status)
  if (status === undefined && code !== undefined) {
    if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "ECONNRESET") {
      return "Network error — check your connection";
    }
  }

  // HTTP status-based classification
  if (status !== undefined) {
    if (status === 401) return "Authentication failed — check your API key";
    if (status === 403) return "Access denied — your account may lack access to this model";
    if (status === 404) return "Model not found — the model name may be incorrect or unavailable in your region";
    if (status === 429) return "Rate limit exceeded — wait and retry";
    if (status === 413) return "Request too large — reduce input size";
    if (status === 400 && /context|length/i.test(message)) {
      return "Context length exceeded — reduce conversation size";
    }
    if (status >= 400 && status < 500) return `Client error (HTTP ${status}): ${message}`;
    if (status >= 500) return `Provider server error (HTTP ${status}) — the API may be down`;
  }

  return `Unknown error: ${message}`;
}

/**
 * Write an API error log entry to ~/.dscode/logs/error.log.
 */
export function logApiError(entry: ApiErrorLogEntry): void {
  try {
    ensureLogDir();

    const logLine: Record<string, unknown> = {
      timestamp: entry.timestamp,
      location: entry.location,
      requestId: entry.requestId,
      sessionId: entry.sessionId,
      model: entry.model,
      baseURL: entry.baseURL,
      error: {
        name: entry.error.name,
        message: maskSensitiveString(entry.error.message),
        stack: entry.error.stack ? maskSensitiveString(entry.error.stack) : undefined,
      },
      request: truncateStrings(maskSensitive(entry.request), MAX_STRING_LENGTH),
      category: entry.category,
    };

    if (entry.response !== undefined) {
      const masked =
        typeof entry.response === "string" ? maskSensitiveString(entry.response) : maskSensitive(entry.response);
      logLine.response = truncateStrings(masked, MAX_STRING_LENGTH);
    }

    const newLine = JSON.stringify(logLine) + "\n";
    fs.appendFileSync(ERROR_LOG_PATH, newLine, "utf8");

    // Size-based rotation
    rotateLogIfNeeded(ERROR_LOG_PATH, MAX_LOG_SIZE_BYTES);

    // Count-based rotation: keep only the last N entries
    const MAX_ENTRIES = 20;
    const raw = fs.readFileSync(ERROR_LOG_PATH, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length > MAX_ENTRIES) {
      fs.writeFileSync(ERROR_LOG_PATH, lines.slice(-MAX_ENTRIES).join("\n") + "\n", "utf8");
    }

    ensureRestrictivePermissions(ERROR_LOG_PATH);
  } catch (logErr: unknown) {
    try {
      const msg = getErrorMessage(logErr);
      process.stderr.write(`[dscode] Failed to write to error log: ${msg}\n`);
    } catch {
      // Last resort: even stderr failed. Nothing more we can do.
    }
  }
}
