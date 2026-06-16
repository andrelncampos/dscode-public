---
name: developer-notes
status: verified
references: V28
---

# Spec 260: Developer Notes — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks. This spec implements ALL 5 commands plus shared infrastructure. Spec 260A and 260B are refinement specs that add polish, additional edge case handling, and spec-linking features on top of this foundation.

## Tasks

### Task 1: Create `src/ui/core/notes.ts` — Types and Constants

**Objective:** Bootstrap the notes module with all type definitions and path constants.

**Requirements Covered:** FR-001 (Note data model).

**Design References:** Component "src/ui/core/notes.ts — Types".

**Actions:**
1. Create file `src/ui/core/notes.ts`.
2. Define `NoteStatus` type: `"open" | "closed" | "paused" | "abandoned"`.
3. Define `Note` interface with all fields: `id`, `text`, `status`, `createdAt`, `updatedAt`, `deadline?`, `tags?`, `specId?`.
4. Define `ParsedNoteArgs` interface: `{ positional: string[]; flags: Record<string, string | true> }`.
5. Define constants: `NOTES_PATH = path.join(".dscode", "notes.json")`, `NOTES_TMP = path.join(".dscode", "notes.json.tmp")`.
6. Import `node:path`.

**Validation:** TypeScript compiles with `npx tsc --noEmit`. File has 0 dependencies on React/Ink.

**Status:** [ ] pending

---

### Task 2: Implement File I/O Functions

**Objective:** Implement `readNotes()` and `writeNotes()` with crash-safe atomic writes.

**Requirements Covered:** FR-002 (Notes file management).

**Design References:** Component "src/ui/core/notes.ts — File I/O".

**Actions:**
1. Import `node:fs`.
2. Implement `readNotes(): Note[]`:
   - Check `existsSync(NOTES_PATH)`.
   - `readFileSync(NOTES_PATH, "utf8")`.
   - `JSON.parse(content)`.
   - Return `[]` if file missing, parse error, or non-array result.
3. Implement `writeNotes(notes: Note[]): void`:
   - `mkdirSync(dirname(NOTES_PATH), { recursive: true })`.
   - `JSON.stringify(notes, null, 2)`.
   - `writeFileSync(NOTES_TMP, json, "utf8")`.
   - `renameSync(NOTES_TMP, NOTES_PATH)`.
   - `fsyncSync` on file fd to flush write cache (use try/finally for close).
4. Create `.dscode/.gitignore` with content `notes.json` (via `writeFileSync` if file does not exist).

**Validation:** Manual test: call `writeNotes([...])` then `readNotes()` and verify round-trip. Delete file and verify `readNotes()` returns `[]`. Corrupt JSON and verify returns `[]`.

**Status:** [ ] pending

---

### Task 3: Implement ID Generation

**Objective:** Implement `generateNoteId()` with collision avoidance.

**Requirements Covered:** FR-003 (Note ID generation).

**Design References:** Component "src/ui/core/notes.ts — ID Generation".

**Actions:**
1. Import `node:crypto`.
2. Implement `generateNoteId(existingIds: Set<string>): string`:
   - Loop max 100.
   - `crypto.randomBytes(2).toString("hex")`.
   - Check against `existingIds`, return if unique.
   - Throw after 100 exhausted attempts.
3. Export function.

**Validation:** Run 1000 generations and verify all are 4-char hex, no collisions within set. Test collision avoidance with mock set containing generated ID.

**Status:** [ ] pending

---

### Task 4: Implement Arg Parser

**Objective:** Implement `parseNoteArgs()` for extracting positional args and flags from command input.

**Requirements Covered:** FR-005 (Arg parsing).

**Design References:** Component "src/ui/core/notes.ts — Arg Parsing".

**Actions:**
1. Implement `parseNoteArgs(input: string): ParsedNoteArgs`.
2. Tokenize: split by whitespace, respecting double-quoted strings.
3. Classify tokens: `--flag value` → `flags.flag = value`, `--flag` (no value) → `flags.flag = true`, everything else → positional.
4. Strip quotes from quoted strings.
5. Return `{ positional, flags }`.

**Validation:** Test with various inputs:
- `""` → `{ positional: [], flags: {} }`
- `"hello world"` → `{ positional: ["hello", "world"], flags: {} }`
- `"hello --tag bug"` → `{ positional: ["hello"], flags: { tag: "bug" } }`
- `"--overdue"` → `{ positional: [], flags: { overdue: true } }`
- `"\"hello world\" --tag bug"` → `{ positional: ["hello world"], flags: { tag: "bug" } }`
- `"fix login --tag bug --deadline 2026-07-01"` → correct extraction

