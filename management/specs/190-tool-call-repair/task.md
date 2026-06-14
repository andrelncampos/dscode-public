# Spec 190: Tool-Call Repair — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

---

## Tasks

### Task 1: Create `tool-call-repair.ts` — Types and Empty Shell

**Objective:** Create the new module file with all type definitions and the function signature skeleton. No implementation logic yet — just types, interfaces, and stub functions that compile.

**Requirements Covered:** Foundation for FR-001 through FR-010.

**Design References:** Components 1 (`ToolRegistry`), 2 (`ToolCallRepairMetrics`), 3 (`repairToolCall` signature).

**Actions:**
1. Create file `src/tools/tool-call-repair.ts`.
2. Import `ToolCall` from `./executor` and `ToolDefinition` from `../prompt`.
3. Define and export `ToolRegistry` type (Component 1).
4. Define and export `StageOutcome`, `SingleCallRepairMetrics`, `ToolCallRepairMetrics` types (Component 2).
5. Define and export `createRepairMetrics()` function that returns a zeroed `ToolCallRepairMetrics`.
6. Define and export `RepairSuccess` and `RepairFailure` types (Component 3).
7. Define and export `repairToolCall()` function signature with a stub body that returns the unmodified `ToolCall` as `RepairSuccess` (fast-path placeholder — always succeeds with no repair).
8. Run `npx tsc --noEmit` to verify the new file compiles without errors.

**Validation:**
- `npx tsc --noEmit` passes with 0 errors.
- File exists at `src/tools/tool-call-repair.ts`.
- All types are exported and importable from the module.

**Status:** [x] done

---

### Task 2: Implement Parse Stage — JSON Recovery Functions

**Objective:** Implement all four JSON recovery strategies and integrate them into the `tryParseWithRecovery()` function.

**Requirements Covered:** FR-001 (unescaped chars), FR-002 (truncated JSON).

**Design References:** Component 4 (`tryParseWithRecovery`), internal logic pseudocode.

**Actions:**
1. In `src/tools/tool-call-repair.ts`, add private functions (not exported):
   - `fixUnescapedBackslashes(raw: string): string`
   - `fixTrailingCommas(raw: string): string`
   - `fixUnescapedQuotes(raw: string): string`
   - `completeTruncatedJson(raw: string): string`
2. Implement `fixUnescapedBackslashes`: scan character by character. When `\` is found and next char is not a valid JSON escape char (`"`, `\`, `/`, `b`, `f`, `n`, `r`, `t`, `u`), insert an additional `\`.
3. Implement `fixTrailingCommas`: `raw.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")`.
4. Implement `fixUnescapedQuotes`: parse the raw string manually, tracking whether we're inside a string value. When a bare `"` is encountered inside a string, escape it as `\"`.
5. Implement `completeTruncatedJson`: count `{` vs `}` and `[` vs `]`. Close any unclosed structures. Handle mid-string truncation (odd number of unescaped quotes) by appending `"` before closing braces.
6. Implement `tryParseWithRecovery(raw: string)` following the 6-step logic from Component 4:
   - Step 1: direct `JSON.parse`
   - Step 2: fix backslashes → parse
   - Step 3: fix trailing commas → parse
   - Step 4: fix quotes → parse
   - Step 5: complete truncation → parse
   - Step 6: combined (all fixes sequentially) → parse
   - All catch blocks fall through to next step.
7. Import `tryParseWithRecovery` in `repairToolCall` stub (replace the placeholder that just does `JSON.parse`).
8. Run `npx tsc --noEmit` to verify compilation.

**Validation:**
- `npx tsc --noEmit` passes.
- Manual test: `tryParseWithRecovery('{"path":"C:\\git\\dscode"}')` returns `{ ok: true, args: { path: "C:\\git\\dscode" } }`.

**Status:** [x] done

---

### Task 3: Implement Validate and Repair Stages

**Objective:** Implement the validate and repair stages, then wire the full 3-stage pipeline with max 2 attempts.

**Requirements Covered:** FR-003 (name normalization), FR-004 (required arg validation), FR-005 (type mismatch), FR-006 (default injection), FR-007 (max 2 attempts), FR-010 (silent failure elimination).

**Design References:** Components 5 (`validateAgainstRegistry`), 6 (`applyRepairs`), 3 (`repairToolCall` full logic).

