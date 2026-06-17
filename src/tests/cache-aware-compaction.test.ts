import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";

import { getCompactPromptTokenThreshold } from "../../src/session/compaction";
import {
  getCompactionCandidateRange,
  findStablePrefixEndIndex,
  findCompactionBoundary,
  shouldCompactSession,
} from "../../src/session/compaction";
import type { SessionMessage } from "../session";
import { DEFAULT_MODEL_PRICING } from "../common/model-capabilities";
import { getModelCapabilities } from "../common/model-catalog";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeSys(id: string, content: string, overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id,
    sessionId: "s1",
    role: "system",
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: false,
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeUser(id: string, content: string, overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id,
    sessionId: "s1",
    role: "user",
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAsst(id: string, content: string, overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id,
    sessionId: "s1",
    role: "assistant",
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTool(id: string, content: string, overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id,
    sessionId: "s1",
    role: "tool",
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSummary(id: string, content: string): SessionMessage {
  return makeSys(id, content, { meta: { isSummary: true } });
}

function makeCompacted(id: string, role: "user" | "assistant" | "tool", content: string): SessionMessage {
  if (role === "user") return makeUser(id, content, { compacted: true });
  if (role === "tool") return makeTool(id, content, { compacted: true });
  return makeAsst(id, content, { compacted: true });
}

// ---------------------------------------------------------------------------
// shouldCompactSession — indirect tests
// ---------------------------------------------------------------------------

test("getCompactPromptTokenThreshold — dynamic based on context window + cache ratio", () => {
  // deepseek-v4-pro: 1M window × 0.60 (cache ratio 120:1 ≥ 50)
  assert.equal(getCompactPromptTokenThreshold("deepseek-v4-pro"), 600_000);
  // deepseek-v4-flash: 1M window × 0.60 (cache ratio 50:1 ≥ 50)
  assert.equal(getCompactPromptTokenThreshold("deepseek-v4-flash"), 600_000);
  // claude-sonnet-4-6: 1M window × 0.38 (cache ratio 10:1 < 50)
  assert.equal(getCompactPromptTokenThreshold("claude-sonnet-4-6"), 380_000);
  // unknown model with no capabilities: fallback
  assert.equal(getCompactPromptTokenThreshold("unknown-model"), 128 * 1024);
});

test("DEFAULT_MODEL_PRICING — deepseek pro has valid pricing", () => {
  const pricing = DEFAULT_MODEL_PRICING["deepseek-v4-pro"];
  assert.ok(pricing, "deepseek-v4-pro should have pricing");
  assert.ok(pricing.inputPrice > 0, "input price should be > 0");
  assert.ok(pricing.cacheReadPrice > 0, "cache read price should be > 0");
  assert.ok(pricing.cacheReadPrice < pricing.inputPrice, "cache read should be cheaper than input");
});

test("getModelCapabilities — deepseek pro has context window", () => {
  const caps = getModelCapabilities("deepseek-v4-pro");
  assert.ok(caps, "deepseek-v4-pro capabilities should exist");
  assert.ok(caps.contextWindow > 0, "context window should be > 0");
});

test("getCompactionCandidateRange — no previous summary returns range from first non-system", () => {
  const msgs: SessionMessage[] = [
    makeSys("s0", "System prompt"),
    makeSys("s1", "Runtime context"),
    makeUser("u1", "Hello"),
    makeAsst("a1", "Hi there"),
    makeUser("u2", "Help with code"),
    makeAsst("a2", "Sure"),
    makeUser("u3", "Thanks"),
    makeAsst("a3", "Welcome"),
  ];
  const result = getCompactionCandidateRange(msgs);
  assert.ok(result, "should return a range");
  assert.equal(result!.rangeStart, 2, "rangeStart should be first non-system index");
  assert.equal(result!.rangeEnd, msgs.length);
});

test("getCompactionCandidateRange — after first compaction starts after summary", () => {
  const msgs: SessionMessage[] = [
    makeSys("s0", "System prompt"),
    makeSummary("sum1", "Summary of earlier conversation"),
    makeUser("u1", "New msg 1"),
    makeAsst("a1", "Rsp 1"),
    makeUser("u2", "New msg 2"),
    makeAsst("a2", "Rsp 2"),
    makeUser("u3", "New msg 3"),
    makeAsst("a3", "Rsp 3"),
    makeUser("u4", "New msg 4"),
    makeAsst("a4", "Rsp 4"),
    makeUser("u5", "New msg 5"),
  ];
  const result = getCompactionCandidateRange(msgs);
  assert.ok(result, "should return a range after summary");
  assert.ok(result!.rangeStart > 1, "rangeStart should be after summary");
  assert.equal(result!.rangeEnd, msgs.length);
});

test("getCompactionCandidateRange — too few eligible messages returns null", () => {
  const msgs: SessionMessage[] = [
    makeSys("s0", "System"),
    makeSummary("sum1", "Summary"),
    makeUser("u1", "msg1"),
    makeAsst("a1", "rsp1"),
    makeUser("u2", "msg2"),
    makeAsst("a2", "rsp2"),
  ];
  assert.equal(getCompactionCandidateRange(msgs), null);
});

test("getCompactionCandidateRange — system messages excluded from count", () => {
  const msgs: SessionMessage[] = [
    makeSys("s0", "S0"),
    makeSys("s1", "S1"),
    makeSys("s2", "S2"),
    makeSys("s3", "S3"),
    makeSys("s4", "S4"),
    makeSys("s5", "S5"),
    makeSys("s6", "S6"),
    makeSummary("sum1", "Summary"),
    makeUser("u1", "msg1"),
    makeAsst("a1", "rsp1"),
    makeUser("u2", "msg2"),
  ];
  assert.equal(getCompactionCandidateRange(msgs), null, "3 eligible → null");
});

test("getCompactionCandidateRange — compacted messages excluded from count", () => {
  const msgs: SessionMessage[] = [
    makeSys("s0", "System"),
    makeCompacted("cu1", "user", "old msg"),
    makeCompacted("ca1", "assistant", "old rsp"),
    makeUser("u1", "msg1"),
    makeAsst("a1", "rsp1"),
    makeUser("u2", "msg2"),
    makeAsst("a2", "rsp2"),
    makeUser("u3", "msg3"),
    makeAsst("a3", "rsp3"),
    makeUser("u4", "msg4"),
    makeAsst("a4", "rsp4"),
  ];
  const result = getCompactionCandidateRange(msgs);
  assert.ok(result, "10 eligible after excluding compacted");
  assert.equal(
    result!.rangeStart,
    1,
    "rangeStart = first non-system (compacted msg at index 1); compacted skipped in count"
  );
});

test("getCompactionCandidateRange — all messages compacted returns null", () => {
  const msgs: SessionMessage[] = [
    makeSys("s0", "System"),
    makeCompacted("cu1", "user", "msg1"),
    makeCompacted("ca1", "assistant", "rsp1"),
  ];
  assert.equal(getCompactionCandidateRange(msgs), null, "no eligible messages");
});

// ---------------------------------------------------------------------------
// findStablePrefixEndIndex tests (standalone replica)
// ---------------------------------------------------------------------------

test("findStablePrefixEndIndex — returns index after stable prefix system messages", () => {
  const msgs: SessionMessage[] = [
    makeSys("s0", "You are an AI assistant."),
    makeSys("s1", "Tools: read, write."),
    makeUser("u1", "Hello"),
    makeAsst("a1", "Hi"),
  ];
  const stableContent = "You are an AI assistant.Tools: read, write.";
  const stableHash = crypto.createHash("sha256").update(stableContent).digest("hex");
  assert.equal(findStablePrefixEndIndex(msgs, stableHash), 2);
});

test("findStablePrefixEndIndex — hash mismatch falls back to first non-system", () => {
  const msgs: SessionMessage[] = [
    makeSys("s0", "System prompt"),
    makeSys("s1", "Runtime context"),
    makeUser("u1", "Hello"),
  ];
  const wrongHash = "0000000000000000000000000000000000000000000000000000000000000000";
  assert.equal(findStablePrefixEndIndex(msgs, wrongHash), 2, "fallback to first non-system");
});

test("findCompactionBoundary — cache context high hit rate reduces preservation", () => {
  const msgs: SessionMessage[] = [makeSys("s0", "System")];
  for (let i = 0; i < 30; i += 1) {
    msgs.push(makeUser(`u${i}`, `question ${i}`));
    msgs.push(makeAsst(`a${i}`, `answer ${i}`));
  }
  // floor(30*0.1) = 3, min(5, 3) = 3 → boundary = 30 - 3 = 27
  assert.equal(findCompactionBoundary(msgs, 1, 30, { cachedPrefixMessageCount: 30, cacheHitRate: 0.9 }), 27);
});

test("findCompactionBoundary — cache context low hit rate preserves 5", () => {
  const msgs: SessionMessage[] = [makeSys("s0", "System")];
  for (let i = 0; i < 30; i += 1) {
    msgs.push(makeUser(`u${i}`, `q${i}`));
    msgs.push(makeAsst(`a${i}`, `a${i}`));
  }
  assert.equal(findCompactionBoundary(msgs, 1, 30, { cachedPrefixMessageCount: 30, cacheHitRate: 0.3 }), 25);
});

test("findCompactionBoundary — no cache context preserves 5", () => {
  const msgs: SessionMessage[] = [makeSys("s0", "System")];
  for (let i = 0; i < 20; i += 1) {
    msgs.push(makeUser(`u${i}`, `q${i}`));
    msgs.push(makeAsst(`a${i}`, `a${i}`));
  }
  assert.equal(findCompactionBoundary(msgs, 1, 20), 15);
});

test("findCompactionBoundary — large prefix with high hit rate caps at 5", () => {
  const msgs: SessionMessage[] = [makeSys("s0", "System")];
  for (let i = 0; i < 60; i += 1) {
    msgs.push(makeUser(`u${i}`, `q${i}`));
    msgs.push(makeAsst(`a${i}`, `a${i}`));
  }
  // floor(60*0.1) = 6, cap at 5 → boundary = 60 - 5 = 55
  assert.equal(findCompactionBoundary(msgs, 1, 60, { cachedPrefixMessageCount: 60, cacheHitRate: 0.9 }), 55);
});

test("shouldCompactSession — below threshold returns false", () => {
  assert.equal(
    shouldCompactSession({
      activeTokens: 100_000,
      model: "deepseek-v4-pro",
      effectiveCacheMode: "aware",
      cacheHitRate: 0.9,
      compactedTokenCount: 50_000,
      remainingTokenCount: 30_000,
      stablePrefixTokenCount: 20_000,
      estimatedNewTurnTokens: 800,
    }),
    false,
    "100K tokens (below 600K dynamic threshold) should return false"
  );
});

test("shouldCompactSession — cacheMode off compacts when above threshold", () => {
  assert.equal(
    shouldCompactSession({
      activeTokens: 650_000,
      model: "deepseek-v4-pro",
      effectiveCacheMode: "off",
      cacheHitRate: 0.9,
      compactedTokenCount: 250_000,
      remainingTokenCount: 100_000,
      stablePrefixTokenCount: 50_000,
      estimatedNewTurnTokens: 800,
    }),
    true,
    "cacheMode off should compact above threshold regardless of economics"
  );
});

test("shouldCompactSession — high cache hit rate skips compaction", () => {
  // Flow 1 from design: 92% hit rate, costWith > costWithout
  const result = shouldCompactSession({
    activeTokens: 650_000,
    model: "deepseek-v4-pro",
    effectiveCacheMode: "aware",
    cacheHitRate: 0.92,
    compactedTokenCount: 250_000,
    remainingTokenCount: 100_000,
    stablePrefixTokenCount: 50_000,
    estimatedNewTurnTokens: 800,
  });
  assert.equal(result, false, "92% cache hit → compaction increases cost → skip");
});

test("shouldCompactSession — low cache hit rate compacts", () => {
  // Flow 2 from design: 15% hit rate, costWith < costWithout
  const result = shouldCompactSession({
    activeTokens: 650_000,
    model: "deepseek-v4-pro",
    effectiveCacheMode: "aware",
    cacheHitRate: 0.15,
    compactedTokenCount: 250_000,
    remainingTokenCount: 100_000,
    stablePrefixTokenCount: 50_000,
    estimatedNewTurnTokens: 800,
  });
  assert.equal(result, true, "15% cache hit → compaction reduces cost → proceed");
});

test("shouldCompactSession — zero cache data assumes 0% and compacts", () => {
  const result = shouldCompactSession({
    activeTokens: 650_000,
    model: "deepseek-v4-pro",
    effectiveCacheMode: "aware",
    cacheHitRate: 0,
    compactedTokenCount: 250_000,
    remainingTokenCount: 100_000,
    stablePrefixTokenCount: 50_000,
    estimatedNewTurnTokens: 800,
  });
  assert.equal(result, true, "0% cache → all tokens are full-price → compact");
});

test("shouldCompactSession — context window safety override", () => {
  // deepseek-v4-pro contextWindow = 1_000_000. 85% = 850_000.
  const result = shouldCompactSession({
    activeTokens: 860_000,
    model: "deepseek-v4-pro",
    effectiveCacheMode: "aware",
    cacheHitRate: 0.92, // very high hit rate
    compactedTokenCount: 500_000,
    remainingTokenCount: 200_000,
    stablePrefixTokenCount: 50_000,
    estimatedNewTurnTokens: 800,
  });
  assert.equal(result, true, "86% of context window → safety override → true regardless");
});
