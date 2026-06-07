import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ToolExecutionContext } from "../tools/executor";
import { handleGrepTool } from "../tools/grep-handler";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("Grep returns error for missing pattern", async () => {
  const workspace = createTempWorkspace();
  const result = await handleGrepTool({}, createContext("grep-no-pattern", workspace));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Missing required "pattern" string.');
});

test("Grep returns error for invalid regex", async () => {
  const workspace = createTempWorkspace();
  const result = await handleGrepTool({ pattern: "[unclosed" }, createContext("grep-bad-regex", workspace));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Invalid regex pattern/);
});

test("Grep returns error for path outside project root", async () => {
  const workspace = createTempWorkspace();
  const result = await handleGrepTool(
    { pattern: "test", path: "../outside" },
    createContext("grep-outside", workspace)
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /outside the project root/);
});

test("Grep returns error for nonexistent path", async () => {
  const workspace = createTempWorkspace();
  const result = await handleGrepTool(
    { pattern: "test", path: "nonexistent" },
    createContext("grep-missing", workspace)
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /not found/);
});

test("Grep finds matches in a single file", async () => {
  const workspace = createTempWorkspace();
  const filePath = path.join(workspace, "data.txt");
  fs.writeFileSync(filePath, "hello world\nfoo bar\nhello again\n", "utf8");

  const result = await handleGrepTool(
    { pattern: "hello", path: "data.txt" },
    createContext("grep-single-file", workspace)
  );
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.pattern, "hello");
  assert.equal(output.matches.length, 2);
  assert.equal(output.matches[0].file, "data.txt");
  assert.equal(output.matches[0].line, 1);
  assert.equal(output.matches[0].match, "hello");
  assert.equal(output.matches[1].line, 3);
  assert.equal(output.truncated, false);
  assert.equal(output.files_searched, 1);
});

