import type { SlashCommandKind, SlashCommandItem } from "./slash-commands";
import type { SkillInfo } from "../../session";
import { getActiveTFunction } from "../../i18n/context";
import {
  createNote,
  listNotes,
  updateNoteStatus,
  updateNoteText,
  updateNoteDeadline,
  parseNoteArgs,
  formatNote,
  formatNoteList,
  isValidDate,
  isValidStatus,
} from "./notes";
import type { NoteStatus } from "./notes";

export type CommandContext = {
  buffer: { text: string };
  busy: boolean;
  selectedSkills: SkillInfo[];
  onSubmit: (submission: { text: string; imageUrls: string[]; selectedSkills?: SkillInfo[]; command?: string }) => void;
  resetPromptInput: () => void;
  clearSlashToken: () => void;
  addSelectedSkill: (skill: SkillInfo) => void;
  setShowSkillsDropdown: (show: boolean) => void;
  setShowModelDropdown: (show: boolean) => void;
  setOpenRawModelDropdown: (show: boolean) => void;
  setStatusMessage: (msg: string) => void;
};

type CommandHandler = (item: SlashCommandItem, ctx: CommandContext) => void;

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  skill: (item, ctx) => {
    if (item.skill) {
      ctx.addSelectedSkill(item.skill);
      ctx.clearSlashToken();
      ctx.setShowSkillsDropdown(false);
    }
  },
  skills: (_item, ctx) => {
    ctx.clearSlashToken();
    ctx.setShowSkillsDropdown(true);
  },
  model: (_item, ctx) => {
    ctx.clearSlashToken();
    ctx.setShowSkillsDropdown(false);
    ctx.setShowModelDropdown(true);
  },
  raw: (_item, ctx) => {
    ctx.clearSlashToken();
    ctx.setOpenRawModelDropdown(true);
  },
  new: (_item, ctx) => {
    ctx.onSubmit({ text: "", imageUrls: [], command: "new" });
    ctx.resetPromptInput();
  },
  init: (_item, ctx) => {
    ctx.onSubmit({
      text: "/init",
      imageUrls: [],
      selectedSkills: ctx.selectedSkills.length > 0 ? ctx.selectedSkills : undefined,
    });
    ctx.resetPromptInput();
  },
  resume: (_item, ctx) => {
    ctx.onSubmit({ text: "", imageUrls: [], command: "resume" });
    ctx.resetPromptInput();
  },
  continue: (_item, ctx) => {
    ctx.onSubmit({ text: "/continue", imageUrls: [], command: "continue" });
    ctx.resetPromptInput();
  },
  undo: (_item, ctx) => {
    ctx.onSubmit({ text: "/undo", imageUrls: [], command: "undo" });
    ctx.resetPromptInput();
  },
  mcp: (_item, ctx) => {
    ctx.onSubmit({ text: "/mcp", imageUrls: [], command: "mcp" });
    ctx.resetPromptInput();
  },
  exit: (_item, ctx) => {
    ctx.onSubmit({ text: "/exit", imageUrls: [], command: "exit" });
  },
  cls: (_item, ctx) => {
    process.stdout.write("\x1b[2J\x1b[H");
    ctx.clearSlashToken();
  },
  "steering-remove": (_item, ctx) => {
    ctx.onSubmit({
      text: "/steering-remove " + ctx.buffer.text.replace(/^\/steering-remove\s+/, ""),
      imageUrls: [],
      selectedSkills: ctx.selectedSkills.length > 0 ? ctx.selectedSkills : undefined,
    });
    ctx.resetPromptInput();
  },
  "steering-alter": (_item, ctx) => {
    ctx.onSubmit({
      text: "/steering-alter " + ctx.buffer.text.replace(/^\/steering-alter\s+/, ""),
      imageUrls: [],
      selectedSkills: ctx.selectedSkills.length > 0 ? ctx.selectedSkills : undefined,
    });
    ctx.resetPromptInput();
  },
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
      tags = tags.map((t) => t.trim()).filter((t) => t.length > 0);
      if (tags.length === 0) tags = undefined;
    }
    const note = createNote(text, { deadline, tags, specId });
    process.stdout.write(formatNote(note) + "\n");
    ctx.resetPromptInput();
  },
  "note-list": (_item, ctx) => {
    ctx.clearSlashToken();
    const t = getActiveTFunction();
    const input = ctx.buffer.text.replace(/^\/note-list\s*/, "").trim();
    const args = parseNoteArgs(input);
    const status: NoteStatus | undefined =
      typeof args.flags.status === "string"
        ? isValidStatus(args.flags.status)
          ? args.flags.status
          : undefined
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
};

const BUFFER_TEXT_COMMANDS: Set<SlashCommandKind> = new Set([
  "steering-add",
  "steering-remove",
  "steering-alter",
  "spec-plan",
  "spec-new",
  "spec-verify",
  "spec-implement",
  "spec-audit",
  "spec-status",
  "model-list",
  "model-add",
  "model-remove",
  "model-info",
  "model-key",
  "model-default",
  "model-params",
  "model-thinking",
  "budget",
]);

const FIXED_TEXT_COMMANDS: Partial<Record<SlashCommandKind, string>> = {
  "steering-list": "/steering-list",
  "spec-init": "/spec-init",
  "spec-list": "/spec-list",
};

export function executeSlashCommand(item: SlashCommandItem, ctx: CommandContext): boolean {
  if (ctx.busy && item.kind !== "exit") {
    ctx.setStatusMessage(getActiveTFunction()("status.busy-wait"));
    return false;
  }

  const handler = COMMAND_HANDLERS[item.kind];
  if (handler) {
    handler(item, ctx);
    return true;
  }

  if (BUFFER_TEXT_COMMANDS.has(item.kind)) {
    ctx.onSubmit({
      text: ctx.buffer.text.trim() || `/${item.kind}`,
      imageUrls: [],
      selectedSkills: ctx.selectedSkills.length > 0 ? ctx.selectedSkills : undefined,
      command: item.kind,
    });
    ctx.resetPromptInput();
    return true;
  }

  const fixedText = FIXED_TEXT_COMMANDS[item.kind];
  if (fixedText) {
    ctx.onSubmit({
      text: fixedText,
      imageUrls: [],
      selectedSkills: ctx.selectedSkills.length > 0 ? ctx.selectedSkills : undefined,
      command: item.kind,
    });
    ctx.resetPromptInput();
    return true;
  }

  return false;
}
