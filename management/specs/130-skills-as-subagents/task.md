# Spec 130: Skills as Subagents — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

## Tasks

### Task 1: Extend `SkillInfo` Type and `readSkillInfo()` in `session.ts`

**Objective:** Add `mode` and agent-specific fields to `SkillInfo` type and parse them from SKILL.md YAML frontmatter.

**Requirements Covered:** FR-001 (`mode` field in SkillInfo and SKILL.md)

**Design References:** Component: SkillInfo Type Extension, Component: readSkillInfo() Extension

**Actions:**
1. Open `src/session.ts`.
2. Find `export type SkillInfo` (line ~297).
3. Add 6 new optional fields to the type:
   ```typescript
   mode?: "prompt" | "agent";
   agentModel?: string;
   agentThinking?: "enabled" | "disabled";
   agentTools?: string[];
   agentMaxTurns?: number;
   agentTimeoutMs?: number;
   ```
4. Find `private readSkillInfo()` (line ~709).
5. After the existing `inclusion` parsing block (after `const inclusion = ...`), add the mode and agent field parsing logic exactly as specified in design.md Component: readSkillInfo() Extension.
6. Add `mode` and all agent fields to the returned object (both in the parsed-success path and the fallback path — fallback returns undefined for all new fields).
7. Run `npx tsc -p ./ --noEmit` to verify TypeScript compiles.

**Validation:** TypeScript compiles without errors. `SkillInfo` type has 6 new optional fields.

**Status:** [x] done

---

### Task 2: Extract `BUILTIN_TOOL_DEFINITIONS` and Create `getBuiltInToolDefinitions()`

**Objective:** Extract the static built-in tool definitions from `getTools()` into module-level constants and create `getBuiltInToolDefinitions()`.

**Requirements Covered:** FR-005 (getBuiltInToolDefinitions)

**Design References:** Component: getBuiltInToolDefinitions()

**Actions:**
1. Open `src/prompt.ts`.
2. Find the `getTools()` function (line ~441).
3. Extract the static array of built-in tool definitions (Read, Grep, Glob, Write, Edit, Bash, WebSearch, WebFetch, AskUserQuestion, UpdatePlan, Explore) into a module-level `const BUILTIN_TOOL_DEFINITIONS: ToolDefinition[]`.
4. Create `export function getBuiltInToolDefinitions(): ToolDefinition[]` that returns `BUILTIN_TOOL_DEFINITIONS`.
5. Modify `getTools()` to start its array with `...getBuiltInToolDefinitions()` instead of the inline array.
6. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. `getTools()` returns the same array as before (same length, same elements). `getBuiltInToolDefinitions()` exists and returns the 11 built-in tool definitions (Explore included in built-ins, but excluded by subagent code when building subagent tool lists).

**Status:** [x] done

---

### Task 3: Generate Agent Skill Tool Definitions in `getTools()`

**Objective:** Add the `skills` parameter to `getTools()` and append tool definitions for agent-mode skills.

**Requirements Covered:** FR-002 (agent skill tool definitions)

**Design References:** Component: getTools() Extension for Agent Skills

**Actions:**
1. In `src/prompt.ts`, modify `getTools()` signature to add `skills: SkillInfo[] = []` as the third parameter.
2. Import `SkillInfo` from `../session` (or use `import type`).
3. After the existing tools array construction (built-ins + external tools), add the agent skill generation logic exactly as specified in design.md Component: getTools() Extension.
4. Build a `Set` of built-in tool names for conflict detection.
5. Filter skills with `mode === "agent"`, skip those with conflicting names (log warning to stderr), sort alphabetically.
6. Generate tool definitions with `type: "function"`, `function.name: skill.name`, `function.description: \`${skill.description}\n\nThis is an agent skill...\``, `function.parameters` with required `prompt` string property.
7. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. `getTools([], [], [agentSkill])` returns array with agent skill tool at the end. `getTools([], [], [])` returns same as before.

**Status:** [x] done

---

### Task 4: Update SessionManager to Pass Skills to `getTools()`

**Objective:** Modify `SessionManager` to pass the skills list to `getTools()` when building the tools array for the LLM.

**Requirements Covered:** FR-002 (skills reach the LLM tool list)

**Design References:** Data Flow: Agent Skill Registration

**Actions:**
1. Open `src/session.ts`.
2. Find all call sites where `getTools()` is called (in `createSession()`, `replySession()`, etc.).
3. At each call site, pass the skills list as the third argument: `getTools(options, externalTools, skills)`.
4. Ensure `skills` is the same skills array retrieved from `listSkills()`.
5. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. When a skill with `mode: "agent"` exists, the tools array sent to the LLM includes the agent skill tool definition.

