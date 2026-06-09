/**
 * Extended debug script: enables modifyOtherKeys (level 2) before raw mode.
 *
 * Usage: node scripts/debug-stdin-extended.mjs
 *        npm run debug:keys:extended
 *
 * Sends \x1B[>4;2m at startup to request CSI-u formatted key reports
 * (including Shift+Enter). Logs the bytes received. On exit, resets
 * with \x1B[>4;0m.
 *
 * Press keys and observe the raw bytes. Ctrl+C to exit.
 */

import { createInterface } from "node:readline";

const ENABLE = "\x1B[>4;2m";
const DISABLE = "\x1B[>4;0m";

// Write enable sequence before going raw
process.stdout.write(ENABLE);

function cleanup() {
  process.stdout.write(DISABLE);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  console.log("\nDone.");
  process.exit(0);
}

// Ctrl+C handler
process.on("SIGINT", cleanup);

// Put stdin in raw mode
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

console.log("Extended debug mode. modifyOtherKeys level 2 enabled.");
console.log(`ENABLE sent: ${JSON.stringify(ENABLE)} (${ENABLE.length} bytes)`);
console.log("Listening for stdin bytes. Press keys, Ctrl+C to exit.\n");

let firstChunk = true;

process.stdin.on("data", (chunk) => {
  const raw = typeof chunk === "string" ? chunk : chunk.toString();

  // Ctrl+C in raw mode sends \x03
  if (raw === "\x03") {
    console.log("\nExiting (Ctrl+C)");
    cleanup();
  }

  const hexBytes = Array.from(Buffer.from(raw, "binary"))
    .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
    .join(" ");

  console.log(`JSON : ${JSON.stringify(raw)}`);
  console.log(`hex  : ${hexBytes}`);
  console.log(`len  : ${raw.length} byte(s)`);
  console.log("---");
});
