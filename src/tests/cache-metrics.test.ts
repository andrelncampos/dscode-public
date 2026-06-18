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
    assert.equal(formatCacheMetrics(null, 10), null);
  });

  test("91.2% hit, 10x cheaper", () => {
    assert.equal(formatCacheMetrics(91.24, 10), "Cache: 91.2% hit | 10x cheaper");
  });

  test("100% hit, 120x cheaper (no decimal for 100)", () => {
    assert.equal(formatCacheMetrics(100, 120), "Cache: 100% hit | 120x cheaper");
  });

  test("0% hit, no multiplier (shows just rate)", () => {
    assert.equal(formatCacheMetrics(0, undefined), "Cache: 0% hit");
  });

  test("50% hit, multiplier <= 1 not shown", () => {
    assert.equal(formatCacheMetrics(50, 1), "Cache: 50.0% hit");
  });
});
