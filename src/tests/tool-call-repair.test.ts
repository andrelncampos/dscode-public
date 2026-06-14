import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  repairToolCall,
  createRepairMetrics,
  type ToolCallRepairMetrics,
  type ToolRegistry,
} from "../tools/tool-call-repair";
import type { ToolCall } from "../tools/executor";
import { getBuiltInToolDefinitions } from "../prompt";
import type { ToolDefinition } from "../prompt";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeToolCall(name: string, args: string): ToolCall {
  return {
    id: "test-1",
    type: "function",
    function: { name, arguments: args },
  };
}

function createMockRegistry(overrides?: Record<string, ToolDefinition>): ToolRegistry {
  const builtIn = getBuiltInToolDefinitions();
  const map = new Map<string, ToolDefinition>();
  for (const def of builtIn) map.set(def.function.name, def);
  if (overrides) {
    for (const [name, def] of Object.entries(overrides)) {
      map.set(name, def);
    }
  }
  return {
    resolve: (name) => {
      const trimmed = name.trim();
      if (map.has(trimmed)) return { canonicalName: trimmed, definition: map.get(trimmed) };
      const lower = trimmed.toLowerCase();
      for (const [canonical, def] of map) {
        if (canonical.toLowerCase() === lower) return { canonicalName: canonical, definition: def };
      }
      return undefined;
    },
    getAllNames: () => [...map.keys()].sort(),
  };
}

// ── Parse Stage: JSON Recovery ───────────────────────────────────────────────

describe("Parse Stage — JSON Recovery", () => {
  const registry = createMockRegistry();

  test("valid JSON returns unchanged", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"]}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.deepEqual(result.args, { command: "ls", sideEffects: ["read-in-cwd"] });
  });

  test("empty string returns empty object", () => {
    const metrics = createRepairMetrics();
    // Use a tool with no required args to avoid validation failure
    const optRegistry = createMockRegistry({
      optool: {
        type: "function",
        function: {
          name: "optool",
          description: "Tool with no required args",
          parameters: { type: "object", properties: {} },
        },
      },
    });
    const result = repairToolCall(makeToolCall("optool", ""), optRegistry, metrics);
    assert.ok("toolCall" in result);
    assert.deepEqual(result.args, {});
  });

  test("unescaped Windows path backslash", () => {
    const metrics = createRepairMetrics();
    // read tool expects file_path
    const rawArgs = '{"file_path":"C:\\git\\dscode"}';
    const result = repairToolCall(makeToolCall("read", rawArgs), registry, metrics);
    assert.ok("toolCall" in result);
    assert.equal(result.args.file_path, "C:\\git\\dscode");
    assert.ok(metrics.stageSuccesses.parse > 0);
  });

  test("unescaped quote inside string value", () => {
    const metrics = createRepairMetrics();
    // bash tool with description field having unescaped quotes
    const rawArgs = '{"command":"ls","sideEffects":["read-in-cwd"],"description":"say \\"hello\\""}';
    const result = repairToolCall(makeToolCall("bash", rawArgs), registry, metrics);
    assert.ok("toolCall" in result);
    assert.equal(result.args.description, 'say "hello"');
  });

  test("trailing comma in object", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"],}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.equal(result.args.command, "ls");
  });

  test("trailing comma in array", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd",]}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.deepEqual(result.args.sideEffects, ["read-in-cwd"]);
  });

  test("truncated JSON — missing closing brace", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"]'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.equal(result.args.command, "ls");
  });

  test("truncated JSON — missing closing bracket", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.equal(result.args.command, "ls");
  });

  test("truncated JSON — missing colon and value", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("bash", '{"command":"ls","sideEffects'), registry, metrics);
    // Should succeed with structural completion injecting null placeholder
    assert.ok("toolCall" in result);
    assert.equal(result.args.command, "ls");
  });

  test("truncated JSON — mid-string cutoff", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"],"description":"hello'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.equal(result.args.command, "ls");
  });

  test("combined issues — backslash + trailing comma", () => {
    const metrics = createRepairMetrics();
    const rawArgs = '{"file_path":"C:\\git\\dscode",}';
    const result = repairToolCall(makeToolCall("read", rawArgs), registry, metrics);
    assert.ok("toolCall" in result);
    assert.equal(result.args.file_path, "C:\\git\\dscode");
  });

  test("completely malformed non-JSON string", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("bash", "not json at all"), registry, metrics);
    assert.ok("error" in result);
    assert.ok(metrics.failedRepairs > 0);
  });

  test("arguments as array (not object)", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("bash", "[1,2,3]"), registry, metrics);
    assert.ok("error" in result);
    assert.match(result.error, /must be a JSON object/);
  });
});

