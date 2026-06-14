# Spec 190: Tool-Call Repair — Design

## Design Approach

**Pure function pipeline.** The repair logic is a standalone module (`src/tools/tool-call-repair.ts`) with zero side effects, zero I/O, zero global state. All dependencies (tool registry) are injected as function parameters. This makes every repair strategy unit-testable in isolation.

**Integration point.** Repair is inserted into `ToolExecutor.executeToolCall()` after structural parsing (`parseToolCall`) and before handler execution. This ensures:
- Repair operates on structurally valid `ToolCall` objects (has `id`, `type`, `function.name`, `function.arguments`).
- Repair normalizes the tool name BEFORE handler lookup — case-insensitive matching happens once, in one place.
- Repair produces parsed `args` ready for handler consumption — handler code is unchanged.
- Failed repairs produce errors (not silent drops) — the LLM gets actionable feedback.

**KISS.** No framework, no plugin architecture, no configuration. The pipeline is a single function with 3 internal stages. If a strategy doesn't apply, it's a no-op. The fast path (valid JSON, correct tool name, all required args present) adds ~1 `JSON.parse` call overhead — sub-millisecond.

---

## Architecture Decisions

### ADR-190-001: Repair as Pure Function, Not Class Method

**Decision:** `repairToolCall()` is an exported pure function, not a method on `ToolExecutor`.

**Rationale:**
- Testable without instantiating `ToolExecutor` (which requires `projectRoot`, `McpManager`, etc.).
- No `this` binding complexity.
- Clear dependency injection: all inputs are explicit parameters.
- Follows the pattern established by `normalizeCacheTokens` in `cache-metrics.ts` (spec 180).

### ADR-190-002: ToolRegistry as Minimal Interface

**Decision:** The repair pipeline receives a `ToolRegistry` object with two methods: `resolve(name: string)` and `getAllNames(): string[]`. It does NOT receive the full `McpManager` or tool handler map.

**Rationale:**
- The repair pipeline does not execute tools — it only needs `ToolDefinition` for validation.
- `ToolRegistry` abstracts both built-in tools (from `BUILTIN_TOOL_DEFINITIONS`) and MCP tools (from `McpManager.getMcpServerTools()`).
- The two methods are trivial to mock in tests — one function and one array.

### ADR-190-003: Metrics Accumulator as Mutable Object Passed By Reference

**Decision:** `ToolCallRepairMetrics` is a mutable object created by `ToolExecutor` and passed by reference to `repairToolCall()`. The function mutates the accumulator in-place.

**Rationale:**
- Avoids returning metrics alongside every repair result (clutters the API).
- Metrics accumulation is a side-effect that belongs to the caller, not the pure function.
- The function is still pure with respect to the tool call — it doesn't depend on metrics state.

---

## Component / Module Breakdown

### Component 1: `ToolRegistry` (type)

**File:** `src/tools/tool-call-repair.ts`

**Purpose:** Minimal interface for the repair pipeline to look up tool names and definitions.

**Interface:**
```typescript
export type ToolRegistry = {
  /**
   * Resolve a tool name to its canonical form and schema definition.
   * Returns undefined if the tool is not registered.
   *
   * Matching rules:
   * 1. Exact match on trimmed name → return immediately.
   * 2. Case-insensitive match on trimmed name → return first alphabetical match.
   * 3. No match → return undefined.
   */
  resolve(name: string): { canonicalName: string; definition: ToolDefinition | undefined } | undefined;

  /**
   * Return all registered tool names (built-in + MCP) sorted alphabetically.
   * Used for error messages ("Available tools: bash, read, write, ...").
   */
  getAllNames(): string[];
};
```

**Dependencies:** `ToolDefinition` from `../prompt`.

**Error Handling:** Returns `undefined` for unknown tools. No exceptions thrown by `resolve()`.

---

### Component 2: `ToolCallRepairMetrics` (type)

**File:** `src/tools/tool-call-repair.ts`

**Purpose:** Accumulate per-session repair statistics.

