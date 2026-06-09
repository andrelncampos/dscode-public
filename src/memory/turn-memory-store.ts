/**
 * Turn memory store: persists canonical turn transcripts to disk
 * in a flat directory and prunes old files when they exceed the limit.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import type { MemorySettings, TurnTranscript } from "./turn-transcript-types";
import { compressTurn, decompressTurn, atomicWrite, extensionForAlgorithm } from "./turn-compressor";

// ── Paths ─────────────────────────────────────────────────────────────

function getMemoryDir(projectRoot: string): string {
  return path.join(projectRoot, ".dscode", "memory");
}

// ── Turn file naming ──────────────────────────────────────────────────

function generateTurnId(): string {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:]/g, "").slice(0, 15); // 20260608T215500
  const random = crypto.randomBytes(4).toString("hex");
  return `turn_${dateStr}_${random}`;
}

function makeTurnFileName(turnId: string, algorithm: "zstd" | "brotli"): string {
  return turnId + extensionForAlgorithm(algorithm);
}

function makeTurnFilePath(projectRoot: string, turnId: string, algorithm: "zstd" | "brotli"): string {
  return path.join(getMemoryDir(projectRoot), makeTurnFileName(turnId, algorithm));
}

// ── TURN_FILE_GLOB for listing files ─────────────────────────────────

// Matches both new (.dctz/.dctb) and legacy (.json.zst/.json.br) extensions
const TURN_FILE_RE = /^turn_\d{8}T\d{6}_[0-9a-f]{8}\.(?:dct[zb]|json\.(?:zst|br))$/;

/** Detect compression algorithm from file extension. Returns null for unrecognised extensions. */
function detectAlgorithm(fileName: string): "zstd" | "brotli" | null {
  if (fileName.endsWith(".dctz") || fileName.endsWith(".zst")) return "zstd";
  if (fileName.endsWith(".dctb") || fileName.endsWith(".br")) return "brotli";
  return null;
}

// ── Prune mutex ───────────────────────────────────────────────────────

/**
 * Simple sequential mutex to prevent concurrent pruneOldTurns calls.
 * storeTurn is called sequentially in practice, but this guards against
 * any future concurrent call patterns.
 */
let pruneMutex: Promise<void> = Promise.resolve();

function withPruneMutex(fn: () => Promise<void>): Promise<void> {
  const next = pruneMutex.then(fn, fn);
  pruneMutex = next.catch(() => {});
  return next;
}

// ── Store a turn ──────────────────────────────────────────────────────

export type StoreTurnResult = {
  ok: boolean;
  turnId: string;
  error?: string;
};

/**
 * Persist a canonical turn transcript to disk and prune excess files.
 * Compresses the transcript and writes it atomically to a flat directory.
 */
export async function storeTurn(
  projectRoot: string,
  transcript: TurnTranscript,
  settings: MemorySettings
): Promise<StoreTurnResult> {
  if (!settings.enabled || !settings.storeTurnTranscripts) {
    return { ok: false, turnId: "", error: "Memory disabled" };
  }

  const turnId = transcript.id || generateTurnId();

  try {
    const jsonString = JSON.stringify(transcript);
    const compressResult = await compressTurn(jsonString, settings);

    const filePath = makeTurnFilePath(projectRoot, turnId, compressResult.algorithm);
    await atomicWrite(filePath, compressResult.buffer);

    // Prune old files if we exceed maxTurnFiles (serialised via mutex)
    await withPruneMutex(() => pruneOldTurns(projectRoot, settings.maxTurnFiles));

    return { ok: true, turnId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, turnId, error: message };
  }
}

// ── Read recent turns ─────────────────────────────────────────────────

/**
 * Read the most recent N turns from the memory store.
 * Lists turn files in the flat directory, sorts by filename (timestamp order),
 * and decompresses only the needed files.
 * Respects both recentTurns limit and maxContextChars.
 */
export async function readRecentTurns(
  projectRoot: string,
  recentTurns: number,
  maxContextChars: number
): Promise<TurnTranscript[]> {
  const memDir = getMemoryDir(projectRoot);

  let entries: string[];
  try {
    entries = await fs.readdir(memDir);
  } catch {
    return [];
  }

  // Collect turn files sorted by name (ascending = chronological)
  const turnFiles = entries.filter((name) => TURN_FILE_RE.test(name)).sort();

  if (turnFiles.length === 0) return [];

  // Take the most recent N
  const candidateFiles = turnFiles.slice(-recentTurns);

  // Read, decompress, and parse from most recent to oldest,
  // stopping when maxContextChars is exceeded.
  const transcripts: TurnTranscript[] = [];
  let totalChars = 0;

  for (let i = candidateFiles.length - 1; i >= 0; i--) {
    const filePath = path.join(memDir, candidateFiles[i]);
    try {
      const compressed = await fs.readFile(filePath);
      const algorithm = detectAlgorithm(candidateFiles[i]);
      if (!algorithm) continue; // unknown extension — skip
      const jsonString = await decompressTurn(compressed, algorithm);
      const transcript = JSON.parse(jsonString) as TurnTranscript;

      const turnChars = transcript.u.length + transcript.a.length + estimateTranscriptChars(transcript);

      if (totalChars + turnChars > maxContextChars && transcripts.length > 0) {
        continue;
      }

      transcripts.unshift(transcript);
      totalChars += turnChars;

      if (totalChars >= maxContextChars) break;
    } catch {
      continue;
    }
  }

  return transcripts;
}

// ── Prune old turns ───────────────────────────────────────────────────

/**
 * Delete the oldest turn files until the count is within maxFiles.
 */
async function pruneOldTurns(projectRoot: string, maxFiles: number): Promise<void> {
  const memDir = getMemoryDir(projectRoot);

  let entries: string[];
  try {
    entries = await fs.readdir(memDir);
  } catch {
    return;
  }

  const turnFiles = entries.filter((name) => TURN_FILE_RE.test(name)).sort();

  const excess = turnFiles.length - maxFiles;
  if (excess <= 0) return;

  for (let i = 0; i < excess; i++) {
    try {
      await fs.unlink(path.join(memDir, turnFiles[i]));
    } catch {
      // Best effort — skip files that can't be deleted
    }
  }
}

function estimateTranscriptChars(transcript: TurnTranscript): number {
  let chars = 0;

  // Actions
  for (const act of transcript.act) {
    switch (act.k) {
      case "shell":
        chars += act.cmd.length + act.out.length + act.err.length;
        break;
      case "read":
      case "write":
      case "edit":
        chars += act.path.length + 20; // path + ~20 chars overhead for formatting
        break;
      case "other":
        chars += act.name.length + act.summary.length;
        break;
    }
  }

  // Files (paths + ops + diffs — can be large)
  for (const f of transcript.files) {
    chars += f.p.length + f.op.length + (f.diff ? f.diff.length : 0) + 10;
  }

  // Errors
  for (const e of transcript.err) {
    chars += e.kind.length + e.message.length + 5;
  }

  return chars;
}
