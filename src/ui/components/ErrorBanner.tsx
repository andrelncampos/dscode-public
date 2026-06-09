import React, { useCallback, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { classifyError } from "../core/error-classification";

export type ErrorSeverity = "error" | "warning";

export type ErrorBannerProps = {
  message: string;
  severity?: ErrorSeverity;
  actionHint?: string;
  dismissable?: boolean;
  onDismiss?: () => void;
  maxWidth?: number;
  autoDismiss?: boolean;
  autoDismissMs?: number;
};

function wrapText(text: string, maxWidth: number): string[] {
  if (!text.trim()) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth) {
      if (current) lines.push(current.trimEnd());
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

const ErrorBanner = React.memo(function ErrorBanner({
  message,
  severity = "error",
  actionHint: actionHintProp,
  dismissable = false,
  onDismiss,
  maxWidth = 80,
  autoDismiss = false,
  autoDismissMs = 8000,
}: ErrorBannerProps): React.ReactElement | null {
  const color = severity === "error" ? "red" : "yellow";
  const icon = severity === "error" ? "✖" : "⚠";
  const classified = useMemo(() => classifyError(message), [message]);
  const hint = actionHintProp ?? classified.hint;
  const headerText = `${icon} ${classified.label}`;
  const innerWidth = Math.max(20, maxWidth - 4);

  // Truncate absurdly long messages
  const displayMessage = message.length > 500 ? message.slice(0, 497) + "..." : message;
  const messageLines = wrapText(displayMessage, innerWidth - 2);
  // Cap at 6 visible lines to avoid pushing prompt off screen
  const visibleLines = messageLines.slice(0, 6);

  // Auto-dismiss
  useEffect(() => {
    if (!autoDismiss || !onDismiss) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismiss, autoDismissMs, onDismiss]);

  // Keyboard dismiss
  useInput(
    useCallback(
      (_input, key) => {
        if (dismissable && onDismiss && (key.return || key.escape)) {
          onDismiss();
        }
      },
      [dismissable, onDismiss]
    )
  );

  if (!message) return null;

  const sepLine = `│${" ".repeat(innerWidth)}│`;
  const footerGap = Math.max(0, innerWidth - hint.length - 2 - (dismissable ? 10 : 0));

  return (
    <Box flexDirection="column" marginY={1}>
      <Box borderStyle="round" borderColor={color} flexDirection="column" paddingX={1} width={maxWidth}>
        {/* Header */}
        <Box>
          <Text bold color={color}>
            {headerText}
          </Text>
        </Box>

        {/* Separator */}
        <Text color={color}>{sepLine}</Text>

        {/* Message */}
        {visibleLines.map((line, i) => (
          <Text key={i} color={color}>
            {"  "}
            <Text dimColor>{line}</Text>
          </Text>
        ))}
        {messageLines.length > 6 && (
          <Text color={color}>
            {"  "}
            <Text dimColor>...(truncated, {messageLines.length - 6} more lines)</Text>
          </Text>
        )}

        {/* Separator */}
        <Text color={color}>{sepLine}</Text>

        {/* Footer */}
        <Box>
          <Text dimColor>{hint}</Text>
          {" ".repeat(footerGap)}
          {dismissable && <Text dimColor>[Dismiss]</Text>}
        </Box>
      </Box>
    </Box>
  );
});

export default ErrorBanner;
