# Spec 120: Explore Subagent — Requirements

## Value Delivery

From `vision.md` V17: Subagent Architecture & Context Isolation:

> **Built-in Explore subagent:** A read-only codebase explorer using the cheap model (`deepseek-v4-flash`, thinking disabled). Handles file discovery, code search, and architecture mapping. Configurable thoroughness levels (quick, medium, thorough). The main agent auto-delegates when a task matches exploration patterns.

> **Context isolation:** Subagents run with their own message array, system prompt, and tool set. Only the final summary is returned to the main conversation — exploration logs, search results, and intermediate reasoning never pollute the main context.

> **Cost optimization:** Subagents default to cheap models (`deepseek-v4-flash`) with thinking disabled. Budget tracking records subagent API calls separately.

> **Tool restrictions:** Subagents can be limited to read-only tools (Read, Grep, Glob) to prevent unintended modifications.

Also from V8 (Session Management & Context Optimization): context preservation by offloading exploration to isolated windows. From V11 (Cost-Optimized AI Operations): systematic minimization of API token consumption using cheaper models for auxiliary tasks.

---

## Functional Requirements

### FR-001: Explore Tool Registration

**What:** The Explore subagent is exposed to the main agent as a tool named `Explore` in the tool definitions array returned by `getTools()`. This is NOT a traditional tool handler — when the main agent invokes `Explore`, the session loop intercepts it and spawns the subagent instead of calling `ToolExecutor.executeToolCalls()`.

**Why:** The main agent must be able to delegate exploration tasks. Without a tool definition, the LLM cannot invoke the subagent. The tool interface is the delegation mechanism.

**Acceptance Criteria:**
- [ ] `getTools()` in `src/prompt.ts` includes an `Explore` tool definition with:
  - `type: "function"`
  - `function.name: "Explore"`
  - `function.description`: describes that Explore is a read-only codebase explorer that runs in isolated context and returns a summary. Mentions it uses a cheap model and should be used for file discovery, code search, and architecture understanding.
  - `function.parameters`: object with two required string properties:
    - `query` (string, required): the exploration question or task
    - `thoroughness` (string, required, enum: `["quick", "medium", "thorough"]`): controls depth of exploration
- [ ] The `Explore` tool appears in the tool list sent to the LLM on every turn.
- [ ] The tool definition is added unconditionally (no feature flag, no settings toggle).

### FR-002: Explore Subagent Execution Engine

**What:** A function `runExploreSubagent(opts)` that executes the exploration in an isolated context, separate from the main conversation. It creates its own message array, its own OpenAI client call, and manages a multi-turn tool-use loop internally.

**Why:** Context isolation is the core value proposition. The exploration must not add messages to the main session's message array. The subagent's intermediate reads, greps, and globs must be invisible to the main conversation.

**Acceptance Criteria:**
- [ ] Function signature: `async function runExploreSubagent(opts: ExploreSubagentOptions): Promise<string>` where `ExploreSubagentOptions` has fields: `query: string`, `thoroughness: \"quick\" | \"medium\" | \"thorough\"`, `projectRoot: string`, `client: OpenAI`, `model: string`, `sessionId: string`.
- [ ] The function does NOT use `ToolExecutor`. It calls `handleReadTool`, `handleGrepTool`, `handleGlobTool` directly via a local `READONLY_TOOL_HANDLERS` map (see FR-009). This avoids modifying `ToolExecutor` which has no public API to restrict tool registration.
- [ ] The function creates a NEW messages array starting with only the system prompt and user message.
- [ ] The function runs a multi-turn loop: LLM responds → if tool_calls → execute via direct handler invocation → format tool results as `{ role: \"tool\", tool_call_id, content }` messages → append to messages → continue loop. If no tool_calls (or max turns reached) → stop.
- [ ] Max turns are capped by thoroughness level:
  - `quick`: max 5 turns
  - `medium`: max 10 turns
  - `thorough`: max 25 turns
