# Spec 130: Skills as Subagents — Requirements

## Value Delivery

From `vision.md` V17: Subagent Architecture & Context Isolation:

> **Skills as subagents:** The existing `SKILL.md` system gains a `mode` field. `mode: prompt` (default, current behavior) injects the skill as a system message. `mode: agent` spawns the skill as an isolated subagent with its own model, tools, and thinking settings — it does the work and returns only the result.

> **Context isolation:** Subagents run with their own message array, system prompt, and tool set. Only the final summary is returned to the main conversation — exploration logs, search results, and intermediate reasoning never pollute the main context.

> **Cost optimization:** Subagents default to cheap models (`deepseek-v4-flash`) with thinking disabled. Budget tracking records subagent API calls separately.

> **Tool restrictions:** Subagents can be limited to read-only tools (Read, Grep, Glob) to prevent unintended modifications.

> **Auto-delegation:** The main agent decides when to delegate based on subagent descriptions (for custom skills) or built-in heuristics (for Explore).

> **Backward compatible:** All existing skills continue working unchanged. Skills without `mode` default to `prompt`. The Explore subagent is always available and requires no configuration.

Also from V16 (Skills Inclusion Modes): skills with `inclusion: manual` can be explicitly activated via `#skill-name`. From V8 (Session Management & Context Optimization): context preservation by offloading work to isolated windows. From V11 (Cost-Optimized AI Operations): systematic minimization of API token consumption using cheaper models for auxiliary tasks.

---

## Functional Requirements

### FR-001: `mode` Field in `SkillInfo` Type and SKILL.md Frontmatter

**What:** The `SkillInfo` TypeScript type gains an optional `mode` field with values `"prompt"` or `"agent"`. When absent (undefined), the skill behaves as `"prompt"` (backward compatible — current behavior). The `mode` field is parsed from SKILL.md YAML frontmatter by `readSkillInfo()`. For `mode: "agent"`, the SKILL.md MUST also declare a `tools` field (array of tool name strings). Additional optional fields for agent mode: `model` (string, model ID override), `thinking` (`"enabled"` or `"disabled"`, defaults to `"disabled"`), `maxTurns` (number, defaults to 15), `timeout` (number in milliseconds, defaults to 120000).

**Why:** The `mode` field is the single source of truth for whether a skill runs as an injected prompt or as an isolated subagent. Without it, there is no way for a skill author to declare subagent execution.

**Acceptance Criteria:**
- [ ] `SkillInfo` type in `src/session.ts` gains: `mode?: "prompt" | "agent"`.
- [ ] `SkillInfo` type gains for agent mode: `agentModel?: string`, `agentThinking?: "enabled" | "disabled"`, `agentTools?: string[]`, `agentMaxTurns?: number`, `agentTimeoutMs?: number`.
- [ ] `readSkillInfo()` in `src/session.ts` parses `mode` from YAML frontmatter.
- [ ] Valid `mode` values: `"prompt"` and `"agent"` (case-sensitive). Any other value → treated as `undefined` (defaults to `"prompt"`).
- [ ] If `mode` is `"agent"`, `tools` is required. If `tools` is missing, empty, or not an array of strings → the skill is treated as `mode: "prompt"` (graceful degradation).
- [ ] If `mode` is `"agent"`, optional fields are parsed: `model` (string, trimmed), `thinking` (`"enabled"` or `"disabled"`), `maxTurns` (positive integer), `timeout` (positive integer milliseconds).
- [ ] If `thinking` is missing or invalid for an agent skill → defaults to `"disabled"`.
- [ ] If `model` is missing or empty for an agent skill → `agentModel` is `undefined` (caller resolves cheap model).
- [ ] If `maxTurns` is missing, not a number, or ≤ 0 → defaults to `15`.
- [ ] If `timeout` is missing, not a number, or ≤ 0 → defaults to `120000`.
- [ ] Skills with `mode: "prompt"` or undefined `mode` are unaffected — all existing behavior preserved.

### FR-002: Agent Skill Tool Definitions in `getTools()`

**What:** Skills with `mode: "agent"` are registered as tool definitions in the array returned by `getTools()`. Each agent skill becomes a tool with `type: "function"`, `function.name` equal to the skill's `name`, and `function.description` equal to the skill's `description` from SKILL.md. The `function.parameters` has one required property: `prompt` (string, required — the task for the subagent to perform). Agent skills are added unconditionally (no feature flag), same as the Explore tool. The tool description instructs the LLM that this is a subagent tool that runs in isolated context and returns a result.

