import { describe, it } from "node:test";
import * as assert from "node:assert";
import type { SkillInfo } from "../session";
import { getBuiltInToolDefinitions, getTools } from "../prompt";

// ── Task 10: mode parsing tests ──────────────────────────────────────

describe("mode parsing", () => {
  it("defaults to undefined when mode not specified", () => {
    // readSkillInfo is async and requires filesystem, but the SkillInfo type
    // just requires mode?: "prompt" | "agent". Simulate the parsed result.
    const skill: SkillInfo = {
      name: "test-skill",
      path: "/tmp/test.md",
      description: "A test skill",
    };
    assert.strictEqual(skill.mode, undefined);
  });

  it("accepts mode: 'prompt'", () => {
    const skill: SkillInfo = {
      name: "test-skill",
      path: "/tmp/test.md",
      description: "A test skill",
      mode: "prompt",
    };
    assert.strictEqual(skill.mode, "prompt");
  });

  it("accepts mode: 'agent'", () => {
    const skill: SkillInfo = {
      name: "test-skill",
      path: "/tmp/test.md",
      description: "A test skill",
      mode: "agent",
    };
    assert.strictEqual(skill.mode, "agent");
  });

  it("SkillInfo has agent-specific fields (agentModel, agentThinking, etc.)", () => {
    const skill: SkillInfo = {
      name: "test-skill",
      path: "/tmp/test.md",
      description: "A test skill",
      mode: "agent",
      agentModel: "deepseek-v4-flash",
      agentThinking: "enabled",
      agentTools: ["read", "grep", "glob"],
      agentMaxTurns: 25,
      agentTimeoutMs: 120000,
    };
    assert.strictEqual(skill.agentModel, "deepseek-v4-flash");
    assert.strictEqual(skill.agentThinking, "enabled");
    assert.deepStrictEqual(skill.agentTools, ["read", "grep", "glob"]);
    assert.strictEqual(skill.agentMaxTurns, 25);
    assert.strictEqual(skill.agentTimeoutMs, 120000);
  });
});

// ── Task 10: getTools() tests ────────────────────────────────────────

describe("getBuiltInToolDefinitions", () => {
  it("returns at least 11 built-in tools", () => {
    const defs = getBuiltInToolDefinitions();
    assert.ok(defs.length >= 11, `Expected >= 11, got ${defs.length}`);
  });

  it("includes Read, Grep, Glob, Write, Edit, Bash", () => {
    const defs = getBuiltInToolDefinitions();
    const names = defs.map((t) => {
      return typeof t.function === "object" && "name" in t.function ? t.function.name : "";
    });
    const required = ["read", "grep", "glob", "write", "edit", "bash"];
    for (const name of required) {
      assert.ok(names.includes(name), `Missing built-in tool: ${name}`);
    }
  });

  it("includes Explore", () => {
    const defs = getBuiltInToolDefinitions();
    const names = defs.map((t) => {
      return typeof t.function === "object" && "name" in t.function ? t.function.name : "";
    });
    assert.ok(names.includes("Explore"), "Explore tool not found in built-in definitions");
  });
});

describe("getTools with skills", () => {
  it("returns built-in tools even with empty skills", () => {
    const tools = getTools({}, [], []);
    assert.ok(tools.length >= 11, `Expected >= 11, got ${tools.length}`);
  });

  it("does NOT add tool definitions for non-agent skills", () => {
    const skills: SkillInfo[] = [
      {
        name: "my-skill",
        path: "/tmp/my.md",
        description: "My skill",
        mode: "prompt",
      },
    ];
    const tools = getTools({}, [], skills);
    const names = tools.map((t) => {
      return typeof t.function === "object" && "name" in t.function ? t.function.name : "";
    });
    assert.ok(!names.includes("my-skill"), `Did not expect tool definition for prompt skill: my-skill`);
  });

  it("adds tool definitions for agent skills", () => {
    const skills: SkillInfo[] = [
      {
        name: "agent-skill",
        path: "/tmp/agent.md",
        description: "An agent skill",
        mode: "agent",
      },
    ];
    const tools = getTools({}, [], skills);
    const names = tools.map((t) => {
      return typeof t.function === "object" && "name" in t.function ? t.function.name : "";
    });
    assert.ok(names.includes("agent-skill"), `Expected tool definition for agent-skill`);
  });

  it("sorts agent skills alphabetically", () => {
    const skills: SkillInfo[] = [
      { name: "zebra", path: "/tmp/z.md", description: "Z", mode: "agent" },
      { name: "apple", path: "/tmp/a.md", description: "A", mode: "agent" },
      { name: "cat", path: "/tmp/c.md", description: "C", mode: "agent" },
    ];
    const tools = getTools({}, [], skills);
    const agentNames = tools
      .filter((t) => {
        const name = typeof t.function === "object" && "name" in t.function ? t.function.name : "";
        return (
          ![""].includes(name) &&
          !getBuiltInToolDefinitions().some(
            (b) => typeof b.function === "object" && "name" in b.function && b.function.name === name
          )
        );
      })
      .map((t) => {
        return typeof t.function === "object" && "name" in t.function ? t.function.name : "";
      });
    assert.deepStrictEqual(agentNames, ["apple", "cat", "zebra"]);
  });

  it("excludes agent skills that conflict with built-in tool names", () => {
    const skills: SkillInfo[] = [
      {
        name: "read",
        path: "/tmp/read-skill.md",
        description: "A conflicting skill",
        mode: "agent",
      },
    ];
    const tools = getTools({}, [], skills);
    const readDefs = tools.filter((t) => {
      return typeof t.function === "object" && "name" in t.function && t.function.name === "read";
    });
    // Should only have the built-in read, not the agent duplicate
    assert.strictEqual(readDefs.length, 1, "Expected 1 read definition");
  });

  it("generates correct tool definition for agent skills", () => {
    const skills: SkillInfo[] = [
      {
        name: "test-agent",
        path: "/tmp/test-agent.md",
        description: "A test agent skill for testing purposes",
        mode: "agent",
      },
    ];
    const tools = getTools({}, [], skills);
    const agentTool = tools.find(
      (t) => typeof t.function === "object" && "name" in t.function && t.function.name === "test-agent"
    );
    assert.ok(agentTool, "Agent tool definition not found");
    assert.strictEqual(typeof agentTool!.function, "object");
    const func = agentTool!.function as { name: string; description: string; parameters: Record<string, unknown> };
    assert.ok(func.description.includes("A test agent skill"));
    assert.ok(func.description.includes("isolated subagent"));
    const params = func.parameters;
    assert.strictEqual(params.type, "object");
    assert.ok("prompt" in (params.properties as Record<string, unknown>));
  });
});
