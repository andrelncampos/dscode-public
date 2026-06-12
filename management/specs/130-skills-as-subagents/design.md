# Spec 130: Skills as Subagents — Design

## Design Approach

**Pattern:** Extend the Spec 120 subagent infrastructure to support arbitrary skills as isolated subagents. Follow the exact same interception pattern (session-level routing before `ToolExecutor`), same context isolation (own messages array, tools, model), same budget tracking. The key difference: agent skills use the skill's body content as the system prompt and the skill's configured tools/model/thinking instead of fixed Explore defaults.

**KISS:** One file modified (`src/tools/explore-subagent.ts` — extract `runSubagent()`, add `runSkillSubagent()`, `handleSkillToolCall()`, `SKILL_TOOL_HANDLER_MAP`). Two existing files modified (`src/session.ts` — `SkillInfo` extension + interception, `src/prompt.ts` — agent skill tool generation + `getBuiltInToolDefinitions()`). Zero new files. Zero new dependencies.

**DRY:** `runExploreSubagent()` refactored to call `runSubagent()` — zero duplication of the multi-turn loop. `getTools()` calls `getBuiltInToolDefinitions()` — zero duplication of tool definitions. The `formatSubagentToolResult()` method in `session.ts` (already exists from Spec 120) is reused for agent skill tool results.

**Backward Compatibility:** All existing skills without `mode` or with `mode: "prompt"` are unchanged. The Explore subagent is refactored internally but behavior is verified by its 15 existing tests passing unchanged.

---

## Architecture Decisions

### AD-130-001: Agent Skills as Tools (not Injected Prompts)

**Decision:** Skills with `mode: "agent"` appear as tool definitions in the LLM's toolkit, NOT as injected system messages. The LLM decides when to invoke them (auto-delegation), exactly like the Explore tool.

**Rationale:** Tool-based delegation is a proven pattern (Spec 120). It keeps the main conversation context clean. The LLM can decide based on the tool description whether to delegate. Injected prompts consume context window and offer no execution isolation.

**Alternatives considered:**
- **Inject subagent result at skill load time:** Load the skill, immediately spawn subagent, inject result as system message. Rejected — unnecessary API call on every matching prompt, defeats context isolation.
- **Hybrid: prompt injection + tool availability:** Both inject the skill AND offer it as a tool. Rejected — redundant, wastes context window.

### AD-130-002: Generalized `runSubagent()` Extraction

**Decision:** Extract the multi-turn subagent loop from `runExploreSubagent()` into a generalized `runSubagent()` function. `runExploreSubagent()` becomes a thin wrapper. `runSkillSubagent()` is a new thin wrapper.

**Rationale:** The Explore loop and the skill subagent loop are structurally identical (messages array, LLM call loop, tool execution, budget recording, timeout). Extracting avoids ~150 lines of duplication. The refactoring is surgical — `runExploreSubagent()` keeps its exact public API and behavior.

**Alternative rejected:** Duplicate the loop for skills. Would add ~150 lines of near-identical code. Violates DRY.

### AD-130-003: No Recursive Agent Delegation

**Decision:** Agent skill tool definitions are excluded from the tool set sent to subagents. Agent skills cannot call other agent skills. The `getBuiltInToolDefinitions()` function returns only built-in tools, which is what subagents receive.

**Rationale:** Recursive delegation risks infinite loops and unpredictable costs. Skills as subagents are leaf nodes — they do work, not orchestration. If nesting is needed later, it can be added with depth limits.

### AD-130-004: Graceful Degradation on Invalid Agent Config

**Decision:** If a SKILL.md declares `mode: "agent"` but has invalid/missing `tools`, the skill silently falls back to `mode: "prompt"`. Invalid tool names in the `tools` array are silently skipped.

**Rationale:** A misconfigured skill should not break the system. Falling back to prompt mode is safe and gives the skill author a working (if suboptimal) experience. Error messages to the user would be noisy (skills are loaded at startup).

---

## Component / Module Breakdown

### Component: `SkillInfo` Type Extension

**Purpose:** Add agent-mode fields to the canonical skill metadata type.

**Interface (exact TypeScript):**
```typescript
// In src/session.ts, modify SkillInfo type:
export type SkillInfo = {
  name: string;
  path: string;
  description: string;
  isLoaded?: boolean;
  inclusion?: "auto" | "manual";
  mode?: "prompt" | "agent";           // NEW
  agentModel?: string;                 // NEW — model override (undefined → use cheap model)
  agentThinking?: "enabled" | "disabled";  // NEW — thinking mode (undefined → disabled)
  agentTools?: string[];               // NEW — tool names for the subagent
  agentMaxTurns?: number;              // NEW — max loop iterations (undefined → 15)
  agentTimeoutMs?: number;             // NEW — total timeout ms (undefined → 120000)
};
```

**Dependencies:** None (pure type).

---

### Component: `readSkillInfo()` Extension for `mode`

**Purpose:** Parse and validate the `mode` field and agent-specific fields from SKILL.md YAML frontmatter.

**Interface:** Existing private method `readSkillInfo(skillPath: string, displayPath: string, fallbackName: string): SkillInfo`.