**Interface:**
```typescript
export type StageOutcome = "success" | "failed" | "skipped";

export type SingleCallRepairMetrics = {
  /** Which stages were attempted and their outcomes. */
  stages: {
    parse: StageOutcome;
    validate: StageOutcome;
    repair: StageOutcome;
  };
  /** Number of repair attempts (1 or 2). */
  attempts: number;
  /** Total repair latency in milliseconds (performance.now() delta). */
  latencyMs: number;
  /** The original tool name before repair. */
  originalToolName: string;
  /** The repaired tool name (same as original if no repair needed). */
  repairedToolName?: string;
};

export type ToolCallRepairMetrics = {
  /** Total tool calls processed. */
  totalCalls: number;
  /** Calls where at least one repair action was applied. */
  repairedCalls: number;
  /** Calls that failed repair after 2 attempts. */
  failedRepairs: number;
  /** Cumulative counts per stage. */
  stageSuccesses: { parse: number; validate: number; repair: number };
  stageFailures: { parse: number; validate: number; repair: number };
  /** Cumulative repair latency across all calls. */
  totalRepairLatencyMs: number;
  /** Per-call detailed records (max 100, for debug inspection). */
  recentCalls: SingleCallRepairMetrics[];
};

export function createRepairMetrics(): ToolCallRepairMetrics;
```

**Internal Logic:**
- `createRepairMetrics()` returns a zeroed metrics object.
- `recentCalls` is a circular buffer — when it exceeds 100 entries, oldest is dropped.
- All numeric fields start at 0.

---

### Component 3: `repairToolCall()` (main pipeline function)

**File:** `src/tools/tool-call-repair.ts`

**Purpose:** Execute the full 3-stage repair pipeline on a tool call. Maximum 2 repair attempts.

**Interface:**
```typescript
export type RepairSuccess = {
  /** The repaired tool call with normalized name and serialized arguments. */
  toolCall: ToolCall;
  /** Parsed arguments ready for handler consumption. */
  args: Record<string, unknown>;
};

export type RepairFailure = {
  /** Error message suitable for LLM consumption. */
  error: string;
};

export function repairToolCall(
  toolCall: ToolCall,
  registry: ToolRegistry,
  metrics: ToolCallRepairMetrics
): RepairSuccess | RepairFailure;
```

**Internal Logic (pseudocode):**

```
function repairToolCall(toolCall, registry, metrics):
  startTime = performance.now()
  perCallMetrics = initSingleCallMetrics()
  perCallMetrics.originalToolName = toolCall.function.name

  for attempt in [1, 2]:
    // Stage 1: Parse
    parseResult = tryParseWithRecovery(toolCall.function.arguments)
    if parseResult is Error:
      if attempt == 2: return RepairFailure(parseResult.error)
      continue  // try next attempt (more aggressive recovery)
    
    // Stage 2: Validate
    validateResult = validateAgainstRegistry(toolCall.function.name, parseResult.args, registry)
    if validateResult is Error:
      if attempt == 2: return RepairFailure(validateResult.error)
      continue
    
    // Stage 3: Repair
    repairResult = applyRepairs(toolCall, parseResult.args, validateResult.entry, registry)
    // repairResult.toolCall has normalized name
    // repairResult.args has defaults injected, types fixed
    
    // Success — return
    perCallMetrics.stages = { parse: "success", validate: "success", repair: "success" }
    perCallMetrics.attempts = attempt
    perCallMetrics.repairedToolName = repairResult.toolCall.function.name
    perCallMetrics.latencyMs = performance.now() - startTime
    updateMetrics(metrics, perCallMetrics)
    return { toolCall: repairResult.toolCall, args: repairResult.args }

  // Should never reach here (caught by attempt==2 returns above)
  return RepairFailure("Tool call repair failed after 2 attempts")
```

**Edge cases handled:**
- `toolCall.function.arguments` is empty string → parsed as `{}`.
- `toolCall.function.arguments` is valid JSON → fast path, parse succeeds on first attempt with zero modification.
- `toolCall.function.arguments` is already an object (not string) → handled by `normalizeToolArguments` in caller before reaching repair. If somehow reaches repair as object, treat as already-parsed.

**Error Handling:**
- Every failure path sets `perCallMetrics.stages[stage] = "failed"` and `metrics.failedRepairs++` before returning error.
- Error messages are deterministic and include: (a) which stage failed, (b) the specific issue, (c) the original and attempted values.

---

### Component 4: `tryParseWithRecovery()` (parse stage)

**File:** `src/tools/tool-call-repair.ts` (private function, not exported)

**Purpose:** Parse a JSON string with progressive recovery strategies.

**Interface:**
```typescript
function tryParseWithRecovery(
  raw: string
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string };
```

