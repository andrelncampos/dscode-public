---
name: notes-mvp
status: verified
references: V28, 260
---

# Spec 260A: Notes MVP — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks. This spec refines the MVP commands (`/note-add`, `/note-list`, `/note-status`) that Spec 260 already implemented.

## Tasks

### Task 1: Add `specId` to `createNote` Options

**Objective:** Extend `createNote` to accept an optional `specId` parameter.

**Requirements Covered:** FR-A01.

**Design References:** Change 1 in design.md.

**Actions:**
1. Open `src/ui/core/notes.ts`.
2. Modify `createNote` signature: add `specId?: string` to the `options` type.
3. No other changes — `specId` flows through `...options` spread automatically.

**Validation:** `npx tsc --noEmit` passes. Existing callers compile unchanged.

**Status:** [x] done

---

### Task 2: Implement Multi-Flag Accumulation in `parseNoteArgs`

**Objective:** Accumulate repeated `--flag value` into a `string[]` array instead of overwriting.

**Requirements Covered:** FR-A03.

**Design References:** Change 2 in design.md.

**Actions:**
1. Open `src/ui/core/notes.ts`.
2. Update `ParsedNoteArgs` type: `flags: Record<string, string | true | string[]>`.
3. Modify the flag accumulation logic inside `parseNoteArgs` (the `if (t.startsWith("--"))` block):
   - Check if `flags[name]` already exists.
   - If `undefined` → assign string value directly.
   - If `string` → convert to `[existing, next]`.
   - If `string[]` → push next value.
   - If `true` → leave as string (value overrides boolean flag).
4. Boolean flags (`--flag` without value) remain `true` — no accumulation.

**Validation:** Existing tests pass. New test: `parseNoteArgs("--tag a --tag b")` → `flags.tag = ["a", "b"]`.

**Status:** [x] done

---

### Task 3: Update `/note-add` Handler — Spec Flag + Tag Normalization

**Objective:** Extract `--spec` flag and normalize `--tag` for multi-flag support in the `/note-add` handler.

**Requirements Covered:** FR-A02, FR-A03, FR-A04.

**Design References:** Change 3 in design.md.

**Actions:**
1. Open `src/ui/core/command-handlers.ts`.
2. Locate the `"note-add"` handler.
3. Add `specId` extraction:
   - `const specId = typeof args.flags.spec === "string" ? args.flags.spec : undefined`.
   - If `args.flags.spec !== undefined && specId === undefined` → output usage and return.
4. Replace tag handling:
   - Current: `const tagFlag = args.flags.tag; const tags = typeof tagFlag === "string" ? [tagFlag] : undefined;`
   - New: Normalize `string | string[] | true` — string → `[string]`, array → filter strings, true → undefined.
5. Add empty tag filtering: `tags.map(t => t.trim()).filter(t => t.length > 0)`; if empty after filter, set to `undefined`.
6. Pass `specId` to `createNote`: `createNote(text, { deadline, tags, specId })`.

**Validation:** `npx tsc --noEmit` passes. Handler compiles with updated types.

**Status:** [x] done

---

### Task 4: Implement Smart Text Truncation

**Objective:** Replace hard 80-char truncation in `formatNote` with word-boundary-aware truncation.

**Requirements Covered:** FR-A05.

**Design References:** Change 4 in design.md.

**Actions:**
1. Open `src/ui/core/notes.ts`.
2. Add helper function `truncateText(text: string, maxLen: number): string`:
   - If `text.length <= maxLen` → return text as-is.
   - Slice to `maxLen`, find `lastIndexOf(" ")`.
   - If `lastSpace > maxLen * 0.6` → truncate at space + `"..."`.
   - Else → hard truncate at maxLen + `"..."`.
3. Replace `note.text.length > 80 ? note.text.slice(0, 80) + "..." : note.text` with `truncateText(note.text, 80)`.
4. Export `truncateText` for testability.

**Validation:** Unit tests verify word-boundary truncation, hard truncation fallback, and non-truncation for short text.

**Status:** [x] done

---

### Task 5: Add Overdue Days Count to `formatNoteList`

**Objective:** Display days-ago count in the `OVERDUE` badge (e.g., `OVERDUE (5d)` instead of just `OVERDUE`).

**Requirements Covered:** FR-A06.

**Design References:** Change 5 in design.md.

**Actions:**
1. Open `src/ui/core/notes.ts`.
2. In `formatNoteList`, modify the overdue prefix calculation:
   - Compute days: `(todayDate.getTime() - deadlineDate.getTime()) / 86400000`.
   - Format as `` `\x1b[1;31mOVERDUE (${days}d)\x1b[0m ` ``.
   - Use UTC dates for both deadline and today to avoid timezone/DST artifacts.

**Validation:** Unit test with fixed today value stubbed via `new Date()` mock or by creating a note with known past deadline and verifying output format.

**Status:** [x] done

---

### Task 6: Update I18n Usage Message

**Objective:** Update `cmd.note-add-usage` in all 3 language files to include the `--spec` flag in the usage string.

**Requirements Covered:** FR-A02 (usage message must list `--spec <id>`).

**Design References:** File / Module Layout in design.md.

**Actions:**
1. Open `src/i18n/en.ts`. Append ` [--spec <id>]` before the closing quote of the `"cmd.note-add-usage"` value.
2. Open `src/i18n/es.ts`. Append ` [--spec <id>]` (or equivalent Spanish).
3. Open `src/i18n/pt.ts`. Append ` [--spec <id>]` (or equivalent Portuguese).

**Validation:** `npx tsc --noEmit` passes. Grep confirms all 3 values contain `--spec <id>`.

**Status:** [x] done

---

### Task 7: Write Refinement Tests

**Objective:** Add tests for all 5 changes introduced by this spec.

**Requirements Covered:** FR-A01 through FR-A06.

**Design References:** Testing Strategy in design.md.

**Actions:**
1. Open `src/tests/notes.test.ts`.
2. Add tests:
   - `createNote accepts specId option`
   - `createNote without specId has no specId field`
   - `parseNoteArgs accumulates repeated --tag values`
   - `parseNoteArgs keeps single --tag as string`
   - `parseNoteArgs keeps --overdue as true` (boolean flag unchanged)
   - `parseNoteArgs handles --tag --spec --deadline combined`
   - `truncateText truncates at word boundary`
   - `truncateText hard-truncates when no space near limit`
   - `truncateText does not truncate short text`
   - `formatNoteList shows overdue days count`
   - `formatNoteList no overdue badge for future deadline`
3. Ensure all existing 30 tests still pass.

**Validation:** `npx tsx --test src/tests/notes.test.ts` — all tests pass (30 existing + ~11 new).

**Status:** [x] done

---

### Task 8: Full Test Suite Verification

**Objective:** Ensure zero regressions.

**Actions:**
1. Run `npx tsx --test 'src/tests/**/*.test.ts'`.
2. Verify all tests pass (including existing slash-commands.test.ts which must include note commands).
3. Fix any new failures.

**Validation:** Output shows `pass` count increased by ~11, `fail` count is 0.

**Status:** [x] done

---

### Task 9: Update Roadmap Status

**Objective:** Mark spec 260A as `in-progress` when implementation starts, then `done` when complete.

**Actions:**
1. Open `management/roadmap.md`.
2. At start: change `| 260A | notes-mvp | verified | V28 (child of 260) |` → `| 260A | notes-mvp | in-progress | V28 (child of 260) |`.
3. After all tasks complete and tests pass: change `in-progress` → `done`.

**Validation:** Roadmap line updated. `git diff` confirms only status changed.

**Status:** [x] done
