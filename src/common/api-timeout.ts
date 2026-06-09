/**
 * Default timeout for API requests in milliseconds (3 minutes).
 */
export const DEFAULT_API_TIMEOUT_MS = 180_000;

/**
 * Default timeout for Flash model API requests in milliseconds (3 minutes).
 */
export const FLASH_API_TIMEOUT_MS = 180_000;

/**
 * Default timeout for Pro model API requests in milliseconds (5 minutes).
 */
export const PRO_API_TIMEOUT_MS = 300_000;

/**
 * Minimum allowed API timeout (1 second).
 */
export const MIN_API_TIMEOUT_MS = 1_000;

/**
 * Resolves the API request timeout from the DEEPCODE_API_TIMEOUT_MS
 * environment variable, falling back to DEFAULT_API_TIMEOUT_MS.
 *
 * Model-specific timeout logic has moved to DeepSeekProvider.getTimeoutMs().
 * This function now returns a single global default.
 *
 * Values below MIN_API_TIMEOUT_MS are clamped to the minimum.
 * Invalid values fall back to the global default.
 */
export function resolveApiTimeoutMs(_model?: string): number {
  const raw = process.env.DEEPCODE_API_TIMEOUT_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= MIN_API_TIMEOUT_MS) {
      return Math.round(parsed);
    }
  }

  return DEFAULT_API_TIMEOUT_MS;
}