**Internal Logic (add after existing `inclusion` parsing, around line 729):**
```typescript
// After: inclusion = rawInclusion === "auto" || rawInclusion === "manual" ? rawInclusion : undefined;

// Parse mode
const rawMode = typeof parsed.data.mode === "string" ? parsed.data.mode.trim() : "";
let mode: "prompt" | "agent" | undefined;
if (rawMode === "prompt" || rawMode === "agent") {
  mode = rawMode;
}

// Parse agent fields (only if mode === "agent")
let agentModel: string | undefined;
let agentThinking: "enabled" | "disabled" | undefined;
let agentTools: string[] | undefined;
let agentMaxTurns: number | undefined;
let agentTimeoutMs: number | undefined;

if (mode === "agent") {
  // tools: required — if missing/invalid, fall back to prompt mode
  const rawTools = parsed.data.tools;
  if (Array.isArray(rawTools) && rawTools.length > 0 && rawTools.every((t: unknown) => typeof t === "string")) {
    agentTools = rawTools as string[];
  } else {
    mode = undefined; // fallback to prompt mode
  }

  if (mode === "agent") {
    // model: optional string
    if (typeof parsed.data.model === "string" && parsed.data.model.trim()) {
      agentModel = parsed.data.model.trim();
    }
    // thinking: optional "enabled" | "disabled"
    const rawThinking = typeof parsed.data.thinking === "string" ? parsed.data.thinking.trim() : "";
    if (rawThinking === "enabled" || rawThinking === "disabled") {
      agentThinking = rawThinking;
    }
    // maxTurns: optional positive integer
    const rawMaxTurns = Number(parsed.data.maxTurns);
    if (Number.isFinite(rawMaxTurns) && rawMaxTurns > 0 && Number.isInteger(rawMaxTurns)) {
      agentMaxTurns = rawMaxTurns;
    }
    // timeout: optional positive integer (milliseconds)
    const rawTimeout = Number(parsed.data.timeout);
    if (Number.isFinite(rawTimeout) && rawTimeout > 0 && Number.isInteger(rawTimeout)) {
      agentTimeoutMs = rawTimeout;
    }
  }
}

// Add to returned object:
return {
  name: ...,
  path: displayPath,
  description: ...,
  inclusion,
  mode,                    // NEW
  agentModel,              // NEW
  agentThinking,           // NEW
  agentTools,              // NEW
  agentMaxTurns,           // NEW
  agentTimeoutMs,          // NEW
};
```

**Validation rules:**
- `mode`: exact case-sensitive match `"prompt"` or `"agent"`. Any other value → `undefined`.
- `tools`: must be an array of strings with at least one element. If invalid → mode falls back to `undefined` (prompt).
- `model`: any non-empty string accepted (no catalog validation — API call will fail if invalid).
- `thinking`: exact `"enabled"` or `"disabled"`.
- `maxTurns`: must be finite, positive integer. Non-integer floats are rejected (e.g., `3.5` → defaults to 15).
- `timeout`: must be finite, positive integer (milliseconds).

**Dependencies:** `matter` from `gray-matter` (already imported).

---

### Component: `getBuiltInToolDefinitions()`

**Purpose:** Return the static array of built-in tool definitions. This array includes ALL built-in tools (including Explore — since the main LLM needs it). Agent skill tools are NOT included (those are added dynamically by `getTools()`). Subagent code (`runSkillSubagent()`) explicitly filters out Explore and agent skill tools from the tool list sent to subagent LLMs to prevent recursion.

**Interface:**
```typescript
// In src/prompt.ts
export function getBuiltInToolDefinitions(): ToolDefinition[]
```

**Internal Logic:**
```typescript
export function getBuiltInToolDefinitions(): ToolDefinition[] {
  // Return the static array of all 11 built-in tool definitions (including Explore).
  // Subagent code filters Explore out when building tool lists for subagent LLMs.
  return BUILTIN_TOOL_DEFINITIONS; // extracted as a module-level const
}
```

**Refactoring note:** The existing `getTools()` function body is refactored to call `getBuiltInToolDefinitions()` and then append agent skill tools. The existing static array inside `getTools()` is extracted to a module-level `const BUILTIN_TOOL_DEFINITIONS`.

**Dependencies:** None (pure static data).

---

### Component: `getTools()` Extension for Agent Skills

**Purpose:** Append tool definitions for agent-mode skills to the tools array returned to the LLM.

**Interface (modified):**
```typescript
// In src/prompt.ts, modify signature:
export function getTools(
  _options: PromptToolOptions = {},
  externalTools: ToolDefinition[] = [],
  skills: SkillInfo[] = [],  // NEW parameter
): ToolDefinition[]
```

**Internal Logic (add after existing tool definitions array construction):**
```typescript
// After building the base tools array (built-in + external):
const tools: ToolDefinition[] = [
  ...getBuiltInToolDefinitions(),
  ...externalTools,
];

// NEW: Add agent skill tool definitions
if (skills.length > 0) {
  const builtInToolNames = new Set(tools.map((t) => {
    return typeof t.function === "object" && "name" in t.function ? t.function.name : "";
  }));

  const agentSkills = skills
    .filter((s) => s.mode === "agent")
    .filter((s) => !builtInToolNames.has(s.name)) // skip name conflicts
    .sort((a, b) => a.name.localeCompare(b.name)); // stable alphabetical order

  for (const skill of agentSkills) {
    tools.push({
      type: "function" as const,
      function: {
        name: skill.name,
        description: `${skill.description}\n\nThis is an agent skill that runs as an isolated subagent with its own tools and context. Only the result is returned to the main conversation.`,
        parameters: {
          type: "object" as const,
          properties: {
            prompt: {
              type: "string" as const,
              description: "The task for this agent to perform. Be specific about what you need done.",
            },
          },
          required: ["prompt"],
          additionalProperties: false,
        },
      },
    });
  }

  // Log warnings for skipped skills (name conflicts)
  const skipped = skills.filter((s) => s.mode === "agent" && builtInToolNames.has(s.name));
  for (const s of skipped) {
    console.error(`[WARN] Agent skill "${s.name}" conflicts with built-in tool name — not registered as tool.`);
  }
}

return tools;
```

