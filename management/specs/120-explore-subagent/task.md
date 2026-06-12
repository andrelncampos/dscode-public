# Spec 120: Explore Subagent — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

## Tasks

### Task 1: Create explore-subagent.ts — Types, Constants, and System Prompt

**Objective:** Create the new file `src/tools/explore-subagent.ts` with all type definitions, constants, and the system prompt.

**Requirements Covered:** FR-003 (system prompt), FR-007 (thoroughness config), FR-009 (tool restrictions), FR-010 (API config)

**Design References:** Components: ExploreSubagentOptions, ThoroughnessConfig, EXPLORE_SYSTEM_PROMPT, READONLY_TOOL_DEFINITIONS, READONLY_TOOL_HANDLERS

**Actions:**
1. Create `src/tools/explore-subagent.ts`.
2. Import types: `ToolCall`, `ToolExecutionResult`, `ToolHandler`, `ToolExecutionContext` from `./executor`.
3. Import `OpenAI` from `openai`.
4. Import `recordBudgetCost` from `../common/budget-tracker`.
5. Import `handleReadTool` from `./read-handler`.
6. Import `handleGrepTool` from `./grep-handler`.
7. Import `handleGlobTool` from `./glob-handler`.
8. Define and export `ExploreSubagentOptions` type with fields: `query: string`, `thoroughness: "quick" | "medium" | "thorough"`, `projectRoot: string`, `client: OpenAI`, `model: string`, `sessionId: string`.
9. Define private `ThoroughnessConfig` type with fields: `maxTurns: number`, `maxTokens: number`, `overallTimeoutMs: number`, `systemPromptSuffix: string`.
10. Define private `THOROUGHNESS_CONFIGS` constant with quick/medium/thorough entries (exact values from design.md).
11. Define private `EXPLORE_SYSTEM_PROMPT` constant (exact string from design.md Component: EXPLORE_SYSTEM_PROMPT).
12. Define private `READONLY_TOOL_DEFINITIONS` — exact array from design.md Data Structures: SubagentToolDefinition (copy-paste the full Read, Grep, Glob definitions).
13. Define private `READONLY_TOOL_HANDLERS` map: `{ read: handleReadTool, grep: handleGrepTool, glob: handleGlobTool }`.
14. Verify TypeScript compiles: `npx tsc -p ./ --noEmit`.

**Validation:** TypeScript compiles without errors. File exists at `src/tools/explore-subagent.ts`.

**Status:** [x] done

---

### Task 2: Implement executeSubagentTool helper

**Objective:** Implement the private helper that executes a single tool call within the subagent context.

**Requirements Covered:** FR-009 (tool restrictions enforced at execution)

**Design References:** AD-120-002, Component: executeSubagentTool

**Actions:**
1. In `src/tools/explore-subagent.ts`, add private function `executeSubagentTool`.
2. Signature: `async function executeSubagentTool(toolCall: ToolCall, sessionId: string, projectRoot: string): Promise<ToolExecutionResult>`.
3. Look up handler in `READONLY_TOOL_HANDLERS` by `toolCall.function.name`.
4. If not found, return `{ ok: false, name, error: "Unknown tool: ..." }`.
5. Parse `toolCall.function.arguments` as JSON.
6. If parse fails, return `{ ok: false, name, error: "Failed to parse tool arguments." }`.
7. Call handler with args and a `ToolExecutionContext` containing `sessionId`, `projectRoot`, `toolCall`.
8. Return the handler's result directly.

**Validation:** TypeScript compiles. Function exists and is callable.

**Status:** [x] done

---

### Task 3: Implement runExploreSubagent — Core Loop

**Objective:** Implement the core multi-turn subagent execution loop.

**Requirements Covered:** FR-002 (execution engine), FR-004 (budget tracking), FR-007 (thoroughness), FR-008 (timeout), FR-010 (API config)

**Design References:** Component: runExploreSubagent, AD-120-003

**Actions:**
1. In `src/tools/explore-subagent.ts`, add exported function `runExploreSubagent`.
2. Signature: `export async function runExploreSubagent(opts: ExploreSubagentOptions): Promise<string>`.
3. Validate inputs: `query.trim()` not empty, `thoroughness` valid (default to `"medium"`), `sessionId` is non-empty string.
4. Resolve config from `THOROUGHNESS_CONFIGS[thoroughness]`.
5. Build messages array: system prompt (EXPLORE_SYSTEM_PROMPT + thoroughness suffix), user message `"Explore the codebase: ${query}"`.
6. Build tools array from `READONLY_TOOL_DEFINITIONS`.
7. Initialize tool call counters: `const toolCounts = { read: 0, grep: 0, glob: 0 }`.
8. Track overall elapsed time: `const overallStart = Date.now()`.
9. Implement loop: for turn 0 to maxTurns-1:
   a. Calculate remaining timeout: `remainingTimeoutMs = overallTimeoutMs - (Date.now() - overallStart)`. If <= 0, break and return timeout error.
   b. Create per-call timeout: `AbortSignal.timeout(Math.min(15000, remainingTimeoutMs))`.
   c. Call `client.chat.completions.create()` with model, messages, tools, thinking disabled, temp 0.1, max_tokens, per-call signal.
   d. If `response.usage` → `recordBudgetCost(projectRoot, model, response.usage)`.
   e. Get assistant message from `response.choices[0]?.message`. If null/undefined or choices empty, return error.
   f. If message has `tool_calls`:
      - Append message to messages array.
      - For each tool call: execute via `executeSubagentTool()`, increment `toolCounts[name]`, format result as `{ role: "tool", tool_call_id, content: JSON.stringify(result) }`, append to messages.
      - Continue loop.
   g. If message has `content` and `finish_reason` is not `"tool_calls"`:
      - Append message to messages. Return content.
   h. If `finish_reason === "length"`: append message to messages. If content non-empty, return content. Else continue loop.
   i. If message has neither content nor tool_calls: append to messages, continue loop.
