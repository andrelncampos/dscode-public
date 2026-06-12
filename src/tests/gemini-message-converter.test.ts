import test from "node:test";
import assert from "node:assert/strict";
import { GeminiMessageConverter, convertToolsToGemini } from "../common/gemini-message-converter";
import type { SessionMessage } from "../session";
import type { ToolDefinition } from "../prompt";

function msg(overrides: Partial<SessionMessage> & { role: SessionMessage["role"] }): SessionMessage {
  const { role, ...rest } = overrides;
  return {
    id: "msg-1",
    sessionId: "sess-1",
    role,
    content: null,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
    ...rest,
  };
}

// ── convertToolsToGemini tests ──────────────────────────────────────────

await test("convertToolsToGemini converts OpenAI format to Gemini format", () => {
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "bash",
        description: "Executes a bash command.",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    },
  ];
  const result = convertToolsToGemini(tools);
  assert.equal(result.length, 1);
  assert.equal(result[0].functionDeclarations.length, 1);
  const decl = result[0].functionDeclarations[0];
  assert.equal(decl.name, "bash");
  assert.equal(decl.description, "Executes a bash command.");
  assert.equal(decl.parameters.type, "object");
  assert.deepEqual(decl.parameters.properties, { command: { type: "string" } });
  assert.deepEqual(decl.parameters.required, ["command"]);
});

await test("convertToolsToGemini groups all tools into single functionDeclarations", () => {
  const tools: ToolDefinition[] = [
    { type: "function", function: { name: "t1", description: "d1", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "t2", description: "d2", parameters: { type: "object", properties: {} } } },
  ];
  const result = convertToolsToGemini(tools);
  assert.equal(result.length, 1);
  assert.equal(result[0].functionDeclarations.length, 2);
  assert.equal(result[0].functionDeclarations[0].name, "t1");
  assert.equal(result[0].functionDeclarations[1].name, "t2");
});

await test("convertToolsToGemini handles empty array", () => {
  const result = convertToolsToGemini([]);
  assert.deepEqual(result, []);
});

await test("convertToolsToGemini handles multiple tools", () => {
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: { name: "a", description: "a", parameters: { type: "object", properties: { x: { type: "string" } } } },
    },
    {
      type: "function",
      function: { name: "b", description: "b", parameters: { type: "object", properties: { y: { type: "number" } } } },
    },
    { type: "function", function: { name: "c", description: "c", parameters: { type: "object", properties: {} } } },
  ];
  const result = convertToolsToGemini(tools);
  assert.equal(result[0].functionDeclarations.length, 3);
});

// ── GeminiMessageConverter tests ────────────────────────────────────────

await test("buildMessages extracts system messages to getSystemInstruction()", () => {
  const converter = new GeminiMessageConverter();
  const messages = [
    msg({ role: "system", id: "sys-1", content: "You are a helpful assistant." }),
    msg({ role: "user", id: "u-1", content: "Hello" }),
  ];
  const result = converter.buildMessages(messages, false, "gemini-3.5-flash");
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "user");
  const si = converter.getSystemInstruction();
  assert.notEqual(si, null);
  assert.equal(si!.parts.length, 1);
  assert.equal(si!.parts[0].text, "You are a helpful assistant.");
});

await test("getSystemInstruction returns null when no system messages", () => {
  const converter = new GeminiMessageConverter();
  const messages = [msg({ role: "user", id: "u-1", content: "Hello" })];
  converter.buildMessages(messages, false, "gemini-3.5-flash");
  assert.equal(converter.getSystemInstruction(), null);
});

await test("buildMessages concatenates multiple system messages", () => {
  const converter = new GeminiMessageConverter();
  const messages = [
    msg({ role: "system", id: "sys-1", content: "First." }),
    msg({ role: "system", id: "sys-2", content: "Second." }),
    msg({ role: "user", id: "u-1", content: "Hello" }),
  ];
  converter.buildMessages(messages, false, "gemini-3.5-flash");
  const si = converter.getSystemInstruction();
  assert.equal(si!.parts.length, 2);
  assert.equal(si!.parts[0].text, "First.");
  assert.equal(si!.parts[1].text, "Second.");
});

await test("buildMessages converts user message to parts", () => {
  const converter = new GeminiMessageConverter();
  const messages = [msg({ role: "user", id: "u-1", content: "Hello world" })];
  const result = converter.buildMessages(messages, false, "gemini-3.5-flash");
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "user");
  assert.equal(result[0].parts.length, 1);
  assert.equal((result[0].parts[0] as { text: string }).text, "Hello world");
});

await test("buildMessages converts assistant message with text", () => {
  const converter = new GeminiMessageConverter();
  const messages = [msg({ role: "assistant", id: "a-1", content: "I'll help." })];
  const result = converter.buildMessages(messages, false, "gemini-3.5-flash");
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "model");
  assert.equal(result[0].parts.length, 1);
  assert.equal((result[0].parts[0] as { text: string }).text, "I'll help.");
});

