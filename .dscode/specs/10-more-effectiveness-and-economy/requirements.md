# Spec 10: more-effectiveness-and-economy — Requirements

## Value Delivery

Delivers value blocks **V6** (Multi-Model Support with Thinking Mode), **V8** (Session Management & Context Optimization), and **V11** (Cost-Optimized AI Operations) from vision.md.

> **V6:** *"The `reasoning_content` field is only transmitted for turns with tool calls — per DeepSeek V4 API behavior, reasoning content between non-tool turns is ignored by the API and can be omitted to save input tokens. Web search uses the native DeepSeek `web_search` tool type when running on V4+ engines."*

> **V8:** *"Compaction uses `deepseek-v4-flash` without thinking mode for cost-efficient summarization."*

> **V11:** *"Systematic minimization of API token consumption without sacrificing output quality. Targets include: eliminating redundant `reasoning_content` transmission between non-tool turns, using cheaper models for auxiliary tasks like context compaction, replacing LLM-based skill matching with heuristic keyword matching to eliminate an extra API call per user message, slimming the system prompt by removing tool documentation duplicated between `templates/tools/` and the JSON function schema, compacting built-in skill documents to essential rules only, and removing legacy code paths and configuration options that exist only for engines predating DeepSeek V4 and GPT 5.4."*

---

## Functional Requirements

### FR-001: Omit reasoning_content for non-tool-call assistant turns

**What:** In `OpenAIMessageConverter.convertMessage()`, when building an OpenAI `ChatCompletionMessageParam` for an assistant message that has NO `tool_calls` (i.e., `messageParams.tool_calls` is either absent, null, or an empty array), do NOT include the `reasoning_content` field at all. Only include `reasoning_content` when the assistant message HAS tool calls.

**Why:** DeepSeek V4 API documentation states: *"Between two user messages, if the model did not perform a tool call, the intermediate assistant's reasoning_content does not need to participate in the context concatenation. If passed to the API in subsequent turns, it will be ignored."* Sending `reasoning_content` for non-tool turns wastes input tokens (counted and billed) without any effect on model behavior. This saves 15-20% of input tokens in multi-turn sessions.

**Acceptance Criteria:**
- [ ] When `message.role === "assistant"` and `messageParams.tool_calls` is absent/null/empty-array, the built `ChatCompletionMessageParam` MUST NOT have a `reasoning_content` property.
- [ ] When `message.role === "assistant"` and `messageParams.tool_calls` is a non-empty array, the built `ChatCompletionMessageParam` MUST include `reasoning_content` (either the stored value or empty string `""`).
- [ ] When `thinkingEnabled === false`, behavior is unchanged — no `reasoning_content` field is ever added (existing behavior).
- [ ] All existing tests in `src/tests/openai-message-converter.test.ts` continue to pass.
- [ ] A new test verifies: assistant message with `tool_calls: [{...}]` includes `reasoning_content`.
- [ ] A new test verifies: assistant message without tool_calls omits `reasoning_content`.

---

### FR-002: Use deepseek-v4-flash without thinking for context compaction

**What:** In `SessionManager.compactSession()`, the API call that generates the compaction summary must use model `"deepseek-v4-flash"` with `thinkingEnabled = false`, regardless of what model and thinking mode the main session uses.

**Why:** Compaction summarization is a simple text-to-text task that does not benefit from thinking mode or a large model. Using the cheapest available model (flash without thinking) reduces compaction cost by ~90% per compaction event. The summary quality is sufficient for maintaining conversation context.

**Acceptance Criteria:**
- [ ] `compactSession()` calls `createChatCompletionStream` with `model: "deepseek-v4-flash"` and thinking disabled.
- [ ] No `temperature` parameter is sent (it is only set when thinking is disabled, but we want the default).
- [ ] The main session's model and thinking settings are NOT affected — they remain unchanged for the main conversation loop.
- [ ] The compaction response usage is still accumulated into the session's `usage` and `usagePerModel` records under model `"deepseek-v4-flash"`.
- [ ] All existing tests in `src/tests/session.test.ts` that test compaction continue to pass or are updated.

---

### FR-003: Replace LLM-based skill matching with heuristic keyword matching

