import { useEffect, useRef } from "react";
import type { SessionMessage } from "../../session";
import { RawMode } from "../contexts/RawModeContext";
import { ANSI_CLEAR_SCREEN } from "../constants";
import { renderRawModeMessages } from "../utils";

export type ResizeHandlerOptions = {
  columns: number;
  stdout: NodeJS.WriteStream | undefined;
  mode: RawMode;
  busy: boolean;
  getActiveSessionId: () => string | null;
  loadVisibleMessages: (sessionId: string) => SessionMessage[];
  getCurrentMessages: () => SessionMessage[];
  setMessages: (value: SessionMessage[] | ((prev: SessionMessage[]) => SessionMessage[])) => void;
  setShowWelcome: (value: boolean | ((prev: boolean) => boolean)) => void;
  setWelcomeNonce: (value: number | ((prev: number) => number)) => void;
  write: (data: string) => void;
};

/**
 * Handles terminal resize events by clearing the screen and re-rendering messages.
 *
 * In Raw mode, clears screen and re-writes messages to stdout directly.
 * In Ink modes, resets the <Static> component via setMessages/setShowWelcome.
 * Skips the first resize (initial mount) to avoid unnecessary re-render.
 *
 * @param options - Terminal dimensions, mode, session access, and state setters
 * @sideEffects Writes ANSI escape codes, triggers React state updates, setTimeout
 */
export function useResizeHandler(options: ResizeHandlerOptions): void {
  const {
    columns,
    stdout,
    mode,
    busy,
    getActiveSessionId,
    loadVisibleMessages,
    getCurrentMessages,
    setMessages,
    setShowWelcome,
    setWelcomeNonce,
    write,
  } = options;

  const lastRenderedColumnsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stdout?.isTTY) return;
    if (columns <= 0) return;

    if (lastRenderedColumnsRef.current === null) {
      lastRenderedColumnsRef.current = columns;
      return;
    }
    if (lastRenderedColumnsRef.current === columns) return;
    lastRenderedColumnsRef.current = columns;

    if (mode === RawMode.Raw) {
      process.stdout.write(ANSI_CLEAR_SCREEN);
      const activeSessionId = getActiveSessionId();
      const allMessages = activeSessionId ? loadVisibleMessages(activeSessionId) : [];
      renderRawModeMessages(allMessages, mode);
      return;
    }

    write("\u001B[2J\u001B[H");
    setMessages([]);
    setShowWelcome(false);
    setWelcomeNonce((n: number) => n + 1);

    const activeSessionId = getActiveSessionId();
    const nextMessages = activeSessionId && !busy ? loadVisibleMessages(activeSessionId) : getCurrentMessages();

    setTimeout(() => {
      setMessages(nextMessages);
      setShowWelcome(true);
    }, 0);
  }, [
    busy,
    mode,
    columns,
    stdout,
    getActiveSessionId,
    loadVisibleMessages,
    getCurrentMessages,
    setMessages,
    setShowWelcome,
    setWelcomeNonce,
    write,
  ]);
}
