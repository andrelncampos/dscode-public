# Spec 10: more-effectiveness-and-economy — Design

## Design Approach

This spec implements 6 independent optimizations across 10 files. Each optimization is a **surgical edit** to existing code — no new files, no new abstractions, no new classes. The approach follows KISS: each change is the minimum necessary to achieve the requirement. All changes are additive-removal (delete dead code, simplify branches, reduce content).

**Principles applied:**
1. **KISS:** No new abstractions. Every change is a direct edit in-place.
2. **DRY:** Removes duplicated tool documentation between system prompt and JSON schema.
3. **Surgical changes:** Touch only what is required. Do not reformat, refactor, or "improve" adjacent code.
4. **AI-First precision:** Every edit location, old string, and new string is specified exactly.

---

## Architecture Decisions

### AD-HOC-001: Hardcoded flash model for compaction

The compaction model `"deepseek-v4-flash"` is hardcoded as a string literal in `compactSession()`. It is NOT read from settings or made configurable. This is intentional — compaction is an internal optimization, not a user-facing feature. Making it configurable would add settings surface area, validation, and documentation burden for zero practical benefit.

### AD-HOC-002: Synchronous keyword matching for skills

`matchSkillsByKeywords` is synchronous and deterministic. It does not use embeddings, vector search, or any ML technique. This is intentional — the 3 built-in skills have clear, distinct keywords that are trivially matched by substring search. The complexity and latency of a more sophisticated matching system would violate KISS for no measurable accuracy gain.

### AD-HOC-003: Keep DEEPSEEK_V4_MODELS set as documentation

The `DEEPSEEK_V4_MODELS` set is kept in `model-capabilities.ts` even though all its usage sites are simplified. It serves as a self-documenting registry of which models are V4. If a new non-V4 model is added in the future, the set provides a clear location to add it and re-introduce gating logic.

---

## Component / Module Breakdown

### Component 1: OpenAIMessageConverter.convertMessage — reasoning_content gating

**File:** `src/common/openai-message-converter.ts`
**Lines:** 127-133

**Purpose:** Modify the logic that adds `reasoning_content` to assistant messages so it only applies when the message has tool calls.

**Current code (lines 127-133):**
```typescript
    if (typeof messageParams?.reasoning_content === "string") {
      (base as { reasoning_content?: string }).reasoning_content = messageParams.reasoning_content;
    } else if (thinkingEnabled && message.role === "assistant") {
      // Thinking-mode providers require every replayed assistant message
      // to include the reasoning_content field, even when it is empty.
      (base as { reasoning_content?: string }).reasoning_content = "";
    }
```

**New code:**
```typescript
    const hasToolCalls =
      Array.isArray(messageParams?.tool_calls) && (messageParams!.tool_calls as unknown[]).length > 0;
    if (hasToolCalls) {
      if (typeof messageParams?.reasoning_content === "string") {
        (base as { reasoning_content?: string }).reasoning_content = messageParams.reasoning_content;
      } else if (thinkingEnabled && message.role === "assistant") {
        // Per DeepSeek V4 API docs: reasoning_content is only required to be
        // passed back when the assistant performed a tool call in that turn.
        // For turns without tool calls, it is ignored by the API and can be
        // omitted to save input tokens.
        (base as { reasoning_content?: string }).reasoning_content = "";
      }
    }
```

**Dependencies:** None (local logic change only).
**Error Handling:** No new error paths. The `hasToolCalls` check uses safe type guards (Array.isArray, length > 0).

---

### Component 2: SessionManager.compactSession — flash model

**File:** `src/session.ts`
**Lines:** 1563-1656 (method `compactSession`)

**Purpose:** Override the model and thinking mode for compaction API calls.

**Current code (lines 1565-1566, 1593, 1596-1601):**
```typescript
    const { client, model, baseURL, temperature, thinkingEnabled, reasoningEffort, debugLogEnabled } =
      this.createOpenAIClient();
    // ...
    const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);
    const response = await this.createChatCompletionStream(
      client,
      {
        model,
        ...(temperature !== undefined ? { temperature } : {}),
        messages: [{ role: "user", content: compactPrompt }],
        ...thinkingOptions,
      },
```