**Name conflict detection:** Uses a `Set` of built-in tool names from the already-built tools array. Any agent skill whose name matches a built-in tool name is skipped.

**Dependencies:** `SkillInfo` type from `src/session.ts`.

---

### Component: `SubagentOptions` Type

**Purpose:** Input type for the generalized subagent runner.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts
export type SubagentOptions = {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
  toolHandlers: Record<string, ToolHandler>;
  projectRoot: string;
  client: OpenAI;
  model: string;
  sessionId: string;
  thinking: { type: "enabled" | "disabled" };
  temperature: number;
  maxTurns: number;
  maxTokens: number;
  overallTimeoutMs: number;
};
```

**Dependencies:** `ToolDefinition` from `./executor`, `ToolHandler` from `./executor`, `OpenAI` from `openai`.

---

### Component: `runSubagent()`

**Purpose:** Generalized multi-turn subagent execution loop. Used by both `runExploreSubagent()` and `runSkillSubagent()`.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts
export async function runSubagent(opts: SubagentOptions): Promise<string>
```

**Internal Logic (step-by-step):**

```
1. VALIDATE inputs:
   - systemPrompt.trim() !== ""
   - userPrompt.trim() !== ""
   - client is not null
   - tools is array (can be empty — but subagent won't be able to do tool work)
   - maxTurns > 0
   - overallTimeoutMs > 0

2. INITIALIZE messages array:
   const messages: Array<{ role: string; content: string; tool_calls?: unknown; tool_call_id?: string }> = [
     { role: "system", content: systemPrompt },
     { role: "user", content: userPrompt },
   ];

3. INITIALIZE tool call counters (dynamic — keyed by tool name):
   const toolCounts: Record<string, number> = {};

4. TRACK overall elapsed time:
   const overallStart = Date.now();

5. LOOP for turn = 0 to maxTurns - 1:
   a. remainingTimeoutMs = overallTimeoutMs - (Date.now() - overallStart)
      If <= 0 → return `Subagent error: Timed out after ${Math.round(overallTimeoutMs / 1000)} seconds.`
   
   b. perCallSignal = AbortSignal.timeout(Math.min(15000, remainingTimeoutMs))
   
   c. response = await client.chat.completions.create(
        {
          model,
          messages: messages as any,
          tools: tools as any,
          thinking,
          temperature,
          max_tokens: maxTokens,
        } as any,
        { signal: perCallSignal } as any
      )
   
   d. If response.usage → recordBudgetCost(projectRoot, model, response.usage as ModelUsage)
   
   e. choice = response.choices?.[0]
      message = choice?.message
      If !message → return "Subagent error: No response from model."
   
   f. hasToolCalls = message.tool_calls && message.tool_calls.length > 0
      hasContent = typeof message.content === "string" && message.content.trim().length > 0
   
   g. If hasToolCalls:
      - messages.push(message as any)
      - For each tc in message.tool_calls:
        - tcAny = tc as any
        - tcFunc = tcAny.function ?? {}
        - handler = toolHandlers[tcFunc.name]
        - If handler:
          - result = await handler(JSON.parse(tcFunc.arguments ?? "{}"), { sessionId, projectRoot, toolCall: { id: tcAny.id, type: "function", function: { name: tcFunc.name, arguments: tcFunc.arguments ?? "{}" } } })
          - toolCounts[tcFunc.name] = (toolCounts[tcFunc.name] ?? 0) + 1
        - Else:
          - result = { ok: false, name: tcFunc.name, error: `Unknown tool: ${tcFunc.name}` }
        - messages.push({ role: "tool", tool_call_id: tcAny.id, content: JSON.stringify(result) })
      - continue
   
   h. If hasContent && finish_reason !== "tool_calls":
      - messages.push(message as any)
      - return message.content as string
   
   i. If finish_reason === "length":
      - messages.push(message as any)
      - If hasContent → return message.content as string
      - Else → continue
   
   j. Neither content nor tool_calls:
      - messages.push(message as any)
      - continue

6. MAX TURNS REACHED:
   - Find last assistant message with non-empty content (reverse search)
   - If found → return that content
   - If not found and any toolCounts[tool] > 0:
     - toolsWithCounts = Object.entries(toolCounts).filter(([, count]) => count > 0)
     - return "Task completed. Tools called: " + JSON.stringify(toolsWithCounts.map(([tool, count]) => ({ tool, count })))
   - If not found and no tools called → return "Subagent error: No results produced."

7. ERROR HANDLING:
   - All errors caught → return `Subagent error: ${message}`
   - AbortError (timeout) → return "Subagent error: API call timed out."
```

**Dependencies:**
- `openai` (for `OpenAI` type)
- `../common/budget-tracker` (`recordBudgetCost`)
- `./executor` (`ToolDefinition`, `ToolHandler`, `ToolCall`, `ToolExecutionResult`)
- `../session` (`ModelUsage`)

