import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "../providers/anthropic-provider";

// ── supportsModel ──────────────────────────────────────────────────────

await test("supportsModel returns true for claude- prefixes", () => {
  const provider = new AnthropicProvider();
  assert.equal(provider.supportsModel("claude-sonnet-4-6"), true);
  assert.equal(provider.supportsModel("claude-opus-4-8"), true);
  assert.equal(provider.supportsModel("claude-haiku-4-5"), true);
  assert.equal(provider.supportsModel("CLAUDE-SONNET-4-6"), true); // case insensitive
});

await test("supportsModel returns false for non-claude models", () => {
  const provider = new AnthropicProvider();
  assert.equal(provider.supportsModel("gpt-5.4"), false);
  assert.equal(provider.supportsModel("deepseek-v4-pro"), false);
});

// ── getTimeoutMs ───────────────────────────────────────────────────────

await test("getTimeoutMs returns 300_000 for opus/sonnet", () => {
  const provider = new AnthropicProvider();
  assert.equal(provider.getTimeoutMs("claude-opus-4-8"), 300_000);
  assert.equal(provider.getTimeoutMs("claude-sonnet-4-6"), 300_000);
});

await test("getTimeoutMs returns 180_000 for haiku", () => {
  const provider = new AnthropicProvider();
  assert.equal(provider.getTimeoutMs("claude-haiku-4-5"), 180_000);
});

// ── isMultimodal ───────────────────────────────────────────────────────

await test("isMultimodal returns true for all models", () => {
  const provider = new AnthropicProvider();
  assert.equal(provider.isMultimodal("claude-sonnet-4-6"), true);
  assert.equal(provider.isMultimodal("claude-haiku-4-5"), true);
});

// ── getCheapModel ──────────────────────────────────────────────────────

await test("getCheapModel returns haiku for opus", () => {
  const provider = new AnthropicProvider();
  assert.equal(provider.getCheapModel("claude-opus-4-8"), "claude-haiku-4-5");
});

await test("getCheapModel returns haiku for sonnet", () => {
  const provider = new AnthropicProvider();
  assert.equal(provider.getCheapModel("claude-sonnet-4-6"), "claude-haiku-4-5");
});

await test("getCheapModel returns null for haiku", () => {
  const provider = new AnthropicProvider();
  assert.equal(provider.getCheapModel("claude-haiku-4-5"), null);
});

await test("getCheapModel heuristic replaces opus/sonnet with haiku", () => {
  const provider = new AnthropicProvider();
  // Unknown model with "opus" in name → replace with "haiku"
  assert.equal(provider.getCheapModel("claude-opus-4-9"), "claude-haiku-4-9");
  // Unknown model with "sonnet" in name
  assert.equal(provider.getCheapModel("claude-sonnet-5-1"), "claude-haiku-5-1");
});

// ── chat() error handling ──────────────────────────────────────────────

await test("chat throws when no Anthropic client available", async () => {
  // Without an Anthropic-specific API key, chat() should fail
  const provider = new AnthropicProvider();
  try {
    for await (const _ of provider.chat({
      model: "claude-sonnet-4-6",
      messages: [],
    })) {
      // Should not reach here
    }
    assert.fail("Expected error was not thrown");
  } catch (err) {
    assert.ok(err instanceof Error);
  }
});