- [ ] The function returns ONLY the final `content` string from the last assistant message (the summary).
- [ ] If the final message has no content (empty string) but tool calls were made during the exploration, the function returns a fallback summary: `\"Exploration complete. Tools called: \"` followed by a JSON array of `{tool: string, count: number}` objects (e.g., `'Exploration complete. Tools called: [{\"tool\":\"read\",\"count\":3},{\"tool\":\"grep\",\"count\":5}]'`).
- [ ] If the final message has no content AND no tool calls were made at all, the function returns: `\"Explore error: No results produced.\"`.
- [ ] Each API call in the loop records its cost via `recordBudgetCost()` with the subagent's model.
- [ ] The function NEVER touches the session's message array, SessionManager state, or any shared mutable state.
- [ ] The function catches all errors and returns a human-readable error string prefixed with `\"Explore error: \"` (never throws).

### FR-003: Explore System Prompt

**What:** A constant system prompt string that defines the Explore subagent's behavior: it is a read-only codebase explorer, it must use Read/Grep/Glob to understand the codebase, and it must return a concise summary.

**Why:** The system prompt constrains the subagent's behavior. Without it, the LLM might try to write files, execute bash commands, or produce verbose responses.

**Acceptance Criteria:**
- [ ] Constant `EXPLORE_SYSTEM_PROMPT` defined in the explore subagent module.
- [ ] Prompt explicitly states: "You are a read-only codebase explorer. Your tools are Read, Grep, and Glob only. Do NOT attempt to write, edit, or execute code. Return a concise summary of your findings."
- [ ] Prompt instructs the subagent to be thorough or quick based on context (the user query will indicate this).
- [ ] Prompt instructs the subagent to prefer Grep and Glob over recursive filesystem traversal.
- [ ] Prompt limits output: "Your final response must be a summary under 500 words."

### FR-004: Subagent Budget Tracking

**What:** Every API call made by the explore subagent is recorded in the project budget file via `recordBudgetCost()`.

**Why:** Cost transparency (V11). Users must see what the subagent costs, separate from main conversation costs. This also enables budget limit enforcement.

**Acceptance Criteria:**
- [ ] After each `client.chat.completions.create()` call in the subagent loop, if `response.usage` exists, call `recordBudgetCost(projectRoot, model, usage)`.
- [ ] The model used is the cheap model resolved by `getCheapModel()`, NOT the main conversation model.
- [ ] Budget entries use the same format and file (`management/budget.md`) as main conversation entries.
- [ ] If the budget file does not exist, it is created (handled by existing `recordBudgetCost`).

### FR-005: Auto-Delegation by Main Agent

**What:** The main agent detects when a user request matches exploration patterns and calls the `Explore` tool instead of using Read/Grep/Glob directly in the main context. This is driven by the tool description and the system prompt — no hardcoded heuristics in TypeScript.

**Why:** Without delegation, the Explore subagent is never used. The delegation must be driven by the LLM itself, not by rule-based keyword matching.

**Acceptance Criteria:**
- [ ] The `Explore` tool description in `getTools()` explicitly states when to use it: "Use this tool when you need to search, discover, or understand code across multiple files. Prefer Explore over multiple Read/Grep/Glob calls in the main conversation."
- [ ] The main system prompt in `buildSystemPrompt()` (via `prompt.ts`) includes guidance: "When you need to explore the codebase (finding files, searching for patterns, understanding architecture), delegate to the Explore tool instead of using Read/Grep/Glob directly. This keeps the main conversation clean."
- [ ] No TypeScript code parses the user's message to decide delegation — the LLM decides based on the tool description.

### FR-006: Explore Tool Handler (Session Interception)

**What:** When the main agent calls the `Explore` tool, the session loop intercepts this call before it reaches `ToolExecutor`. The session extracts the `query` and `thoroughness` arguments, spawns `runExploreSubagent()`, and injects the result as a tool result message back into the conversation.

