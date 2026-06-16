---
name: test-infra-error-visibility
status: verified
references: V29, L7
---

# Spec 290: Test Infra Error Visibility — Design

## Design Approach

**Surgical refactor, not rewrite.** The existing `run-tests.mjs` (73 lines) already
spawns workers, pipes stdout/stderr, and reports exit codes. This spec adds:

1. **In-memory buffering** of worker output (arrays, not file I/O).
2. **Post-close correlation** of "No test suite found" lines with stderr errors.
3. **Exit summary** section grouping failures by category.

The streaming output behavior is preserved — users see real-time logs exactly as today.
The only visible change is the summary section AFTER the final "completed in Xs" line.

**Philosophy:** Follow L7 pattern — separate pure logic (correlation, summary
generation) from side-effect (spawning, stdio piping). Pure functions are unit-testable;
process spawning is manually smoke-tested.

---

## Architecture Decisions

### ADR-290-001: Buffer-and-Report Pattern

**Context:** The test runner currently streams all worker output directly to the
parent process stdio. This makes per-worker error correlation impossible because
output from different workers is interleaved.

**Decision:** Buffer worker output in-memory per-worker, print it in real-time
(unchanged behavior), then run correlation and summary generation after all workers
complete.

**Consequences:**
- Memory usage increases by ~(total output lines × average line length). For 60 files
  with reasonable output, this is < 5 MB — acceptable.
- Real-time output is unchanged — zero user-visible regression.
- Summary appears only after all workers complete — acceptable, since the summary is
  only useful after the run.

### ADR-290-002: No External Dependencies

**Context:** Could use `chalk` or `strip-ansi` for colored output parsing.

**Decision:** Use zero new dependencies. All logic uses Node.js built-ins
(`node:child_process`, `node:readline`, etc.). Regex patterns handle ANSI escape
codes by matching against the raw text.

**Consequences:**
- Simpler, zero-dep implementation.
- Regex patterns must account for ANSI escape codes that Node's test runner may emit.
- Matches P6 (Zero New Dependencies Without Justification).

---

## Component / Module Breakdown

### Component 1: `WorkerOutputCollector`

**Purpose:** Collects and buffers stdout/stderr lines for a single worker process,
while also forwarding them to the parent process in real-time.

**Interface:**
```typescript
interface WorkerOutputCollector {
  stdout: string[];  // buffered lines
  stderr: string[];  // buffered lines
  exitCode: number | null;
  signalCode: string | null;
  spawnError: string | null;

  /** Record a stdout line (buffer + print). */
  onStdoutLine(line: string): void;

  /** Record a stderr line (buffer + print). */
  onStderrLine(line: string): void;

  /** Record exit code and signal. */
  onClose(code: number | null, signal: string | null): void;

  /** Record spawn failure. */
  onError(err: Error): void;
}
```

**Internal Logic:**
1. `onStdoutLine(line)`: pushes to `this.stdout`, writes to `process.stdout` with worker prefix.
2. `onStderrLine(line)`: pushes to `this.stderr`, writes to `process.stderr` with worker prefix.
3. `onClose(code, signal)`: sets `this.exitCode = code`, `this.signalCode = signal`.
4. `onError(err)`: sets `this.spawnError = err.message`.

**Dependencies:** None (pure data structure + `process.stdout.write`).

**Error Handling:** None — this is a data collector, not a processor.

---

### Component 2: `correlateLoadErrors` (Pure Function)

**Purpose:** Scans a worker's stdout for "No test suite found" lines and matches
them with stderr errors containing the same file path.

**Interface:**
```typescript
type LoadError = {
  file: string;        // file path from "No test suite found in FILE"
  stderrLines: string[]; // relevant stderr lines (empty if none found)
};

function correlateLoadErrors(stdout: string[], stderr: string[]): LoadError[];
```

**Internal Logic:**
1. Iterate stdout lines. For each line matching `/No test suite found in (.+)/`:
   a. Extract `file` from capture group 1.
   b. Search `stderr` for lines that include the file basename (e.g., `run-tests.test.ts`).
   c. If found, collect up to 5 matching stderr lines.
   d. Push `{ file, stderrLines }` to result.
2. Return the array (empty if no load errors).

**Regex:** `/No test suite found in (.+)/` — matches Node.js `--test` output.

**Dependencies:** None — pure function, only array iteration and regex.

**Error Handling:** Returns empty array on empty input. Non-matching lines are ignored.

---

### Component 3: `findTestFailures` (Pure Function)

**Purpose:** Scans a worker's stdout for test failure indicators.

**Interface:**
```typescript
type TestFailure = {
  file: string;   // file path where test failed
  lines: string[]; // failure lines (up to 5)
};

function findTestFailures(stdout: string[], sentinel: RegExp): TestFailure[];
```

**Internal Logic:**
1. Default sentinel: `/✖ /` (matches Node.js `--test` failure output). Changed from design `/✖ |FAIL |not ok /` to avoid false positives on lines containing the word "FAIL" in test names.
2. For each line matching the sentinel, extract the file path from context.
3. Collect up to 5 matching lines per file.

**Dependencies:** None.

---

### Component 4: `buildFailureSummary` (Pure Function)

**Purpose:** Generates the exit summary section from all worker results.

**Interface:**
```typescript
type WorkerResult = {
  idx: number;
  workerCount: number;
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  signalCode: string | null;
  spawnError: string | null;
};

type FailureSummary = {
  loadErrors: string[];    // formatted lines for "Load errors:" section
  testFailures: string[];  // formatted lines for "Test failures:" section
  workerErrors: string[];  // formatted lines for "Worker errors:" section
};

function buildFailureSummary(workers: WorkerResult[]): FailureSummary;
```