10. If maxTurns reached: return last non-empty content, or fallback JSON with toolCounts, or error if no tools called.
11. Wrap entire function body in try/catch, return `"Explore error: ${message}"` on catch.

**Validation:** TypeScript compiles. Function exists with correct signature.

**Status:** [x] done

---

### Task 4: Implement handleExploreToolCall — Entry Point

**Objective:** Implement the entry point that the session loop calls when the main LLM invokes Explore.

**Requirements Covered:** FR-006 (Explore tool handler)

**Design References:** Component: handleExploreToolCall

**Actions:**
1. In `src/tools/explore-subagent.ts`, add exported function `handleExploreToolCall`.
2. Signature: `export async function handleExploreToolCall(toolCall: ToolCall, createOpenAIClient: CreateOpenAIClient, projectRoot: string): Promise<ToolExecutionResult>`.
3. Parse `toolCall.function.arguments` as JSON.
4. If parse fails → return `{ ok: false, name: "Explore", error: "Failed to parse Explore arguments." }`.
5. Extract `query` (string), `thoroughness` (string | undefined).
6. If `query` missing or empty → return `{ ok: false, name: "Explore", error: "Missing required 'query' string." }`.
7. If `thoroughness` not in ["quick", "medium", "thorough"] → default to `"medium"`.
8. Call `createOpenAIClient()`.
9. If `!llmContext?.client` → return `{ ok: false, name: "Explore", error: "LLM client is not available. Check your API key configuration." }`.
10. Resolve cheap model: `const cheapModel = getCheapModel(llmContext.model) ?? llmContext.model`.
11. Import `getCheapModel` from `../common/model-catalog`.
12. Generate a unique session ID for the subagent: `const subagentSessionId = \`explore-${crypto.randomUUID()}\``. Import `crypto` from `node:crypto`.
13. Call `runExploreSubagent({ query, thoroughness, projectRoot, client: llmContext.client, model: cheapModel, sessionId: subagentSessionId })`.
14. If result starts with `"Explore error:"` → return `{ ok: false, name: "Explore", error: result }`.
15. Else → return `{ ok: true, name: "Explore", output: result }`.

**Validation:** TypeScript compiles. Function exists with correct signature.

**Status:** [x] done

---

### Task 5: Add Explore Tool Definition to getTools()

**Objective:** Register the Explore tool so the main LLM can invoke it.

**Requirements Covered:** FR-001 (tool registration), FR-005 (auto-delegation via description)

**Design References:** Component: ExploreToolDefinition

**Actions:**
1. Open `src/prompt.ts`.
2. In the `getTools()` function, locate the return array.
3. Add the Explore tool definition object after the last existing tool definition in the array.
4. Use the exact definition from design.md Component: ExploreToolDefinition.
5. Verify the tool definition includes: `type: "function"`, `function.name: "Explore"`, description, parameters with `query` (required) and `thoroughness` (required, enum).
6. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. `getTools()` returns array containing Explore tool definition.

**Status:** [x] done

---

### Task 6: Add System Prompt Guidance for Explore

**Objective:** Update the main system prompt to instruct the LLM to use Explore for codebase exploration.

**Requirements Covered:** FR-005 (auto-delegation guidance)

**Design References:** FR-005 acceptance criteria

**Actions:**
1. Open `src/prompt.ts`.
2. Find `buildSystemPrompt()` or the function that constructs the main system prompt.
3. Locate the section about available tools or exploration guidance.
4. Add a paragraph: "When you need to explore the codebase (finding files, searching for patterns, understanding architecture), delegate to the Explore tool instead of using Read/Grep/Glob directly. This keeps the main conversation context clean. Use Explore for multi-file exploration; use Read for single known files."
5. If no such section exists, add it near the tool usage guidance area of the system prompt.
6. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. System prompt includes Explore delegation guidance.

**Status:** [x] done

---

### Task 7: Intercept Explore Tool Calls in Session Loop

**Objective:** Modify the session loop to intercept Explore tool calls and route them to `handleExploreToolCall`.

**Requirements Covered:** FR-006 (session interception)

**Design References:** Component: Session Interception, AD-120-001