**Internal Logic:**

```
function tryParseWithRecovery(raw):
  if raw is empty or only whitespace: return { ok: true, args: {} }
  
  // Step 1: Fast path — direct JSON.parse
  try: return { ok: true, args: JSON.parse(raw) }
  catch: fall through
  
  // Step 2: Fix unescaped backslashes in Windows paths
  // Pattern: backslash NOT followed by valid JSON escape char (", \, /, b, f, n, r, t, u)
  fixed = fixUnescapedBackslashes(raw)
  try: return { ok: true, args: JSON.parse(fixed) }
  catch: fall through
  
  // Step 3: Fix trailing commas (common in LLM output)
  fixed = fixTrailingCommas(raw)
  try: return { ok: true, args: JSON.parse(fixed) }
  catch: fall through
  
  // Step 4: Fix unescaped quotes inside string values
  // Pattern: inside a JSON string value, a bare double-quote breaks parsing
  fixed = fixUnescapedQuotes(raw)
  try: return { ok: true, args: JSON.parse(fixed) }
  catch: fall through
  
  // Step 5: Structural completion (truncated JSON)
  fixed = completeTruncatedJson(raw)
  try: return { ok: true, args: JSON.parse(fixed) }
  catch: fall through
  
  // Step 6: Combined recovery (all fixes applied sequentially)
  fixed = fixUnescapedBackslashes(raw)
  fixed = fixTrailingCommas(fixed)
  fixed = fixUnescapedQuotes(fixed)
  fixed = completeTruncatedJson(fixed)
  try: return { ok: true, args: JSON.parse(fixed) }
  catch: return { ok: false, error: `InputParseError: ...` }
```

**Recovery strategy details:**