**Error Handling:**
- API errors → caught, returned as `"Subagent error: ..."`
- Timeout (AbortError) → caught, returned as `"Subagent error: API call timed out."`
- Tool execution errors → tool result reflects error, loop continues
- Invalid arguments → caught at top, returned as `"Subagent error: ..."`

---

### Component: `runExploreSubagent()` Refactored

**Purpose:** Thin wrapper around `runSubagent()` with Explore-specific configuration. Public API unchanged.

**Interface (unchanged):**
```typescript
export async function runExploreSubagent(opts: ExploreSubagentOptions): Promise<string>
```

**Internal Logic (refactored — EXACT same behavior as before):**
```typescript
export async function runExploreSubagent(opts: ExploreSubagentOptions): Promise<string> {
  if (!opts.query.trim()) {
    return "Explore error: Missing required 'query' string.";
  }
  const thoroughness = THOROUGHNESS_CONFIGS[opts.thoroughness] ? opts.thoroughness : "medium";
  const config = THOROUGHNESS_CONFIGS[thoroughness];

  const systemPrompt = EXPLORE_SYSTEM_PROMPT + config.systemPromptSuffix;

  return runSubagent({
    systemPrompt,
    userPrompt: `Explore the codebase: ${opts.query}`,
    tools: READONLY_TOOL_DEFINITIONS,
    toolHandlers: READONLY_TOOL_HANDLERS,
    projectRoot: opts.projectRoot,
    client: opts.client,
    model: opts.model,
    sessionId: opts.sessionId,
    thinking: { type: "disabled" },
    temperature: 0.1,
    maxTurns: config.maxTurns,
    maxTokens: config.maxTokens,
    overallTimeoutMs: config.overallTimeoutMs,
  });
}
```

**Behavioral equivalence:** Error messages still start with `"Explore error:"` (the prefix check in `handleExploreToolCall()` looks for this). The `"Subagent error:"` prefix from `runSubagent()` is NOT reached because all Explore-specific validation happens before calling `runSubagent()`.

**Dependencies:** `runSubagent()`, `THOROUGHNESS_CONFIGS`, `EXPLORE_SYSTEM_PROMPT`, `READONLY_TOOL_DEFINITIONS`, `READONLY_TOOL_HANDLERS`.

---

### Component: `SKILL_TOOL_HANDLER_MAP`

**Purpose:** Maps tool names to handler functions for agent skill subagents.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts
const SKILL_TOOL_HANDLER_MAP: Record<string, ToolHandler> = {
  read: handleReadTool,
  grep: handleGrepTool,
  glob: handleGlobTool,
  write: handleWriteTool,
  edit: handleEditTool,
  bash: handleBashTool,
  web_search: handleWebSearchTool,
  web_fetch: handleWebFetchTool,
};
```

**New imports required:**
```typescript
import { handleWriteTool } from "./write-handler";
import { handleEditTool } from "./edit-handler";
import { handleBashTool } from "./bash-handler";
import { handleWebSearchTool } from "./web-search-handler";
import { handleWebFetchTool } from "./web-fetch-handler";
```

**Dependencies:** All existing tool handler modules.

---

### Component: `SkillSubagentOptions` Type

**Purpose:** Input type for `runSkillSubagent()`.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts
export type SkillSubagentOptions = {
  skill: SkillInfo;                  // The full skill metadata (name, description, tools, model, etc.)
  prompt: string;                    // User's task for the subagent
  projectRoot: string;               // Project root
  createOpenAIClient: CreateOpenAIClient;  // Factory for LLM client
};
```

**Dependencies:** `OpenAI` from `openai`.

---

### Component: `runSkillSubagent()`

