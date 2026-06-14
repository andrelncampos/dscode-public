import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveModelToProvider } from "../common/llm-provider-registry";
import { getEffectiveCacheMode } from "../settings";
import {
  buildSkillDocumentsPrompt,
  getExtensionRoot,
  getRuntimeContext,
  getStablePrefixContent,
  getStablePrefixHash,
  getSystemPrompt,
} from "../prompt";
import type { SkillPromptDocument } from "../prompt";

// Note: resolveCacheMode is not exported — tested indirectly via getEffectiveCacheMode

// ---------------------------------------------------------------------------
// resolveModelToProvider
// ---------------------------------------------------------------------------

test("resolveModelToProvider — deepseek models", () => {
  assert.equal(resolveModelToProvider("deepseek-v4-pro"), "deepseek");
  assert.equal(resolveModelToProvider("deepseek-v4-flash"), "deepseek");
  assert.equal(resolveModelToProvider("deepseek-chat"), "deepseek");
});

test("resolveModelToProvider — openai models", () => {
  assert.equal(resolveModelToProvider("gpt-5.1"), "openai");
  assert.equal(resolveModelToProvider("o4-mini"), "openai");
});

test("resolveModelToProvider — anthropic models", () => {
  assert.equal(resolveModelToProvider("claude-opus-4"), "anthropic");
});

test("resolveModelToProvider — gemini models", () => {
  assert.equal(resolveModelToProvider("gemini-2.5-pro"), "gemini");
});

test("resolveModelToProvider — unknown falls back to deepseek", () => {
  assert.equal(resolveModelToProvider("unknown-model"), "deepseek");
});

// ---------------------------------------------------------------------------
// getEffectiveCacheMode
// ---------------------------------------------------------------------------

test("getEffectiveCacheMode — off always returns off", () => {
  assert.equal(getEffectiveCacheMode("off", "deepseek"), "off");
  assert.equal(getEffectiveCacheMode("off", "openai"), "off");
  assert.equal(getEffectiveCacheMode("off", "anthropic"), "off");
});

test("getEffectiveCacheMode — aware + deepseek returns aware", () => {
  assert.equal(getEffectiveCacheMode("aware", "deepseek"), "aware");
});

test("getEffectiveCacheMode — aware + non-deepseek returns off", () => {
  assert.equal(getEffectiveCacheMode("aware", "openai"), "off");
  assert.equal(getEffectiveCacheMode("aware", "anthropic"), "off");
});

test("getEffectiveCacheMode — strict + deepseek returns strict", () => {
  assert.equal(getEffectiveCacheMode("strict", "deepseek"), "strict");
});

test("getEffectiveCacheMode — strict + non-deepseek returns off", () => {
  assert.equal(getEffectiveCacheMode("strict", "openai"), "off");
  assert.equal(getEffectiveCacheMode("strict", "anthropic"), "off");
});

// ---------------------------------------------------------------------------
// buildSkillDocumentsPrompt — deterministic sort
// ---------------------------------------------------------------------------

test("buildSkillDocumentsPrompt — alphabetical sort", () => {
  const skills: SkillPromptDocument[] = [
    { name: "B-skill", content: "B content" },
    { name: "A-skill", content: "A content" },
  ];
  const result = buildSkillDocumentsPrompt(skills);
  const aIndex = result.indexOf("A-skill");
  const bIndex = result.indexOf("B-skill");
  assert.ok(aIndex < bIndex, "A should appear before B");
});

test("buildSkillDocumentsPrompt — case-insensitive sort", () => {
  const skills: SkillPromptDocument[] = [
    { name: "b-skill", content: "b content" },
    { name: "A-skill", content: "A content" },
  ];
  const result = buildSkillDocumentsPrompt(skills);
  const aIndex = result.indexOf("A-skill");
  const bIndex = result.indexOf("b-skill");
  assert.ok(aIndex < bIndex, "A should appear before b");
});