test("Grep finds matches recursively in a directory", async () => {
  const workspace = createTempWorkspace();
  fs.writeFileSync(path.join(workspace, "a.ts"), 'const x = "TODO: fix";\n', "utf8");
  fs.writeFileSync(path.join(workspace, "b.ts"), "// nothing here\n", "utf8");
  fs.mkdirSync(path.join(workspace, "sub"));
  fs.writeFileSync(path.join(workspace, "sub", "c.ts"), 'const y = "TODO: refactor";\n', "utf8");

  const result = await handleGrepTool({ pattern: "TODO" }, createContext("grep-recursive", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.pattern, "TODO");
  assert.equal(output.matches.length, 2);
  assert.equal(output.files_searched, 3);
  assert.equal(output.truncated, false);

  const files = output.matches.map((m: { file: string }) => m.file);
  assert.ok(files.includes("a.ts"));
  assert.ok(files.includes("sub/c.ts"));
});

test("Grep reports column numbers (1-indexed)", async () => {
  const workspace = createTempWorkspace();
  fs.writeFileSync(path.join(workspace, "col.ts"), "    const target = 42;\n", "utf8");

  const result = await handleGrepTool({ pattern: "target" }, createContext("grep-column", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.matches.length, 1);
  assert.equal(output.matches[0].line, 1);
  assert.equal(output.matches[0].column, 11); // "const " = 6 spaces + 5 chars, so "target" starts at column 11
});

test("Grep includes line_content in match results", async () => {
  const workspace = createTempWorkspace();
  fs.writeFileSync(path.join(workspace, "content.ts"), "const important = true;\n", "utf8");

  const result = await handleGrepTool({ pattern: "important" }, createContext("grep-line-content", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.matches.length, 1);
  assert.equal(output.matches[0].line_content, "const important = true;");
});

test("Grep truncates long line_content", async () => {
  const workspace = createTempWorkspace();
  const longLine = "x".repeat(250);
  fs.writeFileSync(path.join(workspace, "long.ts"), `${longLine}\n`, "utf8");

  const result = await handleGrepTool({ pattern: "x{200}" }, createContext("grep-truncate-line", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.matches.length, 1);
  assert.ok(output.matches[0].line_content.length <= 201); // 200 chars + "…"
  assert.ok(output.matches[0].line_content.endsWith("…"));
});

test("Grep truncates results at MAX_RESULTS", async () => {
  const workspace = createTempWorkspace();
  // Create a file with 600 matching lines
  const lines = Array.from({ length: 600 }, (_, i) => `match_${i}`);
  fs.writeFileSync(path.join(workspace, "many.ts"), lines.join("\n"), "utf8");

  const result = await handleGrepTool({ pattern: "match_\\d+" }, createContext("grep-truncate", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.truncated, true);
  assert.equal(output.matches.length, 500); // MAX_RESULTS
});

test("Grep respects glob filter", async () => {
  const workspace = createTempWorkspace();
  fs.writeFileSync(path.join(workspace, "a.ts"), "TODO\n", "utf8");
  fs.writeFileSync(path.join(workspace, "b.tsx"), "TODO\n", "utf8");
  fs.writeFileSync(path.join(workspace, "c.md"), "TODO\n", "utf8");

  const result = await handleGrepTool({ pattern: "TODO", glob: "*.ts" }, createContext("grep-glob-filter", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.matches.length, 1);
  assert.equal(output.matches[0].file, "a.ts");
});

test("Grep skips node_modules by default", async () => {
  const workspace = createTempWorkspace();
  fs.mkdirSync(path.join(workspace, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "node_modules", "pkg.ts"), "TODO\n", "utf8");
  fs.writeFileSync(path.join(workspace, "src.ts"), "nothin\n", "utf8");

  const result = await handleGrepTool({ pattern: "TODO" }, createContext("grep-skip-node-modules", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.matches.length, 0);
});

test("Grep skips binary files", async () => {
  const workspace = createTempWorkspace();
  fs.writeFileSync(
    path.join(workspace, "data.bin"),
    Buffer.from([0x00, 0x01, 0x02, 0x48, 0x65, 0x6c, 0x6c, 0x6f]),
    "utf8"
  );
  fs.writeFileSync(path.join(workspace, "text.txt"), "Hello world\n", "utf8");

  const result = await handleGrepTool({ pattern: "Hello" }, createContext("grep-skip-binary", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.matches.length, 1);
  assert.equal(output.matches[0].file, "text.txt");
});

test("Grep respects .gitignore rules", async () => {
  const workspace = createTempWorkspace();
  fs.writeFileSync(path.join(workspace, ".gitignore"), "ignored/\n", "utf8");
  fs.mkdirSync(path.join(workspace, "ignored"));
  fs.writeFileSync(path.join(workspace, "ignored", "secret.ts"), "TODO\n", "utf8");
  fs.writeFileSync(path.join(workspace, "visible.ts"), "TODO\n", "utf8");

  const result = await handleGrepTool({ pattern: "TODO" }, createContext("grep-gitignore", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.matches.length, 1);
  assert.equal(output.matches[0].file, "visible.ts");
});

test("Grep handles empty files gracefully", async () => {
  const workspace = createTempWorkspace();
  fs.writeFileSync(path.join(workspace, "empty.ts"), "", "utf8");
  fs.writeFileSync(path.join(workspace, "populated.ts"), "TODO\n", "utf8");

  const result = await handleGrepTool({ pattern: "TODO" }, createContext("grep-empty-file", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.matches.length, 1);
  assert.equal(output.matches[0].file, "populated.ts");
  assert.equal(output.files_searched, 2); // both empty.ts and populated.ts were searched
});

test("Grep reports files_searched correctly", async () => {
  const workspace = createTempWorkspace();
  fs.writeFileSync(path.join(workspace, "a.ts"), "nothing\n", "utf8");
  fs.writeFileSync(path.join(workspace, "b.ts"), "nothing\n", "utf8");
  fs.writeFileSync(path.join(workspace, "c.ts"), "TODO\n", "utf8");

  const result = await handleGrepTool({ pattern: "TODO" }, createContext("grep-files-searched", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.files_searched, 3); // all three text files searched
});

test("Grep skips files larger than 1 MB", async () => {
  const workspace = createTempWorkspace();
  const bigContent = "x".repeat(1024 * 1024 + 1); // just over 1 MB
  fs.writeFileSync(path.join(workspace, "big.ts"), bigContent, "utf8");
  fs.writeFileSync(path.join(workspace, "small.ts"), "TODO\n", "utf8");

  const result = await handleGrepTool({ pattern: "TODO" }, createContext("grep-skip-large", workspace));
  assert.equal(result.ok, true);

  const output = JSON.parse(result.output ?? "{}");
  assert.equal(output.matches.length, 1);
  assert.equal(output.matches[0].file, "small.ts");
});

function createContext(sessionId: string, projectRoot: string): ToolExecutionContext {
  return {
    sessionId,
    projectRoot,
    toolCall: {
      id: "test-tool-call",
      type: "function",
      function: {
        name: "grep",
        arguments: "{}",
      },
    },
  };
}

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-grep-"));
  tempDirs.push(dir);
  return dir;
}
