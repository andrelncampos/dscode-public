import React from "react";
import { Text, Box } from "ink";
import { computeSessionCost, formatCost, formatTokenCount } from "../../common/model-capabilities";
import type { ModelPricing } from "../../common/model-capabilities";
import type { ModelUsage } from "../../session";
import { computeCacheLine } from "../../common/cache-metrics";

type SessionStatsHeaderProps = {
  /** Per-model usage accumulated in the active session. */
  usagePerModel: Record<string, ModelUsage> | null;
  /** Optional user-provided pricing overrides from settings. */
  modelPricing?: Record<string, ModelPricing>;
  /** Terminal width for right-alignment. */
  width: number;
};

/**
 * Stats header rendered at the top of the chat view, right-aligned.
 *
 * Shows total token count, estimated cost, and cache efficiency,
 * updated on every render.
 * Integrates cleanly with Ink's layout system using native flexbox,
 * avoiding fragile ANSI escape-code positioning.
 */
export function SessionStatsHeader({
  usagePerModel,
  modelPricing,
  width,
}: SessionStatsHeaderProps): React.ReactElement {
  const totalTokens = computeTotalTokens(usagePerModel);
  const cost = computeSessionCost(usagePerModel, modelPricing);

  // Always show token count; show cost only when pricing is available.
  const tokensText = `⚡ ${formatTokenCount(totalTokens ?? 0)}`;
  const costText = cost !== null ? `⏱️ ${formatCost(cost)}` : "";
  const statsLine = costText ? `${tokensText}  ${costText}` : tokensText;

  const cacheLine = computeCacheLine(usagePerModel, modelPricing);

  return (
    <Box width={width} flexDirection="column" alignItems="flex-end">
      <Text dimColor>{statsLine}</Text>
      {cacheLine && <Text dimColor>{cacheLine}</Text>}
    </Box>
  );
}

function computeTotalTokens(usagePerModel: Record<string, ModelUsage> | null): number | null {
  if (!usagePerModel) return null;
  let total = 0;
  for (const usage of Object.values(usagePerModel)) {
    total += usage.total_tokens;
  }
  return total > 0 ? total : null;
}
