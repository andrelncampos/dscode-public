/**
 * Conservative terminal runtime detection for UX purposes only.
 *
 * This module does NOT affect key parsing. It only provides hints for
 * the footer, help modal, welcome screen, and --help output so that
 * users are not shown incorrect keyboard shortcut information.
 *
 * In some Windows environments (CMD/Console Host, classic PowerShell),
 * Shift+Enter arrives as plain Enter (0x0D) — technically impossible
 * to distinguish. The guidance below reflects that reality.
 */

export type TerminalRuntimeKind =
  | "classic-windows-console"
  | "windows-terminal"
  | "vscode-terminal"
  | "wezterm"
  | "mintty-like"
  | "conemu"
  | "cmder"
  | "xterm-compatible"
  | "unknown";

export type ShiftEnterReliability = "reliable" | "configurable" | "terminal-dependent" | "not-reliable" | "unknown";

export type NewlinePrimaryShortcut = "Shift+Enter" | "Ctrl+J";

export type TerminalRuntimeProfile = {
  kind: TerminalRuntimeKind;
  confidence: "high" | "medium" | "low";
  platform: NodeJS.Platform;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  term?: string;
  termProgram?: string;
  shell?: string;
  isWindows: boolean;
  isWindowsTerminal: boolean;
  isClassicWindowsConsole: boolean;
  isPowerShellLike: boolean;
  isCmdLike: boolean;
  isMinttyLike: boolean;
  shiftEnterReliability: ShiftEnterReliability;
  newlinePrimaryShortcut: NewlinePrimaryShortcut;
  /** True when the terminal supports CSI u / modifyOtherKeys for Shift+Enter. */
  shiftEnterCapable: boolean;
  shouldShowShiftEnterInFooter: boolean;
  footerNewlineHint: string;
  helpNewlineHint: string;
  diagnosticMessage: string;
};

interface PartialEnv {
  [key: string]: string | undefined;
}

/**
 * Detect the terminal runtime profile from environment variables.
 *
 * The detection order is deliberate: modern terminals that wrap a shell
 * (Windows Terminal, VS Code, WezTerm, ConEmu, Cmder) are checked first,
 * then mintty-like environments (Git Bash / MSYS2), and finally the
 * classic Windows console as a fallback.
 *
 * @param env - Environment variables (defaults to process.env).
 * @param platform - Runtime platform (defaults to process.platform).
 * @param stdinIsTTY - Whether stdin is a TTY (defaults to process.stdin.isTTY).
 * @param stdoutIsTTY - Whether stdout is a TTY (defaults to process.stdout.isTTY).
 */
