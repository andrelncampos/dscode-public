# Spec 120: Explore Subagent — Design

## Design Approach

**Pattern:** The Explore subagent follows the `web-search-handler.ts` pattern: isolated context, multi-turn tool loop, cheap model, thinking disabled, budget tracking per API call. The key difference is that WebSearch uses a fixed 2-round protocol (send query → receive tool call → re-send with tool result), while Explore uses a dynamic N-round loop (LLM decides when to stop exploring).

**Architecture:** The Explore tool is intercepted at the session level (`session.ts`) before `ToolExecutor` processes tool calls. This is necessary because Explore requires spawning a sub-conversation, which needs access to `createOpenAIClient()` and the project root — things `ToolExecutor` doesn't expose to the subagent context.

**KISS:** One new file (`src/tools/explore-subagent.ts`), two small modifications to existing files (`src/prompt.ts` for tool definition, `src/session.ts` for interception). Zero new dependencies. Zero settings changes.

**DRY:** The subagent reuses existing tool handlers (`read-handler.ts`, `grep-handler.ts`, `glob-handler.ts`) without modification via direct function invocation (AD-120-002).

---

## Architecture Decisions

### AD-120-001: Session-Level Interception (not ToolExecutor registration)

**Decision:** The Explore tool call is intercepted in `session.ts` before it reaches `ToolExecutor.executeToolCalls()`. It is NOT registered as a regular tool handler in `ToolExecutor`.

**Rationale:** `ToolExecutor` tool handlers receive a `ToolExecutionContext` with limited context. The Explore subagent needs `createOpenAIClient()` (to get the OpenAI client and resolve the cheap model) and needs to spawn a sub-conversation with isolated tool execution. The session loop already has access to both.

**Alternatives considered:**
- **Register as ToolExecutor handler:** Would require passing `createOpenAIClient` through the handler (already available in `ToolExecutionContext`), but spawning a sub-conversation from within a handler creates circular dependency concerns and makes testing harder.
- **New abstraction layer:** Over-engineering. Session-level interception is 20 lines of code.

### AD-120-002: Direct Tool Handler Invocation (not ToolExecutor)

**Decision:** The explore subagent does NOT use `ToolExecutor`. It calls `handleReadTool`, `handleGrepTool`, and `handleGlobTool` directly via a local `READONLY_TOOL_HANDLERS` map.

**Rationale:** `ToolExecutor` is designed for the main session — it auto-registers all tools in its constructor with no public API to override handlers (P4: surgical changes). Direct invocation is simpler and clearer. The session's `ToolExecutor` has Write, Edit, Bash — sharing it would give the subagent write access.

**Implementation:** A `READONLY_TOOL_HANDLERS` map (`{ read: handleReadTool, grep: handleGrepTool, glob: handleGlobTool }`) and an `executeSubagentTool()` helper function (see Task 2) dispatch tool calls by name, parse JSON arguments, and invoke handlers with a `ToolExecutionContext` that omits `createOpenAIClient`.

### AD-120-003: No Streaming to Main Session

**Decision:** The subagent's LLM calls are non-streaming or streaming-consumed-to-completion internally. No intermediate subagent output is shown to the user.

**Rationale:** Streaming subagent progress to the user would clutter the UI and defeat the purpose of context isolation (the point is to HIDE the exploration, not show it). The subagent's internal loop aggregates all streaming chunks and returns only the final text.

### AD-120-004: Explore Tool Always Available

**Decision:** The Explore tool is unconditionally added to `getTools()`. No settings toggle, no feature flag.

**Rationale:** The Explore subagent is a built-in optimization, not a feature users need to opt into. It uses cheap models (low cost risk) and is read-only (low safety risk). Unconditional availability maximizes adoption by the LLM.

---

## Component / Module Breakdown

### Component: ExploreToolDefinition

**Purpose:** Defines the `Explore` tool in the tool definitions array so the main LLM can invoke it.

**Interface:**
```typescript
// In src/prompt.ts, inside getTools() return array:
{
  type: "function" as const,
  function: {
    name: "Explore",
    description: `Delegate codebase exploration to a read-only subagent that runs in an isolated context.
The subagent uses a cheap model (no thinking) to search and analyze the codebase.
Only the final summary is returned to the main conversation — exploration details stay isolated.

Use Explore when you need to:
- Find where a function, class, or feature is implemented
- Search for patterns across multiple files
- Understand how a module or subsystem works
- Map architecture or dependencies

