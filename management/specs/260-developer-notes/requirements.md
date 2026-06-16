---
name: developer-notes
status: verified
references: V28
---

# Spec 260: Developer Notes — Requirements

## Value Delivery

**From V28 (Vision.md):**
> Ultra-light note-taking integrated into the terminal workflow. The developer registers quick reminders without leaving the keyboard — no context-switching to a separate app like Notion, Obsidian, or Jira.
>
> Design philosophy: Not a task manager, not a Jira replacement, not a project tracker. Just a way to not forget what can't be done right now. If the developer thinks "I should check that later" during a session, they type `/note-add` and move on.

This spec is the **parent** of 260A (notes-mvp) and 260B (notes-refinement). It defines the shared data model, storage contract, and command registration infrastructure that both child specs depend on.

---

## Functional Requirements

### FR-001: Note Data Model

**What:** Define a deterministic, JSON-serializable data structure for a single note stored in `.dscode/notes.json`. The schema must support all operations defined in 260A and 260B without schema migration.

**Why:** A stable schema is the foundation for all CRUD operations. Without it, child specs cannot be implemented independently.

**Acceptance Criteria:**
- [ ] TypeScript type `Note` exported from `src/ui/core/notes.ts` with fields: `id: string`, `text: string`, `status: NoteStatus`, `createdAt: string`, `updatedAt: string`, `deadline?: string`, `tags?: string[]`, `specId?: string`.
- [ ] `NoteStatus` is a union type: `"open" | "closed" | "paused" | "abandoned"`.
- [ ] `id` format: exactly 4 lowercase hex characters (`[0-9a-f]{4}`), generated deterministically with no collision against existing notes.
- [ ] `createdAt` and `updatedAt` are ISO 8601 strings with second precision (e.g., `"2026-06-16T13:00:00"`), always UTC.
- [ ] `deadline` is `YYYY-MM-DD` string or absent.
- [ ] `tags` is array of lowercase strings (e.g., `["bug", "todo"]`) or absent.
- [ ] `specId` is a string matching the spec number (e.g., `"120"`, `"260"`) or absent.
- [ ] JSON file structure: a flat array `Note[]` at `.dscode/notes.json`.
- [ ] If `.dscode/notes.json` does not exist, it is treated as an empty array `[]`.

### FR-002: Notes File Management

**What:** Read and write `.dscode/notes.json` atomically. Guarantee no data corruption on concurrent writes (single process, but crash-safe).

**Why:** The file is the source of truth. Corruption means lost notes.

**Acceptance Criteria:**
- [ ] `readNotes(): Note[]` — reads `.dscode/notes.json`, parses JSON, validates it is an array. Returns `[]` if file missing or invalid JSON.
- [ ] `writeNotes(notes: Note[]): void` — writes to a temp file first (`notes.json.tmp`), then renames over the original. Syncs the file fd after rename.
- [ ] If write crashes between temp and rename, next `readNotes()` recovers the original file (temp is overwritten on next write).
- [ ] `.dscode/` directory is created if missing before first write.
- [ ] `notes.json` is excluded from git via `.gitignore` entry in `.dscode/.gitignore`.

### FR-003: Note ID Generation

**What:** Generate unique, human-friendly note IDs. Short enough to type, unique enough to avoid collisions within a project.

**Why:** IDs are typed by the user in commands like `/note-status abc1 closed`. Must be short and unambiguous.

**Acceptance Criteria:**
- [ ] `generateNoteId(existingIds: Set<string>): string` — generates 4 lowercase hex chars, retries on collision, max 100 attempts.
- [ ] Throws `Error("note ID generation exhausted after 100 attempts")` if all 65,536 possible IDs are taken within 100 collision attempts.
- [ ] Uses `crypto.randomBytes(2).toString("hex")` for base randomness.

### FR-004: Command Registration Infrastructure

**What:** Register `/note-add`, `/note-list`, `/note-status`, `/note-edit`, `/note-deadline` as slash commands in the DsCode command system.

**Why:** Without registration, the commands are invisible to autocomplete and cannot be invoked.