**Why:** The main LLM must be able to delegate work to agent skills. Without tool definitions, the LLM cannot invoke them. Each agent skill appears as a distinct tool in the LLM's toolkit.

**Acceptance Criteria:**
- [ ] `getTools()` in `src/prompt.ts` generates tool definitions for all skills with `mode: "agent"` in addition to the existing static tool definitions.
- [ ] Each agent skill tool definition has:
  - `type: "function" as const`
  - `function.name`: the skill's `name` (exact string from SKILL.md)
  - `function.description`: `"${skill.description}\n\nThis is an agent skill that runs as an isolated subagent with its own tools and context. Only the result is returned to the main conversation."`.
  - `function.parameters`: `{ type: "object" as const, properties: { prompt: { type: "string" as const, description: "The task for this agent to perform." } }, required: ["prompt"], additionalProperties: false }`.
- [ ] If a skill name conflicts with an existing built-in tool name (Read, Grep, Glob, Write, Edit, Bash, WebSearch, WebFetch, Explore, AskUserQuestion, UpdatePlan), the skill is skipped with a warning logged to stderr and does NOT appear as a tool. The skill still appears in `/skills` list.
- [ ] The `getTools()` function receives the skills list. A new parameter `skills: SkillInfo[]` is added to `getTools()`. The caller (`SessionManager`) must pass the skills. The parameter defaults to `[]` for backward compatibility in tests.
- [ ] Agent skill tool definitions are appended after the built-in tool definitions (after Explore).
- [ ] The order of agent skill tools is stable (alphabetical by skill name).
- [ ] If `getTools()` is called with `skills` containing zero agent-mode skills, the returned array is identical to the current behavior plus zero extra entries.

### FR-003: Generalized Subagent Runner (`runSubagent`)

**What:** A generalized function `runSubagent()` in `src/tools/explore-subagent.ts` that encapsulates the subagent execution loop (create messages, multi-turn LLM loop, tool execution, budget tracking, timeout handling). This function is the shared infrastructure used by both `runExploreSubagent()` (Spec 120) and the new `runSkillSubagent()` (Spec 130). `runExploreSubagent()` is refactored to call `runSubagent()` internally — zero behavioral change for Explore.

**Why:** The Explore subagent loop and the skill subagent loop share 95% of their logic (message array initialization, multi-turn loop, tool execution, budget recording, timeout, error handling). Extracting the common loop eliminates duplication and provides a single, testable subagent engine. The refactoring of `runExploreSubagent()` must produce zero behavioral change.

**Acceptance Criteria:**
- [ ] `runSubagent()` has signature: `async function runSubagent(opts: SubagentOptions): Promise<string>`.
- [ ] `SubagentOptions` type:
  ```typescript
  type SubagentOptions = {
    systemPrompt: string;             // Subagent's system prompt
    userPrompt: string;               // Task description for the subagent
    tools: ToolDefinition[];          // Tool definitions available to the subagent
    toolHandlers: Record<string, ToolHandler>;  // Tool handler map
    projectRoot: string;              // Project root for tool execution
    client: OpenAI;                   // OpenAI client instance
    model: string;                    // Model name
    sessionId: string;                // Unique session ID
    thinking: { type: "enabled" | "disabled" };  // Thinking configuration
    temperature: number;              // LLM temperature (0-2)
    maxTurns: number;                 // Max tool-use loop iterations
    maxTokens: number;                // Max tokens per API call
    overallTimeoutMs: number;         // Total subagent timeout in milliseconds
  };
  ```
