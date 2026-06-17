import * as crypto from "node:crypto";

import type { SessionMessage } from "../session";
import { DEFAULT_MODEL_PRICING } from "../common/model-capabilities";
import { getModelCapabilities } from "../common/model-catalog";

export function getCompactPromptTokenThreshold(model: string): number {
  const caps = getModelCapabilities(model);
  const contextWindow = caps?.contextWindow;
  if (!contextWindow || contextWindow <= 0) {
    return 128 * 1024; // fallback: conservative for unknown models
  }

  const pricing = DEFAULT_MODEL_PRICING[model];
  const cacheRatio = pricing && pricing.cacheReadPrice > 0 ? pricing.inputPrice / pricing.cacheReadPrice : 1;

  // Cheap cache (≥50:1, e.g. deepseek 120:1) → compact later (60% of window)
  // Normal/expensive cache → compact earlier (38% of window)
  const factor = cacheRatio >= 50 ? 0.6 : 0.38;

  return Math.floor(contextWindow * factor);
}

export function findCompactionBoundary(
  messages: SessionMessage[],
  startIndex: number,
  endIndex: number,
  cacheContext?: { cachedPrefixMessageCount: number; cacheHitRate: number }
): number {
  // Determine preservation count (cache-aware or legacy)
  const preservationCount =
    cacheContext && cacheContext.cacheHitRate > 0.5
      ? Math.min(5, Math.max(3, Math.floor(cacheContext.cachedPrefixMessageCount * 0.1)))
      : 5;

  let boundary = endIndex;
  let preservedCount = 0;
  for (let i = endIndex - 1; i > startIndex; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;

    // Preserve tool messages that contain actual errors (not just the word in output)
    if (msg.role === "tool" && msg.content && hasToolError(msg.content)) {
      boundary = i;
      break;
    }

    // Preserve recent user and assistant messages (last N messages before endIndex)
    if (msg.role === "user" || msg.role === "assistant") {
      preservedCount += 1;
      if (preservedCount >= preservationCount) {
        boundary = i;
        break;
      }
    }
  }
  return boundary;
}

export function getCompactionCandidateRange(
  sessionMessages: SessionMessage[]
): { rangeStart: number; rangeEnd: number } | null {
  // Find rangeStart: last summary message + 1, or first non-system message
  let rangeStart = -1;
  for (let i = sessionMessages.length - 1; i >= 0; i -= 1) {
    if (sessionMessages[i]?.meta?.isSummary) {
      rangeStart = i + 1;
      break;
    }
  }
  if (rangeStart === -1) {
    // No summary found — find first non-system message
    const firstNonSystem = sessionMessages.findIndex((m) => m.role !== "system");
    rangeStart = firstNonSystem >= 0 ? firstNonSystem : sessionMessages.length;
  }

  if (rangeStart >= sessionMessages.length) return null;

  // Count eligible messages (user, assistant, tool; not compacted, not summary)
  let eligibleCount = 0;
  for (let i = rangeStart; i < sessionMessages.length; i += 1) {
    const m = sessionMessages[i];
    if (!m) continue;
    if (m.compacted) continue;
    if (m.meta?.isSummary) continue;
    if (m.role === "user" || m.role === "assistant" || m.role === "tool") {
      eligibleCount += 1;
    }
  }

  if (eligibleCount < 5) return null;

  return { rangeStart, rangeEnd: sessionMessages.length };
}

export function findStablePrefixEndIndex(sessionMessages: SessionMessage[], stablePrefixHash: string): number {
  let runningContent = "";
  for (let i = 0; i < sessionMessages.length; i += 1) {
    const msg = sessionMessages[i];
    if (!msg || msg.role !== "system") continue;
    runningContent += msg.content ?? "";
    const hash = crypto.createHash("sha256").update(runningContent).digest("hex");
    if (hash === stablePrefixHash) return i + 1;
  }
  // Fallback: first non-system message index (existing behavior)
  const firstNonSystem = sessionMessages.findIndex((m) => m.role !== "system");
  return firstNonSystem >= 0 ? firstNonSystem : 0;
}

export function shouldCompactSession(args: {
  activeTokens: number;
  model: string;
  effectiveCacheMode: "off" | "aware" | "strict";
  cacheHitRate: number;
  compactedTokenCount: number;
  remainingTokenCount: number;
  stablePrefixTokenCount: number;
  estimatedNewTurnTokens: number;
}): boolean {
  const threshold = getCompactPromptTokenThreshold(args.model);
  if (args.activeTokens <= threshold) return false;
  if (args.effectiveCacheMode === "off") return true;

  const pricing = DEFAULT_MODEL_PRICING[args.model];
  if (!pricing || pricing.inputPrice <= 0) return true; // conservative: compact

  const safeHitRate = Number.isFinite(args.cacheHitRate) && args.cacheHitRate >= 0 ? args.cacheHitRate : 0;

  // Safety override: context window integrity > cost optimization
  const contextWindow = getModelCapabilities(args.model)?.contextWindow ?? 0;
  if (contextWindow > 0 && args.activeTokens > contextWindow * 0.85) return true;

  // Cost without compaction: all existing tokens (split by cache hit rate) + new turn
  const nonNewTurnTokens = args.activeTokens - args.estimatedNewTurnTokens;
  const cacheHits = nonNewTurnTokens * safeHitRate;
  const cacheMisses = nonNewTurnTokens * (1 - safeHitRate);
  const costWithoutCompaction =
    (cacheHits / 1_000_000) * pricing.cacheReadPrice +
    (cacheMisses / 1_000_000) * pricing.inputPrice +
    (args.estimatedNewTurnTokens / 1_000_000) * pricing.inputPrice;

  // Cost with compaction: stable prefix (cached) + summary + remaining + new turn (all fresh)
  const summaryTokens = args.compactedTokenCount * 0.15;
  const freshTokens = summaryTokens + args.remainingTokenCount + args.estimatedNewTurnTokens;
  const costWithCompaction =
    (args.stablePrefixTokenCount / 1_000_000) * pricing.cacheReadPrice + (freshTokens / 1_000_000) * pricing.inputPrice;

  return costWithCompaction < costWithoutCompaction;
}

export function hasToolError(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { ok?: boolean; error?: string };
    return parsed.ok === false || (typeof parsed.error === "string" && parsed.error.length > 0);
  } catch {
    return false;
  }
}
