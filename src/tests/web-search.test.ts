import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { handleWebSearchTool } from "../tools/web-search-handler";
import type { ToolExecutionContext } from "../tools/executor";

function makeContext(): ToolExecutionContext {
  return {
    sessionId: "test-session",
    projectRoot: process.cwd(),
    toolCall: {
      id: "call_test",
      type: "function",
      function: { name: "WebSearch", arguments: "{}" },
    },
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
  };
}

test("handleWebSearchTool returns error for empty query", async () => {
  const result = await handleWebSearchTool({ query: "" }, makeContext());
  assert.equal(result.ok, false);
  assert.match(result.error!, /Missing required/i);
});

test("handleWebSearchTool returns error when LLM client is unavailable", async () => {
  const result = await handleWebSearchTool({ query: "test query" }, makeContext());
  assert.equal(result.ok, false);
  assert.match(result.error!, /LLM client is not available/i);
});

test("web-search-handler source does not reference vegamo.cn or DEFAULT_WEB_SEARCH_API_URL", () => {
  const sourcePath = path.join(process.cwd(), "src", "tools", "web-search-handler.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  assert.ok(!source.includes("vegamo.cn"), "Source must not contain vegamo.cn reference");
  assert.ok(!source.includes("DEFAULT_WEB_SEARCH_API_URL"), "Source must not contain DEFAULT_WEB_SEARCH_API_URL");
});

test("web-search-handler source does not reference machineId or Token header", () => {
  const sourcePath = path.join(process.cwd(), "src", "tools", "web-search-handler.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  assert.ok(!source.includes("machineId"), "Source must not reference machineId");
  assert.ok(!source.includes("Token"), "Source must not send Token header");
});
