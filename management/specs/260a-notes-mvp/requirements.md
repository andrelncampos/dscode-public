---
name: notes-mvp
status: verified
references: V28, 260
---

# Spec 260A: Notes MVP — Requirements

## Value Delivery

**From V28 (Vision.md):**
> `/note-add` — create a note with optional deadline (`--deadline YYYY-MM-DD`) and tags (`--tag bug`, `--tag todo`). Returns a short ID for reference.
> `/note-list` — list notes filtered by status (`--status open|closed|paused|abandoned`), overdue items (`--overdue`), or linked spec (`--spec <id>`).
> `/note-status <id> <status>` — change status.

**From Spec 260 (parent):**
> Spec 260A and 260B are refinement specs that add polish, additional edge case handling, and spec-linking features on top of this foundation.

This spec refines the three MVP commands (`/note-add`, `/note-list`, `/note-status`) that Spec 260 already implemented. All shared infrastructure (data model, file I/O, arg parsing, formatting, i18n) is provided by the parent. This spec adds:
1. `specId` plumbing to `createNote` for spec linking on note creation.
2. Multiple `--tag` flag support (repeated flag values accumulated into an array).
3. Tag validation: reject empty tags.
4. Smart text truncation at word boundaries in note list output.
5. Enhanced overdue badge with days-ago count.

---

## Functional Requirements

### FR-A01: `createNote` Accepts `specId`

**What:** Extend `createNote` options to accept an optional `specId` field so notes can be linked to a spec at creation time.

**Why:** The parent spec's `createNote` accepts `deadline` and `tags` but not `specId`. Note creation is the most natural time to link a note to a spec. Without this, the user must create a note then manually edit the JSON to add `specId`. Spec 260B (spec linking on list) needs this plumbing.

**Acceptance Criteria:**
- [ ] `createNote` signature becomes `createNote(text: string, options: { deadline?: string; tags?: string[]; specId?: string })`.
- [ ] `specId` is stored as-is on the note (no validation beyond `typeof === "string"`).
- [ ] All existing callers continue to compile without changes (optional parameter, backward compatible).
- [ ] Unit test: `createNote("text", { specId: "120" })` produces a note with `specId: "120"`.

### FR-A02: `/note-add` Handler Extracts `--spec` Flag

**What:** The `/note-add` handler parses the `--spec` flag from user input and passes it to `createNote`.

**Why:** The current handler ignores `--spec`. The user must be able to type `/note-add "fix login" --tag bug --spec 120` and have the specId recorded.

**Acceptance Criteria:**
- [ ] Handler extracts `args.flags.spec` as `string | undefined`.
- [ ] Passes `specId` to `createNote` in the options object.
- [ ] `--spec` without a value (e.g., `--spec` at end of input) shows usage message: `Usage: /note-add <text> [--deadline YYYY-MM-DD] [--tag <tag>] [--spec <id>]`.
- [ ] Unit test verifies correct extraction from `/note-add "text" --spec 120`.

### FR-A03: Multiple `--tag` Flag Support

**What:** Support repeated `--tag` flags accumulating into a tag array.

**Why:** The current `parseNoteArgs` returns `flags: Record<string, string | true>`. With `--tag bug --tag todo`, the second value overwrites the first — only `"todo"` survives. The user expects both tags to be assigned.

**Acceptance Criteria:**
- [ ] `parseNoteArgs` accumulates repeated `--flag` values into an array: `flags.tag = ["bug", "todo"]`.
- [ ] Backward compatible: single `--tag bug` still produces `flags.tag = "bug"`.
- [ ] Boolean flags (`--flag` without value) are NOT accumulated — they stay `true`.
- [ ] The type `ParsedNoteArgs` becomes `{ positional: string[]; flags: Record<string, string | true | string[]> }`.
- [ ] All existing tests pass unchanged.

### FR-A04: Tag Validation — Reject Empty Tags

**What:** Reject tags that are empty strings or whitespace-only strings.

**Why:** `--tag ""` or `--tag "   "` produces `tags: [""]` or `tags: ["   "]` after deduplication, turning into `tags: [""]` which is nonsensical. The handler should output an error.

**Acceptance Criteria:**
- [ ] Before calling `createNote`, the handler filters `tags` array: remove entries where `.trim() === ""`.
- [ ] If all tags are empty after filtering, `tags` is set to `undefined` (no tags).
- [ ] No error message shown — silently drop empty tags (consistent with "no tags" behavior).

### FR-A05: Smart Text Truncation

**What:** When truncating note text for list display, cut at the last word boundary before or at 80 characters instead of mid-word.

