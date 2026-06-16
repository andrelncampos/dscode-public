---
name: notes-refinement
status: verified
references: V28, 260, 260A
---

# Spec 260B: Notes Refinement — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on completion of all preceding tasks.

## Tasks

### Task 1: Create `spec-names.ts` — Roadmap Parser

**Objective:** Implement `resolveSpecName()` to read `management/roadmap.md` and extract spec names.

**Requirements Covered:** FR-B01.

**Design References:** Component "Spec Name Resolution" in design.md.

**Actions:**
1. Create `src/ui/core/spec-names.ts`.
2. Import `node:fs`, `node:path`.
3. Define `ROADMAP_PATH = path.join("management", "roadmap.md")`.
4. Implement `parseSpecNames(): Map<string, string>`:
   - Read file with `fs.readFileSync(ROADMAP_PATH, "utf8")`.
   - Split by newline.
   - For each line, match regex `/^\|\s*(\d+[A-Z]?)\s*\|\s*([^|]+?)\s*\|/`.
   - `map.set(match[1], match[2].trim())`.
   - Catch and return empty map on any error.
5. Implement module-level cache: `let _cache: Map<string, string> | null = null`.
6. Implement `export function resolveSpecName(specId: string): string | null`:
   - Populate cache on first call.
   - Return `_cache.get(specId) ?? null`.
7. Implement `export function clearSpecNameCache(): void` — set `_cache = null` for test isolation.
8. Export all 3 symbols.

**Validation:** `npx tsc --noEmit` passes. Manual test against current `roadmap.md`.

**Status:** [ ] pending

---

### Task 2: Use Spec Name in `formatNote` and `formatNoteList`

**Objective:** Show spec name alongside spec number in note display.

**Requirements Covered:** FR-B01.

**Design References:** Changes 1 and 2 in design.md.

**Actions:**
1. Open `src/ui/core/notes.ts`.
2. Add import: `import { resolveSpecName } from "./spec-names";`.
3. In `formatNote` (specId block): call `resolveSpecName(note.specId)` and append name if found.
4. In `formatNoteList` (header specId block): same resolution for filter header.
5. Format: `(spec: #260 developer-notes)` when name available; `(spec: #260)` when not.

**Validation:** `npx tsc --noEmit` passes. Existing tests still pass (spec name may be present or absent depending on roadmap readability).

**Status:** [ ] pending

---

### Task 3: Register and Implement `/note-delete`

**Objective:** Add the `note-delete` command kind, slash entry, and handler.

**Requirements Covered:** FR-B03.

**Design References:** Change 3 in design.md.

**Actions:**
1. Open `src/ui/types/commands.ts`. Add `"note-delete"` to `COMMAND_KINDS` array.
2. Open `src/ui/core/slash-commands.ts`. Add entry to `BUILTIN_SLASH_COMMANDS`:
   - `kind: "note-delete"`, `name: "/note-delete"`, `args: ["<id>"]`, `description: "cmd.note-delete"`.
3. Open `src/ui/core/command-handlers.ts`.
4. Add `readNotes, writeNotes` to imports (if not already imported — verify).
5. Add handler:
   - Parse ID from input.
   - `readNotes()`, `findIndex`, `splice(idx, 1)`, `writeNotes(notes)`.
   - Output `t("cmd.note-deleted", { id })`.
   - Error cases: no ID → usage; not found → `cmd.note-not-found`.

**Validation:** `npx tsc --noEmit` passes. Slash command test updated.

**Status:** [ ] pending

---

### Task 4: Refactor `/note-edit` Handler — Metadata Flags

**Objective:** Add `--spec`, `--spec-remove`, `--tag`, and `--deadline` flags to `/note-edit`.

**Requirements Covered:** FR-B02.

**Design References:** Change 4 in design.md.

**Actions:**
1. Open `src/ui/core/command-handlers.ts`.
2. Locate the `"note-edit"` handler (line ~197).
3. Replace the handler with the new version:
   - Parse args via `parseNoteArgs(input)`.
   - Extract `id` from `args.positional[0]`.
   - Extract `text` from remaining positional args (if any).
   - Extract `specId`, `spec-remove`, `tags`, `deadline` from flags.
   - Validate date if present.
   - Require at least one change (text or flag).
   - Find note, mutate fields, `writeNotes()`.
   - Output confirmation: `t("cmd.note-updated", { id })` + formatted note.

