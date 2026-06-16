---
name: notes-refinement
status: verified
references: V28, 260, 260A
---

# Spec 260B: Notes Refinement — Design

## Design Approach

**Refinement, not rewrite.** This spec modifies `formatNote`, `formatNoteList`, 2 handlers (`note-edit`, `note-status`), and adds 1 new command (`note-delete`). A new helper module `spec-names.ts` handles roadmap parsing.

| Scope | File | Lines Changed |
|-------|------|---------------|
| `resolveSpecName` + caching | `src/ui/core/spec-names.ts` (new) | ~35 |
| `formatNote` uses spec name | `src/ui/core/notes.ts` | ~3 |
| `formatNoteList` header uses spec name | `src/ui/core/notes.ts` | ~3 |
| `/note-edit` handler — metadata flags | `src/ui/core/command-handlers.ts` | +25 |
| `/note-status` handler — confirmation | `src/ui/core/command-handlers.ts` | +3 |
| `/note-delete` handler — new | `src/ui/core/command-handlers.ts` | +20 |
| Command registration (delete) | `commands.ts` + `slash-commands.ts` | +3 |
| I18n keys (7 new + 1 updated) | `en.ts`, `es.ts`, `pt.ts` | +21 |
| Tests | `notes.test.ts` + `spec-names.test.ts` (new) | ~70 |

---

## Component: Spec Name Resolution

### `src/ui/core/spec-names.ts` (new file)

```typescript
import fs from "node:fs";
import path from "node:path";

const ROADMAP_PATH = path.join("management", "roadmap.md");

let _cache: Map<string, string> | null = null;

function parseSpecNames(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const content = fs.readFileSync(ROADMAP_PATH, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      // Match spec table rows: | NNN | name | status | ...
      const match = line.match(/^\|\s*(\d+[A-Z]?)\s*\|\s*([^|]+?)\s*\|/);
      if (match) {
        map.set(match[1], match[2].trim());
      }
    }
  } catch {
    // File missing or unreadable — cache stays empty.
  }
  return map;
}

export function resolveSpecName(specId: string): string | null {
  if (!_cache) {
    _cache = parseSpecNames();
  }
  return _cache.get(specId) ?? null;
}

// Exposed for testing
export function clearSpecNameCache(): void {
  _cache = null;
}
```

**Cache lifetime:** `_cache` is module-level, populated on first call. Subsequent calls return cached results. Session-scoped (process lifetime). `clearSpecNameCache()` for test isolation.

**Parsing:** Regex `/^\|\s*(\d+[A-Z]?)\s*\|\s*([^|]+?)\s*\|/` matches spec table rows like `| 260 | developer-notes | audited | V28 |`. Captures spec number (group 1) and name (group 2). Non-matching lines (headers, separators, dependency graph) are ignored.

---

## Component Modifications

### Change 1: `formatNote` — Show Spec Name

**File:** `src/ui/core/notes.ts`
**Delta:** ~3 lines

```typescript
// Before (line ~327):
if (note.specId) {
  parts.push(`(spec: #${note.specId})`);
}

// After:
if (note.specId) {
  const name = resolveSpecName(note.specId);
  const label = name ? `#${note.specId} ${name}` : `#${note.specId}`;
  parts.push(`(spec: ${label})`);
}
```

### Change 2: `formatNoteList` Header — Show Spec Name

**File:** `src/ui/core/notes.ts`
**Delta:** ~3 lines

```typescript
// Before (line ~356):
if (filters.specId) filterParts.push(`spec: #${filters.specId}`);

