import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolExecutionContext } from "../tools/executor";
import { handleWebSearchTool } from "../tools/web-search-handler";

test("WebSearch returns an error when LLM client is not available", async () => {
  const result = await handleWebSearchTool({ query: "latest node release" }, createContextNoClient());

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /LLM client is not available/i);
});

test("WebSearch returns an error when query is missing", async () => {
  const result = await handleWebSearchTool({}, createContextNoClient());

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Missing required "query"/i);
});

function createContextNoClient(): ToolExecutionContext {
  return {
    sessionId: "web-search-test",
    projectRoot: "/tmp",
    toolCall: {
      id: "tool-call-id",
      type: "function",
      function: {
        name: "WebSearch",
        arguments: "{}",
      },
    },
    createOpenAIClient: () => ({ client: null, model: "test", thinkingEnabled: false }),
  };
}