Prefer Explore over multiple Read/Grep/Glob calls in the main conversation.
Do NOT use Explore for single-file lookups or when you already know the file path.`,
    parameters: {
      type: "object" as const,
      properties: {
        query: {
          type: "string" as const,
          description: "The exploration question or task description. Be specific about what to find.",
        },
        thoroughness: {
          type: "string" as const,
          enum: ["quick", "medium", "thorough"],
          description: "quick: simple lookup (where is X?). medium: balanced exploration (how does Y work?). thorough: comprehensive analysis (map the entire Z architecture).",
        },
      },
      required: ["query", "thoroughness"],
      additionalProperties: false,
    },
  },
}
```

**Internal Logic:** Static definition, no logic.

**Dependencies:** None.

**Error Handling:** N/A — static definition.

---

### Component: ExploreSubagentOptions

**Purpose:** Input type for the explore subagent runner.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts
export type ExploreSubagentOptions = {
  query: string;
  thoroughness: "quick" | "medium" | "thorough";
  projectRoot: string;
  client: OpenAI;                    // OpenAI client instance (not null — validated by caller)
  model: string;                     // Already resolved to cheap model by caller
  sessionId: string;                 // Unique ID for this subagent execution (generated by handleExploreToolCall)
};
```

**Internal Logic:** Type definition only.

**Dependencies:** `openai` (for `OpenAI` type).

---

### Component: runExploreSubagent

**Purpose:** The core subagent execution engine. Runs a multi-turn tool-use loop in isolated context.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts
export async function runExploreSubagent(opts: ExploreSubagentOptions): Promise<string>
```

**Internal Logic:**

```
1. VALIDATE inputs:
   - query.trim() !== ""
   - thoroughness in ["quick", "medium", "thorough"]
   - client is not null
   - sessionId is a non-empty string

2. RESOLVE configuration from thoroughness:
   - maxTurns: quick=5, medium=10, thorough=25
   - maxTokens: quick=2048, medium=4096, thorough=8192
   - overallTimeoutMs: quick=30000, medium=60000, thorough=120000

3. BUILD system prompt = EXPLORE_SYSTEM_PROMPT + thoroughness-specific suffix

4. BUILD tool definitions for subagent:
   const subagentTools = [ReadToolDef, GrepToolDef, GlobToolDef];
   // These are EXACT duplicates of the Read, Grep, Glob definitions from getTools() in prompt.ts.
   // Must NOT include Explore itself (prevent recursion).

5. INITIALIZE messages array:
   const messages = [
     { role: "system", content: systemPrompt },
     { role: "user", content: `Explore the codebase: ${query}` },
   ];

6. INITIALIZE tool call counters:
   const toolCounts = { read: 0, grep: 0, glob: 0 };

7. CREATE overall timeout signal:
   const overallStart = Date.now();
   let remainingTimeoutMs = overallTimeoutMs;

8. LOOP (turn = 0; turn < maxTurns; turn++):
   a. Calculate remaining timeout: remainingTimeoutMs = overallTimeoutMs - (Date.now() - overallStart)
   b. If remainingTimeoutMs <= 0 → break with "Explore error: Exploration timed out after N seconds."
   c. Create per-call signal: AbortSignal.timeout(Math.min(15000, remainingTimeoutMs))
   d. Call client.chat.completions.create({
        model,
        messages,
        tools: subagentTools,
        thinking: { type: "disabled" },
        temperature: 0.1,
        max_tokens: maxTokens,
      }, { signal: perCallSignal })
   e. If response.usage exists → recordBudgetCost(projectRoot, model, response.usage)
   f. Get assistant message from response.choices[0]?.message
   g. If response.choices is empty or message is null/undefined:
      → return "Explore error: Subagent returned no response."
   h. If message has tool_calls:
      - Append assistant message to messages array
      - For each tool call:
        - Execute via executeSubagentTool(toolCall, sessionId, projectRoot)
        - Increment toolCounts[toolCall.function.name] by 1
        - Format result as { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) }
        - Append tool result message to messages array
      - Continue loop
   i. If message has content and finish_reason is not "tool_calls":
      - Append assistant message to messages array
      - Return content (DONE)
   j. If finish_reason === "length":
      - Append assistant message to messages array
      - If content is non-empty → return content (DONE, even though truncated)
      - If content is empty → continue loop (try to get a response within token limit)
   k. If message has NEITHER content NOR tool_calls:
      - Append assistant message to messages array
      - Continue loop (LLM might produce content on next turn)

9. MAX TURNS REACHED:
   - Find the last assistant message with non-empty content
   - If found → return that content
   - If not found and toolCounts has entries → return JSON fallback:
     `"Exploration complete. Tools called: " + JSON.stringify(
        Object.entries(toolCounts)
          .filter(([, count]) => count > 0)
          .map(([tool, count]) => ({ tool, count }))
      )`
   - If not found and NO tools were called → return "Explore error: No results produced."

10. ERROR HANDLING:
    - All errors caught → return `"Explore error: ${message}"`
```

