import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveSpecName, clearSpecNameCache } from "../ui/core/spec-names";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _originalCwd: string;

function setup() {
  _originalCwd = process.cwd();
  const dir = fs.mkdtempSync("dscode-spec-names-test-");
  process.chdir(dir);
  return dir;
}

function teardown(dir: string) {
  process.chdir(_originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("resolveSpecName returns name for known spec", () => {
  const dir = setup();
  try {
    fs.mkdirSync("management", { recursive: true });
    fs.writeFileSync(
      path.join("management", "roadmap.md"),
      "| 260 | developer-notes | audited | V28 |\n| 120 | explore-subagent | audited | V17 |\n",
      "utf8"
    );
    clearSpecNameCache();
    assert.equal(resolveSpecName("260"), "developer-notes");
    assert.equal(resolveSpecName("120"), "explore-subagent");
  } finally {
    teardown(dir);
  }
});

test("resolveSpecName returns null for unknown spec", () => {
  const dir = setup();
  try {
    fs.mkdirSync("management", { recursive: true });
    fs.writeFileSync(path.join("management", "roadmap.md"), "| 260 | developer-notes | audited | V28 |\n", "utf8");
    clearSpecNameCache();
    assert.equal(resolveSpecName("999"), null);
  } finally {
    teardown(dir);
  }
});

test("resolveSpecName returns null when roadmap missing", () => {
  const dir = setup();
  try {
    clearSpecNameCache();
    assert.equal(resolveSpecName("260"), null);
  } finally {
    teardown(dir);
  }
});

test("resolveSpecName caches results", () => {
  const dir = setup();
  try {
    fs.mkdirSync("management", { recursive: true });
    fs.writeFileSync(path.join("management", "roadmap.md"), "| 260 | developer-notes | audited | V28 |\n", "utf8");
    clearSpecNameCache();
    // First call populates cache
    assert.equal(resolveSpecName("260"), "developer-notes");
    // Delete the file — cached result should still work
    fs.unlinkSync(path.join("management", "roadmap.md"));
    assert.equal(resolveSpecName("260"), "developer-notes");
    // Clear cache — now should return null
    clearSpecNameCache();
    assert.equal(resolveSpecName("260"), null);
  } finally {
    teardown(dir);
  }
});

test("resolveSpecName handles malformed lines gracefully", () => {
  const dir = setup();
  try {
    fs.mkdirSync("management", { recursive: true });
    fs.writeFileSync(
      path.join("management", "roadmap.md"),
      "# Header\n| Status | Meaning |\n|---|---|\n| 260 | developer-notes | audited |\n| malformed line \n| 120 | explore-subagent | audited |\n",
      "utf8"
    );
    clearSpecNameCache();
    assert.equal(resolveSpecName("260"), "developer-notes");
    assert.equal(resolveSpecName("120"), "explore-subagent");
    assert.equal(resolveSpecName("999"), null);
  } finally {
    teardown(dir);
  }
});
