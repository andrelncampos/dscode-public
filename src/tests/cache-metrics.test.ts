import assert from "node:assert";
import { describe, test } from "node:test";
import {
  normalizeCacheTokens,
  computeCacheHitRate,
  computeCacheSavings,
  formatCacheMetrics,
} from "../common/cache-metrics";
import type { ModelUsage } from "../session";
import type { ModelPricing } from "../common/model-capabilities";

describe("normalizeCacheTokens", () => {
  test("with prompt_cache_hit_tokens (DeepSeek pattern)", () => {
    const usage: ModelUsage = {
      prompt_tokens: 10000,
      completion_tokens: 1000,
      total_tokens: 11000,
      prompt_cache_hit_tokens: 4500,
      prompt_cache_miss_tokens: 5500,
    };
    const result = normalizeCacheTokens(usage);
    assert.ok(result);
    assert.equal(result.hit, 4500);
    assert.equal(result.miss, 5500);
  });

  test("with prompt_cache_hit_tokens, no miss field (DeepSeek variant)", () => {
    const usage: ModelUsage = {
      prompt_tokens: 10000,
      completion_tokens: 1000,
      total_tokens: 11000,
      prompt_cache_hit_tokens: 4500,
    };
    const result = normalizeCacheTokens(usage);
    assert.ok(result);
    assert.equal(result.hit, 4500);
    assert.equal(result.miss, 5500); // derived: 10000 - 4500
  });

  test("with prompt_tokens_details.cached_tokens (OpenAI pattern)", () => {
    const usage: ModelUsage = {
      prompt_tokens: 10000,
      completion_tokens: 1000,
      total_tokens: 11000,
      prompt_tokens_details: { cached_tokens: 7000 },
    };
    const result = normalizeCacheTokens(usage);
    assert.ok(result);
    assert.equal(result.hit, 7000);
    assert.equal(result.miss, 3000);
  });

  test("with cache_read_input_tokens (Anthropic pattern)", () => {
    const usage = {
      prompt_tokens: 10000,
      completion_tokens: 1000,
      total_tokens: 11000,
      cache_read_input_tokens: 6000,
    } as unknown as ModelUsage;
    const result = normalizeCacheTokens(usage);
    assert.ok(result);
    assert.equal(result.hit, 6000);
    assert.equal(result.miss, 4000);
  });

  test("with no cache data", () => {
    const usage: ModelUsage = {
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
    };
    const result = normalizeCacheTokens(usage);
    assert.equal(result, null);
  });

  test("with zero hit and zero miss (prompt_cache fields present but zero)", () => {
    const usage: ModelUsage = {
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 0,
    };
    const result = normalizeCacheTokens(usage);
    assert.ok(result);
    assert.equal(result.hit, 0);
    assert.equal(result.miss, 0);
  });

  test("with hit > prompt_tokens (API quirk)", () => {
    const usage: ModelUsage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_cache_hit_tokens: 500,
      prompt_cache_miss_tokens: 0,
    };
    const result = normalizeCacheTokens(usage);
    assert.ok(result);
    assert.equal(result.hit, 100); // clamped to prompt_tokens
    assert.equal(result.miss, 0);
  });
});

describe("computeCacheHitRate", () => {
  test("50 hit out of 100 total", () => {
    assert.equal(computeCacheHitRate(50, 50), 50);
  });

  test("100 hit out of 100 total", () => {
    assert.equal(computeCacheHitRate(100, 0), 100);
  });

  test("0 hit out of 100 total", () => {
    assert.equal(computeCacheHitRate(0, 100), 0);
  });

  test("zero total returns null", () => {
    assert.equal(computeCacheHitRate(0, 0), null);
  });
});

describe("computeCacheSavings", () => {
  const pricing: ModelPricing = { inputPrice: 1, outputPrice: 2, cacheReadPrice: 0.1 };

  test("1M cached tokens saves inputPrice - cacheReadPrice = $0.90", () => {
    assert.equal(computeCacheSavings(1_000_000, pricing), 0.9);
  });

  test("with zero cacheReadPrice", () => {
    assert.equal(computeCacheSavings(1_000_000, { inputPrice: 1, outputPrice: 2, cacheReadPrice: 0 }), 0);
  });

  test("with zero cachedTokens", () => {
    assert.equal(computeCacheSavings(0, pricing), 0);
  });
});

describe("formatCacheMetrics", () => {
  test("null hitRate returns null", () => {
    assert.equal(formatCacheMetrics(null, 0.42), null);
  });

  test("91.24% hit, $0.42 saved", () => {
    assert.equal(formatCacheMetrics(91.24, 0.42), "Cache: 91.2% hit | saved $0.42");
  });

  test("100% hit, $1.00 saved (no decimal for 100)", () => {
    assert.equal(formatCacheMetrics(100, 1.0), "Cache: 100% hit | saved $1.00");
  });

  test("0% hit, $0.00 saved (shows $0.00)", () => {
    assert.equal(formatCacheMetrics(0, 0), "Cache: 0% hit | saved $0.00");
  });

  test("50% hit, $0.004 saved (shows 50.0% and <$0.01)", () => {
    assert.equal(formatCacheMetrics(50, 0.004), "Cache: 50.0% hit | saved <$0.01");
  });
});
