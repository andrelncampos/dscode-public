import * as fs from "node:fs";
import * as path from "node:path";
import type { ModelUsage } from "../session";
import {
  computeUsageCost,
  formatCost,
  formatTokenCount,
  DEFAULT_MODEL_PRICING,
  type ModelPricing,
} from "./model-capabilities";
import { atomicWriteFileSync } from "./file-utils";
import { getProjectDscodeDir } from "./dscode-paths";
import { normalizeCacheTokens } from "./cache-metrics";

const BUDGET_FILE = "budget.md";

type DailyCost = {
  date: string; // YYYY-MM-DD
  cost: number;
  cacheCost: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  sessionCount: number;
  totalTokens: number;
  meta?: Record<string, string | number>;
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
    // Match 5-column format: | 2026-06-08 | 47 | 1.2M | $0.42 | $0.10 |
    const match5 = line.match(
      /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d+)\s*\|\s*(\d[\d.]*[KM]?)\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|/
    );
    if (match5) {
      const date = match5[1];
      const sessions = parseInt(match5[2], 10);
      const tokens = parseTokenCount(match5[3]);
      const cost = parseFloat(match5[4]);
      const cacheCost = parseFloat(match5[5]);
      if (date && Number.isFinite(cost)) {
        costs.push({
          date,
          cost,
          cacheCost: Number.isFinite(cacheCost) ? cacheCost : 0,
          cacheHitTokens: 0,
          cacheMissTokens: 0,
          sessionCount: Number.isFinite(sessions) ? sessions : 0,
          totalTokens: Number.isFinite(tokens) ? tokens : 0,
        });
      }
      continue;
    }

    // Match 4-column (old Spec 200) format: | 2026-06-08 | $0.42 | $0.10 | 91.2% |
    const match4 = line.match(
      /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)%\s*\|/
    );
    if (match4) {
      const date = match4[1];
      const cost = parseFloat(match4[2]);
      const cacheCost = parseFloat(match4[3]);
      if (date && Number.isFinite(cost)) {
        costs.push({
          date,
          cost,
          cacheCost: Number.isFinite(cacheCost) ? cacheCost : 0,
          cacheHitTokens: 0,
          cacheMissTokens: 0,
          sessionCount: 0,
          totalTokens: 0,
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
        costs.push({
          date,
          cost,
          cacheCost: 0,
          cacheHitTokens: 0,
          cacheMissTokens: 0,
          sessionCount: 0,
          totalTokens: 0,
        });
      }
    }
  }

  return costs;
}

function parseTokenCount(raw: string): number {
  const num = parseFloat(raw);
  if (raw.endsWith("M")) return Math.round(num * 1_000_000);
  if (raw.endsWith("K")) return Math.round(num * 1_000);
  return Math.round(num);
}

/** Format cache cost with exactly 4 decimal places (cache reads are typically sub-cent). */
function formatCacheCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function buildBudgetMarkdown(costs: DailyCost[]): string {
  const sorted = [...costs].sort((a, b) => b.date.localeCompare(a.date));
  const totalCost = sorted.reduce((sum, e) => sum + e.cost, 0);
  const totalCacheCost = sorted.reduce((sum, e) => sum + e.cacheCost, 0);
  const totalSessions = sorted.reduce((sum, e) => sum + e.sessionCount, 0);
  const totalTokens = sorted.reduce((sum, e) => sum + e.totalTokens, 0);

  const lines: string[] = [
    "# Budget — Custo acumulado do projeto",
    "",
    "| Data | Chamadas | Tokens | Custo (USD) | Cache (USD) |",
    "|------|----------|--------|-------------|-------------|",
  ];

  for (const entry of sorted) {
    lines.push(
      `| ${entry.date} | ${entry.sessionCount} | ${formatTokenCount(entry.totalTokens)} | ${formatCost(entry.cost)} | ${formatCacheCost(entry.cacheCost)} |`
    );
  }

  lines.push(
    `| **Total** | **${totalSessions}** | **${formatTokenCount(totalTokens)}** | **${formatCost(totalCost)}** | **${formatCacheCost(totalCacheCost)}** |`
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

/** Regenerate the budget markdown from existing budget data. Returns "" when no data. */
export function getBudgetMarkdown(projectRoot: string): string {
  const costs = readBudget(projectRoot);
  if (costs.length === 0) return "";
  return buildBudgetMarkdown(costs);
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
  limits?: BudgetLimits,
  meta?: Record<string, string | number>
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
      existing.sessionCount += 1;
      existing.totalTokens += usage.total_tokens ?? 0;
      if (typeof usage.normalizedCacheHitTokens === "number") {
        existing.cacheHitTokens += usage.normalizedCacheHitTokens;
        existing.cacheMissTokens += usage.normalizedCacheMissTokens ?? 0;
        existing.cacheCost += (usage.normalizedCacheHitTokens / 1_000_000) * pricing.cacheReadPrice;
      }
      if (meta) {
        existing.meta = { ...existing.meta, ...meta };
      }
    } else {
      const cacheHit = typeof usage.normalizedCacheHitTokens === "number" ? usage.normalizedCacheHitTokens : 0;
      const cacheMiss = typeof usage.normalizedCacheMissTokens === "number" ? usage.normalizedCacheMissTokens : 0;
      const cacheCost = cacheHit > 0 ? (cacheHit / 1_000_000) * pricing.cacheReadPrice : 0;
      costs.push({
        date: today,
        cost,
        cacheCost,
        cacheHitTokens: cacheHit,
        cacheMissTokens: cacheMiss,
        sessionCount: 1,
        totalTokens: usage.total_tokens ?? 0,
      });
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

export function recordBudgetCostWithCache(
  projectRoot: string,
  model: string,
  usage: ModelUsage,
  pricingOverrides?: Record<string, ModelPricing>,
  limits?: BudgetLimits,
  meta?: Record<string, string | number>
): string | null {
  const cache = normalizeCacheTokens(usage);
  if (cache) {
    usage.normalizedCacheHitTokens = cache.hit;
    usage.normalizedCacheMissTokens = cache.miss;
  }
  return recordBudgetCost(projectRoot, model, usage, pricingOverrides, limits, meta);
}
