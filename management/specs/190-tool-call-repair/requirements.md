# Spec 190: Tool-Call Repair — Requirements

## Value Delivery

> **V23: Automatic Tool-Call Repair**
>
> Deterministic repair of malformed LLM tool calls before execution — reducing silent
> failures and improving robustness without adding LLM calls or compromising permissions.
>
> - **Three-stage repair pipeline:**
>   1. **Parse:** Attempt `JSON.parse` on string arguments. Handle object arguments directly.
>      Recover from truncated JSON and unescaped characters.
>   2. **Validate:** Check that the tool name exists in the tool registry. Verify required
>      arguments are present. Detect type mismatches.
>   3. **Repair:** Apply deterministic fixes — trim whitespace, lowercase tool names,
>      inject default values for missing optional arguments.
> - **Controlled retry:** Maximum 2 repair attempts per tool call. If repair fails, return
>   a clear error to the LLM (not silent failure).
> - **Permission-safe:** Repair does not bypass `allow/ask/deny` gates. Repaired tool calls
>   go through the same permission pipeline as original calls.
> - **Repair metrics:** Track how many tool calls were repaired, which stage succeeded, and
>   repair latency — visible in debug logs and MCP execution history.
> - **Provider-agnostic:** Works for all LLM providers. DeepSeek historically benefits most
>   (common JSON escaping issues), but the pipeline is universal.

---

## Functional Requirements

### FR-001: Malformed JSON Recovery — Unescaped Characters

**What:** When tool call `arguments` is a JSON string containing unescaped special characters (backslashes in Windows paths, unescaped quotes, bare control characters), the repair pipeline must recover the intended JSON object without data loss.

**Why:** DeepSeek V4 frequently emits Windows paths like `C:\git\dscode` inside JSON strings without escaping the backslash (`C:\\git\\dscode`). This causes `JSON.parse` to throw `SyntaxError`. Without repair, the tool call fails silently (current behavior: `parseToolArguments` returns `{ ok: false, error }`).

**Acceptance Criteria:**
- [ ] `JSON.parse('{"path":"C:\\git\\dscode"}')` fails; `repairToolCall` returns `{ path: "C:\\git\\dscode" }` (unescaped backslash recovered).
- [ ] `JSON.parse('{"text":"say \\"hello\\""}')` fails; `repairToolCall` returns `{ text: 'say "hello"' }` (unescaped quote recovered).
- [ ] Valid JSON passes through unchanged — zero modification, zero overhead beyond `JSON.parse`.
- [ ] Recovery does NOT alter intentional escape sequences already correctly encoded by the LLM.

### FR-002: Malformed JSON Recovery — Truncated JSON

**What:** When tool call `arguments` is a truncated JSON string (missing closing `}` or `]`, cutoff mid-string), the repair pipeline must attempt structural completion. If unrecoverable (e.g., truncated mid-key), return a clear parse error.

**Why:** LLM streaming can produce truncated tool calls when token limits are hit mid-generation. Current behavior returns `InputParseError: Failed to parse tool arguments: ...` — the LLM sees only a generic error and must retry blindly.

**Acceptance Criteria:**
- [ ] `'{"command":"ls","sideEffects"'` (truncated after key, missing colon+value+brace) → repair attempts structural completion by appending `:false}` with reasonable defaults.
- [ ] `'{"command":"ls","sideEffects":["read'` (truncated mid-array-string) → repair attempts to close the array and object.
- [ ] `'{"file_path":"/tmp/test.txt"}'` (valid, complete) → zero modification.
- [ ] `'{"file_path":'` (truncated mid-value) → returns unrecoverable error with specific message indicating truncation point.

### FR-003: Tool Name Normalization

**What:** When a tool call's `function.name` differs from the registered tool name only by casing or surrounding whitespace, the repair pipeline must normalize it to the registered name.