**Status:** [x] done

---

### Task 5: Extract `runSubagent()` and Refactor `runExploreSubagent()`

**Objective:** Create the generalized `SubagentOptions` type, extract `runSubagent()` from the existing subagent loop, and refactor `runExploreSubagent()` to use it.

**Requirements Covered:** FR-003 (generalized subagent runner)

**Design References:** Component: SubagentOptions Type, Component: runSubagent()

**Actions:**
1. Open `src/tools/explore-subagent.ts`.
2. Add `export type SubagentOptions` with all 13 fields exactly as specified in design.md Component: SubagentOptions Type.
3. Add `export async function runSubagent(opts: SubagentOptions): Promise<string>` that contains the generalized multi-turn loop:
   - The loop logic is moved from `runExploreSubagent()` — same structure but uses `opts` fields instead of hardcoded Explore values.
   - Error prefixes: `"Subagent error:"` instead of `"Explore error:"`.
   - Tool counting uses dynamic `Record<string, number>` instead of the hardcoded `{ read, grep, glob }`.
   - No thoroughness-specific logic — all config comes from `opts`.
   - The full loop logic is specified in design.md Component: runSubagent() steps 1-7.
4. Refactor `runExploreSubagent()` to be a thin wrapper that calls `runSubagent()` with Explore-specific configuration. The refactored function:
   - Still validates `query` and resolves thoroughness.
   - Builds system prompt from `EXPLORE_SYSTEM_PROMPT + config.systemPromptSuffix`.
   - Calls `runSubagent()` with: `systemPrompt`, `userPrompt: "Explore the codebase: ${query}"`, `tools: READONLY_TOOL_DEFINITIONS`, `toolHandlers: READONLY_TOOL_HANDLERS`, `projectRoot`, `client`, `model`, `sessionId`, `thinking: { type: "disabled" }`, `temperature: 0.1`, `maxTurns: config.maxTurns`, `maxTokens: config.maxTokens`, `overallTimeoutMs: config.overallTimeoutMs`.
5. Remove the inlined loop code from `runExploreSubagent()` (the try/catch block with the for loop).
6. Keep the `"Explore error:"` prefix for the `!opts.query.trim()` validation.
7. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. Existing 15 Explore tests pass unchanged (`node --import tsx --test src/tests/explore-subagent.test.ts`).

**Status:** [x] done

---

### Task 6: Add `SKILL_TOOL_HANDLER_MAP` and New Handler Imports

**Objective:** Create the tool handler map for agent skills and add imports for write, edit, bash, web_search, web_fetch handlers.

**Requirements Covered:** FR-006 (tool handler map)

**Design References:** Component: SKILL_TOOL_HANDLER_MAP

**Actions:**
1. Open `src/tools/explore-subagent.ts`.
2. Add imports at the top:
   ```typescript
   import { handleWriteTool } from "./write-handler";
   import { handleEditTool } from "./edit-handler";
   import { handleBashTool } from "./bash-handler";
   import { handleWebSearchTool } from "./web-search-handler";
   import { handleWebFetchTool } from "./web-fetch-handler";
   ```
3. Add `const SKILL_TOOL_HANDLER_MAP: Record<string, ToolHandler>` with entries for: `read`, `grep`, `glob`, `write`, `edit`, `bash`, `web_search`, `web_fetch`.
4. Import `ToolHandler` from `./executor` (already imported as `type` — change to value import or add a separate import since `ToolHandler` is used as a value in the map).
5. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. `SKILL_TOOL_HANDLER_MAP` has 8 entries.

**Status:** [x] done

---

### Task 7: Add `SkillSubagentOptions` Type and `runSkillSubagent()`

**Objective:** Create the skill subagent options type and the skill subagent runner function.

**Requirements Covered:** FR-004 (skill subagent execution)

**Design References:** Component: SkillSubagentOptions Type, Component: runSkillSubagent()

**Actions:**
1. Open `src/tools/explore-subagent.ts`.
2. Add `export type SkillSubagentOptions` with all 12 fields exactly as specified in design.md Component: SkillSubagentOptions Type.
3. Add `export async function runSkillSubagent(opts: SkillSubagentOptions): Promise<string>` with the logic exactly as specified in design.md Component: runSkillSubagent() — 6 steps.
4. Import `getBuiltInToolDefinitions` from `../prompt`.
5. Import `ToolDefinition` type from `./executor`.
6. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. `runSkillSubagent()` exists with correct signature.

**Status:** [x] done

---