**Actions:**
1. Open `src/session.ts`.
2. Import `handleExploreToolCall` from `./tools/explore-subagent`.
3. Find the block in `replySession` where `this.toolExecutor.executeToolCalls()` is called.
4. Before the existing `executeToolCalls()` call, add logic to:
   a. Split `parsedToolCalls` into Explore calls and non-Explore calls.
   b. Process Explore calls sequentially: for each, call `handleExploreToolCall(toolCall, this.createOpenAIClient, this.projectRoot)`.
   c. Format Explore results into `ToolCallExecution` objects with `toolCallId`, `content`, and `result`. The `content` field must use `formatSubagentToolResult(result)` (defined below).
   d. Process remaining non-Explore calls via `this.toolExecutor.executeToolCalls()` as before.
   e. Concatenate Explore results with non-Explore results.
5. Implement `formatSubagentToolResult` as a private helper inside `session.ts` (or import from `explore-subagent.ts`):
   ```typescript
   function formatSubagentToolResult(result: ToolExecutionResult): string {
     const payload: Record<string, unknown> = { ok: result.ok, name: result.name };
     if (typeof result.output !== "undefined") payload.output = result.output;
     if (result.error) payload.error = result.error;
     if (result.metadata && Object.keys(result.metadata).length > 0) payload.metadata = result.metadata;
     return JSON.stringify(payload, null, 2);
   }
   ```
6. If all tool calls are Explore calls, skip `ToolExecutor` entirely.
7. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. Session loop compiles with Explore interception logic.

**Status:** [x] done

---

### Task 8: Write Unit Tests for explore-subagent.ts

**Objective:** Create comprehensive unit tests covering all functions in the explore subagent module.

**Requirements Covered:** FR-002, FR-003, FR-004, FR-006, FR-007, FR-008, FR-009, FR-010

**Design References:** Testing Strategy section

**Actions:**
1. Create `src/tests/explore-subagent.test.ts`.
2. Import test functions from the test framework (`node:assert`, `node:test`).
3. Import `handleExploreToolCall`, `runExploreSubagent` from `../tools/explore-subagent`.
4. Write tests per the test list in design.md (16 unit tests minimum).
5. For tests that need an OpenAI client, create a mock: `{ chat: { completions: { create: async () => mockResponse } } }`.
6. Mock `recordBudgetCost` by importing and wrapping — or verify it was called via side-effect check.
7. Write tests:
   - `handleExploreToolCall returns error for missing query`
   - `handleExploreToolCall returns error for empty query`
   - `handleExploreToolCall defaults invalid thoroughness to medium`
   - `handleExploreToolCall returns error when LLM client is null`
   - `handleExploreToolCall returns error for malformed JSON arguments`
   - `runExploreSubagent returns direct content on single-turn response`
   - `runExploreSubagent executes multi-turn tool loop`
   - `runExploreSubagent respects max turns (quick)`
   - `runExploreSubagent respects max turns (medium)`
   - `runExploreSubagent respects max turns (thorough)`
   - `runExploreSubagent returns fallback when max turns reached`
   - `runExploreSubagent records budget for each API call`
   - `runExploreSubagent returns error on API failure`
   - `runExploreSubagent uses thinking: disabled`
   - `runExploreSubagent uses temperature: 0.1`
8. Run `npx tsx --test src/tests/explore-subagent.test.ts` to verify all pass.

**Validation:** All tests pass. Zero failures.

**Status:** [x] done

---

### Task 9: Verify Existing Tests Pass

**Objective:** Ensure zero regressions in the existing test suite.

**Requirements Covered:** NFR-003 (no breaking changes to existing tools)

**Design References:** P5 (Test Integrity) from arch.md

**Actions:**
1. Run `npm test` (full test suite).
2. Verify all existing tests pass — zero failures, zero new skipped tests.
3. If any test fails, fix the regression before proceeding.

**Validation:** `npm test` exits with code 0, no test failures.

**Status:** [x] done

---

### Task 10: Rebuild Bundle and Manual Smoke Test

**Objective:** Build the production bundle and manually verify the Explore tool appears in the tool list.

**Requirements Covered:** FR-001 (tool appears in LLM tool list)

**Actions:**
1. Run `npx esbuild ./src/cli.tsx --bundle --platform=node --format=esm --target=node24 --outfile=dist/cli.js --banner:js="#!/usr/bin/env node" --jsx=automatic --jsx-import-source=react --packages=external --log-override:empty-import-meta=silent`.
2. Launch DsCode from the new bundle.
3. Check that the system prompt and tool definitions include `Explore`.
4. Send a message: "Use Explore to find where the session manager is defined" (or similar exploration request).
5. Verify the main LLM calls the Explore tool.
6. Verify the Explore subagent returns a summary.
7. Verify the main LLM incorporates the summary in its response.
8. Verify `management/budget.md` records the subagent's API costs under the cheap model.

**Validation:** Explore tool is invoked by the LLM, subagent returns results, budget records costs, main conversation remains clean.

**Status:** [x] done
