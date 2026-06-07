import { test } from "node:test";
import assert from "node:assert/strict";
import { reportNewPrompt } from "../common/telemetry";

test("reportNewPrompt never calls fetch regardless of options (telemetry permanently disabled)", () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => {
    called = true;
    return Promise.resolve(new Response());
  }) as typeof globalThis.fetch;

  try {
    reportNewPrompt({ enabled: false });
    assert.equal(called, false);

    reportNewPrompt({ enabled: true });
    assert.equal(called, false);

    reportNewPrompt({ enabled: true, timeoutMs: 100 });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reportNewPrompt never throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.reject(new Error("Network error"));
  }) as typeof globalThis.fetch;

  try {
    // Should never throw — telemetry is permanently disabled.
    reportNewPrompt({ enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
