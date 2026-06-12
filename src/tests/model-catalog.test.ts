import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_CATALOG, THINKING_OPTIONS_BY_TYPE, getModelCapabilities } from "../common/model-catalog";
import { DEFAULT_MODEL_PRICING } from "../common/model-capabilities";

test("MODEL_CATALOG has exactly 11 entries", () => {
  assert.equal(MODEL_CATALOG.length, 11);
});

test("MODEL_CATALOG has exactly one default model", () => {
  const defaults = MODEL_CATALOG.filter((m) => m.isDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0]!.id, "deepseek-v4-pro");
});

test("getModelCapabilities returns correct capabilities for deepseek-v4-pro", () => {
  const caps = getModelCapabilities("deepseek-v4-pro");
  assert.ok(caps);
  assert.equal(caps!.provider, "deepseek");
  assert.equal(caps!.displayName, "DeepSeek V4 Pro");
  assert.equal(caps!.multimodal, true);
  assert.equal(caps!.reasoning.type, "extended");
  assert.equal(caps!.reasoning.defaultEffort, "max");
});

test("getModelCapabilities returns correct capabilities for gpt-5.5", () => {
  const caps = getModelCapabilities("gpt-5.5");
  assert.ok(caps);
  assert.equal(caps!.provider, "openai");
  assert.equal(caps!.displayName, "GPT-5.5");
  assert.equal(caps!.reasoning.type, "effort");
  assert.equal(caps!.reasoning.defaultEffort, "medium");
});

test("getModelCapabilities returns correct capabilities for claude-opus-4-8", () => {
  const caps = getModelCapabilities("claude-opus-4-8");
  assert.ok(caps);
  assert.equal(caps!.provider, "anthropic");
  assert.equal(caps!.displayName, "Claude Opus 4.8");
  assert.equal(caps!.reasoning.type, "adaptive");
  assert.equal(caps!.reasoning.defaultEffort, "high");
});

test("getModelCapabilities returns pricing from DEFAULT_MODEL_PRICING", () => {
  const caps = getModelCapabilities("deepseek-v4-pro");
  assert.ok(caps);
  assert.equal(caps!.pricing, DEFAULT_MODEL_PRICING["deepseek-v4-pro"]);

  // Model with pricing
  const gptCaps = getModelCapabilities("gpt-5.5");
  assert.ok(gptCaps);
  assert.ok(gptCaps!.pricing);
  assert.ok(gptCaps!.pricing!.inputPrice > 0);
});

test("getModelCapabilities returns null for unknown model", () => {
  const caps = getModelCapabilities("nonexistent-model");
  assert.equal(caps, null);
});

test("THINKING_OPTIONS_BY_TYPE has entries for all 4 reasoning types", () => {
  assert.ok(THINKING_OPTIONS_BY_TYPE.effort);
  assert.ok(THINKING_OPTIONS_BY_TYPE.adaptive);
  assert.ok(THINKING_OPTIONS_BY_TYPE.extended);
  assert.ok(THINKING_OPTIONS_BY_TYPE.none);
});

test("THINKING_OPTIONS_BY_TYPE['effort'] has 6 options", () => {
  assert.equal(THINKING_OPTIONS_BY_TYPE.effort.length, 6);
});

test("THINKING_OPTIONS_BY_TYPE['adaptive'] has 4 options", () => {
  assert.equal(THINKING_OPTIONS_BY_TYPE.adaptive.length, 4);
});

test("THINKING_OPTIONS_BY_TYPE['extended'] has 3 options", () => {
  assert.equal(THINKING_OPTIONS_BY_TYPE.extended.length, 3);
});
