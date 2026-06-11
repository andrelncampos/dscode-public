import type { ModelUsage } from "../session";

// All currently supported DeepSeek V4+ models are multimodal (support image/vision inputs).
// If a future model is added that does NOT support vision, add it here.
const NON_MULTIMODAL_MODELS: Set<string> = new Set();

export function defaultsToThinkingMode(_model: string): boolean {
  return true;
}

/** Whether the model supports image (vision) inputs. */
export function isMultimodalModel(model: string): boolean {
  return !NON_MULTIMODAL_MODELS.has(model.trim());
}

// ── Model pricing (USD per 1M tokens) ──────────────────────────────

export type ModelPricing = {
  /** USD per 1M input tokens (non-cached). */
  inputPrice: number;
  /** USD per 1M output tokens. */
  outputPrice: number;
  /** USD per 1M cache-read input tokens. */
  cacheReadPrice: number;
};

/** Hardcoded defaults for supported models. Users can override via settings.json. */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  "deepseek-v4-pro": { inputPrice: 0.435, outputPrice: 0.87, cacheReadPrice: 0.003625 },
  "deepseek-v4-flash": { inputPrice: 0.14, outputPrice: 0.28, cacheReadPrice: 0.0028 },
  "claude-opus-4-8": { inputPrice: 15.0, outputPrice: 75.0, cacheReadPrice: 1.5 },
  "claude-sonnet-4-5": { inputPrice: 3.0, outputPrice: 15.0, cacheReadPrice: 0.3 },
  "claude-haiku-4-5": { inputPrice: 0.8, outputPrice: 4.0, cacheReadPrice: 0.08 },
};

/**
 * Compute estimated cost in USD for a usage record.
 * Accounts for cache-hit tokens when the API reports prompt_tokens_details.cached_tokens.
 */
export function computeUsageCost(usage: ModelUsage, pricing: ModelPricing): number {
  const cachedTokens = Math.max(
    0,
    (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ??
      usage.prompt_cache_hit_tokens ??
      0
  );
  const nonCachedInput = Math.max(0, usage.prompt_tokens - cachedTokens);
  const completionTokens = Math.max(0, usage.completion_tokens);
  return (
    (nonCachedInput / 1_000_000) * pricing.inputPrice +
    (completionTokens / 1_000_000) * pricing.outputPrice +
    (cachedTokens / 1_000_000) * pricing.cacheReadPrice
  );
}

/**
 * Aggregate cost across usage-per-model records, using best-available pricing.
 * Returns null if no usage data or no pricing for any model.
 */
export function computeSessionCost(
  usagePerModel: Record<string, ModelUsage> | null,
  pricingOverrides?: Record<string, ModelPricing>
): number | null {
  if (!usagePerModel) return null;
  let total = 0;
  let anyPriced = false;
  for (const [model, usage] of Object.entries(usagePerModel)) {
    const pricing = pricingOverrides?.[model] ?? DEFAULT_MODEL_PRICING[model];
    if (pricing) {
      total += computeUsageCost(usage, pricing);
      anyPriced = true;
    }
  }
  return anyPriced ? total : null;
}

/**
 * Format total tokens as a human-readable string (e.g., "42.3K", "1.2M").
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}

/**
 * Format USD cost as a human-readable string (e.g., "$0.42", "$0.0042", "$12.30").
 * Uses 4 decimal places for sub-cent values so the budget file round-trip is lossless.
 */
export function formatCost(cost: number): string {
  if (cost <= 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
