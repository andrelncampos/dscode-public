import { useLayoutEffect, useRef } from "react";
import type { PromptBufferState } from "../core/prompt-buffer";

type CursorPlacement = {
  rowsUp: number;
  column: number;
};

type WriteFn = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
  callback?: (error?: Error | null) => void
) => boolean;

function cursorUp(rows: number): string {
  return rows > 0 ? `\u001B[${rows}A` : "";
}

function cursorDown(rows: number): string {
  return rows > 0 ? `\u001B[${rows}B` : "";
}

function cursorForward(columns: number): string {
  return columns > 0 ? `\u001B[${columns}C` : "";
}

function showCursor(): string {
  return "\u001B[?25h";
}

function hideCursor(): string {
  return "\u001B[?25l";
}

function enableTerminalFocusReporting(): string {
  return "\u001B[?1004h";
}

function disableTerminalFocusReporting(): string {
  return "\u001B[?1004l";
}

function enableBracketedPaste(): string {
  return "\u001B[?2004h";
}

function disableBracketedPaste(): string {
  return "\u001B[?2004l";
}

export function enableTerminalExtendedKeys(): string {
  // Level 2 (;2) reports all keys with modifiers (Shift, Ctrl, Alt, Meta),
  // including Shift+Enter. Level 1 (;1) only reports a subset and may not
  // include Shift+Enter on some terminals.
  return "\u001B[>4;2m";
}

export function disableTerminalExtendedKeys(): string {
  return "\u001B[>4;0m";
}

export function getPromptCursorPlacement(
  state: PromptBufferState,
  screenWidth: number,
  prefixWidth: number,
  footerText: string
): CursorPlacement {
  const width = Math.max(1, screenWidth);
  const cursor = Math.max(0, Math.min(state.cursor, state.text.length));
  const beforeCursor = state.text.slice(0, cursor);
  const at = state.text[cursor];
  const displayText =
    beforeCursor +
    (typeof at === "undefined" || at === "\n" ? " " : at) +
    (at === "\n" ? "\n" : "") +
    (typeof at === "undefined" ? "" : state.text.slice(cursor + 1));

  const cursorPosition = measureTextPosition(beforeCursor, width, prefixWidth);
  const promptRows = measureTextRows(displayText, width, prefixWidth);
  const footerRows = 1 + measureTextRows(footerText, width, 0);

  return {
    rowsUp: promptRows - 1 - cursorPosition.row + footerRows + 1,
    column: cursorPosition.column,
  };
}

function measureTextRows(text: string, width: number, initialColumn: number): number {
  return measureTextPosition(text, width, initialColumn).row + 1;
}

function measureTextPosition(text: string, width: number, initialColumn: number): { row: number; column: number } {
  let row = 0;
  let column = Math.min(initialColumn, width - 1);

  for (const char of Array.from(text)) {
    if (char === "\n") {
      row++;
      column = initialColumn; // new line stays indented (Ink flex layout keeps text at prefix offset)
      continue;
    }

    const charColumns = textWidth(char);
    if (column + charColumns > width) {
      row++;
      column = initialColumn; // wrapped line stays indented (Ink flex child position)
    }
    column += charColumns;
    if (column >= width) {
      row++;
      column = initialColumn; // wrapped line stays indented
    }
  }

  return { row, column };
}

/**
 * ANSI escape sequence regex — matches CSI, OSC, and other escape codes.
 * Used to skip zero-width control sequences when measuring / wrapping text.
 */
const ANSI_ESCAPE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

/**
 * Insert explicit newlines at calculated wrap points so that Ink never
 * needs to soft-wrap the text.  This keeps the rendered layout in sync
 * with {@link measureTextPosition}, fixing the known Ink + Yoga bug where
 * soft-wrapping produces cursor-column offsets that accumulate per line.
 *
 * ANSI escape sequences are treated as zero-width and preserved intact.
 */
export function hardWrapText(text: string, width: number, initialColumn: number): string {
  let result = "";
  let column = Math.min(initialColumn, width - 1);
  let i = 0;

  while (i < text.length) {
    // Skip ANSI escape sequences (zero visible width).
    ANSI_ESCAPE_REGEX.lastIndex = i;
    const esc = ANSI_ESCAPE_REGEX.exec(text);
    if (esc && esc.index === i) {
      result += esc[0];
      i += esc[0].length;
      continue;
    }

    const char = text[i]!;

    // Preserve existing hard newlines.
    if (char === "\n") {
      result += "\n";
      column = initialColumn;
      i++;
      continue;
    }

    const cw = characterWidth(char);
    if (column + cw > width) {
      result += "\n";
      column = initialColumn;
    }
    result += char;
    column += cw;
    if (column >= width) {
      result += "\n";
      column = initialColumn;
    }
    i++;
  }

  return result;
}