**Acceptance Criteria:**
- [ ] All 5 command kinds added to `COMMAND_KINDS` array in `src/ui/types/commands.ts`.
- [ ] All 5 command entries added to `BUILTIN_SLASH_COMMANDS` in `src/ui/core/slash-commands.ts` with correct `kind`, `name`, `label`, `args`, and i18n `description` keys.
- [ ] All 5 handlers registered in `COMMAND_HANDLERS` in `src/ui/core/command-handlers.ts`, delegating to `notes.ts` functions.
- [ ] Each command clears the slash token via `ctx.clearSlashToken()` if it handles locally (does not submit to LLM).
- [ ] Commands that mutate notes (`note-add`, `note-status`, `note-edit`, `note-deadline`) leave input cleared via `ctx.resetPromptInput()`.
- [ ] `/note-list` leaves input cleared and writes output to `process.stdout`.

### FR-005: Arg Parsing

**What:** Parse typed text after the command name into structured arguments. Support quoted strings, flags, and positional args.

**Why:** Commands like `/note-add fix login --tag bug --deadline 2026-07-01` need reliable arg extraction.

**Acceptance Criteria:**
- [ ] `parseNoteArgs(input: string): ParsedNoteArgs` exported from `src/ui/core/notes.ts`.
- [ ] `ParsedNoteArgs` type: `{ positional: string[]; flags: Record<string, string | true> }`.
- [ ] `--flag value` extracts `value` as string (e.g., `--deadline 2026-07-01` → `flags.deadline = "2026-07-01"`).
- [ ] `--flag` without value sets `true` (e.g., `--overdue` → `flags.overdue = true`).
- [ ] Quoted strings `"like this"` are treated as a single positional arg. Strip quotes.
- [ ] Leading/trailing whitespace in positional args is trimmed.
- [ ] Empty input returns `{ positional: [], flags: {} }`.

### FR-006: Output Formatting

**What:** Format notes for display in the terminal when listing or after creation.

**Why:** The user must see note information clearly at a glance.

**Acceptance Criteria:**
- [ ] Single note display: `[id] STATUS text (tags: tag1, tag2) (deadline: YYYY-MM-DD) (spec: #N)`. Omit parenthetical groups when field is absent.
- [ ] Status is color-coded via ANSI: `open` = yellow (`\x1b[33m`), `closed` = green (`\x1b[32m`), `paused` = dim (`\x1b[2m`), `abandoned` = red (`\x1b[31m`).
- [ ] List header: bold border line + `NOTES` + bold border line, followed by one note per line.
- [ ] Overdue notes (deadline < today) get `OVERDUE` prefix in red bold.
- [ ] Notes sorted: overdue first (by deadline ascending), then open (by deadline ascending), then paused (by creation date descending), then closed (by creation date descending). Abandoned notes go last.
- [ ] Empty list outputs: `No notes found. Use /note-add <text> to create one.`

---

## Non-Functional Requirements

### NFR-001: Performance

**What:** Note operations must complete in < 10ms for projects with up to 1,000 notes.

**Why:** The user is typing in a terminal. No perceptible delay is acceptable for CRUD operations on a local JSON file.

**Acceptance Criteria:**
- [ ] `readNotes()` allocates zero new dependencies — uses `fs.readFileSync`.
- [ ] `listNotes()` uses `Array.filter().sort()` on the in-memory array. No indexes, no databases.
- [ ] No async operations in any note handler — all synchronous to match Ink/React lifecycle constraints.

### NFR-002: Zero New Dependencies

**What:** Implement without adding any npm package to `package.json`.

**Why:** P6 — Zero New Dependencies Without Justification. For a local JSON file CRUD, no library is needed. Node.js stdlib (`fs`, `crypto`, `path`) is sufficient.

**Acceptance Criteria:**
- [ ] `package.json` and `package-lock.json` unchanged after implementation.
- [ ] All functionality uses only `node:fs`, `node:crypto`, `node:path`.

### NFR-003: Internationalization

**What:** All user-facing strings must use the i18n system (`en.ts`, `es.ts`, `pt.ts`).

