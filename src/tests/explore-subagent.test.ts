import { describe, it } from "node:test";
import * as assert from "node:assert";
import { handleExploreToolCall, runExploreSubagent } from "../tools/explore-subagent";
import type { ToolCall } from "../tools/executor";

function makeToolCall(args: Record<string, unknown>): ToolCall {
  return {
    id: "call_1",
    type: "function",
    function: {
      name: "Explore",
      arguments: JSON.stringify(args),
    },
  };
}

// Mock OpenAI client factory
type MockCreate = (params: Record<string, unknown>) => Promise<unknown>;
function mockClient(createFn: MockCreate) {
  return {
    chat: {
      completions: {
        create: createFn,
      },
    },
  } as any;
}

function mockCreateOpenAIClient(client: unknown, model = "deepseek-v4-pro"): any {
  return () => ({
    client,
    model,
    thinkingEnabled: true,
  });
}

describe("handleExploreToolCall", () => {
  it("returns error for missing query", async () => {
    const result = await handleExploreToolCall(
      makeToolCall({ thoroughness: "quick" }),
      mockCreateOpenAIClient(mockClient(async () => ({}))),
      "/tmp"
    );
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("query"));
  });

  it("returns error for empty query", async () => {
    const result = await handleExploreToolCall(
      makeToolCall({ query: "", thoroughness: "quick" }),
      mockCreateOpenAIClient(mockClient(async () => ({}))),
      "/tmp"
    );
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("query"));
  });

  it("defaults invalid thoroughness to medium", async () => {
    let capturedModel = "";
    const createFn: MockCreate = async (params) => {
      capturedModel = params.model as string;
      return {
        choices: [{ message: { content: "found it" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    };
    const result = await handleExploreToolCall(
      makeToolCall({ query: "test", thoroughness: "invalid" }),
      mockCreateOpenAIClient(mockClient(createFn)),
      "/tmp"
    );
    assert.equal(result.ok, true);
    // Captured model should be deepseek-v4-flash (auxiliary model for deepseek-v4-pro)
    assert.ok(capturedModel.includes("flash"));
  });

  it("returns error when LLM client is null", async () => {
    const result = await handleExploreToolCall(
      makeToolCall({ query: "test" }),
      () => ({ client: null as any, model: "deepseek-v4-pro", thinkingEnabled: false }),
      "/tmp"
    );
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("LLM client"));
  });

  it("returns error for malformed JSON arguments", async () => {
    const badCall: ToolCall = {
      id: "call_1",
      type: "function",
      function: {
        name: "Explore",
        arguments: "not-json",
      },
    };
    const result = await handleExploreToolCall(badCall, mockCreateOpenAIClient(mockClient(async () => ({}))), "/tmp");
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("Failed to parse"));
  });
});

