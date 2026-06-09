import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getBudgetCosts, recordBudgetCost } from "../common/budget-tracker";
import { computeUsageCost, DEFAULT_MODEL_PRICING } from "../common/model-capabilities";
import type { ModelUsage } from "../session";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeUsage(overrides: Partial<ModelUsage> = {}): ModelUsage {
  return {
    prompt_tokens: 1000,
    completion_tokens: 500,
    total_tokens: 1500,
    total_reqs: 1,
    ...overrides,
  };
}

test("getBudgetCosts returns zeroes when no budget file exists", () => {
  const projectRoot = createTempDir("deepcode-budget-test-");
  const { todayCost, projectTotal } = getBudgetCosts(projectRoot);
  assert.equal(todayCost, 0);
  assert.equal(projectTotal, 0);
});

test("recordBudgetCost creates budget file and records cost", () => {
  const projectRoot = createTempDir("deepcode-budget-test-");
  const usage = makeUsage({ prompt_tokens: 1_000_000, completion_tokens: 500_000 });
  const pricing = DEFAULT_MODEL_PRICING["deepseek-v4-pro"];

  recordBudgetCost(projectRoot, "deepseek-v4-pro", usage);

  const budgetPath = path.join(projectRoot, ".dscode", "budget.md");
  assert.ok(fs.existsSync(budgetPath));

  const content = fs.readFileSync(budgetPath, "utf8");
  // Should mention "Custo acumulado do projeto"
  assert.match(content, /Custo acumulado do projeto/);

  const { todayCost, projectTotal } = getBudgetCosts(projectRoot);
  assert.ok(todayCost > 0);
  assert.equal(projectTotal, todayCost);
});

test("recordBudgetCost accumulates multiple calls for same day", () => {
  const projectRoot = createTempDir("deepcode-budget-test-");
  // Use large token counts so the cost rounds cleanly to cents
  const usage = makeUsage({ prompt_tokens: 10_000_000, completion_tokens: 5_000_000 });
  const pricing = DEFAULT_MODEL_PRICING["deepseek-v4-pro"];

  recordBudgetCost(projectRoot, "deepseek-v4-pro", usage);
  const { todayCost: cost1 } = getBudgetCosts(projectRoot);

  recordBudgetCost(projectRoot, "deepseek-v4-pro", usage);
  const { todayCost: cost2 } = getBudgetCosts(projectRoot);

  assert.ok(cost2 > cost1);
  // Tolerate 0.02 for rounding in the markdown round-trip (2 calls × $0.01 max error each)
  const expectedTotal = computeUsageCost(usage, pricing) * 2;
  assert.ok(Math.abs(cost2 - expectedTotal) < 0.02);
  // The delta should be close to a single call cost, within rounding tolerance
  const expectedSingle = computeUsageCost(usage, pricing);
  assert.ok(Math.abs(cost2 - cost1 - expectedSingle) < 0.02);
});

test("recordBudgetCost skips models without pricing", () => {
  const projectRoot = createTempDir("deepcode-budget-test-");
  const usage = makeUsage();

  recordBudgetCost(projectRoot, "unknown-model", usage);

  const { projectTotal } = getBudgetCosts(projectRoot);
  assert.equal(projectTotal, 0);
});

test("recordBudgetCost skips zero-cost usage", () => {
  const projectRoot = createTempDir("deepcode-budget-test-");
  const usage = makeUsage({ prompt_tokens: 0, completion_tokens: 0 });

  recordBudgetCost(projectRoot, "deepseek-v4-pro", usage);

  const { projectTotal } = getBudgetCosts(projectRoot);
  assert.equal(projectTotal, 0);
});

test("recordBudgetCost uses cache-hit tokens for cost computation", () => {
  const projectRoot = createTempDir("deepcode-budget-test-");
  const pricing = DEFAULT_MODEL_PRICING["deepseek-v4-pro"];

  // All tokens are cached — should be very cheap
  const usage = makeUsage({
    prompt_tokens: 10_000_000,
    completion_tokens: 1_000_000,
    prompt_tokens_details: { cached_tokens: 10_000_000 },
  });

  recordBudgetCost(projectRoot, "deepseek-v4-pro", usage);

  const { todayCost } = getBudgetCosts(projectRoot);
  const expectedCost = computeUsageCost(usage, pricing);
  // With all input cached, cost should be lower than uncached input alone
  const uncachedInputCost = (10_000_000 / 1_000_000) * pricing.inputPrice;
  assert.ok(todayCost < uncachedInputCost);
  // Tolerate 0.01 for markdown round-trip rounding
  assert.ok(Math.abs(todayCost - expectedCost) < 0.01);
});

test("getBudgetCosts handles malformed budget file gracefully", () => {
  const projectRoot = createTempDir("deepcode-budget-test-");
  const dscodeDir = path.join(projectRoot, ".dscode");
  fs.mkdirSync(dscodeDir, { recursive: true });
  fs.writeFileSync(path.join(dscodeDir, "budget.md"), "not a valid budget file\njust some text\n");

  const { todayCost, projectTotal } = getBudgetCosts(projectRoot);
  assert.equal(todayCost, 0);
  assert.equal(projectTotal, 0);
});

test("recordBudgetCost uses custom pricing overrides", () => {
  const projectRoot = createTempDir("deepcode-budget-test-");
  const usage = makeUsage({ prompt_tokens: 10_000_000, completion_tokens: 5_000_000 });

  // Use a very high pricing to verify it's being applied
  const customPricing = { inputPrice: 10, outputPrice: 20, cacheReadPrice: 5 };
  recordBudgetCost(projectRoot, "deepseek-v4-pro", usage, {
    "deepseek-v4-pro": customPricing,
  });

  const { todayCost } = getBudgetCosts(projectRoot);
  const expectedCost = computeUsageCost(usage, customPricing);
  // Tolerate 0.01 for markdown round-trip rounding
  assert.ok(Math.abs(todayCost - expectedCost) < 0.01);
  // With default pricing it would be much lower
  const defaultCost = computeUsageCost(usage, DEFAULT_MODEL_PRICING["deepseek-v4-pro"]);
  assert.ok(todayCost > defaultCost * 10);
});

test("recordBudgetCost with prompt_cache_hit_tokens fallback computes correct cost", () => {
  const projectRoot = createTempDir("deepcode-budget-test-");
  const pricing = DEFAULT_MODEL_PRICING["deepseek-v4-pro"];

  // Use prompt_cache_hit_tokens instead of prompt_tokens_details.cached_tokens
  const usage = makeUsage({
    prompt_tokens: 10_000_000,
    completion_tokens: 1_000_000,
    prompt_cache_hit_tokens: 10_000_000,
    // No prompt_tokens_details at all
  });

  recordBudgetCost(projectRoot, "deepseek-v4-pro", usage);

  const { todayCost } = getBudgetCosts(projectRoot);
  const expectedCost = computeUsageCost(usage, pricing);
  // With all input cached, cost should be lower than uncached input alone
  const uncachedInputCost = (10_000_000 / 1_000_000) * pricing.inputPrice;
  assert.ok(todayCost < uncachedInputCost);
  // Tolerate 0.01 for markdown round-trip rounding
  assert.ok(Math.abs(todayCost - expectedCost) < 0.01);
});
