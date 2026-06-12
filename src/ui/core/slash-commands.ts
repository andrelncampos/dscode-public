import type { SkillInfo } from "../../session";
import type { SlashCommandKind } from "../types/commands";

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
    description: "List available skills",
  },
  {
    kind: "model",
    name: "model",
    label: "/model",
    description: "Select model, thinking mode and effort control",
  },
  {
    kind: "new",
    name: "new",
    label: "/new",
    description: "Start a fresh conversation",
  },
  {
    kind: "init",
    name: "init",
    label: "/init",
    description: "Initialize an AGENTS.md file with instructions for LLM",
  },
  {
    kind: "resume",
    name: "resume",
    label: "/resume",
    description: "Pick a previous conversation to continue",
  },
  {
    kind: "continue",
    name: "continue",
    label: "/continue",
    description: "Continue the active conversation or pick one to resume",
  },
  {
    kind: "undo",
    name: "undo",
    label: "/undo",
    description: "Restore code and/or conversation to a previous point",
  },
  {
    kind: "mcp",
    name: "mcp",
    label: "/mcp",
    description: "Show MCP server status and available tools",
  },
  {
    kind: "raw",
    name: "raw",
    label: "/raw",
    args: ["lite", "normal", "raw-scrollback"],
    description: "Toggle display mode for viewing or collapsing reasoning content",
  },
  {
    kind: "steering-add",
    name: "steering-add",
    label: "/steering-add",
    description: "Add a steering rule to the STEERINGS section of AGENTS.md",
  },
  {
    kind: "steering-list",
    name: "steering-list",
    label: "/steering-list",
    description: "List all steering rules from the STEERINGS section of AGENTS.md",
  },
  {
    kind: "spec-init",
    name: "spec-init",
    label: "/spec-init",
    description: "Initialize SDD structure: vision, arch, roadmap, ADR, and lessons files",
  },
  {
    kind: "spec-plan",
    name: "spec-plan",
    label: "/spec-plan",
    description: "Plan specs from brainstorming, align with vision, update roadmap",
  },
  {
    kind: "spec-new",
    name: "spec-new",
    label: "/spec-new",
    args: ["<spec-number>"],
    description: "Create a new spec with requirements, design, and task documents",
  },
  {
    kind: "spec-verify",
    name: "spec-verify",
    label: "/spec-verify",
    args: ["<spec-number>"],
    description: "Verify spec completeness, determinism, and alignment with vision",
  },
  {
    kind: "spec-implement",
    name: "spec-implement",
    label: "/spec-implement",
    args: ["<spec-number>"],
    description: "Implement all tasks from a spec sequentially",
  },
  {
    kind: "spec-audit",
    name: "spec-audit",
    label: "/spec-audit",
    args: ["<spec-number>"],
    description: "Audit implementation quality and correctness for a spec",
  },
  {
    kind: "spec-list",
    name: "spec-list",
    label: "/spec-list",
    description: "List all specs with their statuses from the roadmap",
  },
  {
    kind: "spec-status",
    name: "spec-status",
    label: "/spec-status",
    args: ["[spec-number]"],
    description: "Show detailed status of a specific spec or all specs",
  },
  {
    kind: "exit",
    name: "exit",
    label: "/exit",
    description: "Quit DsCode CLI",
  },
  {
    kind: "cls",
    name: "cls",
    label: "/cls",
    description: "Clear the terminal screen",
  },
  {
    kind: "model-list",
    name: "model-list",
    label: "/model-list",
    description: "List configured LLM providers with their models and pricing",
  },
  {
    kind: "model-add",
    name: "model-add",
    label: "/model-add",
    args: ["<provider>"],
    description: "Add a new LLM provider with API key and base URL",
  },
  {
    kind: "model-remove",
    name: "model-remove",
    label: "/model-remove",
    args: ["<provider>"],
    description: "Remove a configured LLM provider",
  },
  {
    kind: "model-info",
    name: "model-info",
    label: "/model-info",
    args: ["<model-id>"],
    description: "Show detailed information about a specific model",
  },
  {
    kind: "model-key",
    name: "model-key",
    label: "/model-key",
    args: ["<provider>"],
    description: "Update API key for a configured provider",
  },
  {
    kind: "model-default",
    name: "model-default",
    label: "/model-default",
    args: ["<model-id>"],
    description: "Set the default model",
  },
  {
    kind: "model-params",
    name: "model-params",
    label: "/model-params",
    description: "Configure generation parameters (temperature, max_tokens, top_p)",
  },
  {
    kind: "model-thinking",
    name: "model-thinking",
    label: "/model-thinking",
    args: ["<model-id>"],
    description: "Configure thinking budget for extended-thinking models",
  },
];

export function buildSlashCommands(skills: SkillInfo[]): SlashCommandItem[] {
  const skillItems: SlashCommandItem[] = skills.map((skill) => ({
    kind: "skill",
    name: skill.name,
    label: `/${skill.name}`,
    description: skill.description || "(no description)",
    skill,
  }));
  return [...skillItems, ...BUILTIN_SLASH_COMMANDS];
}

export function filterSlashCommands(items: SlashCommandItem[], token: string): SlashCommandItem[] {
  if (!token.startsWith("/")) {
    return [];
  }
  const query = token.slice(1).toLowerCase();
  if (!query) {
    return items;
  }
  return items.filter((item) => item.name.toLowerCase().includes(query));
}

export function findExactSlashCommand(items: SlashCommandItem[], token: string): SlashCommandItem | null {
  if (!token.startsWith("/")) {
    return null;
  }
  const query = token.slice(1);
  const matches = items.filter((item) => item.name === query);
  return matches.find((item) => item.kind !== "skill") ?? matches[0] ?? null;
}

export function formatSlashCommandDescription(description: string): string {
  return (description || "(no description)").trim().replace(/\s+/g, " ");
}

export function formatSlashCommandLabel(item: SlashCommandItem): string {
  return item.kind === "skill" && item.skill?.isLoaded ? `${item.label} ✓` : item.label;
}
