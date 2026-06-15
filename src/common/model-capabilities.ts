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
  "claude-opus-4-8": { inputPrice: 5.0, outputPrice: 25.0, cacheReadPrice: 0.5 },
  "claude-sonnet-4-6": { inputPrice: 3.0, outputPrice: 15.0, cacheReadPrice: 0.3 },
  "claude-haiku-4-5": { inputPrice: 1.0, outputPrice: 5.0, cacheReadPrice: 0.1 },
  "claude-fable-5": { inputPrice: 10.0, outputPrice: 50.0, cacheReadPrice: 1.0 },
  "claude-mythos-5": { inputPrice: 10.0, outputPrice: 50.0, cacheReadPrice: 1.0 },
  "gpt-5.5": { inputPrice: 5.0, outputPrice: 30.0, cacheReadPrice: 0.5 },
  "gpt-5.4": { inputPrice: 2.5, outputPrice: 15.0, cacheReadPrice: 0.25 },
  // gpt-5.4 Standard long context (>272k input tokens): 2× input/1.5× output
  "gpt-5.4-long": { inputPrice: 5.0, outputPrice: 22.5, cacheReadPrice: 0.5 },
  "gpt-5.4-mini": { inputPrice: 0.75, outputPrice: 4.5, cacheReadPrice: 0.075 },
  "gpt-5.4-nano": { inputPrice: 0.2, outputPrice: 1.25, cacheReadPrice: 0.02 },
  "gemini-3.5-flash": { inputPrice: 1.5, outputPrice: 9.0, cacheReadPrice: 0.15 },
  "gemini-3-flash": { inputPrice: 1.0, outputPrice: 6.0, cacheReadPrice: 0.1 },
  "gemini-3.1-flash-lite": { inputPrice: 0.25, outputPrice: 1.5, cacheReadPrice: 0.025 },
  // gemini-2.5-pro Standard ≤ 200k input tokens (default tier).
  // Above 200k: { inputPrice: 2.5, outputPrice: 15.0, cacheReadPrice: 0.25 }
  "gemini-2.5-pro": { inputPrice: 1.25, outputPrice: 10.0, cacheReadPrice: 0.125 },
  "gemini-2.5-flash": { inputPrice: 0.3, outputPrice: 2.5, cacheReadPrice: 0.03 },
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
      usage.cache_read_input_tokens ??
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
