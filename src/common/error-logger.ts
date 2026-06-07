import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { maskSensitive, maskSensitiveString } from "./sensitive-data";
import { ensureRestrictivePermissions, rotateLogIfNeeded, truncateStrings } from "./debug-logger";

const LOG_DIR = path.join(os.homedir(), ".deepcode", "logs");
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
  request: Record<string, unknown>;
  response?: unknown;
};

/**
 * Write an API error log entry to ~/.deepcode/logs/error.log.
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
  } catch {
    // Silently ignore logging failures to avoid disrupting the main flow
  }
}
