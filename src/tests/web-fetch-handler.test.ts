import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import type { ToolExecutionContext } from "../tools/executor";
import { handleWebFetchTool } from "../tools/web-fetch-handler";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("WebFetch returns error for missing url", async () => {
  const result = await handleWebFetchTool({}, createContext("webfetch-no-url"));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Missing required "url" string.');
});

test("WebFetch returns error for invalid URL", async () => {
  const result = await handleWebFetchTool({ url: "not-a-valid-url!!!" }, createContext("webfetch-invalid-url"));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Invalid URL/);
});

test("WebFetch returns error for unsupported protocol", async () => {
  const result = await handleWebFetchTool(
    { url: "ftp://files.example.com/data.txt" },
    createContext("webfetch-bad-protocol")
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Unsupported protocol/);
});

test("WebFetch returns error for localhost", async () => {
  const result = await handleWebFetchTool({ url: "http://localhost:3000/api" }, createContext("webfetch-localhost"));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /not allowed/);
});

test("WebFetch returns error for 127.0.0.1", async () => {
  const result = await handleWebFetchTool({ url: "http://127.0.0.1:8080/" }, createContext("webfetch-loopback"));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /not allowed/);
});

test("WebFetch returns error for private IP 192.168.x.x", async () => {
  const result = await handleWebFetchTool({ url: "http://192.168.1.1/admin" }, createContext("webfetch-private"));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /not allowed/);
});

test("WebFetch returns error for private IP 10.x.x.x", async () => {
  const result = await handleWebFetchTool({ url: "http://10.0.0.1/status" }, createContext("webfetch-10x"));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /not allowed/);
});

test("WebFetch returns error for invalid HTTP method", async () => {
  const result = await handleWebFetchTool(
    { url: "https://example.com", method: "FOO" },
    createContext("webfetch-bad-method")
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Invalid HTTP method/);
});

test("WebFetch returns error for headers that is not an object", async () => {
  const result = await handleWebFetchTool(
    { url: "https://example.com", headers: "not-an-object" },
    createContext("webfetch-bad-headers")
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /headers.*JSON object/);
});

test("WebFetch fetches and returns HTML content (stripped)", async () => {
  mockFetch(200, "text/html", "<html><body><h1>Hello</h1><p>World</p></body></html>");

  const result = await handleWebFetchTool({ url: "https://docs.example.com/page" }, createContext("webfetch-html"));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.url, "https://docs.example.com/page");
  assert.equal(output.status, 200);
  assert.ok(output.content.includes("Hello"));
  assert.ok(output.content.includes("World"));
  assert.ok(!output.content.includes("<h1>"), "HTML tags should be stripped");
  assert.equal(output.truncated, false);
  assert.match(output.content_type, /text\/html/);
});

test("WebFetch fetches and returns JSON content as-is", async () => {
  const json = JSON.stringify({ name: "test", version: "1.0" });
  mockFetch(200, "application/json", json);

  const result = await handleWebFetchTool({ url: "https://api.example.com/data" }, createContext("webfetch-json"));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.status, 200);
  assert.equal(output.content, json);
  assert.match(output.content_type, /application\/json/);
});

test("WebFetch passes custom headers", async () => {
  let capturedHeaders: Record<string, string> = {};
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    return createMockResponse(200, "text/plain", "ok");
  }) as typeof fetch;

  await handleWebFetchTool(
    {
      url: "https://api.example.com/secured",
      headers: { Authorization: "Bearer abc123", "X-API-Key": "key-xyz" },
    },
    createContext("webfetch-headers")
  );

  assert.equal(capturedHeaders["Authorization"], "Bearer abc123");
  assert.equal(capturedHeaders["X-API-Key"], "key-xyz");
});

test("WebFetch sends POST body", async () => {
  let capturedBody: string | undefined;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    capturedBody = init?.body as string | undefined;
    return createMockResponse(201, "application/json", '{"created": true}');
  }) as typeof fetch;

  const result = await handleWebFetchTool(
    {
      url: "https://api.example.com/resource",
      method: "POST",
      body: JSON.stringify({ name: "new-item" }),
    },
    createContext("webfetch-post")
  );

  assert.equal(result.ok, true);
  assert.equal(capturedBody, '{"name":"new-item"}');
});

test("WebFetch truncates content to maxChars", async () => {
  const longText = "x".repeat(500);
  mockFetch(200, "text/plain", longText);

  const result = await handleWebFetchTool(
    { url: "https://example.com/long", maxChars: 100 },
    createContext("webfetch-truncate")
  );
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.truncated, true);
  assert.equal(output.content.length, 100);
});

test("WebFetch handles timeout gracefully", async () => {
  globalThis.fetch = (async () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    throw err;
  }) as typeof fetch;

  const result = await handleWebFetchTool({ url: "https://slow.example.com" }, createContext("webfetch-timeout"));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /timed out/);
});

test("WebFetch handles network errors gracefully", async () => {
  globalThis.fetch = (async () => {
    throw new Error("Network error: connection refused");
  }) as typeof fetch;

  const result = await handleWebFetchTool({ url: "https://down.example.com" }, createContext("webfetch-network-error"));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Failed to fetch/);
  assert.match(result.error ?? "", /connection refused/);
});

test("WebFetch strips script and style tags from HTML", async () => {
  mockFetch(
    200,
    "text/html",
    "<html><head><script>alert('xss')</script><style>body{color:red}</style></head><body><p>Visible text</p></body></html>"
  );

  const result = await handleWebFetchTool(
    { url: "https://docs.example.com/safe" },
    createContext("webfetch-strip-scripts")
  );
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.ok(!output.content.includes("alert"), "Script content should be stripped");
  assert.ok(!output.content.includes("body{color:red}"), "Style content should be stripped");
  assert.ok(output.content.includes("Visible text"));
});

test("WebFetch decodes HTML entities", async () => {
  mockFetch(200, "text/html", "<p>&amp; &lt;div&gt; &quot;hi&quot; &#39;ok&#39;</p>");

  const result = await handleWebFetchTool({ url: "https://example.com/entities" }, createContext("webfetch-entities"));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.ok(output.content.includes("&"), "Should decode &amp;");
  assert.ok(output.content.includes('"hi"'), "Should decode &quot;");
  assert.ok(output.content.includes("'ok'"), "Should decode &#39;");
});

function createContext(sessionId: string): ToolExecutionContext {
  return {
    sessionId,
    projectRoot: "/tmp/test-project",
    toolCall: {
      id: "test-tool-call",
      type: "function",
      function: {
        name: "WebFetch",
        arguments: "{}",
      },
    },
  };
}

function mockFetch(status: number, contentType: string, body: string): void {
  globalThis.fetch = (async () => {
    return createMockResponse(status, contentType, body);
  }) as typeof fetch;
}

function createMockResponse(status: number, contentType: string, body: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ "content-type": contentType }),
    text: async () => body,
    json: async () => JSON.parse(body),
    blob: async () => new Blob([body]),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    bodyUsed: false,
    redirected: false,
    type: "basic",
    url: "",
    clone() {
      return createMockResponse(status, contentType, body);
    },
    body: null,
    formData: async () => new FormData(),
    bytes: async () => new TextEncoder().encode(body),
  } as unknown as Response;
}
