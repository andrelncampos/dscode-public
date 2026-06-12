export type ErrorClassification = {
  labelKey: string;
  hintKey: string;
};

const ERROR_PATTERNS: ReadonlyArray<{ pattern: string; labelKey: string; hintKey: string }> = [
  { pattern: "API key", labelKey: "error.auth-label", hintKey: "error.auth-hint" },
  { pattern: "401", labelKey: "error.auth-label", hintKey: "error.auth-hint" },
  { pattern: "timeout", labelKey: "error.timeout-label", hintKey: "error.timeout-hint" },
  { pattern: "timed out", labelKey: "error.timeout-label", hintKey: "error.timeout-hint" },
  { pattern: "ECONNREFUSED", labelKey: "error.connection-refused-label", hintKey: "error.connection-refused-hint" },
  { pattern: "ENOTFOUND", labelKey: "error.network-label", hintKey: "error.network-hint" },
  { pattern: "fetch failed", labelKey: "error.network-label", hintKey: "error.network-hint" },
  { pattern: "aborted", labelKey: "error.cancelled-label", hintKey: "error.cancelled-hint" },
  { pattern: "interrupted", labelKey: "error.cancelled-label", hintKey: "error.cancelled-hint" },
  { pattern: "permission", labelKey: "error.permission-label", hintKey: "error.permission-hint" },
];

export function classifyError(message: string): ErrorClassification {
  const lower = message.toLowerCase();
  for (const { pattern, labelKey, hintKey } of ERROR_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return { labelKey, hintKey };
    }
  }
  return { labelKey: "error.generic-label", hintKey: "error.generic-hint" };
}