**New code:**
```typescript
    const { client, baseURL, debugLogEnabled } = this.createOpenAIClient();
    // ...
    const compactionModel = "deepseek-v4-flash";
    const response = await this.createChatCompletionStream(
      client,
      {
        model: compactionModel,
        messages: [{ role: "user", content: compactPrompt }],
      },
      signal ? { signal } : undefined,
      sessionId,
      {
        enabled: debugLogEnabled,
        location: "SessionManager.compactSession",
        baseURL,
        params: { compactionModel },
      }
    );
```

Key changes from original:
1. Destructure only `client`, `baseURL`, and `debugLogEnabled` — the other fields (`model`, `temperature`, `thinkingEnabled`, `reasoningEffort`) are not needed for compaction and are intentionally not destructured.
2. Hardcode `compactionModel = "deepseek-v4-flash"` as the model.
3. Remove the `...temperature` spread (no temperature sent — the API default is fine for summarization).
4. Remove `...thinkingOptions` spread (no thinking for compaction).
5. The `signal`, `sessionId`, and debug params remain with the same structure as the original — only the request body and debug params content change.

**Error Handling:** No change. The response handling and usage accumulation remain identical.

---

### Component 3: SessionManager.matchSkillsByKeywords — heuristic skill matching

**File:** `src/session.ts`
**New private method, replaces `identifyMatchingSkillNames` (lines 758-838)**

**Purpose:** Synchronously match skills to user prompts using substring keyword matching.

**Interface:**
```typescript
private matchSkillsByKeywords(skills: SkillInfo[], userPrompt: string): string[] {
  if (!userPrompt || skills.length === 0) return [];
  const lowerPrompt = userPrompt.toLowerCase();
  const matched: string[] = [];

  for (const skill of skills) {
    if (skill.isLoaded) continue;

    // Rule 1: skill name matches (hyphens/spaces equivalent)
    const normalizedName = skill.name.toLowerCase().replace(/-/g, " ");
    const nameWithHyphens = skill.name.toLowerCase().replace(/ /g, "-");
    if (lowerPrompt.includes(normalizedName) || lowerPrompt.includes(nameWithHyphens)) {
      matched.push(skill.name);
      continue;
    }

    // Rule 2: at least one significant word from description matches
    if (skill.description) {
      const descWords = skill.description
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "") // strip punctuation except hyphens
        .split(/\s+/)
        .filter((w) => w.length >= 5); // only significant words
      if (descWords.some((word) => lowerPrompt.includes(word))) {
        matched.push(skill.name);
      }
    }
  }
  return matched;
}
```

**Internal Logic:**
1. Guard: if `userPrompt` is empty/falsy or `skills` is empty, return `[]`.
2. For each skill (skipping `isLoaded`):
   a. Normalize name: replace hyphens with spaces. Check if normalized name appears as substring in lowerPrompt.
   b. Normalize name reverse: replace spaces with hyphens. Check if that appears.
   c. If name matches → add to results, continue to next skill.
   d. Extract words from description: strip punctuation, split on whitespace, keep words ≥5 chars.
   e. If any desc word appears as substring in lowerPrompt → add to results.
3. Return matched skill names array.

**Call sites updated (3 locations):**
All three replace:
```typescript
const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
```
with:
```typescript
const skillNames = this.matchSkillsByKeywords(skills, userPrompt.text ?? "");
```
And remove `this.throwIfAborted(signal)` immediately after (the async call was the only reason to check abort there).

**Dependencies:** No external dependencies. Only uses `SkillInfo` type from `src/session.ts`.

**Error Handling:** No errors possible — all inputs are strings with safe operations (`.toLowerCase()`, `.includes()`, `.replace()`).

---

### Component 4: getSystemPrompt — remove tool docs

**File:** `src/prompt.ts`
**Lines:** 128-153 (function `readToolDocs`) and 273-276 (function `getSystemPrompt`)

**Purpose:** Simplify system prompt to only `SYSTEM_PROMPT_BASE` without appended tool documentation.