- [ ] `runSubagent()` internal logic (step-by-step):
  1. Validate inputs: `systemPrompt` non-empty, `userPrompt` non-empty, `client` not null, `tools` is array, `maxTurns > 0`, `overallTimeoutMs > 0`.
  2. Initialize messages array: `[{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]`.
  3. Initialize tool call counters: `{}` (dynamic — keyed by tool name).
  4. Track overall elapsed time: `const overallStart = Date.now()`.
  5. Loop `for (let turn = 0; turn < maxTurns; turn++)`:
     a. Calculate `remainingTimeoutMs = overallTimeoutMs - (Date.now() - overallStart)`. If ≤ 0 → return `"Subagent error: Timed out after ${overallTimeoutMs / 1000} seconds."`.
     b. Create per-call signal: `AbortSignal.timeout(Math.min(15000, remainingTimeoutMs))`.
     c. Call `client.chat.completions.create({ model, messages, tools, thinking, temperature, max_tokens: maxTokens }, { signal })`.
     d. If `response.usage` exists → `recordBudgetCost(projectRoot, model, response.usage as ModelUsage)`.
     e. Get assistant message from `response.choices[0]?.message`. If null/undefined → return `"Subagent error: No response from model."`.
     f. If message has `tool_calls` with length > 0: append assistant message to messages. For each tool call, execute via `toolHandlers[name]`, increment counter, format result as `{ role: "tool", tool_call_id, content: JSON.stringify(result) }`, append to messages. Continue loop.
     g. If message has non-empty `content` and `finish_reason` is not `"tool_calls"`: append to messages, return `content`.
     h. If `finish_reason === "length"`: append to messages. If content non-empty → return content. Else continue.
     i. If neither content nor tool_calls: append to messages, continue loop.
  6. Max turns reached: find last assistant message with non-empty content → return it. If none found and tools were called → return `"Task completed. Tools called: " + JSON.stringify(toolCounts)`. If no tools called → return `"Subagent error: No results produced."`.
  7. Catch all errors → return `"Subagent error: ${message}"`.
- [ ] `runSubagent()` NEVER touches session state, SessionManager, or any shared mutable state.
- [ ] `runExploreSubagent()` is refactored to call `runSubagent()`:
  - `systemPrompt`: `EXPLORE_SYSTEM_PROMPT + THOROUGHNESS_CONFIGS[thoroughness].systemPromptSuffix`
  - `userPrompt`: `"Explore the codebase: ${query}"`
  - `tools`: `READONLY_TOOL_DEFINITIONS`
  - `toolHandlers`: `READONLY_TOOL_HANDLERS`
  - `thinking`: `{ type: "disabled" }`
  - `temperature`: `0.1`
  - `maxTurns`, `maxTokens`, `overallTimeoutMs`: from `THOROUGHNESS_CONFIGS[thoroughness]`
- [ ] Existing Explore unit tests (15 tests) pass with zero changes to test assertions.
- [ ] `runSubagent()` is exported (used by skill subagent runner).

### FR-004: Skill Subagent Execution (`runSkillSubagent`)

**What:** A function `runSkillSubagent()` that executes an agent skill as an isolated subagent. It is a thin wrapper around `runSubagent()` that resolves the skill's configuration (model, thinking, tools, timeout). The skill's body content (the markdown after YAML frontmatter) becomes the subagent's system prompt. The user's task (`prompt` parameter) becomes the subagent's user prompt.

**Why:** Agent skills need a dedicated entry point that maps SKILL.md configuration to `runSubagent()` parameters. This function resolves defaults (cheap model, disabled thinking, 15 maxTurns, 120s timeout) and validates the skill's tool list against available tool handlers.

**Acceptance Criteria:**
- [ ] `runSkillSubagent()` signature: `async function runSkillSubagent(opts: SkillSubagentOptions): Promise<string>`.
- [ ] `SkillSubagentOptions` type:
  ```typescript
  type SkillSubagentOptions = {
    skill: SkillInfo;                  // The full skill metadata (name, description, tools, model, etc.)
    prompt: string;                    // User's task for the subagent
    projectRoot: string;               // Project root
    createOpenAIClient: CreateOpenAIClient;  // Factory for LLM client
  };
  ```
- [ ] `runSkillSubagent()` internal logic:
  1. Build system prompt from skill metadata via `buildSkillSystemPrompt(skill)`.
  2. Get LLM client from `createOpenAIClient()`.
  3. Resolve model: if `skill.agentModel` is set → use it; else → `getCheapModel(context.model) ?? context.model`.
  4. Resolve thinking: `skill.agentThinking === "enabled"` → `{ type: "enabled" }`, else → `{ type: "disabled" }`.
  5. Build tool definitions by filtering `getBuiltInToolDefinitions()` against the skill's `agentTools` whitelist (if specified). Exclude Explore from subagent tools. If `agentTools` has unknown tools → gracefully degrade to all 8 handler tools.
  6. Build tool handlers from `SKILL_TOOL_HANDLER_MAP` filtered to the resolved tool names.
  7. Call `runSubagent({ systemPrompt, userPrompt: prompt || skill.description, tools: toolDefs, toolHandlers, projectRoot, client: context.client, model, sessionId, thinking, temperature: 0.1, maxTurns: skill.agentMaxTurns ?? 50, maxTokens: 4096, overallTimeoutMs: skill.agentTimeoutMs ?? 300000 })`.
  8. Return the result string directly.
