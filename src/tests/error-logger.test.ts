import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyApiError } from "../common/error-logger";

test("classifyApiError — 401 → auth failure", () => {
  assert.equal(
    classifyApiError({ status: 401, message: "Unauthorized" }),
    "Authentication failed — check your API key"
  );
});

test("classifyApiError — 403 → access denied", () => {
  assert.equal(
    classifyApiError({ status: 403, message: "Forbidden" }),
    "Access denied — your account may lack access to this model"
  );
});

test("classifyApiError — 404 → model not found", () => {
  assert.equal(
    classifyApiError({ status: 404, message: "Not found" }),
    "Model not found — the model name may be incorrect or unavailable in your region"
  );
});

test("classifyApiError — 429 → rate limit", () => {
  assert.equal(classifyApiError({ status: 429, message: "Too many requests" }), "Rate limit exceeded — wait and retry");
});

test("classifyApiError — 413 → request too large", () => {
  assert.equal(
    classifyApiError({ status: 413, message: "Payload too large" }),
    "Request too large — reduce input size"
  );
});

test("classifyApiError — 400 + context keyword", () => {
  assert.equal(
    classifyApiError({ status: 400, message: "context length exceeded" }),
    "Context length exceeded — reduce conversation size"
  );
});

test("classifyApiError — 400 + length keyword", () => {
  assert.equal(
    classifyApiError({ status: 400, message: "This model's maximum context length is 8192 tokens" }),
    "Context length exceeded — reduce conversation size"
  );
});

test("classifyApiError — ECONNREFUSED", () => {
  assert.equal(
    classifyApiError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" }),
    "Network error — check your connection"
  );
});

test("classifyApiError — ETIMEDOUT", () => {
  assert.equal(classifyApiError({ code: "ETIMEDOUT", message: "timeout" }), "Network error — check your connection");
});

test("classifyApiError — 502 → provider error", () => {
  assert.equal(
    classifyApiError({ status: 502, message: "Bad gateway" }),
    "Provider server error (HTTP 502) — the API may be down"
  );
});

test("classifyApiError — 4xx unknown", () => {
  assert.equal(classifyApiError({ status: 418, message: "I'm a teapot" }), "Client error (HTTP 418): I'm a teapot");
});

test("classifyApiError — null input", () => {
  assert.equal(classifyApiError(null), "Unknown error: (no details)");
});

test("classifyApiError — plain string", () => {
  assert.equal(classifyApiError("connection refused"), "Unknown error: connection refused");
});

test("classifyApiError — 400 without context/length keywords", () => {
  assert.equal(classifyApiError({ status: 400, message: "Bad request" }), "Client error (HTTP 400): Bad request");
});

test("classifyApiError — 429 without message", () => {
  assert.equal(classifyApiError({ status: 429 }), "Rate limit exceeded — wait and retry");
});