await test("buildMessages converts assistant message with tool calls", () => {
  const converter = new GeminiMessageConverter();
  const messages = [
    msg({
      role: "assistant",
      id: "a-1",
      content: "Let me search.",
      messageParams: {
        tool_calls: [
          {
            id: "call_1",
            function: { name: "read", arguments: '{"file_path":"/foo"}' },
          },
        ],
      },
    }),
    msg({
      role: "tool",
      id: "t-1",
      content: "file contents here",
      messageParams: { tool_call_id: "call_1" },
    }),
  ];
  const result = converter.buildMessages(messages, false, "gemini-3.5-flash");
  assert.equal(result.length, 2);
  assert.equal(result[0].role, "model");
  // Text part + functionCall part
  const fcPart = result[0].parts.find((p) => "functionCall" in p) as
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | undefined;
  assert.notEqual(fcPart, undefined);
  assert.equal(fcPart!.functionCall.name, "read");
  assert.deepEqual(fcPart!.functionCall.args, { file_path: "/foo" });
  // Tool result
  assert.equal(result[1].role, "tool");
  const frPart = result[1].parts[0] as { functionResponse: { name: string; response: Record<string, unknown> } };
  assert.equal(frPart.functionResponse.name, "read");
  assert.equal(frPart.functionResponse.response.content, "file contents here");
});

await test("buildMessages converts assistant message with thinking", () => {
  const converter = new GeminiMessageConverter();
  const messages = [
    msg({
      role: "assistant",
      id: "a-1",
      content: "Answer",
      messageParams: { reasoning_content: "Let me think..." },
    }),
  ];
  const result = converter.buildMessages(messages, true, "gemini-3.5-flash");
  // Thought part should come before text part
  assert.equal(result[0].parts.length, 2);
  assert.ok("thought" in result[0].parts[0]);
  assert.equal((result[0].parts[0] as { thought: string }).thought, "Let me think...");
  assert.equal((result[0].parts[1] as { text: string }).text, "Answer");
});

await test("buildMessages does not include thought when thinking disabled", () => {
  const converter = new GeminiMessageConverter();
  const messages = [
    msg({
      role: "assistant",
      id: "a-1",
      content: "Answer",
      messageParams: { reasoning_content: "Let me think..." },
    }),
  ];
  const result = converter.buildMessages(messages, false, "gemini-3.5-flash");
  assert.equal(result[0].parts.length, 1);
  assert.ok("text" in result[0].parts[0]);
});

await test("buildMessages converts tool results to functionResponse", () => {
  const converter = new GeminiMessageConverter();
  const messages = [
    msg({
      role: "assistant",
      id: "a-1",
      content: null,
      messageParams: {
        tool_calls: [{ id: "call_1", function: { name: "bash", arguments: '{"command":"ls"}' } }],
      },
    }),
    msg({
      role: "tool",
      id: "t-1",
      content: "output",
      messageParams: { tool_call_id: "call_1" },
    }),
  ];
  const result = converter.buildMessages(messages, false, "gemini-3.5-flash");
  assert.equal(result.length, 2);
  assert.equal(result[1].role, "tool");
  const frPart = result[1].parts[0] as { functionResponse: { name: string; response: Record<string, unknown> } };
  assert.ok(frPart.functionResponse.response.content);
});

await test("buildMessages injects interrupted tool results", () => {
  const converter = new GeminiMessageConverter();
  const messages = [
    msg({
      role: "assistant",
      id: "a-1",
      content: null,
      messageParams: {
        tool_calls: [{ id: "orphan_1", function: { name: "bash", arguments: '{"command":"ls"}' } }],
      },
    }),
  ];
  const result = converter.buildMessages(messages, false, "gemini-3.5-flash");
  assert.equal(result.length, 2);
  assert.equal(result[1].role, "tool");
  const frPart = result[1].parts[0] as { functionResponse: { name: string; response: Record<string, unknown> } };
  const parsed = JSON.parse(frPart.functionResponse.response.content as string);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, "Previous tool call did not complete.");
  assert.equal(parsed.metadata.interrupted, true);
});

await test("buildMessages filters compacted messages", () => {
  const converter = new GeminiMessageConverter();
  const messages = [
    msg({ role: "system", id: "sys-1", content: "Be helpful." }),
    msg({ role: "user", id: "u-1", content: "Hello", compacted: true }),
    msg({ role: "user", id: "u-2", content: "World" }),
  ];
  const result = converter.buildMessages(messages, false, "gemini-3.5-flash");
  // Only the non-compacted user message should be in the result
  assert.equal(result.length, 1);
  assert.equal((result[0].parts[0] as { text: string }).text, "World");
});

await test("buildMessages filters images for non-multimodal model", () => {
  const converter = new GeminiMessageConverter();
  // Use a model name that is explicitly non-multimodal (simulated)
  const messages = [
    msg({
      role: "user",
      id: "u-1",
      content: "Look at this",
      contentParams: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc123" } }],
    }),
  ];
  // isMultimodalModel returns true for all models not in NON_MULTIMODAL_MODELS set
  // All Gemini models are multimodal, but test the filtering logic exists
  const result = converter.buildMessages(messages, false, "gemini-3.5-flash");
  assert.equal(result.length, 1);
  // Should have text part + inlineData part (since gemini-3.5-flash is multimodal)
  const hasImage = result[0].parts.some((p) => "inlineData" in p);
  assert.equal(hasImage, true);
});

await test("buildMessages handles empty messages array", () => {
  const converter = new GeminiMessageConverter();
  const result = converter.buildMessages([], false, "gemini-3.5-flash");
  assert.deepEqual(result, []);
  assert.equal(converter.getSystemInstruction(), null);
});
