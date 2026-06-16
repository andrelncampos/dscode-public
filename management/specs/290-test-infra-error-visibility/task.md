---
name: test-infra-error-visibility
status: verified
references: V29, L7
---

# Spec 290: Test Infra Error Visibility — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

## Tasks

### Task 1: Add Buffering Infrastructure to `run-tests.mjs`

**Objective:** Add per-worker output buffers (stdout and stderr arrays) alongside
the existing real-time streaming. No behavioral change yet.

**Requirements Covered:** FR-001.
**Design References:** Component 1 (WorkerOutputCollector) in design.md.

**Actions:**
1. Open `src/tests/run-tests.mjs`.
2. Before the `Promise.all` block, add:
   ```js
   /** @type {Array<{stdout: string[], stderr: string[], exitCode: number|null, signalCode: string|null, spawnError: string|null}>} */
   const workerResults = activeBuckets.map(() => ({
     stdout: [],
     stderr: [],
     exitCode: null,
     signalCode: null,
     spawnError: null,
   }));
   ```
3. Inside the `activeBuckets.map((workerFiles, idx) => {` callback, in the stdout `on("line")` handler:
   - Only buffer if under limit: `if (workerResults[idx].stdout.length < 10000)`
   - Push truncated line: `workerResults[idx].stdout.push(line.length > 10000 ? line.slice(0, 10000) : line)`
4. In the stderr `on("line")` handler, mirror the same logic with `workerResults[idx].stderr`.
5. In the `on("close")` handler, set `workerResults[idx].exitCode = code` and `workerResults[idx].signalCode = child.signalCode ?? null`.
6. Add `child.on("error", (err) => { workerResults[idx].spawnError = err.message; })` to catch spawn failures.

**Validation:** `node src/tests/run-tests.mjs` runs without errors. Output is identical to before (buffers are populated but not yet used).

**Status:** [x] done

---

### Task 2: Implement and Export `correlateLoadErrors` Function

**Objective:** Create the pure function that matches "No test suite found" lines
with stderr errors.

**Requirements Covered:** FR-002.
**Design References:** Component 2 (correlateLoadErrors) in design.md.

**Actions:**
1. Open `src/tests/run-tests.mjs`.
2. Add the function before the `Promise.all` block:
   ```js
   /**
    * @param {string[]} stdout
    * @param {string[]} stderr
    * @returns {{file: string, stderrLines: string[]}[]}
    */
   export function correlateLoadErrors(stdout, stderr) {
     const result = [];
     const re = /No test suite found in (.+)/;
     for (const line of stdout) {
       const m = line.match(re);
       if (!m) continue;
       const file = m[1];
       const basename = file.split(/[/\\]/).pop() ?? file;
       const stderrLines = stderr
         .filter((l) => l.includes(basename))
         .slice(0, 5);
       result.push({ file, stderrLines });
     }
     return result;
   }
   ```
3. Ensure the function is exported (uses `export` keyword).

**Validation:** Manually verify the function logic by inspection against examples:
- No "No test suite found" lines → empty array.
- One match with matching stderr → one entry with stderrLines populated.
- One match with no matching stderr → one entry with empty stderrLines.
- Multiple matches → multiple entries.
Full unit tests are written in Task 6.

**Status:** [x] done

---

### Task 3: Implement and Export `findTestFailures` Function

**Objective:** Create the pure function that detects test failure lines in stdout.

**Requirements Covered:** FR-003.
**Design References:** Component 3 (findTestFailures) in design.md.

**Actions:**
1. Open `src/tests/run-tests.mjs`.
2. Add the function after `correlateLoadErrors`:
   ```js
   /**
    * @param {string[]} stdout
    * @param {RegExp} [sentinel]
    * @returns {{file: string, lines: string[]}[]}
    */
   export function findTestFailures(stdout, sentinel) {
     const re = sentinel ?? /✖ |FAIL |not ok /;
     const byFile = new Map();
     for (const line of stdout) {
       if (!re.test(line)) continue;
       const fileMatch = line.match(/(?:^|\s)((?:src[/\\]tests[/\\][^\s:]+\.test\.(?:ts|tsx|mjs)))/);
       const file = fileMatch ? fileMatch[1] : "unknown";
       if (!byFile.has(file)) byFile.set(file, []);
       const entry = byFile.get(file);
       if (entry.length < 5) entry.push(line.trim());
     }
     return Array.from(byFile, ([file, lines]) => ({ file, lines }));
   }
   ```

