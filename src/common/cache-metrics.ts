import type { ModelUsage } from "../session";
import type { ModelPricing } from "./model-capabilities";
import { DEFAULT_MODEL_PRICING } from "./model-capabilities";

export type NormalizedCacheTokens = {
  /** Number of input tokens served from KV/prompt cache. */
  hit: number;
  /** Number of input tokens NOT served from cache. */
  miss: number;
};

/**
 * Extract normalized cache hit/miss tokens from raw ModelUsage provider-specific fields.
 * Handles DeepSeek (prompt_cache_hit_tokens), OpenAI (prompt_tokens_details.cached_tokens),
 * and Anthropic (cache_read_input_tokens) patterns.
 */
export function normalizeCacheTokens(usage: ModelUsage): NormalizedCacheTokens | null {
  let hit = 0;
  let miss = 0;

  // DeepSeek pattern: prompt_cache_hit_tokens
  if (typeof usage.prompt_cache_hit_tokens === "number") {
    hit = usage.prompt_cache_hit_tokens;
    miss =
      typeof usage.prompt_cache_miss_tokens === "number"
        ? usage.prompt_cache_miss_tokens
        : Math.max(0, usage.prompt_tokens - hit);
  }

  // OpenAI pattern: prompt_tokens_details.cached_tokens
  if (hit === 0) {
    const cached = (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens;
    if (typeof cached === "number" && cached > 0) {
      hit = cached;
      miss = Math.max(0, usage.prompt_tokens - hit);
    }
  }

  // Anthropic pattern: cache_read_input_tokens
  if (hit === 0) {
    if (typeof usage.cache_read_input_tokens === "number" && usage.cache_read_input_tokens > 0) {
      hit = usage.cache_read_input_tokens;
      miss = Math.max(0, usage.prompt_tokens - hit);
    }
  }

  // No cache data found
  if (hit === 0 && miss === 0) {
    // Distinguish "no cache data" from "0% efficiency" by checking if any cache field exists
    const hasCacheField =
      typeof usage.prompt_cache_hit_tokens === "number" ||
      typeof usage.prompt_cache_miss_tokens === "number" ||
      typeof (usage.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens === "number" ||
      typeof usage.cache_read_input_tokens === "number";
    if (!hasCacheField) {
      return null;
    }
  }

  // Clamp
  hit = Math.max(0, hit);
  miss = Math.max(0, miss);

  // Edge case: hit > prompt_tokens (API quirk)
  if (hit > usage.prompt_tokens) {
    hit = usage.prompt_tokens;
    miss = 0;
  }

  return { hit, miss };
}

/**
 * Compute cache hit rate percentage from normalized token counts.
 * Returns null when hit + miss === 0.
 */
export function computeCacheHitRate(hit: number, miss: number): number | null {
  const total = hit + miss;
  if (total === 0) return null;
  return (hit / total) * 100;
}

/**
 * Compute estimated USD saved by cache reads.
 * Savings = what cached tokens would have cost as uncached input minus what was actually paid as cache reads.
 */
export function computeCacheSavings(cachedTokens: number, pricing: ModelPricing): number {
  if (!pricing.cacheReadPrice || pricing.cacheReadPrice <= 0) return 0;
  const uncachedCost = (cachedTokens / 1_000_000) * pricing.inputPrice;
  const cachedCost = (cachedTokens / 1_000_000) * pricing.cacheReadPrice;
  return Math.max(0, uncachedCost - cachedCost);
}

/**
 * Format cache metrics into a compact display string.
 * Returns null when hitRate is null (no cache data).
 */
export function formatCacheMetrics(hitRate: number | null, savings: number): string | null {
  if (hitRate === null) return null;
  const rateStr = hitRate === 100 || hitRate === 0 ? `${Math.round(hitRate)}` : hitRate.toFixed(1);
  const savingsStr = savings < 0.01 && savings > 0 ? "<$0.01" : `$${savings.toFixed(2)}`;
  return `Cache: ${rateStr}% hit | saved ${savingsStr}`;
}

/**
 * Compute a compact cache display line from per-model usage and pricing.
 * Returns null when no cache data is present or hit rate === 0.
 */
export function computeCacheLine(
  usagePerModel: Record<string, ModelUsage> | null,
  modelPricing?: Record<string, ModelPricing>
): string | null {
  if (!usagePerModel) return null;
  let totalHit = 0;
  let totalMiss = 0;
  let hasAny = false;

  for (const usage of Object.values(usagePerModel)) {
    if (typeof usage.normalizedCacheHitTokens === "number") {
      totalHit += usage.normalizedCacheHitTokens;
      totalMiss += usage.normalizedCacheMissTokens ?? 0;
      hasAny = true;
    }
  }

  if (!hasAny || totalHit === 0) return null;

  const hitRate = computeCacheHitRate(totalHit, totalMiss);
  if (hitRate === null) return null;

  let pricing = modelPricing?.[Object.keys(usagePerModel)[0]];
  if (!pricing) {
    pricing = DEFAULT_MODEL_PRICING[Object.keys(usagePerModel)[0]];
  }
  if (!pricing) return null;

  const savings = computeCacheSavings(totalHit, pricing);
  return formatCacheMetrics(hitRate, savings);
}
