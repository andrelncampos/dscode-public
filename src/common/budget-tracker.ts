import * as fs from "node:fs";
import * as path from "node:path";
import type { ModelUsage } from "../session";
import { computeUsageCost, formatCost, DEFAULT_MODEL_PRICING, type ModelPricing } from "./model-capabilities";
import { atomicWriteFileSync } from "./file-utils";
import { getProjectDscodeDir } from "./dscode-paths";
import { computeCacheSavings } from "./cache-metrics";

const BUDGET_FILE = "budget.md";

type DailyCost = {
  date: string; // YYYY-MM-DD
  cost: number;
  cacheSaved: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
};

function getBudgetPath(projectRoot: string): string {
  const dscodeDir = getProjectDscodeDir(projectRoot);
  try {
    fs.mkdirSync(dscodeDir, { recursive: true });
  } catch {
    // Directory creation failed — callers handle missing files gracefully
  }
  return path.join(dscodeDir, BUDGET_FILE);
}

function getToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseBudgetFile(content: string): DailyCost[] {
  const costs: DailyCost[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    // Match 3-column format: | 2026-06-08 | $0.42 | $0.10 | 91.2% |
    const match3 = line.match(
      /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)%\s*\|/
    );
    if (match3) {
      const date = match3[1];
      const cost = parseFloat(match3[2]);
      const cacheSaved = parseFloat(match3[3]);
      if (date && Number.isFinite(cost)) {
        costs.push({
          date,
          cost,
          cacheSaved: Number.isFinite(cacheSaved) ? cacheSaved : 0,
          cacheHitTokens: 0, // Not recoverable from hit rate alone
          cacheMissTokens: 0, // Not recoverable from hit rate alone
        });
      }
      continue;
    }

    // Match 2-column legacy format: | 2026-06-08 | $0.42 |
    const match2 = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|/);
    if (match2) {
      const date = match2[1];
      const cost = parseFloat(match2[2]);
      if (date && Number.isFinite(cost)) {
        costs.push({ date, cost, cacheSaved: 0, cacheHitTokens: 0, cacheMissTokens: 0 });
      }
    }
  }

  return costs;
}

function buildBudgetMarkdown(costs: DailyCost[]): string {
  const sorted = [...costs].sort((a, b) => b.date.localeCompare(a.date));
  const totalCost = sorted.reduce((sum, e) => sum + e.cost, 0);
  const totalCacheSaved = sorted.reduce((sum, e) => sum + e.cacheSaved, 0);
  const totalCacheHit = sorted.reduce((sum, e) => sum + e.cacheHitTokens, 0);
  const totalCacheMiss = sorted.reduce((sum, e) => sum + e.cacheMissTokens, 0);
  const totalCacheTotal = totalCacheHit + totalCacheMiss;
  const totalHitRate = totalCacheTotal > 0 ? (totalCacheHit / totalCacheTotal) * 100 : 0;

  const lines: string[] = [
    "# Budget — Custo acumulado do projeto",
    "",
    "| Data | Custo (USD) | Cache Saved (USD) | Cache Hit % |",
    "|------|-------------|-------------------|-------------|",
  ];

  for (const entry of sorted) {
    const cacheTotal = entry.cacheHitTokens + entry.cacheMissTokens;
    const hitRate = cacheTotal > 0 ? (entry.cacheHitTokens / cacheTotal) * 100 : 0;
    lines.push(
      `| ${entry.date} | ${formatCost(entry.cost)} | ${formatCost(entry.cacheSaved)} | ${hitRate.toFixed(1)}% |`
    );
  }

  lines.push(
    `| **Total** | **${formatCost(totalCost)}** | **${formatCost(totalCacheSaved)}** | **${totalHitRate.toFixed(1)}%** |`
  );

  return lines.join("\n") + "\n";
}

