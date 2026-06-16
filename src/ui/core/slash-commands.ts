import type { SkillInfo } from "../../session";
import type { SlashCommandKind } from "../types/commands";
import type { I18nTFunction } from "../../i18n/translate";

export type { SlashCommandKind } from "../types/commands";

export type SlashCommandItem = {
  kind: SlashCommandKind;
  name: string;
  label: string;
  description: string;
  skill?: SkillInfo;
  args?: string[];
};

export const BUILTIN_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    kind: "skills",
    name: "skills",
    label: "/skills",
    description: "cmd.list-skills",
  },
  {
    kind: "model",
    name: "model",
    label: "/model",
    description: "cmd.select-model",
  },
  {
    kind: "new",
    name: "new",
    label: "/new",
    description: "cmd.start-fresh",
  },
  {
    kind: "init",
    name: "init",
    label: "/init",
    description: "cmd.initialize-agents",
  },
  {
    kind: "resume",
    name: "resume",
    label: "/resume",
    description: "cmd.resume-conversation",
  },
  {
    kind: "continue",
    name: "continue",
    label: "/continue",
    description: "cmd.continue-conversation",
  },
  {
    kind: "undo",
    name: "undo",
    label: "/undo",
    description: "cmd.undo-restore",
  },
  {
    kind: "mcp",
    name: "mcp",
    label: "/mcp",
    description: "cmd.mcp-status",
  },
  {
    kind: "raw",
    name: "raw",
    label: "/raw",
    args: ["lite", "normal", "raw-scrollback"],
    description: "cmd.toggle-display-mode",
  },
  {
    kind: "steering-add",
    name: "steering-add",
    label: "/steering-add",
    description: "cmd.steering-add",
  },
  {
    kind: "steering-list",
    name: "steering-list",
    label: "/steering-list",
    description: "cmd.steering-list",
  },
  {
    kind: "steering-remove",
    name: "steering-remove",
    label: "/steering-remove",
    description: "cmd.steering-remove",
  },
  {
    kind: "steering-alter",
    name: "steering-alter",
    label: "/steering-alter",
    description: "cmd.steering-alter",
  },
  {
    kind: "spec-init",
    name: "spec-init",
    label: "/spec-init",
    description: "cmd.spec-init",
  },
  {
    kind: "spec-plan",
    name: "spec-plan",
    label: "/spec-plan",
    description: "cmd.spec-plan",
  },
  {
    kind: "spec-new",
    name: "spec-new",
    label: "/spec-new",
    args: ["<spec-number>"],
    description: "cmd.spec-new",
  },
  {
    kind: "spec-verify",
    name: "spec-verify",
    label: "/spec-verify",
    args: ["<spec-number>"],
    description: "cmd.spec-verify",
  },
  {
    kind: "spec-implement",
    name: "spec-implement",
    label: "/spec-implement",
    args: ["<spec-number>"],
    description: "cmd.spec-implement",
  },
  {
    kind: "spec-audit",
    name: "spec-audit",
    label: "/spec-audit",
    args: ["<spec-number>"],
    description: "cmd.spec-audit",
  },
  {
    kind: "spec-list",
    name: "spec-list",
    label: "/spec-list",
    description: "cmd.spec-list",
  },
  {
    kind: "spec-status",
    name: "spec-status",
    label: "/spec-status",
    args: ["[spec-number]"],
    description: "cmd.spec-status",
  },
  {
    kind: "exit",
    name: "exit",
    label: "/exit",
    description: "cmd.quit-dscode",
  },
  {
    kind: "cls",
    name: "cls",
    label: "/cls",
    description: "cmd.clear-screen",
  },
  {
    kind: "model-list",
    name: "model-list",
    label: "/model-list",
    description: "cmd.model-list",
  },
  {
    kind: "model-add",
    name: "model-add",
    label: "/model-add",
    args: ["<provider>"],
    description: "cmd.model-add",
  },
  {
    kind: "model-remove",
    name: "model-remove",
    label: "/model-remove",
    args: ["<provider>"],
    description: "cmd.model-remove",
  },
  {
    kind: "model-info",
    name: "model-info",
    label: "/model-info",
    args: ["<model-id>"],
    description: "cmd.model-info",
  },
  {
    kind: "model-key",
    name: "model-key",
    label: "/model-key",
    args: ["<provider>"],
    description: "cmd.model-key",
  },
  {
    kind: "model-default",
    name: "model-default",
    label: "/model-default",
    args: ["<model-id>"],
    description: "cmd.model-default",
  },
  {
    kind: "model-params",
    name: "model-params",
    label: "/model-params",
    description: "cmd.model-params",
  },
  {
    kind: "model-thinking",
    name: "model-thinking",
    label: "/model-thinking",
    args: ["<model-id>"],
    description: "cmd.model-thinking",
  },
  {
    kind: "budget",
    name: "budget",
    label: "/budget",
    description: "cmd.budget",
  },
  {
    kind: "notes-add",
    name: "notes-add",
    label: "/notes-add",
    args: ["<text>", "--deadline", "YYYY-MM-DD", "--tag", "<tag>"],
    description: "cmd.notes-add",
  },
  {
    kind: "notes",
    name: "notes",
    label: "/notes",
    args: ["--status", "open|closed|paused|abandoned", "--overdue", "--spec", "<id>"],
    description: "cmd.notes",
  },
  {
    kind: "notes-status",
    name: "notes-status",
    label: "/notes-status",
    args: ["<id>", "<status>"],
    description: "cmd.notes-status",
  },
  {
    kind: "notes-edit",
    name: "notes-edit",
    label: "/notes-edit",
    args: ["<id>", '"<text>"'],
    description: "cmd.notes-edit",
  },
  {
    kind: "notes-deadline",
    name: "notes-deadline",
    label: "/notes-deadline",
    args: ["<id>", "YYYY-MM-DD|--remove"],
    description: "cmd.notes-deadline",
  },
  {
    kind: "notes-delete",
    name: "notes-delete",
    label: "/notes-delete",
    args: ["<id>"],
    description: "cmd.notes-delete",
  },
];

export function buildSlashCommands(): SlashCommandItem[] {
  return [...BUILTIN_SLASH_COMMANDS];
}

export function buildHashCommands(skills: SkillInfo[]): SlashCommandItem[] {
  return skills.map((skill) => ({
    kind: "skill",
    name: skill.name,
    label: `#${skill.name}`,
    description: skill.description || "(no description)",
    skill,
  }));
}

export function filterCommandsByPrefix(items: SlashCommandItem[], token: string, prefix: string): SlashCommandItem[] {
  if (!token.startsWith(prefix)) return [];
  const query = token.slice(prefix.length).toLowerCase();
  if (!query) return items;
  return items.filter((item) => item.name.toLowerCase().includes(query));
}

export function findExactCommandByPrefix(
  items: SlashCommandItem[],
  token: string,
  prefix: string
): SlashCommandItem | null {
  if (!token.startsWith(prefix)) return null;
  const query = token.slice(prefix.length);
  const matches = items.filter((item) => item.name === query);
  return matches[0] ?? null;
}

export function formatSlashCommandDescription(description: string, t: I18nTFunction): string {
  const translated = t(description);
  return translated.trim().replace(/\s+/g, " ");
}

export function formatSlashCommandLabel(item: SlashCommandItem): string {
  return item.kind === "skill" && item.skill?.isLoaded ? `${item.label} ✓` : item.label;
}
