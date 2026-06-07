/* eslint-disable */
// Cross-platform test runner — finds all *.test.ts files with globSync and
// executes them via node --import tsx --test.
// Uses the 'glob' package (already in devDependencies) for portability.

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(__dirname, "..", "..");

const files = globSync("*.test.ts", { cwd: __dirname, absolute: true });

if (files.length === 0) {
  process.stdout.write("No test files found.\n");
  process.exit(0);
}

const args = ["--import", "tsx", "--test", ...files];
const child = spawn(process.execPath, args, { stdio: "inherit", cwd });

child.on("close", (code) => {
  process.exit(code ?? 1);
});
