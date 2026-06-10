/**
 * Retry logic for transient API failures.
 *
 * Only retries on:
 *  - HTTP 429 (rate limit)
 *  - HTTP 502 (bad gateway)
 *  - HTTP 503 (service unavailable)
 *  - Network errors (ECONNRESET, ETIMEDOUT, etc.)
 *  - AbortError from timeout (not user-initiated abort)
 *
 * Never retries on:
 *  - HTTP 400 (bad request) — the request is invalid
 *  - HTTP 401/403 (unauthorized) — the key is wrong
 *  - HTTP 404 (not found) — the endpoint doesn't exist
 *  - User-initiated AbortError — the user cancelled
 */

export type RetryOptions = {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default: 1000 */
  baseDelayMs?: number;
  /** Maximum delay cap in ms. Default: 16000 (16s) */
  maxDelayMs?: number;
  /** Optional signal to detect user-initiated abort vs timeout abort */
  userSignal?: AbortSignal;
};

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503]);

function isRetryableError(error: unknown, options: RetryOptions): boolean {
  // User-initiated abort — never retry
  if (options.userSignal?.aborted) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  // Network/timeout errors
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    // Only retry abort errors if they're NOT from the user signal
    return !options.userSignal?.aborted;
  }

  // Check for HTTP status codes in the error message or cause chain
  const message = error.message ?? "";
  const cause = (error as { cause?: { status?: number } }).cause;

  // OpenAI SDK errors have status in cause
  if (typeof cause?.status === "number" && RETRYABLE_STATUS_CODES.has(cause.status)) {
    return true;
  }

  // Fallback: check error message for status codes
  if (message.includes("429") || message.includes("502") || message.includes("503")) {
    return true;
  }

  // Network errors
  if (
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("EAI_AGAIN")
  ) {
    return true;
  }

  return false;
}

function delayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  // Add jitter: ±25%
  const jitter = exponential * 0.25 * (Math.random() * 2 - 1);
  return Math.min(exponential + jitter, maxDelayMs);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Execute an async operation with retry on transient failures.
 *
 * Uses exponential backoff with jitter: 1s → 2s → 4s (capped at maxDelayMs).
 * Only retries on retryable errors (429, 502, 503, network errors).
 *
 * @param fn       The async operation to retry.
 * @param options  Retry configuration.
 * @returns        The result of `fn`.
 * @throws         The last error if all attempts are exhausted, or immediately
 *                 for non-retryable errors.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 16000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts) {
        break;
      }

      if (!isRetryableError(error, options)) {
        throw error;
      }

      const waitMs = delayMs(attempt, baseDelayMs, maxDelayMs);
      try {
        await sleep(waitMs, options.userSignal);
      } catch {
        // User aborted during sleep — throw immediately
        throw error;
      }
    }
  }

  throw lastError;
}