**Validation:** Create a temporary test verifying the function finds `✖` lines and groups by file.

**Status:** [x] done

---

### Task 4: Implement and Export `buildFailureSummary` Function

**Objective:** Create the pure function that generates the structured failure summary.

**Requirements Covered:** FR-003, FR-005.
**Design References:** Component 4 (buildFailureSummary) in design.md.

**Actions:**
1. Open `src/tests/run-tests.mjs`.
2. Add the function after `findTestFailures`:
   ```js
   /**
    * @param {Array<{idx: number, workerCount: number, stdout: string[], stderr: string[], exitCode: number|null, signalCode: string|null, spawnError: string|null}>} workers
    * @returns {{loadErrors: string[], testFailures: string[], workerErrors: string[]}}
    */
   export function buildFailureSummary(workers) {
     const loadErrors = [];
     const testFailures = [];
     const workerErrors = [];
     for (const w of workers) {
       const prefix = `  [${w.idx + 1}/${w.workerCount}]`;
       // Worker crash/spawn errors
       if (w.spawnError) {
         workerErrors.push(`${prefix} Worker failed to start: ${w.spawnError}`);
         continue;
       }
       if (w.signalCode) {
         workerErrors.push(`${prefix} Worker crashed: killed by signal ${w.signalCode}`);
         continue;
       }
       // Load errors
       for (const le of correlateLoadErrors(w.stdout, w.stderr)) {
         const detail = le.stderrLines.length > 0
           ? `Load error: ${le.stderrLines[0]}`
           : "Load error (no stderr output)";
         loadErrors.push(`${prefix} ${le.file} — ${detail}`);
       }
       // Test failures
       for (const tf of findTestFailures(w.stdout)) {
         testFailures.push(`${prefix} ${tf.file} — ${tf.lines[0]}`);
       }
     }
     return { loadErrors, testFailures, workerErrors };
   }
   ```

**Validation:** Create a temporary test with mock worker data verifying all 3 sections populate correctly.

**Status:** [x] done

---

### Task 5: Implement `printFailureSummary` and Integrate into Main Flow

**Objective:** Print the failure summary after all workers complete and integrate
all new components into the existing runner.

**Requirements Covered:** FR-003, FR-004.
**Design References:** Component 5 (printFailureSummary) in design.md.

**Actions:**
1. Open `src/tests/run-tests.mjs`.
2. Add function:
   ```js
   /**
    * @param {{loadErrors: string[], testFailures: string[], workerErrors: string[]}} summary
    */
   function printFailureSummary(summary) {
     if (!summary.loadErrors.length && !summary.testFailures.length && !summary.workerErrors.length) return;
     process.stderr.write("\n── Failure Summary ──\n");
     if (summary.loadErrors.length) {
       process.stderr.write("\nLoad errors:\n");
       for (const line of summary.loadErrors) process.stderr.write(line + "\n");
     }
     if (summary.testFailures.length) {
       process.stderr.write("\nTest failures:\n");
       for (const line of summary.testFailures) process.stderr.write(line + "\n");
     }
     if (summary.workerErrors.length) {
       process.stderr.write("\nWorker errors:\n");
       for (const line of summary.workerErrors) process.stderr.write(line + "\n");
     }
     process.stderr.write("\n");
   }
   ```
3. After the `Promise.all` resolves, before the final `process.stdout.write`, add:
   ```js
   const enrichedResults = workerResults.map((r, i) => ({
     idx: i,
     workerCount,
     ...r,
   }));
   const summary = buildFailureSummary(enrichedResults);
   printFailureSummary(summary);
   ```
4. Update exit code logic: exit code is 1 if any worker failed OR any load error was found:
   ```js
   const hasLoadErrors = summary.loadErrors.length > 0;
   const hasFailures = results.some((c) => c !== 0);
   const exitCode = (hasFailures || hasLoadErrors) ? 1 : 0;
   ```

**Validation:** Run `npm test` from clean state. Verify:
- For PASSING test files, output format is identical to before.
- Pre-existing "No test suite found" lines now appear correlated in the Failure Summary.
- Summary section is omitted when no failures exist.
- Exit code 0 when no failures and no load errors.

**Status:** [x] done

---

### Task 6: Create Unit Tests in `run-tests.test.ts`

**Objective:** Create comprehensive unit tests for all pure functions.

**Requirements Covered:** NFR-002, all FRs.
**Design References:** Testing Strategy in design.md.