**Why:** LLMs sometimes emit `"Bash"` instead of `"bash"`, or `"  bash  "` with whitespace. The current code has a hardcoded `BUILT_IN_TOOL_NAME_ALIASES` map with only 4 entries (`Bash`, `Read`, `Write`, `Edit`). Every new alias requires a code change.

**Acceptance Criteria:**
- [ ] `"Bash"` → matches `"bash"` handler (case-insensitive).
- [ ] `"  bash  "` → matches `"bash"` handler (whitespace trimmed).
- [ ] `"BASH"` → matches `"bash"` handler.
- [ ] `"Read"` → matches `"read"` handler.
- [ ] `"Write"` → matches `"write"` handler.
- [ ] `"Edit"` → matches `"edit"` handler.
- [ ] `"WebFetch"` → matches `"WebFetch"` handler (exact case already).
- [ ] `"nonexistent_tool"` → no match, error returned (validation failure, not crash).
- [ ] MCP tools (`mcp__server__tool`) are also matched case-insensitively.
- [ ] Ambiguous case-insensitive matches (e.g., `"bash"` and `"Bash"` both registered) → prefer exact match; if no exact match, prefer first alphabetical match with deterministic order.

### FR-004: Required Argument Validation

**What:** Before executing a tool call, the repair pipeline must verify that all `required` arguments from the tool's `ToolDefinition.parameters.required` array are present in the call's parsed arguments.

**Why:** Missing required arguments cause runtime errors inside tool handlers that are harder to diagnose than a pre-execution validation error. Catching them before execution gives the LLM a clear, actionable error message.

**Acceptance Criteria:**
- [ ] `bash` tool called without `command` → validation error listing `"command"` as missing required argument.
- [ ] `bash` tool called without `sideEffects` → validation error listing `"sideEffects"` as missing required argument.
- [ ] `bash` tool called with both `command` and `sideEffects` → passes validation.
- [ ] The error message includes: (a) tool name, (b) list of missing required arguments, (c) hint to retry with complete arguments.
- [ ] Validation is skipped for MCP tools whose `ToolDefinition` is not available locally (the MCP server validates on its side).

### FR-005: Type Mismatch Detection

**What:** When a tool call argument's runtime type does not match the declared type in `ToolDefinition.parameters.properties`, the repair pipeline must detect it. If the mismatch is safely correctable, repair it; otherwise, report the mismatch as a validation error.

**Why:** LLMs occasionally emit `"sideEffects": "read-in-cwd"` (string) instead of `"sideEffects": ["read-in-cwd"]` (array of strings). Executing with a string where an array is expected causes undefined behavior in tool handlers.

**Acceptance Criteria:**
- [ ] `"sideEffects": "read-in-cwd"` where schema expects `array` → repair wraps as `["read-in-cwd"]` (single string → array).
- [ ] `"command": ["ls"]` where schema expects `string` → repair unwraps to `"ls"` (single-element array → string).
- [ ] `"run_in_background": 1` where schema expects `boolean` → repair coerces to `true` (truthy → true).
- [ ] `"run_in_background": "true"` where schema expects `boolean` → repair coerces to `true` (string "true" → boolean).
- [ ] `"command": 123` where schema expects `string` → repair coerces to `"123"` (number → string via String()).
- [ ] `"sideEffects": true` where schema expects `array` → cannot repair, validation error with type mismatch detail.
- [ ] Boolean coercion: only `"true"` → `true`; `"false"` → `false`; any other string → error.

### FR-006: Default Value Injection for Missing Optional Arguments

**What:** When a tool call omits an optional argument that has a `default` annotation in its `ToolDefinition.parameters.properties` schema, the repair pipeline must inject the default value.

**Why:** Reduces LLM token consumption — the LLM doesn't need to emit `"run_in_background": false` or `"description": ""` for every bash call. The repair pipeline fills these in deterministically.

