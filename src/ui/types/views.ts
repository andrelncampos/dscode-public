/**
 * View identifiers for the top-level navigation router.
 * Replaces the loose string union `"chat" | "session-list" | "undo" | "mcp-status"`.
 */
export const enum ViewKind {
  Chat = "chat",
  SessionList = "session-list",
  Undo = "undo",
  McpStatus = "mcp-status",
}
