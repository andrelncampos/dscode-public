import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render } from "ink";
import { setShellIfWindows } from "./common/shell-utils";
import { checkForNpmUpdate, promptForPendingUpdate, type PackageInfo } from "./common/update-check";
import { migrateAllLevels } from "./common/dscode-paths";
import { setAuditMode } from "./common/audit-mode";
import { AppContainer } from "./ui";
import { detectTerminalRuntime } from "./ui/core/terminal-runtime";

const args = process.argv.slice(2);
const packageInfo = readPackageInfo();

const isAuditMode = args.includes("--audit") || args.includes("--safe");

if (args.includes("--version") || args.includes("-v")) {
  const version = packageInfo.version || "unknown";
  const nodeVersion = process.version;
  const platform = `${process.platform} ${process.arch}`;
  process.stdout.write(
    [`dscode ${version}`, `node   ${nodeVersion}`, `${platform}`, "", `github.com/andrelncampos/dscode`].join("\n") +
      "\n"
  );
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  const rt = detectTerminalRuntime();
  const newlineHintLine = rt.isClassicWindowsConsole
    ? "  ctrl+j           Insert a newline (always available; Shift+Enter is not reliable in this terminal)"
    : "  ctrl+j           Insert a newline (always available)\n  shift+enter      Insert a newline (terminal-dependent)";
  process.stdout.write(
    [
      "dscode - dscode CLI",
      "",
      "Usage:",
      "  dscode                              Launch the interactive TUI in the current directory",
      "  dscode -p <prompt>                  Launch with a pre-filled prompt",
      "  dscode --prompt <prompt>            Same as -p",
      "  dscode --audit                      Safe audit mode (no file writes, no commands)",
      "  dscode --version                    Print version, node, and platform info",
      "  dscode --update                     Check for updates and install the latest version",
      "  dscode --help                       Show this help",
      "",
      "Safe audit mode (--audit):",
      "  Read-only analysis. No shell commands are executed, no files are",
      "  modified. Combine with Node 24 Permission Model for OS-level sandbox:",
      "    node --experimental-permission --permission-child-process=0 dscode.js --audit",
      "",
      "Configuration:",
      "  ~/.dscode/settings.json    User-level API key, model, base URL",
      "  ./.dscode/settings.json    Project-level settings",
      "  ./.dscode/skills/*/SKILL.md Project-level native skills",
      "  ./.agents/skills/*/SKILL.md   Project-level interoperable skills",
      "  ~/.dscode/skills/*/SKILL.md User-level native skills",
      "  ~/.agents/skills/*/SKILL.md   User-level interoperable skills",
      "",
      "Inside the TUI:",
      "  enter            Send the prompt",
      newlineHintLine,
      "  home/end         Move within the current line",
      "  alt+left/right   Move by word",
      "  ctrl+w           Delete the previous word",
      "  ctrl+v           Paste an image from the clipboard",
      "  ctrl+x           Clear pasted images",
      "  esc              Interrupt the current model turn",
      "  /                Open the skills/commands menu",
      "  /skills          List available skills",
      "  /model           Select model, thinking mode and effort control",
      "  /new             Start a fresh conversation",
      "  /init            Initialize an AGENTS.md file with instructions for LLM",
      "  /resume          Pick a previous conversation to continue",
      "  /continue        Continue the active conversation, or resume one if empty",
      "  /undo            Restore code and/or conversation to a previous point",
      "  /mcp             Show MCP server status and available tools",
      "  /raw             Toggle display mode for viewing or collapsing reasoning content",
      "  /exit            Quit",
      "  ctrl+d twice     Quit",
    ].join("\n") + "\n"
  );
  process.exit(0);
}

if (args.includes("--update")) {
  process.stdout.write(`dscode ${packageInfo.version || "unknown"} — checking for updates...\n`);
  const found = await checkForNpmUpdate(packageInfo);
  if (!found) {
    process.stdout.write("DsCode is up to date.\n");
    process.exit(0);
  }
  const result = await promptForPendingUpdate(packageInfo);
  if (result.installed) {
    process.exit(0);
  }
  process.stdout.write("Update skipped.\n");
  process.exit(0);
}

function extractInitialPrompt(args: string[]): string | undefined {
  const promptIndex = args.findIndex((arg) => arg === "-p" || arg === "--prompt");
  if (promptIndex !== -1 && promptIndex + 1 < args.length) {
    return args[promptIndex + 1];
  }
  return undefined;
}

let initialPrompt = extractInitialPrompt(args);
const projectRoot = process.cwd();
configureWindowsShell();

// Initialize audit mode early, before any session or tool execution
setAuditMode(isAuditMode);

if (isAuditMode) {
  process.stderr.write("[dscode] Running in safe audit mode — no shell commands, no file writes.\n");
}

if (!process.stdin.isTTY) {
  process.stderr.write("dscode requires an interactive terminal (TTY). " + "Re-run from a real terminal session.\n");
  process.exit(1);
}

// Migrate any legacy .deepcode directories to .dscode at all three levels
// (project root, git worktree root, and user home).
const migratedPaths = migrateAllLevels(projectRoot);
if (migratedPaths.length > 0) {
  process.stderr.write(
    `[dscode] Migrated legacy configuration from .deepcode to .dscode in: ${migratedPaths.join(", ")}\n`
  );
}

void main();

async function main(): Promise<void> {
  const updatePromptResult = await promptForPendingUpdate(packageInfo);
  if (updatePromptResult.installed) {
    process.exit(0);
  }

  // Check for updates in THIS session (3s timeout), not just next startup.
  // This way the user sees the update prompt today, not tomorrow.
  {
    const UPDATE_CHECK_TIMEOUT_MS = 3_000;
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, UPDATE_CHECK_TIMEOUT_MS));
    const found = await Promise.race([checkForNpmUpdate(packageInfo), timeout.then(() => false)]);
    if (found) {
      const updatePromptResult = await promptForPendingUpdate(packageInfo);
      if (updatePromptResult.installed) {
        process.exit(0);
      }
    }
  }

  const restartRef: { current: (() => void) | null } = { current: null };

  function startApp(): void {
    let restarting = false;
    const appInitialPrompt = initialPrompt;
    initialPrompt = undefined;
    const inkInstance = render(
      <AppContainer
        projectRoot={projectRoot}
        version={packageInfo.version}
        initialPrompt={appInitialPrompt}
        onRestart={() => restartRef.current?.()}
      />,
      { exitOnCtrlC: false }
    );

    restartRef.current = () => {
      restarting = true;
      process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      inkInstance.unmount();
      startApp();
    };

    inkInstance.waitUntilExit().then(() => {
      if (!restarting) {
        restartRef.current = null;
        process.exit(0);
      }
    });
  }

  startApp();
}

function configureWindowsShell(): void {
  process.env.NoDefaultCurrentDirectoryInExePath = "1";
  try {
    setShellIfWindows();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`dscode: ${message}\n`);
    process.exit(1);
  }
}

function readPackageInfo(): PackageInfo {
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(currentDir, "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { name?: unknown; version?: unknown };
    return {
      name: typeof pkg.name === "string" ? pkg.name : "@andrelncampos/dscode",
      version: typeof pkg.version === "string" ? pkg.version : "",
    };
  } catch {
    return {
      name: "@andrelncampos/dscode",
      version: process.env.DSCODE_VERSION || "",
    };
  }
}
