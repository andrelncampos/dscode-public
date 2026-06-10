/**
 * Deterministic secret redaction for turn transcripts.
 *
 * Delegates to sensitive-data.ts for the canonical maskSensitiveString,
 * then applies additional turn-specific patterns (token/secret/password in
 * free-form text) that are too aggressive for general debug logs but safe
 * for turn memory where false positives are less harmful than leaks.
 */

import { maskSensitiveString } from "../common/sensitive-data";

/**
 * Additional patterns only applied to turn memory (not general debug logs).
 * These match common English words (token, secret, password) in key=value
 * contexts, which are too prone to false positives in arbitrary debug output
 * but essential for catching secrets in turn transcripts.
 */
const TURN_PATTERN: RegExp =
  /(?:^|[\s,;])((?:token|secret|password|apikey|api_key|access_key|private_key)[\s:=]+)([^\s,;]{8,})/gim;

/**
 * Redact secrets from arbitrary text. Returns the sanitised string.
 * Applies the canonical maskSensitiveString plus turn-specific patterns.
 */
export function redactSecrets(input: string): string {
  return maskSensitiveString(input).replace(TURN_PATTERN, (_full, prefix: string) => `${prefix}[REDACTED]`);
}

/**
 * Redact secrets from an object's string values (shallow).
 * Returns a new object; does not mutate the original.
 */
export function redactSecretsInObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (typeof value === "string") {
      result[key] = redactSecrets(value);
    }
  }
  return result as T;
}
