import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { correlateLoadErrors, findTestFailures, buildFailureSummary } from "./run-tests.mjs";

describe("correlateLoadErrors", () => {
  test("returns empty array when no No test suite found lines", () => {
    const result = correlateLoadErrors(["ok 1", "ok 2"], []);
    assert.deepStrictEqual(result, []);
  });

  test("matches No test suite found with stderr", () => {
    const stderr = ["TypeError: Cannot find module", "at file: src/tests/foo.test.ts"];
    const result = correlateLoadErrors(["No test suite found in src/tests/foo.test.ts"], stderr);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].file, "src/tests/foo.test.ts");
    assert.ok(result[0].stderrLines.length > 0);
  });

  test("returns empty stderrLines when no match", () => {
    const result = correlateLoadErrors(["No test suite found in src/tests/bar.test.ts"], ["Some other error"]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].stderrLines.length, 0);
  });
});

describe("findTestFailures", () => {
  test("returns empty array on all-passing output", () => {
    assert.deepStrictEqual(findTestFailures(["ok 1", "ok 2"], /FAIL/), []);
  });

  test("uses default sentinel when no argument passed", () => {
    const result = findTestFailures(["✖ some test failed (5ms)"]);
    assert.strictEqual(result.length, 1);
  });

  test("detects FAIL lines with explicit sentinel", () => {
    const result = findTestFailures(["FAIL src/tests/foo.test.ts - some failure"], /FAIL/);
    assert.strictEqual(result.length, 1);
  });
});

describe("buildFailureSummary", () => {
  test("reports load errors", () => {
    const summary = buildFailureSummary([
      {
        idx: 0,
        workerCount: 1,
        stdout: ["No test suite found in src/tests/foo.test.ts"],
        stderr: ["Error: Cannot find module './foo'"],
        exitCode: 0,
        signalCode: null,
        spawnError: null,
      },
    ]);
    assert.strictEqual(summary.loadErrors.length, 1);
    assert.ok(summary.loadErrors[0].includes("foo.test.ts"));
    assert.ok(summary.loadErrors[0].includes("Load error"));
  });

  test("returns empty sections when all pass", () => {
    const summary = buildFailureSummary([
      { idx: 0, workerCount: 1, stdout: ["ok 1"], stderr: [], exitCode: 0, signalCode: null, spawnError: null },
    ]);
    assert.strictEqual(summary.loadErrors.length, 0);
    assert.strictEqual(summary.testFailures.length, 0);
    assert.strictEqual(summary.workerErrors.length, 0);
  });

  test("reports worker crash", () => {
    const summary = buildFailureSummary([
      { idx: 0, workerCount: 1, stdout: [], stderr: [], exitCode: null, signalCode: "SIGKILL", spawnError: null },
    ]);
    assert.strictEqual(summary.workerErrors.length, 1);
    assert.ok(summary.workerErrors[0].includes("SIGKILL"));
  });
});
