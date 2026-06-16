import type { SkillInfo } from "../../session";
import type { PermissionScope } from "../../settings";
import type { UserToolPermission } from "../../common/permissions";

/**
 * All recognized slash-command identifiers.
 * Defined as a const array so the union type can be derived from it,
 * keeping a single source of truth.
 */
export const COMMAND_KINDS = [
  "skill",
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
  "note-add",
  "note-list",
  "note-status",
  "note-edit",
  "note-deadline",
] as const;

export type SlashCommandKind = (typeof COMMAND_KINDS)[number];

/** The subset of slash-commands that are submitted as prompt commands. */
export const PROMPT_COMMAND_KINDS = [
  "new",
  "resume",
  "continue",
  "undo",
  "mcp",
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
  "model-list",
  "model-add",
  "model-remove",
  "model-info",
  "model-key",
  "model-default",
  "model-params",
  "model-thinking",
  "budget",
] as const;

export type PromptCommand = (typeof PROMPT_COMMAND_KINDS)[number];

export type PromptSubmission = {
  text: string;
  imageUrls: string[];
  selectedSkills?: SkillInfo[];
  permissions?: UserToolPermission[];
  alwaysAllows?: PermissionScope[];
  command?: PromptCommand;
};

export type PromptDraft = {
  nonce: number;
  text: string;
  imageUrls: string[];
};
