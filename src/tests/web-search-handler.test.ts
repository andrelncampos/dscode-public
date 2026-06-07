import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ToolExecutionContext } from "../tools/executor";
import { handleWebSearchTool } from "../tools/web-search-handler";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test(
  "WebSearch executes the configured script with the query as one argument",
  { skip: process.platform === "win32" },
  async () => {
    const workspace = createTempWorkspace();
    const scriptPath = path.join(workspace, "web-search.sh");
    fs.writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        "printf 'query=%s\\n' \"$1\"",
        "printf 'cwd=%s\\n' \"$PWD\"",
        "printf 'webhook=%s\\n' \"$WEBHOOK\"",
      ].join("\n"),
      "utf8"
    );
    fs.chmodSync(scriptPath, 0o755);

    const starts: Array<{ id: string | number; command: string }> = [];
    const exits: Array<string | number> = [];
    const result = await handleWebSearchTool(
      { query: "latest node release" },
      createContext(workspace, {
        webSearchTool: scriptPath,
        env: { WEBHOOK: "configured" },
        onProcessStart: (id, command) => starts.push({ id, command }),
        onProcessExit: (id) => exits.push(id),
      })
    );
    const realWorkspace = fs.realpathSync(workspace);

    assert.equal(result.ok, true);
    assert.equal(result.output, `query=latest node release\ncwd=${realWorkspace}\nwebhook=configured\n`);
    assert.equal(starts.length, 1);
    assert.match(starts[0].command, /^WebSearch: latest node release$/);
    assert.deepEqual(exits, [starts[0].id]);
  }
);

test("WebSearch returns a configuration error when no script is configured", async () => {
  const workspace = createTempWorkspace();
  const result = await handleWebSearchTool({ query: "latest node release" }, createContext(workspace));

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /not configured|configure webSearchTool/i);
});

function createContext(
  projectRoot: string,
  options: {
    webSearchTool?: string;
    env?: Record<string, string>;
    onProcessStart?: (processId: string | number, command: string) => void;
    onProcessExit?: (processId: string | number) => void;
  } = {}
): ToolExecutionContext {
  return {
    sessionId: "web-search-test",
    projectRoot,
    toolCall: {
      id: "tool-call-id",
      type: "function",
      function: {
        name: "WebSearch",
        arguments: "{}",
      },
    },
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      baseURL: "http://localhost",
      thinkingEnabled: false,
      reasoningEffort: "high",
      debugLogEnabled: false,
      telemetryEnabled: false,
      webSearchTool: options.webSearchTool,
      env: options.env ?? {},
    }),
    onProcessStart: options.onProcessStart,
    onProcessExit: options.onProcessExit,
  };
}

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-web-search-"));
  tempDirs.push(dir);
  return dir;
}