export function detectTerminalRuntime(
  env: PartialEnv = process.env as PartialEnv,
  platform: NodeJS.Platform = process.platform,
  stdinIsTTY: boolean = process.stdin.isTTY ?? false,
  stdoutIsTTY: boolean = process.stdout.isTTY ?? false
): TerminalRuntimeProfile {
  const isWindows = platform === "win32";
  const term = env.TERM;
  const termProgram = env.TERM_PROGRAM;
  const shell = env.SHELL ?? env.ComSpec;

  // --- Windows Terminal ---
  if (env.WT_SESSION || env.WT_PROFILE_ID) {
    return profile({
      kind: "windows-terminal",
      confidence: "high",
      platform,
      stdinIsTTY,
      stdoutIsTTY,
      term,
      termProgram,
      shell,
      isWindows,
      shiftEnterReliability: "configurable",
      newlinePrimaryShortcut: "Ctrl+J",
      shiftEnterCapable: false,
      shouldShowShiftEnterInFooter: false,
      footerNewlineHint: "Enter send · Ctrl+J newline · \\ + Enter newline",
      helpNewlineHint: "Ctrl+J or \\ + Enter inserts a newline. Run /terminal-setup to configure Shift+Enter.",
      diagnosticMessage:
        "Windows Terminal detected. Shift+Enter requires Kitty protocol or key binding. Run /terminal-setup.",
    });
  }

  // --- VS Code terminal ---
  if (termProgram === "vscode") {
    return profile({
      kind: "vscode-terminal",
      confidence: "high",
      platform,
      stdinIsTTY,
      stdoutIsTTY,
      term,
      termProgram,
      shell,
      isWindows,
      shiftEnterReliability: "terminal-dependent",
      newlinePrimaryShortcut: "Ctrl+J",
      shiftEnterCapable: false,
      shouldShowShiftEnterInFooter: false,
      footerNewlineHint: "Enter send · Ctrl+J newline · \\ + Enter newline",
      helpNewlineHint: "Ctrl+J or \\ + Enter inserts a newline. Shift+Enter varies by terminal. Run /terminal-setup.",
      diagnosticMessage:
        "VS Code terminal detected. Shift+Enter depends on the underlying terminal. Use Ctrl+J or run /terminal-setup.",
    });
  }

  // --- WezTerm ---
  if (termProgram === "WezTerm" || env.WEZTERM_PANE) {
    return profile({
      kind: "wezterm",
      confidence: "high",
      platform,
      stdinIsTTY,
      stdoutIsTTY,
      term,
      termProgram,
      shell,
      isWindows,
      shiftEnterReliability: "configurable",
      newlinePrimaryShortcut: "Ctrl+J",
      shiftEnterCapable: false,
      shouldShowShiftEnterInFooter: false,
      footerNewlineHint: "Enter send · Ctrl+J newline · \\ + Enter newline",
      helpNewlineHint: "Ctrl+J or \\ + Enter inserts a newline. Shift+Enter may work if Kitty protocol activates.",
      diagnosticMessage: "WezTerm detected. Shift+Enter should work when Kitty protocol activates.",
    });
  }

  // --- Git Bash / MSYS / mintty-like ---
  if (env.MSYSTEM || env.MINGW_PREFIX || env.OSTYPE === "cygwin") {
    return profile({
      kind: "mintty-like",
      confidence: "medium",
      platform,
      stdinIsTTY,
      stdoutIsTTY,
      term,
      termProgram,
      shell,
      isWindows,
      isMinttyLike: true,
      shiftEnterReliability: "terminal-dependent",
      newlinePrimaryShortcut: "Ctrl+J",
      shiftEnterCapable: false,
      shouldShowShiftEnterInFooter: true,
      footerNewlineHint: "Enter send · Ctrl+J newline · \\ + Enter newline",
      helpNewlineHint:
        "Ctrl+J or \\ + Enter inserts a newline. Shift+Enter may not work in this terminal — run npm run debug:keys to verify.",
      diagnosticMessage:
        "Git Bash / MSYS / mintty-like terminal detected. Use Ctrl+J or \\ + Enter for newline — Shift+Enter may not work. Run npm run debug:keys to verify byte sequences.",
    });
  }

  // --- ConEmu ---
  if (env.ConEmuANSI || env.ConEmuPID) {
    return profile({
      kind: "conemu",
      confidence: "high",
      platform,
      stdinIsTTY,
      stdoutIsTTY,
      term,
      termProgram,
      shell,
      isWindows,
      shiftEnterReliability: "terminal-dependent",
      newlinePrimaryShortcut: "Ctrl+J",
      shiftEnterCapable: false,
      shouldShowShiftEnterInFooter: false,
      footerNewlineHint: "Enter send · Ctrl+J newline · \\ + Enter newline",
      helpNewlineHint: "Ctrl+J or \\ + Enter inserts a newline. Run /terminal-setup to configure Shift+Enter.",
      diagnosticMessage:
        "ConEmu detected. Shift+Enter support depends on configuration. Use Ctrl+J or run /terminal-setup.",
    });
  }

  // --- Cmder ---
  if (env.CmderRoot) {
    return profile({
      kind: "cmder",
      confidence: "high",
      platform,
      stdinIsTTY,
      stdoutIsTTY,
      term,
      termProgram,
      shell,
      isWindows,
      shiftEnterReliability: "terminal-dependent",
      newlinePrimaryShortcut: "Ctrl+J",
      shiftEnterCapable: false,
      shouldShowShiftEnterInFooter: false,
      footerNewlineHint: "Enter send · Ctrl+J newline · \\ + Enter newline",
      helpNewlineHint: "Ctrl+J or \\ + Enter inserts a newline. Run /terminal-setup to configure Shift+Enter.",
      diagnosticMessage:
        "Cmder detected. Shift+Enter support depends on configuration. Use Ctrl+J or run /terminal-setup.",
    });
  }

  // --- Classic Windows Console (CMD / PowerShell classic) ---
  // Any remaining Windows platform without a modern terminal wrapper,
  // mintty-like environment, or TERM variable.
  if (isWindows) {
    const isPowerShellLike = isPowerShellIndicator(env);
    const isCmdLike = isCmdIndicator(env) || !isPowerShellLike;

    return profile({
      kind: "classic-windows-console",
      confidence: "medium",
      platform,
      stdinIsTTY,
      stdoutIsTTY,
      term,
      termProgram,
      shell,
      isWindows,
      isClassicWindowsConsole: true,
      isPowerShellLike,
      isCmdLike,
      shiftEnterReliability: "not-reliable",
      newlinePrimaryShortcut: "Ctrl+J",
      shiftEnterCapable: false,
      shouldShowShiftEnterInFooter: false,
      footerNewlineHint: "Enter send · Ctrl+J newline · \\ + Enter newline",
      helpNewlineHint: "Ctrl+J or \\ + Enter inserts a newline. Shift+Enter is not reliable in this terminal.",
      diagnosticMessage:
        "Classic Windows console detected. Shift+Enter may arrive as plain Enter. Use Ctrl+J or \\ + Enter for newline.",
    });
  }

  // --- Unknown / xterm-compatible ---
  // Non-Windows platforms without a recognized terminal program.
  const isPSLike = isPowerShellIndicator(env);
  const isCmd = isCmdIndicator(env);
  return profile({
    kind: "unknown",
    confidence: "low",
    platform,
    stdinIsTTY,
    stdoutIsTTY,
    term,
    termProgram,
    shell,
    isWindows,
    isPowerShellLike: isPSLike,
    isCmdLike: isCmd || (!isPSLike && !isWindows),
    shiftEnterReliability: "unknown",
    newlinePrimaryShortcut: "Ctrl+J",
    shiftEnterCapable: false,
    shouldShowShiftEnterInFooter: false,
    footerNewlineHint: "Enter send · Ctrl+J newline · \\ + Enter newline",
    helpNewlineHint: "Ctrl+J or \\ + Enter inserts a newline. Shift+Enter may work on modern terminals.",
    diagnosticMessage:
      "Unknown terminal. Use Ctrl+J or \\ + Enter for newline. Run /terminal-setup if Shift+Enter doesn't work.",
  });
}