### Task 8: Add `handleSkillToolCall()` Function

**Objective:** Create the entry point function for agent skill tool calls.

**Requirements Covered:** FR-007 (agent skill tool call interception — handler side)

**Design References:** Component: handleSkillToolCall()

**Actions:**
1. Open `src/tools/explore-subagent.ts`.
2. Add imports: `fs` from `node:fs`, `path` from `node:path`, `matter` from `gray-matter`.
3. Add `import type { SkillInfo } from "../session"`.
4. Add `export async function handleSkillToolCall(toolCall: ToolCall, skill: SkillInfo, createOpenAIClient: CreateOpenAIClient, projectRoot: string): Promise<ToolExecutionResult>` with the logic exactly as specified in design.md Component: handleSkillToolCall() — 8 steps.
5. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. `handleSkillToolCall()` exists with correct signature.

**Status:** [x] done

---

### Task 9: Add Agent Skill Interception in `session.ts`

**Objective:** Add agent skill interception in the session loop and build the agent skills lookup map.

**Requirements Covered:** FR-007 (agent skill interception), FR-008 (exclude agent skills from keyword matching)

**Design References:** Component: Agent Skill Interception, Component: Agent Skills Excluded from Keyword Matching

**Actions:**
1. Open `src/session.ts`.
2. Add import: `import { handleSkillToolCall } from "./tools/explore-subagent";` (next to the existing `handleExploreToolCall` import).
3. Add `private agentSkillsByName: Map<string, SkillInfo> = new Map();` to the `SessionManager` class.
4. Add `private updateAgentSkillsMap(skills: SkillInfo[]): void` method that clears and rebuilds the map with agent-mode skills.
5. Call `this.updateAgentSkillsMap(skills)` in `listSkills()` after skills are loaded.
6. In `appendToolMessages()`, after the Explore interception block (after `if (toolCall.function.name === "Explore")` block closes with `continue`), add the agent skill interception:
   ```typescript
   const agentSkill = this.agentSkillsByName.get(toolCall.function.name);
   if (agentSkill) {
     const skillResult = await handleSkillToolCall(toolCall as ToolCall, agentSkill, this.createOpenAIClient, this.projectRoot);
     const content = this.formatSubagentToolResult(skillResult);
     toolExecutions.push({ toolCallId: toolCall.id, content, result: skillResult });
     continue;
   }
   ```
7. In `matchSkillsByKeywords()`, add guard: `if (skill.mode === "agent") continue;` after the existing `if (skill.inclusion === "manual") continue;`.
8. In `normalizeSkills()`: after deduplication (line ~780), split skills into prompt-mode and agent-mode:
   ```typescript
   const promptSkills = dedupedSkills.filter((s) => s.mode !== "agent");
   const agentSkills = dedupedSkills.filter((s) => s.mode === "agent");
   ```
   - Build system messages ONLY for `promptSkills` (existing behavior — `buildSkillPrompt` + `buildSkillMessage`).
   - For each skill in `agentSkills`, build a lightweight hint message with content: `"The user has explicitly requested the use of the '${skill.name}' agent skill. Use the '${skill.name}' tool to delegate work to it."`. Use `this.buildSkillMessage(sessionId, hintContent, skill)` to create the message (same method, different content). Append these hint messages to the session messages array. The full skill body is NOT injected — only the hint.
9. Run `npx tsc -p ./ --noEmit` to verify.

**Validation:** TypeScript compiles. Agent skill tool calls are routed to `handleSkillToolCall()`. Agent skills are excluded from keyword matching and prompt injection.

**Status:** [x] done

---

### Task 10: Add Unit Tests for `mode` Parsing and `getTools()` Agent Skill Generation

**Objective:** Create tests for the new fields in SkillInfo and the tool generation in getTools().

**Requirements Covered:** FR-001, FR-002, FR-005

**Design References:** Testing Strategy: Unit Tests `mode` Parsing (tests 1-15), Unit Tests: getTools() (tests 16-22)

**Actions:**
1. Create `src/tests/skills-as-subagents.test.ts`.
2. Import test framework: `node:assert`, `node:test`.
3. Import `getTools`, `getBuiltInToolDefinitions` from `../prompt`.
4. Write tests 1-15 from the Testing Strategy for `mode` field parsing:
   - Since `readSkillInfo()` is a private method on `SessionManager`, tests should create temporary SKILL.md files in a temp directory and call the public `listSkills()` method, then verify the returned SkillInfo fields.
   - Tests 1-15 cover: mode parsing, validation, fallback, agent fields parsing, edge cases.
