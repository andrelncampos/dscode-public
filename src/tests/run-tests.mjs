/* eslint-disable */
// Parallel test runner — distributes test files across N workers.
// Each worker runs `node --import tsx --test` on its subset of files.
// Uses all available CPU cores (capped at 8) for maximum throughput.

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";
import { cpus } from "node:os";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(__dirname, "..", "..");

const files = globSync("*.test.ts", { cwd: __dirname, absolute: true });

if (files.length === 0) {
  process.stdout.write("No test files found.\n");
  process.exit(0);
}

// Distribute files round-robin across workers so large suites
// (like session.test.ts) don't bottleneck a single worker.
const numWorkers = Math.min(cpus().length, files.length, 8);
const buckets = Array.from({ length: numWorkers }, () => /** @type {string[]} */ ([]));
for (let i = 0; i < files.length; i++) {
  buckets[i % numWorkers].push(files[i]);
}

// Remove empty buckets (when fewer files than CPUs).
const activeBuckets = buckets.filter((b) => b.length > 0);
const workerCount = activeBuckets.length;

// ── Pure functions (exported for testing) ──────────────────────────

/**
 * Match "No test suite found" lines with stderr errors containing
 * the same file basename.
 *
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
    const stderrLines = stderr.filter((l) => l.includes(basename)).slice(0, 5);
    result.push({ file, stderrLines });
  }
  return result;
}

/**
 * Find test failure lines in stdout using a sentinel regex.
 * Groups by file path.
 *
 * @param {string[]} stdout
 * @param {RegExp} [sentinel]
 * @returns {{file: string, lines: string[]}[]}
 */
export function findTestFailures(stdout, sentinel) {
  const re = sentinel ?? /✖ /;
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

/**
 * Build structured failure summary from all worker results.
 *
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
      const detail = le.stderrLines.length > 0 ? `Load error: ${le.stderrLines[0]}` : "Load error (no stderr output)";
      loadErrors.push(`${prefix} ${le.file} — ${detail}`);
    }
    // Test failures
    for (const tf of findTestFailures(w.stdout)) {
      testFailures.push(`${prefix} ${tf.file} — ${tf.lines[0]}`);
    }
  }
  return { loadErrors, testFailures, workerErrors };
}

// ── Side-effect function ───────────────────────────────────────────

/**
 * Print the failure summary to stderr.
 *
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

// ── Execute only when run directly (not imported) ─────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.stdout.write(
    `Running ${files.length} test files across ${workerCount} workers ` + `(${cpus().length} CPUs available).\n\n`
  );

  const startTime = performance.now();

  // ── Worker buffers ─────────────────────────────────────────────────

  /** @type {Array<{stdout: string[], stderr: string[], exitCode: number|null, signalCode: string|null, spawnError: string|null}>} */
  const workerResults = activeBuckets.map(() => ({
    stdout: [],
    stderr: [],
    exitCode: null,
    signalCode: null,
    spawnError: null,
  }));

  // ── Spawn workers ──────────────────────────────────────────────────

  const results = await Promise.all(
    activeBuckets.map(
      (workerFiles, idx) =>
        new Promise((resolve) => {
          const prefix = `[${idx + 1}/${workerCount}]`;
          const child = spawn(process.execPath, ["--import", "tsx", "--test", ...workerFiles], {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
          });

          const stdout = createInterface({ input: child.stdout });
          stdout.on("line", (line) => {
            process.stdout.write(`${prefix} ${line}\n`);
            if (workerResults[idx].stdout.length < 10000) {
              workerResults[idx].stdout.push(line.length > 10000 ? line.slice(0, 10000) : line);
            }
          });

          const stderr = createInterface({ input: child.stderr });
          stderr.on("line", (line) => {
            process.stderr.write(`${prefix} ${line}\n`);
            if (workerResults[idx].stderr.length < 10000) {
              workerResults[idx].stderr.push(line.length > 10000 ? line.slice(0, 10000) : line);
            }
          });

          child.on("close", (code) => {
            workerResults[idx].exitCode = code;
            workerResults[idx].signalCode = child.signalCode ?? null;
            resolve(code ?? 1);
          });

          child.on("error", (err) => {
            workerResults[idx].spawnError = err.message;
          });
        })
    )
  );

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

  // ── Build and print failure summary ────────────────────────────────

  const enrichedResults = workerResults.map((r, i) => ({
    idx: i,
    workerCount,
    ...r,
  }));
  const summary = buildFailureSummary(enrichedResults);
  printFailureSummary(summary);

  const hasLoadErrors = summary.loadErrors.length > 0;
  const hasFailures = results.some((c) => c !== 0);
  const exitCode = hasFailures || hasLoadErrors ? 1 : 0;

  process.stdout.write(`\n${exitCode === 0 ? "All" : "Some"} workers completed in ${elapsed}s.\n`);
  process.exit(exitCode);
}
