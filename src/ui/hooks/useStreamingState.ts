import { useEffect, useMemo, useState } from "react";
import { buildLoadingText } from "../core/loading-text";
import type { LlmStreamProgress, SessionEntry } from "../../session";

export type StreamingState = {
  busy: boolean;
  setBusy: (value: boolean | ((prev: boolean) => boolean)) => void;
  streamProgress: LlmStreamProgress | null;
  setStreamProgress: (
    value: LlmStreamProgress | null | ((prev: LlmStreamProgress | null) => LlmStreamProgress | null)
  ) => void;
  runningProcesses: SessionEntry["processes"];
  setRunningProcesses: (
    value: SessionEntry["processes"] | ((prev: SessionEntry["processes"]) => SessionEntry["processes"])
  ) => void;
  nowTick: number;
  loadingText: string | null;
};

/**
 * Manages the streaming/loading lifecycle for LLM responses.
 *
 * Provides `busy` flag, streaming progress, running process tracking,
 * a periodic `nowTick` counter (updates every 500ms while busy), and
 * a derived `loadingText` string for the UI footer.
 *
 * @returns Streaming state and setters
 * @sideEffects Starts/stops a 500ms interval when busy changes
 */
export function useStreamingState(): StreamingState {
  const [busy, setBusy] = useState(false);
  const [streamProgress, setStreamProgress] = useState<LlmStreamProgress | null>(null);
  const [runningProcesses, setRunningProcesses] = useState<SessionEntry["processes"]>(null);
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    if (!busy) {
      return;
    }
    const id = setInterval(() => setNowTick((tick) => tick + 1), 500);
    return () => clearInterval(id);
  }, [busy]);

  const loadingText = useMemo(
    () => (busy ? buildLoadingText({ progress: streamProgress, processes: runningProcesses, now: Date.now() }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowTick forces periodic recalculation
    [busy, streamProgress, runningProcesses, nowTick]
  );

  return {
    busy,
    setBusy,
    streamProgress,
    setStreamProgress,
    runningProcesses,
    setRunningProcesses,
    nowTick,
    loadingText,
  };
}