**Why:** Current `formatNote` truncates at exactly 80 characters: `note.text.length > 80 ? note.text.slice(0, 80) + "..."`. This can break mid-word, reducing readability. Smart truncation at word boundaries is equally simple and produces more readable output.

**Acceptance Criteria:**
- [ ] `formatNote` truncates at the last space before or at position 80.
- [ ] If the last space is before 60% of the limit (position < 48 for limit 80), hard-truncate at 80 instead to avoid producing too-short output (e.g., a 5-char line from a space at position 5).
- [ ] If no space exists at all before position 80, hard-truncate at 80.
- [ ] Append `...` after truncation.
- [ ] Text ≤ 80 characters is unchanged.

### FR-A06: Overdue Days-Ago Count

**What:** The `OVERDUE` badge in the note list displays how many days overdue the note is.

**Why:** Current badge shows `OVERDUE` in red bold for any past deadline. Knowing *how* overdue (1 day vs 30 days) helps the user prioritize without additional commands.

**Acceptance Criteria:**
- [ ] `formatNoteList` prepends `OVERDUE (Nd)` where N is days between deadline and today (e.g., `OVERDUE (5d)`).
- [ ] Uses `Math.floor((today - deadline) / 86400000)` for day calculation.
- [ ] Same red bold ANSI styling preserved (`\x1b[1;31m`).
- [ ] Unit test verifies: note with deadline "2026-01-01" and today "2026-06-16" produces `OVERDUE (166d)` or similar.

---

## Non-Functional Requirements

### NFR-A01: Backward Compatibility

**What:** All changes are backward compatible with existing code in Spec 260. No existing tests may break. No existing handler signatures change.

**Acceptance Criteria:**
- [ ] `npx tsx --test 'src/tests/**/*.test.ts'` passes with zero new failures.
- [ ] All 30 existing notes.test.ts tests pass unchanged.
- [ ] No changes to `command-handlers.ts`, `slash-commands.ts`, or `commands.ts` beyond the 3 handlers being refined.
- [ ] No new i18n keys needed (reuse existing keys where possible, add only if absolutely necessary).

### NFR-A02: Zero New Dependencies

**What:** Same as parent Spec 260 — only `node:fs`, `node:crypto`, `node:path`.

**Acceptance Criteria:**
- [ ] `package.json` unchanged.

---

## Constraints

- **Storage:** No changes to `.dscode/notes.json` schema. Same `Note` interface with `specId` field (already exists).
- **Language:** TypeScript only.
- **UI:** Terminal stdout output — same as parent.
- **Ink compatibility:** All handlers synchronous.

---

## Edge Cases & Error States

| Scenario | Expected Behavior |
|---|---|
| `/note-add "text" --spec` (no value) | Usage message listing all flags including `--spec <id>`. |
| `/note-add "text" --tag "" --tag "valid"` | Empty tag silently dropped. Result: `tags: ["valid"]`. |
| `/note-add "text" --tag ""` | All tags empty → `tags` absent from note. |
| `/note-add "text" --spec 260 --deadline 2026-07-01 --tag bug` | All flags extracted correctly; `createNote` receives `{ deadline, tags: ["bug"], specId: "260" }`. |
| Note text exactly 80 chars ending in a space | Truncate at that space (79 chars + `...`). |
| Note text 80 chars with no spaces (URL, hash) | Hard truncate at 80 + `...`. |
| `--tag bug --tag bug` (duplicate) | Both collected, deduplication in `createNote` removes duplicate. |
| Overdue note from 2020-01-01 with today 2026-06-16 | Displays `OVERDUE (2359d)` — large numbers are acceptable. |

---

## Dependencies

- **Spec 260 (developer-notes):** Provides all infrastructure — `Note`, `NoteStatus`, `ParsedNoteArgs`, `readNotes`, `writeNotes`, `createNote`, `listNotes`, `updateNoteStatus`, `formatNote`, `formatNoteList`, `parseNoteArgs`, `isValidDate`, `isValidStatus`, command registration, i18n keys.
- **Spec 260B (notes-refinement):** Consumes `createNote` with `specId` support from this spec for its spec linking features.

## Out of Scope

- `/note-edit` and `/note-deadline` refinements → Spec 260B.
- Full spec linking (showing spec name, `--spec` filtering on `/note-list`, `--spec` in `/note-edit`) → Spec 260B.
- Edit/delete confirmation prompts → Spec 260B.
- Note export (JSON, CSV, clipboard) → Future.
- Note search (full-text) → Future.
- Any changes to the Note data model (fields, types) beyond what already exists in parent.