**What:** Replace the `SessionManager.identifyMatchingSkillNames()` method (which makes an API call to the LLM to match skills to user prompts) with a deterministic, zero-cost heuristic method `matchSkillsByKeywords(skills: SkillInfo[], userPrompt: string): string[]`. Remove all 3 call sites of `identifyMatchingSkillNames` and replace them with calls to `matchSkillsByKeywords`. Delete the `identifyMatchingSkillNames` method entirely.

**Why:** `identifyMatchingSkillNames()` makes one additional LLM API call per user message, effectively doubling the API cost per user interaction. The task of matching skills to prompts is simple enough to be handled by keyword/heuristic matching with equivalent accuracy for the 3 built-in skills (karpathy-guidelines, plan-and-execute, agent-drift-guard) and any user-defined skills with descriptive frontmatter.

**Acceptance Criteria:**
- [ ] Method `identifyMatchingSkillNames` is removed from `SessionManager`.
- [ ] New private method `matchSkillsByKeywords(skills: SkillInfo[], userPrompt: string): string[]` exists.
- [ ] The heuristic uses: case-insensitive substring matching of each skill's `name` and `description` fields against the user prompt text.
- [ ] A match is triggered when the user prompt contains the skill name (with hyphens replaced by spaces and vice-versa as equivalent) OR any word from the skill description that is ≥5 characters long.
- [ ] Skill names matching is exact-substring (case-insensitive). For example: skill `"plan-and-execute"` matches prompts containing `"plan and execute"`, `"Plan-and-Execute"`, `"plan"` (but only if "plan" appears as part of the skill name "plan-and-execute").
- [ ] A skill matches if its `name` (with hyphens normalized to spaces) appears as a substring in the lowercase prompt. Additionally, a skill matches if at least ONE word from its `description` (words of length ≥5, case-insensitive, after stripping punctuation) appears as a substring in the lowercase prompt.
- [ ] The 3 call sites in `createSession()`, `replySession()`, and `appendDeferredPermissionPrompt()` are updated to use `matchSkillsByKeywords` instead of `identifyMatchingSkillNames`.
- [ ] The `AbortSignal` parameter is no longer needed for skill matching (no async API call), so the `{ signal }` options object is removed from the skill matching call.
- [ ] `matchSkillsByKeywords` returns `string[]` (skill names), not `Promise<string[]>` — it is synchronous.
- [ ] All existing tests related to skill matching continue to pass or are updated.

---

### FR-004: Remove tool documentation from system prompt

**What:** The system prompt currently includes verbose tool documentation read from `templates/tools/*.md` files via `readToolDocs()`. This is fully duplicated by the JSON function definitions sent in the `tools` parameter of the Chat Completion API. Remove the tool docs from the system prompt. The `getSystemPrompt()` function should return only `SYSTEM_PROMPT_BASE` without the `# Available Tools` section.

**Why:** The tool documentation in `templates/tools/` contains ~380 lines of text (380 lines across 9 files) that describes the same tools defined in the `getTools()` function's JSON schemas. The JSON schemas are sent to the API as the `tools` parameter and are the authoritative source the model uses. Including both is redundant and wastes ~4,600 tokens per request on overhead that provides no additional value.

**Acceptance Criteria:**
- [ ] `getSystemPrompt()` returns ONLY `SYSTEM_PROMPT_BASE` — the `# Available Tools` section and all tool docs are removed.
- [ ] `readToolDocs()` is either removed entirely or kept only if it has other callers (verify: it is only called from `getSystemPrompt`).
- [ ] The `templates/tools/` directory files remain on disk (they are documentation artifacts, not runtime dependencies), but are no longer read by the application.
- [ ] The system prompt cache in `SessionManager.systemPromptCache` continues to work — the cached prompt is just shorter.
- [ ] All existing tests that check system prompt content are updated to reflect the shorter prompt.

---

### FR-005: Compact built-in skill documents to essential rules

**What:** Reduce the 3 built-in skill Markdown files in `templates/skills/` to compact versions containing only their essential behavioral rules. Target: each skill document must be ≤30 lines (excluding YAML frontmatter), down from the current 70-247 lines.

**Why:** The built-in skills are injected into EVERY session's system messages, consuming ~6,000 tokens of overhead. The current documents contain extensive examples, verbose explanations, and tutorial-style content that the model does not need on every request. The essential rules can be expressed much more compactly.

