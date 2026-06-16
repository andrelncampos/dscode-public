---
name: notes-mvp
status: verified
references: V28, 260
---

# Spec 260A: Notes MVP — Design

## Design Approach

**Refinement, not rewrite.** This spec modifies 3 functions and 1 handler in the existing `notes.ts` and `command-handlers.ts` modules. Everything else remains unchanged from Spec 260. Changes are surgical:

| Scope | File | Lines Changed |
|-------|------|---------------|
| `createNote` signature + specId | `notes.ts` | ~2 |
| `parseNoteArgs` multi-flag accumulation | `notes.ts` | ~8 |
| `formatNote` smart truncation | `notes.ts` | ~5 |
| `formatNoteList` overdue days count | `notes.ts` | ~5 |
| `/note-add` handler — spec flag + tag filter | `command-handlers.ts` | ~5 |
| Tests for new behavior | `notes.test.ts` | ~50 |

**Philosophy:** No new abstractions, no new types (beyond minor type widening). Each change is independently testable. The design reuses all existing infrastructure from 260 — file I/O, ID generation, validation, CRUD, i18n.

---

## Component Modifications

### Change 1: `createNote` — Add `specId` to Options

**File:** `src/ui/core/notes.ts`
**Delta:** +1 line

```typescript
// Before:
export function createNote(text: string, options: { deadline?: string; tags?: string[] }): Note

// After:
export function createNote(text: string, options: { deadline?: string; tags?: string[]; specId?: string }): Note
```

**Internal logic unchanged.** The `specId` field is spread into the note via `...options` just like `deadline`. No validation — stored as-is. The `Note` interface already has `specId?: string`.

### Change 2: `parseNoteArgs` — Accumulate Repeated Flag Values

**File:** `src/ui/core/notes.ts`
**Delta:** ~8 lines

**Current behavior:** Repeated `--flag value` overwrites previous value. `--tag bug --tag todo` → `flags.tag = "todo"`.

**New behavior:** First `--flag value` sets `flags.flag = "value"` (string). Second `--flag value2` converts to `flags.flag = ["value", "value2"]` (string array). Third appends to array.

**Type change:**

```typescript
// Before:
export interface ParsedNoteArgs {
  positional: string[];
  flags: Record<string, string | true>;
}

// After:
export interface ParsedNoteArgs {
  positional: string[];
  flags: Record<string, string | true | string[]>;
}
```

**Algorithm modification** (inside the flag-parsing loop at line 157-172 of notes.ts):

```typescript
// Before (lines 159-168):
if (t.startsWith("--")) {
  const name = t.slice(2);
  const next = tokens[j + 1];
  if (next && !next.startsWith("--")) {
    flags[name] = next;
    j++;
  } else {
    flags[name] = true;
  }
}

// After:
if (t.startsWith("--")) {
  const name = t.slice(2);
  const next = tokens[j + 1];
  if (next && !next.startsWith("--")) {
    const existing = flags[name];
    if (existing === undefined) {
      flags[name] = next;
    } else if (typeof existing === "string") {
      flags[name] = [existing, next];
    } else if (Array.isArray(existing)) {
      existing.push(next);
    }
    // If existing is true (boolean flag), don't accumulate — string value wins.
    j++;
  } else {
    // Boolean flag: don't accumulate — overwrite is OK (true → true = no change).
    flags[name] = true;
  }
}
```

**Backward compatibility:**
- Single `--tag bug` → `flags.tag = "bug"` (unchanged).
- No-value flag `--overdue` → `flags.overdue = true` (unchanged).
- All existing tests pass because single-value and boolean flags behave identically.

**Impact on callers:** Only `/note-add` handler needs updating to handle `flags.tag` being `string | string[] | true`. The `note-list` handler already uses `typeof args.flags.status === "string"` which works correctly (a `string[]` fails the `typeof` check and falls through to `undefined`).

### Change 3: `/note-add` Handler — Extract `--spec` + Normalize `--tag`

**File:** `src/ui/core/command-handlers.ts`
**Delta:** ~5 lines