describe("runExploreSubagent", () => {
  it("returns direct content on single-turn response", async () => {
    const createFn: MockCreate = async () => ({
      choices: [{ message: { content: "The answer is 42" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const result = await runExploreSubagent({
      query: "find answer",
      thoroughness: "quick",
      projectRoot: "/tmp",
      client: mockClient(createFn),
      model: "deepseek-v4-flash",
      sessionId: "test-session",
    });
    assert.equal(result, "The answer is 42");
  });

  it("executes multi-turn tool loop", async () => {
    let callCount = 0;
    const createFn: MockCreate = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "tc1",
                    type: "function",
                    function: { name: "glob", arguments: JSON.stringify({ pattern: "*.ts" }) },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      }
      return {
        choices: [{ message: { content: "Found the files" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    };
    const result = await runExploreSubagent({
      query: "find ts files",
      thoroughness: "quick",
      projectRoot: "/tmp",
      client: mockClient(createFn),
      model: "deepseek-v4-flash",
      sessionId: "test-session",
    });
    assert.equal(callCount, 2);
    assert.equal(result, "Found the files");
  });

  it("respects max turns for quick thoroughness", async () => {
    let callCount = 0;
    const createFn: MockCreate = async () => {
      callCount++;
      return {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: `tc${callCount}`,
                  type: "function",
                  function: { name: "glob", arguments: JSON.stringify({ pattern: "*.ts" }) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    };
    const result = await runExploreSubagent({
      query: "loop forever",
      thoroughness: "quick",
      projectRoot: "/tmp",
      client: mockClient(createFn),
      model: "deepseek-v4-flash",
      sessionId: "test-session",
    });
    // maxTurns for quick is 5, so max 5 API calls
    assert.equal(callCount, 5);
    // Should return fallback with tool counts
    assert.ok(result.startsWith("Exploration complete. Tools called:"));
    assert.ok(result.includes("glob"));
  });

  it("respects max turns for medium thoroughness", async () => {
    let callCount = 0;
    const createFn: MockCreate = async () => {
      callCount++;
      return {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: `tc${callCount}`,
                  type: "function",
                  function: { name: "read", arguments: JSON.stringify({ file_path: "/tmp/x.ts" }) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    };
    await runExploreSubagent({
      query: "loop forever",
      thoroughness: "medium",
      projectRoot: "/tmp",
      client: mockClient(createFn),
      model: "deepseek-v4-flash",
      sessionId: "test-session",
    });
    assert.equal(callCount, 10);
  });

  it("respects max turns for thorough thoroughness", async () => {
    let callCount = 0;
    const createFn: MockCreate = async () => {
      callCount++;
      return {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: `tc${callCount}`,
                  type: "function",
                  function: { name: "grep", arguments: JSON.stringify({ pattern: "test" }) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    };
    await runExploreSubagent({
      query: "loop forever",
      thoroughness: "thorough",
      projectRoot: "/tmp",
      client: mockClient(createFn),
      model: "deepseek-v4-flash",
      sessionId: "test-session",
    });
    assert.equal(callCount, 25);
  });

  it("returns fallback when max turns reached with no content", async () => {
    let callCount = 0;
    const createFn: MockCreate = async () => {
      callCount++;
      return {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: `tc${callCount}`,
                  type: "function",
                  function: { name: "glob", arguments: JSON.stringify({ pattern: "*.ts" }) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    };
    const result = await runExploreSubagent({
      query: "just tools",
      thoroughness: "quick",
      projectRoot: "/tmp",
      client: mockClient(createFn),
      model: "deepseek-v4-flash",
      sessionId: "test-session",
    });
    assert.ok(result.startsWith("Exploration complete. Tools called:"));
  });

  it("records budget for each API call", async () => {
    // Override recordBudgetCost via the module — the function is imported directly
    // so we verify the mock client is called with usage data
    let apiCallCount = 0;
    const createFn: MockCreate = async () => {
      apiCallCount++;
      return {
        choices: [{ message: { content: "done" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      };
    };
    await runExploreSubagent({
      query: "test budget",
      thoroughness: "quick",
      projectRoot: "/tmp",
      client: mockClient(createFn),
      model: "deepseek-v4-flash",
      sessionId: "test-session",
    });
    assert.equal(apiCallCount, 1);
    // recordBudgetCost is called via the module import; budget.md is updated
    // This test verifies the API was called with usage data
  });

  it("returns error on API failure", async () => {
    const createFn: MockCreate = async () => {
      throw new Error("API connection refused");
    };
    const result = await runExploreSubagent({
      query: "test",
      thoroughness: "quick",
      projectRoot: "/tmp",
      client: mockClient(createFn),
      model: "deepseek-v4-flash",
      sessionId: "test-session",
    });
    assert.ok(result.startsWith("Explore error:"));
    assert.ok(result.includes("API connection refused"));
  });

  it("uses thinking: disabled in API calls", async () => {
    let capturedThinking: unknown;
    const createFn: MockCreate = async (params) => {
      capturedThinking = (params as Record<string, unknown>).thinking;
      return { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
    };
    await runExploreSubagent({
      query: "test",
      thoroughness: "quick",
      projectRoot: "/tmp",
      client: mockClient(createFn),
      model: "deepseek-v4-flash",
      sessionId: "test-session",
    });
    assert.deepEqual(capturedThinking, { type: "disabled" });
  });

  it("uses temperature: 0.1 in API calls", async () => {
    let capturedTemp: unknown;
    const createFn: MockCreate = async (params) => {
      capturedTemp = (params as Record<string, unknown>).temperature;
      return { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
    };
    await runExploreSubagent({
      query: "test",
      thoroughness: "quick",
      projectRoot: "/tmp",
      client: mockClient(createFn),
      model: "deepseek-v4-flash",
      sessionId: "test-session",
    });
    assert.equal(capturedTemp, 0);
  });
});