#### `fixUnescapedBackslashes(raw: string): string`
- Scan the string character by character.
- When a backslash `\` is found, check the next character.
- If next char is one of `["\\/bfnrtu]`, it's a valid escape — leave it.
- If next char is NOT a valid escape char, insert an additional backslash (making it `\\`).
- Example: `{"path":"C:\git\dscode"}` → `{"path":"C:\\git\\dscode"}`.

#### `fixTrailingCommas(raw: string): string`
- Replace regex pattern `,\s*}` with `}`.
- Replace regex pattern `,\s*]` with `]`.

#### `fixUnescapedQuotes(raw: string): string`
- Scan inside string values (between the opening `"` after `:` and the closing `"` before `,` or `}`).
- If a bare `"` is found inside a string value, escape it as `\"`.
- Example: `{"text":"say "hello""}` → `{"text":"say \"hello\""}`.

#### `completeTruncatedJson(raw: string): string`
- Count `{` minus `}`. If positive, append that many `}`.
- Count `[` minus `]`. If positive, append that many `]`.
- If the string ends inside a string value (odd number of unescaped quotes), close the string with `"`, then close structural braces.
- Example: `{"command":"ls","sideEffects` → `{"command":"ls","sideEffects":null}` (missing colon+value → inject null placeholder).

---

### Component 5: `validateAgainstRegistry()` (validate stage)

**File:** `src/tools/tool-call-repair.ts` (private function)

**Purpose:** Validate tool name and required arguments against the tool registry.

**Interface:**
```typescript
type ValidateResult =
  | { ok: true; entry: { canonicalName: string; definition: ToolDefinition | undefined } }
  | { ok: false; error: string };

function validateAgainstRegistry(
  toolName: string,
  args: Record<string, unknown>,
  registry: ToolRegistry
): ValidateResult;
```

**Internal Logic:**

```
function validateAgainstRegistry(toolName, args, registry):
  entry = registry.resolve(toolName)
  if entry is undefined:
    return { ok: false, error: "Unknown tool: ${toolName}. Available tools: ${registry.getAllNames().join(', ')}" }
  
  definition = entry.definition
  if definition is undefined:
    // MCP tool without local definition — skip arg validation
    return { ok: true, entry }
  
  // Check required arguments
  required = definition.function.parameters.required ?? []
  missing = required.filter(key => !(key in args))
  if missing.length > 0:
    return { ok: false, error: "Missing required arguments for ${entry.canonicalName}: ${missing.join(', ')}" }
  
  // Check type mismatches (non-blocking — will be repaired in repair stage)
  // Just validate, don't fail — repair stage handles fixable mismatches
  return { ok: true, entry }
```

**Note on type mismatches:** Type mismatch detection (FR-005) is handled in the repair stage (Component 6), not in validation. Validation only fails on truly unrecoverable issues (unknown tool, missing required args). This separation keeps validation simple and lets repair apply type fixes.

---

### Component 6: `applyRepairs()` (repair stage)

**File:** `src/tools/tool-call-repair.ts` (private function)

**Purpose:** Apply deterministic fixes to the tool call and its arguments.

**Interface:**
```typescript
type RepairApplyResult = {
  /** The repaired tool call with normalized name and stringified arguments. */
  toolCall: ToolCall;
  /** The repaired arguments as a parsed object. */
  args: Record<string, unknown>;
};

function applyRepairs(
  toolCall: ToolCall,
  args: Record<string, unknown>,
  entry: { canonicalName: string; definition: ToolDefinition | undefined },
  registry: ToolRegistry
): RepairApplyResult;
```

**Internal Logic:**

```
function applyRepairs(toolCall, args, entry, registry):
  repairedArgs = { ...args }  // shallow copy
  repairedName = entry.canonicalName
  
  definition = entry.definition
  if definition is defined:
    properties = definition.function.parameters.properties ?? {}
    required = definition.function.parameters.required ?? []
    
    // Fix 1: Inject default values for missing optional args
    for key, schema of properties:
      if key not in repairedArgs and key not in required:
        if schema has "default" property:
          repairedArgs[key] = schema.default
    
    // Fix 2: Type coercion
    for key, value of repairedArgs:
      expectedType = properties[key]?.type
      if expectedType is defined:
        repairedArgs[key] = coerceType(key, value, expectedType)
  
  // Serialize repaired args back to JSON string
  serializedArgs = JSON.stringify(repairedArgs)
  
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
  }
```

**`coerceType(key, value, expectedType)` logic:**

```
function coerceType(key, value, expectedType):
  if expectedType == "string":
    if typeof value == "string": return value
    if Array.isArray(value) and value.length == 1: return String(value[0])
    if typeof value == "number": return String(value)
    return value  // can't coerce, leave as-is
  
  if expectedType == "array":
    if Array.isArray(value): return value
    if typeof value == "string": return [value]  // single string → array
    return value  // can't coerce
  
  if expectedType == "boolean":
    if typeof value == "boolean": return value
    if value == "true": return true
    if value == "false": return false
    if value == 1: return true
    if value == 0: return false
    return value  // can't coerce
  
  if expectedType == "number":
    if typeof value == "number": return value
    if typeof value == "string" and !isNaN(Number(value)): return Number(value)
    return value  // can't coerce
  
  if expectedType == "object":
    if typeof value == "object" and value != null and !Array.isArray(value): return value
    return value  // can't coerce
  
  return value
```

**Important:** Type coercion is conservative. If coercion is not clearly correct, the value is left unchanged. The tool handler will receive the original value and may reject it with a runtime error — worse UX than a pre-execution error, but safer than incorrect coercion.

---

### Component 7: `ToolExecutor` modifications

**File:** `src/tools/executor.ts` (MODIFIED)

**Changes:**

#### 7a. New imports
```typescript
import { repairToolCall, createRepairMetrics } from "./tool-call-repair";
import type { ToolCallRepairMetrics, ToolRegistry } from "./tool-call-repair";
import { getBuiltInToolDefinitions } from "../prompt";
import type { ToolDefinition } from "../prompt";
```

#### 7b. New private fields
```typescript
private readonly toolRegistry: ToolRegistry;
private repairMetrics: ToolCallRepairMetrics;
```

#### 7c. Constructor — build ToolRegistry
```typescript
constructor(projectRoot, createOpenAIClient?, mcpManager?, mcpPolicy?) {
  // ... existing init ...
  this.repairMetrics = createRepairMetrics();
  this.toolRegistry = this.buildToolRegistry();
}

private buildToolRegistry(): ToolRegistry {
  const builtInDefs = getBuiltInToolDefinitions();
  const builtInNames = new Map<string, ToolDefinition>();
  for (const def of builtInDefs) {
    builtInNames.set(def.function.name, def);
  }

  return {
    resolve: (name: string) => {
      const trimmed = name.trim();
      // 1. Exact match (case-sensitive) in built-in tools
      if (builtInNames.has(trimmed)) {
        return { canonicalName: trimmed, definition: builtInNames.get(trimmed) };
      }
      // 2. Case-insensitive match in built-in tools
      const lower = trimmed.toLowerCase();
      for (const [canonical, def] of builtInNames) {
        if (canonical.toLowerCase() === lower) {
          return { canonicalName: canonical, definition: def };
        }
      }
      // 3. MCP tools — exact match only (case-insensitive MCP added in Task 7)
      if (this.mcpManager?.isMcpTool(trimmed)) {
        return { canonicalName: trimmed, definition: undefined };
      }
      return undefined;
    },
    getAllNames: () => {
      const builtIn = [...builtInNames.keys()];
      const mcp = this.mcpManager?.getAllToolNames?.() ?? [];
      return [...builtIn, ...mcp].sort();
    },
  };
}
```

#### 7d. Modified `executeToolCall()`
```typescript
private async executeToolCall(
  sessionId: string,
  toolCall: ToolCall,
  hooks?: ToolExecutionHooks
): Promise<ToolExecutionResult> {
  // --- REPAIR PIPELINE (NEW) ---
  const repairResult = repairToolCall(toolCall, this.toolRegistry, this.repairMetrics);
  if ("error" in repairResult) {
    return {
      ok: false,
      name: toolCall.function.name,
      error: repairResult.error,
    };
  }
  const { toolCall: repaired, args } = repairResult;
  // --- END REPAIR PIPELINE ---

  const toolName = repaired.function.name;
  const handlerName = toolName; // no more BUILT_IN_TOOL_NAME_ALIASES needed
  const handler = this.toolHandlers.get(handlerName);
  if (!handler) {
    // Try MCP tools
    if (this.mcpManager?.isMcpTool(toolName)) {
      // ... existing MCP policy evaluation and execution ...
      // (unchanged, but uses repaired toolName and args)
    }
    return {
      ok: false,
      name: toolName,
      error: `Unknown tool: ${toolName}`,
    };
  }

  // Execute handler with repaired args (skip parseToolArguments since args already parsed)
  try {
    return await handler(args, {
      sessionId,
      projectRoot: this.projectRoot,
      toolCall: repaired,  // pass repaired toolCall
      // ... existing context props ...
    });
  } catch (error) {
    // ... existing error handling ...
  }
}
```

#### 7e. Modified `executeToolCalls()` — preserve failed repairs
```typescript
async executeToolCalls(
  sessionId: string,
  toolCalls: unknown[],
  hooks?: ToolExecutionHooks
): Promise<ToolCallExecution[]> {
  const parsedCalls = toolCalls
    .map((toolCall) => this.parseToolCall(toolCall))
    .filter((toolCall): toolCall is ToolCall => Boolean(toolCall));

  const executions: ToolCallExecution[] = [];
  for (const toolCall of parsedCalls) {
    if (hooks?.shouldStop?.()) break;
    const result = await this.executeToolCall(sessionId, toolCall, hooks);
    executions.push({
      toolCallId: toolCall.id,
      content: this.formatToolResult(result),
      result,
    });
    if (hooks?.shouldStop?.()) break;
  }
  return executions;
}
```
No change to the loop structure — `executeToolCall` now returns errors for failed repairs instead of them being silently filtered. The `.filter(Boolean)` on `parsedCalls` only drops truly unrecognizable blobs (not objects, no `id`, no `function`), which is correct.

#### 7f. New public methods
```typescript
getRepairMetrics(): ToolCallRepairMetrics {
  return this.repairMetrics;
}

resetRepairMetrics(): void {
  this.repairMetrics = createRepairMetrics();
}
```

#### 7g. Removals
- Remove `BUILT_IN_TOOL_NAME_ALIASES` constant (lines 114-119).
- Remove or inline `normalizeToolArguments()` (lines 121-133) — its functionality is subsumed by the repair pipeline's parse stage. However, keep it for the `parseToolCall` path where arguments might be an object (non-string). The repair pipeline expects a string; `normalizeToolArguments` handles this normalization before repair.

---

### Component 8: `parseToolArguments` — deprecation

**File:** `src/tools/executor.ts` (MODIFIED)

The existing `parseToolArguments` method (lines 315-337) is NO LONGER CALLED from `executeToolCall`. It may be:
- Kept as a private method (dead code, harmless).
- Removed if no other callers exist.

**Decision:** Keep it but add `// @deprecated — superseded by repairToolCall() parse stage` comment. Remove the call from `executeToolCall`. If no compilation errors, remove entirely in a follow-up cleanup.

Actually, check callers:
- Called in `executeToolCall` at line 282 (for built-in tools), lines 266 and 271 (for MCP tools).
- All three call sites are inside `executeToolCall` and will be replaced by the repair pipeline.

**Action:** Remove the `parseToolArguments` method and its three call sites inside `executeToolCall`. The repair pipeline produces parsed `args` directly.

---

## Data Flow

### Flow 1: Well-formed tool call (fast path — 99% of calls)

```
LLM emits → session.ts collects tool_calls[] → executeToolCalls()
  → parseToolCall(rawCall) → ToolCall { id, function: { name: "bash", arguments: '{"command":"ls","sideEffects":["read-in-cwd"]}' } }
  → executeToolCall(toolCall)
    → repairToolCall(toolCall, registry, metrics)
      → Stage 1 (Parse): JSON.parse succeeds → { command: "ls", sideEffects: ["read-in-cwd"] }
      → Stage 2 (Validate): registry.resolve("bash") → { canonicalName: "bash", definition: {...} }
        → required args ["command", "sideEffects"] present ✓
      → Stage 3 (Repair): no defaults to inject, no types to coerce
      → Return { toolCall (unchanged), args }
    → handler = toolHandlers.get("bash") ✓
    → handler(args, context) → ToolExecutionResult
  → Return ToolCallExecution
```

### Flow 2: Malformed JSON (DeepSeek Windows path)

```
LLM emits → ToolCall { arguments: '{"path":"C:\git\dscode"}' }
  → repairToolCall()
    → Stage 1 (Parse): JSON.parse throws SyntaxError (unescaped backslash)
      → fixUnescapedBackslashes: '{"path":"C:\\git\\dscode"}'
      → JSON.parse succeeds → { path: "C:\\git\\dscode" }
    → Stage 2 (Validate): "read" → ✓
    → Stage 3 (Repair): no changes needed
    → Return { toolCall (arguments reserialized), args }
  → metrics.repairedCalls++, stageSuccesses.parse++
```

### Flow 3: Unknown tool name (unrecoverable)

```
LLM emits → ToolCall { function: { name: "bush", arguments: '{"command":"ls"}' } }
  → repairToolCall()
    → Stage 1 (Parse): JSON.parse succeeds
    → Stage 2 (Validate): registry.resolve("bush") → undefined
      → Attempt 1 fails
    → Stage 1 again: parse still succeeds
    → Stage 2 again: registry.resolve("bush") → still undefined
      → Attempt 2 fails → return { error: "Unknown tool: bush. Available tools: bash, read, write, ..." }
  → executeToolCall returns { ok: false, name: "bush", error: "..." }
  → metrics.totalCalls++, metrics.failedRepairs++
```

### Flow 4: Missing required arg (recoverable — LLM can retry)

```
LLM emits → ToolCall { function: { name: "bash", arguments: '{"command":"ls"}' } }
  → repairToolCall()
    → Stage 1: parse succeeds → { command: "ls" }
    → Stage 2: required ["command", "sideEffects"], missing ["sideEffects"]
      → Attempt 1 fails
    → Stage 1 again: parse still succeeds
    → Stage 2 again: still missing
      → Attempt 2 fails → return { error: "Missing required arguments for bash: sideEffects" }
  → executeToolCall returns { ok: false, error: "..." }
```

---

## Data Structures

### `ToolCall` (existing, no changes)
```typescript
// src/tools/executor.ts (unchanged)
export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
};
```

### `ToolDefinition` (existing, no changes)
```typescript
// src/prompt.ts (unchanged)
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>; // JSON Schema properties
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};
```

### `ToolRegistry` (new)
```typescript
// src/tools/tool-call-repair.ts
export type ToolRegistry = {
  resolve(name: string): { canonicalName: string; definition: ToolDefinition | undefined } | undefined;
  getAllNames(): string[];
};
```

### `ToolCallRepairMetrics` (new)
See Component 2 above.

---

## File / Module Layout

| File | Action | Purpose |
|------|--------|---------|
| `src/tools/tool-call-repair.ts` | **CREATE** | Pure repair pipeline: `repairToolCall()`, `ToolRegistry` type, `ToolCallRepairMetrics` type, `createRepairMetrics()`, internal parse/validate/repair functions |
| `src/tools/executor.ts` | **MODIFY** | Integrate repair pipeline into `executeToolCall()`, build `ToolRegistry` from built-in + MCP tools, add metrics methods, remove `BUILT_IN_TOOL_NAME_ALIASES`, remove `parseToolArguments` |
| `src/tests/tool-call-repair.test.ts` | **CREATE** | Unit tests for all repair strategies (parse recovery, validate, repair) |

**Files NOT modified:**
- `src/session.ts` — calls `executeToolCalls()`, interface unchanged.
- `src/prompt.ts` — `ToolDefinition` and `getBuiltInToolDefinitions()` unchanged.
- `src/mcp/mcp-manager.ts` — `isMcpTool()` and tool listing unchanged.
- `src/tests/tool-executor.test.ts` — existing tests pass unchanged (valid tool calls unaffected).

---

## Testing Strategy

### Test file: `src/tests/tool-call-repair.test.ts`

**Test organization:**
```typescript
// Group: Parse Stage — JSON Recovery
test("valid JSON returns unchanged")
test("empty string returns empty object")
test("unescaped Windows path backslash")
test("unescaped quote inside string value")
test("trailing comma in object")
test("trailing comma in array")
test("truncated JSON — missing closing brace")
test("truncated JSON — missing closing bracket")
test("truncated JSON — missing colon and value")
test("truncated JSON — mid-string cutoff")
test("combined issues — backslash + trailing comma")
test("completely malformed non-JSON string")
test("arguments as array (not object)")

// Group: Validate Stage — Tool Registry
test("exact tool name match")
test("case-insensitive tool name match")
test("whitespace-trimmed tool name match")
test("unknown tool name returns error with available tools list")
test("missing required arguments detected")
test("multiple missing required arguments listed")
test("optional args only — no missing error")
test("MCP tool without definition passes validation")

// Group: Repair Stage — Fixes
test("default value injected for missing optional arg")
test("default value NOT injected when arg explicitly provided")
test("type coercion — string to array (single string)")
test("type coercion — array to string (single element)")
test("type coercion — number to string")
test("type coercion — truthy to boolean")
test("type coercion — 'true' string to boolean")
test("type coercion — 'false' string to boolean")
test("type coercion — non-coercible type left unchanged")
test("tool name normalized to canonical form")

// Group: Pipeline Integration
test("max 2 attempts — unrecoverable error")
test("fast path — valid call adds < 0.1ms")
test("metrics — totalCalls incremented")
test("metrics — repairedCalls incremented on repair")
test("metrics — failedRepairs incremented on failure")
test("metrics — per-stage successes counted")
test("metrics — latency measured")
test("recentCalls — last 100 calls recorded")
```

**Mock ToolRegistry for tests:**
```typescript
function createMockRegistry(overrides?: Partial<Record<string, ToolDefinition>>): ToolRegistry {
  const builtIn = getBuiltInToolDefinitions();
  const map = new Map<string, ToolDefinition>();
  for (const def of builtIn) map.set(def.function.name, def);
  if (overrides) {
    for (const [name, def] of Object.entries(overrides)) {
      map.set(name, def);
    }
  }
  return {
    resolve: (name) => {
      const trimmed = name.trim();
      if (map.has(trimmed)) return { canonicalName: trimmed, definition: map.get(trimmed) };
      const lower = trimmed.toLowerCase();
      for (const [canonical, def] of map) {
        if (canonical.toLowerCase() === lower) return { canonicalName: canonical, definition: def };
      }
      return undefined;
    },
    getAllNames: () => [...map.keys()].sort(),
  };
}
```

### Existing tests — verification
- `src/tests/tool-executor.test.ts` — must pass unchanged. The single test "ToolExecutor accepts title-case built-in tool aliases" should still pass because repair pipeline handles case-insensitive matching.
- `npm test` — 173 pass, 0 fail baseline must be maintained.

---

## Migration / Rollback

### Migration
- No data migration needed. No settings changes. No user-facing configuration.
- All existing tool calls continue to work — the repair pipeline is purely additive.

### Rollback
- Remove the call to `repairToolCall()` in `executeToolCall()`.
- Restore `parseToolArguments()` call (the method is removed; rollback would re-add it).
- Restore `BUILT_IN_TOOL_NAME_ALIASES`.
- No data or state is affected.
