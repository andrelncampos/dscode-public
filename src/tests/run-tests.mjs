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

process.stdout.write(
  `Running ${files.length} test files across ${workerCount} workers ` + `(${cpus().length} CPUs available).\n\n`
);

const startTime = performance.now();

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
        });

        const stderr = createInterface({ input: child.stderr });
        stderr.on("line", (line) => {
          process.stderr.write(`${prefix} ${line}\n`);
        });

        child.on("close", (code) => {
          resolve(code ?? 1);
        });
      })
  )
);

const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
const exitCode = results.some((c) => c !== 0) ? 1 : 0;

process.stdout.write(`\n${exitCode === 0 ? "All" : "Some"} workers completed in ${elapsed}s.\n`);
process.exit(exitCode);
