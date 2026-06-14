import type { ToolCall } from "./executor";
import type { ToolDefinition } from "../prompt";

// ── ToolRegistry ──────────────────────────────────────────────────────────────

export type ToolRegistry = {
  resolve(name: string): { canonicalName: string; definition: ToolDefinition | undefined } | undefined;
  getAllNames(): string[];
};

// ── Repair Metrics ────────────────────────────────────────────────────────────

export type StageOutcome = "success" | "failed" | "skipped";

export type SingleCallRepairMetrics = {
  stages: {
    parse: StageOutcome;
    validate: StageOutcome;
    repair: StageOutcome;
  };
  attempts: number;
  latencyMs: number;
  originalToolName: string;
  repairedToolName?: string;
};

export type ToolCallRepairMetrics = {
  totalCalls: number;
  repairedCalls: number;
  failedRepairs: number;
  stageSuccesses: { parse: number; validate: number; repair: number };
  stageFailures: { parse: number; validate: number; repair: number };
  totalRepairLatencyMs: number;
  recentCalls: SingleCallRepairMetrics[];
};

export function createRepairMetrics(): ToolCallRepairMetrics {
  return {
    totalCalls: 0,
    repairedCalls: 0,
    failedRepairs: 0,
    stageSuccesses: { parse: 0, validate: 0, repair: 0 },
    stageFailures: { parse: 0, validate: 0, repair: 0 },
    totalRepairLatencyMs: 0,
    recentCalls: [],
  };
}

// ── Repair Pipeline Types ─────────────────────────────────────────────────────

export type RepairSuccess = {
  toolCall: ToolCall;
  args: Record<string, unknown>;
};

export type RepairFailure = {
  error: string;
};

// ── Parse Stage: JSON Recovery Functions ──────────────────────────────────────

const VALID_JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

function fixUnescapedBackslashes(raw: string): string {
  let result = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next !== undefined && VALID_JSON_ESCAPES.has(next)) {
        result += ch; // valid escape — leave as-is
      } else if (next !== undefined) {
        result += "\\\\"; // invalid escape — double the backslash
      } else {
        result += ch; // trailing backslash at end of string — leave it
      }
    } else {
      result += ch;
    }
  }
  return result;
}

function fixTrailingCommas(raw: string): string {
  return raw.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
}

function fixUnescapedQuotes(raw: string): string {
  // State machine: track whether we're inside a string value.
  // A string value starts with " after a colon (possibly with whitespace).
  let result = "";
  let inKey = false; // inside a property key
  let inValue = false; // inside a string value
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    result += ch;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      if (inKey) {
        inKey = false;
        // After key closes, look ahead for colon
      } else if (inValue) {
        // Check if next non-whitespace char is , or } or :
        let j = i + 1;
        while (j < raw.length && (raw[j] === " " || raw[j] === "\n" || raw[j] === "\r" || raw[j] === "\t")) {
          j++;
        }
        const next = raw[j];
        if (next === "," || next === "}" || next === undefined) {
          // End of value — valid close
          inValue = false;
        } else if (next === '"') {
          // Bare quote inside string value — escape it
          result += "\\";
        }
      } else {
        // Opening a key or value — look behind
        inKey = true; // assume key until proven otherwise
        // Scan backward for colon
        let j = result.length - 2;
        while (j >= 0 && (raw[j] === " " || raw[j] === "\n" || raw[j] === "\r" || raw[j] === "\t")) {
          j--;
        }
        if (j >= 0 && raw[j] === ":") {
          inKey = false;
          inValue = true;
        }
      }
    }
  }
  return result;
}

function completeTruncatedJson(raw: string): string {
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") openBraces++;
    else if (ch === "}") openBraces--;
    else if (ch === "[") openBrackets++;
    else if (ch === "]") openBrackets--;
  }

  let result = raw;

  // If the string ends inside a string value, close the string first
  let closedStringIsKey = false;
  if (inString) {
    // Determine if the truncated string is a key or value by checking the char
    // before its opening quote. If preceded by { or ,, it's a key.
    const openQuoteIdx = raw.lastIndexOf('"');
    if (openQuoteIdx >= 1) {
      const beforeQuote = raw[openQuoteIdx - 1];
      if (beforeQuote === "{" || beforeQuote === ",") {
        closedStringIsKey = true;
      }
    }
    result += '"';
  }

  // Check if we ended mid-key or mid-colon (last meaningful chars)
  const trimmed = result.trimEnd();
  if (trimmed.endsWith(":") || trimmed.endsWith(",")) {
    // Missing value after colon or comma — inject null placeholder
    result = trimmed.endsWith(",") ? result + '"placeholder":null' : result + "null";
    // Re-count after injection
    openBraces = 0;
    openBrackets = 0;
    inString = false;
    escaped = false;
    for (let i = 0; i < result.length; i++) {
      const ch = result[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") openBraces++;
      else if (ch === "}") openBraces--;
      else if (ch === "[") openBrackets++;
      else if (ch === "]") openBrackets--;
    }
  }

  // Check if we ended with a bare key (string ends with a quoted key, no :value)
  // Only trigger when: we either detected a bare key, or the string ends with " naturally
  if (!trimmed.endsWith(":") && !trimmed.endsWith(",") && openBrackets === 0) {
    const lastQuoteIdx = trimmed.lastIndexOf('"');
    // Allow injection if: (a) we closed a string that was a key, or (b) string
    // naturally ends with " and we weren't inside a string (bare key at truncation)
    const shouldInject = closedStringIsKey || (lastQuoteIdx >= 0 && lastQuoteIdx === trimmed.length - 1 && !inString);
    if (shouldInject) {
      let hasColonAfter = false;
      for (let i = lastQuoteIdx + 1; i < trimmed.length; i++) {
        if (trimmed[i] === ":") {
          hasColonAfter = true;
          break;
        }
      }
      if (!hasColonAfter) {
        result += ":null";
      }
    }
  }

  // Close unclosed structures
  while (openBrackets > 0) {
    result += "]";
    openBrackets--;
  }
  while (openBraces > 0) {
    result += "}";
    openBraces--;
  }

  return result;
}