**Purpose:** Execute an agent skill as an isolated subagent. Thin wrapper around `runSubagent()`.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts
export async function runSkillSubagent(opts: SkillSubagentOptions): Promise<string>
```

**Internal Logic:**
```typescript
export async function runSkillSubagent(opts: SkillSubagentOptions): Promise<string> {
  const skill = opts.skill;

  // 1. Build system prompt from skill metadata
  const systemPrompt = buildSkillSystemPrompt(skill);

  // 2. Get LLM client from factory
  const llmContext = opts.createOpenAIClient();
  if (!llmContext?.client) {
    return `Agent error: LLM client is not available. Check your API key configuration.`;
  }

  // 3. Resolve model
  let model: string;
  if (skill.agentModel && skill.agentModel.trim()) {
    model = skill.agentModel.trim();
  } else {
    model = getCheapModel(llmContext.model) ?? llmContext.model;
  }

  // 4. Resolve thinking
  const thinking = skill.agentThinking === "enabled"
    ? { type: "enabled" as const }
    : { type: "disabled" as const };

  // 5. Resolve tool definitions
  const allBuiltInTools = getBuiltInToolDefinitions();
  const builtInToolNames = new Set(allBuiltInTools.map((t) =>
    typeof t.function === "object" && "name" in t.function ? t.function.name : ""
  ));

  let whitelist: Set<string> | undefined;
  if (skill.agentTools && skill.agentTools.length > 0) {
    const invalid = skill.agentTools.filter((t) => !SKILL_TOOL_HANDLER_MAP[t]);
    if (invalid.length > 0) {
      console.error(`[WARN] Agent skill "${skill.name}" has invalid tools: ${invalid.join(", ")} — not available. Skill degraded to all 8 handler tools.`);
    } else {
      whitelist = new Set(skill.agentTools);
    }
  }

  let toolDefs: ToolDefinition[];
  let toolHandlers: Record<string, ToolHandler>;

  if (!whitelist) {
    // No whitelist: use all built-in tools except Explore
    toolDefs = allBuiltInTools.filter((t) => {
      const name = typeof t.function === "object" && "name" in t.function ? t.function.name : "";
      return name !== "Explore";
    });
    toolHandlers = { ...SKILL_TOOL_HANDLER_MAP };
  } else {
    // Whitelisted: only those tools
    toolDefs = allBuiltInTools.filter((t) => {
      const name = typeof t.function === "object" && "name" in t.function ? t.function.name : "";
      return whitelist!.has(name);
    });
    toolHandlers = {};
    for (const name of whitelist) {
      if (SKILL_TOOL_HANDLER_MAP[name]) {
        toolHandlers[name] = SKILL_TOOL_HANDLER_MAP[name];
      }
    }
  }

  // 6. Run subagent
  const maxTurns = skill.agentMaxTurns ?? 50;
  const timeoutMs = skill.agentTimeoutMs ?? 300000;
  const subagentSessionId = `skill-${crypto.randomUUID()}`;

  return runSubagent({
    systemPrompt,
    userPrompt: opts.prompt || skill.description,
    tools: toolDefs,
    toolHandlers,
    projectRoot: opts.projectRoot,
    client: llmContext.client,
    model,
    sessionId: subagentSessionId,
    thinking,
    temperature: 0.1,
    maxTurns,
    maxTokens: 4096,
    overallTimeoutMs: timeoutMs,
  });
}
```

**Tool resolution:** Only tools that exist in BOTH `getBuiltInToolDefinitions()` (definition exists) AND `SKILL_TOOL_HANDLER_MAP` (handler exists) are available. The Explore tool is explicitly excluded. Unknown tool names are skipped with a stderr warning.

**Error prefix:** Errors from `runSkillSubagent()` start with `"Agent error:"` — distinct from `runSubagent()` errors (`"Subagent error:"`) and Explore errors (`"Explore error:"`). This allows `handleSkillToolCall()` to detect errors by prefix.

**Dependencies:** `runSubagent()`, `getBuiltInToolDefinitions()`, `SKILL_TOOL_HANDLER_MAP`, `ToolDefinition` from `./executor`.

---

### Component: `handleSkillToolCall()`

**Purpose:** Entry point called by the session loop when the main LLM invokes an agent skill tool.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts
export async function handleSkillToolCall(
  toolCall: ToolCall,
  createOpenAIClient: CreateOpenAIClient,
  skill: SkillInfo,
  projectRoot: string,
): Promise<ToolExecutionResult>
```

**Internal Logic:**
```typescript
export async function handleSkillToolCall(
  toolCall: ToolCall,
  createOpenAIClient: CreateOpenAIClient,
  skill: SkillInfo,
  projectRoot: string,
): Promise<ToolExecutionResult> {
  // 1. Parse arguments
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return { ok: false, name: skill.name, error: "Failed to parse skill agent arguments." };
  }

  // 2. Extract and validate prompt
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  if (!prompt.trim()) {
    return { ok: false, name: skill.name, error: "Missing required 'prompt' string." };
  }

  // 3. Run skill subagent (model, thinking, tools all resolved inside runSkillSubagent)
  const result = await runSkillSubagent({
    skill,
    prompt,
    projectRoot,
    createOpenAIClient,
  });

  // 4. Return result
  if (result.startsWith("Explore error:") || result.startsWith("Agent error:") || result.startsWith("Subagent error:")) {
    return { ok: false, name: skill.name, error: result };
  }

  return { ok: true, name: skill.name, output: result };
}
```

**Dependencies:**
- `./executor` (`ToolCall`, `ToolExecutionResult`, `CreateOpenAIClient`)
- `runSkillSubagent()`
- `SkillInfo` type from `../session`

**Error Handling:** All errors return `{ ok: false, name: skill.name, error: message }`. The skill name in the error result matches the tool name so the main LLM can associate the error with the correct tool.

---

### Component: Agent Skill Interception in `appendToolMessages()`

**Purpose:** Extend the Explore interception in `session.ts` to also intercept agent skill tool calls.

**Interface:** Modification to `appendToolMessages()` in `src/session.ts`.

**Internal Logic (add after the Explore interception block, around line 2735):**

```typescript
// Existing Explore interception (lines 2722-2736 in current code):
// Intercept Explore tool calls and route to the subagent handler
if (toolCall.function.name === "Explore") {
  const exploreResult = await handleExploreToolCall(
    toolCall as ToolCall,
    this.createOpenAIClient,
    this.projectRoot
  );
  const content = this.formatSubagentToolResult(exploreResult);
  toolExecutions.push({
    toolCallId: toolCall.id,
    content,
    result: exploreResult,
  });
  continue;
}

// NEW: Intercept agent skill tool calls
const agentSkill = this.skillsCache.find(
  (s) => s.mode === "agent" && s.name === toolCall.function.name
);
if (agentSkill) {
  const skillResult = await handleSkillToolCall(
    toolCall as ToolCall,
    this.createOpenAIClient,
    agentSkill,
    this.projectRoot
  );
  const content = this.formatSubagentToolResult(skillResult);
  toolExecutions.push({
    toolCallId: toolCall.id,
    content,
    result: skillResult,
  });
  continue;
}
```