**Acceptance Criteria:**
- [ ] `templates/skills/karpathy-guidelines.md`: reduced to ≤30 lines of rules (excluding YAML frontmatter). Must retain: the 4 numbered guidelines (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution) with 1-2 bullet points each. Remove: tradeoff discussion, detailed examples, internal-use note, "The test:" elaboration.
- [ ] `templates/skills/plan-and-execute.md`: reduced to ≤30 lines of rules (excluding YAML frontmatter). Must retain: the 5-step workflow with 1-line description each, the task state symbols (`[ ] [>] [x] [!]`), the "When to Use" and "When NOT to Use" as 1-2 line lists. Remove: all examples (Example 1, Example 2), Advanced Usage section, Best Practices section, Quick Start duplication, Step 4 sub-task handling details, workflow summary.
- [ ] `templates/skills/agent-drift-guard.md`: reduced to ≤30 lines of rules (excluding YAML frontmatter). Must retain: the self-check loop (4 items), the 4 drift signal categories as keywords, the severity levels with 1-line descriptions, the 5 decision rules, and anti-patterns as a compact list. Remove: detailed examples for each severity level, "Good Intervention Style" section with example dialogue, "Final Check Before Responding" section.
- [ ] All 3 files retain their YAML frontmatter (`name`, `description`, `license` where present) unchanged.
- [ ] The skill loading mechanism in `SessionManager.buildSkillPrompt()` and `getDefaultSkillPrompt()` works without modification — only the file contents change.

---

### FR-006: Remove legacy webSearchTool external script fallback

**What:** Remove the external script fallback path from `src/tools/web-search-handler.ts`. Delete the functions `executeConfiguredWebSearch()` and `runWebSearchScript()`. Remove the `webSearchTool` configuration option from settings. The web search handler must only support the native DeepSeek `web_search` tool type path (`executeNativeWebSearch`).

**Why:** The external script fallback exists only for engines that do not support native web search (pre-V4 models). Since the minimum supported engines are now DeepSeek V4 and GPT 5.4, both of which support native web search, the external script path is dead code. Removing ~100 lines simplifies the codebase per KISS principle and removes the `webSearchTool` configuration surface.

**Acceptance Criteria:**
- [ ] `executeConfiguredWebSearch()` function is deleted from `src/tools/web-search-handler.ts`.
- [ ] `runWebSearchScript()` function is deleted from `src/tools/web-search-handler.ts`.
- [ ] `appendChunk()` helper is deleted (only used by `runWebSearchScript`).
- [ ] `formatWebSearchActivityLabel()` helper is deleted (only used by `runWebSearchScript`).
- [ ] `buildCommandError()` helper is deleted (only used by `executeConfiguredWebSearch`).
- [ ] The `import { spawn } from "child_process"` is removed if no longer needed.
- [ ] `handleWebSearchTool()` calls `executeNativeWebSearch()` directly without branching on `supportsWebSearch()`. If the LLM client is unavailable, it returns the same error as before (`"WebSearch is not configured..."` is replaced with a simpler error about API unavailability).
- [ ] `webSearchTool` field is removed from `src/settings.ts` type `DeepcodingSettings` and `ResolvedDeepcodingSettings`.
- [ ] `webSearchTool` field is removed from `src/common/settings-schema.ts` Zod schema.
- [ ] `webSearchTool` field is removed from `src/common/openai-client.ts` createOpenAIClient return type and all return statements.
- [ ] `webSearchTool` field is removed from `src/tools/executor.ts` `ToolExecutionContext` type.
- [ ] `webSearchTool` field is removed from `src/session.ts` `SessionManagerOptions.getResolvedSettings` return type and the private `getResolvedSettings` type.
- [ ] `webSearchTool` resolution code in `src/settings.ts` `resolveSettingsSources()` is removed.
- [ ] All existing tests in `src/tests/web-search-handler.test.ts` and `src/tests/web-search.test.ts` continue to pass or are updated.
- [ ] All existing tests in `src/tests/settings-and-notify.test.ts` related to webSearchTool are updated or removed.

---

### FR-007: Simplify model capability checks for V4+ only

**What:** Since all supported models are now DeepSeek V4 or later (or GPT 5.4+), simplify or remove model-gating functions that check for capabilities that are now universal.

**Why:** The code contains multiple conditional branches guarded by `DEEPSEEK_V4_MODELS.has(model)` and similar checks. When all models are V4+, these checks are always true and add unnecessary branching complexity. Simplifying removes dead branches and makes the code more maintainable.