**Actions:**
1. Create `src/tests/run-tests.test.ts`.
2. Import: `import { correlateLoadErrors, findTestFailures, buildFailureSummary } from "./run-tests.mjs"`.
3. Write tests:

**Test 1:** `correlateLoadErrors` — no load errors:
```ts
test("correlateLoadErrors returns empty array when no No test suite found lines", () => {
  const result = correlateLoadErrors(["ok 1", "ok 2"], []);
  assert.deepStrictEqual(result, []);
});
```

**Test 2:** `correlateLoadErrors` — single load error with matching stderr:
```ts
test("correlateLoadErrors matches No test suite found with stderr", () => {
  const stderr = ["TypeError: Cannot find module", "at file: src/tests/foo.test.ts"];
  const result = correlateLoadErrors(
    ["No test suite found in src/tests/foo.test.ts"],
    stderr
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].file, "src/tests/foo.test.ts");
  assert.ok(result[0].stderrLines.length > 0);
});
```

**Test 3:** `correlateLoadErrors` — no matching stderr:
```ts
test("correlateLoadErrors returns empty stderrLines when no match", () => {
  const result = correlateLoadErrors(
    ["No test suite found in src/tests/bar.test.ts"],
    ["Some other error"]
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].stderrLines.length, 0);
});
```

**Test 4:** `findTestFailures` — no failures:
```ts
test("findTestFailures returns empty array on all-passing output", () => {
  assert.deepStrictEqual(findTestFailures(["ok 1", "ok 2"], /FAIL/), []);
});
```

**Test 5:** `findTestFailures` — default sentinel:
```ts
test("findTestFailures uses default sentinel when no argument passed", () => {
  const result = findTestFailures(["✖ some test failed (5ms)"]);
  assert.strictEqual(result.length, 1);
});
```

**Test 6:** `findTestFailures` — detects failures with explicit sentinel:
```ts
test("findTestFailures detects FAIL lines", () => {
  const result = findTestFailures(
    ["FAIL src/tests/foo.test.ts - some failure"],
    /FAIL/
  );
  assert.strictEqual(result.length, 1);
});
```

**Test 7:** `buildFailureSummary` — load errors:
```ts
test("buildFailureSummary reports load errors", () => {
  const summary = buildFailureSummary([
    { idx: 0, workerCount: 1,
      stdout: ["No test suite found in src/tests/foo.test.ts"],
      stderr: ["Error: Cannot find module './foo'"],
      exitCode: 0, signalCode: null, spawnError: null }
  ]);
  assert.strictEqual(summary.loadErrors.length, 1);
  assert.ok(summary.loadErrors[0].includes("foo.test.ts"));
  assert.ok(summary.loadErrors[0].includes("Load error"));
});
```

**Test 8:** `buildFailureSummary` — all passing:
```ts
test("buildFailureSummary returns empty sections when all pass", () => {
  const summary = buildFailureSummary([
    { idx: 0, workerCount: 1, stdout: ["ok 1"], stderr: [], exitCode: 0, signalCode: null, spawnError: null }
  ]);
  assert.strictEqual(summary.loadErrors.length, 0);
  assert.strictEqual(summary.testFailures.length, 0);
  assert.strictEqual(summary.workerErrors.length, 0);
});
```

**Test 9:** `buildFailureSummary` — worker crash:
```ts
test("buildFailureSummary reports worker crash", () => {
  const summary = buildFailureSummary([
    { idx: 0, workerCount: 1, stdout: [], stderr: [], exitCode: null, signalCode: "SIGKILL", spawnError: null }
  ]);
  assert.strictEqual(summary.workerErrors.length, 1);
  assert.ok(summary.workerErrors[0].includes("SIGKILL"));
});
```

**Validation:** `node --import tsx --test src/tests/run-tests.test.ts` — all 9 tests pass.

**Status:** [x] done

---

### Task 7: Run Full Test Suite and Verify No Regressions

**Objective:** Verify that the entire test suite passes with the modified test runner.

**Requirements Covered:** NFR-003.
**Design References:** Migration / Rollback in design.md.

**Actions:**
1. Run `npm test`.
2. Verify the total pass/fail count is the same as before the change.
3. Verify no new "No test suite found" lines appear (other than pre-existing ones).
4. Verify the failure summary appears at the end (if any failures exist).
5. Verify exit code behavior: 0 when everything passes (ignoring pre-existing unreported load errors).

**Validation:** `npm test` exit code and output.

**Status:** [x] done
