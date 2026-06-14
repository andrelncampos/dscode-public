import React from "react";
import { Text, Box } from "ink";
import { computeSessionCost, formatCost, formatTokenCount } from "../../common/model-capabilities";
import type { ModelPricing } from "../../common/model-capabilities";
import type { ModelUsage } from "../../session";
import { computeCacheHitRate, computeCacheSavings, formatCacheMetrics } from "../../common/cache-metrics";
import { DEFAULT_MODEL_PRICING } from "../../common/model-capabilities";

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

function computeCacheLine(
  usagePerModel: Record<string, ModelUsage> | null,
  modelPricing?: Record<string, ModelPricing>
): string | null {
  if (!usagePerModel) return null;
  let totalHit = 0;
  let totalMiss = 0;
  const totalCached = 0;
  let hasAny = false;

  for (const [model, usage] of Object.entries(usagePerModel)) {
    if (typeof usage.normalizedCacheHitTokens === "number") {
      totalHit += usage.normalizedCacheHitTokens;
      totalMiss += usage.normalizedCacheMissTokens ?? 0;
      hasAny = true;
    }
  }

  if (!hasAny || totalHit === 0) return null;

  const hitRate = computeCacheHitRate(totalHit, totalMiss);
  if (hitRate === null) return null;

  // Use the first model's pricing for savings estimate (or default)
  let pricing = modelPricing?.[Object.keys(usagePerModel)[0]];
  if (!pricing) {
    pricing = DEFAULT_MODEL_PRICING[Object.keys(usagePerModel)[0]];
  }
  if (!pricing) return null;

  const savings = computeCacheSavings(totalHit, pricing);
  return formatCacheMetrics(hitRate, savings);
}

function computeTotalTokens(usagePerModel: Record<string, ModelUsage> | null): number | null {
  if (!usagePerModel) return null;
  let total = 0;
  for (const usage of Object.values(usagePerModel)) {
    total += usage.total_tokens;
  }
  return total > 0 ? total : null;
}