- [ ] If after resolving tools, the tool list is empty → return `"Agent error: No valid tools configured for skill '${skillName}'."`.
- [ ] The `prompt` must be non-empty after trim. If empty → return `"Agent error: Missing required 'prompt' string."`.
- [ ] `runSkillSubagent()` NEVER touches session state or shared mutable state.

### FR-005: Built-in Tool Definitions Extractor (`getBuiltInToolDefinitions`)

**What:** A function `getBuiltInToolDefinitions()` that returns the static built-in tool definitions (Read, Grep, Glob, Write, Edit, Bash, WebSearch, WebFetch, AskUserQuestion, UpdatePlan, Explore) WITHOUT agent skill tools. This is needed because `getTools()` includes agent skill tools, which must NOT be recursively available to subagents.

**Why:** Agent subagents must not have access to other agent skill tools (prevents infinite recursion). They should only have access to built-in tools plus tools the skill explicitly declares. `getTools()` returns everything — a separate function is needed for the "just built-ins" subset.

**Acceptance Criteria:**
- [ ] `getBuiltInToolDefinitions()` in `src/prompt.ts` returns the static array of built-in tool definitions.
- [ ] The returned array includes exactly ALL 11 built-in tools: Read, Grep, Glob, Write, Edit, Bash, WebSearch, WebFetch, AskUserQuestion, UpdatePlan, Explore. (Explore IS included — the main LLM needs it. Subagent code filters Explore OUT at the point of use — `runSkillSubagent()` explicitly excludes it from the tool list sent to subagent LLMs.)
- [ ] The function signature: `export function getBuiltInToolDefinitions(): ToolDefinition[]`.
- [ ] The function has NO parameters — it always returns the same static array.
- [ ] The array elements are the same objects already in `getTools()` — no duplication, DRY: `getTools()` calls `getBuiltInToolDefinitions()` and appends agent skill tools.

### FR-006: Tool Handler Map for Skill Subagents

**What:** A `SKILL_TOOL_HANDLER_MAP` constant in `src/tools/explore-subagent.ts` that maps tool names to their handler functions for use by `runSkillSubagent()`. This map includes all tools that agent skills might declare: read, grep, glob, write, edit, bash, web_search, web_fetch.

**Why:** `runSkillSubagent()` needs to dispatch tool calls to the correct handlers. The Explore subagent only needs Read, Grep, Glob (3 handlers). Agent skills may need many more. This map provides the lookup.

**Acceptance Criteria:**
- [ ] `SKILL_TOOL_HANDLER_MAP: Record<string, ToolHandler>` includes:
  - `read` → `handleReadTool`
  - `grep` → `handleGrepTool`
  - `glob` → `handleGlobTool`
  - `write` → `handleWriteTool`
  - `edit` → `handleEditTool`
  - `bash` → `handleBashTool`
  - `web_search` → `handleWebSearchTool`
  - `web_fetch` → `handleWebFetchTool`
- [ ] Handlers for write, edit, bash, web_search, web_fetch are imported from their respective modules.
- [ ] The map is a `const` (not `let`).

### FR-007: Agent Skill Tool Call Interception in Session Loop

**What:** The session loop (`appendToolMessages()` in `src/session.ts`) intercepts tool calls for agent skills (any tool call whose name matches a skill with `mode: "agent"`) and routes them to a `handleSkillToolCall()` function instead of `ToolExecutor`. This is the same pattern as the Explore interception (Spec 120 FR-006).

**Why:** Agent skill tools are not handled by `ToolExecutor` because they require spawning isolated sub-conversations. They must be intercepted at the session level where the OpenAI client, skills list, and project root are available.