**Why:** The Explore tool is not handled by `ToolExecutor` because it requires spawning a sub-conversation. It must be intercepted at the session level where the OpenAI client and project root are available.

**Acceptance Criteria:**
- [ ] A new function `handleExploreToolCall(toolCall, sessionContext)` in the explore subagent module that:
  1. Parses `toolCall.function.arguments` as JSON to extract `query` and `thoroughness`.
  2. Validates both fields (non-empty string, valid enum value).
  3. Returns an error `ToolExecutionResult` if validation fails.
  4. Calls `createOpenAIClient()` to get the client and model.
  5. Resolves cheap model via `getCheapModel(model) ?? model`.
  6. Generates a unique session ID via `crypto.randomUUID()` prefixed with `"explore-"`.
  7. Calls `runExploreSubagent({ query, thoroughness, projectRoot, client, model: cheapModel, sessionId })`.
  8. Returns `{ ok: true, name: "Explore", output: summary }` on success.
  9. Returns `{ ok: false, name: "Explore", error: message }` on failure.
- [ ] The session loop (`replySession` / `processTurn` in `session.ts`) detects tool calls with name `"Explore"` and routes them to `handleExploreToolCall` instead of `ToolExecutor.executeToolCall`.
- [ ] The interception happens BEFORE `ToolExecutor.executeToolCalls()` processes the batch.
- [ ] Other tool calls in the same batch are still processed normally by `ToolExecutor`.
- [ ] The result (summary or error) is formatted as a standard tool result and added to the conversation messages.

### FR-007: Thoroughness Level Mapping

**What:** The `thoroughness` parameter controls max turns and token budget for the subagent's internal LLM calls.

**Why:** Different exploration tasks need different resource budgets. "Where is function X defined?" is quick. "Map the entire authentication architecture" is thorough.

**Acceptance Criteria:**
- [ ] `quick`: maxTurns=5, maxTokens per API call=2048, system prompt addition: "Be quick. Find the answer in 1-3 tool calls."
- [ ] `medium`: maxTurns=10, maxTokens per API call=4096, system prompt addition: "Be thorough but efficient."
- [ ] `thorough`: maxTurns=25, maxTokens per API call=8192, system prompt addition: "Be very thorough. Explore all relevant files and dependencies."
- [ ] If `thoroughness` is missing or invalid, default to `"medium"`.

### FR-008: Subagent Timeout

**What:** The entire explore subagent execution has a timeout. If the subagent takes longer than the timeout, it is aborted and returns whatever partial results it has (or an error if nothing was produced).

**Why:** Without a timeout, a stuck subagent (infinite tool loop) would block the main conversation indefinitely.

**Acceptance Criteria:**
- [ ] Overall timeout per thoroughness level:
  - `quick`: 30 seconds
  - `medium`: 60 seconds
  - `thorough`: 120 seconds
- [ ] Each individual API call within the subagent has a 15-second timeout (`AbortSignal.timeout(15000)`).
- [ ] If the per-call (15s) timeout triggers, `runExploreSubagent` returns: `"Explore error: API call timed out after 15 seconds."`.
- [ ] If the overall timeout triggers, `runExploreSubagent` returns: `"Explore error: Exploration timed out after N seconds."` where N is the actual timeout value for the thoroughness level.
- [ ] `handleExploreToolCall` converts these error strings into `{ ok: false, name: "Explore", error: <string> }` (already specified in FR-006).

### FR-009: Subagent Tool Limitations

**What:** The explore subagent only has access to read-only tools: `Read`, `Grep`, `Glob`. It must NOT have access to `Write`, `Edit`, `Bash`, or any other tool. Tool execution uses direct function invocation (NOT `ToolExecutor`).

**Why:** The Explore subagent is a read-only explorer. It must not modify files or execute commands. This is a safety constraint.