function tryParseWithRecovery(raw: string): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || !raw.trim()) {
    return { ok: true, args: {} };
  }

  // Step 1: Fast path — direct JSON.parse
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "InputParseError: Tool arguments must be a JSON object." };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch {
    // fall through
  }

  // Step 2: Fix unescaped backslashes
  try {
    const fixed = fixUnescapedBackslashes(raw);
    const parsed = JSON.parse(fixed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, args: parsed as Record<string, unknown> };
    }
  } catch {
    // fall through
  }

  // Step 3: Fix trailing commas
  try {
    const fixed = fixTrailingCommas(raw);
    const parsed = JSON.parse(fixed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, args: parsed as Record<string, unknown> };
    }
  } catch {
    // fall through
  }

  // Step 4: Fix unescaped quotes
  try {
    const fixed = fixUnescapedQuotes(raw);
    const parsed = JSON.parse(fixed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, args: parsed as Record<string, unknown> };
    }
  } catch {
    // fall through
  }

  // Step 5: Structural completion (truncated JSON)
  try {
    const fixed = completeTruncatedJson(raw);
    const parsed = JSON.parse(fixed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, args: parsed as Record<string, unknown> };
    }
  } catch {
    // fall through
  }

  // Step 6: Combined recovery (all fixes applied sequentially)
  try {
    let fixed = fixUnescapedBackslashes(raw);
    fixed = fixTrailingCommas(fixed);
    fixed = fixUnescapedQuotes(fixed);
    fixed = completeTruncatedJson(fixed);
    const parsed = JSON.parse(fixed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, args: parsed as Record<string, unknown> };
    }
    return { ok: false, error: "InputParseError: Tool arguments must be a JSON object." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `InputParseError: Failed to parse tool arguments: ${message}. Ensure the tool call arguments are valid JSON.`,
    };
  }
}

// ── Validate Stage ────────────────────────────────────────────────────────────

type ValidateResult =
  | { ok: true; entry: { canonicalName: string; definition: ToolDefinition | undefined } }
  | { ok: false; error: string };

