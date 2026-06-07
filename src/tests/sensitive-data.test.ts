import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSensitive, maskSensitiveString } from "../common/sensitive-data";

// ---------------------------------------------------------------------------
// maskSensitiveString
// ---------------------------------------------------------------------------

test("maskSensitiveString redacts Authorization: Bearer header", () => {
  const input = "Authorization: Bearer sk-abc123def456";
  const result = maskSensitiveString(input);
  assert.ok(result.includes("Bearer [REDACTED]"));
  assert.ok(!result.includes("sk-abc123def456"));
});

test("maskSensitiveString redacts Authorization: Basic header", () => {
  const input = "Authorization: Basic dXNlcjpwYXNz";
  const result = maskSensitiveString(input);
  assert.ok(result.includes("Basic [REDACTED]"));
  assert.ok(!result.includes("dXNlcjpwYXNz"));
});

test("maskSensitiveString redacts standalone Bearer tokens", () => {
  const result = maskSensitiveString("use Bearer abc123xyz for auth");
  assert.ok(result.includes("Bearer [REDACTED]"));
  assert.ok(!result.includes("abc123xyz"));
});

test("maskSensitiveString redacts standalone Basic tokens", () => {
  const result = maskSensitiveString("auth: Basic dXNlcjpwYXNz end");
  assert.ok(result.includes("Basic [REDACTED]"));
  assert.ok(!result.includes("dXNlcjpwYXNz"));
});

test("maskSensitiveString redacts OpenAI-style sk- keys", () => {
  const result = maskSensitiveString("key=sk-proj-1234567890abcdef1234567890abcdef");
  assert.ok(result.includes("[REDACTED]"));
  assert.ok(!result.includes("sk-proj"));
});

test("maskSensitiveString redacts x-api-key header values", () => {
  const input = "x-api-key: my-secret-api-key-12345";
  const result = maskSensitiveString(input);
  assert.ok(result.includes("x-api-key: [REDACTED]"));
  assert.ok(!result.includes("my-secret-api-key-12345"));
});

test("maskSensitiveString redacts key=value patterns with sensitive key names", () => {
  assert.ok(maskSensitiveString("api_key=secret123").includes("[REDACTED]"));
  assert.ok(!maskSensitiveString("api_key=secret123").includes("secret123"));

  assert.ok(maskSensitiveString("access_token=abc.def.ghi").includes("[REDACTED]"));
  assert.ok(!maskSensitiveString("access_token=abc.def.ghi").includes("abc.def.ghi"));

  assert.ok(maskSensitiveString("client_secret=super-secret").includes("[REDACTED]"));
  assert.ok(!maskSensitiveString("client_secret=super-secret").includes("super-secret"));

  assert.ok(maskSensitiveString("refresh_token=rft-123").includes("[REDACTED]"));
  assert.ok(!maskSensitiveString("refresh_token=rft-123").includes("rft-123"));
});

test("maskSensitiveString redacts key:value patterns with sensitive key names", () => {
  assert.ok(maskSensitiveString('api_key: "abc123"').includes("[REDACTED]"));
  assert.ok(!maskSensitiveString('api_key: "abc123"').includes("abc123"));

  assert.ok(maskSensitiveString("access_token: xyz789").includes("[REDACTED]"));
  assert.ok(!maskSensitiveString("access_token: xyz789").includes("xyz789"));
});

test("maskSensitiveString does not redact common English words in strings (avoids false positives)", () => {
  // token, secret, password are intentionally NOT redacted at the string level.
  // They are handled at the object-key level by maskSensitive().
  assert.equal(maskSensitiveString("token=abc123"), "token=abc123");
  assert.equal(maskSensitiveString("secret=xyz789"), "secret=xyz789");
  assert.equal(maskSensitiveString("password=mypass"), "password=mypass");
});

test("maskSensitiveString redacts JSON-like sensitive fields", () => {
  const input = '{"api_key":"sk-abc123","client_secret":"jwt.here"}';
  const result = maskSensitiveString(input);
  assert.ok(!result.includes("sk-abc123"));
  assert.ok(!result.includes("jwt.here"));
  assert.ok(result.includes("[REDACTED]"));
});

test("maskSensitiveString preserves non-sensitive text", () => {
  const input = "This is a normal log message with model=gpt-4 and status=ok";
  const result = maskSensitiveString(input);
  assert.equal(result, input);
});

test("maskSensitiveString handles empty string", () => {
  assert.equal(maskSensitiveString(""), "");
});

