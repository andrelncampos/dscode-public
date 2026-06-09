import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTerminalRuntime, type TerminalRuntimeProfile } from "../ui/core/terminal-runtime";

// ---- Helpers ----

function profile(overrides: Partial<Record<string, string>>): TerminalRuntimeProfile {
  return detectTerminalRuntime(overrides);
}

function assertFooterContains(profile: TerminalRuntimeProfile, substring: string): void {
  assert.ok(
    profile.footerNewlineHint.includes(substring),
    `footerNewlineHint "${profile.footerNewlineHint}" should contain "${substring}"`
  );
}

function assertFooterNotContains(profile: TerminalRuntimeProfile, substring: string): void {
  assert.ok(
    !profile.footerNewlineHint.includes(substring),
    `footerNewlineHint "${profile.footerNewlineHint}" should NOT contain "${substring}"`
  );
}

// ---- Tests ----

// 1. Classic Windows Console
test("classic Windows console — env without TERM, TERM_PROGRAM, WT_SESSION, MSYSTEM, etc.", () => {
  const env: Record<string, string> = {};
  const rt = detectTerminalRuntime(env, "win32", true, true);

  assert.equal(rt.kind, "classic-windows-console");
  assert.equal(rt.confidence, "medium");
  assert.equal(rt.isWindows, true);
  assert.equal(rt.isClassicWindowsConsole, true);
  assert.equal(rt.isWindowsTerminal, false);
  assert.equal(rt.shiftEnterReliability, "not-reliable");
  assert.equal(rt.newlinePrimaryShortcut, "Ctrl+J");
  assert.equal(rt.shouldShowShiftEnterInFooter, false);
  assertFooterContains(rt, "Ctrl+J");
  assertFooterNotContains(rt, "Shift+Enter");
  assert.ok(
    rt.helpNewlineHint.includes("not reliable"),
    `helpNewlineHint should mention unreliability: "${rt.helpNewlineHint}"`
  );
  assert.ok(
    rt.diagnosticMessage.includes("Classic Windows console"),
    `diagnosticMessage should mention classic console: "${rt.diagnosticMessage}"`
  );
});

// 2. Windows Terminal via WT_SESSION
test("Windows Terminal — WT_SESSION defined", () => {
  const env = { WT_SESSION: "abc123" };
  const rt = detectTerminalRuntime(env, "win32", true, true);

  assert.equal(rt.kind, "windows-terminal");
  assert.equal(rt.confidence, "high");
  assert.equal(rt.isWindowsTerminal, true);
  assert.equal(rt.isClassicWindowsConsole, false);
  assert.equal(rt.shiftEnterReliability, "configurable");
  assert.equal(rt.newlinePrimaryShortcut, "Ctrl+J");
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
  assertFooterContains(rt, "Ctrl+J");
  assertFooterContains(rt, "Shift+Enter");
  assertFooterContains(rt, "configured");
});

// 2b. Windows Terminal via WT_PROFILE_ID
test("Windows Terminal — WT_PROFILE_ID defined", () => {
  const env = { WT_PROFILE_ID: "{some-guid}" };
  const rt = detectTerminalRuntime(env, "win32", true, true);

  assert.equal(rt.kind, "windows-terminal");
  assert.equal(rt.isWindowsTerminal, true);
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
  assertFooterContains(rt, "Shift+Enter");
});

// 2c. Windows Terminal should override PowerShell/Cmd indicators
test("Windows Terminal with PowerShell shell — still Windows Terminal", () => {
  const env = { WT_SESSION: "abc", PSModulePath: "C:\\Modules" };
  const rt = detectTerminalRuntime(env, "win32", true, true);

  assert.equal(rt.kind, "windows-terminal");
  assert.equal(rt.isWindowsTerminal, true);
  assert.equal(rt.isClassicWindowsConsole, false);
});