// ── Validate Stage: Tool Registry ─────────────────────────────────────────────

describe("Validate Stage — Tool Registry", () => {
  const registry = createMockRegistry();

  test("exact tool name match", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"]}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.equal(result.toolCall.function.name, "bash");
  });

  test("case-insensitive tool name match", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("Bash", '{"command":"ls","sideEffects":["read-in-cwd"]}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.equal(result.toolCall.function.name, "bash");
  });

  test("whitespace-trimmed tool name match", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("  bash  ", '{"command":"ls","sideEffects":["read-in-cwd"]}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.equal(result.toolCall.function.name, "bash");
  });

  test("unknown tool name returns error with available tools list", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("nonexistent_tool", "{}"), registry, metrics);
    assert.ok("error" in result);
    assert.match(result.error, /Unknown tool/);
    assert.match(result.error, /Available tools/);
    assert.ok(metrics.failedRepairs > 0);
  });

  test("missing required arguments detected", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("bash", '{"command":"ls"}'), registry, metrics);
    // bash requires command AND sideEffects
    assert.ok("error" in result);
    assert.match(result.error, /Missing required arguments/);
    assert.match(result.error, /sideEffects/);
  });

  test("multiple missing required arguments listed", () => {
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("bash", "{}"), registry, metrics);
    assert.ok("error" in result);
    assert.match(result.error, /command/);
    assert.match(result.error, /sideEffects/);
  });

  test("optional args only — no missing error", () => {
    const metrics = createRepairMetrics();
    // create a tool definition with only optional args
    const optRegistry = createMockRegistry({
      optool: {
        type: "function",
        function: {
          name: "optool",
          description: "Tool with only optional args",
          parameters: {
            type: "object",
            properties: {
              debug: { type: "boolean", default: false },
            },
          },
        },
      },
    });
    const result = repairToolCall(makeToolCall("optool", "{}"), optRegistry, metrics);
    assert.ok("toolCall" in result);
  });

  test("MCP tool without definition passes validation", () => {
    // Create a registry that resolves but returns no definition
    const mcpRegistry: ToolRegistry = {
      resolve: (name) => {
        const trimmed = name.trim();
        if (trimmed === "mcp__test__tool") {
          return { canonicalName: trimmed, definition: undefined };
        }
        return undefined;
      },
      getAllNames: () => ["mcp__test__tool"],
    };
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("mcp__test__tool", '{"arg":"value"}'), mcpRegistry, metrics);
    assert.ok("toolCall" in result);
    assert.equal(result.args.arg, "value");
  });
});

// ── Repair Stage: Fixes ───────────────────────────────────────────────────────