**Validation:** `npx tsc --noEmit` passes. Handler compiles with new types.

**Status:** [ ] pending

---

### Task 5: Add Confirmation Messages to `/note-status` and `/note-deadline`

**Objective:** Show old→new status change and deadline confirmations.

**Requirements Covered:** FR-B04.

**Design References:** Change 5 in design.md.

**Actions:**
1. Open `src/ui/core/command-handlers.ts`.
2. In `"note-status"` handler: save `oldStatus` before calling `updateNoteStatus()`. After success, output `t("cmd.note-status-changed", { id, from: oldStatus, to: status })` before the formatted note.
3. In `"note-deadline"` handler: after success, output `t("cmd.note-deadline-set", { id })` or `t("cmd.note-deadline-removed", { id })` before the formatted note.

**Validation:** Existing tests still pass. New behavior is additive (prepends confirmation line).

**Status:** [ ] pending

---

### Task 6: Add I18n Keys

**Objective:** Add 7 new translation keys to all 3 language files and update `cmd.note-edit-usage`.

**Requirements Covered:** FR-B03, FR-B04.

**Design References:** I18n Keys table in design.md.

**Actions:**
1. Open `src/i18n/en.ts`. Add keys: `cmd.note-delete`, `cmd.note-delete-usage`, `cmd.note-deleted`, `cmd.note-updated`, `cmd.note-status-changed`, `cmd.note-deadline-set`, `cmd.note-deadline-removed`.
2. Update `cmd.note-edit-usage` to: `"Usage: /note-edit <id> [\"text\"] [--tag <tag>] [--deadline YYYY-MM-DD] [--spec <id>] [--spec-remove]"`.
3. Repeat for `es.ts` and `pt.ts` with Spanish/Portuguese translations.

**Validation:** `npx tsc --noEmit` passes. Grep confirms all 8 keys present in all 3 files (7 new + 1 updated).

**Status:** [ ] pending

---

### Task 7: Write Tests

**Objective:** Add tests for spec name resolution, note-delete, and confirmation messages.

**Requirements Covered:** All FRs.

**Design References:** Testing Strategy in design.md.

**Actions:**
1. Create `src/tests/spec-names.test.ts`:
   - `resolveSpecName returns name for known spec` — use a temp `roadmap.md`.
   - `resolveSpecName returns null for unknown spec`.
   - `resolveSpecName returns null when roadmap missing`.
   - `resolveSpecName caches results` — clear cache, verify.
   - Use `clearSpecNameCache()` in test setup/teardown.
2. Open `src/tests/notes.test.ts`. Add tests:
   - `formatNote shows spec name when available`.
   - `formatNote shows spec number only when name unresolved`.
   - `formatNoteList header shows spec name`.
   - `delete note removes from file` (via readNotes → splice → writeNotes pattern).
   - `delete note shows not found for missing id`.
3. Ensure all existing tests pass.

**Validation:** `npx tsx --test src/tests/spec-names.test.ts` — all pass. `npx tsx --test src/tests/notes.test.ts` — all pass (existing + new).

**Status:** [ ] pending

---

### Task 8: Full Test Suite Verification

**Objective:** Ensure zero regressions.

**Actions:**
1. Run `npx tsx --test 'src/tests/**/*.test.ts'`.
2. Verify all tests pass.
3. Fix any new failures.

**Validation:** Output shows `pass` count increased, `fail` count is 0.

**Status:** [ ] pending

---

### Task 9: Update Roadmap Status

**Objective:** Mark spec 260B as `in-progress` when implementation starts, then `done` when complete.

**Actions:**
1. Open `management/roadmap.md`.
2. At start: change `| 260B | notes-refinement | verified | V28 (child of 260) |` → `| 260B | notes-refinement | in-progress | V28 (child of 260) |`.
3. After all tasks complete and tests pass: change `in-progress` → `done`.

**Validation:** Roadmap line updated. `git diff` confirms only status changed.

**Status:** [ ] pending