**Acceptance Criteria:**
- [ ] A function `handleSkillToolCall()` in `src/tools/explore-subagent.ts`:
  - Signature: `async function handleSkillToolCall(toolCall: ToolCall, createOpenAIClient: CreateOpenAIClient, skill: SkillInfo, projectRoot: string): Promise<ToolExecutionResult>`.
  - Parses `toolCall.function.arguments` as JSON to extract `prompt`.
  - Validates `prompt` (non-empty string). Returns error if missing/invalid.
  - Delegates to `runSkillSubagent({ skill, prompt, projectRoot, createOpenAIClient })` (model, thinking, tools all resolved inside `runSkillSubagent()`).
  - Returns `{ ok: true, name: skill.name, output: summary }` on success.
  - Returns `{ ok: false, name: skill.name, error: message }` on failure.
- [ ] In `appendToolMessages()` (`src/session.ts`), the interception logic is extended:
  - After the Explore interception check (`if (toolCall.function.name === "Explore")`), add a second check: look up `toolCall.function.name` in the agent skills map.
  - If the tool call name matches an agent skill → route to `handleSkillToolCall(toolCall, skill, this.createOpenAIClient, this.projectRoot)`.
  - The result is formatted using the same `formatSubagentToolResult()` method.
- [ ] The agent skill name → `SkillInfo` lookup is fast (a `SkillInfo[]` cache built once when skills are loaded).

### FR-008: Agent Skills Excluded from Keyword Matching and Prompt Injection

**What:** Skills with `mode: "agent"` are excluded from keyword-based auto-matching in `matchSkillsByKeywords()`. They are also excluded from system message injection in the skill loading pipeline (`normalizeSkills()` / `buildSkillPrompt()`). Agent skills only execute via tool call — never as injected prompts.

**Why:** Agent skills run as subagents, not as prompts. Injecting both the agent skill prompt AND having it available as a tool would be redundant and wasteful. The LLM should interact with agent skills exclusively through tool calls.

