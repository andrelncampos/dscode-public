/**
 * Debug script: prints raw stdin bytes for diagnosing terminal key sequences.
 *
 * Usage: node scripts/debug-stdin.mjs
 *        npm run debug:keys
 *
 * Press keys and observe the raw bytes. Ctrl+C to exit.
 * Each chunk is printed as JSON.stringify(chunk) and hex bytes.
 */

// Put stdin in raw mode so we see every byte.
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

let firstChunk = true;

process.stdin.on("data", (chunk) => {
  const raw = typeof chunk === "string" ? chunk : chunk.toString();

  // Ctrl+C in raw mode sends \x03
  if (raw === "\x03") {
    console.log("\nExiting (Ctrl+C)");
    process.stdin.setRawMode(false);
    process.exit(0);
  }

  if (firstChunk) {
    console.log("Listening for stdin bytes. Press keys, Ctrl+C to exit.\n");
    firstChunk = false;
  }

  const hexBytes = Array.from(Buffer.from(raw, "binary"))
    .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
    .join(" ");

  console.log(`JSON : ${JSON.stringify(raw)}`);
  console.log(`hex  : ${hexBytes}`);
  console.log(`len  : ${raw.length} byte(s)`);
  console.log("---");
});

// Graceful cleanup on SIGINT
process.on("SIGINT", () => {
  process.stdin.setRawMode(false);
  process.exit(0);
});
