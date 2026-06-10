# Spec 10: more-effectiveness-and-economy — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

---

## Tasks

### Task 1: Compact built-in skill documents

**Objective:** Replace the 3 built-in skill Markdown files with compact versions (≤30 lines of rules each, excluding YAML frontmatter). This reduces system prompt overhead by ~4,000 tokens per session.

**Requirements Covered:** FR-005

**Design References:** Component 5 in design.md — exact new content for each file is specified verbatim.

**Actions:**
1. Overwrite `templates/skills/karpathy-guidelines.md` with the compact content from design.md Component 5.
2. Overwrite `templates/skills/plan-and-execute.md` with the compact content from design.md Component 5.
3. Overwrite `templates/skills/agent-drift-guard.md` with the compact content from design.md Component 5.

**Validation:**
- [ ] Each file has ≤30 lines of body content (after YAML frontmatter `---`).
- [ ] YAML frontmatter (name, description, license) is unchanged.
- [ ] `npm run check` passes.

**Status:** [x] done

---

### Task 2: Remove tool documentation from system prompt

**Objective:** Remove `readToolDocs()` function and its callers from the system prompt, so the system prompt is just `SYSTEM_PROMPT_BASE`. Remove dead imports (`ejs`, `supportsMultimodal`) from `prompt.ts`.

**Requirements Covered:** FR-004, FR-008

**Design References:** Component 4 and Component 6c in design.md.

**Actions:**
1. In `src/prompt.ts`, remove the `readToolDocs` function (lines 128-153).
2. In `src/prompt.ts`, modify `getSystemPrompt` to return only `SYSTEM_PROMPT_BASE`.
3. In `src/prompt.ts`, remove `import ejs from "ejs"` (line 5).
4. In `src/prompt.ts`, remove `import { supportsMultimodal } from "./common/model-capabilities"` (line 9).
5. Verify `ejs` is still imported in `src/session.ts` (it is, line 6) — no change needed there.
6. Run `npm run typecheck` to verify no broken imports.

**Validation:**
- [ ] `getSystemPrompt()` returns exactly `SYSTEM_PROMPT_BASE` with no tool docs appended.
- [ ] No references to `readToolDocs` remain in the codebase.
- [ ] `npm run check` passes.

**Status:** [x] done

---

### Task 3: Simplify model capability checks for V4+ only

**Objective:** Remove `NON_MULTIMODAL_MODELS`, `supportsMultimodal()`, and `supportsWebSearch()` from `model-capabilities.ts`. Simplify all call sites across 7 files.

**Requirements Covered:** FR-007

**Design References:** Component 6b, 6c, 6d, 6e, 6f, 6j in design.md.

**Actions:**
1. **`src/common/openai-message-converter.ts`:** Remove `import { supportsMultimodal }` (line 2). Change line 143 from `if (part && (part.type !== "image_url" || supportsMultimodal(model)))` to `if (part && part.type !== "image_url")`.
2. **`src/session.ts`:** Remove `import { DEEPSEEK_V4_MODELS }` (line 10). In `getCompactPromptTokenThreshold` (lines 80-84), return `DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD` unconditionally.
3. **`src/settings.ts`:** Change `import { defaultsToThinkingMode, DEEPSEEK_V4_MODELS }` to `import { defaultsToThinkingMode }`. In `resolveSettingsSources`, change `maxTokens` default from `(model === "deepseek-v4-pro" ? 65536 : DEEPSEEK_V4_MODELS.has(model) ? 32768 : 0)` to `(model === "deepseek-v4-pro" ? 65536 : 32768)`.
4. **`src/common/api-timeout.ts`:** Remove `import { DEEPSEEK_V4_MODELS }` (line 1). Remove the `if (DEEPSEEK_V4_MODELS.has(model))` block (lines 46-48) — the explicit checks for `deepseek-v4-pro` and `deepseek-v4-flash` already handle V4 models.
5. **`src/tools/web-search-handler.ts`:** Remove `import { supportsWebSearch }` (line 3). Change line 25 from `if (llmContext?.client && supportsWebSearch(llmContext.model))` to `if (llmContext?.client)`.
6. **`src/common/model-capabilities.ts`:** Remove `NON_MULTIMODAL_MODELS` (line 3), `supportsMultimodal` (lines 9-11), `supportsWebSearch` (lines 13-15). Simplify `defaultsToThinkingMode` to `return true`. Keep `DEEPSEEK_V4_MODELS`.
7. **`src/prompt.ts`:** Already handled in Task 2 (import removed).
8. Run `npm run typecheck` to verify no TypeScript errors.