test("buildSkillDocumentsPrompt — idempotent", () => {
  const skills: SkillPromptDocument[] = [
    { name: "B-skill", content: "B" },
    { name: "A-skill", content: "A" },
  ];
  const r1 = buildSkillDocumentsPrompt(skills);
  const r2 = buildSkillDocumentsPrompt(skills);
  assert.equal(r1, r2);
});

test("buildSkillDocumentsPrompt — does not mutate input", () => {
  const skills: SkillPromptDocument[] = [
    { name: "B-skill", content: "B" },
    { name: "A-skill", content: "A" },
  ];
  const original = [...skills];
  buildSkillDocumentsPrompt(skills);
  assert.deepEqual(skills, original);
});

// ---------------------------------------------------------------------------
// getSystemPrompt — idempotent
// ---------------------------------------------------------------------------

test("getSystemPrompt — idempotent", () => {
  const r1 = getSystemPrompt("/tmp", { model: "deepseek-v4-pro" });
  const r2 = getSystemPrompt("/tmp", { model: "deepseek-v4-pro" });
  assert.equal(r1, r2);
});

test("getSystemPrompt — contains tool docs", () => {
  const result = getSystemPrompt("/tmp", { model: "deepseek-v4-pro" });
  assert.ok(result.includes("# Available Tools"));
  assert.ok(result.includes("bash"));
  assert.ok(result.includes("read"));
});

// ---------------------------------------------------------------------------
// getStablePrefixContent
// ---------------------------------------------------------------------------

test("getStablePrefixContent — aware mode", () => {
  const content = getStablePrefixContent({
    extensionRoot: getExtensionRoot(),
    promptToolOptions: { model: "deepseek-v4-pro" },
    agentInstructions: "# Test Steering",
    skillPrompt: "<test-skill>\nTest skill\n</test-skill>",
    cacheMode: "aware",
  });
  // Should NOT include model name or project root
  assert.ok(!content.includes("The current LLM model is"));
  assert.ok(!content.includes("Local Workspace Environment"));
  // Should include the skill and agent instructions
  assert.ok(content.includes("<test-skill>"));
  assert.ok(content.includes("# Test Steering"));
  // Should be non-empty
  assert.ok(content.length > 0);
});

test("getStablePrefixContent — strict mode", () => {
  const content = getStablePrefixContent({
    extensionRoot: getExtensionRoot(),
    promptToolOptions: { model: "deepseek-v4-pro" },
    agentInstructions: "# Test Steering",
    skillPrompt: "<test-skill>\nTest skill\n</test-skill>",
    cacheMode: "strict",
  });
  // Same as aware — model name never in stable prefix
  assert.ok(!content.includes("The current LLM model is"));
  assert.ok(content.includes("<test-skill>"));
  assert.ok(content.length > 0);
});

// ---------------------------------------------------------------------------
// getStablePrefixHash
// ---------------------------------------------------------------------------

test("getStablePrefixHash — same content same hash", () => {
  assert.equal(getStablePrefixHash("abc"), getStablePrefixHash("abc"));
});

test("getStablePrefixHash — different content different hash", () => {
  assert.notEqual(getStablePrefixHash("abc"), getStablePrefixHash("abd"));
});

test("getStablePrefixHash — 64 hex chars", () => {
  const hash = getStablePrefixHash("hello");
  assert.equal(hash.length, 64);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

// ---------------------------------------------------------------------------
// getRuntimeContext
// ---------------------------------------------------------------------------

test("getRuntimeContext — includes model name", () => {
  const result = getRuntimeContext("/tmp/test", "deepseek-v4-pro");
  assert.ok(result.includes("The current LLM model is deepseek-v4-pro"));
});

test("getRuntimeContext — empty model omits model line", () => {
  const result = getRuntimeContext("/tmp/test", undefined);
  assert.ok(!result.includes("The current LLM model is"));
});

test("getRuntimeContext — includes project root", () => {
  const result = getRuntimeContext("/tmp/my-project", "deepseek-v4-pro");
  assert.ok(result.includes("/tmp/my-project"));
  assert.ok(result.includes('"root path"'));
});
