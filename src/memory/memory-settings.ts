import type { MemorySettings } from "./turn-transcript-types";

export const DEFAULT_RECENT_TURNS = 10;
export const DEFAULT_MAX_TURN_FILES = 500;
export const DEFAULT_MAX_CONTEXT_CHARS = 30000;
export const DEFAULT_MAX_USER_CHARS = 6000;
export const DEFAULT_MAX_ASSISTANT_CHARS = 8000;
export const DEFAULT_MAX_STDOUT_CHARS = 4000;
export const DEFAULT_MAX_STDERR_CHARS = 6000;
export const DEFAULT_MAX_DIFF_CHARS = 8000;
export const DEFAULT_COMPRESSION_ALGORITHM: "zstd" | "brotli" = "zstd";
export const DEFAULT_COMPRESSION_LEVEL = 10;

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  mode: "turn-transcript",
  recentTurns: DEFAULT_RECENT_TURNS,
  maxTurnFiles: DEFAULT_MAX_TURN_FILES,
  maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
  maxUserCharsPerTurn: DEFAULT_MAX_USER_CHARS,
  maxAssistantCharsPerTurn: DEFAULT_MAX_ASSISTANT_CHARS,
  maxStdoutCharsPerTurn: DEFAULT_MAX_STDOUT_CHARS,
  maxStderrCharsPerTurn: DEFAULT_MAX_STDERR_CHARS,
  maxDiffCharsPerTurn: DEFAULT_MAX_DIFF_CHARS,
  compression: DEFAULT_COMPRESSION_ALGORITHM,
  compressionLevel: DEFAULT_COMPRESSION_LEVEL,
  stripAnsi: true,
  collapseWhitespace: true,
  dedupeRepeatedLines: true,
  storeTurnTranscripts: true,
};

/**
 * Merge user-provided partial memory settings with defaults.
 * Accepts unknown keys from old config formats and normalises.
 */
export function resolveMemorySettings(overrides: Partial<MemorySettings> | undefined): MemorySettings {
  if (!overrides) {
    return { ...DEFAULT_MEMORY_SETTINGS };
  }

  return {
    enabled: typeof overrides.enabled === "boolean" ? overrides.enabled : DEFAULT_MEMORY_SETTINGS.enabled,
    mode: overrides.mode === "turn-transcript" ? overrides.mode : DEFAULT_MEMORY_SETTINGS.mode,
    recentTurns: validatePositiveInt(overrides.recentTurns, DEFAULT_RECENT_TURNS),
    maxTurnFiles: validatePositiveInt(overrides.maxTurnFiles, DEFAULT_MAX_TURN_FILES),
    maxContextChars: validatePositiveInt(overrides.maxContextChars, DEFAULT_MAX_CONTEXT_CHARS),
    maxUserCharsPerTurn: validatePositiveInt(overrides.maxUserCharsPerTurn, DEFAULT_MAX_USER_CHARS),
    maxAssistantCharsPerTurn: validatePositiveInt(overrides.maxAssistantCharsPerTurn, DEFAULT_MAX_ASSISTANT_CHARS),
    maxStdoutCharsPerTurn: validatePositiveInt(overrides.maxStdoutCharsPerTurn, DEFAULT_MAX_STDOUT_CHARS),
    maxStderrCharsPerTurn: validatePositiveInt(overrides.maxStderrCharsPerTurn, DEFAULT_MAX_STDERR_CHARS),
    maxDiffCharsPerTurn: validatePositiveInt(overrides.maxDiffCharsPerTurn, DEFAULT_MAX_DIFF_CHARS),
    compression:
      overrides.compression === "zstd" || overrides.compression === "brotli"
        ? overrides.compression
        : DEFAULT_MEMORY_SETTINGS.compression,
    compressionLevel: validateCompressionLevel(overrides.compressionLevel, DEFAULT_COMPRESSION_LEVEL),
    stripAnsi: typeof overrides.stripAnsi === "boolean" ? overrides.stripAnsi : DEFAULT_MEMORY_SETTINGS.stripAnsi,
    collapseWhitespace:
      typeof overrides.collapseWhitespace === "boolean"
        ? overrides.collapseWhitespace
        : DEFAULT_MEMORY_SETTINGS.collapseWhitespace,
    dedupeRepeatedLines:
      typeof overrides.dedupeRepeatedLines === "boolean"
        ? overrides.dedupeRepeatedLines
        : DEFAULT_MEMORY_SETTINGS.dedupeRepeatedLines,
    storeTurnTranscripts:
      typeof overrides.storeTurnTranscripts === "boolean"
        ? overrides.storeTurnTranscripts
        : DEFAULT_MEMORY_SETTINGS.storeTurnTranscripts,
  };
}

function validatePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.round(value);
  }
  return fallback;
}

function validateCompressionLevel(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    // zstd supports 1-22, brotli supports 0-11. Accept 0-22 here;
    // compressTurn clamps per-algorithm before passing to the compressor.
    if (rounded >= 0 && rounded <= 22) return rounded;
  }
  return fallback;
}