IMPORTANT: Steps 1-5 remove all IMPORTS of the functions being deleted. Step 6 removes the EXPORTS from model-capabilities.ts. This order prevents transient compile errors (importing a non-existent export).

**Validation:**
- [ ] `npm run typecheck` passes — no TypeScript errors.
- [ ] `npm run check` passes.
- [ ] No imports of `NON_MULTIMODAL_MODELS`, `supportsMultimodal`, or `supportsWebSearch` remain.
- [ ] `DEEPSEEK_V4_MODELS` import removed from `session.ts`, `settings.ts`, `api-timeout.ts`.

**Status:** [x] done

---

### Task 4: Omit reasoning_content for non-tool-call assistant turns

**Objective:** Modify `convertMessage()` in `OpenAIMessageConverter` to only include `reasoning_content` when the assistant message has tool calls.

**Requirements Covered:** FR-001

**Design References:** Component 1 in design.md — exact code replacement specified.

**Actions:**
1. Open `src/common/openai-message-converter.ts`.
2. Replace lines 127-133 (the reasoning_content block) with the new logic from design.md Component 1.
3. Add two tests to `src/tests/openai-message-converter.test.ts`:
   - Test: assistant with tool_calls → reasoning_content is present.
   - Test: assistant without tool_calls → reasoning_content is absent.
4. Run `npm test` to verify existing tests still pass.

**Validation:**
- [ ] `src/tests/openai-message-converter.test.ts` — all existing tests pass + 2 new tests pass.
- [ ] `npm test` passes.
- [ ] `npm run check` passes.

**Status:** [x] done

---

### Task 5: Use deepseek-v4-flash without thinking for compaction

**Objective:** Modify `compactSession()` to use model `"deepseek-v4-flash"` with no thinking options for the compaction API call.

**Requirements Covered:** FR-002

**Design References:** Component 2 in design.md.

**Actions:**
1. Open `src/session.ts`, locate method `compactSession` (line ~1563).
2. Change destructuring to extract only `client`, `baseURL`, and `debugLogEnabled` from `this.createOpenAIClient()`.
3. Hardcode `const compactionModel = "deepseek-v4-flash"`.
4. Remove `buildThinkingRequestOptions` call and the spread of `thinkingOptions` into the request.
5. Remove the temperature spread (thinking is off, so temperature is not sent).
6. Pass `compactionModel` as the model in the `createChatCompletionStream` call.
7. Update the debug params object to use `{ compactionModel }` instead of `{ temperature, thinkingEnabled, reasoningEffort }`.
8. Add a test to `src/tests/session.test.ts` verifying compaction uses flash model (mock verification).
9. Run `npm test`.

**Validation:**
- [ ] Compaction uses model `"deepseek-v4-flash"`.
- [ ] No thinking options are passed in the compaction request.
- [ ] `src/tests/session.test.ts` — all existing tests + new test pass.
- [ ] `npm run check` passes.

**Status:** [x] done

---

### Task 6: Replace LLM-based skill matching with heuristic

**Objective:** Delete `identifyMatchingSkillNames()` method and replace all 3 call sites with the new synchronous `matchSkillsByKeywords()` method.

**Requirements Covered:** FR-003

**Design References:** Component 3 in design.md — exact method implementation and call site changes specified.

**Actions:**
1. Open `src/session.ts`.
2. Add new private method `matchSkillsByKeywords(skills: SkillInfo[], userPrompt: string): string[]` — exact implementation from design.md Component 3. Place it immediately after the existing `identifyMatchingSkillNames` method (which will be deleted next).
3. In `createSession()` (line ~1156), replace `const skillNames = await this.identifyMatchingSkillNames(...)` with `const skillNames = this.matchSkillsByKeywords(skills, userPrompt.text ?? "")`. Remove the `this.throwIfAborted(signal)` that follows (it was needed for the async call).
4. In `replySession()` (line ~1232), same replacement.
5. In `appendDeferredPermissionPrompt()` (line ~2524), same replacement.
6. Delete the `identifyMatchingSkillNames` method entirely (lines 758-838).
7. Add 4 tests to `src/tests/session.test.ts` (from design.md Testing Strategy section 2).
8. Run `npm test`.