5. Write tests 16-22 from the Testing Strategy for `getTools()`:
   - Test with empty skills array → only built-ins returned.
   - Test with one agent skill → agent skill tool included.
   - Test with multiple agent skills → all included alphabetically.
   - Test name conflict → skill skipped, warning logged.
   - Test agent skill tool structure.
   - Test `getBuiltInToolDefinitions()` excludes agent skill tools but includes all 11 built-in tools including Explore.
6. Run `node --import tsx --test src/tests/skills-as-subagents.test.ts` to verify all pass.

**Validation:** All 22 tests pass. Zero failures.

**Status:** [x] done

---

### Task 11: Add Unit Tests for `runSubagent()`, `runSkillSubagent()`, and `handleSkillToolCall()`

**Objective:** Create comprehensive tests for the new subagent functions.

**Requirements Covered:** FR-003, FR-004, FR-006, FR-007, FR-009, FR-011

**Design References:** Testing Strategy: Unit Tests runSubagent (tests 23-30), runSkillSubagent (tests 31-39), handleSkillToolCall (tests 40-45)

**Actions:**
1. In `src/tests/skills-as-subagents.test.ts`, import `runSubagent`, `runSkillSubagent`, `handleSkillToolCall` from `../tools/explore-subagent`.
2. Create mock OpenAI client factory for tests.
3. Mock `recordBudgetCost` by wrapping/importing.
4. Write tests 23-30 for `runSubagent()`:
   - Direct content response.
   - Multi-turn tool loop.
   - Max turns enforcement.
   - Fallback on max turns with no content.
   - Budget recording per API call.
   - API failure error propagation.
   - Timeout error.
   - Thinking and temperature configuration.
5. Write tests 31-39 for `runSkillSubagent()`:
   - Empty prompt error.
   - Empty skill body error.
   - No valid tools error.
   - Uses agent model override.
   - Falls back to cheap model.
   - Thinking enabled/disabled.
   - Tool resolution and Explore exclusion.
6. Write tests 40-45 for `handleSkillToolCall()`:
   - Missing prompt error.
   - Empty prompt error.
   - Null LLM client error.
   - Malformed JSON arguments error.
   - Skill file not found error.
   - Success path.
7. Run `node --import tsx --test src/tests/skills-as-subagents.test.ts` to verify all pass.

**Validation:** All 23 tests pass (8 + 9 + 6). Zero failures.

**Status:** [x] done

---

### Task 12: Verify Existing Tests Pass (Zero Regressions)

**Objective:** Ensure zero regressions in the existing test suite.

**Requirements Covered:** FR-012 (backward compatibility)

**Design References:** C7 (runExploreSubagent refactoring must produce zero behavioral change)

**Actions:**
1. Run the Explore subagent tests: `node --import tsx --test src/tests/explore-subagent.test.ts`.
2. Verify all 15 tests pass unchanged.
3. Run the full test suite: `npm test`.
4. Verify all existing tests pass — zero failures, zero new skipped tests.
5. If any test fails, fix the regression before proceeding.

**Validation:** `npm test` exits with code 0, no test failures.

**Status:** [x] done

---

### Task 13: Rebuild Bundle and Manual Smoke Test

**Objective:** Build the production bundle and manually verify agent skills work end-to-end.

**Requirements Covered:** FR-001, FR-002, FR-007, FR-009

**Actions:**
1. Create a test agent skill at `.dscode/skills/test-agent/SKILL.md`:
   ```yaml
   ---
   name: test-agent
   description: A test agent that can read and search the codebase.
   mode: agent
   tools: [read, grep, glob]
   inclusion: auto
   ---
   # Test Agent
   
   You are a test agent. When given a task, use Read and Grep to find relevant information.
   Return a concise summary of what you found.
   ```
2. Run `npx esbuild ./src/cli.tsx --bundle --platform=node --format=esm --target=node24 --outfile=dist/cli.js --banner:js="#!/usr/bin/env node" --jsx=automatic --jsx-import-source=react --packages=external --log-override:empty-import-meta=silent`.
3. Launch DsCode from the new bundle.
4. Verify the `test-agent` tool appears in the system prompt / tool list.
5. Trigger the agent skill: type `#test-agent Find where recordBudgetCost is defined`.
6. Verify the agent subagent executes and returns results.
7. Verify `management/budget.md` records the subagent's API costs under the skill's model (or cheap model).
8. Verify the main conversation remains clean (intermediate agent steps not visible).

**Validation:** Agent skill is invoked via `#` prefix or LLM auto-delegation, subagent returns results, budget records costs, main conversation remains clean.

**Status:** [x] done
