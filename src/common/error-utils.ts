/**
 * Error utilities using Node 24 native Error.isError().
 *
 * Error.isError() is cross-realm safe — it correctly identifies Error instances
 * even when the prototype chain is lost (e.g. errors from subprocesses, workers,
 * MCP servers, or serialized/deserialized across process boundaries).
 */

/**
 * Extract a human-readable message from any caught value.
 * Uses Error.isError() (Node 24+) instead of `instanceof Error` for cross-realm safety.
 */
export function getErrorMessage(error: unknown): string {
  return Error.isError(error) ? (error as Error).message : String(error);
}