**Acceptance Criteria:**
- [ ] The subagent executes tools via direct function invocation (NOT `ToolExecutor`), using a `READONLY_TOOL_HANDLERS` map that ONLY contains: `read` → `handleReadTool`, `grep` → `handleGrepTool`, `glob` → `handleGlobTool`.
- [ ] The subagent cannot write files, edit files, execute bash commands, or call any other tool.
- [ ] The tool definitions sent to the LLM in the subagent context ONLY include Read, Grep, Glob — no other tools are defined.

### FR-010: Subagent API Configuration

**What:** The subagent API calls use: `model` = cheap model from `getCheapModel()`, `thinking: { type: "disabled" }`, `temperature: 0.1`.

**Why:** Exploration tasks are fact-finding, not creative. Low temperature gives deterministic results. Thinking mode is unnecessary for code search and would increase cost/latency.

**Acceptance Criteria:**
- [ ] Every `client.chat.completions.create()` call in the subagent loop passes:
  - `model`: resolved cheap model
  - `thinking: { type: "disabled" }`
  - `temperature: 0.1`
  - `max_tokens`: based on thoroughness level (2048/4096/8192)
- [ ] No `tool_choice` parameter is set (let the LLM decide whether to call tools).
- [ ] The `tools` parameter includes only Read, Grep, Glob tool definitions.

---

## Non-Functional Requirements

### NFR-001: Performance — Subagent Completion Time

**What:** The explore subagent must complete within the timeout thresholds defined in FR-008 for the respective thoroughness level.

**Acceptance Criteria:**
- [ ] `quick` exploration completes in under 30 seconds (wall clock).
- [ ] `medium` exploration completes in under 60 seconds (wall clock).
- [ ] `thorough` exploration completes in under 120 seconds (wall clock).
- [ ] Measured from the start of `runExploreSubagent()` to when it returns.

### NFR-002: Reliability — Error Recovery

**What:** The subagent must handle LLM API errors gracefully without crashing the main session.

**Acceptance Criteria:**
- [ ] Any error in `runExploreSubagent()` is caught and returned as an error string.
- [ ] The main session continues operating after a failed subagent call.
- [ ] Network errors, rate limits, and authentication errors all produce distinct, human-readable error messages.
- [ ] Partial results are discarded on error (no partial summary injection).

### NFR-003: Maintainability — Code Isolation

**What:** The explore subagent code must live in a single new file with zero modifications to existing tool handlers (Read, Grep, Glob handlers are reused as-is).

**Acceptance Criteria:**
- [ ] New file: `src/tools/explore-subagent.ts` contains all subagent logic.
- [ ] Existing files modified: `src/prompt.ts` (add Explore tool definition), `src/session.ts` (intercept Explore tool calls).
- [ ] No modifications to `read-handler.ts`, `grep-handler.ts`, `glob-handler.ts`, `executor.ts`, or any other tool handler.

### NFR-004: Testability

**What:** The subagent logic must be testable without a real LLM API connection.

**Acceptance Criteria:**
- [ ] `runExploreSubagent()` accepts an `OpenAI` client instance — tests can inject a mock.
- [ ] `handleExploreToolCall()` accepts a `createOpenAIClient` function — tests can inject a mock.
- [ ] Unit tests cover: argument validation, timeout handling, max turns enforcement, error propagation, budget recording.
- [ ] Integration tests with a mock LLM client verify: single-turn response, multi-turn tool loop, empty response fallback.

---

## Constraints

- **C1:** Must follow the `web-search-handler.ts` pattern: isolated context, cheap model, thinking disabled, `recordBudgetCost` per API call.
- **C2:** Must not introduce new npm dependencies (P6 from arch.md).
- **C3:** Must use `getCheapModel()` from `model-catalog.ts` — no hardcoded model string (ADR-005).
- **C4:** Must be backward compatible — no changes to existing tool behavior, session storage format, or settings schema.
- **C5:** Must work with the current DeepSeek provider. The subagent uses the existing `client.chat.completions.create()` from the OpenAI SDK — no provider-specific code.
- **C6:** The Explore tool must NOT appear in tool definitions sent to the subagent (the subagent only gets Read, Grep, Glob — no recursive Explore).