**Dependencies:**
- `openai` (for `OpenAI` type)
- `../common/budget-tracker` (`recordBudgetCost`)
- `../common/model-catalog` (none — model already resolved by caller)
- `./executor` (`ToolExecutionResult`)
- `../prompt` (for tool definitions — Read, Grep, Glob)

**Error Handling:**
- API errors → caught, returned as error string
- Timeout → caught via AbortSignal, returned as error string
- Invalid arguments → caught at top, returned as error string
- Tool execution errors → tool result reflects error, loop continues

---

---

### Component: handleExploreToolCall

**Purpose:** Entry point called by the session loop when the main LLM invokes the `Explore` tool.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts
export async function handleExploreToolCall(
  toolCall: ToolCall,
  createOpenAIClient: CreateOpenAIClient,
  projectRoot: string,
): Promise<ToolExecutionResult>
```

**Internal Logic:**
```
1. PARSE arguments from toolCall.function.arguments (JSON parse)
2. VALIDATE:
   - If parse fails → return { ok: false, error: "Failed to parse Explore arguments." }
   - Extract query (string, required): if missing or empty → return error
   - Extract thoroughness (string, optional): default "medium" if missing
   - Validate thoroughness enum: if invalid → default "medium"
3. GET LLM CLIENT:
   - const llmContext = createOpenAIClient()
   - If !llmContext?.client → return { ok: false, error: "LLM client is not available." }
4. RESOLVE CHEAP MODEL:
   - const cheapModel = getCheapModel(llmContext.model) ?? llmContext.model
5. GENERATE SESSION ID:
   - const subagentSessionId = `explore-${crypto.randomUUID()}`
6. RUN SUBAGENT:
   - const summary = await runExploreSubagent({
       query,
       thoroughness,
       projectRoot,
       client: llmContext.client,
       model: cheapModel,
       sessionId: subagentSessionId,
     })
7. RETURN RESULT:
   - If summary starts with "Explore error:" → { ok: false, error: summary }
   - Else → { ok: true, name: "Explore", output: summary }
```

**Dependencies:**
- `./executor` (`ToolCall`, `ToolExecutionResult`, `CreateOpenAIClient`)
- `../common/model-catalog` (`getCheapModel`)

**Error Handling:** All errors from `runExploreSubagent` are captured in the returned string (prefixed with "Explore error:"), which is then converted to `{ ok: false, error: ... }`.

---

### Component: Session Interception (session.ts modification)

**Purpose:** Modifies the session loop to intercept `Explore` tool calls before they reach `ToolExecutor`.

**Interface:** Modification to the tool execution block in `session.ts` (inside `replySession`/`processTurn`, around where `this.toolExecutor.executeToolCalls(...)` is called).

**Internal Logic:**
```
Before the existing tool execution block:

// Split tool calls into Explore and non-Explore
const exploreCalls: ToolCall[] = [];
const otherCalls: ToolCall[] = [];
for (const tc of parsedToolCalls) {
  if (tc.function.name === "Explore") {
    exploreCalls.push(tc);
  } else {
    otherCalls.push(tc);
  }
}

// Execute Explore calls first (sequentially)
for (const exploreCall of exploreCalls) {
  const result = await handleExploreToolCall(
    exploreCall,
    this.createOpenAIClient,
    this.projectRoot,
  );
  // Format result as tool result and add to messages
  executionResults.push({
    toolCallId: exploreCall.id,
    content: formatSubagentToolResult(result),
    result,
  });
}

