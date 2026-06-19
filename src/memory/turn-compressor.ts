/**
 * Turn transcript compression using Node 24 native zstd and brotli.
 * Writes are atomic: compress to temp file, then rename.
 */

import * as zlib from "node:zlib";
import { promisify } from "node:util";
import type { MemorySettings } from "./turn-transcript-types";

// ── Promisified compress/decompress ───────────────────────────────────

/**
 * Node 24+ guarantees zstd is available in node:zlib.
 * Using promisify to convert callback APIs to Promise-based.
 */
const zstdCompressAsync = promisify(zlib.zstdCompress) as (buffer: Buffer, level: number) => Promise<Buffer>;
const zstdDecompressAsync = promisify(zlib.zstdDecompress) as (buffer: Buffer) => Promise<Buffer>;
const brotliCompressAsync = promisify(zlib.brotliCompress) as (
  buffer: Buffer,
  options: zlib.BrotliOptions
) => Promise<Buffer>;
const brotliDecompressAsync = promisify(zlib.brotliDecompress) as (buffer: Buffer) => Promise<Buffer>;

// ── Compression ───────────────────────────────────────────────────────

export type CompressResult = {
  buffer: Buffer;
  algorithm: "zstd" | "brotli";
};

/**
 * Compress a JSON-serialised turn transcript.
 * Respects settings.compression preference.
 * zstd: level 1–22, brotli: quality 0–11.
 */
export async function compressTurn(jsonString: string, settings: MemorySettings): Promise<CompressResult> {
  const buffer = Buffer.from(jsonString, "utf8");
  const preferred: "zstd" | "brotli" = settings.compression;

  if (preferred === "zstd") {
    const level = Math.min(22, Math.max(1, settings.compressionLevel));
    const compressed = await zstdCompressAsync(buffer, level);
    return { buffer: compressed, algorithm: "zstd" };
  }

  const quality = Math.min(11, Math.max(0, settings.compressionLevel));
  const compressed = await brotliCompressAsync(buffer, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality },
  });
  return { buffer: compressed, algorithm: "brotli" };
}

/**
 * Decompress a turn transcript buffer using the specified algorithm.
 */
export async function decompressTurn(buffer: Buffer, algorithm: "zstd" | "brotli"): Promise<string> {
  if (algorithm === "zstd") {
    const decompressed = await zstdDecompressAsync(buffer);
    return decompressed.toString("utf8");
  }

  const decompressed = await brotliDecompressAsync(buffer);
  return decompressed.toString("utf8");
}

// ── File extensions ───────────────────────────────────────────────────

export function extensionForAlgorithm(algorithm: "zstd" | "brotli"): string {
  return algorithm === "zstd" ? ".dctz" : ".dctb";
}

// ── Atomic file write (delegates to shared implementation) ──────────────

export { atomicWriteFile as atomicWrite, atomicWriteJsonFile as atomicWriteJson } from "../common/file-utils";