// After:
if (filters.specId) {
  const name = resolveSpecName(filters.specId);
  const label = name ? `#${filters.specId} ${name}` : `#${filters.specId}`;
  filterParts.push(`spec: ${label}`);
}
```

### Change 3: `/note-delete` — New Command

**Registration:** Add `"note-delete"` to `COMMAND_KINDS`, `BUILTIN_SLASH_COMMANDS`, and `COMMAND_HANDLERS`.

**Handler logic:**

```typescript
"note-delete": (_item, ctx) => {
  ctx.clearSlashToken();
  const t = getActiveTFunction();
  const input = ctx.buffer.text.replace(/^\/note-delete\s*/, "").trim();
  if (!input) {
    process.stdout.write(t("cmd.note-delete-usage") + "\n");
    return;
  }
  const id = input.split(/\s+/)[0];
  const notes = readNotes();
  const idx = notes.findIndex(n => n.id === id);
  if (idx === -1) {
    process.stdout.write(t("cmd.note-not-found", { id }) + "\n");
    return;
  }
  notes.splice(idx, 1);
  writeNotes(notes);
  process.stdout.write(t("cmd.note-deleted", { id }) + "\n");
  ctx.resetPromptInput();
},
```

**No new CRUD function needed** — `readNotes()` + `Array.splice()` + `writeNotes()` is sufficient and KISS. The logic is only 3 lines; abstracting it to a `deleteNote()` function would add indirection without benefit.

### Change 4: `/note-edit` Handler — Metadata Flags

**Current handler** (simplified): takes `id` and `text` from positional args, calls `updateNoteText()`.

**New handler** — parses positional args for text AND flags for metadata:

```typescript
"note-edit": (_item, ctx) => {
  ctx.clearSlashToken();
  const t = getActiveTFunction();
  const input = ctx.buffer.text.replace(/^\/note-edit\s*/, "").trim();
  const args = parseNoteArgs(input);
  const id = args.positional[0];
  const text = args.positional.slice(1).join(" ") || undefined;
  if (!id) {
    process.stdout.write(t("cmd.note-edit-usage") + "\n");
    return;
  }
  // Resolve spec change
  const specId = typeof args.flags.spec === "string" ? args.flags.spec : undefined;
  const specRemove = args.flags["spec-remove"] === true;
  // Resolve tags
  const rawTag = args.flags.tag;
  let tags: string[] | undefined;
  if (typeof rawTag === "string") {
    tags = [rawTag];
  } else if (Array.isArray(rawTag)) {
    tags = rawTag.filter((v): v is string => typeof v === "string");
  }
  if (tags) {
    tags = tags.map(t => t.trim()).filter(t => t.length > 0);
    if (tags.length === 0) tags = undefined;
  }
  // Resolve deadline
  const deadline = typeof args.flags.deadline === "string"
    ? args.flags.deadline : undefined;
  if (deadline && !isValidDate(deadline)) {
    process.stdout.write(t("cmd.note-invalid-date") + "\n");
    return;
  }
  // Must have at least one change
  if (!text && specId === undefined && !specRemove && tags === undefined && !deadline) {
    process.stdout.write(t("cmd.note-edit-usage") + "\n");
    return;
  }
  // Apply changes
  const notes = readNotes();
  const idx = notes.findIndex(n => n.id === id);
  if (idx === -1) {
    process.stdout.write(t("cmd.note-not-found", { id }) + "\n");
    return;
  }
  const note = notes[idx];
  if (text !== undefined) {
    note.text = text;
  }
  if (specRemove) {
    delete note.specId;
  } else if (specId !== undefined) {
    note.specId = specId;
  }
  if (tags !== undefined) {
    if (tags.length > 0) {
      note.tags = tags;
    } else {
      delete note.tags;
    }
  }
  if (deadline !== undefined) {
    note.deadline = deadline;
  }
  note.updatedAt = now();
  writeNotes(notes);
  process.stdout.write(t("cmd.note-updated", { id }) + "\n");
  process.stdout.write(formatNote(note) + "\n");
  ctx.resetPromptInput();
},
```

**Note:** The `now()` function must be exported from `notes.ts` (change `function now()` to `export function now()` on line 91). The handler calls `now()` via the import to set `updatedAt`.

**Key decisions:**
- `--spec-remove` overrides `--spec` if both present.
- Text is optional — metadata-only edits are valid.

### Change 5: Confirmation Messages

**`/note-status` handler** — add confirmation line:

```typescript
// Before:
process.stdout.write(formatNote(note) + "\n");

// After:
process.stdout.write(t("cmd.note-status-changed", { id, from: oldStatus, to: status }) + "\n");
process.stdout.write(formatNote(note) + "\n");
```

Need to save `oldStatus` before calling `updateNoteStatus()`.

**`/note-deadline` handler** — add confirmation:

```typescript
// Before:
process.stdout.write(formatNote(note) + "\n");

