import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicMessageConverter, convertToolsToAnthropic } from "../common/anthropic-message-converter";
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

// ── convertToolsToAnthropic tests ──────────────────────────────────────

await test("convertToolsToAnthropic converts OpenAI format to Anthropic format", () => {
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { file_path: { type: "string" } },
          required: ["file_path"],
        },
      },
    },
  ];
  const result = convertToolsToAnthropic(tools);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "read_file");
  assert.equal(result[0].description, "Read a file");
  assert.equal(result[0].input_schema.type, "object");
  assert.deepEqual(result[0].input_schema.properties, { file_path: { type: "string" } });
  assert.deepEqual(result[0].input_schema.required, ["file_path"]);
});

await test("convertToolsToAnthropic strips additionalProperties", () => {
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "test",
        description: "test",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
      },
    },
  ];
  const result = convertToolsToAnthropic(tools);
  assert.equal("additionalProperties" in result[0].input_schema, false);
});

await test("convertToolsToAnthropic handles empty required fields", () => {
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "test",
        description: "test",
        parameters: { type: "object", properties: {} },
      },
    },
  ];
  const result = convertToolsToAnthropic(tools);
  assert.equal("required" in result[0].input_schema, false);
});

await test("convertToolsToAnthropic handles empty array", () => {
  const result = convertToolsToAnthropic([]);
  assert.deepEqual(result, []);
});

// ── AnthropicMessageConverter tests ────────────────────────────────────

await test("buildMessages extracts system messages to getSystemPrompt()", () => {
  const converter = new AnthropicMessageConverter();
  const messages = [
    msg({ role: "system", content: "You are a helpful assistant." }),
    msg({ role: "user", content: "Hello" }),
  ];
  const result = converter.buildMessages(messages, false, "claude-sonnet-4-5");
  assert.equal(result.length, 1); // Only user message
  assert.equal(converter.getSystemPrompt(), "You are a helpful assistant.");
});

await test("buildMessages converts user message to content blocks", () => {
  const converter = new AnthropicMessageConverter();
  const messages = [msg({ role: "user", content: "Hello" })];
  const result = converter.buildMessages(messages, false, "claude-sonnet-4-5");
  assert.equal(result.length, 1);
  const userMsg = result[0] as { role: string; content: { type: string; text: string }[] };
  assert.equal(userMsg.role, "user");
  assert.equal(userMsg.content[0].type, "text");
  assert.equal(userMsg.content[0].text, "Hello");
});

await test("buildMessages converts assistant message with tool calls", () => {
  const converter = new AnthropicMessageConverter();
  const messages = [
    msg({
      role: "assistant",
      content: "Let me read that file.",
      messageParams: {
        tool_calls: [
          {
            id: "call_1",
            function: { name: "read", arguments: '{"file_path":"/foo"}' },
          },
        ],
      },
    }),
  ];
  const result = converter.buildMessages(messages, false, "claude-sonnet-4-5");
  const asst = result[0] as any;
  assert.equal(asst.role, "assistant");
  // Should have text block and tool_use block
  assert.equal(asst.content.length, 2);
  const toolBlock = asst.content[1] as { type: string; id: string; name: string; input: Record<string, unknown> };
  assert.equal(toolBlock.type, "tool_use");
  assert.equal(toolBlock.id, "call_1");
  assert.equal(toolBlock.name, "read");
  assert.deepEqual(toolBlock.input, { file_path: "/foo" });
});

await test("buildMessages wraps tool results in user role", () => {
  const converter = new AnthropicMessageConverter();
  const messages = [
    msg({
      role: "assistant",
      content: null,
      messageParams: {
        tool_calls: [{ id: "call_1", function: { name: "read", arguments: "{}" } }],
      },
    }),
    msg({
      role: "tool",
      content: "file contents",
      messageParams: { tool_call_id: "call_1" },
    }),
  ];
  const result = converter.buildMessages(messages, false, "claude-sonnet-4-5");
  assert.equal(result.length, 2);
  const toolResult = result[1] as { role: string; content: { type: string; tool_use_id: string; content: string }[] };
  assert.equal(toolResult.role, "user");
  assert.equal(toolResult.content[0].type, "tool_result");
  assert.equal(toolResult.content[0].tool_use_id, "call_1");
  assert.equal(toolResult.content[0].content, "file contents");
});

