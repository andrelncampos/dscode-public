import test from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider } from "../providers/gemini-provider";

// ── supportsModel ──────────────────────────────────────────────────────

await test("supportsModel returns true for gemini- prefixes", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.supportsModel("gemini-3.5-flash"), true);
  assert.equal(provider.supportsModel("gemini-2.5-pro"), true);
  assert.equal(provider.supportsModel("gemini-3.1-flash-lite"), true);
  assert.equal(provider.supportsModel("GEMINI-3.5-FLASH"), true); // case insensitive
});

await test("supportsModel returns false for non-gemini models", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.supportsModel("gpt-5.4"), false);
  assert.equal(provider.supportsModel("deepseek-v4-pro"), false);
  assert.equal(provider.supportsModel("claude-sonnet-4-6"), false);
});

// ── getTimeoutMs ───────────────────────────────────────────────────────

await test("getTimeoutMs returns 300_000 for gemini-2.5-pro", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.getTimeoutMs("gemini-2.5-pro"), 300_000);
});

await test("getTimeoutMs returns 180_000 for gemini-3.5-flash", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.getTimeoutMs("gemini-3.5-flash"), 180_000);
});

await test("getTimeoutMs returns 180_000 for gemini-3.1-flash-lite", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.getTimeoutMs("gemini-3.1-flash-lite"), 180_000);
});

// ── isMultimodal ───────────────────────────────────────────────────────

await test("isMultimodal returns true for all models", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.isMultimodal("gemini-3.5-flash"), true);
  assert.equal(provider.isMultimodal("gemini-3.1-flash-lite"), true);
  assert.equal(provider.isMultimodal("gemini-2.5-pro"), true);
  assert.equal(provider.isMultimodal("gemini-2.5-flash"), true);
});

// ── getAuxiliaryModel ──────────────────────────────────────────────────────

await test("getAuxiliaryModel returns flash-lite for 3.5-flash", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.getAuxiliaryModel("gemini-3.5-flash"), "gemini-3.1-flash-lite");
});

await test("getAuxiliaryModel returns flash-lite for 3-flash", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.getAuxiliaryModel("gemini-3-flash"), "gemini-3.1-flash-lite");
});

await test("getAuxiliaryModel returns flash for 2.5-pro", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.getAuxiliaryModel("gemini-2.5-pro"), "gemini-2.5-flash");
});

await test("getAuxiliaryModel returns flash-lite for 2.5-flash", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.getAuxiliaryModel("gemini-2.5-flash"), "gemini-3.1-flash-lite");
});

await test("getAuxiliaryModel returns null for flash-lite", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.getAuxiliaryModel("gemini-3.1-flash-lite"), null);
});

await test("getAuxiliaryModel returns null for unknown model", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.getAuxiliaryModel("gemini-unknown-model"), null);
});

await test("getAuxiliaryModel delegates to catalog for all models", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.getAuxiliaryModel("gpt-5.4"), "gpt-5.4-mini");
  assert.equal(provider.getAuxiliaryModel("deepseek-v4-pro"), "deepseek-v4-flash");
});

// ── providerName ───────────────────────────────────────────────────────

await test("providerName is 'gemini'", () => {
  const provider = new GeminiProvider();
  assert.equal(provider.providerName, "gemini");
});

// ── ILlmProvider implementation check ──────────────────────────────────

await test("GeminiProvider has all required ILlmProvider methods", () => {
  const provider = new GeminiProvider();
  assert.equal(typeof provider.supportsModel, "function");
  assert.equal(typeof provider.chat, "function");
  assert.equal(typeof provider.getTimeoutMs, "function");
  assert.equal(typeof provider.isMultimodal, "function");
  assert.equal(typeof provider.getAuxiliaryModel, "function");
  assert.equal(typeof provider.providerName, "string");
});
