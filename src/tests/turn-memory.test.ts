/**
 * Unit tests for the turn transcript memory system.
 *
 * Uses Node.js native test runner — compatible with the project's test framework.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ── Secret redactor ────────────────────────────────────────────────────
import { redactSecrets } from "../memory/turn-secret-redactor";

describe("turn-secret-redactor", () => {
  test("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456";
    const result = redactSecrets(input);
    assert.ok(result.includes("[REDACTED]"));
    assert.ok(!result.includes("abcdefghijklmnopqrstuvwxyz123456"));
    assert.ok(result.includes("Bearer"));
  });

  test("redacts OpenAI-style keys (sk-...)", () => {
    const input = "Using key: sk-proj-1234567890abcdefghij";
    const result = redactSecrets(input);
    assert.ok(result.includes("[REDACTED]"));
    assert.ok(!result.includes("sk-proj-1234567890abcdefghij"));
  });

  test("redacts password=... patterns", () => {
    const input = "database password=supersecret123 connect";
    const result = redactSecrets(input);
    assert.ok(result.includes("[REDACTED]"));
    assert.ok(!result.includes("supersecret123"));
    assert.ok(result.includes("password="));
  });

  test("redacts token:... patterns", () => {
    const input = "export token: abcdefghijklmnop";
    const result = redactSecrets(input);
    assert.ok(result.includes("[REDACTED]"));
    assert.ok(!result.includes("abcdefghijklmnop"));
  });

  test("does not redact common paths", () => {
    const input = "Reading file: /home/user/project/src/index.ts";
    const result = redactSecrets(input);
    assert.equal(result, input);
  });

  test("does not redact file names", () => {
    const input = "Edited: src/session.ts, src/settings.ts";
    const result = redactSecrets(input);
    assert.equal(result, input);
  });
});

// ── Canonicalizer ──────────────────────────────────────────────────────
import {
  stripAnsi,
  normalizeLineEndings,
  collapseBlankLines,
  dedupeRepeatedLines,
  truncateText,
  canonicalizeText,
  canonicalizeShellOutput,
} from "../memory/turn-canonicalizer";

describe("turn-canonicalizer", () => {
  const defaultOptions = {
    stripAnsi: true,
    collapseWhitespace: true,
    dedupeRepeatedLines: true,
    limits: {
      maxUserChars: 6000,
      maxAssistantChars: 8000,
      maxStdoutChars: 4000,
      maxStderrChars: 6000,
      maxDiffChars: 8000,
    },
  };

  test("stripAnsi removes ANSI escape codes", () => {
    const input = "\x1b[31mRed text\x1b[0m normal";
    const result = stripAnsi(input);
    assert.equal(result, "Red text normal");
  });

  test("stripAnsi handles complex SGR sequences", () => {
    const input = "\x1b[1;31;42mBold red on green\x1b[0m";
    const result = stripAnsi(input);
    assert.equal(result, "Bold red on green");
  });

  test("normalizeLineEndings converts CRLF to LF", () => {
    const input = "line1\r\nline2\r\nline3";
    const result = normalizeLineEndings(input);
    assert.equal(result, "line1\nline2\nline3");
  });

  test("normalizeLineEndings strips trailing whitespace", () => {
    const input = "line1   \nline2\t\nline3";
    const result = normalizeLineEndings(input);
    assert.equal(result, "line1\nline2\nline3");
  });

  test("collapseBlankLines collapses 3+ blank lines into 1", () => {
    const input = "a\n\n\n\nb";
    const result = collapseBlankLines(input);
    assert.equal(result, "a\n\nb");
  });

  test("collapseBlankLines keeps single blank line", () => {
    const input = "a\n\nb";
    const result = collapseBlankLines(input);
    assert.equal(result, "a\n\nb");
  });

  test("dedupeRepeatedLines replaces long runs with marker", () => {
    const input = "error\nerror\nerror\nerror\nerror";
    const result = dedupeRepeatedLines(input);
    assert.ok(result.includes("[truncated:"));
    assert.ok(result.includes("repeated lines omitted"));
  });

  test("dedupeRepeatedLines keeps first and last of a run", () => {
    const input = "error\nerror\nerror\nerror\nerror";
    const result = dedupeRepeatedLines(input);
    const lines = result.split("\n");
    assert.equal(lines[0], "error");
    assert.ok(lines[1].includes("truncated"));
    assert.equal(lines[2], "error");
    assert.equal(lines.length, 3);
  });

  test("dedupeRepeatedLines does not affect runs of 2", () => {
    const input = "line1\nline1\nline2";
    const result = dedupeRepeatedLines(input);
    assert.equal(result, "line1\nline1\nline2");
  });

  test("truncateText preserves head and tail with marker", () => {
    const input = "a".repeat(2000);
    const result = truncateText(input, 1000);
    assert.ok(result.length < 1200); // Allow some margin for marker
    assert.ok(result.includes("[truncated:"));
    assert.ok(result.startsWith("a"));
    assert.ok(result.endsWith("a"));
  });

  test("truncateText returns original when within limit", () => {
    const input = "short text";
    const result = truncateText(input, 100);
    assert.equal(result, input);
  });

  test("canonicalizeText preserves user message content", () => {
    const input = "What is the meaning of xpto?";
    const result = canonicalizeText(input, 6000, defaultOptions);
    assert.ok(result.includes("xpto"));
  });

  test("canonicalizeShellOutput removes ANSI and dedupes", () => {
    const input = "\x1b[32mOK\x1b[0m\nOK\nOK\nOK";
    const result = canonicalizeShellOutput(input, 4000, defaultOptions);
    assert.ok(!result.includes("\x1b"));
    assert.ok(result.includes("OK"));
  });
});

// ── Context builder ────────────────────────────────────────────────────
import { buildTurnContext } from "../memory/turn-memory-context-builder";
import type { TurnTranscript } from "../memory/turn-transcript-types";

describe("turn-memory-context-builder", () => {
  const makeTranscript = (overrides: Partial<TurnTranscript> = {}): TurnTranscript => ({
    v: 1,
    id: "turn_test_001",
    ts: "2026-06-08T15:40:12-03:00",
    cwd: "/home/project",
    git: { branch: "main" },
    env: { terminal: "bash", platform: "linux", node: "v24.0.0" },
    u: "Test user message",
    a: "Test assistant response",
    act: [],
    files: [],
    err: [],
    ...overrides,
  });

  test("returns null for empty transcripts array", () => {
    assert.equal(buildTurnContext([], 1000), null);
  });

  test("formats a single turn with user and assistant messages", () => {
    const turns = [makeTranscript()];
    const context = buildTurnContext(turns, 10000);
    assert.ok(context);
    assert.ok(context!.includes("T-1"));
    assert.ok(context!.includes("Test user message"));
    assert.ok(context!.includes("Test assistant response"));
  });

  test("includes shell actions in formatted output", () => {
    const turns = [
      makeTranscript({
        act: [
          {
            k: "shell",
            cmd: "npm test",
            cwd: "/home/project",
            exit: 0,
            out: "All tests passed",
            err: "",
          },
        ],
      }),
    ];
    const context = buildTurnContext(turns, 10000);
    assert.ok(context);
    assert.ok(context!.includes("npm test"));
    assert.ok(context!.includes("exit=0"));
  });

  test("includes file records", () => {
    const turns = [
      makeTranscript({
        files: [
          { p: "src/index.ts", op: "write" },
          { p: "src/utils.ts", op: "read" },
        ],
      }),
    ];
    const context = buildTurnContext(turns, 10000);
    assert.ok(context);
    assert.ok(context!.includes("FILES:"));
    assert.ok(context!.includes("src/index.ts write"));
  });

  test("respects maxContextChars limit", () => {
    const turns = Array.from({ length: 10 }, (_, i) =>
      makeTranscript({
        id: `turn_${i}`,
        u: `User message number ${i} with some padding text `.repeat(50),
        a: `Assistant response number ${i} with padding `.repeat(50),
      })
    );
    const context = buildTurnContext(turns, 500);
    assert.ok(context);
    // With maxContextChars=500, should include at most 1-2 turns
    const turnCount = (context!.match(/^T-\d+/gm) ?? []).length;
    assert.ok(turnCount <= 2, `Expected <= 2 turns but got ${turnCount}`);
  });

  test("includes errors when present", () => {
    const turns = [
      makeTranscript({
        err: [{ kind: "command", message: "MODULE_NOT_FOUND: test.js" }],
      }),
    ];
    const context = buildTurnContext(turns, 10000);
    assert.ok(context);
    assert.ok(context!.includes("ERRORS:"));
    assert.ok(context!.includes("MODULE_NOT_FOUND"));
  });
});

// ── Memory settings ────────────────────────────────────────────────────
import { resolveMemorySettings, DEFAULT_MEMORY_SETTINGS } from "../memory/memory-settings";

describe("memory-settings", () => {
  test("returns defaults when no overrides provided", () => {
    const result = resolveMemorySettings(undefined);
    assert.equal(result.mode, "turn-transcript");
    assert.equal(result.enabled, true);
    assert.equal(result.compression, "zstd");
  });

  test("returns defaults for empty object", () => {
    const result = resolveMemorySettings({});
    assert.equal(result.mode, "turn-transcript");
  });

  test("merges partial overrides", () => {
    const result = resolveMemorySettings({ recentTurns: 5, enabled: false });
    assert.equal(result.recentTurns, 5);
    assert.equal(result.enabled, false);
    assert.equal(result.mode, "turn-transcript"); // unchanged default
  });

  test("validates mode enum", () => {
    const result = resolveMemorySettings({ mode: "turn-transcript" as const });
    assert.equal(result.mode, "turn-transcript");
  });

  test("falls back to default for invalid mode", () => {
    const result = resolveMemorySettings({ mode: "invalid" as any });
    assert.equal(result.mode, "turn-transcript");
  });

  test("validates compression enum", () => {
    const result = resolveMemorySettings({ compression: "brotli" as const });
    assert.equal(result.compression, "brotli");
  });

  test("validates maxTurnFiles in range", () => {
    const result = resolveMemorySettings({ maxTurnFiles: 42 });
    assert.equal(result.maxTurnFiles, 42);
  });

  test("clamps compression level", () => {
    const result = resolveMemorySettings({ compressionLevel: 999 });
    assert.equal(result.compressionLevel, DEFAULT_MEMORY_SETTINGS.compressionLevel);
  });
});

// ── Turn memory store (integration tests with temp dirs) ───────────────
import * as os from "node:os";
import * as fsSync from "node:fs";
import * as path2 from "node:path";
import { storeTurn, readRecentTurns } from "../memory/turn-memory-store";
import type { MemorySettings } from "../memory/turn-transcript-types";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function makeTurnId(index: number): string {
  // Match TURN_FILE_RE: turn_YYYYMMDDTHHmmss_<8hex>
  return `turn_20260101T${pad2(index)}0000_${String(index).padStart(8, "0")}`;
}

function makeTranscriptHelper(index: number, u: string, a: string): TurnTranscript {
  return {
    v: 1,
    id: makeTurnId(index),
    ts: `2026-01-01T${pad2(index)}:00:00Z`,
    cwd: "/tmp/project",
    git: null,
    env: { terminal: "bash", platform: "linux", node: "v24.0.0" },
    u,
    a,
    act: [],
    files: [],
    err: [],
  };
}

function makeMemorySettingsHelper(overrides: Partial<MemorySettings> = {}): MemorySettings {
  return {
    enabled: true,
    mode: "turn-transcript",
    recentTurns: 10,
    maxTurnFiles: 100,
    maxContextChars: 30000,
    maxUserCharsPerTurn: 6000,
    maxAssistantCharsPerTurn: 8000,
    maxStdoutCharsPerTurn: 4000,
    maxStderrCharsPerTurn: 6000,
    maxDiffCharsPerTurn: 8000,
    compression: "zstd",
    compressionLevel: 3,
    stripAnsi: true,
    collapseWhitespace: true,
    dedupeRepeatedLines: true,
    storeTurnTranscripts: true,
    ...overrides,
  };
}

describe("turn-memory-store", () => {
  test("storeTurn and readRecentTurns roundtrip", async () => {
    const dir = fsSync.mkdtempSync(path2.join(os.tmpdir(), "dscode-memory-test-"));
    try {
      const settings = makeMemorySettingsHelper();

      const t1 = makeTranscriptHelper(1, "user msg 1", "assistant msg 1");
      const r1 = await storeTurn(dir, t1, settings);
      assert.equal(r1.ok, true);

      const t2 = makeTranscriptHelper(2, "user msg 2", "assistant msg 2");
      const r2 = await storeTurn(dir, t2, settings);
      assert.equal(r2.ok, true);

      const turns = await readRecentTurns(dir, 10, 30000);
      assert.equal(turns.length, 2);
      assert.equal(turns[0].u, "user msg 1");
      assert.equal(turns[1].u, "user msg 2");
    } finally {
      fsSync.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prunes old turns when exceeding maxTurnFiles", async () => {
    const dir = fsSync.mkdtempSync(path2.join(os.tmpdir(), "dscode-prune-test-"));
    try {
      const settings = makeMemorySettingsHelper({ maxTurnFiles: 2, compressionLevel: 1 });

      for (let i = 0; i < 5; i++) {
        const t = makeTranscriptHelper(i, `user ${i}`, `assistant ${i}`);
        await storeTurn(dir, t, settings);
      }

      const turns = await readRecentTurns(dir, 10, 30000);
      assert.equal(turns.length, 2, `Expected 2 turns after pruning, got ${turns.length}`);
      assert.ok(turns[0].u.includes("3") || turns[0].u.includes("4"));
    } finally {
      fsSync.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("readRecentTurns respects recentTurns limit", async () => {
    const dir = fsSync.mkdtempSync(path2.join(os.tmpdir(), "dscode-limit-test-"));
    try {
      const settings = makeMemorySettingsHelper({ maxTurnFiles: 100, compressionLevel: 1 });

      for (let i = 0; i < 5; i++) {
        const t = makeTranscriptHelper(i, `user ${i}`, `assistant ${i}`);
        await storeTurn(dir, t, settings);
      }

      const turns = await readRecentTurns(dir, 2, 30000);
      assert.equal(turns.length, 2);
      assert.ok(turns[0].u.includes("3"));
      assert.ok(turns[1].u.includes("4"));
    } finally {
      fsSync.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("readRecentTurns respects maxContextChars", async () => {
    const dir = fsSync.mkdtempSync(path2.join(os.tmpdir(), "dscode-context-test-"));
    try {
      const settings = makeMemorySettingsHelper({ maxTurnFiles: 100, compressionLevel: 1 });
      const bigMsg = "x".repeat(5000);

      for (let i = 0; i < 3; i++) {
        const t = makeTranscriptHelper(i, bigMsg, bigMsg);
        await storeTurn(dir, t, settings);
      }

      const turns = await readRecentTurns(dir, 10, 12000);
      assert.equal(turns.length, 1, `Expected 1 turn, got ${turns.length}`);
    } finally {
      fsSync.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Compressor (unit tests without actual zlib calls) ──────────────────
import { extensionForAlgorithm } from "../memory/turn-compressor";

describe("turn-compressor", () => {
  test("extensionForAlgorithm returns .dctz for zstd", () => {
    assert.equal(extensionForAlgorithm("zstd"), ".dctz");
  });

  test("extensionForAlgorithm returns .dctb for brotli", () => {
    assert.equal(extensionForAlgorithm("brotli"), ".dctb");
  });
});
