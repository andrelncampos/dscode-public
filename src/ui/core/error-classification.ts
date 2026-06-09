export type ErrorClassification = {
  label: string;
  hint: string;
};

const ERROR_PATTERNS: ReadonlyArray<{ pattern: string; label: string; hint: string }> = [
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

export function classifyError(message: string): ErrorClassification {
  const lower = message.toLowerCase();
  for (const { pattern, label, hint } of ERROR_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return { label, hint };
    }
  }
  return { label: "Error", hint: "Press Enter to continue." };
}
