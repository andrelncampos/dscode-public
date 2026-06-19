import type { SlashCommandKind, SlashCommandItem } from "./slash-commands";
import type { SkillInfo } from "../../session";
import { getActiveTFunction } from "../../i18n/context";
import { readClipboardImageAsync, readImageFile } from "./clipboard";
import { isMultimodalModel } from "../../common/model-capabilities";
import {
  createNote,
  listNotes,
  updateNoteStatus,
  updateNoteDeadline,
  parseNoteArgs,
  parseTagsFromArgs,
  formatNote,
  formatNoteList,
  isValidDate,
  isValidStatus,
  readNotes,
  writeNotes,
  now,
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
  /** Add an image (data URL) to the current prompt's attached images. */
  addImageUrl: (url: string) => void;
  /** Replace the entire prompt buffer with the given text (cursor at end). */
  setBufferText: (text: string) => void;
  /** Write command output as a system message in the chat flow (Static component). */
  writeOutput: (text: string) => void;
  /** Current model name (e.g. "deepseek-v4-pro"), used to detect multimodal support. */
  currentModel: string;
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
  "image-paste": (_item, ctx) => {
    const argText = ctx.buffer.text.replace(/^\/image-paste\s*/, "").trim();
    ctx.setStatusMessage("Reading clipboard...");
    readClipboardImageAsync()
      .then((image) => {
        if (image) {
          const modelWarning = isMultimodalModel(ctx.currentModel)
            ? ""
            : ` — ⚠️ current model (${ctx.currentModel}) does NOT support images`;
          if (argText) {
            // Submit immediately with the question text and image
            ctx.onSubmit({
              text: argText,
              imageUrls: [image.dataUrl],
              selectedSkills: ctx.selectedSkills.length > 0 ? ctx.selectedSkills : undefined,
            });
            ctx.resetPromptInput();
          } else {
            ctx.setBufferText("");
            ctx.addImageUrl(image.dataUrl);
            ctx.setStatusMessage(`Attached image from clipboard${modelWarning}`);
          }
        } else {
          ctx.setBufferText(argText);
          ctx.setStatusMessage("No image found in clipboard");
        }
      })
      .catch(() => {
        ctx.setBufferText(argText);
        ctx.setStatusMessage("Failed to read clipboard");
      });
  },
  "image-upload": (_item, ctx) => {
    const filePath = ctx.buffer.text.replace(/^\/image-upload\s*/, "").trim();
    if (!filePath) {
      ctx.setBufferText("");
      ctx.setStatusMessage("Usage: /image-upload <file-path>");
      return;
    }
    const image = readImageFile(filePath);
    if (image) {
      const modelWarning = isMultimodalModel(ctx.currentModel)
        ? ""
        : ` — ⚠️ current model (${ctx.currentModel}) does NOT support images`;
      ctx.setBufferText("");
      ctx.addImageUrl(image.dataUrl);
      ctx.setStatusMessage(`Attached image: ${filePath}${modelWarning}`);
    } else {
      ctx.setBufferText(filePath);
      ctx.setStatusMessage(`File not found or not a supported image: ${filePath}`);
    }
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
  "notes-add": (_item, ctx) => {
    ctx.clearSlashToken();
    const t = getActiveTFunction();
    const input = ctx.buffer.text.replace(/^\/notes-add\s*/, "").trim();
    if (!input) {
      ctx.writeOutput(t("cmd.notes-add-usage") + "\n");
      return;
    }
    const args = parseNoteArgs(input);
    const text = args.positional.join(" ");
    if (!text) {
      ctx.writeOutput(t("cmd.notes-add-usage") + "\n");
      return;
    }
    const deadline = typeof args.flags.deadline === "string" ? args.flags.deadline : undefined;
    if (deadline && !isValidDate(deadline)) {
      ctx.writeOutput(t("cmd.notes-invalid-date") + "\n");
      return;
    }
    // FR-A02: extract --spec
    const specId = typeof args.flags.spec === "string" ? args.flags.spec : undefined;
    if (args.flags.spec !== undefined && specId === undefined) {
      // --spec was provided but value is not a string (true or array)
      ctx.writeOutput(t("cmd.notes-add-usage") + "\n");
      return;
    }
    // FR-A03+A04: extract and validate tags
    const tags = parseTagsFromArgs(args);
    const note = createNote(text, { deadline, tags, specId });
    ctx.writeOutput(formatNote(note) + "\n");
    ctx.resetPromptInput();
  },
  notes: (_item, ctx) => {
    ctx.clearSlashToken();
    const t = getActiveTFunction();
    const input = ctx.buffer.text.replace(/^\/notes\s*/, "").trim();
    const args = parseNoteArgs(input);
    const status: NoteStatus | undefined =
      typeof args.flags.status === "string"
        ? isValidStatus(args.flags.status)
          ? args.flags.status
          : undefined
        : undefined;
    if (args.flags.status && !status) {
      ctx.writeOutput(t("cmd.notes-invalid-status") + "\n");
      return;
    }
    const overdue = args.flags.overdue === true;
    const specId = typeof args.flags.spec === "string" ? args.flags.spec : undefined;
    const notes = listNotes({ status, overdue, specId });
    if (notes.length === 0) {
      ctx.writeOutput(t("cmd.notes-empty") + "\n");
    } else {
      ctx.writeOutput(formatNoteList(notes, { status, overdue, specId }) + "\n");
    }
    ctx.resetPromptInput();
  },
  "notes-status": (_item, ctx) => {
    ctx.clearSlashToken();
    const t = getActiveTFunction();
    const input = ctx.buffer.text.replace(/^\/notes-status\s*/, "").trim();
    const parts = input.split(/\s+/);
    const id = parts[0];
    const status = parts[1];
    if (!id || !status) {
      ctx.writeOutput(t("cmd.notes-status-usage") + "\n");
      return;
    }
    if (!isValidStatus(status)) {
      ctx.writeOutput(t("cmd.notes-invalid-status") + "\n");
      return;
    }
    // Read old status before update for confirmation
    const notes = readNotes();
    const oldNote = notes.find((n) => n.id === id);
    const note = updateNoteStatus(id, status as NoteStatus);
    if (!note) {
      ctx.writeOutput(t("cmd.notes-not-found", { id }) + "\n");
      return;
    }
    ctx.writeOutput(t("cmd.notes-status-changed", { id, from: oldNote?.status ?? "?", to: status }) + "\n");
    ctx.writeOutput(formatNote(note) + "\n");
    ctx.resetPromptInput();
  },
  "notes-edit": (_item, ctx) => {
    ctx.clearSlashToken();
    const t = getActiveTFunction();
    const input = ctx.buffer.text.replace(/^\/notes-edit\s*/, "").trim();
    const args = parseNoteArgs(input);
    const id = args.positional[0];
    const text = args.positional.slice(1).join(" ") || undefined;
    if (!id) {
      ctx.writeOutput(t("cmd.notes-edit-usage") + "\n");
      return;
    }
    // Resolve spec change
    const specId = typeof args.flags.spec === "string" ? args.flags.spec : undefined;
    const specRemove = args.flags["spec-remove"] === true;
    // Resolve tags
    const tags = parseTagsFromArgs(args);
    // Resolve deadline
    const deadline = typeof args.flags.deadline === "string" ? args.flags.deadline : undefined;
    if (deadline && !isValidDate(deadline)) {
      ctx.writeOutput(t("cmd.notes-invalid-date") + "\n");
      return;
    }
    // Must have at least one change
    if (!text && specId === undefined && !specRemove && tags === undefined && !deadline) {
      ctx.writeOutput(t("cmd.notes-edit-usage") + "\n");
      return;
    }
    // Apply changes
    const notes = readNotes();
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) {
      ctx.writeOutput(t("cmd.notes-not-found", { id }) + "\n");
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
    ctx.writeOutput(t("cmd.notes-updated", { id }) + "\n");
    ctx.writeOutput(formatNote(note) + "\n");
    ctx.resetPromptInput();
  },
  "notes-deadline": (_item, ctx) => {
    ctx.clearSlashToken();
    const t = getActiveTFunction();
    const input = ctx.buffer.text.replace(/^\/notes-deadline\s*/, "").trim();
    const args = parseNoteArgs(input);
    const id = args.positional[0];
    if (!id) {
      ctx.writeOutput(t("cmd.notes-deadline-usage") + "\n");
      return;
    }
    const remove = args.flags.remove === true;
    const deadline = remove ? null : (args.positional[1] ?? null);
    if (!remove && !deadline) {
      ctx.writeOutput(t("cmd.notes-deadline-usage") + "\n");
      return;
    }
    if (deadline && typeof deadline === "string" && !isValidDate(deadline)) {
      ctx.writeOutput(t("cmd.notes-invalid-date") + "\n");
      return;
    }
    const note = updateNoteDeadline(id, deadline as string | null);
    if (!note) {
      ctx.writeOutput(t("cmd.notes-not-found", { id }) + "\n");
      return;
    }
    const msg = remove ? t("cmd.notes-deadline-removed", { id }) : t("cmd.notes-deadline-set", { id });
    ctx.writeOutput(msg + "\n");
    ctx.writeOutput(formatNote(note) + "\n");
    ctx.resetPromptInput();
  },
  "notes-delete": (_item, ctx) => {
    ctx.clearSlashToken();
    const t = getActiveTFunction();
    const input = ctx.buffer.text.replace(/^\/notes-delete\s*/, "").trim();
    if (!input) {
      ctx.writeOutput(t("cmd.notes-delete-usage") + "\n");
      return;
    }
    const id = input.split(/\s+/)[0];
    const notes = readNotes();
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) {
      ctx.writeOutput(t("cmd.notes-not-found", { id }) + "\n");
      return;
    }
    notes.splice(idx, 1);
    writeNotes(notes);
    ctx.writeOutput(t("cmd.notes-deleted", { id }) + "\n");
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
  "context",
  "clear",
  "spec-pipe",
]);

const FIXED_TEXT_COMMANDS: Partial<Record<SlashCommandKind, string>> = {
  "steering-list": "/steering-list",
  "spec-init": "/spec-init",
  "spec-list": "/spec-list",
  "spec-plan-begin": "/spec-plan-begin",
  "spec-plan-end": "/spec-plan-end",
  "spec-plan-reset": "/spec-plan-reset",
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