function textWidth(value: string): number {
  let width = 0;
  for (const char of Array.from(value.normalize())) {
    width += characterWidth(char);
  }
  return width;
}

function characterWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }
  if (codePoint >= 0x300 && codePoint <= 0x36f) {
    return 0;
  }
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  ) {
    return 2;
  }
  return 1;
}

export function usePromptTerminalCursor(
  stdout: NodeJS.WriteStream | undefined,
  placement: CursorPlacement,
  isActive: boolean
): void {
  const directWriteRef = useRef<((data: string) => void) | null>(null);
  const activePlacementRef = useRef<CursorPlacement | null>(null);
  const lastPlacementRef = useRef<CursorPlacement | null>(null);
  const unmountingRef = useRef(false);

  useLayoutEffect(() => {
    if (!stdout?.isTTY) {
      return;
    }

    const stream = stdout as NodeJS.WriteStream & { write: WriteFn };
    const originalWrite = stream.write;
    const directWrite = (data: string) => {
      originalWrite.call(stdout, data);
    };
    const restorePromptCursor = () => {
      if (unmountingRef.current) {
        return;
      }
      const activePlacement = activePlacementRef.current;
      if (!activePlacement) {
        return;
      }
      directWrite("\r" + cursorDown(activePlacement.rowsUp) + hideCursor());
      activePlacementRef.current = null;
      // Schedule a deferred re-position in case the layout effect does not
      // re-run (e.g. a dropdown closed without changing the buffer).
      Promise.resolve().then(() => {
        if (unmountingRef.current || activePlacementRef.current) {
          return;
        }
        const latest = directWriteRef.current;
        const p = lastPlacementRef.current;
        if (latest && p) {
          latest(showCursor() + cursorUp(p.rowsUp) + "\r" + cursorForward(p.column));
          activePlacementRef.current = p;
        }
      });
    };
    const patchedWrite: WriteFn = (...args) => {
      restorePromptCursor();
      return originalWrite.apply(stdout, args);
    };

    directWriteRef.current = directWrite;
    stream.write = patchedWrite;

    return () => {
      restorePromptCursor();
      stream.write = originalWrite;
      directWriteRef.current = null;
    };
  }, [stdout]);

  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    unmountingRef.current = false;
    const directWrite = directWriteRef.current;
    if (!directWrite) {
      return;
    }

    directWrite(showCursor() + cursorUp(placement.rowsUp) + "\r" + cursorForward(placement.column));
    activePlacementRef.current = placement;
    lastPlacementRef.current = placement;

    return () => {
      unmountingRef.current = true;
      lastPlacementRef.current = null;
      const activePlacement = activePlacementRef.current;
      if (!activePlacement) {
        return;
      }
      directWrite("\r" + cursorDown(activePlacement.rowsUp) + hideCursor());
      activePlacementRef.current = null;
    };
  }, [isActive, placement, stdout]);
}

export function useHiddenTerminalCursor(stdout: NodeJS.WriteStream | undefined, isActive: boolean): void {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    stdout.write(hideCursor());
    return () => {
      stdout.write(showCursor());
    };
  }, [isActive, stdout]);
}

export function useTerminalFocusReporting(stdout: NodeJS.WriteStream | undefined, isActive: boolean): void {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    stdout.write(enableTerminalFocusReporting());
    return () => {
      stdout.write(disableTerminalFocusReporting());
    };
  }, [isActive, stdout]);
}

export function useTerminalExtendedKeys(stdout: NodeJS.WriteStream | undefined, isActive: boolean): void {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    // Allow users to disable extended keys via environment variable.
    if (process.env.DSCODE_DISABLE_EXTENDED_KEYS === "1") {
      return;
    }

    const seq = enableTerminalExtendedKeys();
    stdout.write(seq);
    return () => {
      const dis = disableTerminalExtendedKeys();
      stdout.write(dis);
    };
  }, [isActive, stdout]);
}

export function useBracketedPaste(stdout: NodeJS.WriteStream | undefined, isActive: boolean): void {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }

    stdout.write(enableBracketedPaste());
    return () => {
      stdout.write(disableBracketedPaste());
    };
  }, [isActive, stdout]);
}
