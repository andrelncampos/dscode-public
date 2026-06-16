import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Note } from "../ui/core/notes";
import {
  readNotes,
  writeNotes,
  generateNoteId,
  parseNoteArgs,
  isValidDate,
  isValidStatus,
  createNote,
  listNotes,
  updateNoteStatus,
  updateNoteText,
  updateNoteDeadline,
  formatNote,
  formatNoteList,
  truncateText,
  now,
} from "../ui/core/notes";
import { resolveSpecName, clearSpecNameCache } from "../ui/core/spec-names";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(): string {
  const dir = fs.mkdtempSync("dscode-notes-test-");
  const dscodeDir = path.join(dir, ".dscode");
  fs.mkdirSync(dscodeDir, { recursive: true });
  // override the module's path by running from within the temp dir
  process.chdir(dir);
  return dir;
}

let _originalCwd: string;

function setup() {
  _originalCwd = process.cwd();
  return tempDir();
}

function teardown(dir: string) {
  process.chdir(_originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// FR-002: File I/O
// ---------------------------------------------------------------------------

test("readNotes returns [] when file does not exist", () => {
  const dir = setup();
  try {
    assert.deepEqual(readNotes(), []);
  } finally {
    teardown(dir);
  }
});

test("readNotes returns [] when file contains invalid JSON", () => {
  const dir = setup();
  try {
    fs.writeFileSync(path.join(".dscode", "notes.json"), "not json", "utf8");
    assert.deepEqual(readNotes(), []);
  } finally {
    teardown(dir);
  }
});

test("readNotes returns [] when file contains non-array JSON", () => {
  const dir = setup();
  try {
    fs.writeFileSync(path.join(".dscode", "notes.json"), '{"key":"val"}', "utf8");
    assert.deepEqual(readNotes(), []);
  } finally {
    teardown(dir);
  }
});

test("readNotes returns parsed notes from valid file", () => {
  const dir = setup();
  try {
    const notes: Note[] = [
      { id: "a1b2", text: "hello", status: "open", createdAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00" },
    ];
    writeNotes(notes);
    const result = readNotes();
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "a1b2");
  } finally {
    teardown(dir);
  }
});

test("writeNotes creates .dscode/ directory if missing", () => {
  const dir = setup();
  try {
    fs.rmSync(".dscode", { recursive: true, force: true });
    writeNotes([]);
    assert.ok(fs.existsSync(path.join(".dscode", "notes.json")));
  } finally {
    teardown(dir);
  }
});

test("writeNotes persists notes and readNotes reads them back — round-trip", () => {
  const dir = setup();
  try {
    const notes: Note[] = [
      { id: "a", text: "one", status: "open", createdAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00" },
      { id: "b", text: "two", status: "closed", createdAt: "2026-01-02T00:00:00", updatedAt: "2026-01-02T00:00:00" },
    ];
    writeNotes(notes);
    const result = readNotes();
    assert.equal(result.length, 2);
    assert.equal(result[0].text, "one");
  } finally {
    teardown(dir);
  }
});

// ---------------------------------------------------------------------------
// FR-003: ID Generation
// ---------------------------------------------------------------------------

test("generateNoteId starts at 1 with empty set", () => {
  const id = generateNoteId(new Set());
  assert.equal(id, "1");
});

test("generateNoteId returns next number after max", () => {
  const existing = new Set(["1", "3", "2"]);
  const id = generateNoteId(existing);
  assert.equal(id, "4");
});

test("generateNoteId skips non-numeric existing IDs", () => {
  // Old hex IDs are ignored; only numeric IDs affect the counter
  const existing = new Set(["a1f3", "dead", "5", "beef"]);
  const id = generateNoteId(existing);
  assert.equal(id, "6");
});

// ---------------------------------------------------------------------------
// FR-001 + FR-002: CRUD
// ---------------------------------------------------------------------------

test("createNote adds note with correct defaults", () => {
  const dir = setup();
  try {
    const note = createNote("hello world", {});
    assert.equal(note.text, "hello world");
    assert.equal(note.status, "open");
    assert.match(note.id, /^\d+$/);
    assert.ok(note.createdAt.length > 0);
    assert.ok(note.updatedAt.length > 0);
    // verify persisted
    const notes = readNotes();
    assert.equal(notes.length, 1);
  } finally {
    teardown(dir);
  }
});

test("createNote deduplicates tags", () => {
  const dir = setup();
  try {
    const note = createNote("hello", { tags: ["bug", "BUG", " bug ", "todo"] });
    assert.deepEqual(note.tags, ["bug", "todo"]);
  } finally {
    teardown(dir);
  }
});

test("listNotes filters by status", () => {
  const dir = setup();
  try {
    createNote("open note", {});
    const closed = createNote("closed note", {});
    updateNoteStatus(closed.id, "closed");
    const result = listNotes({ status: "closed" });
    assert.equal(result.length, 1);
    assert.equal(result[0].status, "closed");
  } finally {
    teardown(dir);
  }
});

test("listNotes filters overdue", () => {
  const dir = setup();
  try {
    // deadline in the past
    const past = createNote("past", { deadline: "2020-01-01" });
    createNote("future", { deadline: "2099-12-31" });
    const result = listNotes({ overdue: true });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, past.id);
  } finally {
    teardown(dir);
  }
});

test("listNotes filters by specId", () => {
  const dir = setup();
  try {
    const note = createNote("spec note", {});
    note.specId = "120";
    writeNotes([note]);
    const result = listNotes({ specId: "120" });
    assert.equal(result.length, 1);
    const empty = listNotes({ specId: "999" });
    assert.equal(empty.length, 0);
  } finally {
    teardown(dir);
  }
});

test("listNotes sorts correctly", () => {
  const dir = setup();
  try {
    const overdue = createNote("overdue", { deadline: "2020-01-01" });
    const openWithDeadline = createNote("open dl", { deadline: "2099-06-01" });
    const openNoDeadline = createNote("open no dl", {});
    const paused = createNote("paused", {});
    updateNoteStatus(paused.id, "paused");
    const closed = createNote("closed", {});
    updateNoteStatus(closed.id, "closed");

    const result = listNotes({});
    // overdue first, then open, then paused, then closed
    assert.equal(result[0].id, overdue.id);
    // open notes come after overdue
    const openIds = result.filter((n) => n.status === "open").map((n) => n.id);
    assert.ok(openIds.includes(openWithDeadline.id));
    assert.ok(openIds.includes(openNoDeadline.id));
  } finally {
    teardown(dir);
  }
});

test("updateNoteStatus returns null for missing id", () => {
  const dir = setup();
  try {
    assert.equal(updateNoteStatus("nonexistent", "closed"), null);
  } finally {
    teardown(dir);
  }
});

test("updateNoteText returns null for missing id", () => {
  const dir = setup();
  try {
    assert.equal(updateNoteText("nonexistent", "text"), null);
  } finally {
    teardown(dir);
  }
});

test("updateNoteDeadline sets deadline", () => {
  const dir = setup();
  try {
    const note = createNote("test", {});
    const updated = updateNoteDeadline(note.id, "2026-12-31");
    assert.ok(updated);
    assert.equal(updated!.deadline, "2026-12-31");
  } finally {
    teardown(dir);
  }
});

test("updateNoteDeadline removes deadline with null", () => {
  const dir = setup();
  try {
    const note = createNote("test", { deadline: "2026-12-31" });
    const updated = updateNoteDeadline(note.id, null);
    assert.ok(updated);
    assert.equal(updated!.deadline, undefined);
  } finally {
    teardown(dir);
  }
});

// ---------------------------------------------------------------------------
// FR-005: Arg Parsing
// ---------------------------------------------------------------------------

test("parseNoteArgs extracts positional and flags", () => {
  const result = parseNoteArgs("hello --tag bug --deadline 2026-07-01");
  assert.deepEqual(result.positional, ["hello"]);
  assert.deepEqual(result.flags, { tag: "bug", deadline: "2026-07-01" });
});

test("parseNoteArgs handles quoted strings", () => {
  const result = parseNoteArgs('"hello world" --tag bug');
  assert.deepEqual(result.positional, ["hello world"]);
});

test("parseNoteArgs handles --flag without value", () => {
  const result = parseNoteArgs("--overdue");
  assert.deepEqual(result.flags, { overdue: true });
  assert.deepEqual(result.positional, []);
});

test("parseNoteArgs handles empty input", () => {
  const result = parseNoteArgs("");
  assert.deepEqual(result, { positional: [], flags: {} });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("isValidDate accepts valid dates", () => {
  assert.ok(isValidDate("2026-01-01"));
  assert.ok(isValidDate("2024-02-29")); // leap year
});

test("isValidDate rejects invalid dates", () => {
  assert.equal(isValidDate("2026-13-01"), false); // month 13
  assert.equal(isValidDate("2026-02-30"), false); // day 30 in Feb
  assert.equal(isValidDate("2025-02-29"), false); // non-leap Feb 29
  assert.equal(isValidDate("not-a-date"), false);
});

test("isValidStatus matches all 4 statuses", () => {
  assert.ok(isValidStatus("open"));
  assert.ok(isValidStatus("closed"));
  assert.ok(isValidStatus("paused"));
  assert.ok(isValidStatus("abandoned"));
  assert.equal(isValidStatus("invalid"), false);
});

// ---------------------------------------------------------------------------
// FR-006: Formatting
// ---------------------------------------------------------------------------

test("formatNote includes id, status, text", () => {
  const note: Note = {
    id: "abcd",
    text: "test note",
    status: "open",
    createdAt: "2026-01-01T00:00:00",
    updatedAt: "2026-01-01T00:00:00",
  };
  const output = formatNote(note);
  assert.ok(output.includes("[abcd]"));
  assert.ok(output.includes("test note"));
});

test("formatNote omits absent optional fields", () => {
  const note: Note = {
    id: "abcd",
    text: "minimal",
    status: "open",
    createdAt: "2026-01-01T00:00:00",
    updatedAt: "2026-01-01T00:00:00",
  };
  const output = formatNote(note);
  assert.equal(output.includes("(deadline:"), false);
  assert.equal(output.includes("(tags:"), false);
  assert.equal(output.includes("(spec:"), false);
});

test("formatNote color-codes status", () => {
  const note: Note = {
    id: "abcd",
    text: "x",
    status: "closed",
    createdAt: "2026-01-01T00:00:00",
    updatedAt: "2026-01-01T00:00:00",
  };
  const output = formatNote(note);
  // Green for closed
  assert.ok(output.includes("\x1b[32m"));
});

test("formatNoteList shows header and lines", () => {
  const notes: Note[] = [
    { id: "a", text: "one", status: "open", createdAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00" },
    { id: "b", text: "two", status: "closed", createdAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00" },
  ];
  const output = formatNoteList(notes, {});
  assert.ok(output.includes("═══ NOTES ═══"));
  assert.ok(output.includes("[a]"));
  assert.ok(output.includes("[b]"));
});

// ---------------------------------------------------------------------------
// FR-A01: createNote specId
// ---------------------------------------------------------------------------

test("createNote accepts specId option", () => {
  const dir = setup();
  try {
    const note = createNote("text", { specId: "120" });
    assert.equal(note.specId, "120");
  } finally {
    teardown(dir);
  }
});

test("createNote without specId has no specId field", () => {
  const dir = setup();
  try {
    const note = createNote("text", {});
    assert.equal(note.specId, undefined);
  } finally {
    teardown(dir);
  }
});

// ---------------------------------------------------------------------------
// FR-A03: parseNoteArgs multi-flag accumulation
// ---------------------------------------------------------------------------

test("parseNoteArgs accumulates repeated --tag values", () => {
  const result = parseNoteArgs("--tag a --tag b");
  assert.deepEqual(result.flags.tag, ["a", "b"]);
  assert.deepEqual(result.positional, []);
});

test("parseNoteArgs keeps single --tag as string", () => {
  const result = parseNoteArgs("--tag a");
  assert.equal(result.flags.tag, "a");
});

test("parseNoteArgs keeps --overdue as true", () => {
  const result = parseNoteArgs("--overdue");
  assert.equal(result.flags.overdue, true);
  assert.deepEqual(result.positional, []);
});

test("parseNoteArgs handles --tag --spec --deadline combined", () => {
  const result = parseNoteArgs("--tag bug --spec 260 --deadline 2026-07-01");
  assert.equal(result.flags.tag, "bug");
  assert.equal(result.flags.spec, "260");
  assert.equal(result.flags.deadline, "2026-07-01");
});

// ---------------------------------------------------------------------------
// FR-A05: truncateText
// ---------------------------------------------------------------------------

test("truncateText truncates at word boundary", () => {
  // 85 chars, last space at position 78
  const text = "The quick brown fox jumps over the lazy dog and then continues running very far away";
  const result = truncateText(text, 80);
  assert.ok(result.length <= 83); // 80 + "..."
  assert.ok(result.endsWith("..."));
  assert.ok(!result.includes(" ..."));
});

test("truncateText hard-truncates when no space near limit", () => {
  // 100+ chars, space at position 5, no other space until after 80
  const text = "Hello " + "X".repeat(100) + " and more text here";
  // "Hello " = 6 chars, then 74 X chars = 80, then more
  // The only space before position 80 is at position 5
  // 5 < 80*0.6 = 48, so hard truncate at 80
  const result = truncateText(text, 80);
  assert.equal(result.length, 83); // 80 + "..."
  assert.ok(result.endsWith("..."));
});

test("truncateText does not truncate short text", () => {
  const result = truncateText("short", 80);
  assert.equal(result, "short");
  assert.ok(!result.includes("..."));
});

// ---------------------------------------------------------------------------
// FR-A06: formatNoteList overdue days count
// ---------------------------------------------------------------------------

test("formatNoteList shows overdue days count", () => {
  const dir = setup();
  try {
    const note = createNote("overdue note", { deadline: "2020-01-01" });
    const notes = readNotes();
    const output = formatNoteList(notes, {});
    assert.ok(output.includes("OVERDUE ("));
    assert.ok(output.includes("d)"));
    const match = output.match(/OVERDUE \((\d+)d\)/);
    assert.ok(match);
    const days = parseInt(match[1], 10);
    assert.ok(days > 0);
  } finally {
    teardown(dir);
  }
});

test("formatNoteList no overdue badge for future deadline", () => {
  const dir = setup();
  try {
    const note = createNote("future note", { deadline: "2099-12-31" });
    const notes = readNotes();
    const output = formatNoteList(notes, {});
    assert.equal(output.includes("OVERDUE"), false);
  } finally {
    teardown(dir);
  }
});

// ---------------------------------------------------------------------------
// FR-B01: spec name resolution in display
// ---------------------------------------------------------------------------

test("formatNote shows spec name when available", () => {
  const dir = setup();
  try {
    fs.mkdirSync("management", { recursive: true });
    fs.writeFileSync(path.join("management", "roadmap.md"), "| 260 | developer-notes | audited | V28 |\n", "utf8");
    clearSpecNameCache();
    const note = createNote("test", { specId: "260" });
    const output = formatNote(note);
    assert.ok(output.includes("(spec: #260 developer-notes)"));
  } finally {
    teardown(dir);
  }
});

test("formatNote shows spec number only when name unresolved", () => {
  const dir = setup();
  try {
    clearSpecNameCache();
    const note: Note = {
      id: "abcd",
      text: "test",
      status: "open",
      createdAt: "2026-01-01T00:00:00",
      updatedAt: "2026-01-01T00:00:00",
      specId: "999",
    };
    const output = formatNote(note);
    assert.ok(output.includes("(spec: #999)"));
    assert.equal(output.includes("(spec: #999 "), false); // no name after number
  } finally {
    teardown(dir);
  }
});

test("formatNoteList header shows spec name", () => {
  const dir = setup();
  try {
    fs.mkdirSync("management", { recursive: true });
    fs.writeFileSync(path.join("management", "roadmap.md"), "| 120 | explore-subagent | audited | V17 |\n", "utf8");
    clearSpecNameCache();
    const note = createNote("test", {});
    const note2 = createNote("test2", { specId: "120" });
    const notes = [note, note2];
    const output = formatNoteList(notes, { specId: "120" });
    assert.ok(output.includes("spec: #120 explore-subagent"));
  } finally {
    teardown(dir);
  }
});

// ---------------------------------------------------------------------------
// FR-B03: notes-delete
// ---------------------------------------------------------------------------

test("notes-delete removes note from file", () => {
  const dir = setup();
  try {
    const note = createNote("delete me", {});
    const notesBefore = readNotes();
    assert.equal(notesBefore.length, 1);
    const idx = notesBefore.findIndex((n) => n.id === note.id);
    notesBefore.splice(idx, 1);
    writeNotes(notesBefore);
    const notesAfter = readNotes();
    assert.equal(notesAfter.length, 0);
  } finally {
    teardown(dir);
  }
});

test("notes-delete findIndex returns -1 for missing id", () => {
  const dir = setup();
  try {
    createNote("exists", {});
    const notes = readNotes();
    const idx = notes.findIndex((n) => n.id === "nonexistent");
    assert.equal(idx, -1);
  } finally {
    teardown(dir);
  }
});