**Current code (lines 273-276):**
```typescript
export function getSystemPrompt(_projectRoot: string, options: PromptToolOptions = {}): string {
  const toolDocs = readToolDocs(getExtensionRoot(), options);
  return toolDocs ? `${SYSTEM_PROMPT_BASE}\n\n# Available Tools\n\n${toolDocs}` : SYSTEM_PROMPT_BASE;
}
```

**New code:**
```typescript
export function getSystemPrompt(_projectRoot: string, _options: PromptToolOptions = {}): string {
  return SYSTEM_PROMPT_BASE;
}
```

**Also remove:** The `readToolDocs` function (lines 128-153) — it is only called from `getSystemPrompt`. Remove the import of `ejs` if `readToolDocs` was the only EJS consumer in `prompt.ts`. Verify: `ejs` is also used in `session.ts` for prompt template rendering, not in `prompt.ts`. The import `import ejs from "ejs"` on line 5 of `prompt.ts` is used ONLY by `readToolDocs` → remove it. The `import { supportsMultimodal }` on line 9 is used only by `readToolDocs` → remove it (handled in FR-007). The `import * as fs from "fs"` on line 2 is used by `readToolDocs` AND `readDefaultSkillDocs` → keep.

**Dependencies:** `templates/tools/*.md` files remain on disk but are no longer read at runtime.

---

### Component 5: Built-in skill documents — compact versions

**Files:**
- `templates/skills/karpathy-guidelines.md`
- `templates/skills/plan-and-execute.md`
- `templates/skills/agent-drift-guard.md`

**Purpose:** Replace each file with a compact version (≤30 lines of rules, excluding YAML frontmatter).

**Dependencies:** No code changes needed. `getDefaultSkillPrompt()` in `prompt.ts` reads these files and injects them unchanged.

**New content for each file:**

**`templates/skills/karpathy-guidelines.md`:**
```markdown
---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---

# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

**Internal use:** Apply silently. Do not cite this document in user-facing responses.

## 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

## 2. Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- If 200 lines could be 50, rewrite it.

## 3. Surgical Changes
- Touch only what you must. Don't "improve" adjacent code, comments, or formatting.
- Match existing style even if you'd do it differently.
- Remove only imports/variables your change made unused.

## 4. Goal-Driven Execution
- Define success criteria. Loop until verified.
- For multi-step tasks, state a brief plan with verify steps.
```

**`templates/skills/plan-and-execute.md`:**
```markdown
---
name: plan-and-execute
description: Automatically plan and execute requirements. Creates a markdown task list with the UpdatePlan tool, and systematically executes each task while updating progress. Use when working with task planning or when you need to break down and execute complex multi-step requirements.
---

# Plan and Execute

## Workflow
1. Analyze requirements and explore project context.
2. Clarify ambiguities with AskUserQuestion.
3. Create markdown task list via UpdatePlan.
4. Execute tasks one at a time, updating plan in real time.
5. Revise remaining plan as new context appears.

## Task States
- `[ ]` Pending
- `[>]` In progress
- `[x]` Completed
- `[!]` Blocked

## Rules
- Only ONE task in progress at a time.
- Always pass the complete markdown task list (not a partial diff).
- Refresh plan before first task and after each task completion.
- Remove irrelevant tasks; add newly discovered ones before working on them.
- For complex tasks, add indented sub-tasks below the main task.

## When to Use
Multi-step tasks (3+ steps), feature implementation, bug fixing, refactoring, detailed requirements, progress tracking.

## When NOT to Use
Single simple tasks, trivial changes, informational requests, brainstorming without execution.
```

**`templates/skills/agent-drift-guard.md`:**
```markdown
---
name: agent-drift-guard
description: Detect and correct execution drift while working on user requests. Use when you are actively implementing, debugging, reviewing, or investigating and there is a risk of wandering beyond the user's goal.
---

# Agent Drift Guard

## Self-Check (before each action)
1. State the user's requested outcome in one sentence.
2. List explicit non-goals or boundaries set by the user.
3. Confirm the next action directly advances the requested outcome.
4. If not, cut it or pause to confirm.

## Drift Signals (warning signs)
- Exploring broadly before opening the most relevant file.
- Solving adjacent operational issues when user asked only for code changes.
- Adding extra safeguards, scripts, docs, refactors, or cleanup not requested.
- Reframing the task around what seems "better" instead of what was asked.
- Continuing with a broader plan after user narrows scope.
- Repeating searches without increasing certainty.
- Mixing diagnosis, remediation, and feature work when only one was asked.
- Touching production-like state, external systems, or live data without permission.

## Severity
- **Mild:** 1-2 extra exploratory commands → auto-correct silently, narrow scope.
- **Material:** Planning unrequested deliverables → stop, realign, ask if unavoidable.
- **Boundary/Risk:** Modifying live systems, ignoring repeated instructions → pause, surface boundary, ask.

## Decision Rules (in order)
1. Prefer the most direct artifact first. Open the relevant file before scanning the whole repo.
2. Prefer the smallest complete fix. Solve the asked problem before improving related systems.
3. Prefer internal correction over user interruption. Ask only when scope changes deliverables/risk.
4. Treat repeated user constraints as priority signals. Tighten scope immediately.
5. Separate categories: code change, investigation, production remediation, cleanup, docs are distinct.

## Anti-Patterns
Do not: create cleanup scripts/docs/tools just because they seem useful; broaden the task after discovering a neighbor problem; continue a rejected plan; justify drift with "best practice"; hide extra work inside a larger patch.
```

---

### Component 6: Legacy removal — webSearchTool and model gating

**Files modified:** 6 files

#### 6a. `src/tools/web-search-handler.ts`

**Remove:** Functions `executeConfiguredWebSearch` (lines 99-150), `runWebSearchScript` (lines 152-197), `appendChunk` (lines 199-206), `formatWebSearchActivityLabel` (lines 208-214), `buildCommandError` (lines 216-224).

**Remove:** Import `import { spawn } from "child_process"` (line 1).

**Remove:** Import `import { supportsWebSearch } from "../common/model-capabilities"` (line 3).

**Modify `handleWebSearchTool` (lines 9-45):**
```typescript
export async function handleWebSearchTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query.trim()) {
    return {
      ok: false,
      name: "WebSearch",
      error: 'Missing required "query" string.',
    };
  }

  const llmContext = context.createOpenAIClient?.();
  if (!llmContext?.client) {
    return {
      ok: false,
      name: "WebSearch",
      error: "LLM client is not available. Check your API key configuration.",
    };
  }

  return executeNativeWebSearch(query, llmContext.model, llmContext.client);
}
```

**Remove unused constants if they become orphaned:** `MAX_CAPTURE_CHARS`, `WEB_SEARCH_TOOL_ACTIVITY_PREFIX`.

#### 6b. `src/common/model-capabilities.ts`

**Remove:** `NON_MULTIMODAL_MODELS` (line 3), `supportsMultimodal` (lines 9-11), `supportsWebSearch` (lines 13-15).

**Keep:** `DEEPSEEK_V4_MODELS` (line 1, as documentation registry), `defaultsToThinkingMode` (line 5-7, simplified to `return true`).

**New file content:**
```typescript
// Registry of DeepSeek V4 model names. Kept as documentation — if a non-V4
// model is added in the future, gating logic can reference this set.
export const DEEPSEEK_V4_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

export function defaultsToThinkingMode(_model: string): boolean {
  return true;
}
```

#### 6c. `src/prompt.ts`

**Remove:** `import { supportsMultimodal } from "./common/model-capabilities"` (line 9).

**Remove:** `import ejs from "ejs"` (line 5) — verify no other usage in `prompt.ts`. Check: `ejs` is used in `readToolDocs` only (being removed). The `session.ts` file imports its own `ejs` separately. → Remove the import.

**Remove:** `readToolDocs` function (lines 128-153).

**Modify `getSystemPrompt`** (as in Component 4 above).

#### 6d. `src/common/openai-message-converter.ts`

**Remove:** `import { supportsMultimodal } from "./model-capabilities"` (line 2).

**Modify line 143:**
```typescript
// Before:
        if (part && (part.type !== "image_url" || supportsMultimodal(model))) {
// After:
        if (part && part.type !== "image_url") {
```

#### 6e. `src/session.ts`

**Remove:** `import { DEEPSEEK_V4_MODELS } from "./common/model-capabilities"` (line 10).

**Modify `getCompactPromptTokenThreshold` (lines 80-84):**
```typescript
export function getCompactPromptTokenThreshold(_model: string): number {
  return DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD;
}
```

**Remove:** `webSearchTool?: string` from types (lines 296, 322).

#### 6f. `src/settings.ts`

**Remove:** `import { defaultsToThinkingMode, DEEPSEEK_V4_MODELS }` → `import { defaultsToThinkingMode }` (line 1).

**Remove:** `webSearchTool` from `DeepcodingSettings` (line 59) and `ResolvedDeepcodingSettings` (line 76).

**Modify maxTokens default (line 367):**
```typescript
// Before:
    (model === "deepseek-v4-pro" ? 65536 : DEEPSEEK_V4_MODELS.has(model) ? 32768 : 0);
// After:
    (model === "deepseek-v4-pro" ? 65536 : 32768);
```

**Remove:** `webSearchTool` resolution block (lines 371-375) and the assignment in the return object (line 389).

#### 6g. `src/common/settings-schema.ts`

**Remove:** Line 48 `webSearchTool: z.string().optional(),` from the Zod schema.

#### 6h. `src/common/openai-client.ts`

**Remove:** `webSearchTool?: string` from return type (line 34) and all three return statements (lines 50, 68, 105).

#### 6i. `src/tools/executor.ts`

**Remove:** `webSearchTool?: string` from `ToolExecutionContext` (line 26).

#### 6j. `src/common/api-timeout.ts`

**Remove:** `import { DEEPSEEK_V4_MODELS }` (line 1).

**Modify `resolveApiTimeoutMs` (lines 39-49):**
```typescript
// Before:
  if (model) {
    if (model === "deepseek-v4-pro") {
      return PRO_API_TIMEOUT_MS;
    }
    if (model === "deepseek-v4-flash") {
      return FLASH_API_TIMEOUT_MS;
    }
    if (DEEPSEEK_V4_MODELS.has(model)) {
      return PRO_API_TIMEOUT_MS;
    }
  }
// After:
  if (model) {
    if (model === "deepseek-v4-pro") {
      return PRO_API_TIMEOUT_MS;
    }
    if (model === "deepseek-v4-flash") {
      return FLASH_API_TIMEOUT_MS;
    }
  }
```

---

### Component 7: EJS template simplification (if readToolDocs kept — moot if removed)

If `readToolDocs` is removed entirely (FR-004), no EJS template changes are needed because the templates are no longer read. If `readToolDocs` is kept but simplified, any `.ejs` files in `templates/tools/` referencing `supportsMultimodal` must be checked. Current check: no `.ejs` files exist in `templates/tools/` (only `.md` files based on the glob output from earlier). So this requirement is satisfied implicitly by FR-004.

---

## Data Flow

### Flow 1: Assistant message conversion (FR-001)

```
SessionManager.activateSession()
  → buildMessages() [openai-message-converter.ts]
    → convertMessage() for each message
      → if assistant + has tool_calls → include reasoning_content
      → if assistant + no tool_calls → omit reasoning_content
      → if not assistant → no reasoning_content field
  → sent to API
```

### Flow 2: Context compaction (FR-002)

```
SessionManager.activateSession() [main loop]
  → activeTokens > threshold?
    → compactSession()
      → createChatCompletionStream(client, {
          model: "deepseek-v4-flash",    // hardcoded
          messages: [{role:"user", content: compactPrompt}],
          // no thinking, no temperature
        })
      → parse response → save summary → mark messages as compacted
```

### Flow 3: Skill matching (FR-003)

```
SessionManager.createSession() / replySession() / appendDeferredPermissionPrompt()
  → userPrompt.text present?
    → skills = await this.listSkills()
    → skillNames = this.matchSkillsByKeywords(skills, userPrompt.text)  // synchronous
    → filter skills by skillNames
    → normalize + inject matching skills
```

---

## Data Structures

No new data structures. Modified types:

**Removed fields from `DeepcodingSettings` (`src/settings.ts`):**
```typescript
// REMOVED:
webSearchTool?: string;
```

**Removed fields from `ResolvedDeepcodingSettings` (`src/settings.ts`):**
```typescript
// REMOVED:
webSearchTool?: string;
```

**Removed fields from `ToolExecutionContext` (`src/tools/executor.ts`):**
```typescript
// REMOVED:
webSearchTool?: string;
```

**Removed fields from `createOpenAIClient` return type (`src/common/openai-client.ts`):**
```typescript
// REMOVED:
webSearchTool?: string;
```

**Removed from `SessionManagerOptions.getResolvedSettings` return type (`src/session.ts`):**
```typescript
// REMOVED:
webSearchTool?: string;
```

---

## File / Module Layout

```
src/
├── common/
│   ├── api-timeout.ts          → MODIFY: remove DEEPSEEK_V4_MODELS import, simplify branch
│   ├── model-capabilities.ts   → MODIFY: remove NON_MULTIMODAL_MODELS, supportsMultimodal, supportsWebSearch
│   ├── openai-client.ts        → MODIFY: remove webSearchTool from type and returns
│   ├── openai-message-converter.ts → MODIFY: reasoning_content gating, remove supportsMultimodal
│   └── settings-schema.ts      → MODIFY: remove webSearchTool
├── prompt.ts                   → MODIFY: remove readToolDocs, ejs import, supportsMultimodal import; simplify getSystemPrompt
├── session.ts                  → MODIFY: replace identifyMatchingSkillNames with matchSkillsByKeywords, modify compactSession
├── settings.ts                 → MODIFY: remove webSearchTool, simplify maxTokens default
└── tools/
    ├── executor.ts             → MODIFY: remove webSearchTool from ToolExecutionContext
    └── web-search-handler.ts   → MODIFY: remove fallback path, simplify handleWebSearchTool

templates/
├── skills/
│   ├── karpathy-guidelines.md  → REPLACE: compact version (≤30 lines)
│   ├── plan-and-execute.md     → REPLACE: compact version (≤30 lines)
│   └── agent-drift-guard.md    → REPLACE: compact version (≤30 lines)
└── tools/                      → UNCHANGED (files kept on disk, no longer read at runtime)
```

---

## Testing Strategy

### Unit tests to add/modify:

1. **`src/tests/openai-message-converter.test.ts`:**
   - ADD: test `"omits reasoning_content when assistant message has no tool calls"` — create assistant message with `reasoning_content: "some thinking"` but no `tool_calls`, verify the converted message does NOT have `reasoning_content`.
   - ADD: test `"includes reasoning_content when assistant message has tool calls"` — create assistant message with both `tool_calls: [{id:"1",...}]` and `reasoning_content: "some thinking"`, verify the converted message DOES have `reasoning_content`.

2. **`src/tests/session.test.ts`:**
   - ADD: test `"matchSkillsByKeywords matches skill by name substring"` — skill named "my-skill", prompt "use my skill please" → matches.
   - ADD: test `"matchSkillsByKeywords matches skill by description word"` — skill desc "Provides database query capabilities", prompt "I need database help" → matches.
   - ADD: test `"matchSkillsByKeywords returns empty for no match"` — skill named "docker-tool", prompt "write a function" → no match.
   - ADD: test `"matchSkillsByKeywords skips already loaded skills"` — skill with `isLoaded: true` is not returned.
   - ADD: test `"compactSession uses flash model"` — verify the request to `createChatCompletionStream` includes `model: "deepseek-v4-flash"` and no thinking options.

3. **`src/tests/web-search-handler.test.ts`:**
   - UPDATE: remove tests that exercise the external script fallback path. Update mocks to not need `webSearchTool`.
   - UPDATE: test that `handleWebSearchTool` uses native web search when client is available.

4. **`src/tests/settings-and-notify.test.ts`:**
   - UPDATE: remove assertions about `webSearchTool`. Remove the test `"resolveSettings reads top-level thinkingEnabled, notify, and webSearchTool"` or rename and remove webSearchTool assertions.

5. **`src/tests/web-search.test.ts`:**
   - UPDATE: `makeContext` no longer needs `webSearchTool` parameter.
   - REMOVE: test `"handleWebSearchTool returns configuration error when webSearchTool is not set"` — replaced by test for no-client error.

---

## Migration / Rollback

**Migration:** No data migration needed. Settings files with `webSearchTool` will have the field ignored by Zod (the updated schema strips unknown keys automatically — see `settings.ts` line 465-469 where Zod `safeParse` strips invalid fields). User settings files do not need to be modified.

**Rollback:** Revert the commit on the `feat/more-effectiveness-and-economy` branch. All changes are contained within this branch. No database migrations, no file format changes.
