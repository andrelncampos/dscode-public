/**
 * Turn transcript compression using Node 24 native zstd, with Brotli fallback.
 *
 * Writes are atomic: compress to temp file, then rename.
 */

import * as zlib from "node:zlib";
import type { MemorySettings } from "./turn-transcript-types";

// ── Zstd capability detection ─────────────────────────────────────────

type ZstdCompressFn = (buffer: Buffer, level: number) => Promise<Buffer>;
type ZstdDecompressFn = (buffer: Buffer) => Promise<Buffer>;

type ZstdCapableZlib = typeof zlib & {
  zstdCompress?: unknown;
  zstdDecompress?: unknown;
};

let zstdAvailable: boolean | null = null;
let zstdCompressFn: ZstdCompressFn | null = null;
let zstdDecompressFn: ZstdDecompressFn | null = null;

function detectZstd(): boolean {
  if (zstdAvailable !== null) return zstdAvailable;

  const candidate = zlib as ZstdCapableZlib;
  if (typeof candidate.zstdCompress === "function" && typeof candidate.zstdDecompress === "function") {
    zstdCompressFn = async (buffer: Buffer, level: number): Promise<Buffer> => {
      return new Promise((resolve, reject) => {
        (
          candidate.zstdCompress as (
            buf: Buffer,
            level: number,
            cb: (err: Error | null, result: Buffer) => void
          ) => void
        )(buffer, level, (err: Error | null, result: Buffer) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    };

    zstdDecompressFn = async (buffer: Buffer): Promise<Buffer> => {
      return new Promise((resolve, reject) => {
        (candidate.zstdDecompress as (buf: Buffer, cb: (err: Error | null, result: Buffer) => void) => void)(
          buffer,
          (err: Error | null, result: Buffer) => {
            if (err) reject(err);
            else resolve(result);
          }
        );
      });
    };

    zstdAvailable = true;
  } else {
    zstdAvailable = false;
  }

  return zstdAvailable;
}

// ── Compression ───────────────────────────────────────────────────────

export type CompressResult = {
  buffer: Buffer;
  algorithm: "zstd" | "brotli";
};

/**
 * Compress a JSON-serialised turn transcript.
 * Respects settings.compression preference; falls back to the other algorithm
 * when the preferred one is not available.
 */
export async function compressTurn(jsonString: string, settings: MemorySettings): Promise<CompressResult> {
  const buffer = Buffer.from(jsonString, "utf8");
  const preferred: "zstd" | "brotli" = settings.compression;
  // Clamp level to the supported range for each algorithm.
  // zstd: 1–22, brotli: 0–11.
  const level = settings.compressionLevel;
  const zstdLevel = Math.min(22, Math.max(1, level));
  const brotliLevel = Math.min(11, Math.max(0, level));

  // Try the preferred algorithm first
  if (preferred === "zstd") {
    if (detectZstd() && zstdCompressFn !== null) {
      const compressed = await zstdCompressFn(buffer, zstdLevel);
      return { buffer: compressed, algorithm: "zstd" };
    }
    // zstd preferred but unavailable — fallback to brotli
    const compressed = await brotliCompressBuffer(buffer, brotliLevel);
    return { buffer: compressed, algorithm: "brotli" };
  }

  // Preferred is brotli
  const compressed = await brotliCompressBuffer(buffer, brotliLevel);
  return { buffer: compressed, algorithm: "brotli" };
}

async function brotliCompressBuffer(buffer: Buffer, level: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    zlib.brotliCompress(
      buffer,
      { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level } },
      (err: Error | null, result: Buffer) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
  });
}

/**
 * Decompress a turn transcript buffer using the specified algorithm.
 * Falls back to brotli if zstd is unavailable on the current Node version.
 */
export async function decompressTurn(buffer: Buffer, algorithm: "zstd" | "brotli"): Promise<string> {
  // If the file claims zstd but the runtime has no zstd support, try brotli.
  if (algorithm === "zstd" && (!detectZstd() || zstdDecompressFn === null)) {
    try {
      return await decompressBrotli(buffer);
    } catch {
      // The data is zstd, not brotli — brotli decompression will naturally fail.
      // Re-throw so the caller can log and skip gracefully.
      throw new Error(
        "Turn file requires zstd decompression but zstd is not available on this Node version. " +
          "Upgrade to Node 24+ or install a zstd binding."
      );
    }
  }

  if (algorithm === "zstd") {
    const decompressed = await zstdDecompressFn!(buffer);
    return decompressed.toString("utf8");
  }

  return decompressBrotli(buffer);
}

async function decompressBrotli(buffer: Buffer): Promise<string> {
  const decompressed = await new Promise<Buffer>((resolve, reject) => {
    zlib.brotliDecompress(buffer, (err: Error | null, result: Buffer) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
  return decompressed.toString("utf8");
}

// ── File extensions ───────────────────────────────────────────────────

export function extensionForAlgorithm(algorithm: "zstd" | "brotli"): string {
  return algorithm === "zstd" ? ".dctz" : ".dctb";
}

// ── Atomic file write (delegates to shared implementation) ──────────────

export { atomicWriteFile as atomicWrite, atomicWriteJsonFile as atomicWriteJson } from "../common/file-utils";
