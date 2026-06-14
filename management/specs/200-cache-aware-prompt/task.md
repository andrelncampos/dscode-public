# Spec 200: Cache-Aware Prompt — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

## Tasks

### Task 1: Add cacheMode Setting Types and Resolution

**Objective:** Extend `DeepcodingSettings` and `ResolvedDeepcodingSettings` with the `cacheMode` field. Add `resolveCacheMode()` to parse and validate the raw setting value.

**Requirements Covered:** FR-005

**Design References:** Component 1 (cacheMode Resolution), ADR-200-001

**Actions:**
1. Open `src/settings.ts`.
2. Add `cacheMode?: "off" | "aware" | "strict"` to `DeepcodingSettings` type (after `thinkingBudgets` field, around line 93).
3. Add `cacheMode: "off" | "aware" | "strict"` to `ResolvedDeepcodingSettings` type (after `thinkingBudgets` field, around line 117).
4. Add `import { debugLog } from "./common/debug-log"` at top if not already imported.
5. Add `resolveCacheMode(raw: unknown): "off" | "aware" | "strict"` function (see Component 1 for exact implementation).
6. In the settings resolution function (where `ResolvedDeepcodingSettings` is constructed), add `cacheMode: resolveCacheMode(raw.cacheMode)`.
7. Default value when absent: `"off"`.

**Validation:**
- `tsc --noEmit` passes with zero errors.
- No changes to existing settings resolution behavior (all existing tests pass).

**Status:** [ ] pending

---

### Task 2: Add resolveModelToProvider to ResolvedDeepcodingSettings

**Objective:** Expose the resolved provider name in `ResolvedDeepcodingSettings` so the multi-provider guard can check it. The provider name is resolved from the active model via `resolveModelToProvider()`.

**Requirements Covered:** FR-008 (infrastructure for multi-provider guard)

**Design References:** Component 6 (Multi-Provider Guard), ADR-200-003

**Actions:**
1. Open `src/settings.ts`.
2. Add `import { resolveModelToProvider } from "./common/llm-provider-registry"` at top.
3. Add `providerName: string` to `ResolvedDeepcodingSettings` type.
4. In the settings resolution function, add `providerName: resolveModelToProvider(resolvedModel, engines)` after model resolution.
5. Open `src/common/llm-provider-registry.ts`. Verify `resolveModelToProvider()` exists and returns `"deepseek"` for DeepSeek models.

**Validation:**
- `tsc --noEmit` passes.
- `getResolvedSettings()` returns `providerName: "deepseek"` for model `"deepseek-v4-pro"`.
- Quick test: `console.log(getResolvedSettings().providerName)` outputs `"deepseek"`.

**Status:** [ ] pending

---

### Task 3: Annotate Tool Doc Sort + Add Skill Sort

**Objective:** Add deterministic ordering guarantee to `readToolDocs()` (annotation only — sort already exists) and `buildSkillDocumentsPrompt()` (add alphabetical sort).

**Requirements Covered:** FR-002, FR-003

**Design References:** Component 2 (Deterministic Tool Document Ordering), Component 3 (Deterministic Skill Document Ordering)

**Actions:**
1. Open `src/prompt.ts`.
2. Find `readToolDocs()` function (around line 251). Locate the `.sort()` call on entries (around line 259). Add a comment above it: `// Deterministic sort — preserves DeepSeek KV cache prefix across turns. Must not be removed.`
3. Find `buildSkillDocumentsPrompt()` function (around line 161). Replace the body with sorted version:
   ```typescript
   export function buildSkillDocumentsPrompt(skills: SkillPromptDocument[]): string {
     // Deterministic sort — preserves DeepSeek KV cache prefix across turns
     const sorted = [...skills].sort((a, b) =>
       a.name.toLowerCase().localeCompare(b.name.toLowerCase())
     );
     const blocks = sorted.map((skill) => renderSkillDocumentBlock(skill));
     return `Use the skill documents below to assist the user:\n${blocks.join("\n\n")}`;
   }
   ```
4. The `[...skills]` shallow copy preserves the caller's array (FR-003 AC: "do not mutate caller's array").

**Validation:**
- `tsc --noEmit` passes.
- Existing tests pass (no behavior change for single-skill or already-sorted inputs).

**Status:** [ ] pending

---

### Task 4: Add Stable Prefix Builder + Hash Functions

**Objective:** Add `getStablePrefixContent()` and `getStablePrefixHash()` to `src/prompt.ts`.

**Requirements Covered:** FR-004, FR-009

**Design References:** Component 4 (Stable Prefix Builder), Component 5 (Prefix Hash)