**Updated handler logic:**

```typescript
"note-add": (_item, ctx) => {
  ctx.clearSlashToken();
  const t = getActiveTFunction();
  const input = ctx.buffer.text.replace(/^\/note-add\s*/, "").trim();
  if (!input) {
    process.stdout.write(t("cmd.note-add-usage") + "\n");
    return;
  }
  const args = parseNoteArgs(input);
  const text = args.positional.join(" ");
  if (!text) {
    process.stdout.write(t("cmd.note-add-usage") + "\n");
    return;
  }
  const deadline = typeof args.flags.deadline === "string" ? args.flags.deadline : undefined;
  if (deadline && !isValidDate(deadline)) {
    process.stdout.write(t("cmd.note-invalid-date") + "\n");
    return;
  }
  // FR-A02: extract --spec
  const specId = typeof args.flags.spec === "string" ? args.flags.spec : undefined;
  if (args.flags.spec !== undefined && specId === undefined) {
    // --spec was provided but value is not a string (true or array)
    process.stdout.write(t("cmd.note-add-usage") + "\n");
    return;
  }
  // FR-A03: handle multiple --tag flags
  const rawTag = args.flags.tag;
  let tags: string[] | undefined;
  if (typeof rawTag === "string") {
    tags = [rawTag];
  } else if (Array.isArray(rawTag)) {
    tags = rawTag.filter((v): v is string => typeof v === "string");
  }
  // FR-A04: reject empty tags
  if (tags) {
    tags = tags.map(t => t.trim()).filter(t => t.length > 0);
    if (tags.length === 0) tags = undefined;
  }
  const note = createNote(text, { deadline, tags, specId });
  process.stdout.write(formatNote(note) + "\n");
  ctx.resetPromptInput();
},
```

**Key changes:**
1. `specId` extraction from `args.flags.spec` — only string values accepted; boolean `true` (flag without value) triggers usage.
2. Tag normalization handles `string | string[] | true` — filters out non-string values from array, converts single string to `[string]`, ignores `true`.
3. Empty tag filtering (FR-A04): trim all tags, remove empty strings, set to `undefined` if nothing remains.
4. `createNote` call passes `specId` alongside `deadline` and `tags`.

### Change 4: `formatNote` — Smart Truncation

**File:** `src/ui/core/notes.ts`
**Delta:** ~5 lines

```typescript
// Before (line 319):
note.text.length > 80 ? note.text.slice(0, 80) + "..." : note.text,

// After:
export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.6) {
    // Only use word boundary if it's not too far back (> 60% of maxLen).
    // This prevents a single long word at position 5 from producing 6-char output.
    return slice.slice(0, lastSpace) + "...";
  }
  return slice + "...";
}
// Usage in formatNote:
truncateText(note.text, 80),
```

**Rationale for `0.6` threshold:** If the last space is at position 5 in an 80-char string, truncating there produces `"Hello..."` (5 chars) which looks broken. The threshold ensures word-boundary truncation only happens when the truncated result is at least 60% of the original limit (48+ chars). Otherwise, hard-truncate at the limit.

### Change 5: `formatNoteList` — Overdue Days Count

**File:** `src/ui/core/notes.ts`
**Delta:** ~5 lines

