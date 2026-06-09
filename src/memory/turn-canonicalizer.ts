/**
 * Deterministic turn text canonicalization.
 *
 * Cleans, normalises, and truncates text without semantic understanding.
 * Never rewrites meaning — only removes noise.
 */

import type { MemoryTurnLimits } from "./turn-transcript-types";

// ── ANSI escape code stripping ────────────────────────────────────────

// Matches CSI sequences: ESC [ ... m (SGR), ESC [ ... J, ESC [ ... K, etc.
const ANSI_CSI_PATTERN = /\x1b\[[\d;]*[A-Za-z]/g;
// Matches OSC sequences: ESC ] ... (BEL|ST)
const ANSI_OSC_PATTERN = /\x1b\].*?(?:\x07|\x1b\\)/g;
// Matches other escape-initiated sequences
const ANSI_OTHER_PATTERN = /\x1b[>=]/g;

/**
 * Strip ANSI escape codes (colours, cursor movement, etc.) from text.
 */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_CSI_PATTERN, "").replace(ANSI_OSC_PATTERN, "").replace(ANSI_OTHER_PATTERN, "");
}

// ── Spinner / progress bar cleanup ────────────────────────────────────

// Common spinner frames (braille, dots, lines, etc.)
const SPINNER_CHARS = new Set([
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
  "⣾",
  "⣽",
  "⣻",
  "⢿",
  "⡿",
  "⣟",
  "⣯",
  "⣷",
  "|",
  "/",
  "-",
  "\\",
  "▁",
  "▂",
  "▃",
  "▄",
  "▅",
  "▆",
  "▇",
  "█",
  "◐",
  "◓",
  "◑",
  "◒",
  "←",
  "↖",
  "↑",
  "↗",
  "→",
  "↘",
  "↓",
  "↙",
  "▉",
  "▊",
  "▋",
  "▌",
  "▍",
  "▎",
  "▏",
]);

/**
 * Remove a single spinner frame from line start.
 * Only removes if the entire line is just a spinner character.
 */
function removeSpinnerFrames(lines: string[]): string[] {
  return lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 1 && SPINNER_CHARS.has(trimmed)) {
      return "";
    }
    return line;
  });
}

// ── Whitespace normalization ──────────────────────────────────────────

/**
 * Normalise line endings to LF and strip trailing whitespace.
 */
export function normalizeLineEndings(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

/**
 * Collapse 3+ consecutive blank lines into exactly 1 blank line.
 */
export function collapseBlankLines(input: string): string {
  return input.replace(/\n{3,}/g, "\n\n");
}

// ── Deduplication ─────────────────────────────────────────────────────

/**
 * Deduplicate consecutive identical lines.
 * When a line repeats more than 2 times, keep first, last,
 * and insert a truncation marker in between.
 */
export function dedupeRepeatedLines(input: string): string {
  const lines = input.split("\n");
  if (lines.length < 3) return input;

  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const current = lines[i];
    let runEnd = i + 1;
    while (runEnd < lines.length && lines[runEnd] === current) {
      runEnd++;
    }
    const runLength = runEnd - i;

    if (runLength <= 2) {
      for (let j = 0; j < runLength; j++) {
        result.push(current);
      }
    } else {
      // Keep first, insert marker, keep last
      result.push(current);
      result.push(`[truncated: ${runLength - 2} repeated lines omitted]`);
      result.push(current);
    }

    i = runEnd;
  }

  return result.join("\n");
}

// ── Smart whitespace collapse ─────────────────────────────────────────

/**
 * Collapse multiple spaces in prose text but NOT inside code blocks,
 * stack traces, JSON, or YAML.
 *
 * Heuristic: lines that start with 2+ spaces, or contain patterns like
 * `{`, `[`, `(`, `at ` (stack trace), `│`, `└`, `├`, `║` are treated
 * as "code" and left alone.
 */