**Acceptance Criteria:**
- [ ] `bash` tool called without `description` → injected as `""` (empty string default).
- [ ] `bash` tool called without `run_in_background` → injected as `false` (boolean default).
- [ ] `bash` tool called with explicit `run_in_background: true` → NOT overwritten.
- [ ] `AskUserQuestion` called without `multiSelect` → injected as `false`.
- [ ] Default injection only applies when the argument is truly absent from the call. `null`, `0`, `""`, and `false` are explicit values — do NOT overwrite.
- [ ] If the schema does NOT declare a `default`, the argument is left absent (no injection).

### FR-007: Maximum 2 Repair Attempts

**What:** The repair pipeline must make at most 2 full repair cycles (Parse → Validate → Repair) per tool call. If the second repair attempt still fails validation, return a clear error — never loop indefinitely.

**Why:** Prevent infinite loops when a truly malformed tool call cannot be repaired. The LLM gets a clear, actionable error and can retry with corrected arguments.

**Acceptance Criteria:**
- [ ] First repair attempt: apply all applicable repairs from FR-001 through FR-006.
- [ ] Second repair attempt: if first attempt still fails validation, apply remaining/alternative repair strategies (e.g., more aggressive truncation recovery).
- [ ] After 2 failed attempts, return `{ ok: false, error: "ToolCallRepairFailed: ..." }` with specific details about what could not be repaired.
- [ ] Simulate an unrecoverable tool call (e.g., `{"foo": bar` with no closable structure) → exactly 2 attempts, then error.

### FR-008: Repair Metrics Collection

**What:** The repair pipeline must collect statistics about every tool call processed: whether repair was attempted, which stages succeeded, and latency. Metrics are exposed via a structured object (not logs) for programmatic consumption.

**Why:** Operators and developers need visibility into repair effectiveness. Are 90% of DeepSeek tool calls being repaired? Is repair latency acceptable?

**Acceptance Criteria:**
- [ ] Metrics include: `totalCalls`, `repairedCalls`, `failedRepairs`, `stageSuccesses: { parse, validate, repair }`, `totalRepairLatencyMs`, `perStageLatencyMs: { parse, validate, repair }`.
- [ ] Metrics are accumulated per session (not per call). Each `ToolExecutor` instance tracks its own metrics.
- [ ] Metrics can be retrieved via `toolExecutor.getRepairMetrics(): ToolCallRepairMetrics`.
- [ ] Metrics can be reset via `toolExecutor.resetRepairMetrics()`.
- [ ] Metrics are included in debug logs at session end alongside other session stats.
- [ ] Repair latency is measured with sub-millisecond precision (use `performance.now()` for pure function timing, avoid `Date.now()`).

### FR-009: Permission Pipeline Preservation

**What:** Repaired tool calls must go through the exact same permission flow as unrepaired calls. The repair pipeline operates BEFORE permission evaluation — it modifies the tool call structure, not the authorization decision.

**Why:** Security boundary. Repair must never be a backdoor to bypass `allow/ask/deny` rules. A repaired `bash` call with `sideEffects: ["write-out-cwd"]` must still trigger the same permission prompt.

**Acceptance Criteria:**
- [ ] Repair happens in `executeToolCall()` before the handler lookup and MCP policy evaluation.
- [ ] The `ToolCall` object passed to permission-sensitive code (MCP policy, hooks) is the repaired version.
- [ ] No tool call that was originally blocked by policy becomes executable after repair.
- [ ] Test: a repaired MCP tool call with `deny` policy still returns `"blocked by steering policy"` error.

### FR-010: Silent Failure Elimination

**What:** The current `parseToolCall()` returns `null` for invalid tool calls, which are silently filtered out by `.filter(Boolean)`. The repair pipeline must never silently drop a tool call — every failure produces a visible error in the tool execution result.

**Why:** Silent failures are the worst debugging experience. The LLM and user have no visibility into why a tool call was ignored. All failures must be surfaced.

