import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSlashCommands,
  buildHashCommands,
  filterSlashCommands,
  filterHashCommands,
  findExactSlashCommand,
  findExactHashCommand,
  formatSlashCommandDescription,
  formatSlashCommandLabel,
} from "../ui";
import type { SkillInfo } from "../session";

const skills: SkillInfo[] = [
  { name: "skill-writer", path: "~/.agents/skills/skill-writer/SKILL.md", description: "Write a SKILL.md" },
  { name: "code-review", path: "~/.agents/skills/code-review/SKILL.md", description: "Review code" },
];

// ── buildSlashCommands (built-in only, no skills) ──

test("buildSlashCommands returns only built-in commands", () => {
  const items = buildSlashCommands(skills);
  // Skills no longer appear in slash commands
  assert.equal(items[0].kind, "skills");
  const names = items.map((i) => i.name);
  assert.deepEqual(names, [
    "skills",
    "model",
    "new",
    "init",
    "resume",
    "continue",
    "undo",
    "mcp",
    "raw",
    "steering-add",
    "steering-list",
    "steering-remove",
    "steering-alter",
    "spec-init",
    "spec-plan",
    "spec-new",
    "spec-verify",
    "spec-implement",
    "spec-audit",
    "spec-list",
    "spec-status",
    "exit",
    "cls",
    "model-list",
    "model-add",
    "model-remove",
    "model-info",
    "model-key",
    "model-default",
    "model-params",
    "model-thinking",
    "budget",
    "notes-add",
    "notes",
    "notes-status",
    "notes-edit",
    "notes-deadline",
    "notes-delete",
  ]);
});

// ── buildHashCommands (skills only, with # prefix) ──

test("buildHashCommands returns skills with # labels", () => {
  const items = buildHashCommands(skills);
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, "skill");
  assert.equal(items[0].name, "skill-writer");
  assert.equal(items[0].label, "#skill-writer");
  assert.equal(items[1].label, "#code-review");
});

// ── filterSlashCommands ──

test("filterSlashCommands matches partial prefixes", () => {
  const items = buildSlashCommands(skills);
  const matched = filterSlashCommands(items, "/skil").map((i) => i.name);
  assert.deepEqual(matched, ["skills"]);
});

test("filterSlashCommands returns all entries on bare slash", () => {
  const items = buildSlashCommands(skills);
  const matched = filterSlashCommands(items, "/");
  assert.equal(matched.length, items.length);
});

test("filterSlashCommands returns nothing for non-slash tokens", () => {
  const items = buildSlashCommands(skills);
  assert.deepEqual(filterSlashCommands(items, "skill"), []);
});

// ── filterHashCommands ──

test("filterHashCommands matches partial prefixes", () => {
  const items = buildHashCommands(skills);
  const matched = filterHashCommands(items, "#skil").map((i) => i.name);
  assert.deepEqual(matched, ["skill-writer"]);
});

test("filterHashCommands returns all skills on bare hash", () => {
  const items = buildHashCommands(skills);
  const matched = filterHashCommands(items, "#");
  assert.equal(matched.length, items.length);
});

test("filterHashCommands returns nothing for non-hash tokens", () => {
  const items = buildHashCommands(skills);
  assert.deepEqual(filterHashCommands(items, "skill"), []);
  assert.deepEqual(filterHashCommands(items, "/skill"), []);
});

// ── findExactSlashCommand ──

test("findExactSlashCommand returns null when nothing matches", () => {
  const items = buildSlashCommands(skills);
  assert.equal(findExactSlashCommand(items, "/missing"), null);
});

test("findExactSlashCommand returns built-in /new", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/new");
  assert.ok(item);
  assert.equal(item?.kind, "new");
});

test("findExactSlashCommand returns built-in /init", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/init");
  assert.ok(item);
  assert.equal(item?.kind, "init");
  assert.equal(item?.description, "cmd.initialize-agents");
});

test("findExactSlashCommand returns built-in /continue", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/continue");
  assert.ok(item);
  assert.equal(item?.kind, "continue");
});

test("findExactSlashCommand returns built-in /undo", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/undo");
  assert.ok(item);
  assert.equal(item?.kind, "undo");
});

test("findExactSlashCommand returns built-in /skills", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/skills");
  assert.ok(item);
  assert.equal(item?.kind, "skills");
});

test("findExactSlashCommand returns built-in /model", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/model");
  assert.ok(item);
  assert.equal(item?.kind, "model");
});

test("findExactSlashCommand returns built-in /raw", () => {
  const items = buildSlashCommands(skills);
  const item = findExactSlashCommand(items, "/raw");
  assert.ok(item);
  assert.equal(item?.kind, "raw");
});

test("findExactSlashCommand no longer matches skills (skills moved to #)", () => {
  const items = buildSlashCommands(skills);
  assert.equal(findExactSlashCommand(items, "/code-review"), null);
});

// ── findExactHashCommand ──

test("findExactHashCommand returns matching skill", () => {
  const items = buildHashCommands(skills);
  const item = findExactHashCommand(items, "#code-review");
  assert.ok(item);
  assert.equal(item?.kind, "skill");
  assert.equal(item?.skill?.name, "code-review");
});

test("findExactHashCommand returns null for unknown skill", () => {
  const items = buildHashCommands(skills);
  assert.equal(findExactHashCommand(items, "#missing"), null);
});

// ── formatSlashCommandDescription ──

test("formatSlashCommandDescription keeps descriptions on one line", () => {
  const mockT = (key: string) => key;
  assert.equal(formatSlashCommandDescription("Line one\n  line two", mockT), "Line one line two");
});

// ── formatSlashCommandLabel ──

test("formatSlashCommandLabel marks loaded skills with # prefix", () => {
  const items = buildHashCommands([
    { name: "loaded", path: "/skills/loaded/SKILL.md", description: "Loaded skill", isLoaded: true },
    { name: "fresh", path: "/skills/fresh/SKILL.md", description: "Fresh skill" },
  ]);

  assert.equal(formatSlashCommandLabel(items[0]), "#loaded ✓");
  assert.equal(formatSlashCommandLabel(items[1]), "#fresh");
});