// ---------------------------------------------------------------------------
// maskSensitive — key-based redaction
// ---------------------------------------------------------------------------

test("maskSensitive redacts sensitive top-level keys", () => {
  const input = {
    authorization: "Bearer sk-secret",
    "x-api-key": "my-key",
    apiKey: "key-123",
    api_key: "key-456",
    token: "jwt-token",
    secret: "my-secret",
    password: "pass123",
    cookie: "session=abc",
    known: "visible",
  };
  const inputClone = structuredClone(input);

  const result = maskSensitive(input) as Record<string, unknown>;

  // Sensitive keys → "[REDACTED]"
  assert.equal(result.authorization, "[REDACTED]");
  assert.equal(result["x-api-key"], "[REDACTED]");
  assert.equal(result.apiKey, "[REDACTED]");
  assert.equal(result.api_key, "[REDACTED]");
  assert.equal(result.token, "[REDACTED]");
  assert.equal(result.secret, "[REDACTED]");
  assert.equal(result.password, "[REDACTED]");
  assert.equal(result.cookie, "[REDACTED]");

  // Non-sensitive key preserved
  assert.equal(result.known, "visible");

  // Original object is NOT mutated
  assert.deepEqual(input, inputClone);
});

test("maskSensitive redacts case-insensitive key matches", () => {
  const input = { Authorization: "Bearer abc", AUTHORIZATION: "Basic xyz", Token: "jwt" };
  const result = maskSensitive(input) as Record<string, unknown>;
  assert.equal(result.Authorization, "[REDACTED]");
  assert.equal(result.AUTHORIZATION, "[REDACTED]");
  assert.equal(result.Token, "[REDACTED]");
});

test("maskSensitive redacts nested sensitive keys", () => {
  const input = {
    headers: {
      authorization: "Bearer nested-secret",
      "content-type": "application/json",
    },
    config: {
      apiKey: "nested-key",
      timeout: 3000,
    },
  };
  const result = maskSensitive(input) as Record<string, unknown>;
  const headers = result.headers as Record<string, unknown>;
  const config = result.config as Record<string, unknown>;

  assert.equal(headers.authorization, "[REDACTED]");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(config.apiKey, "[REDACTED]");
  assert.equal(config.timeout, 3000);
});

test("maskSensitive handles arrays", () => {
  const input = {
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Authorization: Bearer sk-key-in-message" },
    ],
  };
  const result = maskSensitive(input) as Record<string, unknown>;
  const messages = result.messages as Array<Record<string, unknown>>;

  assert.equal(messages[0].content, "hello");
  const assistantContent = messages[1].content as string;
  assert.ok(assistantContent.includes("[REDACTED]"));
  assert.ok(!assistantContent.includes("sk-key-in-message"));
});

test("maskSensitive handles null and primitives", () => {
  assert.equal(maskSensitive(null), null);
  assert.equal(maskSensitive(42), 42);
  assert.equal(maskSensitive(true), true);
});

test("maskSensitive handles circular references", () => {
  const input: Record<string, unknown> = { name: "test" };
  (input as any).self = input;

  const result = maskSensitive(input) as Record<string, unknown>;
  assert.equal(result.name, "test");
  assert.equal(result.self, "[Circular]");
});

test("maskSensitive handles Error objects", () => {
  const input = {
    error: new Error("API error with key sk-abcdef1234567890"),
  };
  const result = maskSensitive(input) as Record<string, unknown>;
  const err = result.error as Record<string, unknown>;
  assert.equal(err.name, "Error");
  const msg = err.message as string;
  assert.ok(msg.includes("[REDACTED]"));
  assert.ok(!msg.includes("sk-abcdef"));
});

test("maskSensitive handles bigint", () => {
  const input = { count: BigInt(123) };
  const result = maskSensitive(input) as Record<string, unknown>;
  assert.equal(result.count, "123");
});

test("maskSensitive does not mutate original object", () => {
  const input = {
    authorization: "Bearer original-secret",
    nested: { api_key: "nested-secret" },
    items: [{ token: "item-token" }],
  };
  const inputClone = structuredClone(input);

  maskSensitive(input);

  // Original must be identical to clone
  assert.deepEqual(input, inputClone);
});

test("maskSensitive preserves non-sensitive nested objects intact", () => {
  const input = {
    model: "gpt-4",
    messages: [{ role: "user", content: "hello world" }],
  };
  const result = maskSensitive(input);
  assert.deepEqual(result, input);
});
