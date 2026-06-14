import { describe, it } from "node:test";
import assert from "node:assert";
import { McpPolicy } from "../mcp/mcp-policy";

describe("McpPolicy", () => {
  // FR-002: Empty rules → evaluate returns "ask"
  it("empty rules → evaluate returns ask", () => {
    const policy = new McpPolicy([]);
    assert.strictEqual(policy.evaluate("mcp__any__tool"), "ask");
  });

  // FR-001: Parse "deny mcp__shell__*" correctly
  it("parses deny mcp__shell__* correctly", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__shell__*"]);
    const rules = policy.getRules();
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].action, "deny");
    assert.strictEqual(rules[0].pattern, "mcp__shell__*");
    assert.strictEqual(rules[0].source, "steering");
  });

  // FR-001: Parse "allow mcp__postgres__*" correctly
  it("parses allow mcp__postgres__* correctly", () => {
    const policy = new McpPolicy(["- MCP: allow mcp__postgres__*"]);
    const rules = policy.getRules();
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].action, "allow");
    assert.strictEqual(rules[0].pattern, "mcp__postgres__*");
  });

  // FR-001: Parse "ask mcp__github__create_pr" correctly
  it("parses ask mcp__github__create_pr correctly", () => {
    const policy = new McpPolicy(["- MCP: ask mcp__github__create_pr"]);
    const rules = policy.getRules();
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].action, "ask");
    assert.strictEqual(rules[0].pattern, "mcp__github__create_pr");
  });

  // FR-001: Non-MCP lines ignored
  it("non-MCP lines are ignored", () => {
    const policy = new McpPolicy([
      "- MCP: deny mcp__shell__*",
      "- some other steering rule",
      "not even a steering rule",
    ]);
    assert.strictEqual(policy.getRules().length, 1);
  });

  // FR-001: Malformed action → skipped
  it("malformed action is skipped", () => {
    const policy = new McpPolicy(["- MCP: block mcp__*"]);
    assert.strictEqual(policy.getRules().length, 0);
  });

  // FR-001: Missing mcp__ in pattern → skipped
  it("pattern missing mcp__ prefix is skipped", () => {
    const policy = new McpPolicy(["- MCP: deny some_tool"]);
    assert.strictEqual(policy.getRules().length, 0);
  });

  // FR-001: Whitespace trimming
  it("trims leading/trailing whitespace in action and pattern", () => {
    const policy = new McpPolicy(["  - MCP:   allow   mcp__postgres__*   "]);
    const rules = policy.getRules();
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].action, "allow");
    assert.strictEqual(rules[0].pattern, "mcp__postgres__*");
  });

  // FR-002: Wildcard mcp__shell__* matches mcp__shell__exec
  it("wildcard mcp__shell__* matches mcp__shell__exec", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__shell__*"]);
    assert.strictEqual(policy.evaluate("mcp__shell__exec"), "deny");
  });

  // FR-002: Wildcard mcp__shell__* does NOT match mcp__postgres__query
  it("wildcard mcp__shell__* does NOT match mcp__postgres__query", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__shell__*"]);
    assert.strictEqual(policy.evaluate("mcp__postgres__query"), "ask");
  });

  // FR-002: Universal mcp__* matches everything MCP
  it("universal mcp__* matches all MCP tools", () => {
    const policy = new McpPolicy(["- MCP: allow mcp__*"]);
    assert.strictEqual(policy.evaluate("mcp__any__tool"), "allow");
    assert.strictEqual(policy.evaluate("mcp__other__func"), "allow");
  });

  // FR-002: First-match-wins
  it("first-match-wins: deny shell first, then allow * → deny wins for shell", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__shell__exec", "- MCP: allow mcp__*"]);
    assert.strictEqual(policy.evaluate("mcp__shell__exec"), "deny");
    assert.strictEqual(policy.evaluate("mcp__other__func"), "allow");
  });

  // FR-002: Non-MCP tool always returns "ask"
  it("non-MCP tool returns ask regardless of rules", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__*"]);
    assert.strictEqual(policy.evaluate("Read"), "ask");
    assert.strictEqual(policy.evaluate("Bash"), "ask");
  });

  // FR-010: reload updates rules correctly
  it("reload updates rules correctly", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__shell__*"]);
    assert.strictEqual(policy.evaluate("mcp__shell__exec"), "deny");

    policy.reload(["- MCP: allow mcp__shell__*"]);
    assert.strictEqual(policy.evaluate("mcp__shell__exec"), "allow");
  });

  // FR-010: getRules returns current rules
  it("getRules returns current rules after reload", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__old__*"]);
    assert.strictEqual(policy.getRules().length, 1);

    policy.reload(["- MCP: allow mcp__new__*"]);
    assert.strictEqual(policy.getRules().length, 1);
    assert.strictEqual(policy.getRules()[0].pattern, "mcp__new__*");
  });

  // FR-002: Performance < 1ms for 50 rules
  it("evaluate completes in <1ms for 50 rules", () => {
    const rules: string[] = [];
    for (let i = 0; i < 50; i++) {
      rules.push(`- MCP: allow mcp__server${i}__*`);
    }
    const policy = new McpPolicy(rules);
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      policy.evaluate("mcp__server49__some_tool");
    }
    const elapsed = performance.now() - start;
    assert.ok(
      elapsed / 100 < 1,
      `Expected <1ms per call but took ${(elapsed / 100).toFixed(3)}ms per call for 100 evals`
    );
  });

  // findDenyReason tests
  it("findDenyReason returns pattern of first matching deny rule", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__shell__*"]);
    assert.strictEqual(policy.findDenyReason("mcp__shell__exec"), "mcp__shell__*");
  });

  it("findDenyReason returns null when no deny matches", () => {
    const policy = new McpPolicy(["- MCP: allow mcp__*"]);
    assert.strictEqual(policy.findDenyReason("mcp__shell__exec"), null);
  });

  // ── Skill rules tests ──

  it("addSkillRules with valid rules → evaluate uses skill action when session has no match", () => {
    const policy = new McpPolicy([]);
    policy.addSkillRules("db", ["- MCP: deny mcp__postgres__drop_table"]);
    assert.strictEqual(policy.evaluate("mcp__postgres__drop_table"), "deny");
    assert.strictEqual(policy.evaluate("mcp__postgres__query"), "ask");
  });

  it("session deny overrides skill allow", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__postgres__*"]);
    policy.addSkillRules("db", ["- MCP: allow mcp__postgres__*"]);
    assert.strictEqual(policy.evaluate("mcp__postgres__query"), "deny");
  });

  it("removeSkillRules removes rules", () => {
    const policy = new McpPolicy([]);
    policy.addSkillRules("db", ["- MCP: deny mcp__postgres__*"]);
    assert.strictEqual(policy.evaluate("mcp__postgres__query"), "deny");
    policy.removeSkillRules("db");
    assert.strictEqual(policy.evaluate("mcp__postgres__query"), "ask");
  });

  it("multiple skills rules merge — first-match across skills in insertion order", () => {
    const policy = new McpPolicy([]);
    policy.addSkillRules("skill-a", ["- MCP: allow mcp__postgres__*"]);
    policy.addSkillRules("skill-b", ["- MCP: deny mcp__postgres__drop_table"]);
    // skill-a rules come first, so allow wins for drop_table
    assert.strictEqual(policy.evaluate("mcp__postgres__drop_table"), "allow");
    assert.strictEqual(policy.evaluate("mcp__postgres__query"), "allow");
  });

  it("malformed skill rules are skipped", () => {
    const policy = new McpPolicy([]);
    policy.addSkillRules("db", ["- MCP: invalid mcp__*", "- MCP: deny mcp__postgres__*"]);
    assert.strictEqual(policy.evaluate("mcp__postgres__query"), "deny");
  });

  it("evaluate with non-MCP tool never evaluates skill rules", () => {
    const policy = new McpPolicy([]);
    policy.addSkillRules("db", ["- MCP: deny mcp__*"]);
    assert.strictEqual(policy.evaluate("Read"), "ask");
  });

  it("findDenyReason searches skill rules after session rules", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__shell__*"]);
    policy.addSkillRules("db", ["- MCP: deny mcp__postgres__*"]);
    assert.strictEqual(policy.findDenyReason("mcp__shell__exec"), "mcp__shell__*");
    assert.strictEqual(policy.findDenyReason("mcp__postgres__query"), "mcp__postgres__*");
    assert.strictEqual(policy.findDenyReason("mcp__other__tool"), null);
  });

  it("getRules returns session rules then skill rules", () => {
    const policy = new McpPolicy(["- MCP: deny mcp__shell__*"]);
    policy.addSkillRules("db", ["- MCP: allow mcp__postgres__*"]);
    const rules = policy.getRules();
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].pattern, "mcp__shell__*");
    assert.strictEqual(rules[1].pattern, "mcp__postgres__*");
  });
});