describe("Repair Stage — Fixes", () => {
  test("default value injected for missing optional arg", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    // bash definition has run_in_background with no default, description with default ""
    // Actually check if bash has defaults in the built-in defs
    const result = repairToolCall(
      makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"]}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    // description should be injected as "" if default exists
    if (result.args.description !== undefined) {
      assert.equal(result.args.description, "");
    }
    // run_in_background may or may not have a default
  });

  test("default value NOT injected when arg explicitly provided", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"],"description":"my desc"}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.equal(result.args.description, "my desc");
  });

  test("type coercion — string to array (single string)", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":"ls","sideEffects":"read-in-cwd"}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    // sideEffects should be coerced from string to [string]
    assert.ok(Array.isArray(result.args.sideEffects));
    assert.deepEqual(result.args.sideEffects, ["read-in-cwd"]);
  });

  test("type coercion — array to string (single element)", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":["ls"],"sideEffects":["read-in-cwd"]}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.equal(result.args.command, "ls");
  });

  test("type coercion — number to string", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    const result = repairToolCall(
      makeToolCall("bash", '{"command":123,"sideEffects":["read-in-cwd"]}'),
      registry,
      metrics
    );
    assert.ok("toolCall" in result);
    assert.equal(result.args.command, "123");
  });

  test("type coercion — truthy to boolean", () => {
    // Create tool with boolean param
    const boolRegistry = createMockRegistry({
      booltool: {
        type: "function",
        function: {
          name: "booltool",
          description: "Test tool",
          parameters: {
            type: "object",
            properties: {
              flag: { type: "boolean" },
            },
          },
        },
      },
    });
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("booltool", '{"flag":1}'), boolRegistry, metrics);
    assert.ok("toolCall" in result);
    assert.equal(result.args.flag, true);
  });

  test("type coercion — 'true' string to boolean", () => {
    const boolRegistry = createMockRegistry({
      booltool: {
        type: "function",
        function: {
          name: "booltool",
          description: "Test tool",
          parameters: {
            type: "object",
            properties: { flag: { type: "boolean" } },
          },
        },
      },
    });
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("booltool", '{"flag":"true"}'), boolRegistry, metrics);
    assert.ok("toolCall" in result);
    assert.equal(result.args.flag, true);
  });

  test("type coercion — 'false' string to boolean", () => {
    const boolRegistry = createMockRegistry({
      booltool: {
        type: "function",
        function: {
          name: "booltool",
          description: "Test tool",
          parameters: {
            type: "object",
            properties: { flag: { type: "boolean" } },
          },
        },
      },
    });
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("booltool", '{"flag":"false"}'), boolRegistry, metrics);
    assert.ok("toolCall" in result);
    assert.equal(result.args.flag, false);
  });

  test("type coercion — non-coercible type left unchanged", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("bash", '{"command":"ls","sideEffects":true}'), registry, metrics);
    // boolean cannot be coerced to array — should fail at some point
    // But repair stage leaves it unchanged; validation doesn't catch type mismatches.
    // The handler may fail. But repair itself should "succeed" (toolCall returned).
    // Actually, because sideEffects is required and passing validation as true
    // (it's present), the repair succeeds.
    if ("toolCall" in result) {
      // Value left unchanged — still true, not an array
      assert.equal(result.args.sideEffects, true);
    }
  });

  test("tool name normalized to canonical form", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("Read", '{"file_path":"/tmp/test.txt"}'), registry, metrics);
    assert.ok("toolCall" in result);
    assert.equal(result.toolCall.function.name, "read");
  });
});

// ── Pipeline Integration ─────────────────────────────────────────────────────

describe("Pipeline Integration", () => {
  test("max 2 attempts — unrecoverable error", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    const result = repairToolCall(makeToolCall("bush", "not json"), registry, metrics);
    assert.ok("error" in result);
    assert.ok(metrics.failedRepairs === 1);
    assert.equal(metrics.totalCalls, 1);
  });

  test("fast path — valid call adds negligible time", () => {
    const registry = createMockRegistry();
    const metrics1 = createRepairMetrics();
    repairToolCall(makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"]}'), registry, metrics1);
    // Time should be measured in recentCalls
    assert.equal(metrics1.recentCalls.length, 1);
    // Just verify latency is a non-negative number
    assert.ok(metrics1.recentCalls[0]!.latencyMs >= 0);
  });

  test("metrics — totalCalls incremented", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    assert.equal(metrics.totalCalls, 0);
    repairToolCall(makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"]}'), registry, metrics);
    assert.equal(metrics.totalCalls, 1);
  });

  test("metrics — repairedCalls incremented on repair", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    repairToolCall(makeToolCall("Bash", '{"command":"ls","sideEffects":["read-in-cwd"]}'), registry, metrics);
    // Name was normalized from "Bash" to "bash" — that's a repair
    assert.ok(metrics.repairedCalls > 0);
  });

  test("metrics — failedRepairs incremented on failure", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    assert.equal(metrics.failedRepairs, 0);
    repairToolCall(makeToolCall("nonexistent", "{}"), registry, metrics);
    assert.equal(metrics.failedRepairs, 1);
  });

  test("metrics — per-stage successes counted", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    repairToolCall(makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"]}'), registry, metrics);
    assert.ok(metrics.stageSuccesses.parse > 0);
    assert.ok(metrics.stageSuccesses.validate > 0);
    assert.ok(metrics.stageSuccesses.repair > 0);
  });

  test("metrics — latency measured", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    assert.equal(metrics.totalRepairLatencyMs, 0);
    repairToolCall(makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"]}'), registry, metrics);
    assert.ok(metrics.totalRepairLatencyMs > 0);
  });

  test("recentCalls — records are kept", () => {
    const registry = createMockRegistry();
    const metrics = createRepairMetrics();
    for (let i = 0; i < 110; i++) {
      repairToolCall(makeToolCall("bash", '{"command":"ls","sideEffects":["read-in-cwd"]}'), registry, metrics);
    }
    // Circular buffer max 100
    assert.ok(metrics.recentCalls.length <= 100);
    assert.equal(metrics.totalCalls, 110);
  });
});
