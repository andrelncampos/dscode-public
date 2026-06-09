import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { LlmStreamProgress } from "../../session";
import { STREAMING_BAR_MIN_WIDTH, STREAMING_BAR_MAX_WIDTH, STREAMING_DONE_DISPLAY_MS } from "../core/layout-constants";

type StreamingIndicatorProps = {
  progress: LlmStreamProgress | null;
  now: number;
  width?: number;
  modelName?: string;
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const StreamingIndicator = React.memo(function StreamingIndicator({
  progress,
  now,
  width = 80,
  modelName,
}: StreamingIndicatorProps): React.ReactElement {
  const [doneVisible, setDoneVisible] = useState(false);
  const [doneInfo, setDoneInfo] = useState<{ tokens: string; seconds: number } | null>(null);

  useEffect(() => {
    if (progress?.phase === "end") {
      const tokens = progress.formattedTokens || "0";
      const startedAt = Date.parse(progress.startedAt);
      const seconds = Number.isNaN(startedAt) ? 0 : Math.round((now - startedAt) / 1000);
      setDoneInfo({ tokens, seconds });
      setDoneVisible(true);
      const timer = setTimeout(() => setDoneVisible(false), STREAMING_DONE_DISPLAY_MS);
      return () => clearTimeout(timer);
    }
    setDoneVisible(false);
    setDoneInfo(null);
  }, [progress, now]);

  if (!progress) {
    return (
      <Box>
        <Text dimColor>{modelName ? `${modelName} thinking...` : "Thinking..."}</Text>
      </Box>
    );
  }

  if (doneVisible && doneInfo) {
    return (
      <Box>
        <Text color="#229ac3">✓ Done</Text>
        <Text dimColor>{` · ${doneInfo.tokens} tokens · ${doneInfo.seconds}s`}</Text>
      </Box>
    );
  }

  const startedAt = Date.parse(progress.startedAt);
  const elapsedMs = Number.isNaN(startedAt) ? 0 : Math.max(0, now - startedAt);
  const elapsedSeconds = Math.max(0.1, elapsedMs / 1000);
  const tokensPerSecond = Math.round(progress.estimatedTokens / elapsedSeconds);
  const formattedTokens = progress.formattedTokens || "0";

  // Heuristic: model total as current + 4096 so the ratio asymptotically
  // approaches 100% as tokens accumulate, rather than being stuck at 33%.
  const estimatedTotal = progress.estimatedTokens + 4096;
  const ratio = Math.min(1, progress.estimatedTokens / estimatedTotal);
  const barWidth = Math.max(STREAMING_BAR_MIN_WIDTH, Math.min(STREAMING_BAR_MAX_WIDTH, width - 45));
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;

  const spinner = SPINNER_FRAMES[Math.floor(now / 80) % SPINNER_FRAMES.length];
  const modelPrefix = modelName ? `${modelName} ` : "";
  const elapsedDisplay =
    elapsedMs < 3000
      ? `${spinner} ${modelPrefix}thinking...`
      : `${spinner} ${modelPrefix}thinking... (${Math.floor(elapsedSeconds)}s)`;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="#229ac3">{elapsedDisplay}</Text>
        <Text dimColor> · </Text>
        <Text color="yellow">{`↓ ${formattedTokens} tokens`}</Text>
        {tokensPerSecond > 0 && (
          <>
            <Text dimColor> · </Text>
            <Text dimColor>{`${tokensPerSecond} tok/s`}</Text>
          </>
        )}
      </Box>
      <Box>
        <Text dimColor>[</Text>
        <Text color="#229ac3">{"█".repeat(filled)}</Text>
        <Text dimColor>{"░".repeat(empty)}</Text>
        <Text dimColor>{`] ${Math.round(ratio * 100)}%`}</Text>
      </Box>
    </Box>
  );
});

export default StreamingIndicator;
