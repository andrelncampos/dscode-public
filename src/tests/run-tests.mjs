/* eslint-disable */
// Optimised cross-platform test runner.
// Runs fast unit tests with concurrency, then heavy integration tests sequentially.
// Uses tsx for TypeScript compilation (JIT, cached by Node's module system).

import { globSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const filter = process.env.TEST_FILTER;
const startAll = Date.now();

// ── file suites ─────────────────────────────────────────────────────────────

const FAST_SUITE = [
  "ask-user-question.test.ts",
  "clipboard.test.ts",
  "debug-logger.test.ts",
  "dropdown-menu.test.ts",
  "exit-summary.test.ts",
  "file-mentions.test.ts",
  "loading-text.test.ts",
  "markdown.test.ts",
  "mcp-client.test.ts",
  "memory-leak.test.ts",
  "message-view.test.ts",
  "openai-message-converter.test.ts",
  "openai-thinking.test.ts",
  "permission-prompt.test.ts",
  "permissions.test.ts",
  "process-tree.test.ts",
  "prompt-buffer.test.ts",
  "prompt-input-keys.test.ts",
  "prompt-undo-redo.test.ts",
  "prompt.test.ts",
  "reasoning-effort-manager.test.ts",
  "sensitive-data.test.ts",
  "session-list.test.ts",
  "settings-and-notify.test.ts",
  "shell-utils.test.ts",
  "slash-commands.test.ts",
  "telemetry.test.ts",
  "thinking-state.test.ts",
  "tool-executor.test.ts",
  "update-check.test.ts",
  "web-search-handler.test.ts",
  "web-search.test.ts",
  "welcome-screen.test.ts",
];

const HEAVY_SUITE = ["session.test.ts", "tool-handlers.test.ts"];

const available = new Set(globSync("src/tests/*.test.ts", { cwd }).map((f) => f.replace(/\\/g, "/")));

function pick(list) {
  return list.filter((f) => available.has(`src/tests/${f}`)).map((f) => `src/tests/${f}`);
}

// ── run phase ───────────────────────────────────────────────────────────────

function runSuite(files, label, timeoutMs, extraArgs = []) {
  if (files.length === 0) return 0;
  const start = Date.now();
  process.stdout.write(`🧪 Running ${label} (${files.length} file(s))...\n`);

  const args = ["--import", "tsx", "--test", "--test-timeout", String(timeoutMs), ...extraArgs, ...files];
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd });

  if (result.status !== 0) return result.status ?? 1;
  console.log(`✅ ${label}: passed in ${Date.now() - start}ms`);
  return 0;
}

// ── main ────────────────────────────────────────────────────────────────────

let fastFiles = pick(FAST_SUITE);
let heavyFiles = pick(HEAVY_SUITE);

if (filter) {
  fastFiles = fastFiles.filter((f) => f.includes(filter));
  heavyFiles = heavyFiles.filter((f) => f.includes(filter));
  const all = [...fastFiles, ...heavyFiles];
  if (all.length === 0) {
    const availableAll = globSync("src/tests/*.test.ts", { cwd });
    console.error(`No test files match filter "${filter}". Available files:`);
    availableAll.forEach((f) => console.error(`  ${f}`));
    process.exit(1);
  }
  console.log(`Running ${all.length} test file(s) matching "${filter}"...\n`);
}

// Fast suite: parallel via --test-concurrency (Node 22+)
const fastExit = runSuite(fastFiles, "fast suite", 15000, ["--test-concurrency", "8"]);

// Heavy suite: sequential (git/bash shared state)
const heavyExit = runSuite(heavyFiles, "heavy suite", 30000);

console.log(`\n🏁 All tests completed in ${Date.now() - startAll}ms`);
process.exit(fastExit !== 0 ? fastExit : heavyExit !== 0 ? heavyExit : 0);