await test("buildMessages includes thinking block when reasoning_content present", () => {
  const converter = new AnthropicMessageConverter();
  const messages = [
    msg({
      role: "assistant",
      content: "The answer is 42.",
      messageParams: {
        reasoning_content: "I think the answer is 42.",
        signature: "sig123",
      },
    }),
  ];
  const result = converter.buildMessages(messages, true, "claude-sonnet-4-5");
  const asst = result[0] as any;
  // First block should be thinking
  const thinkBlock = asst.content[0] as { type: string; thinking: string; signature: string };
  assert.equal(thinkBlock.type, "thinking");
  assert.equal(thinkBlock.thinking, "I think the answer is 42.");
  assert.equal(thinkBlock.signature, "sig123");
  // Second should be text
  const textBlock = asst.content[1] as { type: string; text: string };
  assert.equal(textBlock.type, "text");
  assert.equal(textBlock.text, "The answer is 42.");
});

await test("buildMessages filters compacted messages", () => {
  const converter = new AnthropicMessageConverter();
  const messages = [
    msg({ role: "user", content: "visible message" }),
    msg({ role: "user", content: "compacted message", compacted: true }),
  ];
  const result = converter.buildMessages(messages, false, "claude-sonnet-4-5");
  assert.equal(result.length, 1);
  const userMsg = result[0] as { role: string; content: { text: string }[] };
  assert.equal(userMsg.content[0].text, "visible message");
});

await test("buildMessages injects interrupted tool results", () => {
  const converter = new AnthropicMessageConverter();
  const messages = [
    msg({
      role: "assistant",
      content: null,
      messageParams: {
        tool_calls: [{ id: "call_1", function: { name: "read", arguments: "{}" } }],
      },
    }),
    // No matching tool message → interrupted fallback
  ];
  const result = converter.buildMessages(messages, false, "claude-sonnet-4-5");
  assert.equal(result.length, 2);
  const fallback = result[1] as { role: string; content: { type: string; tool_use_id: string; content: string }[] };
  assert.equal(fallback.role, "user");
  assert.equal(fallback.content[0].type, "tool_result");
  assert.equal(fallback.content[0].tool_use_id, "call_1");
  const parsed = JSON.parse(fallback.content[0].content) as {
    ok: boolean;
    metadata: { interrupted: boolean };
  };
  assert.equal(parsed.ok, false);
  assert.equal(parsed.metadata.interrupted, true);
});

await test("getSystemPrompt concatenates multiple system messages", () => {
  const converter = new AnthropicMessageConverter();
  const messages = [
    msg({ role: "system", content: "First system message." }),
    msg({ role: "system", content: "Second system message." }),
    msg({ role: "user", content: "Hello" }),
  ];
  converter.buildMessages(messages, false, "claude-sonnet-4-5");
  const prompt = converter.getSystemPrompt();
  assert.ok(prompt.includes("First system message."));
  assert.ok(prompt.includes("Second system message."));
  assert.ok(prompt.includes("\n\n"));
});

await test("getSystemPrompt returns empty string when no system messages", () => {
  const converter = new AnthropicMessageConverter();
  const messages = [msg({ role: "user", content: "Hello" })];
  converter.buildMessages(messages, false, "claude-sonnet-4-5");
  assert.equal(converter.getSystemPrompt(), "");
});

await test("buildMessages does not include thinking when disabled", () => {
  const converter = new AnthropicMessageConverter();
  const messages = [
    msg({
      role: "assistant",
      content: "Answer",
      messageParams: {
        reasoning_content: "Thinking",
        signature: "sig",
      },
    }),
  ];
  const result = converter.buildMessages(messages, false, "claude-sonnet-4-5");
  const asst = result[0] as any;
  // Should only have text, no thinking block
  const types = asst.content.map((c: { type: string }) => c.type);
  assert.equal(types.includes("thinking"), false);
});
