import React from "react";
import { Box, Text } from "ink";
import type { LlmStreamProgress } from "../../session";
import { StreamingIndicator } from "./StreamingIndicator";

type StatusHeaderProps = {
  statsLine: string;
  lastBashCommand: string | null;
  modelName: string;
  /** Free-form status message (e.g. "Permission denied…"). Shown prominently above stats. */
  statusMessage: string | null;
  busy: boolean;
  streamProgress: LlmStreamProgress | null;
  nowTick: number;
  screenWidth: number;
};

const SEPARATOR = "•";

/**
 * Truncates a command string to fit within maxLen by keeping the
 * first third and last third, replacing the middle with "…".
 */
function truncateCommand(command: string, maxLen: number): string {
  if (command.length <= maxLen) {
    return command;
  }
  const third = Math.floor((maxLen - 1) / 3);
  const start = command.slice(0, third);
  const end = command.slice(command.length - third);
  return `${start}…${end}`;
}

export const StatusHeader = React.memo(function StatusHeader({
  statsLine,
  lastBashCommand,
  modelName,
  statusMessage,
  busy,
  streamProgress,
  nowTick,
  screenWidth,
}: StatusHeaderProps): React.ReactElement | null {
  // Show streaming indicator when busy and we have progress data
  if (busy && streamProgress) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>{SEPARATOR}</Text>
        </Box>
        <StreamingIndicator progress={streamProgress} now={nowTick} width={screenWidth} modelName={modelName} />
      </Box>
    );
  }

  // Nothing to show if no data at all
  if (!statsLine && !lastBashCommand && !statusMessage) {
    return null;
  }

  const showSeparator =
    statsLine.length > 0 || (lastBashCommand && lastBashCommand.length > 0) || Boolean(statusMessage);

  return (
    <Box flexDirection="column">
      {showSeparator ? (
        <Box>
          <Text dimColor>{SEPARATOR}</Text>
        </Box>
      ) : null}
      {/* Status message (e.g. "Permission denied…") */}
      {statusMessage ? (
        <Box>
          <Text color="yellow">{statusMessage}</Text>
        </Box>
      ) : null}
      {/* Line: model · tokens · cost */}
      {statsLine ? (
        <Box justifyContent="space-between" width={screenWidth}>
          <Box flexShrink={1}>
            <Text color="magenta" wrap="truncate-end">
              {modelName}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text dimColor>{statsLine}</Text>
          </Box>
        </Box>
      ) : null}
      {/* Line: last bash command (truncated) */}
      {lastBashCommand ? (
        <Box>
          <Text color="yellow">$ </Text>
          <Text dimColor>{truncateCommand(lastBashCommand, screenWidth - 10)}</Text>
        </Box>
      ) : null}
    </Box>
  );
});