function validateAgainstRegistry(
  toolName: string,
  args: Record<string, unknown>,
  registry: ToolRegistry
): ValidateResult {
  const entry = registry.resolve(toolName.trim());
  if (!entry) {
    return {
      ok: false,
      error: `Unknown tool: ${toolName}. Available tools: ${registry.getAllNames().join(", ")}`,
    };
  }

  const definition = entry.definition;
  if (!definition) {
    // MCP tool without local definition — skip arg validation
    return { ok: true, entry };
  }

  // Check required arguments
  const required = definition.function.parameters.required ?? [];
  const missing = required.filter((key) => !(key in args));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required arguments for ${entry.canonicalName}: ${missing.join(", ")}. Retry with complete arguments.`,
    };
  }

  return { ok: true, entry };
}

// ── Repair Stage ──────────────────────────────────────────────────────────────

type RepairApplyResult = {
  toolCall: ToolCall;
  args: Record<string, unknown>;
};

function coerceType(_key: string, value: unknown, expectedType: string): unknown {
  if (expectedType === "string") {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.length === 1) return String(value[0]);
    if (typeof value === "number") return String(value);
    return value;
  }

  if (expectedType === "array") {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [value];
    return value;
  }

  if (expectedType === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === 1) return true;
    if (value === 0) return false;
    return value;
  }

  if (expectedType === "number") {
    if (typeof value === "number") return value;
    if (typeof value === "string" && !isNaN(Number(value))) return Number(value);
    return value;
  }

  if (expectedType === "object") {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
    return value;
  }

  return value;
}

function applyRepairs(
  toolCall: ToolCall,
  args: Record<string, unknown>,
  entry: { canonicalName: string; definition: ToolDefinition | undefined },
  _registry: ToolRegistry
): RepairApplyResult {
  const repairedArgs = { ...args };
  const repairedName = entry.canonicalName;

  const definition = entry.definition;
  if (definition) {
    const properties = (definition.function.parameters.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = definition.function.parameters.required ?? [];

    // Fix 1: Inject default values for missing optional args
    for (const key of Object.keys(properties)) {
      if (!(key in repairedArgs) && !required.includes(key)) {
        const schema = properties[key];
        if (schema && "default" in schema) {
          repairedArgs[key] = schema.default;
        }
      }
    }

    // Fix 2: Type coercion
    for (const [key, value] of Object.entries(repairedArgs)) {
      const expectedType = properties[key]?.type;
      if (typeof expectedType === "string") {
        repairedArgs[key] = coerceType(key, value, expectedType);
      }
    }
  }

  // Serialize repaired args back to JSON string
  const serializedArgs = JSON.stringify(repairedArgs);

  return {
    toolCall: {
      id: toolCall.id,
      type: "function",
      function: {
        name: repairedName,
        arguments: serializedArgs,
      },
    },
    args: repairedArgs,
  };
}

// ── Main Pipeline ─────────────────────────────────────────────────────────────

function initSingleCallMetrics(): SingleCallRepairMetrics {
  return {
    stages: { parse: "skipped", validate: "skipped", repair: "skipped" },
    attempts: 0,
    latencyMs: 0,
    originalToolName: "",
  };
}

function updateMetrics(metrics: ToolCallRepairMetrics, perCall: SingleCallRepairMetrics): void {
  metrics.totalCalls++;
  metrics.totalRepairLatencyMs += perCall.latencyMs;

  // A call is "repaired" if the tool name was changed (normalized)
  const wasRepaired = perCall.repairedToolName !== undefined && perCall.repairedToolName !== perCall.originalToolName;
  if (wasRepaired) {
    metrics.repairedCalls++;
  }

  // A call has "failed" if parse or validate failed after 2 attempts
  const wasFailure = perCall.stages.parse === "failed" || perCall.stages.validate === "failed";
  if (wasFailure) {
    metrics.failedRepairs++;
  }

  // Stage successes / failures
  if (perCall.stages.parse === "success") metrics.stageSuccesses.parse++;
  else if (perCall.stages.parse === "failed") metrics.stageFailures.parse++;
  if (perCall.stages.validate === "success") metrics.stageSuccesses.validate++;
  else if (perCall.stages.validate === "failed") metrics.stageFailures.validate++;
  if (perCall.stages.repair === "success") metrics.stageSuccesses.repair++;
  else if (perCall.stages.repair === "failed") metrics.stageFailures.repair++;

  // Circular buffer for recent calls (max 100)
  if (metrics.recentCalls.length >= 100) {
    metrics.recentCalls.shift();
  }
  metrics.recentCalls.push(perCall);
}

export function repairToolCall(
  toolCall: ToolCall,
  registry: ToolRegistry,
  metrics: ToolCallRepairMetrics
): RepairSuccess | RepairFailure {
  const startTime = performance.now();
  const perCallMetrics = initSingleCallMetrics();
  perCallMetrics.originalToolName = toolCall.function.name;

  for (let attempt = 1; attempt <= 2; attempt++) {
    // Stage 1: Parse
    const parseResult = tryParseWithRecovery(toolCall.function.arguments);
    if (!parseResult.ok) {
      perCallMetrics.stages.parse = "failed";
      if (attempt === 2) {
        perCallMetrics.attempts = attempt;
        perCallMetrics.latencyMs = performance.now() - startTime;
        updateMetrics(metrics, perCallMetrics);
        return { error: parseResult.error };
      }
      continue;
    }
    perCallMetrics.stages.parse = "success";

    // Stage 2: Validate
    const validateResult = validateAgainstRegistry(toolCall.function.name, parseResult.args, registry);
    if (!validateResult.ok) {
      perCallMetrics.stages.validate = "failed";
      if (attempt === 2) {
        perCallMetrics.attempts = attempt;
        perCallMetrics.latencyMs = performance.now() - startTime;
        updateMetrics(metrics, perCallMetrics);
        return { error: validateResult.error };
      }
      continue;
    }
    perCallMetrics.stages.validate = "success";

    // Stage 3: Repair
    const repairResult = applyRepairs(toolCall, parseResult.args, validateResult.entry, registry);
    perCallMetrics.stages.repair = "success";
    perCallMetrics.attempts = attempt;
    perCallMetrics.repairedToolName = repairResult.toolCall.function.name;
    perCallMetrics.latencyMs = performance.now() - startTime;
    updateMetrics(metrics, perCallMetrics);

    return { toolCall: repairResult.toolCall, args: repairResult.args };
  }

  // Should never reach here
  return { error: "Tool call repair failed after 2 attempts" };
}
