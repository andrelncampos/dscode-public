---
name: notes-refinement
status: created
references: V28, 260, 260A
---

# Spec 260B: Notes Refinement — Requirements

## Value Delivery

**From V28 (Vision.md):**
> `/note-edit <id> "new text"` — edit note content in-place.
> `/note-deadline <id> [YYYY-MM-DD|--remove]` — set, change, or remove a deadline.
> **Spec linking** — notes can optionally reference a spec (`--spec <id>`) for traceability.

**From Spec 260A (Out of Scope):**
> `/note-edit` and `/note-deadline` refinements → Spec 260B.
> Full spec linking (showing spec name, `--spec` filtering on `/note-list`, `--spec` in `/note-edit`) → Spec 260B.

This spec refines the two refinement commands (`/note-edit`, `/note-deadline`) and completes the spec linking feature. Spec 260 already implemented the basic commands; Spec 260A added `specId` support for note creation. This spec adds:
1. Spec name resolution — display spec name (e.g., `developer-notes`) alongside spec number in note output.
2. `/note-edit` metadata flags — edit tags, deadline, and spec link inline via `--tag`, `--deadline`, `--spec`, `--spec-remove`.
3. `/note-delete <id>` — delete a note permanently (completes CRUD).
4. Confirmation messages — show old → new values after edit operations.

---

## Functional Requirements

### FR-B01: Spec Name Resolution

**What:** When displaying notes, resolve `specId` to the spec's human-readable name from `management/roadmap.md` and show both.

**Why:** Current output shows `(spec: #260)` which is opaque. Showing `(spec: #260 developer-notes)` adds immediate context without having to cross-reference the roadmap.

**Acceptance Criteria:**
- [ ] New helper `resolveSpecName(specId: string): string | null` reads `management/roadmap.md` and extracts the spec name from the spec table.
- [ ] Spec table parsing: extract lines matching `| NNN | name | ...` where `NNN` matches the specId. Return `name` or `null`.
- [ ] `formatNote()` appends spec name when `specId` is present: `(spec: #260 developer-notes)`.
- [ ] `formatNoteList` header shows spec name when filtered: `spec: #260 developer-notes`.
- [ ] Cached in-memory for the session: `resolveSpecName` reads the file once and caches results in a `Map<string, string>`.
- [ ] If `roadmap.md` doesn't exist or parsing fails, falls back to just the spec number (`(spec: #260)`).

### FR-B02: `/note-edit` Metadata Flags

**What:** `/note-edit` supports `--spec`, `--spec-remove`, `--tag`, and `--deadline` flags to edit note metadata inline without separate commands.

**Why:** Currently, to change a note's tags you must know the note ID and use a hypothetical future command. The user should be able to type `/note-edit abc1 --tag bug --spec 120` and have both tags and spec updated in one go, alongside or without text changes.

**Acceptance Criteria:**
- [ ] `/note-edit <id> --spec 260` — changes the note's specId to "260".
- [ ] `/note-edit <id> --spec-remove` — removes spec linking (sets `specId` to undefined).
- [ ] `/note-edit <id> --tag bug` — replaces all tags with `["bug"]` (not append).
- [ ] `/note-edit <id> --tag bug --tag todo` — replaces all tags with `["bug", "todo"]`.
- [ ] `/note-edit <id> --deadline 2026-12-31` — changes deadline.
- [ ] `/note-edit <id> "new text" --tag bug` — text + metadata edited in one command.
- [ ] `/note-edit <id> --tag` (no value) — shows usage: `Usage: /note-edit <id> ["text"] [--tag <tag>] [--deadline YYYY-MM-DD] [--spec <id>] [--spec-remove]`.
- [ ] `/note-edit <id>` with no text and no flags — shows usage.
- [ ] After successful edit, output shows the updated note using `formatNote`.
- [ ] Invalid date in `--deadline` — shows `cmd.note-invalid-date` error.

### FR-B03: `/note-delete <id>`

**What:** New slash command to permanently delete a note by ID.

**Why:** The full CRUD lifecycle requires delete. Without it, the user must manually edit `.dscode/notes.json` to remove a note. A simple `/note-delete abc1` completes the API.

