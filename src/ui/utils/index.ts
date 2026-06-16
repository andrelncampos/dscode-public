import chalk from "chalk";
import { renderMessageToStdout } from "../components/MessageView/utils";
import type { RawMode } from "../contexts";
import type { PromptDraft } from "../views/PromptInput";
import type { ModelConfigSelection } from "../../settings";
import type { SessionEntry, SessionMessage } from "../../session";
import type { SessionManager } from "../../session";
import { formatTokenCount } from "../../common/model-capabilities";
import { getModelCapabilities } from "../../common/model-catalog";

/**
 * Render all messages directly to stdout for Raw mode display.
 * Writes each message followed by the "Press ESC to exit raw mode" footer.
 */
export function renderRawModeMessages(allMessages: SessionMessage[], mode: string | RawMode): void {
  for (const msg of allMessages) {
    process.stdout.write("\n");
    process.stdout.write(renderMessageToStdout(msg, mode as RawMode) + "\n\n");
  }
  if (allMessages.length > 0) {
    process.stdout.write("\n\n");
    process.stdout.write(chalk.dim("Press ESC to exit raw mode"));
  } else {
    process.stdout.write("\n");
    process.stdout.write(chalk.dim("(No messages in this session yet. Start chatting to see them here.)"));
    process.stdout.write("\n\n");
    process.stdout.write(chalk.dim("Press ESC to exit raw mode"));
  }
}

export function buildSyntheticUserMessage(content: string, imageCount: number): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: `local-${Math.random().toString(36).slice(2)}`,
    sessionId: "local",
    role: "user",
    content,
    contentParams:
      imageCount > 0
        ? Array.from({ length: imageCount }, () => ({
            type: "image_url",
            image_url: { url: "" },
          }))
        : null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
  };
}

export function buildSystemMessage(content: string): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: `sys-${Math.random().toString(36).slice(2)}`,
    sessionId: "local",
    role: "system",
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
  };
}

export function buildPromptDraftFromSessionMessage(message: SessionMessage, nonce: number): PromptDraft {
  return {
    nonce,
    text: typeof message.content === "string" ? message.content : "",
    imageUrls: extractImageUrlsFromContentParams(message.contentParams),
  };
}

export function extractImageUrlsFromContentParams(contentParams: unknown): string[] {
  const params = Array.isArray(contentParams) ? contentParams : contentParams ? [contentParams] : [];
  const imageUrls: string[] = [];
  for (const param of params) {
    if (!param || typeof param !== "object") {
      continue;
    }
    const record = param as { type?: unknown; image_url?: { url?: unknown } };
    const url = record.image_url?.url;
    if (record.type === "image_url" && typeof url === "string" && url) {
      imageUrls.push(url);
    }
  }
  return imageUrls;
}

export function isCurrentSessionEmpty(sessionManager: SessionManager): boolean {
  const activeSessionId = sessionManager.getActiveSessionId();
  return !activeSessionId || !sessionManager.getSession(activeSessionId);
}

export function buildStatusLine(entry: SessionEntry, modelConfig?: ModelConfigSelection): string {
  const parts: string[] = [];
  parts.push(`status: ${entry.status}`);
  if (modelConfig) {
    parts.push(formatModelConfig(modelConfig));
  }
  if (typeof entry.activeTokens === "number" && entry.activeTokens > 0) {
    parts.push(`⚡ ${formatTokenCount(entry.activeTokens)}`);
  }
  if (entry.lastUserPrompt) {
    parts.push(entry.lastUserPrompt.length > 50 ? entry.lastUserPrompt.slice(0, 50) + "..." : entry.lastUserPrompt);
  }
  if (entry.failReason) {
    parts.push(`fail: ${entry.failReason}`);
  }
  return parts.join(" · ");
}

export function formatThinkingMode(
  settings: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">
): string {
  if (!settings.thinkingEnabled) {
    return "no thinking";
  }
  return `thinking ${settings.reasoningEffort}`;
}

export function formatModelConfig(settings: ModelConfigSelection): string {
  const caps = getModelCapabilities(settings.model);
  const name = caps?.displayName ?? settings.model;
  if (!settings.thinkingEnabled) return name;
  const indicator = "\u0394"; // 𝚫 — mathematical bold capital delta for "thinking"
  return `${name} ${indicator}${settings.reasoningEffort}`;
}
