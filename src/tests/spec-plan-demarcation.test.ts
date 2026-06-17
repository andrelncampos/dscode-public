import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAIMessageConverter } from "../common/openai-message-converter";
import type { SessionMessage } from "../session";

// Access the private extractSpecPlanBlock method for testing
function makeExtractFn() {
  const converter = new OpenAIMessageConverter();
  return (
    converter as unknown as {
      extractSpecPlanBlock(messages: SessionMessage[], endIndex: number): string | null;
    }
  ).extractSpecPlanBlock.bind(converter);
}

function makeMsg(
  role: SessionMessage["role"],
  content: string | null,
  overrides: Partial<SessionMessage> = {}
): SessionMessage {
  return {
    id: crypto.randomUUID(),
    sessionId: "test-session",
    role,
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    ...overrides,
  };
}

// ── T1: Basic extraction ──

test("extractSpecPlanBlock — basic extraction", () => {
  const extract = makeExtractFn();
  const messages: SessionMessage[] = [
    makeMsg("user", "/spec-plan-begin"),
    makeMsg("user", "I want a notification system"),
    makeMsg("user", "Also for Android"),
    makeMsg("user", "/spec-plan-end"),
  ];
  const result = extract(messages, 3);
  assert.equal(result, "I want a notification system\n\nAlso for Android");
});

// ── T2: No begin marker returns null ──

test("extractSpecPlanBlock — no begin marker returns null", () => {
  const extract = makeExtractFn();
  const messages: SessionMessage[] = [makeMsg("user", "some message"), makeMsg("user", "/spec-plan-end")];
  const result = extract(messages, 1);
  assert.equal(result, null);
});

// ── T3: Multiple begin markers uses most recent ──

test("extractSpecPlanBlock — multiple begin markers uses most recent", () => {
  const extract = makeExtractFn();
  const messages: SessionMessage[] = [
    makeMsg("user", "/spec-plan-begin"),
    makeMsg("user", "old idea"),
    makeMsg("user", "/spec-plan-begin"),
    makeMsg("user", "new idea"),
    makeMsg("user", "/spec-plan-end"),
  ];
  const result = extract(messages, 4);
  assert.equal(result, "new idea");
});

// ── T4: Empty block returns "" ──

test("extractSpecPlanBlock — empty block returns empty string", () => {
  const extract = makeExtractFn();
  const messages: SessionMessage[] = [makeMsg("user", "/spec-plan-begin"), makeMsg("user", "/spec-plan-end")];
  const result = extract(messages, 1);
  assert.equal(result, "");
});

// ── T5: Non-user messages skipped ──

test("extractSpecPlanBlock — skips non-user messages", () => {
  const extract = makeExtractFn();
  const messages: SessionMessage[] = [
    makeMsg("user", "/spec-plan-begin"),
    makeMsg("assistant", "What would you like to build?"),
    makeMsg("user", "user reply"),
    makeMsg("system", "system note"),
    makeMsg("tool", "tool result"),
    makeMsg("user", "/spec-plan-end"),
  ];
  const result = extract(messages, 5);
  assert.equal(result, "user reply");
});

// ── T6: Null content messages skipped ──

test("extractSpecPlanBlock — skips null content messages", () => {
  const extract = makeExtractFn();
  const messages: SessionMessage[] = [
    makeMsg("user", "/spec-plan-begin"),
    makeMsg("user", "valid message"),
    makeMsg("user", null),
    makeMsg("user", "another valid"),
    makeMsg("user", "/spec-plan-end"),
  ];
  const result = extract(messages, 4);
  assert.equal(result, "valid message\n\nanother valid");
});

// ── T7: Trailing whitespace on begin marker still matched ──

test("extractSpecPlanBlock — trailing whitespace on begin marker", () => {
  const extract = makeExtractFn();
  const messages: SessionMessage[] = [
    makeMsg("user", "/spec-plan-begin   "), // trailing whitespace
    makeMsg("user", "brainstorm content"),
    makeMsg("user", "/spec-plan-end"),
  ];
  const result = extract(messages, 2);
  assert.equal(result, "brainstorm content");
});

// ── T8: endIndex 0 returns null ──

test("extractSpecPlanBlock — endIndex 0 returns null", () => {
  const extract = makeExtractFn();
  const messages: SessionMessage[] = [makeMsg("user", "/spec-plan-end")];
  const result = extract(messages, 0);
  assert.equal(result, null);
});