// Execute remaining tools via ToolExecutor as normal
if (otherCalls.length > 0) {
  const otherResults = await this.toolExecutor.executeToolCalls(
    sessionId,
    otherCalls,
    hooks,
  );
  executionResults.push(...otherResults);
}
```

**Dependencies:**
- `../tools/explore-subagent` (`handleExploreToolCall`)
- `../tools/executor` (`ToolExecutionResult`)

### Component: formatSubagentToolResult

**Purpose:** Formats a `ToolExecutionResult` into a string suitable for a tool result message content, following the same JSON format as `ToolExecutor.formatToolResult()`.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts (or inline in session.ts)
function formatSubagentToolResult(result: ToolExecutionResult): string {
  const payload: Record<string, unknown> = {
    ok: result.ok,
    name: result.name,
  };
  if (typeof result.output !== "undefined") {
    payload.output = result.output;
  }
  if (result.error) {
    payload.error = result.error;
  }
  if (result.metadata && Object.keys(result.metadata).length > 0) {
    payload.metadata = result.metadata;
  }
  return JSON.stringify(payload, null, 2);
}
```

**Internal Logic:** Same logic as `ToolExecutor.formatToolResult()` (lines 308-331 of executor.ts). Duplicated inline to avoid making the private method public or adding an export solely for this use case.

**Dependencies:** `./executor` (`ToolExecutionResult`).

---

### Component: EXPLORE_SYSTEM_PROMPT

**Purpose:** Constant string defining the subagent's system prompt.

**Interface:**
```typescript
// In src/tools/explore-subagent.ts
const EXPLORE_SYSTEM_PROMPT = `You are a read-only codebase explorer. Your job is to search, read, and analyze code to answer exploration questions.

## Tools
- **Read**: Read file contents. Use this to inspect files you find.
- **Grep**: Search file contents by regex pattern. Use this to find where functions, classes, or patterns are defined.
- **Glob**: Find files by glob pattern. Use this to discover file structure.

## Rules
1. You CANNOT write, edit, or execute code. You are read-only.
2. Prefer Grep and Glob to discover files, then Read to inspect them.
3. Do NOT read files you don't need — be targeted.
4. Return a CONCISE summary (under 500 words) of what you found.
5. Structure your summary clearly: list files, key findings, and relationships.
6. If you cannot find something, say so explicitly rather than guessing.
7. Do NOT include the exploration process in your final response — only the findings.`;
```

**Thoroughness-specific suffixes (appended to EXPLORE_SYSTEM_PROMPT):**
- `quick`: `"\n\n## Mode: Quick\nBe fast. Find the answer in 1-3 tool calls. Return a 1-3 sentence summary."`
- `medium`: `"\n\n## Mode: Medium\nBe thorough but efficient. Explore the most relevant files."`
- `thorough`: `"\n\n## Mode: Thorough\nBe very thorough. Explore all relevant files, dependencies, and edge cases. Map out the full picture."`

**Dependencies:** None.

---

## Data Flow

### Flow 1: Main Agent Delegates to Explore

```
User: "Find where authentication logic is implemented"
  │
  ▼
Main LLM (session loop)
  │  Decides to call Explore tool
  │  tool_calls: [{ name: "Explore", arguments: { query: "...", thoroughness: "medium" } }]
  ▼
Session Interception (session.ts)
  │  Detects tool name === "Explore"
  │  Routes to handleExploreToolCall()
  ▼
handleExploreToolCall()
  │  1. Parse & validate args
  │  2. createOpenAIClient() → get client + model
  │  3. cheapModel = getCheapModel(model) ?? model
  │  4. Call runExploreSubagent({...})
  ▼
runExploreSubagent()
  │  ┌─────────────────────────────────────────┐
  │  │         ISOLATED CONTEXT                  │
  │  │                                           │
  │  │  System Prompt                            │
  │  │  User: "Explore: find auth logic"        │
  │  │    │                                      │
  │  │    ▼                                      │
  │  │  LLM call (deepseek-v4-flash, no think)  │
  │  │    │ tool_calls: [Grep("authenticate")]  │
  │  │    ▼                                      │
  │  │  Execute Grep → results                   │
  │  │    │                                      │
  │  │    ▼                                      │
  │  │  LLM call (with Grep results)            │
  │  │    │ tool_calls: [Read("auth.ts")]        │
  │  │    ▼                                      │
  │  │  Execute Read → file contents             │
  │  │    │                                      │
  │  │    ▼                                      │
  │  │  LLM call (with Read results)            │
  │  │    │ content: "Authentication is in..."   │
  │  │    ▼                                      │
  │  │  RETURN summary                           │
  │  └─────────────────────────────────────────┘
  │
  ▼
handleExploreToolCall() returns { ok: true, output: summary }
  │
  ▼
Session loop formats tool result and appends to messages
  │
  ▼
Main LLM receives summary, responds to user:
  "The authentication logic is implemented in src/auth/auth.ts..."
```

