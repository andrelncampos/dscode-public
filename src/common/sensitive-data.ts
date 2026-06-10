// ---------------------------------------------------------------------------
// Centralized sensitive-data redaction for debug and error logging.
// Never mutates original objects — always returns sanitized copies.
// ---------------------------------------------------------------------------

/** Keys that will always have their values replaced with "[REDACTED]". */
const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "apikey",
  "api_key",
  "x-api-key",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "clientsecret",
  "password",
  "cookie",
  "set-cookie",
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

// ---------------------------------------------------------------------------
// String-level regex redaction
// ---------------------------------------------------------------------------

const SENSITIVE_HEADER_RE =
  /(Authorization\s*:\s*)(Bearer|Basic|Digest|HOBA|Mutual|Negotiate|OAuth|SCRAM|vapid)\s+[^\s\r\n]+/gi;

const BEARER_RE = /Bearer\s+[^\s\r\n,;]+/gi;

const BASIC_RE = /Basic\s+[^\s\r\n,;]+/gi;

const OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{10,}\b/g;

const X_API_KEY_HEADER_RE = /(x-api-key\s*:\s*)[^\s\r\n]+/gi;

// Matches key=value or key:value patterns for unambiguously sensitive keys.
// Common English words (token, secret, password) are NOT included here because
// they cause false positives in natural language text. Those are handled by the
// object-key redaction in maskSensitive().
const KEY_VALUE_RE =
  /((?:api[_-]?key|api_key|client_secret|access_token|refresh_token)\s*"?\s*[:=]\s*['"]?)[^'"\s,;}\]>]+/gi;

// ── Additional patterns for turn-memory and CLI output redaction ─────

const GITHUB_TOKEN_RE = /(ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g;

const GITLAB_TOKEN_RE = /(glpat-[A-Za-z0-9_-]{20,})/g;

const ENV_VAR_SECRET_RE = /(?:^|[\s;])((?:[A-Za-z0-9]+_)?(?:API_KEY|TOKEN|SECRET|PASSWORD)=)([^\s;]{8,})/gim;

const JSON_SECRET_RE = /("(?:api_key|apikey|token|secret|password|access_key|private_key)"\s*:\s*")([^"]{8,})/gi;

const CLI_FLAG_SECRET_RE = /(--(?:password|token|api-key|apikey|secret)\s+)([^\s]{8,})/gi;

/**
 * Redact sensitive patterns from a string value.
 * Call this on any string that might contain secrets (headers, URLs, JSON, CLI output, etc.).
 * This is the canonical redaction function — turn-secret-redactor delegates here.
 */
export function maskSensitiveString(text: string): string {
  return text
    .replace(SENSITIVE_HEADER_RE, "$1$2 [REDACTED]")
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(BASIC_RE, "Basic [REDACTED]")
    .replace(OPENAI_KEY_RE, "[REDACTED]")
    .replace(GITHUB_TOKEN_RE, "[REDACTED]")
    .replace(GITLAB_TOKEN_RE, "[REDACTED]")
    .replace(X_API_KEY_HEADER_RE, "$1[REDACTED]")
    .replace(JSON_SECRET_RE, "$1[REDACTED]")
    .replace(KEY_VALUE_RE, "$1[REDACTED]")
    .replace(CLI_FLAG_SECRET_RE, "$1[REDACTED]")
    .replace(ENV_VAR_SECRET_RE, "$1[REDACTED]");
}

// ---------------------------------------------------------------------------
// Object-level deep-clone + redaction
// ---------------------------------------------------------------------------

/**
 * Deep-clone and recursively redact sensitive data.
 *
 * - Sensitive-named keys (authorization, apiKey, token, etc.) → "[REDACTED]"
 * - String values are scanned for embedded secrets
 * - Handles null, primitives, arrays, nested objects, circular refs, Error, bigint
 * - Never mutates the original object
 */
export function maskSensitive(value: unknown): unknown {
  const seen = new WeakSet<object>();

  function walk(current: unknown): unknown {
    if (typeof current === "bigint") {
      return current.toString();
    }
    if (current instanceof Error) {
      return {
        name: current.name,
        message: maskSensitiveString(current.message),
        stack: current.stack ? maskSensitiveString(current.stack) : undefined,
      };
    }
    if (!current || typeof current !== "object") {
      if (typeof current === "string") {
        return maskSensitiveString(current);
      }
      return current;
    }
    if (seen.has(current as object)) {
      return "[Circular]";
    }
    seen.add(current as object);

    if (Array.isArray(current)) {
      return current.map(walk);
    }

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(current)) {
      if (isSensitiveKey(key)) {
        result[key] = "[REDACTED]";
      } else if (typeof val === "string") {
        result[key] = maskSensitiveString(val);
      } else {
        result[key] = walk(val);
      }
    }
    return result;
  }

  return walk(value);
}