```typescript
// Before (lines 344-348):
for (const note of notes) {
  const isOverdue = note.deadline && note.deadline < today();
  const prefix = isOverdue ? "\x1b[1;31mOVERDUE\x1b[0m " : "";
  lines.push(prefix + formatNote(note));
}

// After:
for (const note of notes) {
  const isOverdue = note.deadline && note.deadline < today();
  let prefix = "";
  if (isOverdue && note.deadline) {
    const deadlineDate = new Date(note.deadline + "T00:00:00Z");
    const todayDate = new Date(today() + "T00:00:00Z");
    const days = Math.floor((todayDate.getTime() - deadlineDate.getTime()) / 86400000);
    prefix = `\x1b[1;31mOVERDUE (${days}d)\x1b[0m `;
  }
  lines.push(prefix + formatNote(note));
}
```

**Days calculation:** `(today - deadline) / 86400000` with UTC dates to avoid timezone/DST edge cases. Both dates at midnight UTC.

---

## Data Flow (Updated)

### `/note-add "fix login" --tag bug --tag todo --spec 120`

```
User types command
  │
  ▼
slash-commands autocomplete matches /note-add
  │
  ▼
Enter → executeSlashCommand(item, ctx)
  │
  ▼
COMMAND_HANDLERS["note-add"](item, ctx)          ← MODIFIED
  │
  ├─ ctx.clearSlashToken()
  ├─ parseNoteArgs(buffer.text)                  ← MODIFIED: multi-flag accumulation
  │   → { positional: ["fix login"], flags: { tag: ["bug", "todo"], spec: "120" } }
  ├─ extract specId = "120"                      ← NEW
  ├─ normalize tags = ["bug", "todo"]            ← MODIFIED: Array.isArray path
  ├─ filter empty tags (pass through)            ← NEW
  ├─ createNote("fix login", { tags: ["bug", "todo"], specId: "120" })  ← MODIFIED: specId
  ├─ formatNote(note)                            ← MODIFIED: smart truncation
  ├─ process.stdout.write(...)
  └─ ctx.resetPromptInput()
```

---

## Testing Strategy

### New Tests (`src/tests/notes.test.ts`)

| Test | FR Covered | Description |
|------|------------|-------------|
| `createNote accepts specId option` | FR-A01 | `createNote("text", { specId: "120" })` → `note.specId === "120"` |
| `createNote without specId has no specId field` | FR-A01 | `createNote("text", {})` → `note.specId === undefined` |
| `parseNoteArgs accumulates repeated --tag values` | FR-A03 | `--tag a --tag b` → `flags.tag = ["a", "b"]` |
| `parseNoteArgs keeps single --tag as string` | FR-A03 | `--tag a` → `flags.tag = "a"` |
| `parseNoteArgs keeps --overdue as true` | FR-A03 | Boolean flag unchanged |
| `parseNoteArgs handles tag+spec+deadline combined` | FR-A02,A03 | Multi-flag extraction |
| `formatNote truncates at word boundary` | FR-A05 | 85-char text with space at 78 → 78 chars + `...` |
| `formatNote hard-truncates when no space` | FR-A05 | 80-char single word → 80 chars + `...` |
| `formatNote does not truncate short text` | FR-A05 | ≤80 chars unchanged |
| `formatNoteList shows overdue days count` | FR-A06 | Deadline "2020-01-01" → `OVERDUE (Nd)` badge |
| `formatNoteList no overdue badge for future deadline` | FR-A06 | Future deadline → no prefix |

### Modified Tests

Existing tests that may need adaptation:
- `parseNoteArgs extracts positional and flags` — still works (single `--tag` produces string, same assertion).
- `formatNoteList shows header and lines` — still works (adds days-count which is part of visual output).

### Integration Smoke Tests

1. `/note-add "test" --tag bug --tag todo --spec 260` → verify note created with both tags and specId.
2. `/note-add "test" --spec` → verify usage message (no spec value).
3. `/note-add "test" --tag "" --tag "valid"` → verify empty tag silently dropped.
4. `/note-list` → verify overdue notes show `OVERDUE (Nd)`.
5. `/note-list` → verify long text truncated at word boundary.

---

## File / Module Layout

```
Modified files:
  src/ui/core/notes.ts              ← createNote (+1), parseNoteArgs (+8), truncateText (+7 helper), formatNoteList (+5)
  src/ui/core/command-handlers.ts   ← /note-add handler (+5)
  src/tests/notes.test.ts           ← +11 new tests

No new files.
  src/i18n/en.ts                    ← update "cmd.note-add-usage" value (+1)
  src/i18n/es.ts                    ← update "cmd.note-add-usage" value (+1)
  src/i18n/pt.ts                    ← update "cmd.note-add-usage" value (+1)

No changes to commands.ts, slash-commands.ts.
```