**Acceptance Criteria:**
- [ ] In `src/common/model-capabilities.ts`:
  - `DEEPSEEK_V4_MODELS` set is kept (it still documents which models are V4) but its usage sites are simplified.
  - `NON_MULTIMODAL_MODELS` set is removed.
  - `supportsMultimodal()` is removed.
  - `supportsWebSearch()` is removed.
  - `defaultsToThinkingMode()` always returns `true` (inline the constant).
- [ ] In `src/prompt.ts`:
  - Import of `supportsMultimodal` is removed.
  - `readToolDocs()` (if kept) no longer passes `supportsMultimodal` to EJS templates — the EJS templates are simplified.
  - The EJS conditional `{ supportsMultimodal: supportsMultimodal(options.model ?? "") }` in `readToolDocs` is removed. The `.ejs` templates no longer use this variable.
- [ ] In `src/common/openai-message-converter.ts`:
  - Import of `supportsMultimodal` is removed.
  - Line 143: `if (part && (part.type !== "image_url" || supportsMultimodal(model)))` becomes `if (part && part.type !== "image_url")` — all models are multimodal now, image_url parts are always included.
- [ ] In `src/session.ts`:
  - Import of `DEEPSEEK_V4_MODELS` is removed.
  - `getCompactPromptTokenThreshold()` returns `DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD` unconditionally.
  - (The `MAX_SESSION_ENTRIES` and other constants are unchanged — they are unrelated to V4.)
- [ ] In `src/settings.ts`:
  - Import of `DEEPSEEK_V4_MODELS` is removed.
  - `maxTokens` default: `model === "deepseek-v4-pro" ? 65536 : 32768` (hardcode the two model names; remove the `DEEPSEEK_V4_MODELS.has(model)` check since all non-pro are flash).
- [ ] In `src/common/api-timeout.ts`:
  - Import of `DEEPSEEK_V4_MODELS` is removed.
  - The `if (DEEPSEEK_V4_MODELS.has(model))` block is removed — the model-specific checks for `deepseek-v4-pro` and `deepseek-v4-flash` already cover all cases. The only path after those checks is `return DEFAULT_API_TIMEOUT_MS`, which becomes the fallback for any unknown model.
- [ ] In `src/tools/web-search-handler.ts`:
  - Import of `supportsWebSearch` is removed.
  - Line 25: `if (llmContext?.client && supportsWebSearch(llmContext.model))` becomes `if (llmContext?.client)` — all supported models support web search.
- [ ] All existing tests pass without modification (the behavior is identical; only dead branches are removed).

---

### FR-008: Remove EJS template conditional for supportsMultimodal

**What:** Remove the `supportsMultimodal` variable injection from `readToolDocs()` in `prompt.ts`. If any `.ejs` template files reference this variable, remove the conditional block from those templates.

**Why:** With all models supporting multimodal (FR-007), the conditional is always true. Removing it eliminates template branching complexity.

**Acceptance Criteria:**
- [ ] `readToolDocs()` no longer passes `{ supportsMultimodal: ... }` to `ejs.render()`.
- [ ] Any `.ejs` files in `templates/tools/` that contain EJS conditional blocks referencing `supportsMultimodal` are simplified to remove the conditional (always-true branch is kept).
- [ ] If `readToolDocs()` is removed entirely (FR-004), this requirement is satisfied implicitly.

---

## Non-Functional Requirements

### NFR-001: No regression in test suite

**What:** All existing tests must pass after all changes. Modified tests must still validate equivalent behavior.

**Acceptance Criteria:**
- [ ] `npm test` exits with code 0.
- [ ] `npm run check` exits with code 0 (typecheck + lint + format).

### NFR-002: No change to user-visible behavior

**What:** The user must observe no difference in assistant response quality, tool call accuracy, skill loading behavior, or session management. The only observable change is reduced API costs.

**Acceptance Criteria:**
- [ ] Slash commands (`/model`, `/new`, `/init`, `/resume`, `/continue`, `/mcp`, `/exit`, `/skill-*`) function identically.
- [ ] File mentions (`@`), image paste (`Ctrl+V`), and process stdout view (`Ctrl+O`) function identically.
- [ ] Permission prompts appear and function identically.
- [ ] Session list, undo, and restore function identically.
- [ ] MCP tools are registered and function identically.

### NFR-003: No increase in code complexity

**What:** The changes must reduce or maintain cyclomatic complexity. No new abstractions, patterns, or indirection layers are introduced.