test("Windows Terminal with CMD shell — still Windows Terminal", () => {
  const env = { WT_SESSION: "abc", ComSpec: "C:\\Windows\\System32\\cmd.exe" };
  const rt = detectTerminalRuntime(env, "win32", true, true);

  assert.equal(rt.kind, "windows-terminal");
  assert.equal(rt.isWindowsTerminal, true);
});

// 3. VS Code terminal
test("VS Code terminal — TERM_PROGRAM=vscode", () => {
  const rt = detectTerminalRuntime({ TERM_PROGRAM: "vscode" });

  assert.equal(rt.kind, "vscode-terminal");
  assert.equal(rt.confidence, "high");
  assert.equal(rt.shiftEnterReliability, "terminal-dependent");
  assert.equal(rt.newlinePrimaryShortcut, "Ctrl+J");
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
  assertFooterContains(rt, "Ctrl+J");
  assertFooterContains(rt, "Shift+Enter");
  assertFooterContains(rt, "supported");
});

// 4. WezTerm via TERM_PROGRAM
test("WezTerm — TERM_PROGRAM=WezTerm", () => {
  const rt = detectTerminalRuntime({ TERM_PROGRAM: "WezTerm" });

  assert.equal(rt.kind, "wezterm");
  assert.equal(rt.confidence, "high");
  assert.equal(rt.shiftEnterReliability, "configurable");
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
  assertFooterContains(rt, "Ctrl+J");
  assertFooterContains(rt, "Shift+Enter");
  assertFooterContains(rt, "configured");
});

// 4b. WezTerm via WEZTERM_PANE
test("WezTerm — WEZTERM_PANE defined", () => {
  const rt = detectTerminalRuntime({ WEZTERM_PANE: "0" });

  assert.equal(rt.kind, "wezterm");
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
  assertFooterContains(rt, "Shift+Enter");
});

// 5. Git Bash / MSYS / mintty-like
test("Git Bash / MSYS — MSYSTEM=MINGW64 and TERM=xterm-256color", () => {
  const env = { MSYSTEM: "MINGW64", TERM: "xterm-256color" };
  const rt = detectTerminalRuntime(env, "win32", true, true);

  assert.equal(rt.kind, "mintty-like");
  assert.equal(rt.confidence, "medium");
  assert.equal(rt.isMinttyLike, true);
  assert.equal(rt.shiftEnterReliability, "terminal-dependent");
  assert.equal(rt.newlinePrimaryShortcut, "Ctrl+J");
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
  assertFooterContains(rt, "Ctrl+J");
  assertFooterContains(rt, "Shift+Enter");
  assertFooterContains(rt, "supported");
});

// 5b. mintty via MINGW_PREFIX
test("mintty-like — MINGW_PREFIX defined", () => {
  const rt = detectTerminalRuntime({ MINGW_PREFIX: "/mingw64" }, "win32", true, true);

  assert.equal(rt.kind, "mintty-like");
  assert.equal(rt.isMinttyLike, true);
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
});

// 5c. MSYS should override classic detection
test("mintty-like with MSYSTEM — not classic", () => {
  const env = { MSYSTEM: "MSYS" };
  const rt = detectTerminalRuntime(env, "win32", true, true);

  assert.equal(rt.kind, "mintty-like");
  assert.equal(rt.isClassicWindowsConsole, false);
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
});

// 6. ConEmu
test("ConEmu — ConEmuANSI defined", () => {
  const rt = detectTerminalRuntime({ ConEmuANSI: "ON" }, "win32", true, true);

  assert.equal(rt.kind, "conemu");
  assert.equal(rt.confidence, "high");
  assert.equal(rt.shiftEnterReliability, "terminal-dependent");
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
  assertFooterContains(rt, "Ctrl+J");
  assertFooterContains(rt, "Shift+Enter");
  assertFooterContains(rt, "supported");
});