---

## Edge Cases & Error States

| Scenario | Expected Behavior |
|----------|-------------------|
| `query` is empty string or whitespace | Return `{ ok: false, error: "Missing required 'query' string." }` |
| `query` is missing from arguments | Return `{ ok: false, error: "Missing required 'query' string." }` |
| `thoroughness` is missing | Default to `"medium"` |
| `thoroughness` is invalid (not "quick"/"medium"/"thorough") | Default to `"medium"` |
| `createOpenAIClient()` returns null client | Return `{ ok: false, error: "LLM client is not available." }` |
| Subagent API call returns no `choices` (empty array) | Return `{ ok: false, error: "Explore subagent returned no response." }` |
| Subagent API call returns `choices[0].finish_reason === "length"` (token limit hit mid-response) | Treat as normal — use whatever content was returned. If content is empty, treat same as "empty content" case below. |
| Subagent API call has `choices[0].message` that is null/undefined | Return `{ ok: false, error: "Explore subagent returned no response." }` |
| Subagent final message has empty `content` but tool calls were made | Return fallback: `"Exploration complete. Tools called: [{\"tool\":\"read\",\"count\":N},{\"tool\":\"grep\",\"count\":M},{\"tool\":\"glob\",\"count\":P}]"` where N, M, P are the actual counts of each tool called during the exploration. Omit tools with count 0. |
| Subagent final message has empty `content` and no tool calls were made | Return `"Explore error: No results produced."` (runExploreSubagent returns this string; handleExploreToolCall wraps it in ToolExecutionResult) |
| Subagent reaches max turns without producing a summary | Force-stop and use the last assistant message content as the result. If that content is empty, use the fallback tool-count JSON format from the row above. If no tools were called at all, return `"Explore error: No results produced."` |
| Multiple `Explore` tool calls in the same tool call batch | Process each sequentially, collecting results. (ToolExecutor already processes batch sequentially.) |
| `Explore` called alongside other tools in the same batch | Process Explore first (or last — deterministic order: Explore calls are extracted and processed, then remaining tools go to ToolExecutor). |
| Budget file write fails (disk full, permissions) | `recordBudgetCost` already handles this gracefully — the subagent continues, cost is silently not recorded. |
| Project root does not exist or is inaccessible | The subagent's tools (Read, Grep, Glob) will fail with their own error messages — subagent returns what it can. |
| User interrupts (Ctrl+C) during subagent execution | The `AbortSignal` propagates through the subagent's API calls. The subagent returns error, main session handles the interrupt. |

---

## Dependencies

- **Internal:** `src/common/model-catalog.ts` (`getCheapModel`), `src/common/budget-tracker.ts` (`recordBudgetCost`), `src/tools/executor.ts` (`ToolExecutor`, `ToolExecutionContext`, `ToolExecutionResult`), `src/tools/read-handler.ts`, `src/tools/grep-handler.ts`, `src/tools/glob-handler.ts`.
- **External:** `openai` npm package (OpenAI client — already a dependency).
- **Specs:** None. Spec 120 is standalone. Spec 130 (skills-as-subagents) depends on Spec 120.

---

## Out of Scope

- **Skills as subagents** (mode: "agent" in SKILL.md) — this is Spec 130.
- **User-configurable subagents** via `.dscode/agents/*.md` — not in current plan.
- **Parallel subagent execution** — subagents run sequentially within a turn.
- **Subagent-to-subagent delegation** (nesting) — the Explore subagent cannot spawn another Explore.
- **Custom tools for subagents** — Explore always uses Read, Grep, Glob only.
- **Subagent model configuration** — always uses cheap model from catalog, not user-configurable.
- **Subagent results caching** — each Explore call does fresh work.
- **UI for subagent progress** — subagent execution is invisible to the user (no progress bar). The user sees only the final summary.
