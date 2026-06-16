---
name: test-infra-error-visibility
status: verified
references: V29, L7
---

# Spec 290: Test Infra Error Visibility — Requirements

## Value Delivery

From `vision.md` V29: Operational Robustness & Debuggability:

> **Test infrastructure reliability:** The CI test runner must report actual import and
> load errors, not mask them as "No test suite found." Every test failure must be
> attributable to a specific file and error message.

Also informed by L7 (Terminal UI Features Are Untestable — The `isTTY` Curse):
the pattern of "separate logic from side-effect" applies here: the test runner's
output parsing logic is unit-testable even though the worker process spawning is not.

---

## Functional Requirements

### FR-001: Buffer Worker Output Per-File

**What:** The test runner must buffer each worker's stdout and stderr separately,
keyed by worker index, storing lines in parallel with real-time display.
Buffered output is analyzed after all workers complete.

**Why:** Current streaming output interleaves "No test suite found" messages with
other worker output, making it impossible to associate load errors with specific files.
Buffering enables per-worker correlation.

**Acceptance Criteria:**
- [ ] `workerResults[idx].stdout` and `workerResults[idx].stderr` arrays hold lines, populated in order.
- [ ] `workerResults[idx].exitCode` holds the exit code (null until worker closes).
- [ ] Buffering does not change the output format — lines are identical to current.
- [ ] Memory usage is bounded: max 10k lines per worker buffer; lines beyond this are discarded.

### FR-002: Correlate Load Errors with Files

**What:** After a worker exits, if its stdout contains lines matching
`/No test suite found in (.+)/`, the runner extracts the file path and the
corresponding stderr error message. It reports: `FAIL [file] — [stderr error]`
instead of the ambiguous "No test suite found" line.

**Why:** Node.js `--test` runner reports "No test suite found in X" when file X
fails to load (import error, tsx transpilation failure, syntax error). The actual
error is on stderr. Without correlation, the developer sees a useless message and
must re-run the file individually to see the error.

**Acceptance Criteria:**
- [ ] Regex `/No test suite found in (.+)/` is matched against worker stdout lines.
- [ ] For each match, the worker's stderr buffer is scanned for lines containing the matched file path or error context.
- [ ] Correlated output format: `FAIL [file] — Load error: [first relevant stderr line]`.
- [ ] If no stderr error is found for a "No test suite found" file, the original line is kept unchanged.
- [ ] Correlated lines are printed to stderr with a `FAIL` prefix matching the worker prefix format (`[N/M]`).

### FR-003: Exit Summary with Failure Attribution

**What:** At the end of the test run, the runner prints a summary section listing
every file that failed with its error message. The summary groups failures by
category: "Load errors" (file failed to load/parse), "Test failures" (test assertions
failed), and "Unexpected errors" (worker crashed, timeout, etc.).

**Why:** When running 60+ test files across 8 workers, failures scroll past quickly.
A structured exit summary lets the developer immediately see what broke and how to fix it.

**Acceptance Criteria:**
- [ ] Summary appears after "Some workers completed in Xs" line.
- [ ] Summary has 3 sections, each omitted when empty:
  - `Load errors:` — files that Node reported as "No test suite found", with stderr context.
  - `Test failures:` — files whose worker stdout shows test failure lines (matched by `/✖ /`, the Node.js `--test` failure marker).
  - `Worker errors:` — workers that exited with non-zero code but produced no parseable test output.
- [ ] Each entry: `  [worker prefix] [file] — [error message]`.
- [ ] Load errors from FR-002 are listed in the "Load errors" section.

### FR-004: Preserve Real-Time Output for CI

**What:** While workers are running, their stdout and stderr are printed in real-time
exactly as today — no buffering delay. The correlation and summary are computed
AFTER all workers complete, using the buffered output.

**Why:** CI systems (GitHub Actions, etc.) benefit from real-time log output for
progress visibility and timeout detection. Delaying all output until workers finish
would cause CI to appear hung.

**Acceptance Criteria:**
- [ ] Worker stdout and stderr are printed line-by-line as they arrive — zero change from current behavior.
- [ ] Buffering happens simultaneously in memory; it does not delay display.
- [ ] At all workers complete, correlation analysis runs on buffered output before summary.

### FR-005: Worker-Level Error Resiliency

**What:** If a worker process crashes (spawn fails, signal kills it, or it exits
with a signal), the runner reports the crash clearly instead of showing "No test
suite found" for all files in that worker's bucket.

**Why:** Currently, if a worker crashes, Node may report "No test suite found" for
every file in that worker's bucket because the test runner never started. The root
cause (crash, signal, OOM) is lost.

