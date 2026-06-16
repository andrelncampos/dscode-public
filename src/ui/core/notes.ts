import path from "node:path";
import fs from "node:fs";

import { resolveSpecName } from "./spec-names";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NoteStatus = "open" | "closed" | "paused" | "abandoned";

export interface Note {
  id: string; // 4 lowercase hex chars
  text: string; // note body
  status: NoteStatus; // always one of the 4 statuses
  createdAt: string; // ISO 8601 with seconds, UTC
  updatedAt: string; // ISO 8601 with seconds, UTC
  deadline?: string; // YYYY-MM-DD, absent if no deadline
  tags?: string[]; // lowercase, deduplicated on write, absent if empty
  specId?: string; // spec number as string, absent if not linked
}

export interface ParsedNoteArgs {
  positional: string[];
  flags: Record<string, string | true | string[]>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOTES_PATH = path.join(".dscode", "notes.json");
const NOTES_TMP = path.join(".dscode", "notes.json.tmp");

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

export function readNotes(): Note[] {
  if (!fs.existsSync(NOTES_PATH)) return [];
  try {
    const content = fs.readFileSync(NOTES_PATH, "utf8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as Note[];
    return [];
  } catch {
    return [];
  }
}

export function writeNotes(notes: Note[]): void {
  const dir = path.dirname(NOTES_PATH);
  fs.mkdirSync(dir, { recursive: true });

  // Ensure .dscode/.gitignore exists so notes.json is never committed
  const gitignorePath = path.join(dir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "notes.json\n", "utf8");
  }

  const json = JSON.stringify(notes, null, 2);
  fs.writeFileSync(NOTES_TMP, json, "utf8");
  fs.renameSync(NOTES_TMP, NOTES_PATH);

  const fd = fs.openSync(NOTES_PATH, "r");
  try {
    fs.fsyncSync(fd);
  } catch {
    // fsync may not be supported on all platforms (e.g., Windows on read-only fd).
    // The renameSync above is atomic on NTFS, so this is a best-effort flush.
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

export function generateNoteId(existingIds: Set<string>): string {
  let max = 0;
  for (const id of existingIds) {
    const n = Number(id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function now(): string {
  return new Date().toISOString().replace(/\..+/, "");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return false;
  const [y, m, day] = dateStr.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  const daysInMonth = new Date(y, m, 0).getDate();
  if (day < 1 || day > daysInMonth) return false;
  return true;
}

export function isValidStatus(status: string): status is NoteStatus {
  return ["open", "closed", "paused", "abandoned"].includes(status);
}

// ---------------------------------------------------------------------------
// Arg Parsing
// ---------------------------------------------------------------------------

export function parseNoteArgs(input: string): ParsedNoteArgs {
  const tokens: string[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    // skip whitespace
    if (input[i] === " ") {
      i++;
      continue;
    }
    // quoted string
    if (input[i] === '"') {
      i++; // skip opening quote
      let acc = "";
      while (i < len && input[i] !== '"') {
        acc += input[i];
        i++;
      }
      if (i < len) i++; // skip closing quote
      tokens.push(acc);
      continue;
    }
    // unquoted token
    let acc = "";
    while (i < len && input[i] !== " ") {
      acc += input[i];
      i++;
    }
    tokens.push(acc);
  }

  const positional: string[] = [];
  const flags: Record<string, string | true | string[]> = {};

  for (let j = 0; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.startsWith("--")) {
      const name = t.slice(2);
      // check next token for value
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
        j++; // consume value
      } else {
        flags[name] = true; // boolean flag
      }
    } else {
      positional.push(t);
    }
  }

  return { positional, flags };
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

export function createNote(text: string, options: { deadline?: string; tags?: string[]; specId?: string }): Note {
  const notes = readNotes();
  const id = generateNoteId(new Set(notes.map((n) => n.id)));
  const ts = now();

  const note: Note = {
    id,
    text,
    status: "open",
    createdAt: ts,
    updatedAt: ts,
    ...options,
  };

  if (note.tags) {
    const deduped = [...new Set(note.tags.map((t) => t.toLowerCase().trim()))];
    if (deduped.length > 0) {
      note.tags = deduped;
    } else {
      delete note.tags;
    }
  }

  notes.push(note);
  writeNotes(notes);
  return note;
}

export function listNotes(filters: { status?: NoteStatus; overdue?: boolean; specId?: string }): Note[] {
  let notes = readNotes();
  const todayStr = today();

  if (filters.status) {
    notes = notes.filter((n) => n.status === filters.status);
  }
  if (filters.overdue) {
    notes = notes.filter((n) => n.deadline && n.deadline < todayStr);
  }
  if (filters.specId) {
    notes = notes.filter((n) => n.specId === filters.specId);
  }

  const overdue: Note[] = [];
  const open: Note[] = [];
  const paused: Note[] = [];
  const closed: Note[] = [];
  const abandoned: Note[] = [];

  for (const n of notes) {
    const isOverdue = n.deadline && n.deadline < todayStr;
    if (isOverdue) {
      overdue.push(n);
    } else {
      switch (n.status) {
        case "open":
          open.push(n);
          break;
        case "paused":
          paused.push(n);
          break;
        case "closed":
          closed.push(n);
          break;
        case "abandoned":
          abandoned.push(n);
          break;
      }
    }
  }

  const byDeadlineAsc = (a: Note, b: Note) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
  const byCreatedDesc = (a: Note, b: Note) => b.createdAt.localeCompare(a.createdAt);

  overdue.sort(byDeadlineAsc);
  open.sort((a, b) => {
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return byCreatedDesc(a, b);
  });
  paused.sort(byCreatedDesc);
  closed.sort(byCreatedDesc);
  abandoned.sort(byCreatedDesc);

  return [...overdue, ...open, ...paused, ...closed, ...abandoned];
}

export function updateNoteStatus(id: string, status: NoteStatus): Note | null {
  const notes = readNotes();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return null;
  notes[idx].status = status;
  notes[idx].updatedAt = now();
  writeNotes(notes);
  return notes[idx];
}

export function updateNoteText(id: string, text: string): Note | null {
  const notes = readNotes();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return null;
  notes[idx].text = text;
  notes[idx].updatedAt = now();
  writeNotes(notes);
  return notes[idx];
}

export function updateNoteDeadline(id: string, deadline: string | null): Note | null {
  const notes = readNotes();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return null;
  if (deadline === null) {
    delete notes[idx].deadline;
  } else {
    notes[idx].deadline = deadline;
  }
  notes[idx].updatedAt = now();
  writeNotes(notes);
  return notes[idx];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<NoteStatus, string> = {
  open: "\x1b[33m",
  closed: "\x1b[32m",
  paused: "\x1b[2m",
  abandoned: "\x1b[31m",
};

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

export function formatNote(note: Note): string {
  const RESET = "\x1b[0m";
  const color = STATUS_COLORS[note.status] ?? "";
  const parts: string[] = [`[${note.id}]`, `${color}${note.status.toUpperCase()}${RESET}`, truncateText(note.text, 80)];
  if (note.deadline) {
    parts.push(`(deadline: ${note.deadline})`);
  }
  if (note.tags && note.tags.length > 0) {
    parts.push(`(tags: ${note.tags.join(", ")})`);
  }
  if (note.specId) {
    const name = resolveSpecName(note.specId);
    const label = name ? `#${note.specId} ${name}` : `#${note.specId}`;
    parts.push(`(spec: ${label})`);
  }
  return parts.join(" ");
}

export function formatNoteList(
  notes: Note[],
  filters: { status?: NoteStatus; overdue?: boolean; specId?: string }
): string {
  const filterParts: string[] = ["\x1b[1m═══ NOTES ═══\x1b[0m"];
  if (filters.status) filterParts.push(`status: ${filters.status}`);
  if (filters.overdue) filterParts.push("overdue");
  if (filters.specId) {
    const name = resolveSpecName(filters.specId);
    const label = name ? `#${filters.specId} ${name}` : `#${filters.specId}`;
    filterParts.push(`spec: ${label}`);
  }
  const header = filterParts.join("  ");

  const lines = [header];
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
  return lines.join("\n");
}