// 7. Cmder
test("Cmder — CmderRoot defined", () => {
  const rt = detectTerminalRuntime({ CmderRoot: "C:\\cmder" }, "win32", true, true);

  assert.equal(rt.kind, "cmder");
  assert.equal(rt.confidence, "high");
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
  assertFooterContains(rt, "Ctrl+J");
  assertFooterContains(rt, "Shift+Enter");
  assertFooterContains(rt, "supported");
});

// 8. Unknown terminal (non-Windows, no recognized env vars)
test("Unknown — non-Windows platform without recognized env vars", () => {
  const rt = detectTerminalRuntime({}, "linux", true, true);

  assert.equal(rt.kind, "unknown");
  assert.equal(rt.confidence, "low");
  assert.equal(rt.isWindows, false);
  assert.equal(rt.isClassicWindowsConsole, false);
  assert.equal(rt.isWindowsTerminal, false);
  assert.equal(rt.shiftEnterReliability, "unknown");
  assert.equal(rt.newlinePrimaryShortcut, "Ctrl+J");
  assert.equal(rt.shouldShowShiftEnterInFooter, true);
  assertFooterContains(rt, "Ctrl+J");
  assertFooterContains(rt, "Shift+Enter");
  assertFooterContains(rt, "supported");
  assert.ok(
    rt.diagnosticMessage.includes("Unknown terminal"),
    `diagnosticMessage should mention unknown: "${rt.diagnosticMessage}"`
  );
});

// 9. PowerShell-like detection
test("PowerShell-like — PSModulePath present without terminal wrapper", () => {
  const env = { PSModulePath: "C:\\Modules" };
  const rt = detectTerminalRuntime(env, "win32", true, true);

  assert.equal(rt.kind, "classic-windows-console");
  assert.equal(rt.isPowerShellLike, true);
  assert.equal(rt.isCmdLike, false);
  assert.equal(rt.shouldShowShiftEnterInFooter, false);
});

// 10. CMD-like detection
test("CMD-like — ComSpec pointing to cmd.exe without terminal wrapper", () => {
  const env = { ComSpec: "C:\\Windows\\System32\\cmd.exe" };
  const rt = detectTerminalRuntime(env, "win32", true, true);

  assert.equal(rt.kind, "classic-windows-console");
  assert.equal(rt.isCmdLike, true);
  assert.equal(rt.isPowerShellLike, false);
  assert.equal(rt.shouldShowShiftEnterInFooter, false);
});

// 11. PowerShell with SHELL env pointing to pwsh
test("PowerShell-like via SHELL with pwsh in path", () => {
  const env = { SHELL: "/usr/bin/pwsh" };
  const rt = detectTerminalRuntime(env, "linux", true, true);

  // On Linux, PSModulePath is not set by default, but SHELL=pwsh should flag it
  assert.equal(rt.isPowerShellLike, true);
});

// 12. helpNewlineHint verification for classic Windows console
test("helpNewlineHint for classic Windows console recommends Ctrl+J", () => {
  const rt = detectTerminalRuntime({}, "win32", true, true);

  assert.ok(rt.helpNewlineHint.includes("Ctrl+J"), `helpNewlineHint should mention Ctrl+J: "${rt.helpNewlineHint}"`);
  assert.ok(
    rt.helpNewlineHint.includes("not reliable"),
    `helpNewlineHint should mention unreliability: "${rt.helpNewlineHint}"`
  );
});