// ---- Helpers ----

function profile(
  p: Omit<
    TerminalRuntimeProfile,
    | "isWindowsTerminal"
    | "isClassicWindowsConsole"
    | "isMinttyLike"
    | "isPowerShellLike"
    | "isCmdLike"
    | "isWindows"
    | "stdinIsTTY"
    | "stdoutIsTTY"
  > & {
    platform: NodeJS.Platform;
    stdinIsTTY: boolean;
    stdoutIsTTY: boolean;
    isWindows: boolean;
    isMinttyLike?: boolean;
    isClassicWindowsConsole?: boolean;
    isPowerShellLike?: boolean;
    isCmdLike?: boolean;
  }
): TerminalRuntimeProfile {
  return {
    ...p,
    isWindowsTerminal: p.kind === "windows-terminal",
    isClassicWindowsConsole: p.kind === "classic-windows-console",
    isMinttyLike: p.isMinttyLike ?? p.kind === "mintty-like",
    isPowerShellLike: p.isPowerShellLike ?? false,
    isCmdLike: p.isCmdLike ?? false,
  };
}

function isPowerShellIndicator(env: PartialEnv): boolean {
  // PSModulePath is the most reliable indicator of PowerShell/pwsh
  if (env.PSModulePath) return true;
  // PowerShell Core (pwsh) often sets PWSH or similar
  if (env.PWSH) return true;
  // Check shell path for powershell or pwsh
  const shell = (env.SHELL ?? env.ComSpec ?? "").toLowerCase();
  if (shell.includes("powershell") || shell.includes("pwsh")) return true;
  return false;
}

function isCmdIndicator(env: PartialEnv): boolean {
  // ComSpec pointing to cmd.exe is a strong indicator of CMD
  const comspec = (env.ComSpec ?? "").toLowerCase();
  if (comspec.endsWith("cmd.exe") || comspec.includes("\\cmd.exe")) return true;
  return false;
}