**Why:** The app already supports 3 languages. New features must not regress i18n coverage.

**Acceptance Criteria:**
- [ ] i18n keys prefixed `cmd.note-*` (e.g., `cmd.note-add`, `cmd.note-list-empty`).
- [ ] English, Spanish, and Portuguese translations provided for every key.
- [ ] Keys used via `getActiveTFunction()` in handlers.

---

## Constraints

- **Storage:** `.dscode/notes.json` — flat JSON array, no SQLite, no LevelDB, no external database.
- **Concurrency:** Single-process app — no IPC, no file locks, no watch mode. Temp-and-rename is sufficient for crash safety.
- **Language:** TypeScript only. No new language or runtime.
- **UI:** Terminal stdout output for lists. Status messages for confirmations. No React components for note display (notes are not part of Ink UI — they are terminal output).
- **Ink compatibility:** All handlers are synchronous because they run inside a React/Ink render cycle. No `async` handlers, no `await`.

---

## Edge Cases & Error States

| Scenario | Expected Behavior |
|---|---|
| `.dscode/` does not exist on first `/note-add` | Create `.dscode/` directory before writing `notes.json`. |
| `.dscode/notes.json` contains invalid JSON | Treat as empty array `[]`. Overwrite on first write. Do not crash. |
| `.dscode/notes.json` contains valid JSON but not an array | Treat as empty array `[]`. Overwrite on first write. |
| `/note-status <id>` with non-existent ID | Output: `Note <id> not found.` |
| `/note-status <id>` with invalid status (not open/closed/paused/abandoned) | Output: `Invalid status. Use: open, closed, paused, abandoned.` |
| `/note-add` with empty text | Output: `Usage: /note-add <text> [--deadline YYYY-MM-DD] [--tag <tag>]` |
| `/note-deadline <id>` with no date and no `--remove` | Output: `Usage: /note-deadline <id> <YYYY-MM-DD> | --remove` |
| `/note-deadline <id> <invalid-date>` | Output: `Invalid date format. Use YYYY-MM-DD.` |
| `/note-edit <id>` with no text | Output: `Usage: /note-edit <id> "<new text>"` |
| `/note-list --status invalid` | Output: `Invalid status. Use: open, closed, paused, abandoned.` |
| `/note-list --spec <id>` with non-existent spec | Show empty list (no notes linked to that spec). |
| `/note-add --deadline 2026-13-01` (invalid month) | Output: `Invalid date. Use YYYY-MM-DD.` |
| Note JSON file grows to 10MB+ | Acceptable — `Array.filter().sort()` on 10MB of notes takes < 10ms. No special handling needed. |
| Note with duplicate tags `["bug", "bug"]` | Deduplicate on write. |

---

## Dependencies

- **Spec 260A (notes-mvp):** Depends on FR-001, FR-002, FR-003, FR-004, FR-005, FR-006 from this spec.
- **Spec 260B (notes-refinement):** Depends on FR-001, FR-002, FR-003 from this spec + all of 260A.
- **Existing code:** `src/ui/core/command-handlers.ts`, `src/ui/core/slash-commands.ts`, `src/ui/types/commands.ts`, `src/i18n/en.ts`, `src/i18n/es.ts`, `src/i18n/pt.ts`.

## Out of Scope

- **LLM interaction:** Notes do NOT go through the LLM. They are not submitted as prompts, not used as context, not searched by the AI. They are purely a developer tool, like a terminal-based scratchpad.
- **Task management:** No priorities, no dependencies between notes, no assignments, no progress tracking beyond status.
- **Persistence beyond local filesystem:** No cloud sync, no git integration, no export/import.
- **Rich text:** Plain text only. No Markdown rendering in output.
- **Search:** No full-text search. Filtering is by status, overdue, spec, and tags only.
- **Notifications:** No desktop notifications for overdue notes. The user must run `/note-list --overdue` to see them.
- **UI in Ink components:** Notes output goes to `process.stdout`, not React. They are terminal text, not UI components. This avoids the Ink rendering complexity documented in L7 and L9.
