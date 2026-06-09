/**
 * Deterministic secret redaction for turn transcripts.
 *
 * Masks patterns that look like API keys, tokens, and credentials
 * before persisting turn data to disk.
 */

const BEARER_PATTERN = /(bearer\s+)([A-Za-z0-9_\-+=./]{20,})/gi;
const BASIC_AUTH_PATTERN = /(basic\s+)([A-Za-z0-9+/=]{20,})/gi;
const API_KEY_PATTERN = /(api[_-]?key[\s:=]+)([A-Za-z0-9_\-+=./]{16,})/gi;
const SENSITIVE_KEY_PATTERN =
  /(?:^|[\s,;])((?:token|secret|password|apikey|api_key|access_key|private_key)[\s:=]+)([^\s,;]{8,})/gim;
const OPENAI_KEY_PATTERN = /(sk-[A-Za-z0-9_-]{20,})/g;
const GITHUB_TOKEN_PATTERN = /(ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g;
const GITLAB_TOKEN_PATTERN = /(glpat-[A-Za-z0-9_-]{20,})/g;
const ENV_VAR_SECRET_PATTERN = /(?:^|[\s;])((?:[A-Za-z0-9]+_)?(?:API_KEY|TOKEN|SECRET|PASSWORD)=)([^\s;]{8,})/gim;
const X_API_KEY_PATTERN = /(x-api-key[\s:]+)([A-Za-z0-9_\-+=./]{16,})/gi;
const JSON_SECRET_PATTERN = /("(?:api_key|apikey|token|secret|password|access_key|private_key)"\s*:\s*")([^"]{8,})/gi;
const CLI_FLAG_SECRET_PATTERN = /(--(?:password|token|api-key|apikey|secret)\s+)([^\s]{8,})/gi;

const MASK = "[REDACTED]";

/**
 * Redact secrets from arbitrary text. Returns the sanitised string.
 * Only masks values — never removes structural characters.
 */
export function redactSecrets(input: string): string {
  let result = input;

  // Order matters: more specific patterns first to avoid partial matches
  result = result.replace(BEARER_PATTERN, (_full, prefix: string, _token: string) => `${prefix}${MASK}`);
  result = result.replace(BASIC_AUTH_PATTERN, (_full, prefix: string, _token: string) => `${prefix}${MASK}`);
  result = result.replace(OPENAI_KEY_PATTERN, (_full, _key: string) => MASK);
  result = result.replace(GITHUB_TOKEN_PATTERN, (_full, _token: string) => MASK);
  result = result.replace(GITLAB_TOKEN_PATTERN, (_full, _token: string) => MASK);
  result = result.replace(X_API_KEY_PATTERN, (_full, prefix: string, _value: string) => `${prefix}${MASK}`);
  result = result.replace(JSON_SECRET_PATTERN, (_full, prefix: string, _value: string) => `${prefix}${MASK}`);
  result = result.replace(API_KEY_PATTERN, (_full, prefix: string, _value: string) => `${prefix}${MASK}`);
  result = result.replace(CLI_FLAG_SECRET_PATTERN, (_full, prefix: string, _value: string) => `${prefix}${MASK}`);
  result = result.replace(ENV_VAR_SECRET_PATTERN, (_full, prefix: string, _value: string) => `${prefix}${MASK}`);
  result = result.replace(SENSITIVE_KEY_PATTERN, (_full, prefix: string, _value: string) => `${prefix}${MASK}`);

  return result;
}

/**
 * Redact secrets from an object's string values (shallow).
 * Returns a new object; does not mutate the original.
 */
export function redactSecretsInObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (typeof value === "string") {
      (result as Record<string, unknown>)[key] = redactSecrets(value);
    }
  }
  return result;
}