**Status:** [ ] pending

---

### Task 5: Implement Validation Functions

**Objective:** Implement `isValidDate()` and `isValidStatus()` for input validation.

**Requirements Covered:** FR-005 (Arg parsing — validation sub-functions). Edge cases for invalid dates and statuses.

**Design References:** Component "src/ui/core/notes.ts — Validation".

**Actions:**
1. Implement `isValidDate(dateStr: string): boolean`:
   - Regex match `/^\d{4}-\d{2}-\d{2}$/`.
   - `new Date(dateStr + "T00:00:00Z")`, check `!isNaN(d.getTime())`.
   - Validate month 01-12, day valid for month (incl. leap year Feb 29).
2. Implement `isValidStatus(status: string): status is NoteStatus`:
   - `["open", "closed", "paused", "abandoned"].includes(status)`.
3. Export both functions.

**Validation:** Test valid dates (`2026-01-01`, `2024-02-29`), invalid dates (`2026-13-01`, `2026-02-30`, `not-a-date`). Test all 4 valid statuses and invalid ones.

**Status:** [ ] pending

---

### Task 6: Implement CRUD Operations

**Objective:** Implement `createNote()`, `listNotes()`, `updateNoteStatus()`, `updateNoteText()`, `updateNoteDeadline()`.

**Requirements Covered:** FR-002 (file management via CRUD), FR-003 (ID generation via `createNote`).

**Design References:** Component "src/ui/core/notes.ts — CRUD Operations".

**Actions:**
1. Implement helper: `now(): string` → `new Date().toISOString().replace(/\..+/, "")` producing `"YYYY-MM-DDTHH:mm:ss"`.
2. Implement helper: `today(): string` → `new Date().toISOString().slice(0, 10)` for overdue comparison.
3. Implement `createNote(text, options)`:
   - `readNotes()`, generate ID, build note, push, `writeNotes()`.
   - Deduplicate tags: `[...new Set(tags.map(t => t.toLowerCase().trim()))]`.
   - Remove empty tags array from note.
4. Implement `listNotes(filters)`:
   - `readNotes()`, filter by status/overdue/specId, sort.
   - Sort order: overdue (deadline asc), open (deadline asc then created desc), paused (created desc), closed (created desc), abandoned (created desc).
5. Implement `updateNoteStatus(id, status)` → Note | null.
6. Implement `updateNoteText(id, text)` → Note | null.
7. Implement `updateNoteDeadline(id, deadline)` → Note | null (null = remove).
8. Export all functions.

**Validation:** Unit test each CRUD function with isolated temp directory. Verify file persistence. Verify status updates change status and timestamp. Verify text updates. Verify deadline set and removal.

**Status:** [ ] pending

---

### Task 7: Implement Formatting Functions

**Objective:** Implement `formatNote()` and `formatNoteList()` for terminal output.

**Requirements Covered:** FR-006 (Output formatting).

**Design References:** Component "src/ui/core/notes.ts — Formatting".

**Actions:**
1. Implement `formatNote(note: Note): string`:
   - Status color map via ANSI codes.
   - Build parts: `[id]`, colored status, truncated text (80 chars), deadline, tags, specId.
   - Omit absent optional fields.
2. Implement `formatNoteList(notes, filters): string`:
   - Header with filter description.
   - Prepend `OVERDUE` in red bold for overdue notes.
   - Join with `\n`.
   - Note: caller handles empty list via `t("cmd.note-list-empty")`. This function assumes non-empty input.
3. Export both functions.

**Validation:** Test formatting with note having all fields, note with minimal fields, empty list. Verify ANSI codes present for status colors. Verify overdue prefix appears for past deadline.

**Status:** [ ] pending

---

### Task 8: Add Command Kinds to `commands.ts`

**Objective:** Register `note-add`, `note-list`, `note-status`, `note-edit`, `note-deadline` as valid command kinds.

**Requirements Covered:** FR-004 (Command registration infrastructure).

**Design References:** Component "Command Handlers" — first step.

**Actions:**
1. Open `src/ui/types/commands.ts`.
2. Add to `COMMAND_KINDS` array (before the closing `] as const`): `"note-add"`, `"note-list"`, `"note-status"`, `"note-edit"`, `"note-deadline"`.

**Validation:** `npx tsc --noEmit` passes. TypeScript ensures these are valid in `SlashCommandKind`.

**Status:** [ ] pending

---

### Task 9: Add Command Registrations to `slash-commands.ts`

