import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseSpecMcp } from "../common/spec-mcp";

describe("parseSpecMcp", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-mcp-test-"));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeReq(content: string) {
    fs.writeFileSync(path.join(tmpDir, "requirements.md"), content, "utf8");
  }

  it("valid mcp.servers frontmatter -> returns correct config", () => {
    writeReq(`---
mcp:
  servers:
    test-server:
      command: "node"
      args: ["--version"]
---
# Title
`);
    const result = parseSpecMcp(tmpDir);
    assert.ok(result);
    assert.deepStrictEqual(Object.keys(result), ["test-server"]);
    assert.strictEqual(result["test-server"].command, "node");
    assert.deepStrictEqual(result["test-server"].args, ["--version"]);
  });

  it("no mcp field -> undefined", () => {
    writeReq(`---
title: Test
---
# No MCP
`);
    const result = parseSpecMcp(tmpDir);
    assert.strictEqual(result, undefined);
  });

  it("no frontmatter at all -> undefined", () => {
    writeReq(`# Just a markdown title
Some content.`);
    const result = parseSpecMcp(tmpDir);
    assert.strictEqual(result, undefined);
  });

  it("mcp is not an object -> undefined", () => {
    writeReq(`---
mcp: "string"
---
`);
    const result = parseSpecMcp(tmpDir);
    assert.strictEqual(result, undefined);
  });

  it("mcp.servers is not an object -> undefined", () => {
    writeReq(`---
mcp:
  servers: [1, 2, 3]
---
`);
    const result = parseSpecMcp(tmpDir);
    assert.strictEqual(result, undefined);
  });

  it("missing requirements.md -> undefined", () => {
    const result = parseSpecMcp(path.join(tmpDir, "nonexistent"));
    assert.strictEqual(result, undefined);
  });

  it("servers with type: http -> correct parsing", () => {
    writeReq(`---
mcp:
  servers:
    remote:
      type: "http"
      url: "https://api.example.com/mcp"
      headers:
        Authorization: "Bearer token"
---
`);
    const result = parseSpecMcp(tmpDir);
    assert.ok(result);
    assert.strictEqual(result["remote"].type, "http");
    assert.strictEqual(result["remote"].url, "https://api.example.com/mcp");
  });
});