### Flow 2: Explore Tool Call with Other Tools in Same Batch

```
Main LLM calls: [Explore, Read, Grep]
  │
  ▼
Session Interception:
  1. Extract Explore calls → [Explore]
  2. Execute Explore → summary
  3. Extract other calls → [Read, Grep]
  4. Execute via ToolExecutor as normal
  5. Combine all results
  6. Append to messages
```

---

## Data Structures

### ExploreSubagentOptions

```typescript
export type ExploreSubagentOptions = {
  query: string;                                    // The exploration task
  thoroughness: "quick" | "medium" | "thorough";    // Depth control
  projectRoot: string;                              // Project root for tool execution
  client: OpenAI;                                   // OpenAI client (authenticated)
  model: string;                                    // Resolved cheap model name
  sessionId: string;                                // Unique ID for this subagent execution
};
```

### ThoroughnessConfig (internal)

```typescript
type ThoroughnessConfig = {
  maxTurns: number;
  maxTokens: number;
  overallTimeoutMs: number;
  systemPromptSuffix: string;
};

const THOROUGHNESS_CONFIGS: Record<string, ThoroughnessConfig> = {
  quick: {
    maxTurns: 5,
    maxTokens: 2048,
    overallTimeoutMs: 30000,
    systemPromptSuffix: "\n\n## Mode: Quick\nBe fast. Find the answer in 1-3 tool calls. Return a 1-3 sentence summary.",
  },
  medium: {
    maxTurns: 10,
    maxTokens: 4096,
    overallTimeoutMs: 60000,
    systemPromptSuffix: "\n\n## Mode: Medium\nBe thorough but efficient. Explore the most relevant files.",
  },
  thorough: {
    maxTurns: 25,
    maxTokens: 8192,
    overallTimeoutMs: 120000,
    systemPromptSuffix: "\n\n## Mode: Thorough\nBe very thorough. Explore all relevant files, dependencies, and edge cases. Map out the full picture.",
  },
};
```

### SubagentToolDefinition (subset of ToolDefinition, read-only)

```typescript
// In src/tools/explore-subagent.ts — exact copies from getTools() in prompt.ts
const READONLY_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "read",
      description: "Read files from the filesystem (text, images, PDFs, notebooks).",
      parameters: {
        type: "object" as const,
        properties: {
          file_path: { type: "string" as const, description: "UNIX-style path to file" },
          offset: { type: "number" as const, description: "Line number to start reading from" },
          limit: { type: "number" as const, description: "Number of lines to read" },
          pages: { type: "string" as const, description: 'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files.' },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "grep",
      description: "Search file contents within the project workspace using a regex pattern. Respects .gitignore and auto-excludes node_modules, .git, dist, etc. Returns matching file paths, line numbers, and line content as a JSON array. Prefer this over bash grep/rg for searching file contents.",
      parameters: {
        type: "object" as const,
        properties: {
          pattern: { type: "string" as const, description: "Regex pattern to search for in file contents (e.g., 'TODO', 'import.*from')." },
          path: { type: "string" as const, description: "Optional file or directory path relative to project root to search within (default: entire project)." },
          glob: { type: "string" as const, description: "Optional glob pattern to filter which files to search (e.g., '*.ts', 'src/**/*.tsx')." },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "glob",
      description: "Search for files matching a glob pattern (e.g., 'src/**/*.ts', '*.test.ts'). Respects .gitignore and auto-excludes node_modules, .git, dist, etc. Returns matching relative file paths as a JSON array. Prefer this over bash ls/find.",
      parameters: {
        type: "object" as const,
        properties: {
          pattern: { type: "string" as const, description: "Glob pattern to match (e.g., '**/*.ts', 'src/**/*.tsx'). If the pattern has no directory component it matches in any directory." },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
];
```

These are EXACT duplicates of the Read, Grep, Glob definitions from `getTools()` in `prompt.ts` as of 2026-06-12. If the definitions in `getTools()` change, these must be updated to match. A test in Task 9 verifies consistency.

---

## File / Module Layout