**Actions:**
1. In `src/tools/tool-call-repair.ts`, add private functions:
   - `validateAgainstRegistry(toolName: string, args: Record<string, unknown>, registry: ToolRegistry): ValidateResult`
   - `coerceType(key: string, value: unknown, expectedType: string): unknown`
   - `applyRepairs(toolCall: ToolCall, args: Record<string, unknown>, entry: { canonicalName: string; definition: ToolDefinition | undefined }, registry: ToolRegistry): RepairApplyResult`
2. Implement `validateAgainstRegistry`:
   - Call `registry.resolve(toolName.trim())`.
   - If undefined, return error with "Unknown tool: X. Available tools: ..." (list all names from registry). Note: to list all names, extend `ToolRegistry` with an optional `getAllNames?: () => string[]` method, or accept a pre-computed names list. **Design choice:** add `getAllNames(): string[]` to the `ToolRegistry` type. Update the type definition exported from this module.
   - If definition exists, check `required` array against `args` keys. List all missing args in error.
   - If definition is undefined (MCP tool), skip arg validation — return success.
3. Implement `coerceType` following Component 6 pseudocode (string, array, boolean, number, object coercion).
4. Implement `applyRepairs` following Component 6 pseudocode:
   - Shallow copy args.
   - Inject defaults from `definition.function.parameters.properties[].default` for missing non-required keys.
   - Apply `coerceType` to each arg with a known type.
   - Normalize tool name to `entry.canonicalName`.
   - Serialize repaired args with `JSON.stringify`.
   - Return `RepairApplyResult`.
