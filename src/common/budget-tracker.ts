import * as fs from "fs";
import * as path from "path";
import type { ModelUsage } from "../session";
import { computeUsageCost, formatCost, DEFAULT_MODEL_PRICING, type ModelPricing } from "./model-capabilities";
import { atomicWriteFileSync } from "./file-utils";

const BUDGET_FILE = "budget.md";

type DailyCost = {
  date: string; // YYYY-MM-DD
  cost: number;
};

function getBudgetPath(projectRoot: string): string {
  const dscodeDir = path.join(projectRoot, ".dscode");
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
    // Match table rows: | 2026-06-08 | $0.42 |
    const match = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|/);
    if (match) {
      const date = match[1];
      const cost = parseFloat(match[2]);
      if (date && Number.isFinite(cost)) {
        costs.push({ date, cost });
      }
    }
  }

  return costs;
}

function buildBudgetMarkdown(costs: DailyCost[]): string {
  const sorted = [...costs].sort((a, b) => b.date.localeCompare(a.date));
  const total = sorted.reduce((sum, entry) => sum + entry.cost, 0);

  const lines: string[] = [
    "# Budget — Custo acumulado do projeto",
    "",
    "| Data | Custo (USD) |",
    "|------|-------------|",
  ];

  for (const entry of sorted) {
    lines.push(`| ${entry.date} | ${formatCost(entry.cost)} |`);
  }

  lines.push(`| **Total** | **${formatCost(total)}** |`);

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
 * Reads .dscode/budget.md, adds the cost to today's entry (or creates it),
 * and writes the updated markdown file back.
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
    } else {
      costs.push({ date: today, cost });
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