function readBudget(projectRoot: string): DailyCost[] {
  const budgetPath = getBudgetPath(projectRoot);

  if (!fs.existsSync(budgetPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(budgetPath, "utf8");
    return parseBudgetFile(content);
  } catch {
    return [];
  }
}

function writeBudget(projectRoot: string, costs: DailyCost[]): void {
  const budgetPath = getBudgetPath(projectRoot);
  const markdown = buildBudgetMarkdown(costs);
  atomicWriteFileSync(budgetPath, markdown);
}

/**
 * Record the cost of a single LLM API call into the project budget file.
 *
 * Reads the budget file from .dscode/budget.md, adds the cost to today's
 * entry (or creates it), and writes the updated markdown file back.
 */
/**
 * Result from reading the project budget file.
 */
export type BudgetCosts = {
  /** Total cost for today (YYYY-MM-DD), 0 if no entry yet. */
  todayCost: number;
  /** Sum of all daily costs across the entire project history. */
  projectTotal: number;
};

/**
 * Read the current daily and project-total costs from .dscode/budget.md.
 * Returns zeroed values when the file does not exist or is malformed.
 */
export function getBudgetCosts(projectRoot: string): BudgetCosts {
  const today = getToday();
  const costs = readBudget(projectRoot);
  const todayCost = costs.find((entry) => entry.date === today)?.cost ?? 0;
  const projectTotal = costs.reduce((sum, entry) => sum + entry.cost, 0);
  return { todayCost, projectTotal };
}

export type BudgetLimits = {
  dailyLimit?: number;
  monthlyLimit?: number;
};

export function recordBudgetCost(
  projectRoot: string,
  model: string,
  usage: ModelUsage,
  pricingOverrides?: Record<string, ModelPricing>,
  limits?: BudgetLimits
): string | null {
  try {
    const pricing = pricingOverrides?.[model] ?? DEFAULT_MODEL_PRICING[model];
    if (!pricing) {
      // No pricing info for this model — skip recording
      return null;
    }

    const cost = computeUsageCost(usage, pricing);
    if (!Number.isFinite(cost) || cost <= 0) {
      return null;
    }

    const today = getToday();
    const costs = readBudget(projectRoot);

    const existing = costs.find((entry) => entry.date === today);
    if (existing) {
      existing.cost += cost;
      if (typeof usage.normalizedCacheHitTokens === "number") {
        existing.cacheHitTokens += usage.normalizedCacheHitTokens;
        existing.cacheMissTokens += usage.normalizedCacheMissTokens ?? 0;
        existing.cacheSaved += computeCacheSavings(usage.normalizedCacheHitTokens, pricing);
      }
    } else {
      const cacheHit = typeof usage.normalizedCacheHitTokens === "number" ? usage.normalizedCacheHitTokens : 0;
      const cacheMiss = typeof usage.normalizedCacheMissTokens === "number" ? usage.normalizedCacheMissTokens : 0;
      const cacheSaved = cacheHit > 0 ? computeCacheSavings(cacheHit, pricing) : 0;
      costs.push({ date: today, cost, cacheSaved, cacheHitTokens: cacheHit, cacheMissTokens: cacheMiss });
    }

    writeBudget(projectRoot, costs);

    // Check budget limits and return warning if exceeded
    // Re-find today's entry so the first call of the day is also checked
    const todayEntry = costs.find((entry) => entry.date === today)!;
    let warning: string | null = null;
    if (typeof limits?.dailyLimit === "number" && todayEntry.cost > limits.dailyLimit) {
      warning = `Budget alert: daily cost ${formatCost(todayEntry.cost)} exceeds limit ${formatCost(limits.dailyLimit)}`;
    }
    if (typeof limits?.monthlyLimit === "number") {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const monthPrefix = `${year}-${month}`;
      const monthlyCost = costs
        .filter((entry) => entry.date.startsWith(monthPrefix))
        .reduce((sum, entry) => sum + entry.cost, 0);
      if (monthlyCost > limits.monthlyLimit) {
        const monthlyWarning = `Budget alert: monthly cost ${formatCost(monthlyCost)} exceeds limit ${formatCost(limits.monthlyLimit)}`;
        warning = warning ? `${warning}\n${monthlyWarning}` : monthlyWarning;
      }
    }

    return warning;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[budget] Failed to record cost: ${message}\n`);
    return null;
  }
}
