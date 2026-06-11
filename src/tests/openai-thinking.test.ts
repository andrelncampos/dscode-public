import { test } from "node:test";
import assert from "node:assert/strict";
import { buildThinkingRequestOptions } from "../common/openai-thinking";

test("buildThinkingRequestOptions explicitly disables thinking", () => {
  assert.deepEqual(buildThinkingRequestOptions(false, "https://api.deepseek.com"), {
    thinking: { type: "disabled" },
  });
});

test("buildThinkingRequestOptions uses the same disabled payload for volces endpoints", () => {
  assert.deepEqual(buildThinkingRequestOptions(false, "https://ark.cn-beijing.volces.com/api/v3"), {
    thinking: { type: "disabled" },
  });
});

test("buildThinkingRequestOptions enables thinking with default reasoning effort", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.deepseek.com"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "max" },
  });
});

test("buildThinkingRequestOptions uses the same enabled payload for volces endpoints", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://ark.cn-beijing.volces.com/api/v3"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "max" },
  });
});

test("buildThinkingRequestOptions accepts high reasoning effort", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, "https://api.deepseek.com", "high"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "high" },
  });
});

test("buildThinkingRequestOptions returns OpenAI format with reasoning_effort when thinking enabled", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, undefined, "high", "openai"), {
    reasoning_effort: "high",
  });
});

test("buildThinkingRequestOptions returns empty object for OpenAI when thinking disabled", () => {
  assert.deepEqual(buildThinkingRequestOptions(false, undefined, undefined, "openai"), {});
});

test("buildThinkingRequestOptions returns OpenAI format with max effort", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, undefined, "max", "openai"), {
    reasoning_effort: "max",
  });
});

test("buildThinkingRequestOptions returns DeepSeek format when providerName not specified", () => {
  assert.deepEqual(buildThinkingRequestOptions(true, undefined, "max"), {
    thinking: { type: "enabled" },
    extra_body: { reasoning_effort: "max" },
  });
});