**`skillsCache` field:** A `SkillInfo[]` array populated whenever skills are listed (in `createSession()` and `replySession()`). Agent skills are found by filtering for `mode === "agent"` and matching by name.

```typescript
// In SessionManager class:
private skillsCache: SkillInfo[] = [];
```

**Dependencies:**
- `handleSkillToolCall` from `../tools/explore-subagent`
- `SkillInfo` type
- `formatSubagentToolResult()` (existing method)

---

### Component: Agent Skills Excluded from Keyword Matching

**Purpose:** Agent skills should not be injected as system messages — they are only available as tools.

**Interface:** Modification to `matchSkillsByKeywords()` and `normalizeSkills()` in `src/session.ts`.

**Internal Logic:**

```typescript
// In matchSkillsByKeywords(), add guard before keyword matching:
for (const skill of skills) {
  if (skill.isLoaded) continue;
  if (skill.inclusion === "manual") continue;
  if (skill.mode === "agent") continue;  // NEW — agent skills are tools, not prompts
  // ... rest of matching logic
}

// In normalizeSkills() (or wherever skills are loaded), skip agent skills:
// After deduplication, filter out agent-mode skills:
const promptSkills = dedupedSkills.filter((s) => s.mode !== "agent");
// Only build prompt messages for promptSkills
```

**`#skill-name` activation for agent skills:** When the user types `#skill-name` for an agent skill, the PromptInput detection (Spec 110) fires and adds the skill to `selectedSkills`. In `normalizeSkills()`, agent skills in `selectedSkills` are detected by filtering `dedupedSkills` for `mode === "agent"`. For each agent skill: instead of calling `buildSkillPrompt()` (which would inject the full skill body), build a lightweight system hint message with content exactly: `"The user has explicitly requested the use of the '${skill.name}' agent skill. Use the '${skill.name}' tool to delegate work to it."`. Use `this.buildSkillMessage(sessionId, hintContent, skill)` — the same method but with hint content instead of full skill prompt. The full skill body is NOT injected. Only this hint message plus the tool availability (from FR-002) enable the LLM to use the agent skill.

---

## Data Flow

### Flow 1: Agent Skill Registration

```
SessionManager starts / user creates session
  │
  ▼
listSkills() → reads SKILL.md files from .dscode/skills/, .agents/skills/, etc.
  │
  ▼
readSkillInfo() for each SKILL.md:
  - Parses YAML frontmatter
  - Extracts mode, tools, model, thinking, maxTurns, timeout
  - Returns SkillInfo with agent fields
  │
  ▼
skillsCache populated (in createSession/replySession after listSkills())
  │
  ▼
getTools(skills: skillsList) in prompt.ts:
  - Calls getBuiltInToolDefinitions()
  - Appends external tools
  - Filters skills with mode === "agent"
  - Skips name conflicts with built-in tools
  - Generates tool definitions for each agent skill
  - Returns complete tools array
  │
  ▼
Tools sent to LLM include agent skill tools
```

### Flow 2: LLM Invokes Agent Skill

```
User: "Deploy this to staging"
  │
  ▼
Main LLM receives tools list including agent skill "deploy"
  │  Decides to call: tool_calls: [{ name: "deploy", arguments: { prompt: "Deploy to staging environment" } }]
  ▼
Session loop (appendToolMessages):
  1. Permission check (agent skills always allowed — no file mutation permission needed at this level)
  2. Interception: toolCall.function.name === "deploy" → found in skillsCache
  3. Routes to handleSkillToolCall(toolCall, createOpenAIClient, skill, projectRoot)
  │
  ▼
handleSkillToolCall():
  1. Parses prompt from arguments
  2. Validates prompt is non-empty
  3. Calls runSkillSubagent({ skill, prompt, projectRoot, createOpenAIClient })
  │
  ▼
runSkillSubagent():
  1. Builds system prompt from skill metadata via buildSkillSystemPrompt()
  2. Resolves model, thinking, tools, handlers from skill config
  3. Calls runSubagent({...})
  │
  ▼
runSubagent() — isolated context:
  │  ┌──────────────────────────────────────────┐
  │  │        ISOLATED CONTEXT                    │
  │  │                                            │
  │  │  System: [generated skill system prompt]   │
  │  │  User: "Deploy to staging environment"     │
  │  │    │                                       │
  │  │    ▼                                       │
  │  │  LLM call (skill model, thinking config)   │
  │  │    │ tool_calls: [Bash("git push...")]     │
  │  │    ▼                                       │
  │  │  Execute Bash → result                     │
  │  │    │                                       │
  │  │    ▼                                       │
  │  │  LLM call (with Bash result)               │
  │  │    │ content: "Deployed successfully..."    │
  │  │    ▼                                       │
  │  │  RETURN result string                      │
  │  └──────────────────────────────────────────┘
  │
  ▼
handleSkillToolCall() returns { ok: true, name: "deploy", output: "Deployed successfully..." }
  │
  ▼
Session formats tool result, appends to messages:
  toolExecutions.push({ toolCallId, content: JSON.stringify({ ok: true, name: "deploy", output: "..." }), result })
  │
  ▼
Main LLM receives tool result, responds to user:
  "The deployment to staging completed successfully."
```

### Flow 3: Agent Skill with Other Tools in Same Batch

