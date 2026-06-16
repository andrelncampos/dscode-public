---
name: code-quality-cleanup
status: verified
references: V30
---

# Spec 270: Code Quality Cleanup — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. FR-005 is last because it has the most
callers and test imports to update. FR-002 is first (trivial comment change).

## Tasks

### Task 1: Fix Outdated `Note.id` JSDoc Comment (FR-002)

**Objective:** Update the comment on `Note.id` from "4 lowercase hex chars" to reflect sequential numeric IDs.

**Requirements Covered:** FR-002.
**Design References:** Change 2 in design.md.

**Actions:**
1. Open `src/ui/core/notes.ts`.
2. Change line 13 from `id: string; // 4 lowercase hex chars` to `id: string; // sequential numeric (1, 2, 3, ...)`.

**Validation:** `npx tsc --noEmit` passes (comment-only change).

**Status:** [x] done

---

### Task 2: Remove Unused `_skills` Parameter from `buildSlashCommands` (FR-001)

**Objective:** Remove the unused `_skills` parameter from `buildSlashCommands` and update its caller.

**Requirements Covered:** FR-001.
**Design References:** Change 1 in design.md.

**Actions:**
1. Open `src/ui/core/slash-commands.ts`.
2. Change line 265: `export function buildSlashCommands(_skills: SkillInfo[]): SlashCommandItem[]` → `export function buildSlashCommands(): SlashCommandItem[]`.
3. Remove the `SkillInfo` import from `slash-commands.ts` if it was only used by this parameter (check: `SkillInfo` is used in `buildHashCommands` — keep the import).
4. Open `src/ui/views/WelcomeScreen.tsx`.
5. Change line 116: `buildSlashCommands(skills)` → `buildSlashCommands()`.
6. Check if `skills` variable in `WelcomeScreen.tsx` is now unused. It is used by `buildHashCommands(skills)` at line 121 and `buildWelcomeTips(skills, t)` at line 52 — keep the import.
7. Open `src/tests/slash-commands.test.ts`.
8. Replace all 14 `buildSlashCommands(skills)` with `buildSlashCommands()`. Use replace_all with expected_occurrences=14.

**Validation:** `npx tsc --noEmit` passes. `node --import tsx --test src/tests/slash-commands.test.ts` — all tests pass.

**Status:** [x] done

---

### Task 3: Remove Redundant `normalizeCacheTokens` Call (FR-003)

**Objective:** Remove the explicit `normalizeCacheTokens` call that duplicates the one inside `recordBudgetCostWithCache`. Populate `lastCallCacheMetrics` from the already-normalized `responseUsage` fields.

**Requirements Covered:** FR-003.
**Design References:** Change 3 in design.md.

**Actions:**
1. Open `src/session.ts`.
2. Replace lines 1612-1618 (the `normalizeCacheTokens` call + `lastCallCacheMetrics` assignment) with code that reads from `responseUsage` after `recordBudgetCostWithCache`:
   - Remove lines 1612-1618 (keep line 1611 `if (responseUsage) {`).
   - Keep line 1619 `const budgetWarning = recordBudgetCostWithCache(...)` as-is.
   - After the `recordBudgetCostWithCache` call block, add:
     ```typescript
     this.lastCallCacheMetrics =
       typeof responseUsage.normalizedCacheHitTokens === "number"
         ? {
             hit: responseUsage.normalizedCacheHitTokens,
             miss: responseUsage.normalizedCacheMissTokens ?? 0,
           }
         : null;
     ```
3. Verify `normalizeCacheTokens` is still imported (used at line 2177 in compaction path). Do NOT remove the import.

**Validation:** `npx tsc --noEmit` passes. `node --import tsx --test src/tests/session.test.ts` — session tests pass.

**Status:** [x] done

---

### Task 4: Extract `parseTagsFromArgs` Helper (FR-004)

**Objective:** Create `parseTagsFromArgs` in `notes.ts` and replace 2 duplicate blocks in `command-handlers.ts`.

**Requirements Covered:** FR-004.
**Design References:** Change 4 in design.md.

**Actions:**
1. Open `src/ui/core/notes.ts`.
2. After the `parseNoteArgs` function, add the `parseTagsFromArgs` function as specified in design.md Change 4.
3. Export it by adding `parseTagsFromArgs` to the existing exports.
4. Open `src/ui/core/command-handlers.ts`.
5. In the `notes-add` handler, replace lines 137-148 (the `rawTag` block through the `tags` cleanup) with:
   ```typescript
   const tags = parseTagsFromArgs(args);
   ```
6. Add `parseTagsFromArgs` to the import from `./notes` at the top of `command-handlers.ts`.
7. In the `notes-edit` handler, replace lines 220-230 with the same single line:
   ```typescript
   const tags = parseTagsFromArgs(args);
   ```

**Validation:** `npx tsc --noEmit` passes. `node --import tsx --test src/tests/notes.test.ts` — all notes tests pass.

**Status:** [x] done

---

### Task 5: Unify Prefix-Token and Filter Functions (FR-005)

**Objective:** Replace the 6 slash/hash-specific functions with 3 generic parameterized functions. Update all callers and test imports.

**Requirements Covered:** FR-005.
**Design References:** Change 5 in design.md.

**Actions:**

**5a. `prompt-buffer.ts`:**
1. Open `src/ui/core/prompt-buffer.ts`.
2. Remove `getCurrentSlashToken` (lines 156-162).
3. Remove `getCurrentHashToken` (lines 164-170).
4. Add `getCurrentPrefixToken` as specified in design.md Change 5a.

**5b. `slash-commands.ts`:**
1. Open `src/ui/core/slash-commands.ts`.
2. Remove `filterSlashCommands` (lines 279-288).
3. Remove `filterHashCommands` (lines 290-299).
4. Remove `findExactSlashCommand` (lines 301-308).
5. Remove `findExactHashCommand` (lines 310-316).
6. Add `filterCommandsByPrefix` and `findExactCommandByPrefix` as specified in design.md Change 5b.

**5c. `PromptInput.tsx`:**
1. Open `src/ui/views/PromptInput.tsx`.
2. Update import from `../core/prompt-buffer`: replace `getCurrentSlashToken, getCurrentHashToken` with `getCurrentPrefixToken`.
3. Update import from `../core/slash-commands`: replace old function names with `filterCommandsByPrefix, findExactCommandByPrefix`.
4. Find all 6 call sites and update:
   - `getCurrentSlashToken(state)` → `getCurrentPrefixToken(state, "/")`
   - `getCurrentHashToken(state)` → `getCurrentPrefixToken(state, "#")`
   - `filterSlashCommands(items, token)` → `filterCommandsByPrefix(items, token, "/")`
   - `filterHashCommands(items, token)` → `filterCommandsByPrefix(items, token, "#")`
   - `findExactSlashCommand(items, token)` → `findExactCommandByPrefix(items, token, "/")`
   - `findExactHashCommand(items, token)` → `findExactCommandByPrefix(items, token, "#")`

**5d. Barrel exports:**
1. Open `src/ui/core/index.ts`. Replace old function names in exports.
2. Open `src/ui/index.ts`. Replace old function names in exports.

**5e. Test imports:**
1. Open `src/tests/slash-commands.test.ts`. Replace old function names with new ones.
2. Open `src/tests/prompt-input-keys.test.ts`. Replace `getCurrentSlashToken` with `getCurrentPrefixToken`. Update test calls to pass prefix argument.

**Validation:** `npx tsc --noEmit` passes. `npm test` — all tests pass.

**Status:** [x] done
