import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createLlmProvider } from "../common/llm-provider-registry";
import { DeepSeekProvider } from "../providers/deepseek-provider";
import { OpenAIProvider } from "../providers/openai-provider";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempProject(settingsJsonContent: Record<string, unknown>): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dscode-registry-test-"));
  tempDirs.push(tmp);
  // Set HOME to the temp dir so no user-wide settings leak in
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  const dscodeDir = path.join(tmp, ".dscode");
  fs.mkdirSync(dscodeDir, { recursive: true });
  fs.writeFileSync(path.join(dscodeDir, "settings.json"), JSON.stringify(settingsJsonContent));
  return tmp;
}

/** Build a valid settings object with API key in the engines block. */
function makeSettings(
  model: string,
  apiKey?: string,
  engineName?: string,
  engines?: Record<string, { apiKey?: string; baseURL?: string }>
): Record<string, unknown> {
  const env: Record<string, string> = {};
  env.MODEL = model;
  env.BASE_URL = "https://api.deepseek.com";
  const result: Record<string, unknown> = { env, model };
  const allEngines: Record<string, { apiKey?: string; baseURL?: string }> = { ...(engines ?? {}) };
  if (apiKey && engineName) {
    allEngines[engineName] = { ...(allEngines[engineName] ?? {}), apiKey };
  }
  if (Object.keys(allEngines).length > 0) result.engines = allEngines;
  return result;
}

test("createLlmProvider with gpt-5.4 model creates OpenAIProvider", () => {
  const root = makeTempProject(makeSettings("gpt-5.4", "sk-test", "openai", { openai: { apiKey: "sk-openai-test" } }));
  const result = createLlmProvider(root);
  assert.ok(result.provider instanceof OpenAIProvider);
  assert.equal(result.provider?.providerName, "openai");
});

test("createLlmProvider with o1 model creates OpenAIProvider", () => {
  const root = makeTempProject(makeSettings("o1", "sk-test", "openai", { openai: { apiKey: "sk-openai-test" } }));
  const result = createLlmProvider(root);
  assert.ok(result.provider instanceof OpenAIProvider);
});

test("createLlmProvider with deepseek-v4-pro model creates DeepSeekProvider", () => {
  const root = makeTempProject(makeSettings("deepseek-v4-pro", "sk-test", "deepseek"));
  const result = createLlmProvider(root);
  assert.ok(result.provider instanceof DeepSeekProvider);
  assert.equal(result.provider?.providerName, "deepseek");
});

test("createLlmProvider with unknown model creates DeepSeekProvider (default)", () => {
  const root = makeTempProject(makeSettings("some-unknown-model", "sk-test", "deepseek"));
  const result = createLlmProvider(root);
  assert.ok(result.provider instanceof DeepSeekProvider);
});

test("createLlmProvider with OpenAI model and missing key returns null provider", () => {
  const root = makeTempProject(
    makeSettings("gpt-5.4")
    // No API_KEY passed — neither global nor engine-specific
  );
  // Unset DEEPCODE_API_KEY from process env so no system env leaks
  const origKey = process.env.DEEPCODE_API_KEY;
  delete process.env.DEEPCODE_API_KEY;
  try {
    const result = createLlmProvider(root);
    assert.equal(result.provider, null);
  } finally {
    if (origKey !== undefined) process.env.DEEPCODE_API_KEY = origKey;
  }
});

test("createLlmProvider exports a callable createOpenAIClient function", () => {
  const root = makeTempProject(makeSettings("deepseek-v4-pro", "sk-test", "deepseek"));
  const result = createLlmProvider(root);
  assert.ok(typeof result.createOpenAIClient === "function");
  const client = result.createOpenAIClient();
  assert.ok(client);
  assert.equal(client.model, "deepseek-v4-pro");
});