**Acceptance Criteria:**
- [ ] New command kind `note-delete` registered in `commands.ts`, `slash-commands.ts`, and `command-handlers.ts`.
- [ ] Handler removes the note from `notes.json` via `readNotes()` → filter → `writeNotes()`.
- [ ] `/note-delete <id>` — deletes note; outputs confirmation: `Note <id> deleted.`.
- [ ] `/note-delete` with no ID — shows usage: `Usage: /note-delete <id>`.
- [ ] `/note-delete <nonexistent>` — shows `Note <id> not found.`.
- [ ] New i18n keys: `cmd.note-delete` (description), `cmd.note-delete-usage`, `cmd.note-deleted` (confirmation with `{{id}}` interpolation).
- [ ] Deleted notes cannot be recovered — no undo, no trash.

### FR-B04: Confirmation Messages

**What:** After edit and deadline operations, show a concise confirmation summarizing what changed.

**Why:** Current output re-displays the full formatted note after edit, which mixes confirmation with data display. A one-line confirmation makes success clear and the note preview is a bonus.

**Acceptance Criteria:**
- [ ] `/note-edit <id> "new text"` — outputs: `Note <id> updated.` followed by formatted note on next line.
- [ ] `/note-status <id> closed` — outputs: `Note <id> status: open → closed.` then formatted note.
- [ ] `/note-deadline <id> 2026-12-31` — outputs: `Note <id> deadline set.` then formatted note.
- [ ] `/note-deadline <id> --remove` — outputs: `Note <id> deadline removed.` then formatted note.
- [ ] `/note-delete <id>` — outputs: `Note <id> deleted.` (no note preview).
- [ ] New i18n keys: `cmd.note-updated`, `cmd.note-status-changed` (with `{{from}}` and `{{to}}`), `cmd.note-deadline-set`, `cmd.note-deadline-removed`.

---

## Non-Functional Requirements

### NFR-B01: Backward Compatibility

**What:** All existing note commands continue to work unchanged. No existing tests may break.

**Acceptance Criteria:**
- [ ] `npx tsx --test 'src/tests/**/*.test.ts'` passes with zero failures.
- [ ] All existing tests from Spec 260 and 260A pass unchanged.
- [ ] `/note-edit <id> "text"` without flags works identically (just adds confirmation line).

### NFR-B02: Zero New Dependencies

**What:** Only `node:fs`, `node:crypto`, `node:path` — same as parent specs.

**Acceptance Criteria:**
- [ ] `package.json` unchanged.

---

## Constraints

- **Storage:** No changes to `.dscode/notes.json` schema. Same `Note` interface.
- **Language:** TypeScript only.
- **UI:** Terminal stdout output — same as parent.
- **Ink compatibility:** All handlers synchronous.
- **Roadmap parsing:** Read-only. `roadmap.md` is read once per session; results cached. No write-back.

---

## Edge Cases & Error States

| Scenario | Expected Behavior |
|---|---|
| `roadmap.md` missing or unparseable | `resolveSpecName` returns `null`. Notes display `(spec: #260)` without name. |
| `roadmap.md` has spec number but malformed line | Skip malformed line; continue parsing other lines. |
| `roadmap.md` has duplicate spec numbers | First match wins. |
| `/note-edit <id> --spec 999` (nonexistent spec) | Accepted — specId stored as-is. No validation against roadmap. |
| `/note-edit <id> --tag` repeated (multiple --tag) | Works via multi-flag accumulation from Spec 260A. |
| `/note-edit <id> --spec 260 --spec-remove` | `--spec-remove` wins — removes specId. |
| `/note-edit <id> --spec 260 --deadline 2026-12-31 --tag bug "new text"` | All flags applied + text updated. |
| `/note-delete <id>` and ID doesn't exist | `Note <id> not found.` |
| Delete a note then list — note gone | Verified via readNotes re-read. |

---

## Dependencies

- **Spec 260 (developer-notes):** All infrastructure — `Note`, CRUD functions, `parseNoteArgs`, formatting, i18n, command registration.
- **Spec 260A (notes-mvp):** `createNote` with `specId`, multi-flag accumulation.

## Out of Scope

- `/note-list --spec` showing spec name in list header → already done in 260A via `formatNoteList`.
- Note export (JSON, CSV, clipboard) → Future.
- Note search (full-text) → Future.
- Undo/trash for delete → Future.
- Batch operations (delete multiple, close all) → Future.
- Auto-completion for spec IDs in slash commands → Future.
