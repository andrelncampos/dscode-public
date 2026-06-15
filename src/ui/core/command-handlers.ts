import type { SlashCommandKind, SlashCommandItem } from "./slash-commands";
import type { SkillInfo } from "../../session";
import type { TerminalRuntimeProfile } from "./terminal-runtime";
import { getActiveTFunction } from "../../i18n/context";
import { getKittyProtocolState } from "../hooks/kitty-protocol";

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
  /** Terminal profile for diagnostic commands like /keys. */
  terminalProfile?: TerminalRuntimeProfile;
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
  keys: (_item, ctx) => {
    ctx.clearSlashToken();
    const t = getActiveTFunction();
    const p = ctx.terminalProfile;

    if (!p) {
      ctx.setStatusMessage(t("cmd.keys-no-profile"));
      return;
    }

    // Infer keyboard protocol from capability (runtime Kitty state overrides static profile).
    const kittyState = getKittyProtocolState();
    const shiftEnterWorks = kittyState.active || p.shiftEnterCapable;
    const protocol = kittyState.active ? "Kitty (CSI u)" : p.shiftEnterCapable ? "CSI u" : "legacy";
    const shiftStatus = shiftEnterWorks ? t("cmd.keys-shift-yes") : t("cmd.keys-shift-no");
    const shortcutLabel = shiftEnterWorks ? t("cmd.keys-newline-shiftenter") : t("cmd.keys-newline-ctrlj");

    const msg = `${t("cmd.keys-prefix")}${p.kind} · ${t("cmd.keys-protocol")}${protocol} · ${t("cmd.keys-shift-label")}${shiftStatus} · ${t("cmd.keys-use")}${shortcutLabel}`;
    ctx.setStatusMessage(msg);
  },
  "terminal-setup": (_item, ctx) => {
    ctx.clearSlashToken();
    const p = ctx.terminalProfile;
    const border = "═".repeat(60);

    const lines: string[] = [
      `\x1b[1m${border}\x1b[0m`,
      `\x1b[1mTERMINAL SETUP — DsCode\x1b[0m`,
      `\x1b[1m${border}\x1b[0m`,
      "",
    ];

    if (!p) {
      lines.push("Terminal profile not available.", "Run /keys first.");
      process.stdout.write(lines.join("\n") + "\n");
      return;
    }

    // Runtime Kitty state may override static profile detection.
    const kittyState = getKittyProtocolState();
    const shiftEnterWorks = kittyState.active || p.shiftEnterCapable;
    const protocolLabel = kittyState.active ? "Kitty (CSI u)" : p.shiftEnterCapable ? "CSI u" : "legacy";

    lines.push(
      `Detected: ${p.kind}`,
      `Platform: ${p.platform}`,
      `Shift+Enter: ${shiftEnterWorks ? "supported \u2713" : "NOT supported \u2717"} (protocol: ${protocolLabel})`,
      ""
    );

    if (shiftEnterWorks) {
      if (kittyState.active) {
        lines.push(
          "\x1b[1mKitty Keyboard Protocol is active!\x1b[0m",
          "Shift+Enter and all modifier keys should work in this session.",
          ""
        );
      } else {
        lines.push(
          "\x1b[1mShift+Enter should already work in this terminal.\x1b[0m",
          "If it doesn't, run /keys to diagnose, or use Ctrl+J / \\ + Enter as fallback.",
          ""
        );
      }
    } else {
      lines.push("\x1b[1mTo enable Shift+Enter for newline, configure your terminal:\x1b[0m", "");
    }

    // Windows Terminal setup
    if (p.isWindows || p.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA ?? "%LOCALAPPDATA%";
      const wtPackaged = `${localAppData}\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json`;
      const wtUnpackaged = `${localAppData}\\Microsoft\\Windows Terminal\\settings.json`;

      lines.push(
        "\x1b[1m\u25b8 Windows Terminal\x1b[0m",
        `  Primary config: ${wtPackaged}`,
        `  Fallback config: ${wtUnpackaged}`,
        "",
        '  Add to the "actions" array (create it if missing):',
        "  {",
        '    "command": {',
        '      "action": "sendInput",',
        '      "input": "\\n"',
        "    },",
        '    "keys": "shift+enter"',
        "  }",
        "",
        "  \x1b[33m\u26a0 This makes Shift+Enter send LF for ALL programs in this profile.\x1b[0m",
        '  To undo: remove this entry from the "actions" array.',
        ""
      );
    }

    // VS Code / Cursor
    lines.push(
      "\x1b[1m\u25b8 VS Code / Cursor\x1b[0m",
      "  File: keybindings.json (Ctrl+Shift+P \u2192 Preferences: Open Keyboard Shortcuts (JSON))",
      "  {",
      '    "key": "shift+enter",',
      '    "command": "workbench.action.terminal.sendSequence",',
      '    "args": { "text": "\\n" },',
      '    "when": "terminalFocus"',
      "  }",
      ""
    );

    // tmux
    lines.push(
      "\x1b[1m\u25b8 tmux\x1b[0m",
      "  File: ~/.tmux.conf",
      "  set -g allow-passthrough on",
      "  set -s extended-keys on",
      "  set -s extended-keys-format csi-u",
      "  set -as terminal-features 'xterm*:extkeys'",
      ""
    );

    // WezTerm
    lines.push(
      "\x1b[1m\u25b8 WezTerm\x1b[0m",
      "  File: ~/.wezterm.lua",
      "  config.keys = {",
      '    { key = "Enter", mods = "SHIFT", action = wezterm.action.SendString "\\n" },',
      "  }",
      ""
    );

    lines.push(
      `${border}`,
      "\x1b[1mFallbacks (always work, no setup):\x1b[0m",
      "  Ctrl+J  \u2192 insert newline",
      "  \\ + Enter \u2192 insert newline (backslash then Enter)",
      `${border}`
    );

    process.stdout.write(lines.join("\n") + "\n");
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