**Objective:** Register the 5 commands in `BUILTIN_SLASH_COMMANDS` so they appear in autocomplete.

**Requirements Covered:** FR-004.

**Design References:** Component "Command Handlers" — second step.

**Actions:**
1. Open `src/ui/core/slash-commands.ts`.
2. Add 5 entries to `BUILTIN_SLASH_COMMANDS` array:
   - `note-add`: args `["<text>", "--deadline", "YYYY-MM-DD", "--tag", "<tag>"]`, description `"cmd.note-add"`.
   - `note-list`: args `["--status", "open|closed|paused|abandoned", "--overdue", "--spec", "<id>"]`, description `"cmd.note-list"`.
   - `note-status`: args `["<id>", "<status>"]`, description `"cmd.note-status"`.
   - `note-edit`: args `["<id>", '"<text>"']`, description `"cmd.note-edit"`.
   - `note-deadline`: args `["<id>", "YYYY-MM-DD|--remove"]`, description `"cmd.note-deadline"`.

**Validation:** `npx tsc --noEmit` passes. Commands appear in `buildSlashCommands(...)` result.

**Status:** [ ] pending

---

### Task 10: Add Command Handlers to `command-handlers.ts`

**Objective:** Implement the 5 handlers in `COMMAND_HANDLERS` that delegate to `notes.ts` functions.

**Requirements Covered:** FR-004.

**Design References:** Component "Command Handlers".

**Actions:**
1. Open `src/ui/core/command-handlers.ts`.
2. Add import at top:
   ```typescript
   import {
     createNote, listNotes, updateNoteStatus, updateNoteText, updateNoteDeadline,
     parseNoteArgs, formatNote, formatNoteList, isValidDate, isValidStatus,
   } from "./notes";
   import type { NoteStatus } from "./notes";
   ```
3. Add 5 handlers to `COMMAND_HANDLERS` object (before the closing `}`).
4. Each handler:
   - Calls `ctx.clearSlashToken()`.
   - Parses input from `ctx.buffer.text`.
   - Validates args.
   - Calls notes.ts function.
   - Writes result via `process.stdout.write(...)`.
   - Calls `ctx.resetPromptInput()`.

**Validation:** `npx tsc --noEmit` passes. Handlers exist in object and are correctly typed.

**Status:** [ ] pending

---

### Task 11: Add I18n Keys

**Objective:** Add 13 translation keys to all 3 language files.

**Requirements Covered:** NFR-003 (Internationalization).

**Design References:** Component "I18n Keys" in design.md.

**Actions:**
1. Open `src/i18n/en.ts`. Add the 13 keys from the design table in alphabetical order.
2. Open `src/i18n/es.ts`. Add the same 13 keys with Spanish translations.
3. Open `src/i18n/pt.ts`. Add the same 13 keys with Portuguese translations.

**Validation:** `npx tsc --noEmit` passes. All 39 keys (13 × 3) present.

**Status:** [ ] pending

---

### Task 12: Write Unit Tests for `notes.ts`

**Objective:** Create comprehensive test coverage for the notes module.

**Requirements Covered:** All FRs — validation coverage.

**Design References:** Testing Strategy section in design.md.

**Actions:**
1. Create file `src/tests/notes.test.ts`.
2. Import all exported functions from `src/ui/core/notes.ts`.
3. Use `node:test` and `node:assert/strict`.
4. Write tests for each function (see design.md testing strategy for complete list — ~25 tests).
5. Each test uses a temp directory (`fs.mkdtempSync`) for file isolation.
6. Clean up temp dirs in test teardown.

**Validation:** `npx tsx --test src/tests/notes.test.ts` — all tests pass.

**Status:** [ ] pending

---

### Task 13: Update Roadmap Status

**Objective:** Mark spec 260 as `in-progress` when implementation starts, then `done` when complete.

**Actions:**
1. Open `management/roadmap.md`.
2. At start of implementation: change `| 260 | developer-notes | verified | V28 |` → `| 260 | developer-notes | in-progress | V28 |`.
3. After all tasks complete and tests pass: change `in-progress` → `done`.

**Validation:** Roadmap line updated. `git diff` confirms only status changed.

**Status:** [ ] pending

---

### Task 14: Full Test Suite Verification

**Objective:** Ensure zero regressions from existing test suite.

**Actions:**
1. Run `npx tsx --test 'src/tests/**/*.test.ts'`.
2. Verify all previously passing tests still pass.
3. Verify new `notes.test.ts` tests pass.

**Validation:** Output shows `pass` count increased by 25+, `fail` count is 0.

**Status:** [ ] pending