**Acceptance Criteria:**
- [ ] Invalid tool calls that fail repair are NOT filtered out — they produce a `ToolCallExecution` with `{ ok: false, error: "..." }`.
- [ ] The `executeToolCalls()` method returns a failed execution for each unrecoverable tool call, not silently fewer executions than input calls.
- [ ] Existing behavior `.filter((toolCall): toolCall is ToolCall => Boolean(toolCall))` in `executeToolCalls` must ensure that `null`-returning parse is only a degenerate case used when the input is not structurally recognizable as a tool call at all (e.g., `undefined`, non-object). All `{ id, type, function }` structures must produce a repair attempt.

---

## Non-Functional Requirements

### NFR-001: Zero Regressions in Existing Tool Execution

**What:** All existing tool execution tests must pass without modification. Repaired tool calls must produce identical results to manually-corrected calls.

**Acceptance Criteria:**
- [ ] `npm test` passes with 0 new failures (baseline: 173 pass, 0 fail, 5 skipped).
- [ ] Existing tests in `src/tests/tool-executor.test.ts` pass unchanged (no test modifications needed).
- [ ] Valid, well-formed tool calls produce identical output before and after repair pipeline integration.

### NFR-002: Repair Latency < 1 ms

**What:** The repair pipeline is pure synchronous/async function with no I/O. Total repair latency per tool call must be under 1 millisecond on standard hardware.

**Why:** Tool calls already incur execution latency (bash, file I/O). Repair must not add perceptible delay. 1 ms is 1000x below human perception threshold.

**Acceptance Criteria:**
- [ ] `performance.now()` measurement of `repairToolCall()` for a well-formed call shows < 0.1 ms (fast path: JSON.parse succeeds, no repair needed).
- [ ] `performance.now()` measurement for a call requiring all 3 repair stages shows < 1 ms.
- [ ] No `await` inside repair functions (no async I/O).

### NFR-003: Zero New Dependencies

**What:** The repair pipeline uses only Node.js standard library and existing project dependencies. No new npm packages.

**Why:** Per P6 (Zero New Dependencies Without Justification). The repair logic is pure string/object manipulation — no external library needed.

**Acceptance Criteria:**
- [ ] `package.json` and `package-lock.json` are unchanged by this spec.
- [ ] Imports are only from: `"node:*"` modules, existing project files, or the `openai` SDK (already a dependency).

### NFR-004: Test Coverage for All Repair Strategies

**What:** Every repair strategy in FR-001 through FR-007 must have at least one dedicated unit test case.

**Acceptance Criteria:**
- [ ] New test file `src/tests/tool-call-repair.test.ts` with test cases for each repair strategy.
- [ ] Each FR acceptance criterion is covered by at least one test case.
- [ ] Edge cases: empty arguments `""`, `undefined`, `null`, malformed but non-JSON strings.

---

## Constraints

- **C1:** The repair pipeline is a standalone module (`src/tools/tool-call-repair.ts`). It must not import from `session.ts`, `mcp-manager.ts`, or any provider file. Dependencies are injectable: the tool registry is passed as a parameter.
- **C2:** Repair functions are pure. No side effects, no global state, no filesystem access, no network. This enables deterministic unit testing.
- **C3:** The `BUILT_IN_TOOL_NAME_ALIASES` Map in `executor.ts` is removed after repair integration, replaced by the case-insensitive lookup in the repair pipeline.
- **C4:** The `normalizeToolArguments()` function in `executor.ts` is subsumed by the repair pipeline's parse stage. It may be removed or simplified if fully redundant.
- **C5:** MCP tool validation is limited to name matching. MCP tool schemas are not guaranteed to be available in-process (streamable HTTP servers, lazy loading). Type validation for MCP args is skipped unless the `ToolDefinition` is locally available.
- **C6:** Default values for FR-006 are inferred from JSON Schema semantics, not from a custom default registry. The `ToolDefinition.parameters.properties` entries use standard JSON Schema `default` keyword. If a property lacks `default`, no injection occurs.
- **C7:** Ambiguous tool name resolution (case-insensitive collision) must be deterministic: prefer exact match; if no exact match, sort alphabetically and pick first.

---

## Edge Cases & Error States