```
Main LLM calls: [deploy, Grep, Read]
  │
  ▼
Session Interception (appendToolMessages):
  For each toolCall in parsedToolCalls:
    1. Permission check
    2. if name === "Explore" → handleExploreToolCall()
    3. if name in skillsCache (agent mode) → handleSkillToolCall()
    4. else → toolExecutor.executeToolCalls()
  │
  ▼
All results combined, formatted, appended to messages
```

---

## Data Structures

### Modified Type: `SkillInfo`

```typescript
export type SkillInfo = {
  name: string;
  path: string;
  description: string;
  isLoaded?: boolean;
  inclusion?: "auto" | "manual";
  mode?: "prompt" | "agent";           // NEW
  agentModel?: string;                 // NEW
  agentThinking?: "enabled" | "disabled";  // NEW
  agentTools?: string[];               // NEW
  agentMaxTurns?: number;              // NEW
  agentTimeoutMs?: number;             // NEW
};
```

### New Type: `SubagentOptions`

```typescript
export type SubagentOptions = {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
  toolHandlers: Record<string, ToolHandler>;
  projectRoot: string;
  client: OpenAI;
  model: string;
  sessionId: string;
  thinking: { type: "enabled" | "disabled" };
  temperature: number;
  maxTurns: number;
  maxTokens: number;
  overallTimeoutMs: number;
};
```

### New Type: `SkillSubagentOptions`

```typescript
export type SkillSubagentOptions = {
  skill: SkillInfo;                  // The full skill metadata (name, description, tools, model, etc.)
  prompt: string;                    // User's task for the subagent
  projectRoot: string;               // Project root
  createOpenAIClient: CreateOpenAIClient;  // Factory for LLM client
};
```

### SKILL.md Frontmatter for Agent Mode (Example)

```yaml
---
name: deploy
description: Deploy the application to staging or production environments.
mode: agent
tools: [bash, read, grep]
model: deepseek-v4-flash
thinking: disabled
maxTurns: 20
timeout: 180000
inclusion: auto
---
# Deploy Agent

You are a deployment specialist. When asked to deploy:
1. First check the current git status...
2. Run the appropriate build command...
...
```

---

## File / Module Layout

### Modified Files

| File | Changes | Lines Changed |
|------|---------|---------------|
| `src/tools/explore-subagent.ts` | Extract `runSubagent()`, refactor `runExploreSubagent()`, add `SubagentOptions`, `SkillSubagentOptions`, `runSkillSubagent()`, `SKILL_TOOL_HANDLER_MAP`, `handleSkillToolCall()`, add imports for write/edit/bash/web-search/web-fetch handlers | ~250 lines changed/added |
| `src/session.ts` | Extend `SkillInfo` type (+6 fields: mode, agentModel, agentThinking, agentTools, agentMaxTurns, agentTimeoutMs), extend `readSkillInfo()` (+30 lines for mode/agent parsing), add guard in `matchSkillsByKeywords()` (+1 line), filter agent skills in `normalizeSkills()`, add `agentSkillsByName` map, add agent skill interception in `appendToolMessages()`, import `handleSkillToolCall` | ~60 lines added |
| `src/prompt.ts` | Extract `BUILTIN_TOOL_DEFINITIONS` const, add `getBuiltInToolDefinitions()`, modify `getTools()` to accept `skills` parameter and append agent skill tools | ~50 lines added/changed |

**Total: ~360 lines across 3 files. Zero new files.**

### Unmodified Files

- `src/tools/read-handler.ts`, `grep-handler.ts`, `glob-handler.ts`, `write-handler.ts`, `edit-handler.ts`, `bash-handler.ts`, `web-search-handler.ts`, `web-fetch-handler.ts` — NO CHANGE
- `src/tools/executor.ts` — NO CHANGE
- `src/common/model-catalog.ts` — NO CHANGE
- `src/common/budget-tracker.ts` — NO CHANGE
- `src/ui/views/PromptInput.tsx` — NO CHANGE (Spec 110 already handles `#skill-name`)
- `src/tests/explore-subagent.test.ts` — NO CHANGE (existing 15 tests must pass unchanged)

---

## Testing Strategy

### Unit Tests: `mode` Field Parsing (in `session.test.ts` or new test file)

| # | Test | Verifies |
|---|------|----------|
| 1 | `readSkillInfo()` parses `mode: "prompt"` → `SkillInfo.mode = "prompt"` | FR-001 |
| 2 | `readSkillInfo()` parses `mode: "agent"` with valid `tools` → `SkillInfo.mode = "agent"`, `agentTools = ["read", "grep"]` | FR-001 |
| 3 | `readSkillInfo()` with no `mode` field → `SkillInfo.mode = undefined` | FR-001 |
| 4 | `readSkillInfo()` with `mode: "Agent"` (wrong case) → `SkillInfo.mode = undefined` | FR-001 |
| 5 | `readSkillInfo()` with `mode: "agent"` but no `tools` → `SkillInfo.mode = undefined` (fallback to prompt) | FR-001 |
| 6 | `readSkillInfo()` with `mode: "agent"` and `tools: []` → `SkillInfo.mode = undefined` | FR-001 |
| 7 | `readSkillInfo()` with `mode: "agent"` and `tools: "read"` (not array) → `SkillInfo.mode = undefined` | FR-001 |
| 8 | `readSkillInfo()` with `mode: "agent"`, valid `tools`, `model: "custom-model"` → `agentModel = "custom-model"` | FR-001 |
| 9 | `readSkillInfo()` with `mode: "agent"`, valid `tools`, `thinking: "enabled"` → `agentThinking = "enabled"` | FR-001 |
| 10 | `readSkillInfo()` with `mode: "agent"`, valid `tools`, `thinking: "disabled"` → `agentThinking = "disabled"` | FR-001 |
| 11 | `readSkillInfo()` with `mode: "agent"`, valid `tools`, `maxTurns: 20` → `agentMaxTurns = 20` | FR-001 |
| 12 | `readSkillInfo()` with `mode: "agent"`, valid `tools`, `timeout: 180000` → `agentTimeoutMs = 180000` | FR-001 |
| 13 | `readSkillInfo()` with `mode: "agent"`, valid `tools`, `maxTurns: 3.5` (float) → `agentMaxTurns = undefined` (defaults to 15) | FR-001 |
| 14 | `readSkillInfo()` with `mode: "agent"`, valid `tools`, `maxTurns: 0` → `agentMaxTurns = undefined` | FR-001 |
| 15 | `readSkillInfo()` with `mode: "agent"`, valid `tools`, `timeout: -100` → `agentTimeoutMs = undefined` | FR-001 |