// 13. All profiles have Ctrl+J as primary shortcut
test("All terminal profiles use Ctrl+J as primary newline shortcut", () => {
  const profiles = [
    detectTerminalRuntime({}, "win32", true, true),
    detectTerminalRuntime({ WT_SESSION: "abc" }, "win32", true, true),
    detectTerminalRuntime({ TERM_PROGRAM: "vscode" }, "win32", true, true),
    detectTerminalRuntime({ TERM_PROGRAM: "WezTerm" }, "win32", true, true),
    detectTerminalRuntime({ MSYSTEM: "MINGW64" }, "win32", true, true),
    detectTerminalRuntime({ ConEmuANSI: "ON" }, "win32", true, true),
    detectTerminalRuntime({ CmderRoot: "C:\\cmder" }, "win32", true, true),
    detectTerminalRuntime({}, "linux", true, true),
  ];

  for (const rt of profiles) {
    assert.equal(
      rt.newlinePrimaryShortcut,
      "Ctrl+J",
      `Profile kind=${rt.kind} should have newlinePrimaryShortcut=Ctrl+J`
    );
    assert.ok(
      rt.footerNewlineHint.includes("Ctrl+J"),
      `Profile kind=${rt.kind} footerNewlineHint should mention Ctrl+J: "${rt.footerNewlineHint}"`
    );
  }
});

// 14. No profile says simply "Shift+Enter newline" without qualifier
test("No profile has bare Shift+Enter newline without qualifier in footer", () => {
  const profiles = [
    detectTerminalRuntime({}, "win32", true, true),
    detectTerminalRuntime({ WT_SESSION: "abc" }, "win32", true, true),
    detectTerminalRuntime({ TERM_PROGRAM: "vscode" }, "win32", true, true),
    detectTerminalRuntime({ TERM_PROGRAM: "WezTerm" }, "win32", true, true),
    detectTerminalRuntime({ MSYSTEM: "MINGW64" }, "win32", true, true),
    detectTerminalRuntime({}, "linux", true, true),
  ];

  for (const rt of profiles) {
    if (rt.footerNewlineHint.includes("Shift+Enter")) {
      // Must include a qualifier — "if supported", "if configured", or "terminal-dependent"
      const hasQualifier =
        rt.footerNewlineHint.includes("if supported") ||
        rt.footerNewlineHint.includes("if configured") ||
        rt.footerNewlineHint.includes("terminal-dependent");
      assert.ok(hasQualifier, `Profile kind=${rt.kind} shows Shift+Enter without qualifier: "${rt.footerNewlineHint}"`);
    }
  }
});

// 15. stdinIsTTY / stdoutIsTTY are passed through
test("stdinIsTTY and stdoutIsTTY are passed through", () => {
  const rt1 = detectTerminalRuntime({}, "linux", false, true);
  assert.equal(rt1.stdinIsTTY, false);
  assert.equal(rt1.stdoutIsTTY, true);

  const rt2 = detectTerminalRuntime({}, "linux", true, false);
  assert.equal(rt2.stdinIsTTY, true);
  assert.equal(rt2.stdoutIsTTY, false);
});

// 16. Term and termProgram are preserved
test("term and termProgram are preserved in profile", () => {
  const rt = detectTerminalRuntime({ TERM: "xterm-kitty", TERM_PROGRAM: "kitty" }, "linux", true, true);

  assert.equal(rt.term, "xterm-kitty");
  assert.equal(rt.termProgram, "kitty");
});

// 17. Shell is preserved
test("shell is preserved from env", () => {
  const rt = detectTerminalRuntime({ SHELL: "/bin/zsh" }, "linux", true, true);

  assert.equal(rt.shell, "/bin/zsh");
});

test("shell falls back to ComSpec on Windows when SHELL is unset", () => {
  const rt = detectTerminalRuntime({ ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "win32", true, true);

  assert.equal(rt.shell, "C:\\Windows\\System32\\cmd.exe");
});

// 18. Platform is preserved
test("platform is preserved in profile", () => {
  const rt1 = detectTerminalRuntime({}, "win32", true, true);
  assert.equal(rt1.platform, "win32");

  const rt2 = detectTerminalRuntime({}, "darwin", true, true);
  assert.equal(rt2.platform, "darwin");

  const rt3 = detectTerminalRuntime({}, "linux", true, true);
  assert.equal(rt3.platform, "linux");
});
