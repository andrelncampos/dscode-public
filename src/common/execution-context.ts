/**
 * Lightweight execution context using AsyncLocalStorage.
 *
 * Propagates sessionId, requestId, model and turn metadata through
 * the async call chain without manual parameter threading.
 *
 * Set once at the start of each activateSession call, read anywhere
 * downstream (loggers, budget tracker, tool handlers) via getExecCtx().
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type ExecutionCtx = {
  sessionId: string;
  requestId: string;
  model: string;
  baseURL?: string;
  turnNumber: number;
};

const storage = new AsyncLocalStorage<ExecutionCtx>();

/**
 * Run `fn` with the given execution context bound to the current async scope.
 * All synchronous and asynchronous calls within `fn` can retrieve the context
 * via `getExecCtx()`.
 */
export function runWithExecCtx<T>(ctx: ExecutionCtx, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Retrieve the current execution context, or `undefined` when called
 * outside of a `runWithExecCtx` scope.
 */
export function getExecCtx(): ExecutionCtx | undefined {
  return storage.getStore();
}

/**
 * Convenience: returns `getExecCtx()?.sessionId` or `"unknown"` when
 * no context is active. Safe to call from anywhere.
 */
export function currentSessionId(): string {
  return getExecCtx()?.sessionId ?? "unknown";
}

/**
 * Convenience: returns `getExecCtx()?.requestId` or `"unknown"`.
 */
export function currentRequestId(): string {
  return getExecCtx()?.requestId ?? "unknown";
}