### Unit Tests: `getTools()` Agent Skill Generation (in `prompt.test.ts`)

| # | Test | Verifies |
|---|------|----------|
| 16 | `getTools()` with empty skills → returns only built-in tools | FR-002 |
| 17 | `getTools()` with one agent skill → includes agent skill tool definition | FR-002 |
| 18 | `getTools()` with multiple agent skills → includes all, sorted alphabetically | FR-002 |
| 19 | `getTools()` with agent skill whose name conflicts with "Read" → skill is skipped | FR-002 |
| 20 | Agent skill tool definition has correct structure: `type`, `function.name`, `function.description`, `function.parameters` with `prompt` | FR-002 |
| 21 | `getBuiltInToolDefinitions()` does NOT include agent skill tools | FR-005 |
| 22 | `getBuiltInToolDefinitions()` returns exactly 11 built-in tools including Explore | FR-005 |

### Unit Tests: `runSubagent()` (in `explore-subagent.test.ts`)

| # | Test | Verifies |
|---|------|----------|
| 23 | `runSubagent()` with mock returning direct content → returns content | FR-003 |
| 24 | `runSubagent()` with mock returning tool calls → executes tools and continues | FR-003 |
| 25 | `runSubagent()` respects `maxTurns` → stops after N turns | FR-003 |
| 26 | `runSubagent()` returns fallback when max turns reached with no content | FR-003 |
| 27 | `runSubagent()` records budget for each API call | FR-009 |
| 28 | `runSubagent()` returns error on API failure | FR-003 |
| 29 | `runSubagent()` returns error on timeout | FR-003 |
| 30 | `runSubagent()` uses configured `thinking` and `temperature` | FR-003 |

### Unit Tests: `runSkillSubagent()` (in `explore-subagent.test.ts`)

| # | Test | Verifies |
|---|------|----------|
| 31 | `runSkillSubagent()` returns error for empty prompt | FR-004 |
| 32 | `runSkillSubagent()` returns error for empty skill body | FR-004 |
| 33 | `runSkillSubagent()` returns error for no valid tools | FR-004 |
| 34 | `runSkillSubagent()` uses agent model when specified | FR-011 |
| 35 | `runSkillSubagent()` falls back to cheap model when agent model missing | FR-011 |
| 36 | `runSkillSubagent()` uses thinking: enabled when configured | FR-011 |
| 37 | `runSkillSubagent()` uses thinking: disabled by default | FR-011 |
| 38 | `runSkillSubagent()` only resolves tools that exist in built-in definitions | FR-006 |
| 39 | `runSkillSubagent()` excludes Explore from subagent tools | FR-006 |

### Unit Tests: `handleSkillToolCall()` (in `explore-subagent.test.ts`)

| # | Test | Verifies |
|---|------|----------|
| 40 | Returns error for missing prompt | FR-007 |
| 41 | Returns error for empty prompt | FR-007 |
| 42 | Returns error when LLM client is null | FR-007 |
| 43 | Returns error for malformed JSON arguments | FR-007 |
| 44 | Returns error when skill file not found | FR-007 |
| 45 | Returns ok with output on success | FR-007 |

### Integration Tests

| # | Test | Verifies |
|---|------|----------|
| 46 | Existing Explore tests (15) pass unchanged | FR-012, C7 |
| 47 | Full test suite passes with zero regressions | FR-012 |

### Manual Smoke Test

1. Create a test agent skill: `.dscode/skills/test-agent/SKILL.md` with `mode: agent`, `tools: [read, grep]`.
2. Start DsCode, verify the skill appears in `/skills` dropdown.
3. Type a prompt like "Find where the session manager is defined" — verify the LLM may call the `test-agent` tool (depends on LLM behavior — not guaranteed, but the tool should be available).
4. Type `#test-agent Find where SessionManager is defined` — verify the agent skill is triggered.
5. Check `management/budget.md` — verify costs are recorded for the agent skill's model.

---

## Migration / Rollback

**Migration:** Zero migration. All existing SKILL.md files without `mode` continue working unchanged. Agent skills only activate when `mode: agent` is explicitly declared.

**Rollback:** Remove the agent skill interception block from `appendToolMessages()`, remove the `skills` parameter from `getTools()`, delete the new exports from `explore-subagent.ts`. Existing skills with `mode: agent` in their frontmatter would be ignored (treated as `mode: "prompt"`), and the existing Explore subagent continues working.