5. Replace the `repairToolCall` stub with the full pipeline:
   - Track start time with `performance.now()`.
   - Initialize per-call metrics.
   - Loop `[1, 2]` attempts.
   - Stage 1: `tryParseWithRecovery` → on failure, update metrics, continue loop (or return error on attempt 2).
   - Stage 2: `validateAgainstRegistry` → on failure, update metrics, continue loop (or return error on attempt 2).
   - Stage 3: `applyRepairs` → success, update metrics, return `RepairSuccess`.
   - After loop exits (shouldn't reach if attempt 2 errors properly), return `RepairFailure`.
6. Run `npx tsc --noEmit` to verify.

**Validation:**
- `npx tsc --noEmit` passes.
- `repairToolCall({ id: "1", type: "function", function: { name: "Bash", arguments: '{"command":"ls","sideEffects":["read-in-cwd"]}' } }, mockRegistry, metrics)` returns repaired ToolCall with `function.name === "bash"`.

**Status:** [x] done

---

### Task 4: Create Unit Tests for `tool-call-repair.ts`

**Objective:** Create `src/tests/tool-call-repair.test.ts` with comprehensive tests covering all repair strategies.

**Requirements Covered:** All FR-001 through FR-007, FR-010.

**Design References:** Testing Strategy section in design.md (37 test cases).

**Actions:**
1. Create file `src/tests/tool-call-repair.test.ts`.
2. Import from `node:test` (`test`, `afterEach`) and `node:assert/strict`.
3. Import `repairToolCall`, `createRepairMetrics`, `ToolCallRepairMetrics`, `ToolRegistry` from `../tools/tool-call-repair`.
4. Import `ToolCall` from `../tools/executor`.
5. Import `getBuiltInToolDefinitions` from `../prompt`.
6. Create helper `makeToolCall(name: string, args: string): ToolCall` → `{ id: "test-1", type: "function", function: { name, arguments: args } }`.
7. Create helper `createMockRegistry(overrides?: [...]): ToolRegistry` (from design Testing Strategy).
8. Implement test cases in groups:
   - **Parse stage (13 tests):** valid JSON unchanged, empty string → {}, unescaped backslash, unescaped quote, trailing comma object, trailing comma array, truncated brace, truncated bracket, truncated colon+value, mid-string cutoff, combined backslash+comma, non-JSON string, array not object.
   - **Validate stage (8 tests):** exact match, case-insensitive match, whitespace trimmed, unknown tool with available tools list, missing required args, multiple missing args, optional-only args, MCP without definition passes.
   - **Repair stage (10 tests):** default injection, default not overwriting explicit, string→array coercion, array→string coercion, number→string coercion, truthy→boolean, "true"→boolean, "false"→boolean, non-coercible unchanged, name normalization.
   - **Pipeline integration (8 tests):** max 2 attempts unrecoverable, fast path < 0.1ms, totalCalls incremented, repairedCalls incremented, failedRepairs incremented, stageSuccesses counted, latency measured, recentCalls ≤ 100.
9. Run tests: `npx tsx --test src/tests/tool-call-repair.test.ts`.

**Validation:**
- All test cases pass (expected ~37 pass).
- `npx tsx --test src/tests/tool-call-repair.test.ts` exits with code 0.

**Status:** [x] done

---

### Task 5: Integrate Repair Pipeline into `ToolExecutor`

**Objective:** Modify `ToolExecutor` to use the repair pipeline. Remove hardcoded aliases and redundant parsing logic. Add metrics tracking.

**Requirements Covered:** FR-003 (name normalization via registry), FR-008 (metrics collection), FR-009 (permission pipeline preservation), FR-010 (silent failure elimination).

**Design References:** Component 7 (`ToolExecutor` modifications), Component 8 (`parseToolArguments` deprecation).

**Actions:**
1. In `src/tools/executor.ts`, add imports:
   ```typescript
   import { repairToolCall, createRepairMetrics } from "./tool-call-repair";
   import type { ToolCallRepairMetrics, ToolRegistry } from "./tool-call-repair";
   import { getBuiltInToolDefinitions } from "../prompt";
   import type { ToolDefinition } from "../prompt";
   ```
2. Add private fields to `ToolExecutor` class:
   ```typescript
   private repairMetrics: ToolCallRepairMetrics;
   private readonly toolRegistry: ToolRegistry;
   ```
3. In constructor, after `this.registerToolHandlers()`:
   ```typescript
   this.repairMetrics = createRepairMetrics();
   this.toolRegistry = this.buildToolRegistry();
   ```
4. Add private method `buildToolRegistry(): ToolRegistry`:
   - Load `getBuiltInToolDefinitions()`.
   - Build a `Map<string, ToolDefinition>` from built-in defs keyed by `function.name`.
   - Return `{ resolve, getAllNames }` object where:
     a. `resolve`: Checks exact match in map.
     b. `resolve`: Checks case-insensitive match (iterate map keys, compare `toLowerCase()`).
     c. `resolve`: If `this.mcpManager` is available, check `isMcpTool(trimmed)` for exact MCP match → return `{ canonicalName: trimmed, definition: undefined }`. Case-insensitive MCP matching is deferred to Task 7 (requires `getAllToolNames()` from Task 6).
     d. `getAllNames`: Returns combined built-in tool names + MCP tool names (via `this.mcpManager?.getAllToolNames?.() ?? []`), sorted alphabetically.
5. Remove constant `BUILT_IN_TOOL_NAME_ALIASES` (lines 114-119).
6. In `executeToolCall()` method:
   - At the top of the method (after existing signature), insert repair pipeline call:
     ```typescript
     const repairResult = repairToolCall(toolCall, this.toolRegistry, this.repairMetrics);
     if ("error" in repairResult) {
       return { ok: false, name: toolCall.function.name, error: repairResult.error };
     }
     const { toolCall: repaired, args } = repairResult;
     ```
   - Replace all subsequent uses of `toolCall` with `repaired`:
     - `const toolName = repaired.function.name;` (line 248).
     - `const handlerName = toolName;` (replace line 249: `const handlerName = BUILT_IN_TOOL_NAME_ALIASES.get(toolName) ?? toolName;`).
     - MCP policy evaluation uses `toolName` (already resolved).
   - Remove the `parseToolArguments` calls (lines 266, 271, 282) — use `args` directly from repair result.
   - In the handler call, pass `toolCall: repaired` (line 295).
7. Remove `parseToolArguments` method (lines 315-337) — check if it's used elsewhere first. Only remove if no other callers.
8. Add public methods:
   ```typescript
   getRepairMetrics(): ToolCallRepairMetrics {
     return this.repairMetrics;
   }
   resetRepairMetrics(): void {
     this.repairMetrics = createRepairMetrics();
   }
   ```
9. Run `npx tsc --noEmit` to verify compilation.

**Validation:**
- `npx tsc --noEmit` passes with 0 errors.
- Existing test `src/tests/tool-executor.test.ts` passes: `npx tsx --test src/tests/tool-executor.test.ts`.
- The test "ToolExecutor accepts title-case built-in tool aliases" still passes (case-insensitive match via `toolRegistry.resolve`).

**Status:** [x] done

---

### Task 6: Update `McpManager` (if needed) for Tool Name Listing

**Objective:** If `McpManager` does not expose a method to list all MCP tool names, add it. This is needed for the `ToolRegistry.resolve()` case-insensitive MCP lookup and for the "Available tools" error message.

**Requirements Covered:** FR-003 (MCP tool name normalization), FR-004 (available tools in error messages).

**Design References:** Component 7d step 4c (case-insensitive MCP match), Component 7a step 1.

**Actions:**
1. Open `src/mcp/mcp-manager.ts`.
2. Check if a method exists that returns all tool names across all MCP servers (e.g., `getAllToolNames(): string[]`).
3. If not found, add method:
   ```typescript
   getAllToolNames(): string[] {
     const names: string[] = [];
     for (const server of this.servers.values()) {
       if (server.tools) {
         for (const tool of server.tools) {
           names.push(`mcp__${server.name}__${tool.name}`);
         }
       }
     }
     return names.sort();
   }
   ```
4. Check if `isMcpTool()` exists (line 588). If not, note its signature.
5. Verify no TypeScript compilation errors: `npx tsc --noEmit`.
6. **If a suitable method already exists**, skip this task and mark it `[x] skipped — not needed`.

**Validation:**
- `npx tsc --noEmit` passes.
- Method returns a string array of all MCP tool names.

**Status:** [x] done

---

### Task 7: Add Case-Insensitive MCP Matching to `buildToolRegistry()`

**Objective:** Extend `buildToolRegistry()` in `ToolExecutor` to support case-insensitive MCP tool name matching, using the `getAllToolNames()` method added in Task 6 (if needed).

**Requirements Covered:** FR-003 (MCP case-insensitive matching).

**Design References:** Component 7c (`buildToolRegistry`).

**Actions:**
1. In `src/tools/executor.ts`, update `buildToolRegistry()`:
   - In the `resolve` function, after the exact MCP match (`isMcpTool(trimmed)`), add a case-insensitive fallback:
     ```typescript
     // 4. Case-insensitive MCP match
     const mcpNames = this.mcpManager?.getAllToolNames?.() ?? [];
     const lowerName = trimmed.toLowerCase();
     const match = mcpNames.find(n => n.toLowerCase() === lowerName);
     if (match) {
       return { canonicalName: match, definition: undefined };
     }
     ```
   - If `getAllToolNames()` is not available (Task 6 was skipped), skip this step — MCP case-insensitive matching is a best-effort enhancement.
2. Run `npx tsc --noEmit`.

**Validation:**
- `npx tsc --noEmit` passes.
- `toolRegistry.resolve("mcp__GITHUB__create_issue")` (case-different from actual) returns corrected case.
- `toolRegistry.resolve("MCP__SERVER__TOOL")` (uppercase) → matches correctly if MCP server registers `mcp__server__tool`.

**Status:** [x] done

---

### Task 8: Run Full Test Suite — Verify Zero Regressions

**Objective:** Execute the complete test suite to verify that all existing tests pass and new repair tests pass.

**Requirements Covered:** NFR-001 (zero regressions), NFR-004 (test coverage).

**Design References:** Testing Strategy (existing tests verification).

**Actions:**
1. Run full test suite: `npm test`.
2. Verify: 0 new failures. Expected: ~210 pass (173 original + ~37 new repair tests).
3. Run TypeScript compiler check: `npx tsc --noEmit`. Verify 0 errors.
4. Run ESLint: `npx eslint src/tools/tool-call-repair.ts src/tools/executor.ts src/tests/tool-call-repair.test.ts`. Fix any warnings.
5. If any test fails, diagnose and fix BEFORE marking this task done. Do not proceed to mark spec as implemented with test failures.

**Validation:**
- `npm test` exits with code 0.
- `npx tsc --noEmit` exits with code 0.
- `npx eslint` reports 0 errors, 0 warnings on new/modified files.

**Status:** [ ] pending
