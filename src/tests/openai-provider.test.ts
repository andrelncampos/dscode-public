import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../providers/openai-provider";
import type { CreateOpenAIClient } from "../tools/executor";

function makeClient(overrides: Record<string, unknown> = {}): CreateOpenAIClient {
  return () => ({
    client: {
      chat: {
        completions: {
          create:
            (overrides.create as any) ??
            (() => {
              throw new Error("not implemented");
            }),
        },
      },
    } as any,
    model: "gpt-5.4",
    baseURL: "https://api.openai.com/v1",
    thinkingEnabled: false,
    reasoningEffort: "high" as const,
    debugLogEnabled: false,
    telemetryEnabled: false,
    maxTokens: 32768,
    env: {},
    ...overrides,
  });
}

// ── supportsModel ──

test("supportsModel returns true for OpenAI model names", () => {
  const provider = new OpenAIProvider(makeClient());
  assert.ok(provider.supportsModel("gpt-5.4"));
  assert.ok(provider.supportsModel("o1"));
  assert.ok(provider.supportsModel("o3-mini"));
  assert.ok(provider.supportsModel("openai-custom-model"));
});

test("supportsModel returns false for non-OpenAI model names", () => {
  const provider = new OpenAIProvider(makeClient());
  assert.ok(!provider.supportsModel("deepseek-v4-pro"));
  assert.ok(!provider.supportsModel("claude-sonnet"));
});

// ── getTimeoutMs ──

test("getTimeoutMs returns 300_000 for reasoning models", () => {
  const provider = new OpenAIProvider(makeClient());
  assert.equal(provider.getTimeoutMs("gpt-5.4"), 300_000);
  assert.equal(provider.getTimeoutMs("o1"), 300_000);
  assert.equal(provider.getTimeoutMs("o3"), 300_000);
  assert.equal(provider.getTimeoutMs("o4"), 300_000);
});

test("getTimeoutMs returns 180_000 for non-reasoning models", () => {
  const provider = new OpenAIProvider(makeClient());
  assert.equal(provider.getTimeoutMs("gpt-5.4-mini"), 180_000);
});

// ── isMultimodal ──

test("isMultimodal returns false for non-multimodal models", () => {
  const provider = new OpenAIProvider(makeClient());
  assert.ok(!provider.isMultimodal("o1-mini"));
  assert.ok(!provider.isMultimodal("o3-mini"));
});

test("isMultimodal returns true for multimodal models", () => {
  const provider = new OpenAIProvider(makeClient());
  assert.ok(provider.isMultimodal("gpt-5.4"));
});

// ── getAuxiliaryModel ──

test("getAuxiliaryModel returns gpt-5.4-mini for gpt-5.4", () => {
  const provider = new OpenAIProvider(makeClient());
  assert.equal(provider.getAuxiliaryModel("gpt-5.4"), "gpt-5.4-mini");
});

test("getAuxiliaryModel returns null for already auxiliary models", () => {
  const provider = new OpenAIProvider(makeClient());
  assert.equal(provider.getAuxiliaryModel("gpt-5.4-nano"), null);
  assert.equal(provider.getAuxiliaryModel("o1-mini"), null);
});

test("getAuxiliaryModel returns o3-mini for o3", () => {
  const provider = new OpenAIProvider(makeClient());
  assert.equal(provider.getAuxiliaryModel("o3"), "o3-mini");
});

test("getAuxiliaryModel returns null for o4-mini", () => {
  const provider = new OpenAIProvider(makeClient());
  assert.equal(provider.getAuxiliaryModel("o4-mini"), null);
});

// ── chat ──

test("chat yields text_delta events", async () => {
  const provider = new OpenAIProvider(
    makeClient({
      create: () => mockStream([{ choices: [{ delta: { content: "Hello" } }] }]),
    })
  );
  const events = await collectStream(provider.chat({ model: "gpt-5.4", messages: [] }));
  assert.ok(events.some((e) => e.type === "text_delta" && e.text === "Hello"));
});

test("chat yields reasoning_delta events", async () => {
  const provider = new OpenAIProvider(
    makeClient({
      create: () => mockStream([{ choices: [{ delta: { reasoning_content: "Let me think..." } }] }]),
    })
  );
  const events = await collectStream(provider.chat({ model: "gpt-5.4", messages: [] }));
  assert.ok(events.some((e) => e.type === "reasoning_delta" && e.text === "Let me think..."));
});

