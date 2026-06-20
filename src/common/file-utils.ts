import * as fs from "node:fs";
import * as path from "node:path";
import type { FileState, FileLineEnding } from "./state";

export type FileReadMetadata = {
  content: string;
  encoding: BufferEncoding;
  lineEndings: FileLineEnding;
  timestamp: number;
};

export function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function detectLineEndings(value: string): FileLineEnding {
  return value.includes("\r\n") ? "CRLF" : "LF";
}

export function detectEncoding(buffer: Buffer): BufferEncoding {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf16le";
  }

  return "utf8";
}

export function readTextFileWithMetadata(filePath: string): FileReadMetadata {
  const buffer = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  const encoding = detectEncoding(buffer);
  const raw = buffer.toString(encoding);

  return {
    content: normalizeContent(raw),
    encoding,
    lineEndings: detectLineEndings(raw),
    timestamp: Math.floor(stat.mtimeMs),
  };
}

export function writeTextFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding,
  lineEndings: FileLineEnding
): number {
  const normalized = normalizeContent(content);
  const toWrite = lineEndings === "CRLF" ? normalized.replace(/\n/g, "\r\n") : normalized;
  fs.writeFileSync(filePath, toWrite, { encoding });
  return Buffer.byteLength(toWrite, encoding === "utf16le" ? "utf16le" : "utf8");
}

export function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function hasFileChangedSinceState(filePath: string, state: FileState): boolean {
  const current = readTextFileWithMetadata(filePath);
  if (current.timestamp <= state.timestamp) {
    return false;
  }

  const isFullRead = !state.isPartialView && typeof state.offset === "undefined" && typeof state.limit === "undefined";

  return !(isFullRead && current.content === state.content);
}

export function buildDiffPreview(
  filePath: string,
  originalContent: string | null,
  updatedContent: string,
  maxLines = 40
): string | null {
  const original = originalContent === null ? null : normalizeContent(originalContent);
  const updated = normalizeContent(updatedContent);

  if (original !== null && original === updated) {
    return null;
  }

  const oldLines = toDiffLines(original);
  const newLines = toDiffLines(updated);

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);
  const oldStart = original === null ? 0 : prefix + 1;
  const newStart = prefix + 1;

  const previewLines = [
    `--- ${original === null ? "/dev/null" : `a/${filePath}`}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldChanged.length} +${newStart},${newChanged.length} @@`,
  ];

  if (prefix > 0) {
    previewLines.push(` ${oldLines[prefix - 1]}`);
  }

  for (const line of oldChanged) {
    previewLines.push(`-${line}`);
  }

  for (const line of newChanged) {
    previewLines.push(`+${line}`);
  }

  if (suffix > 0) {
    previewLines.push(` ${oldLines[oldLines.length - suffix]}`);
  }

  if (previewLines.length > maxLines) {
    return `${previewLines.slice(0, maxLines).join("\n")}\n...`;
  }

  return previewLines.join("\n");
}

function toDiffLines(content: string | null): string[] {
  if (!content) {
    return [];
  }

  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

// ── Atomic file writes ─────────────────────────────────────────────────

function generateShortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Write data to a file atomically:
 * 1. Write to a temp file in the same directory
 * 2. Rename temp to target (atomic on most filesystems)
 *
 * This prevents file corruption if the process crashes mid-write.
 */
export function atomicWriteFileSync(filePath: string, data: string | Buffer): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${generateShortId()}`;
  try {
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}

/**
 * Async variant of atomicWriteFileSync.
 */
export async function atomicWriteFile(filePath: string, data: Buffer): Promise<void> {
  const { promises: fsp } = await import("fs");
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${generateShortId()}`;
  try {
    await fsp.writeFile(tmpPath, data);
    await fsp.rename(tmpPath, filePath);
  } catch (err) {
    try {
      await fsp.unlink(tmpPath);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}

/**
 * Write JSON data atomically (sync).
 */
export function atomicWriteJsonFileSync(filePath: string, data: unknown): void {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  atomicWriteFileSync(filePath, json);
}

/**
 * Write JSON data atomically (async).
 */
export async function atomicWriteJsonFile(filePath: string, data: unknown): Promise<void> {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await atomicWriteFile(filePath, Buffer.from(json, "utf8"));
}

/**
 * Create a timestamped backup of a spec document before modification.
 * Only backs up files within management/specs/. No-op for other paths.
 */
export async function backupSpecFile(filePath: string): Promise<void> {
  const normalized = filePath.split(path.sep).join("/");
  if (!normalized.includes("/management/specs/")) return;
  if (!fs.existsSync(filePath)) return;
  const ts = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const backupPath = `${filePath}.bak.${ts}`;
  await fs.promises.copyFile(filePath, backupPath);
}