**Acceptance Criteria:**
- [ ] Net line count decreases (more lines removed than added).
- [ ] No new classes, interfaces, or type abstractions are introduced.
- [ ] All changes are surgical edits to existing files per `karpathy-guidelines` skill.

---

## Constraints

1. **TypeScript strict mode** — all code must compile without errors under `tsc --noEmit`.
2. **ESLint** — all code must pass `npm run lint` without warnings.
3. **Prettier** — all code must pass `npm run format:check`.
4. **Node.js 22+** — no APIs that require newer runtimes.
5. **No new npm dependencies** — no additional packages may be installed.
6. **Existing architecture** — follow the layered architecture in arch.md: Session layer for session/skill logic, Common layer for model capabilities and client, Tools layer for tool handlers.
7. **ADR-003** — OpenAI-compatible API client with singleton pattern must be preserved.
8. **ADR-004** — EJS templates for slash command prompts must be preserved (only `templates/tools/` EJS usage is affected, not `templates/prompts/`).

---

## Edge Cases & Error States

| Scenario | Expected Behavior |
|---|---|
| User prompt has zero text (image-only prompt) | `matchSkillsByKeywords` receives empty string, returns empty array `[]`. No skills are matched. |
| User prompt matches multiple skills by keyword overlap | All matching skill names are returned. Deduplication happens at the call site (existing `normalizeSkills` logic). |
| No skills are installed (skills array is empty) | `matchSkillsByKeywords` receives empty array, returns `[]`. No API call is made (existing behavior already skipped when `simpleSkills.length === 0`). |
| Compaction threshold reached while using deepseek-v4-flash main model | Compaction still uses `deepseek-v4-flash` without thinking. No conflict. |
| Compaction response is empty or malformed JSON | Existing fallback returns `llmResponse.trim()` directly as the summary (unchanged behavior in `compactSession`). |
| User prompt matches a skill that is already loaded | Call site checks `skill.isLoaded` before appending (existing logic unchanged). |
| Assistant message has both tool_calls and reasoning_content | reasoning_content IS included (only omitted when NO tool calls). |
| Assistant message has tool_calls but empty reasoning_content | reasoning_content is set to `""` (existing behavior for thinking mode). |
| Model is GPT 5.4 (not DeepSeek) and message has no tool calls | reasoning_content is still omitted. The DeepSeek docs describe the behavior, but omitting it is harmless for other models (they would ignore it anyway). |
| A non-DeepSeek-V4, non-GPT-5.4 model is configured (e.g., user modifies settings.json directly) | `getCompactPromptTokenThreshold` returns 384K instead of the old 128K fallback — this is acceptable since the model list is intentionally restricted. `defaultsToThinkingMode` returns `true` — non-thinking models may error, which is expected when using unsupported engines. `supportsMultimodal` and `supportsWebSearch` checks have been removed — image and web search features will be attempted unconditionally, which may cause API errors on unsupported models. This is by design: the minimum supported engine set is enforced by documentation, not runtime guards. |

---

## Dependencies

- **Specs:** None (this is the first spec; no dependencies on other specs).
- **External:** DeepSeek V4 API (already integrated), OpenAI-compatible API (already integrated).
- **Libraries:** openai (npm), ejs (npm), gray-matter (npm) — all already in package.json.
- **ADR:** ADR-003 (OpenAI-compatible API), ADR-004 (EJS templates).

---

## Out of Scope

- **Reasoning effort auto-downgrade (max→high):** The `RuntimeReasoningEffortManager.evaluateDowngrade()` method remains disabled. This is a separate decision to be made later.
- **Removing `webSearchTool` from user-facing documentation:** Only code changes are in scope.
- **Adding new models beyond V4 and GPT 5.4:** The simplification targets the current supported set; future models are handled when they arrive.
- **Changing compaction threshold values:** Threshold is simplified to a single value (384K for all engines), which is consistent with the minimum supported engine set (DeepSeek V4+ and GPT 5.4+ both have ≥1M context windows). The old per-engine gating logic is removed as part of FR-007.
- **Modifying MCP integration:** MCP tool definitions, registration, and status display are untouched.
- **Modifying the permission system:** Permission scopes, decisions, and prompts are untouched.
- **Modifying telemetry:** The telemetry module is untouched.
- **Modifying notify/desktop notifications:** The notify module is untouched.