test("chat yields tool_call_start and tool_call_delta events", async () => {
  const provider = new OpenAIProvider(
    makeClient({
      create: () =>
        mockStream([
          {
            choices: [
              { delta: { tool_calls: [{ id: "call_1", index: 0, function: { name: "read", arguments: "" } }] } },
            ],
          },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"file' } }] } }] },
        ]),
    })
  );
  const events = await collectStream(provider.chat({ model: "gpt-5.4", messages: [] }));
  assert.ok(events.some((e) => e.type === "tool_call_start" && e.name === "read"));
  assert.ok(events.some((e) => e.type === "tool_call_delta" && e.arguments === '{"file'));
});

test("chat yields usage event", async () => {
  const provider = new OpenAIProvider(
    makeClient({
      create: () =>
        mockStream([
          {
            choices: [{ delta: { content: "Hi" } }],
            usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
          },
        ]),
    })
  );
  const events = await collectStream(provider.chat({ model: "gpt-5.4", messages: [] }));
  assert.ok(events.some((e) => e.type === "usage" && (e.usage as any).prompt_tokens === 10));
});

test("chat throws when API key is missing", async () => {
  const provider = new OpenAIProvider(() => ({
    client: null,
    model: "gpt-5.4",
    baseURL: "",
    thinkingEnabled: false,
    reasoningEffort: "high",
    debugLogEnabled: false,
    telemetryEnabled: false,
    maxTokens: 0,
    env: {},
  }));
  await assert.rejects(async () => {
    const stream = provider.chat({ model: "gpt-5.4", messages: [] });
    for await (const _ of stream) {
      /* consume */
    }
  }, /OpenAI API key not configured/);
});

test("chat respects abort signal", async () => {
  const controller = new AbortController();
  // Pre-abort the signal so it's already aborted when chat is called
  controller.abort("test abort");
  // Mock create that respects the signal passed by withRetry
  const provider = new OpenAIProvider(
    makeClient({
      create: (_request: unknown, options?: { signal?: AbortSignal }) => {
        if (options?.signal?.aborted) {
          const err = new Error("The operation was aborted") as Error & { name: string };
          err.name = "AbortError";
          throw err;
        }
        return mockStream([{ choices: [{ delta: { content: "x" } }] }]);
      },
    })
  );
  await assert.rejects(async () => {
    for await (const _ of provider.chat({
      model: "gpt-5.4",
      messages: [],
      signal: controller.signal,
    })) {
      /* consume */
    }
  }, /(abort|AbortError)/i);
});

test("chat passes 'openai' to buildThinkingRequestOptions (reasoning_effort at top level)", async () => {
  let capturedRequest: Record<string, unknown> | undefined;
  const provider = new OpenAIProvider(
    makeClient({
      create: (request: Record<string, unknown>) => {
        capturedRequest = request;
        return mockStream([{ choices: [{ delta: { content: "ok" } }] }]);
      },
    })
  );
  const events = await collectStream(
    provider.chat({
      model: "gpt-5.4",
      messages: [],
      providerOptions: { thinkingEnabled: true, reasoningEffort: "high" },
    })
  );
  // Verify text was produced
  assert.ok(events.some((e) => e.type === "text_delta" && e.text === "ok"));
  // Verify reasoning_effort is at top level (OpenAI format, NOT inside thinking or extra_body)
  assert.ok(capturedRequest, "request should have been captured");
  assert.equal((capturedRequest as Record<string, unknown>).reasoning_effort, "high");
  assert.ok(
    !(capturedRequest as Record<string, unknown>).thinking,
    "should not have 'thinking' envelope (DeepSeek format)"
  );
  assert.ok(!(capturedRequest as Record<string, unknown>).extra_body, "should not have 'extra_body' (DeepSeek format)");
});

// ── Helpers ──

function mockStream(chunks: Record<string, unknown>[]): Record<string, unknown> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<Record<string, unknown>>> => {
        const chunk = chunks.shift();
        return chunk ? { value: chunk, done: false } : { value: undefined, done: true };
      },
    }),
  };
}

async function collectStream(stream: AsyncIterable<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