**Actions:**
1. Open `src/prompt.ts`.
2. Add `import { createHash } from "node:crypto"` at top.
3. Add `StablePrefixArgs` type (see Design → Data Structures).
4. Add `getStablePrefixContent(args: StablePrefixArgs): string` function:
   - Start with `SYSTEM_PROMPT_BASE` (model name was never part of `getSystemPrompt()` — it's in `getRuntimeContext()`).
   - Append tool docs, skill prompt, agent instructions.
   - Join with `"\n\n"`.
   - Both aware and strict modes produce identical output — the difference is the hash verification guarantee.
5. Add `getStablePrefixHash(content: string): string` function:
   - `return createHash("sha256").update(content, "utf8").digest("hex")`
6. Export both functions.

**Validation:**
- `tsc --noEmit` passes.
- `getStablePrefixHash("hello")` returns a 64-character hex string.
- `getStablePrefixHash("hello") === getStablePrefixHash("hello")` (idempotent).
- `getStablePrefixHash("hello") !== getStablePrefixHash("world")` (different inputs → different hashes).

**Status:** [ ] pending

---

### Task 5: Add getEffectiveCacheMode Multi-Provider Guard

**Objective:** Add `getEffectiveCacheMode()` that returns `"off"` when the provider is not DeepSeek.

**Requirements Covered:** FR-008

**Design References:** Component 6 (Multi-Provider Guard)

**Actions:**
1. Open `src/settings.ts`.
2. Add `getEffectiveCacheMode(cacheMode: "off" | "aware" | "strict", providerName: string): "off" | "aware" | "strict"` function:
   - If `cacheMode === "off"` → return `"off"`.
   - If `providerName !== "deepseek"` → `debugLog("[cache-aware] cacheMode %o suppressed — provider %o is not DeepSeek", cacheMode, providerName)` → return `"off"`.
   - Otherwise return `cacheMode`.
3. Export the function.

**Validation:**
- `tsc --noEmit` passes.
- `getEffectiveCacheMode("aware", "deepseek") === "aware"`.
- `getEffectiveCacheMode("strict", "openai") === "off"`.
- `getEffectiveCacheMode("off", "deepseek") === "off"`.

**Status:** [ ] pending

---

### Task 6: Add cacheMode to PromptToolOptions + Session Integration Prep

**Objective:** Add `cacheMode` field to `PromptToolOptions` type and update `getPromptToolOptions()` to pass it through. This enables `createSession()` to access the resolved cache mode without separate settings lookups.

**Requirements Covered:** FR-006, FR-007 (infrastructure)

**Design References:** Component 7 (Cache Mode in Session Creation)

**Actions:**
1. Open `src/prompt.ts`.
2. Add `cacheMode?: "off" | "aware" | "strict"` to `PromptToolOptions` type (line ~100).
3. Open `src/session.ts`.
4. Find `getPromptToolOptions()` method (around line 2070).
5. Modify it to return `cacheMode`:
   ```typescript
   private getPromptToolOptions(): {
     model: string;
     webSearchEnabled: boolean;
     cacheMode: "off" | "aware" | "strict";
   } {
     const settings = this.getResolvedSettings();
     return {
       model: settings.model,
       webSearchEnabled: true,
       cacheMode: settings.cacheMode,
     };
   }
   ```
   Note: `model` is ALWAYS the actual model — never suppressed. The model name line lives in `getRuntimeContext()` (dynamic tail), not `getSystemPrompt()`.

**Validation:**
- `tsc --noEmit` passes.
- All existing tests still pass.
- `getPromptToolOptions().cacheMode` returns the resolved cache mode value.

**Status:** [ ] pending

---

### Task 7: Integrate Cache Mode into createSession()

**Objective:** Modify `createSession()` to resolve effective cache mode, assemble system messages accordingly, and log prefix hash.

**Requirements Covered:** FR-001, FR-004, FR-006, FR-007, FR-008, FR-009

**Design References:** Component 7 (Cache Mode in Session Creation), Data Flows 1-3

**Actions:**
1. Open `src/session.ts`.
2. Add imports at top:
   ```typescript
   import { getEffectiveCacheMode } from "./settings";
   import { getStablePrefixContent, getStablePrefixHash } from "./prompt";
   import { debugLog } from "./common/debug-log";
   ```
   (Import what isn't already imported — check existing imports.)
3. Find `createSession()` method (the private one starting around line 1000).
4. After `const promptToolOptions = this.getPromptToolOptions()` (line ~1053), add:
   ```typescript
   const settings = this.getResolvedSettings();
   const effectiveCacheMode = getEffectiveCacheMode(settings.cacheMode, settings.providerName);
   ```
5. The system prompt cache key remains `"${promptToolOptions.model}"` — cache mode does not affect `getSystemPrompt()` output.
6. After the memory context is appended (line ~1086), add prefix hash logging:
   ```typescript
   if (effectiveCacheMode !== "off") {
     const stablePrefix = getStablePrefixContent({
       extensionRoot: getExtensionRoot(),
       promptToolOptions,
       agentInstructions,
       skillPrompt: defaultSkillPrompt,
       cacheMode: effectiveCacheMode,
     });
     const hash = getStablePrefixHash(stablePrefix);
     debugLog("[cache-aware] Stable prefix hash: %s (mode: %o)", hash, effectiveCacheMode);
   }
   ```
7. In `reloadAgentInstructions()` (around line 2753), add the same hash logging after the new agent instructions message is appended.

**Validation:**
- `tsc --noEmit` passes.
- All existing session tests pass with zero modifications.

**Status:** [ ] pending

---

### Task 8: Update Budget Markdown with Cache Columns

**Objective:** Modify `buildBudgetMarkdown()` and `parseBudgetFile()` to write/read 3-column format with cache data.

**Requirements Covered:** FR-010

**Design References:** Component 8 (Budget Cache Columns)

**Actions:**
1. Open `src/common/budget-tracker.ts`.
2. Rewrite `buildBudgetMarkdown()` to output 3-column format (see Component 8 for exact code):
   - Headers: `| Data | Custo (USD) | Cache Saved (USD) | Cache Hit % |`
   - Row: `| ${date} | ${formatCost(cost)} | ${formatCost(cacheSaved)} | ${hitRate}% |`
   - Total row: `| **Total** | **${totalCost}** | **${totalCacheSaved}** | **${totalHitRate}%** |`
3. Rewrite `parseBudgetFile()` to handle both formats (see Component 8 for exact code):
   - Try 3-column match first: `/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)%\s*\|/`
   - Fall back to 2-column legacy match.
4. Cache token counts (`cacheHitTokens`, `cacheMissTokens`) are set to 0 on parse — not recoverable from hit rate alone.
5. Cache savings (`cacheSaved`) is parsed from the dollar column.

**Validation:**
- `tsc --noEmit` passes.
- Existing budget tracker tests pass (they use `getBudgetCosts()` which reads via `parseBudgetFile()`).
- A budget round-trip test (write with cache → read → values match) added in Task 9.

**Status:** [ ] pending

---

### Task 9: Create Unit Tests

**Objective:** Create `src/tests/cache-aware-prompt.test.ts` with unit tests for all new functions. Add budget cache column tests to existing budget test file.

**Requirements Covered:** All FRs (verification)

**Design References:** Testing Strategy

**Actions:**
1. Create `src/tests/cache-aware-prompt.test.ts`.
2. Add test cases as specified in Testing Strategy (see design.md):
   - `resolveCacheMode` tests (valid, invalid, absent).
   - `getEffectiveCacheMode` tests (off, aware+deepseek, aware+openai, strict+deepseek, strict+anthropic).
   - `buildSkillDocumentsPrompt` tests (sort, case-insensitive sort, idempotent).
   - `readToolDocs` idempotent test.
   - `getStablePrefixContent` tests (aware mode, strict mode, idempotent strict).
   - `getStablePrefixHash` tests (same content, different content, 64 hex chars).
   - `getRuntimeContext` tests (includes model name, empty model).
3. Open `src/tests/budget-tracker.test.ts`. Add tests:
   - `buildBudgetMarkdown()` with cache data produces 3 columns.
   - `parseBudgetFile()` legacy 2-column format → cache defaults to 0.
   - `parseBudgetFile()` new 3-column format → cache values parsed.
   - Round-trip: write 3-column → read → cacheSaved matches.
4. Use `import { test } from "node:test"` and `import assert from "node:assert/strict"` (consistent with existing test patterns).

**Validation:**
- All new tests pass: `npx tsx --test src/tests/cache-aware-prompt.test.ts`
- All new budget tests pass: `npx tsx --test src/tests/budget-tracker.test.ts`

**Status:** [ ] pending

---

### Task 10: Run Full Test Suite — Zero Regressions

**Objective:** Verify that the entire test suite passes with zero regressions.

**Requirements Covered:** NFR-003 (Backward Compatibility), NFR-002 (Deterministic Output)

**Design References:** Testing Strategy (integration tests)

**Actions:**
1. Run `npm test`.
2. Verify all tests pass (173+ tests, zero failures, zero skipped).
3. Run `npx tsc --noEmit` — verify zero TypeScript errors.
4. Run `npm run lint` (ESLint) — verify zero errors, zero warnings.
5. If any existing test fails:
   - Diagnostic: identify if failure is caused by new behavior (expected) or unintended regression.
   - If regression: fix the implementation, not the test.
   - If expected behavior change: update the test to match new expectations (e.g., budget format changed from 2-column to 3-column).
6. Final checklist:
   - `npm test` → all pass
   - `npx tsc --noEmit` → 0 errors
   - `npm run lint` → 0 errors, 0 warnings

**Validation:**
- Zero regressions. All existing functionality preserved.
- New cache-aware behavior activates only when `cacheMode !== "off"`.

**Status:** [ ] pending