// After:
const msg = remove ? t("cmd.note-deadline-removed", { id }) : t("cmd.note-deadline-set", { id });
process.stdout.write(msg + "\n");
process.stdout.write(formatNote(note) + "\n");
```

---

## I18n Keys

New keys to add to `en.ts`, `es.ts`, `pt.ts`:

| Key | en | es | pt |
|---|---|---|---|
| `cmd.note-delete` | Delete a note by its short ID | Eliminar una nota por su ID corto | Excluir uma nota pelo seu ID curto |
| `cmd.note-delete-usage` | Usage: /note-delete `<id>` | Uso: /note-delete `<id>` | Uso: /note-delete `<id>` |
| `cmd.note-deleted` | Note {{id}} deleted. | Nota {{id}} eliminada. | Nota {{id}} excluída. |
| `cmd.note-updated` | Note {{id}} updated. | Nota {{id}} actualizada. | Nota {{id}} atualizada. |
| `cmd.note-status-changed` | Note {{id}} status: {{from}} → {{to}}. | Nota {{id}} estado: {{from}} → {{to}}. | Nota {{id}} status: {{from}} → {{to}}. |
| `cmd.note-deadline-set` | Note {{id}} deadline set. | Nota {{id}} fecha límite establecida. | Nota {{id}} prazo definido. |
| `cmd.note-deadline-removed` | Note {{id}} deadline removed. | Nota {{id}} fecha límite eliminada. | Nota {{id}} prazo removido. |

Update existing `cmd.note-edit-usage` to include new flags:

| Key | en (updated) |
|---|---|
| `cmd.note-edit-usage` | `Usage: /note-edit <id> ["text"] [--tag <tag>] [--deadline YYYY-MM-DD] [--spec <id>] [--spec-remove]` |

Also update `es.ts` and `pt.ts` equivalently.

---

## Data Flow

### `/note-delete abc1`

```
User types command
  │
  ▼
COMMAND_HANDLERS["note-delete"](item, ctx)
  │
  ├─ parse ID from input
  ├─ readNotes()
  ├─ findIndex by id → 2
  ├─ splice(2, 1)
  ├─ writeNotes(notes)
  ├─ process.stdout.write(t("cmd.note-deleted", { id: "abc1" }))
  └─ ctx.resetPromptInput()
```

### `/note-edit abc1 --tag bug --spec 260`

```
User types command
  │
  ▼
COMMAND_HANDLERS["note-edit"](item, ctx)
  │
  ├─ parseNoteArgs(input)
  │   → { positional: ["abc1"], flags: { tag: "bug", spec: "260" } }
  ├─ extract id="abc1", text=undefined
  ├─ extract tags=["bug"], specId="260"
  ├─ no deadline
  ├─ find note by id
  ├─ note.tags = ["bug"], note.specId = "260"
  ├─ note.updatedAt = now()
  ├─ writeNotes(notes)
  ├─ process.stdout.write("Note abc1 updated.\n")
  ├─ process.stdout.write(formatNote(note))
  └─ ctx.resetPromptInput()
```

---

## Testing Strategy

### New Tests (`src/tests/spec-names.test.ts`)

| Test | FR Covered |
|------|------------|
| `resolveSpecName returns name for known spec` | FR-B01 |
| `resolveSpecName returns null for unknown spec` | FR-B01 |
| `resolveSpecName returns null when roadmap missing` | Edge case |
| `resolveSpecName caches results` | FR-B01 |

### New Tests (`src/tests/notes.test.ts`)

| Test | FR Covered |
|------|------------|
| `formatNote shows spec name when available` | FR-B01 |
| `formatNote shows spec number only when name unresolved` | FR-B01 |
| `formatNoteList header shows spec name` | FR-B01 |
| `note-delete removes note from file` | FR-B03 |
| `note-delete shows not found for missing id` | FR-B03 |
| `note-delete removes note from file` | FR-B03 |

### Modified Tests

Existing tests that may need adaptation:
- `formatNote omits absent optional fields` — still works (no specId → no spec line).
- `formatNoteList shows header and lines` — still works (spec name in header if specId filter active).
- `formatNoteList shows overdue days count` — still works.

### Integration Smoke Tests

1. `/note-add "test" --spec 260` → verify `(spec: #260 developer-notes)` in output.
2. `/note-list --spec 260` → header shows `spec: #260 developer-notes`.
3. `/note-edit <id> --tag bug` → verify tag changed, confirmation shown.
4. `/note-edit <id> --spec 260` → verify specId changed.
5. `/note-delete <id>` → verify confirmation, list shows note gone.
6. `/note-delete <nonexistent>` → verify error message.

---

## File / Module Layout

```
New files:
  src/ui/core/spec-names.ts           ← ~35 lines (read roadmap, parse, cache)

Modified files:
  src/ui/core/notes.ts                ← formatNote (+3), formatNoteList (+3), import resolveSpecName, export now()
  src/ui/core/command-handlers.ts     ← note-edit refactor (+25), note-delete new (+20), note-status (+3), note-deadline (+3)
  src/ui/types/commands.ts            ← +1 command kind
  src/ui/core/slash-commands.ts       ← +1 command entry
  src/i18n/en.ts                      ← +7 new keys, update cmd.note-edit-usage
  src/i18n/es.ts                      ← +7 new keys, update cmd.note-edit-usage
  src/i18n/pt.ts                      ← +7 new keys, update cmd.note-edit-usage
  src/tests/notes.test.ts             ← +6 new tests
  src/tests/spec-names.test.ts        ← new file, ~4 tests

No new npm dependencies.
```
