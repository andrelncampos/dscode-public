---
name: developer-notes
status: created
references: V28
---

# Spec 260: Developer Notes — Design

## Design Approach

**Module:** New file `src/ui/core/notes.ts` — a pure TypeScript module with zero React/Ink dependency.

**Pattern:** Synchronous CRUD on a local JSON file. All functions are deterministic given the same inputs. The module is a thin domain layer: types, file I/O, arg parsing, formatting. Command handlers in `command-handlers.ts` delegate to this module.

**Philosophy:** No DAO, no repository pattern, no DI. A single file module with exported functions. The notes file path is hardcoded relative to `process.cwd()` + `".dscode/notes.json"`. This is KISS applied ruthlessly — we are not building an extensible note engine, we are building one specific tool.

**Why no async:** All slash command handlers run inside React/Ink render cycles. Async handlers cause state inconsistencies (Ink doesn't await them). Synchronous `fs.readFileSync`/`fs.writeFileSync` on a local JSON file is < 1ms for files under 10MB — far below the perception threshold.

**Why stdout, not Ink components:** Terminal features that use Ink rendering suffer from the bugs documented in L7 (untestable escape sequences) and L9 (layout multiplication on resize). Writing to `process.stdout` bypasses Ink entirely — the output is pure text, testable via stdout capture, and never triggers layout cycles.

---

## Architecture Decisions

### ADR-260-001: Single JSON File vs SQLite

**Decision:** Store notes in `.dscode/notes.json` as a flat JSON array.

**Rationale:**
- P6 prohibits adding new dependencies without justification. SQLite would require `better-sqlite3` or similar, which adds native compilation complexity.
- Notes are a personal developer tool, expected to hold < 1,000 entries. JSON `Array.filter().sort()` at this scale is < 1ms.
- JSON is human-editable: the developer can open `.dscode/notes.json` in any editor.
- `.dscode/settings.json` already uses this pattern — consistency.

### ADR-260-002: Temp-and-Rename for Crash Safety

**Decision:** `writeNotes()` writes to `notes.json.tmp` first, then `fs.renameSync(temp, target)`.

**Rationale:**
- On POSIX, `rename` is atomic if source and destination are on the same filesystem.
- On Windows, `rename` on NTFS is atomic for file replacement (it's a metadata operation).
- If the process crashes between `writeFileSync(tmp)` and `renameSync(tmp, target)`, the original file is untouched. Next write overwrites the stale temp file.
- No need for file locks — the app is single-process.

### ADR-260-003: Synchronous Everything

**Decision:** All note functions are synchronous. No `async`, no `Promise`, no `await`.

**Rationale:**
- Existing slash command handlers in `command-handlers.ts` are synchronous (e.g., `cls`, the old `keys` handler).
- The `CommandHandler` type is `(item: SlashCommandItem, ctx: CommandContext) => void` — not `Promise<void>`.
- Node.js `readFileSync`/`writeFileSync` on small files is non-blocking enough for CLI use (< 1ms).
- Async would require changing the handler type, which is out of scope for this spec.

---

## Component / Module Breakdown

### Component: `src/ui/core/notes.ts` — Types

```typescript
export type NoteStatus = "open" | "closed" | "paused" | "abandoned";

export interface Note {
  id: string;           // 4 lowercase hex chars
  text: string;         // note body
  status: NoteStatus;   // always one of the 4 statuses
  createdAt: string;    // ISO 8601 with seconds, UTC
  updatedAt: string;    // ISO 8601 with seconds, UTC
  deadline?: string;    // YYYY-MM-DD, absent if no deadline
  tags?: string[];      // lowercase, deduplicated on write, absent if empty
  specId?: string;      // spec number as string, absent if not linked
}

export interface ParsedNoteArgs {
  positional: string[];
  flags: Record<string, string | true>;
}
```

### Component: `src/ui/core/notes.ts` — File I/O

```typescript
const NOTES_PATH = path.join(".dscode", "notes.json");
const NOTES_TMP = path.join(".dscode", "notes.json.tmp");

export function readNotes(): Note[]
```

**Internal Logic:**
1. Call `fs.existsSync(NOTES_PATH)`. If false, return `[]`.
2. Read file with `fs.readFileSync(NOTES_PATH, "utf8")`.
3. Parse with `JSON.parse(content)`.
4. If result is `Array.isArray`, cast to `Note[]` and return.
5. If result is not an array, or if `JSON.parse` throws, return `[]`.
6. Do NOT validate individual note shapes — trust the JSON. If a note is malformed, it's handled at the call site (e.g., `listNotes` skips entries missing required fields).

**Error Handling:** Catches `JSON.parse` errors. Returns `[]` on any failure. Never throws — the handler displays "No notes found" which is safer than crashing.

```typescript
export function writeNotes(notes: Note[]): void
```

**Internal Logic:**
1. Ensure `.dscode/` exists: `fs.mkdirSync(dirname(NOTES_PATH), { recursive: true })`.
2. Serialize: `JSON.stringify(notes, null, 2)` for human readability.
3. Write to temp: `fs.writeFileSync(NOTES_TMP, json, "utf8")`.
4. Atomically replace: `fs.renameSync(NOTES_TMP, NOTES_PATH)`.
5. Sync to disk: `const fd = fs.openSync(NOTES_PATH, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }`. This syncs the file data itself to disk. On Windows, `fsyncSync` on the file handle flushes the write cache. Directory sync is not needed — `renameSync` is atomic on NTFS.

**Error Handling:** Let errors propagate. If the disk is full, the handler catches and displays a status message.

### Component: `src/ui/core/notes.ts` — ID Generation

```typescript
export function generateNoteId(existingIds: Set<string>): string
```

**Internal Logic:**
1. Loop max 100 times:
   a. `crypto.randomBytes(2).toString("hex")` → 4-char hex string.
   b. If not in `existingIds`, return it.
2. If loop exhausts, throw `new Error("note ID generation exhausted after 100 attempts")`.

### Component: `src/ui/core/notes.ts` — Arg Parsing

```typescript
export function parseNoteArgs(input: string): ParsedNoteArgs
```

**Internal Logic:**
1. Remove leading slash-command prefix: locate first space after initial token, take everything after it.
2. Tokenize: use a simple state machine over `input.trim()`:
   - Space → push current token if non-empty.
   - `"` → enter quote mode, accumulate until closing `"`, push as single token.
   - `-` → start of flag. If followed by `-`, it's a long flag (`--tag`). Accumulate flag name until space or `=` or end. If `=`, value follows. If space, next token is value unless it starts with `-`.
   - Default → accumulate into current token.
3. Parse tokens:
   - If token starts with `--`: check next token. If next token exists and does NOT start with `--`, it's a value → `flags[name] = value` and skip next token. If next token starts with `--` or doesn't exist, `flags[name] = true`.
   - Otherwise: push to `positional` array.
4. Return `{ positional, flags }`.

### Component: `src/ui/core/notes.ts` — CRUD Operations

```typescript
export function createNote(
  text: string,
  options: { deadline?: string; tags?: string[] }
): Note
```

**Internal Logic:**
1. `const notes = readNotes()`.
2. `const id = generateNoteId(new Set(notes.map(n => n.id)))`.
3. `const now = new Date().toISOString().replace(/\..+/, "")` → `"2026-06-16T13:00:00"`.
4. `const note: Note = { id, text, status: "open", createdAt: now, updatedAt: now, ...options }`.
5. If `tags` present, deduplicate with `[...new Set(tags.map(t => t.toLowerCase().trim()))]`.
6. If tags array empty after dedup, delete `tags` key.
7. `notes.push(note)`, `writeNotes(notes)`.
8. Return `note`.

```typescript
export function listNotes(filters: {
  status?: NoteStatus;
  overdue?: boolean;
  specId?: string;
}): Note[]
```

**Internal Logic:**
1. `const notes = readNotes()`.
2. Apply filters sequentially:
   - If `status`: `notes.filter(n => n.status === status)`.
   - If `overdue`: `notes.filter(n => n.deadline && n.deadline < today())` where `today()` returns `YYYY-MM-DD`.
   - If `specId`: `notes.filter(n => n.specId === specId)`.
3. Sort:
   - Overdue first (by deadline ascending).
   - Open (by deadline ascending if deadline exists, otherwise by createdAt descending).
   - Paused (by createdAt descending).
   - Closed (by createdAt descending).
   - Abandoned (by createdAt descending).
4. Return sorted array.

```typescript
export function updateNoteStatus(id: string, status: NoteStatus): Note | null
```

**Internal Logic:**
1. `const notes = readNotes()`.
2. `const idx = notes.findIndex(n => n.id === id)`. If -1, return null.
3. `notes[idx].status = status`.
4. `notes[idx].updatedAt = now()`.
5. `writeNotes(notes)`.
6. Return `notes[idx]`.

```typescript
export function updateNoteText(id: string, text: string): Note | null
```

**Internal Logic:**
1. `const notes = readNotes()`.
2. `const idx = notes.findIndex(n => n.id === id)`. If -1, return null.
3. `notes[idx].text = text`.
4. `notes[idx].updatedAt = now()`.
5. `writeNotes(notes)`.
6. Return `notes[idx]`.

```typescript
export function updateNoteDeadline(
  id: string,
  deadline: string | null
): Note | null
```

**Internal Logic:**
1. `const notes = readNotes()`.
2. `const idx = notes.findIndex(n => n.id === id)`. If -1, return null.
3. If `deadline === null`: `delete notes[idx].deadline`.
4. Else: `notes[idx].deadline = deadline` (after validation).
5. `notes[idx].updatedAt = now()`.
6. `writeNotes(notes)`.
7. Return `notes[idx]`.
```

### Component: `src/ui/core/notes.ts` — Formatting

```typescript
export function formatNote(note: Note): string
```

**Internal Logic:**
1. Status color: `"open"` → `\x1b[33m`, `"closed"` → `\x1b[32m`, `"paused"` → `\x1b[2m`, `"abandoned"` → `\x1b[31m`. Reset: `\x1b[0m`.
2. Build parts array:
   - `[${note.id}]`
   - Colorized status: `${color}${note.status.toUpperCase()}\x1b[0m`
   - Truncate text to 80 chars if longer, add `...`.
   - If `note.deadline`: `(deadline: ${note.deadline})`
   - If `note.tags && note.tags.length > 0`: `(tags: ${note.tags.join(", ")})`
   - If `note.specId`: `(spec: #${note.specId})`
3. Join with space.

```typescript
export function formatNoteList(
  notes: Note[],
  filters: { status?: NoteStatus; overdue?: boolean; specId?: string }
): string
```

**Internal Logic:**
1. Header: `\x1b[1m═══ NOTES ═══\x1b[0m` with filter description.
2. Map each note to formatted line. Prepend `\x1b[1;31mOVERDUE\x1b[0m ` if overdue.
3. Join with `\n`.
4. Caller is responsible for checking `notes.length === 0` and showing the localized empty message via `t("cmd.note-list-empty")` before calling this function. This function assumes non-empty input.

### Component: `src/ui/core/notes.ts` — Validation

```typescript
export function isValidDate(dateStr: string): boolean
```

**Internal Logic:**
1. Match `/^\d{4}-\d{2}-\d{2}$/`.
2. `new Date(dateStr + "T00:00:00Z")` — check `!isNaN(d.getTime())`.
3. Check month is 01-12, day is valid for that month (incl. leap years).

```typescript
export function isValidStatus(status: string): status is NoteStatus
```

**Internal Logic:**
1. `["open", "closed", "paused", "abandoned"].includes(status)`.

### Component: Command Handlers (in `command-handlers.ts`)

Five new handlers registered in `COMMAND_HANDLERS`:

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
  const tags = args.flags.tag 
    ? (Array.isArray(args.flags.tag) ? args.flags.tag : [args.flags.tag])
    : undefined;
  const note = createNote(text, { deadline, tags });
  process.stdout.write(formatNote(note) + "\n");
  ctx.resetPromptInput();
},

"note-list": (_item, ctx) => {
  ctx.clearSlashToken();
  const t = getActiveTFunction();
  const input = ctx.buffer.text.replace(/^\/note-list\s*/, "").trim();
  const args = parseNoteArgs(input);
  const status = typeof args.flags.status === "string" 
    ? (isValidStatus(args.flags.status) ? args.flags.status : null)
    : undefined;
  if (args.flags.status && !status) {
    process.stdout.write(t("cmd.note-invalid-status") + "\n");
    return;
  }
  const overdue = args.flags.overdue === true;
  const specId = typeof args.flags.spec === "string" ? args.flags.spec : undefined;
  const notes = listNotes({ status, overdue, specId });
  if (notes.length === 0) {
    process.stdout.write(t("cmd.note-list-empty") + "\n");
  } else {
    process.stdout.write(formatNoteList(notes, { status, overdue, specId }) + "\n");
  }
  ctx.resetPromptInput();
},

"note-status": (_item, ctx) => {
  ctx.clearSlashToken();
  const t = getActiveTFunction();
  const input = ctx.buffer.text.replace(/^\/note-status\s*/, "").trim();
  const parts = input.split(/\s+/);
  const id = parts[0];
  const status = parts[1];
  if (!id || !status) {
    process.stdout.write(t("cmd.note-status-usage") + "\n");
    return;
  }
  if (!isValidStatus(status)) {
    process.stdout.write(t("cmd.note-invalid-status") + "\n");
    return;
  }
  const note = updateNoteStatus(id, status as NoteStatus);
  if (!note) {
    process.stdout.write(t("cmd.note-not-found", { id }) + "\n");
    return;
  }
  process.stdout.write(formatNote(note) + "\n");
  ctx.resetPromptInput();
},

"note-edit": (_item, ctx) => {
  ctx.clearSlashToken();
  const t = getActiveTFunction();
  const input = ctx.buffer.text.replace(/^\/note-edit\s*/, "").trim();
  const args = parseNoteArgs(input);
  const id = args.positional[0];
  const text = args.positional.slice(1).join(" ");
  if (!id || !text) {
    process.stdout.write(t("cmd.note-edit-usage") + "\n");
    return;
  }
  const note = updateNoteText(id, text);
  if (!note) {
    process.stdout.write(t("cmd.note-not-found", { id }) + "\n");
    return;
  }
  process.stdout.write(formatNote(note) + "\n");
  ctx.resetPromptInput();
},

"note-deadline": (_item, ctx) => {
  ctx.clearSlashToken();
  const t = getActiveTFunction();
  const input = ctx.buffer.text.replace(/^\/note-deadline\s*/, "").trim();
  const args = parseNoteArgs(input);
  const id = args.positional[0];
  if (!id) {
    process.stdout.write(t("cmd.note-deadline-usage") + "\n");
    return;
  }
  const remove = args.flags.remove === true;
  const deadline = remove ? null : (args.positional[1] ?? null);
  if (!remove && !deadline) {
    process.stdout.write(t("cmd.note-deadline-usage") + "\n");
    return;
  }
  if (deadline && typeof deadline === "string" && !isValidDate(deadline)) {
    process.stdout.write(t("cmd.note-invalid-date") + "\n");
    return;
  }
  const note = updateNoteDeadline(id, deadline as string | null);
  if (!note) {
    process.stdout.write(t("cmd.note-not-found", { id }) + "\n");
    return;
  }
  process.stdout.write(formatNote(note) + "\n");
  ctx.resetPromptInput();
},
```

### Component: I18n Keys

Keys to add to `en.ts`, `es.ts`, `pt.ts`:

| Key | en | es | pt |
|---|---|---|---|
| `cmd.note-add` | Create a quick note/reminder with optional deadline and tags | Crear una nota rápida con fecha límite y etiquetas opcionales | Criar uma nota rápida com prazo e tags opcionais |
| `cmd.note-list` | List notes filtered by status, overdue, or linked spec | Listar notas filtradas por estado, vencidas o spec vinculada | Listar notas filtradas por status, vencidas ou spec vinculada |
| `cmd.note-status` | Change note status (open, closed, paused, abandoned) | Cambiar estado de nota (open, closed, paused, abandoned) | Alterar status da nota (open, closed, paused, abandoned) |
| `cmd.note-edit` | Edit note text in-place | Editar texto de nota sin salir del terminal | Editar texto da nota sem sair do terminal |
| `cmd.note-deadline` | Set, change, or remove note deadline | Definir, cambiar o eliminar fecha límite | Definir, alterar ou remover prazo da nota |
| `cmd.note-add-usage` | Usage: /note-add <text> [--deadline YYYY-MM-DD] [--tag <tag>] | Uso: /note-add <texto> [--deadline AAAA-MM-DD] [--tag <tag>] | Uso: /note-add <texto> [--deadline AAAA-MM-DD] [--tag <tag>] |
| `cmd.note-list-empty` | No notes found. Use /note-add <text> to create one. | No se encontraron notas. Usa /note-add <texto> para crear una. | Nenhuma nota encontrada. Use /note-add <texto> para criar uma. |
| `cmd.note-not-found` | Note {{id}} not found. | Nota {{id}} no encontrada. | Nota {{id}} não encontrada. |
| `cmd.note-invalid-status` | Invalid status. Use: open, closed, paused, abandoned. | Estado inválido. Usa: open, closed, paused, abandoned. | Status inválido. Use: open, closed, paused, abandoned. |
| `cmd.note-invalid-date` | Invalid date format. Use YYYY-MM-DD. | Formato de fecha inválido. Usa AAAA-MM-DD. | Formato de data inválido. Use AAAA-MM-DD. |
| `cmd.note-status-usage` | Usage: /note-status <id> <status> | Uso: /note-status <id> <estado> | Uso: /note-status <id> <status> |
| `cmd.note-edit-usage` | Usage: /note-edit <id> "<new text>" | Uso: /note-edit <id> "<nuevo texto>" | Uso: /note-edit <id> "<novo texto>" |
| `cmd.note-deadline-usage` | Usage: /note-deadline <id> <YYYY-MM-DD> \| --remove | Uso: /note-deadline <id> <AAAA-MM-DD> \| --remove | Uso: /note-deadline <id> <AAAA-MM-DD> \| --remove |

---

## Data Flow

### `/note-add "fix login" --tag bug --deadline 2026-07-01`

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
COMMAND_HANDLERS["note-add"](item, ctx)
  │
  ├─ ctx.clearSlashToken()         ← clears slash dropdown UI
  ├─ parseNoteArgs(buffer.text)    ← { positional: ["fix login"], flags: { tag: "bug", deadline: "2026-07-01" } }
  ├─ isValidDate("2026-07-01")     ← true
  ├─ createNote("fix login", { deadline: "2026-07-01", tags: ["bug"] })
  │   ├─ readNotes()               ← reads .dscode/notes.json → existing Note[]
  │   ├─ generateNoteId(existing)  ← "a3f9"
  │   ├─ build Note object         ← { id: "a3f9", text: "fix login", status: "open", ... }
  │   ├─ writeNotes([...existing, newNote])
  │   │   ├─ writeFileSync(tmp)    ← notes.json.tmp
  │   │   └─ renameSync(tmp, real) ← notes.json  (atomic)
  │   └─ return newNote
  ├─ formatNote(note)              ← "[a3f9] OPEN fix login (tags: bug) (deadline: 2026-07-01)"
  ├─ process.stdout.write(...)     ← terminal output
  └─ ctx.resetPromptInput()        ← clears prompt buffer
```

### `/note-list --overdue`

```
User types command
  │
  ▼
COMMAND_HANDLERS["note-list"](item, ctx)
  │
  ├─ parseNoteArgs(buffer.text)    ← { positional: [], flags: { overdue: true } }
  ├─ listNotes({ overdue: true })
  │   ├─ readNotes()               ← reads all notes
  │   ├─ filter overdue            ← n.deadline && n.deadline < today
  │   └─ sort                      ← overdue deadline ascending
  ├─ formatNoteList(notes)         ← header + lines or empty message
  ├─ process.stdout.write(...)
  └─ ctx.resetPromptInput()
```

---

## File / Module Layout

```
New files:
  src/ui/core/notes.ts              ← ~250 lines (types + I/O + CRUD + parsing + formatting)

Modified files:
  src/ui/types/commands.ts          ← add 5 command kinds to COMMAND_KINDS array
  src/ui/core/slash-commands.ts     ← add 5 entries to BUILTIN_SLASH_COMMANDS
  src/ui/core/command-handlers.ts   ← add 5 handlers to COMMAND_HANDLERS + import notes functions
  src/i18n/en.ts                    ← add 13 i18n keys
  src/i18n/es.ts                    ← add 13 i18n keys
  src/i18n/pt.ts                    ← add 13 i18n keys
  src/ui/index.ts                   ← export notes types/functions if needed by tests
```

---

## Testing Strategy

### Unit Tests (`src/tests/notes.test.ts`)

| Test | What it validates |
|---|---|
| `readNotes returns [] when file does not exist` | FR-002 |
| `readNotes returns [] when file contains invalid JSON` | Edge case |
| `readNotes returns [] when file contains non-array JSON` | Edge case |
| `readNotes returns parsed notes from valid file` | FR-002 |
| `writeNotes creates .dscode/ directory if missing` | FR-002 |
| `writeNotes persists notes and readNotes reads them back` | FR-002 |
| `generateNoteId returns 4-char hex` | FR-003 |
| `generateNoteId avoids collision with existing` | FR-003 |
| `generateNoteId throws after 100 collision attempts` | FR-003 |
| `createNote adds note with correct defaults` | FR-001 |
| `createNote deduplicates tags` | Edge case |
| `listNotes filters by status` | FR-002 |
| `listNotes filters overdue` | FR-002 |
| `listNotes filters by specId` | FR-002 |
| `listNotes sorts correctly (overdue > open > paused > closed > abandoned)` | FR-006 |
| `updateNoteStatus returns null for missing id` | Edge case |
| `updateNoteText returns null for missing id` | Edge case |
| `updateNoteDeadline sets deadline` | FR-002 |
| `updateNoteDeadline removes deadline with null` | FR-002 |
| `parseNoteArgs extracts positional and flags` | FR-005 |
| `parseNoteArgs handles quoted strings` | FR-005 |
| `parseNoteArgs handles --flag without value` | FR-005 |
| `parseNoteArgs handles empty input` | FR-005 |
| `isValidDate accepts valid dates` | Validation |
| `isValidDate rejects invalid dates (month 13, day 32, Feb 29 non-leap)` | Validation |
| `isValidStatus matches all 4 statuses` | Validation |
| `formatNote includes id, status, text` | FR-006 |
| `formatNote omits absent optional fields` | FR-006 |
| `formatNote color-codes status` | FR-006 |
| `formatNoteList shows header and lines` | FR-006 |
| `formatNoteList shows empty message` | FR-006 |

### Integration Tests

| Test | What it validates |
|---|---|
| `/note-add "hello"` produces output on stdout | FR-004 |
| `/note-list` after adding shows the note | FR-004 |
| `/note-status <id> closed` changes status | FR-004 |
| `/note-edit <id> "new text"` changes text | FR-004 |
| `/note-deadline <id> 2026-12-31` sets deadline | FR-004 |

### Manual Smoke Tests

1. Run `/note-add "test note" --tag smoke --deadline 2026-12-31` and verify output shows note info.
2. Run `/note-list` and verify note appears.
3. Run `/note-status <id> closed` and verify color changes to green.
4. Run `/note-deadline <id> --remove` and verify deadline removed.
5. Run `/note-edit <id> "updated text"` and verify text changes.
6. Open `.dscode/notes.json` in editor and verify JSON is well-formed.
7. Delete `.dscode/notes.json` and verify `/note-list` shows empty message.
