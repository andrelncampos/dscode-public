import React, { useCallback, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";

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

const ERROR_PATTERNS: Array<{ pattern: string; label: string; hint: string }> = [
  { pattern: "API key", label: "Authentication Error", hint: "Check your API key in settings.json" },
  { pattern: "401", label: "Authentication Error", hint: "Check your API key in settings.json" },
  { pattern: "timeout", label: "Timeout", hint: "The server took too long. Press Enter to retry." },
  { pattern: "timed out", label: "Timeout", hint: "The server took too long. Press Enter to retry." },
  { pattern: "ECONNREFUSED", label: "Connection Refused", hint: "Check your internet connection and base URL." },
  { pattern: "ENOTFOUND", label: "Network Error", hint: "Check your internet connection and base URL." },
  { pattern: "fetch failed", label: "Network Error", hint: "Check your internet connection and base URL." },
  { pattern: "aborted", label: "Cancelled", hint: "Request was cancelled. You can try again." },
  { pattern: "interrupted", label: "Cancelled", hint: "Request was cancelled. You can try again." },
  { pattern: "permission", label: "Permission Error", hint: "Check your permission settings with /permissions." },
];

export function classifyError(message: string): { label: string; hint: string } {
  const lower = message.toLowerCase();
  for (const { pattern, label, hint } of ERROR_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return { label, hint };
    }
  }
  return { label: "Error", hint: "Press Enter to continue." };
}

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
