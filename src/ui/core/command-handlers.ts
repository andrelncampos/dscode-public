import type { SlashCommandKind, SlashCommandItem } from "./slash-commands";
import type { SkillInfo } from "../../session";
import { getActiveTFunction } from "../../i18n/context";

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
};

const BUFFER_TEXT_COMMANDS: Set<SlashCommandKind> = new Set([
  "steering-add",
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