**Internal Logic:**
1. **Load errors:** For each worker, call `correlateLoadErrors(worker.stdout, worker.stderr)`.
   Format each result as: `  [N/M] FILE — Load error: STDERRLINE`.
   If no stderr, append `(no stderr output)`.
2. **Test failures:** For each worker, call `findTestFailures(worker.stdout)`.
   Format each as: `  [N/M] FILE — LINE`.
3. **Worker errors:** For each worker where `exitCode !== 0 && exitCode !== null && loadErrors.length === 0 && testFailures.length === 0`:
   Or where `signalCode !== null` or `spawnError !== null`.
   Format: `  [N/M] Worker crashed: SIGNAL` or `  [N/M] Worker failed to start: ERROR`.
4. Return `{ loadErrors, testFailures, workerErrors }`.

**Dependencies:** `correlateLoadErrors`, `findTestFailures`.

---

### Component 5: `printFailureSummary` (Side-Effect Function)

**Purpose:** Prints the summary to stderr.

**Interface:**
```typescript
function printFailureSummary(summary: FailureSummary): void;
```

**Internal Logic:**
1. If all 3 arrays are empty, print nothing.
2. Print `\n── Failure Summary ──\n`.
3. For each non-empty section, print the section header and lines.
4. Use `process.stderr.write` for all output.

---

## Data Flow

```
spawn worker [N/M]
    │
    ├─ stdout line received ──► onStdoutLine(line)
    │                            ├── buffer: workerStdout[N].push(line)
    │                            └── print: process.stdout.write(prefix + line)
    │
    ├─ stderr line received ──► onStderrLine(line)
    │                            ├── buffer: workerStderr[N].push(line)
    │                            └── print: process.stderr.write(prefix + line)
    │
    └─ worker exits ──────────► onClose(code, signal)
                                  └── store code + signal

all workers done
    │
    ▼
buildFailureSummary(workerResults)
    │
    ├── correlateLoadErrors(stdout, stderr) → LoadError[]
    ├── findTestFailures(stdout) → TestFailure[]
    └── collect worker crashes → WorkerError[]

    ▼
printFailureSummary(summary)
    │
    ▼
process.exit(exitCode)
```

---

## Data Structures

```typescript
// Internal — not exported, used within run-tests.mjs
type WorkerCollector = {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  signalCode: string | null;
  spawnError: string | null;
};

// Exported for testing
type LoadError = { file: string; stderrLines: string[] };
type TestFailure = { file: string; lines: string[] };
type WorkerResult = {
  idx: number; workerCount: number;
  stdout: string[]; stderr: string[];
  exitCode: number | null; signalCode: string | null; spawnError: string | null;
};
type FailureSummary = { loadErrors: string[]; testFailures: string[]; workerErrors: string[] };
```

---

## File / Module Layout

| File | Action | Purpose |
|------|--------|---------|
| `src/tests/run-tests.mjs` | **Modify** | Add buffering, correlation, summary (~+60 lines) |
| `src/tests/run-tests.test.ts` | **Create** | Unit tests for pure functions (~80 lines) |

No other files changed. No new modules — all logic stays in `run-tests.mjs` to keep
it self-contained (it is already a standalone script, not part of the TypeScript
compilation).

The pure functions (`correlateLoadErrors`, `findTestFailures`, `buildFailureSummary`)
are exported from `run-tests.mjs` and imported by `run-tests.test.ts` for testing.
The worker spawning code is guarded by `if (isMain)` (`process.argv[1] === fileURLToPath(import.meta.url)`) to prevent execution on import.

---

## Testing Strategy

### Unit Tests (`run-tests.test.ts`)

| Test | What it verifies | Requirement |
|------|-----------------|-------------|
| `correlateLoadErrors — normal output, no failures` | Returns empty array when no "No test suite found" lines exist | FR-002 |
| `correlateLoadErrors — single load error with stderr` | Matches one "No test suite found" with stderr lines containing the file basename | FR-002 |
| `correlateLoadErrors — load error without stderr` | Returns LoadError with empty stderrLines when stderr has no matching lines | FR-002 edge case 1 |
| `correlateLoadErrors — multiple load errors` | Each "No test suite found" line produces a separate LoadError | FR-002 |
| `findTestFailures — no failures` | Returns empty array on all-passing output | FR-003 |
| `findTestFailures — test failures present` | Detects `✖`, `FAIL`, and `not ok` lines | FR-003 |
| `findTestFailures — default sentinel` | Uses default sentinel `/✖ |FAIL |not ok /` when no argument passed | FR-003 |
| `buildFailureSummary — all passing` | All 3 sections empty | FR-003 |
| `buildFailureSummary — load errors only` | Only loadErrors populated, correctly formatted | FR-003 |
| `buildFailureSummary — worker crash` | workerErrors populated for signal code | FR-005 edge case 5 |
| `buildFailureSummary — spawn error` | workerErrors populated for spawn failure | FR-005 edge case 6 |

### Manual Smoke Tests

| Test | How |
|------|-----|
| `npm test` with all passing | Run from clean state, verify output identical to before (except possible summary omission) |
| Simulate load error | Temporarily add `import` of non-existent module to a test file, run `npm test`, verify clear error attribution |
| Simulate worker crash | Kill a worker mid-run with task manager, verify crash report in summary |

---

## Migration / Rollback

**Migration:** None. The change is additive — existing behavior is preserved, new
behavior appears only in the exit summary.

**Rollback:** Revert `run-tests.mjs` to previous version. Delete `run-tests.test.ts`.
Zero impact on other files.