```
src/
├── tools/
│   ├── explore-subagent.ts        ← NEW (all subagent logic)
│   ├── executor.ts                ← NO CHANGE (ToolExecutor used only for main loop)
│   ├── web-search-handler.ts      ← NO CHANGE (pattern reference)
│   ├── read-handler.ts            ← NO CHANGE
│   ├── grep-handler.ts            ← NO CHANGE
│   └── glob-handler.ts            ← NO CHANGE
├── prompt.ts                      ← MODIFIED: add Explore tool definition to getTools()
├── session.ts                     ← MODIFIED: intercept Explore tool calls before ToolExecutor
└── common/
    ├── model-catalog.ts           ← NO CHANGE (getCheapModel already exists)
    └── budget-tracker.ts          ← NO CHANGE (recordBudgetCost already exists)
```

### New File: `src/tools/explore-subagent.ts`

Contains:
1. `ExploreSubagentOptions` type
2. `ThoroughnessConfig` type (private)
3. `THOROUGHNESS_CONFIGS` constant (private)
4. `EXPLORE_SYSTEM_PROMPT` constant (private)
5. `READONLY_TOOL_DEFINITIONS` constant (private)
6. `READONLY_TOOL_HANDLERS` constant (private)
7. `executeSubagentTool()` function (private)
8. `runExploreSubagent()` function (exported)
9. `handleExploreToolCall()` function (exported)

### Modified File: `src/prompt.ts`

**Location:** Inside `getTools()` return array, add after the last existing tool definition (after WebSearch).

**Change:** Add one new tool definition object (Explore).

**Lines changed:** ~30 lines added.

### Modified File: `src/session.ts`

**Location:** In the turn processing loop, where `this.toolExecutor.executeToolCalls()` is called.

**Change:** Add interception logic that splits `Explore` tool calls from other tool calls, executes Explore first via `handleExploreToolCall()`, then executes remaining tools via `ToolExecutor`.

**Lines changed:** ~40 lines added/modified.

---

## Testing Strategy

### Unit Tests (in `src/tests/explore-subagent.test.ts`)

| Test | What it verifies | FR covered |
|------|-----------------|------------|
| `handleExploreToolCall returns error for missing query` | Validation of required args | FR-006 |
| `handleExploreToolCall returns error for empty query` | Validation of empty string | FR-006 |
| `handleExploreToolCall defaults invalid thoroughness to medium` | Enum validation | FR-007 |
| `handleExploreToolCall returns error when LLM client is null` | Client availability check | FR-006 |
| `handleExploreToolCall returns error for malformed JSON arguments` | Parse error handling | FR-006 |
| `runExploreSubagent returns direct content on single-turn response` | LLM responds without tools | FR-002 |
| `runExploreSubagent executes multi-turn tool loop` | Tool call → execute → continue | FR-002 |
| `runExploreSubagent respects max turns for quick thoroughness` | Max turns enforcement | FR-002, FR-007 |
| `runExploreSubagent respects max turns for medium thoroughness` | Max turns enforcement | FR-002, FR-007 |
| `runExploreSubagent respects max turns for thorough thoroughness` | Max turns enforcement | FR-002, FR-007 |
| `runExploreSubagent returns fallback when max turns reached with no content` | Max turns fallback | FR-002 |
| `runExploreSubagent records budget for each API call` | Budget tracking | FR-004 |
| `runExploreSubagent returns error on API failure` | Error propagation | FR-008 |
| `runExploreSubagent only registers read tools` | Tool restriction | FR-009 |
| `runExploreSubagent uses thinking: disabled in API calls` | API configuration | FR-010 |
| `runExploreSubagent uses temperature: 0.1 in API calls` | API configuration | FR-010 |

### Integration Tests (with mock LLM client)

| Test | What it verifies |
|------|-----------------|
| Full `quick` exploration with mock returning text directly | End-to-end quick flow |
| Full `medium` exploration with mock returning tool calls then text | End-to-end multi-turn flow |
| Full `thorough` exploration timeout | Timeout behavior |
| Explore tool definition appears in getTools() output | FR-001 |

### Session Interception Tests (in existing session test file)

| Test | What it verifies |
|------|-----------------|
| Session routes Explore tool call to handleExploreToolCall | FR-006 |
| Session processes non-Explore tools normally after Explore | FR-006 |
| Session handles Explore + other tools in same batch | FR-006 |

---

## Migration / Rollback

**Migration:** Zero migration. This is purely additive — new file, two small modifications. No settings changes, no data format changes, no API changes.

**Rollback:** Remove the Explore tool definition from `getTools()`, remove the interception block from `session.ts`, delete `src/tools/explore-subagent.ts`. Existing behavior is fully preserved.