| # | Input | Expected Behavior |
|---|-------|-------------------|
| 1 | `arguments: ""` (empty string) | Valid. Returns `{}` (empty object). No repair needed. |
| 2 | `arguments: undefined` or `arguments: null` | Valid. Returns `{}` (empty object). Treated as no-args call. |
| 3 | `arguments: "not json at all"` | Parse failure. Attempt repair: wrap in `{}`? No — unrecoverable. Return error after 2 attempts. |
| 4 | `arguments: "[1,2,3]"` (array, not object) | Current behavior: `InputParseError: Tool arguments must be a JSON object`. Preserved. Arrays are not valid tool arguments. |
| 5 | `arguments: object` (already parsed, not a string) | `normalizeToolArguments` stringifies it via `JSON.stringify`. Preserved. |
| 6 | `function.name: ""` (empty string) | Validation failure: tool name cannot be empty. |
| 7 | `function.name: "  "` (whitespace-only) | After trim, becomes `""`. Validation failure: tool name cannot be empty. |
| 8 | Tool call with `id: ""` (empty string) | Preserved — `id` validation is in `parseToolCall`, not repair. Empty `id` passes current validation (it IS a string). |
| 9 | MCP tool `mcp__github__create_issue` with `allow` policy | Repair pipeline normalizes name (if needed), then passes to MCP execution. Policy evaluation is downstream of repair. |
| 10 | Concurrent tool calls (array of 5 calls) | Each call is repaired independently. One failed repair does not block others. |
| 11 | `arguments` exceeds 1 MB (large argument) | Repair pipeline processes normally — no size limit. Handler may reject at execution. |
| 12 | Tool name collision: `"bash"` registered twice (built-in + MCP override) | Deterministic resolution: built-in tools checked first; if not found, MCP tools. Same as current behavior. |
| 13 | DeepSeek emits `"sideEffects": "[\"read-in-cwd\"]"` (double-encoded JSON) | `JSON.parse` produces a string `'["read-in-cwd"]'`. Type mismatch detection sees string where array expected. Cannot repair (string → array of unknown structure). Validation error. |

---

## Dependencies

- **Spec 30 (provider-agnostic-llm-layer):** `ILlmProvider` interface — repair is provider-agnostic, no direct dependency, but runs inside the `SessionManager` orchestration layer which uses `ILlmProvider`.
- **Spec 140 (mcp-hardening):** `McpPolicy.evaluate()` and `McpManager.isMcpTool()` — repair pipeline validates MCP tool names through the same registry. No functional dependency, but repair must preserve MCP policy enforcement.
- **No external services, no new libraries.**

---

## Out of Scope

- **LLM-based repair or retry:** Repair is purely deterministic (string/object manipulation). No LLM calls are made to fix tool calls. No automatic retry of the entire conversation turn.
- **Tool handler modification:** Existing tool handlers (`handleBashTool`, `handleReadTool`, etc.) are not modified. They receive already-repaired arguments.
- **Tool argument semantic validation:** Repair detects structural issues (missing keys, wrong types, malformed JSON). It does NOT validate semantic correctness (e.g., that `file_path` points to an existing file, that `command` is a valid bash command).
- **MCP tool argument schema validation:** MCP tools may not have their full JSON Schema available in-process. Repair validates MCP tool names only. Argument validation for MCP tools is deferred to the MCP server.
- **Streaming repair:** Repair operates on complete tool calls, not partial streaming chunks. If a tool call is truncated mid-stream, the LLM provider's SDK handles reassembly; repair sees the final, possibly-truncated `arguments` string.
- **Auto-retry of failed tool executions:** If repair succeeds but the tool handler itself fails (e.g., bash command returns exit code 1), no automatic retry. Only structural repair is in scope.
- **Telemetry/analytics of repair metrics:** Metrics are collected in-memory and available via API. Sending metrics to external services is out of scope.
- **UI display of repair metrics:** The `/model-info` and TUI do not show repair stats in this spec. The metrics object is available for future UI integration.