**Validation:**
- [ ] `npm run typecheck` passes — no reference to `identifyMatchingSkillNames`.
- [ ] 4 new tests in `src/tests/session.test.ts` pass.
- [ ] `npm test` passes (including heavy suite if relevant).
- [ ] `npm run check` passes.

**Status:** [x] done

---

### Task 7: Remove legacy webSearchTool external script fallback

**Objective:** Delete `executeConfiguredWebSearch`, `runWebSearchScript`, and related helpers from `web-search-handler.ts`. Simplify `handleWebSearchTool` to only use native web search. Remove `webSearchTool` from settings and types.

**Requirements Covered:** FR-006

**Design References:** Component 6a, 6f, 6g, 6h, 6i in design.md.

**Actions:**
1. **`src/tools/web-search-handler.ts`:**
   - Delete functions: `executeConfiguredWebSearch`, `runWebSearchScript`, `appendChunk`, `formatWebSearchActivityLabel`, `buildCommandError`.
   - Delete import: `import { spawn } from "child_process"`.
   - Delete constant `MAX_CAPTURE_CHARS` and `WEB_SEARCH_TOOL_ACTIVITY_PREFIX`.
   - Rewrite `handleWebSearchTool` as specified in design.md Component 6a.
2. **`src/settings.ts`:**
   - Remove `webSearchTool` from `DeepcodingSettings` type (line 59).
   - Remove `webSearchTool` from `ResolvedDeepcodingSettings` type (line 76).
   - Remove `webSearchTool` resolution block (lines 371-375) and return object assignment (line 389).
3. **`src/common/settings-schema.ts`:**
   - Remove `webSearchTool: z.string().optional()` (line 48).
4. **`src/common/openai-client.ts`:**
   - Remove `webSearchTool?: string` from return type (line 34) and all 3 return statements (lines 50, 68, 105).
5. **`src/tools/executor.ts`:**
   - Remove `webSearchTool?: string` from `ToolExecutionContext` type (line 26).
6. **`src/session.ts`:**
   - Remove `webSearchTool?: string` from `getResolvedSettings` return type in `SessionManagerOptions` (line 296) and private `getResolvedSettings` (line 322).
7. Update tests:
   - `src/tests/web-search-handler.test.ts`: Remove external script tests. Update mocks.
   - `src/tests/web-search.test.ts`: Update `makeContext` to not use `webSearchTool`. Remove/update configuration error test.
   - `src/tests/settings-and-notify.test.ts`: Remove `webSearchTool` assertions.

**Validation:**
- [ ] `npm run typecheck` passes — no `webSearchTool` references remain.
- [ ] `npm test` passes.
- [ ] `npm run check` passes.
- [ ] All webSearchTool-related tests updated or removed.

**Status:** [x] done

---

### Task 8: Run final validation suite

**Objective:** Verify the complete set of changes passes all quality gates.

**Requirements Covered:** NFR-001, NFR-002, NFR-003

**Design References:** Testing Strategy section in design.md.

**Actions:**
1. Run `npm run check` — must pass (typecheck + lint + format).
2. Run `npm test` — must pass (fast suite + heavy suite).
3. Run `npm run build` — must produce `dist/cli.js` without errors.
4. Review `git diff` — verify net negative line count (more lines removed than added).
5. Verify no new files were created beyond spec documents.

**Validation:**
- [ ] `npm run check` exit code 0.
- [ ] `npm test` exit code 0.
- [ ] `npm run build` exit code 0.
- [ ] `git diff --stat` shows net negative line count.
- [ ] Only files in the design.md "File / Module Layout" section were modified.

**Status:** [x] done

---

### Task 9: Update roadmap status to implemented

**Objective:** Update the roadmap entry for spec #10 from `planned` to `created` (or keep at `verified` if already verified).

**Requirements Covered:** Process requirement from /spec-new instructions.

**Actions:**
1. Open `.dscode/specs/roadmap.md`.
2. If status is `planned`, change to `created`.
3. If status is already `created` or `verified`, leave unchanged.

**Validation:**
- [ ] Roadmap shows status `created` or `verified` for spec #10.

**Status:** [x] done