**Acceptance Criteria:**
- [ ] `child.on("error", ...)` handler catches spawn failures and records the error.
- [ ] `child.signalCode` is checked on close (e.g., SIGTERM, SIGKILL).
- [ ] For crashed workers, summary shows: `Worker [N] crashed: [signal or error message]`.
- [ ] Files assigned to crashed workers are NOT reported as "No test suite found" unless the worker produced that output before crashing.
- [ ] Crashed worker files are listed under "Worker errors" in the summary.

---

## Non-Functional Requirements

### NFR-001: Performance

**What:** Output buffering and correlation must add less than 100ms total overhead
to the test run.

**Acceptance Criteria:**
- [ ] Buffering uses array push (O(1) amortized). No per-line regex matching during streaming.
- [ ] Correlation regex matching runs once per worker after close, O(lines_in_worker).
- [ ] No external dependencies added — all logic uses Node.js built-ins.

### NFR-002: Maintainability

**What:** The correlation logic must be a pure function, unit-testable in isolation
against arrays of strings (simulated worker output).

**Acceptance Criteria:**
- [ ] `correlateLoadErrors(stdout: string[], stderr: string[]): LoadError[]` is exported and testable.
- [ ] `buildFailureSummary(workerResults: WorkerResult[]): FailureSummary` is exported and testable.
- [ ] At least 3 unit tests: normal output (no failures), load error, worker crash.

### NFR-003: Backward Compatibility

**What:** The test runner's CLI interface must remain identical. `npm test` must work
exactly as before, with identical exit codes for identical test results.

**Acceptance Criteria:**
- [ ] `node src/tests/run-tests.mjs` accepts zero arguments — no CLI change.
- [ ] Exit code 0 when all tests pass (load + test).
- [ ] Exit code 1 when any test fails or any file fails to load.
- [ ] Existing test files pass unchanged — no regressions in `npm test` output.

---

## Constraints

- **C1:** Must not add any npm dependencies (P6: Zero New Dependencies Without Justification). All logic uses `node:*` built-ins.
- **C2:** Must not change the test file glob pattern (`*.test.ts`).
- **C3:** Must not change the worker spawn command (`node --import tsx --test`).
- **C4:** Must not change the worker count logic or distribution algorithm.
- **C5:** Must follow P4 (Surgical Changes): touch only `run-tests.mjs` and new test file `run-tests.test.ts`.

---

## Edge Cases & Error States

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 1 | Worker stdout has "No test suite found" but stderr is empty | Line kept unchanged, listed in "Load errors" with note "(no stderr output)" |
| 2 | Worker produces "No test suite found" for file A, stderr has error for file B | Correlation only matches when stderr line contains the file path from stdout |
| 3 | Worker produces 1000+ lines of stderr (massive error) | Only first 5 stderr lines containing the file path are included in the error summary |
| 4 | Worker exits with code 0 but has "No test suite found" lines | Treated as load errors — exit code becomes 1 |
| 5 | Worker exits with signal (SIGKILL, OOM) | Reported as "Worker [N] crashed: killed by signal SIGKILL" |
| 6 | Worker spawn throws (e.g., node not found) | Reported as "Worker [N] failed to start: [error message]" |
| 7 | All workers succeed, no failures | Summary section omitted entirely; output matches current behavior |
| 8 | Worker produces test failure AND "No test suite found" | Both types of failure are reported in their respective summary sections |
| 9 | Empty worker bucket (should never happen due to filter on line 32) | Worker skipped, no output, not in summary |
| 10 | stdout line exceeds 10000 chars (very long error line) | Truncated to 10000 chars in buffer |

---

## Dependencies

- **None.** No other specs required. This spec modifies `src/tests/run-tests.mjs` only.
- Uses Node.js built-ins: `node:child_process`, `node:path`, `node:url`, `node:os`, `node:readline`.
- Uses `glob` package (already in devDependencies) for file discovery.
- References L7 (Lessons Learned) for the pattern of separating logic from side-effect.

---

## Out of Scope

- Changing the test framework (stays Node.js `--test`, not Vitest or Jest).
- Changing how tests are written or organized.
- Fixing actual test failures — this spec only improves failure REPORTING.
- Adding test coverage metrics, code coverage reports, or CI-specific integrations.
- Changing worker count logic or distribution algorithm.
- Adding `--test-reporter` flags to the node spawn command.
- Fixing the underlying cause of "No test suite found" (tsx import errors) — this spec only reports them clearly.
