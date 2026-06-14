import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { McpScopeResolver } from "../mcp/mcp-scopes";

function writeConfig(fp: string, s: Record<string, unknown>) {
  const d = path.dirname(fp);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify({ servers: s }), "utf8");
}
describe("McpScopeResolver", () => {
  let tmp: string;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ts-"));
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const mk = (n: string) => ({ g: path.join(tmp, n, "g.json"), p: path.join(tmp, n, "p.json") });

  it("reads global scope", () => {
    const { g, p } = mk("t1");
    writeConfig(g, { pg: { command: "npx" } });
    assert.strictEqual(new McpScopeResolver(g, p).resolve().pg.command, "npx");
  });

  it("project overrides global", () => {
    const { g, p } = mk("t2");
    writeConfig(g, { pg: { command: "global" } });
    writeConfig(p, { pg: { command: "project" } });
    assert.strictEqual(new McpScopeResolver(g, p).resolve().pg.command, "project");
  });

  it("session overrides both", () => {
    const { g, p } = mk("t3");
    writeConfig(g, { pg: { command: "global" } });
    writeConfig(p, { pg: { command: "project" } });
    const r = new McpScopeResolver(g, p);
    r.addSessionServer("pg", { command: "session" });
    assert.strictEqual(r.resolve().pg.command, "session");
  });

  it("disabled removes server", () => {
    const { g, p } = mk("t4");
    writeConfig(g, { pg: { command: "npx" } });
    writeConfig(p, { pg: { command: "npx", disabled: true } });
    assert.ok(!("pg" in new McpScopeResolver(g, p).resolve()));
  });

  it("missing files returns empty", () => {
    const { g, p } = mk("t5");
    assert.deepStrictEqual(new McpScopeResolver(g, p).resolve(), {});
  });

  it("legacy merged as lowest", () => {
    const { g, p } = mk("t6");
    writeConfig(g, { pg: { command: "global" } });
    const r = new McpScopeResolver(g, p).resolve({ pg: { command: "legacy" }, gh: { command: "leg" } });
    assert.strictEqual(r.pg.command, "global");
    assert.strictEqual(r.gh.command, "leg");
  });

  it("disabledTools preserved", () => {
    const { g, p } = mk("t7");
    writeConfig(g, { pg: { command: "npx", disabledTools: ["drop"] } });
    assert.deepStrictEqual(new McpScopeResolver(g, p).resolve().pg.disabledTools, ["drop"]);
  });

  it("disabledTools empty array preserved", () => {
    const { g, p } = mk("t8");
    writeConfig(g, { pg: { command: "npx", disabledTools: [] } });
    assert.strictEqual(new McpScopeResolver(g, p).resolve().pg.disabledTools?.length, 0);
  });

  it("invalid JSON returns empty", () => {
    const { g, p } = mk("t9");
    const d = path.dirname(g);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(g, "bad json {", "utf8");
    assert.deepStrictEqual(new McpScopeResolver(g, p).resolve(), {});
  });

  it("missing servers key returns empty", () => {
    const { g, p } = mk("t10");
    const d = path.dirname(g);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(g, JSON.stringify({ notServers: {} }), "utf8");
    assert.deepStrictEqual(new McpScopeResolver(g, p).resolve(), {});
  });

  it("removeSessionServer works", () => {
    const { g, p } = mk("t11");
    const r = new McpScopeResolver(g, p);
    r.addSessionServer("x", { command: "echo" });
    assert.ok("x" in r.resolve());
    r.removeSessionServer("x");
    assert.ok(!("x" in r.resolve()));
  });

  // ── Skill layer tests ──

  it("skill servers appear in resolved output", () => {
    const { g, p } = mk("t12");
    const r = new McpScopeResolver(g, p);
    r.addSkillServers("db", { pg: { command: "pg-mcp" } });
    assert.strictEqual(r.resolve().pg.command, "pg-mcp");
  });

  it("skill servers override project servers", () => {
    const { g, p } = mk("t13");
    writeConfig(p, { pg: { command: "project" } });
    const r = new McpScopeResolver(g, p);
    r.addSkillServers("db", { pg: { command: "skill" } });
    assert.strictEqual(r.resolve().pg.command, "skill");
  });

  it("session servers override skill servers", () => {
    const { g, p } = mk("t14");
    const r = new McpScopeResolver(g, p);
    r.addSkillServers("db", { pg: { command: "skill" } });
    r.addSessionServer("pg", { command: "session" });
    assert.strictEqual(r.resolve().pg.command, "session");
  });

  it("two skills with same server name — last-added wins", () => {
    const { g, p } = mk("t15");
    const r = new McpScopeResolver(g, p);
    r.addSkillServers("skill-a", { pg: { command: "a" } });
    r.addSkillServers("skill-b", { pg: { command: "b" } });
    assert.strictEqual(r.resolve().pg.command, "b");
  });

  it("removeSkillServers removes only that skill's servers", () => {
    const { g, p } = mk("t16");
    const r = new McpScopeResolver(g, p);
    r.addSkillServers("a", { pa: { command: "a" } });
    r.addSkillServers("b", { pb: { command: "b" } });
    r.removeSkillServers("a");
    const result = r.resolve();
    assert.ok(!("pa" in result));
    assert.strictEqual(result.pb.command, "b");
  });

  it("getActiveSkillNames returns correct set", () => {
    const { g, p } = mk("t17");
    const r = new McpScopeResolver(g, p);
    r.addSkillServers("a", { pa: { command: "a" } });
    r.addSkillServers("b", { pb: { command: "b" } });
    const names = r.getActiveSkillNames();
    assert.deepStrictEqual(names.sort(), ["a", "b"]);
    r.removeSkillServers("a");
    assert.deepStrictEqual(r.getActiveSkillNames(), ["b"]);
  });

  it("skill server with disabled at higher scope is removed", () => {
    const { g, p } = mk("t18");
    const r = new McpScopeResolver(g, p);
    r.addSkillServers("db", { pg: { command: "skill" } });
    r.addSessionServer("pg", { command: "npx", disabled: true });
    assert.ok(!("pg" in r.resolve()));
  });

  it("removeSkillServers for unknown skill is no-op", () => {
    const { g, p } = mk("t19");
    const r = new McpScopeResolver(g, p);
    r.addSkillServers("db", { pg: { command: "pg" } });
    assert.doesNotThrow(() => r.removeSkillServers("unknown"));
    assert.strictEqual(r.resolve().pg.command, "pg");
  });
});