export function collapseProseWhitespace(input: string): string {
  const lines = input.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    if (isCodeLine(line)) {
      result.push(line);
    } else {
      // Collapse 2+ spaces into 1 in prose lines
      result.push(line.replace(/ {2,}/g, " "));
    }
  }

  return result.join("\n");
}

function isCodeLine(line: string): boolean {
  const trimmed = line.trimStart();
  // Lines that start with 2+ spaces are likely indented code
  if (line.startsWith("  ") || line.startsWith("\t")) return true;
  // Stack trace markers
  if (/^\s+at\s/.test(line)) return true;
  // Tree/box drawing characters
  if (/^[│└├║╠╚╔═─]+/.test(trimmed)) return true;
  // JSON-like structure
  if (/^[\s]*[{}[\]]/.test(trimmed)) return true;
  // YAML-like
  if (/^[\s]*[\w-]+:\s/.test(trimmed) && trimmed.length < 60) return true;
  return false;
}

// ── Truncation ────────────────────────────────────────────────────────

/**
 * Truncate text to maxChars, preserving head and tail.
 * Inserts explicit marker showing how many chars were omitted.
 */
export function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;

  const makeMarker = (omitted: number) => `\n[truncated: ${omitted} chars omitted]\n`;
  const minHeadForMarker = 40; // need enough context on both sides

  // Max marker overhead: Number.MAX_SAFE_INTEGER has 16 digits.
  // `\n[truncated: 9007199254740991 chars omitted]\n` = 45 chars.
  // Round up to 50 for safety.
  const MAX_MARKER_OVERHEAD = 50;

  if (maxChars < minHeadForMarker * 2 + MAX_MARKER_OVERHEAD) {
    // Too small for head+tail split — just take the head with a compact marker
    const compactMarker = "[...truncated]";
    const kept = maxChars - compactMarker.length;
    if (kept <= 0) return compactMarker.slice(0, maxChars);
    return input.slice(0, kept) + compactMarker;
  }

  // Reserve max marker space so the output never exceeds maxChars
  const available = maxChars - MAX_MARKER_OVERHEAD;
  const headSize = Math.floor(available * 0.5);
  const tailSize = available - headSize;
  const omitted = input.length - headSize - tailSize;

  return input.slice(0, headSize) + makeMarker(omitted) + input.slice(input.length - tailSize);
}

// ── Full canonicalization pipeline ────────────────────────────────────

export type CanonicalizeOptions = {
  stripAnsi: boolean;
  collapseWhitespace: boolean;
  dedupeRepeatedLines: boolean;
  limits: MemoryTurnLimits;
};

/**
 * Canonicalize a free-text field (user message, assistant response).
 */
export function canonicalizeText(input: string, maxChars: number, options: CanonicalizeOptions): string {
  let result = normalizeLineEndings(input);

  if (options.stripAnsi) {
    result = stripAnsi(result);
  }

  if (options.collapseWhitespace) {
    result = collapseProseWhitespace(result);
  }

  if (options.dedupeRepeatedLines) {
    result = dedupeRepeatedLines(result);
  }

  result = collapseBlankLines(result);
  result = result.trim();
  result = truncateText(result, maxChars);

  return result;
}

/**
 * Canonicalize stdout/stderr output from a shell command.
 */
export function canonicalizeShellOutput(input: string, maxChars: number, options: CanonicalizeOptions): string {
  let result = input;

  if (options.stripAnsi) {
    result = stripAnsi(result);
  }

  result = normalizeLineEndings(result);
  // Remove spinner-only lines
  const lines = result.split("\n");
  const cleaned = removeSpinnerFrames(lines);
  result = cleaned.join("\n");

  if (options.collapseWhitespace) {
    result = collapseProseWhitespace(result);
  }

  if (options.dedupeRepeatedLines) {
    result = dedupeRepeatedLines(result);
  }

  result = collapseBlankLines(result);
  result = result.trimEnd();
  result = truncateText(result, maxChars);

  return result;
}
