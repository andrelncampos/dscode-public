// ── Scope Label Formatting ──────────────────────────────────────────────

export function formatScopeLabel(scope?: { kind: string; label: string }): string {
  if (!scope) return "";
  if (scope.kind === "skill" || scope.kind === "spec") {
    return `[${scope.label}]`;
  }
  return `[${scope.kind}]`;
}

export function getScopeColor(kind: string): string {
  switch (kind) {
    case "global":
      return "blue";
    case "project":
      return "cyan";
    case "session":
      return "yellow";
    case "skill":
      return "green";
    case "spec":
      return "magenta";
    case "legacy":
      return "gray";
    default:
      return "gray";
  }
}

// ── Policy Stats Formatting ──────────────────────────────────────────────

export function formatPolicyStats(stats?: { allowed: number; total: number }): string {
  if (!stats || stats.total === 0) return "";
  return `(${stats.allowed}/${stats.total})`;
}

export function getPolicyStatsColor(stats?: { allowed: number; total: number }): string | undefined {
  if (!stats || stats.total === 0) return undefined;
  if (stats.allowed === stats.total) return "green";
  if (stats.allowed === 0) return "red";
  return "yellow";
}

// ── Timestamp Formatting ─────────────────────────────────────────────────

export function formatRelativeTime(timestamp: number, now: number): string {
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

// ── Truncation ───────────────────────────────────────────────────────────

export function truncateToolDescription(description?: string, maxLen = 80): string {
  if (!description) return "No description";
  if (description.length <= maxLen) return description;
  return description.slice(0, maxLen - 1) + "…";
}

export function truncateOutputSnippet(output: string, maxLen = 100): string {
  if (!output) return "(empty)";
  if (output.length <= maxLen) return output;
  return output.slice(0, maxLen - 1) + "…";
}
