import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleWebSearchTool } from "../tools/web-search-handler";
import type { ToolExecutionContext } from "../tools/executor";

function makeContext(webSearchTool?: string): ToolExecutionContext {
  return {
    sessionId: "test-session",
    projectRoot: process.cwd(),
    toolCall: {
      id: "call_test",
      type: "function",
      function: { name: "WebSearch", arguments: "{}" },
    },
    createOpenAIClient: () => ({
      client: null as any,
      model: "test",
      baseURL: "http://localhost",
      thinkingEnabled: false,
      reasoningEffort: "high",
      debugLogEnabled: false,
      telemetryEnabled: false,
      webSearchTool,
      env: {},
    }),
  };
}

test("handleWebSearchTool returns error for empty query", async () => {
  const result = await handleWebSearchTool({ query: "" }, makeContext());
  assert.equal(result.ok, false);
  assert.match(result.error!, /Missing required/i);
});

test("handleWebSearchTool returns configuration error when webSearchTool is not set", async () => {
  const result = await handleWebSearchTool({ query: "test query" }, makeContext(undefined));
  assert.equal(result.ok, false);
  assert.match(result.error!, /not configured|configure webSearchTool/i);
});

test(
  "handleWebSearchTool executes configured script and returns stdout",
  { skip: process.platform === "win32" },
  async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dscode-test-websearch-"));
    const scriptPath = path.join(tmpDir, process.platform === "win32" ? "search.cmd" : "search.sh");

    if (process.platform === "win32") {
      fs.writeFileSync(
        scriptPath,
        `@echo off\r\necho {"results":[{"title":"Test Result","url":"http://example.com","snippet":"This is a test result."}]}\r\n`
      );
    } else {
      fs.writeFileSync(
        scriptPath,
        `#!/bin/sh\necho '{"results":[{"title":"Test Result","url":"http://example.com","snippet":"This is a test result."}]}'\n`
      );
      fs.chmodSync(scriptPath, 0o755);
    }

    try {
      const result = await handleWebSearchTool({ query: "test query" }, makeContext(scriptPath));
      assert.equal(result.ok, true);
      assert.equal(result.name, "WebSearch");
      assert.ok(result.output, "Expected output to be present");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
);

test("handleWebSearchTool returns error when configured script does not exist", async () => {
  const result = await handleWebSearchTool({ query: "test query" }, makeContext("/nonexistent/path/search.sh"));
  assert.equal(result.ok, false);
  assert.match(result.error!, /ENOENT|executar|execute|failed|not found/i);
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