**Acceptance Criteria:**
- [ ] `matchSkillsByKeywords()` in `src/session.ts` gains a guard: `if (skill.mode === "agent") continue;` alongside the existing `if (skill.inclusion === "manual") continue;`.
- [ ] In `normalizeSkills()` (or wherever skills are loaded into the conversation), agent-mode skills are skipped — they are not injected as system messages.
- [ ] Agent skills still appear in `listSkills()` (the `/skills` dropdown) — the user can see all skills regardless of mode.
- [ ] Agent skills still respond to `#skill-name` prefix in PromptInput. When the user types `#skill-name` for an agent skill, the PromptInput detection (Spec 110) fires and adds the skill to `selectedSkills`. In `normalizeSkills()`, when an agent-mode skill is found in `selectedSkills`, instead of injecting the full skill body, a single lightweight system message is added: `"The user has explicitly requested the use of the '${skill.name}' agent skill. Use the '${skill.name}' tool to delegate work to it."`. This nudges the LLM toward the agent skill without polluting context. The skill body is NOT injected — only this hint message and the tool availability (from FR-002) enable the LLM to use the skill.
- [ ] The `isLoaded` tracking for agent skills is irrelevant (they're never loaded via keyword matching). The `isLoaded` field on `SkillInfo` is not set for agent skills.

### FR-009: Agent Skill Budget Tracking

**What:** Every API call made by an agent skill subagent is recorded in the project budget file via `recordBudgetCost()`, same as Explore (Spec 120 FR-004) and WebSearch (Spec 10). The model used for budget recording is the resolved model (agent-specific or cheap fallback).

**Why:** Cost transparency (V11). Users must see what agent skill subagents cost. This is already handled by `runSubagent()` which calls `recordBudgetCost()` after each API call.

**Acceptance Criteria:**
- [ ] `runSubagent()` calls `recordBudgetCost(projectRoot, model, response.usage as ModelUsage)` after each `client.chat.completions.create()` call if `response.usage` exists.
- [ ] The `model` parameter passed to `recordBudgetCost()` is the actual model used for the API call (`agentModel ?? cheapModel`).
- [ ] Budget entries use the same format and file (`management/budget.md`) as all other entries.
- [ ] No separate budget tracking code in `runSkillSubagent()` — it delegates entirely to `runSubagent()`.

### FR-010: Agent Skill Timeout

**What:** Agent skill subagents have a configurable overall timeout (default: 120 seconds) and a per-call timeout of 15 seconds, same pattern as Explore (Spec 120 FR-008). The timeout is configured in SKILL.md via the `timeout` field (milliseconds).

**Why:** Without a timeout, a stuck agent skill (infinite tool loop) would block the main conversation indefinitely.

**Acceptance Criteria:**
- [ ] Overall timeout: configured in SKILL.md `timeout` field (default: 120000ms = 2 minutes).
- [ ] Per-call timeout: 15 seconds (`AbortSignal.timeout(15000)`).
- [ ] If the per-call timeout triggers, `runSubagent()` returns `"Subagent error: API call timed out."`.
- [ ] If the overall timeout triggers, `runSubagent()` returns `"Subagent error: Timed out after N seconds."`.
- [ ] `handleSkillToolCall()` wraps error strings (starting with `"Agent error:"` or `"Subagent error:"`) in `{ ok: false, error: ... }`.

### FR-011: Agent Skill Model and Thinking Configuration

**What:** Agent skills can override the default model via the `model` field in SKILL.md. They can enable thinking via `thinking: enabled`. If not specified, the skill uses the cheap model (`getCheapModel()` result) with thinking disabled.

**Why:** Some skills may require a more capable model (e.g., a "code-review" skill might want `deepseek-v4-pro`). Some skills may benefit from extended thinking for complex reasoning tasks. The default (cheap model, no thinking) optimizes for cost.

**Acceptance Criteria:**
- [ ] If `model` is specified in SKILL.md frontmatter, that exact model ID is used (no fallback to cheap, no validation — if the model doesn't exist, the API call will fail and the error propagates).
- [ ] If `model` is not specified, the cheap model is used: `getCheapModel(mainModel) ?? mainModel`.
- [ ] If `thinking: enabled` is specified, `thinking: { type: "enabled" }` is passed to the API.
- [ ] If `thinking` is not specified or is `"disabled"`, `thinking: { type: "disabled" }` is passed.
- [ ] Temperature is always `0.1` for agent skills (deterministic behavior).
- [ ] `max_tokens` per API call is 4096 (fixed for all agent skills).

### FR-012: Backward Compatibility

**What:** All existing skills without `mode` continue to work exactly as before. Skills with `mode: "prompt"` (explicit or default) behave identically to pre-Spec-130 behavior. The Explore subagent (Spec 120) is unaffected. No existing tests break.

**Why:** Backward compatibility is a core requirement from V17. Users must be able to upgrade without any behavior change to existing skills.

**Acceptance Criteria:**
- [ ] Skills without `mode` field → `SkillInfo.mode` is `undefined` → treated as `"prompt"` → injected as system message (current behavior).
- [ ] Skills with `mode: "prompt"` → injected as system message (same as undefined).
- [ ] Skills with `mode: "agent"` but missing `tools` → treated as `mode: "prompt"` (graceful degradation).
- [ ] The Explore subagent (Spec 120) continues to work exactly as before.
- [ ] `npm test` passes with zero regressions.
- [ ] All 15 Explore subagent tests pass unchanged.

---

## Non-Functional Requirements

### NFR-001: Performance — Agent Skill Completion Time

**What:** Agent skill subagents must complete within their configured timeout (default: 120 seconds).

**Acceptance Criteria:**
- [ ] Default timeout is 120 seconds (wall clock).
- [ ] Skill authors can configure shorter or longer timeouts via the `timeout` field.
- [ ] Measured from the start of `runSkillSubagent()` to when it returns.

### NFR-002: Reliability — Error Recovery

**What:** Agent skill subagent failures must not crash the main session.

**Acceptance Criteria:**
- [ ] Any error in `runSkillSubagent()` / `runSubagent()` is caught and returned as an error string.
- [ ] The main session continues operating after a failed agent skill call.
- [ ] Network errors, rate limits, and authentication errors all produce distinct, human-readable error messages prefixed with `"Subagent error:"` or `"Agent error:"`.
- [ ] Partial results from agent skills are discarded on error.

### NFR-003: Maintainability — Code Isolation

**What:** Agent skill subagent code lives in `src/tools/explore-subagent.ts` (alongside Explore subagent code). The `SkillInfo` type extension and parsing live in `src/session.ts`. Tool definition generation lives in `src/prompt.ts`.

**Acceptance Criteria:**
- [ ] `src/tools/explore-subagent.ts` gains: `SubagentOptions`, `runSubagent()`, `SkillSubagentOptions`, `runSkillSubagent()`, `SKILL_TOOL_HANDLER_MAP`, `handleSkillToolCall()`.
- [ ] `src/session.ts` gains: 6 new fields on `SkillInfo`, 30 lines in `readSkillInfo()` for `mode` parsing, 1 guard in `matchSkillsByKeywords()`, agent skill filtering + hint messages in `normalizeSkills()`, agent skill interception in `appendToolMessages()`.
- [ ] `src/prompt.ts` gains: `getBuiltInToolDefinitions()`, agent skill tool generation in `getTools()`.
- [ ] No modifications to existing tool handlers (read-handler.ts, grep-handler.ts, glob-handler.ts, write-handler.ts, edit-handler.ts, bash-handler.ts, web-search-handler.ts, web-fetch-handler.ts).

### NFR-004: Testability

**What:** All new functions must be testable without a real LLM API connection.

**Acceptance Criteria:**
- [ ] `runSubagent()` accepts an `OpenAI` client instance — tests can inject a mock.
- [ ] `runSkillSubagent()` accepts an `OpenAI` client instance — tests can inject a mock.
- [ ] `handleSkillToolCall()` accepts a `createOpenAIClient` factory — tests can inject a mock.
- [ ] Unit tests cover: `mode` parsing, tool definition generation, agent skill interception, error propagation, budget recording, timeout handling.

### NFR-005: Zero Schema or Storage Changes

**What:** No changes to settings schema, session storage format, or any persistent data structures.

**Acceptance Criteria:**
- [ ] `settings.json` schema unchanged.
- [ ] Session storage format unchanged (`SessionMessage` type unchanged).
- [ ] `SkillInfo` gains fields but these are transient (parsed from SKILL.md each time, never persisted).

---

## Constraints

- **C1:** Must follow the Spec 120 Explore subagent pattern: isolated context, cheap model default, thinking disabled default, budget tracking per API call, session-level tool interception.
- **C2:** Must not introduce new npm dependencies (P6 from arch.md).
- **C3:** Must use `getCheapModel()` from `model-catalog.ts` — no hardcoded model string for defaults (ADR-005).
- **C4:** Must be backward compatible — no changes to existing skill behavior, session storage format, or settings schema.
- **C5:** Must work with the current DeepSeek provider. Agent subagents use the existing `client.chat.completions.create()` from the OpenAI SDK — no provider-specific code.
- **C6:** Agent skill tool definitions must NOT appear in tool definitions sent to subagents (no recursive agent delegation).
- **C7:** `runExploreSubagent()` refactoring must produce ZERO behavioral change — all 15 Explore tests must pass unchanged.

---

## Edge Cases & Error States

| Scenario | Expected Behavior |
|----------|-------------------|
| SKILL.md has `mode: agent` but no `tools` field | Treated as `mode: "prompt"` (graceful degradation). Skill is injected as system message. |
| SKILL.md has `mode: agent` but `tools: []` (empty array) | Treated as `mode: "prompt"`. |
| SKILL.md has `mode: agent` with `tools: ["read", "nonexistent_tool"]` | `"nonexistent_tool"` is skipped (logged to stderr). Skill subagent only gets `read`. If 0 valid tools remain → treated as `mode: "prompt"`. |
| SKILL.md has `mode: agent` with `tools: ["write", "bash"]` (dangerous tools) | Subagent gets Write and Bash. The permission system still applies — `write` and `bash` require user confirmation unless pre-approved in settings. |
| SKILL.md has `mode: agent` with `model: "nonexistent-model"` | API call will fail → subagent returns `"Subagent error: ..."` → `handleSkillToolCall()` wraps in `{ ok: false, error: ... }`. |
| SKILL.md has `mode: agent` and `thinking: enabled` | API call includes `thinking: { type: "enabled" }`. Model must support thinking or API call fails. |
| `prompt` argument is missing from tool call | `handleSkillToolCall()` returns `{ ok: false, error: "Missing required 'prompt' string." }`. |
| `prompt` is empty string or whitespace | Same as missing — error returned. |
| Agent skill name conflicts with built-in tool name (e.g., skill named "Read") | Skill is NOT registered as a tool. Warning logged to stderr. Skill still appears in `/skills` list and can be used as `mode: "prompt"`. |
| Two agent skills have the same name | `listSkills()` already deduplicates by path. If two different skills have the same `name` field, the first one loaded wins for tool registration. |
| `createOpenAIClient()` returns null client | `handleSkillToolCall()` returns `{ ok: false, error: "LLM client is not available." }`. |
| Subagent API call returns no `choices` (empty array) | `runSubagent()` returns `"Subagent error: No response from model."`. |
| Subagent API call returns `choices[0].finish_reason === "length"` (token limit hit mid-response) | Use whatever content was returned. If content is empty, continue loop. |
| Subagent API call returns `choices[0].message` null/undefined | `runSubagent()` returns `"Subagent error: No response from model."`. |
| Subagent reaches maxTurns without producing content | Return last non-empty content, or fallback JSON with tool counts, or `"Subagent error: No results produced."` if no tools called. |
| Per-call timeout (15s) triggers | `runSubagent()` returns `"Subagent error: API call timed out."`. |
| Overall timeout triggers | `runSubagent()` returns `"Subagent error: Timed out after N seconds."`. |
| Skill file deleted between listing and tool call | `SkillInfo` is already in memory (loaded at session start via `listSkills()`). The subagent uses the parsed metadata and `buildSkillSystemPrompt()` — no file re-read needed. The subagent executes normally. |
| Multiple agent skill tool calls in the same batch | Each processed sequentially (same as Explore in Spec 120). |
| Agent skill tool call alongside Explore in the same batch | Both are intercepted and processed sequentially. |
| Budget file write fails (disk full, permissions) | `recordBudgetCost` handles gracefully — subagent continues, cost silently not recorded. |
| User interrupts (Ctrl+C) during agent skill execution | The `AbortSignal` propagates through API calls. `runSubagent()` catches and returns error. Main session handles interrupt. |
| SKILL.md YAML is malformed | `matter()` returns empty data. `mode` is undefined → defaults to `"prompt"`. |
| SKILL.md has `mode: "Agent"` (wrong case) | Case-sensitive validation → treated as `undefined` → defaults to `"prompt"`. |
| SKILL.md has `maxTurns: 0` or negative | Defaults to `15`. |
| SKILL.md has `timeout: 0` or negative | Defaults to `120000`. |
| SKILL.md has `tools` that is not an array (e.g., string, number) | Treated as empty → skill defaults to `mode: "prompt"`. |

---

## Dependencies

- **Internal:** Spec 120 (explore-subagent) — the `runSubagent()` function and interception pattern. Spec 110 (skills-inclusion-modes) — the `#skill-name` prefix handling and `inclusion` field (agent skills are excluded from keyword matching). `src/common/model-catalog.ts` (`getCheapModel`), `src/common/budget-tracker.ts` (`recordBudgetCost`), `src/tools/executor.ts` (`ToolCall`, `ToolExecutionResult`, `CreateOpenAIClient`, `ToolHandler`), `src/prompt.ts` (`getTools`, `getBuiltInToolDefinitions`, `ToolDefinition`), all existing tool handlers.
- **External:** `openai` npm package (OpenAI client — already a dependency), `gray-matter` (already imported for YAML frontmatter parsing).
- **Specs:** Spec 120 (explore-subagent) MUST be done. Spec 110 (skills-inclusion-modes) MUST be done. Spec 130 depends on both.

---

## Out of Scope

- **User-configurable subagents** via `.dscode/agents/*.md` — not in current plan.
- **Parallel agent skill execution** — agent skills run sequentially within a turn.
- **Agent-to-agent delegation** (nesting) — agent skills cannot call other agent skills. The tool definitions sent to subagents exclude agent skill tools and Explore.
- **Agent skill progress UI** — subagent execution is invisible to the user (no progress bar), same as Explore.
- **Agent skill results caching** — each call does fresh work.
- **Dynamic tool permission escalation** — agent skills use the same permission system as the main conversation. No special permission overrides for subagents.
- **Agent skill streaming to user** — subagent output is not streamed to the UI (AD-120-003).
- **Skill `model` field validation against catalog** — the model string is passed as-is to the API. No validation that it exists in `MODEL_CATALOG`.
- **Skill `tools` field validation beyond existence** — if a tool exists in `SKILL_TOOL_HANDLER_MAP`, it's available. No checking whether tools make sense together (e.g., "read" + "bash").
- **Agent skill chaining** — one agent skill's output is not automatically fed to another agent skill.
