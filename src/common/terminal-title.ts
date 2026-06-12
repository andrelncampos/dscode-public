/**
 * Terminal window title manager using ANSI OSC escape sequences.
 *
 * Supported on:
 * - Windows Terminal, CMD (Win10 1511+), PowerShell 5.1+
 * - Linux: xterm, GNOME Terminal, Konsole, etc.
 * - macOS: Terminal.app, iTerm2
 * - Git Bash / mintty
 *
 * Guards against non-interactive terminals (stdout redirected to file/pipe).
 *
 * Uses OSC 0 (combined window + tab title) for maximum compatibility.
 * Does NOT attempt to read the current title, as most terminals do not
 * support OSC queries reliably. Instead, on dispose, clears the title
 * so the terminal's own heuristics can restore the previous value.
 */

const OSC_SET_TITLE = "\x1b]0;";
const OSC_TERMINATOR = "\x07";
const MAX_TITLE_LENGTH = 256;

/** Strip control characters that would corrupt the OSC sequence. */
function sanitize(raw: string): string {
  return raw.replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, MAX_TITLE_LENGTH);
}

// ── Public helpers ────────────────────────────────────────────────────

/** Emit an OSC 0 sequence to set the terminal title. No-op on non-TTY. */
export function setTerminalTitle(title: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${OSC_SET_TITLE}${sanitize(title)}${OSC_TERMINATOR}`);
}

/** Emit an OSC 0 sequence to clear the terminal title. No-op on non-TTY. */
export function clearTerminalTitle(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${OSC_SET_TITLE}${OSC_TERMINATOR}`);
}

// ── Template rendering ────────────────────────────────────────────────

export interface TerminalTitleContext {
  /** Session summary / title from session index */
  session?: string;
  /** Current model name */
  model?: string;
  /** Current working directory path */
  cwd?: string;
}

/**
 * Render a title template string with optional context variables.
 *
 * Supported placeholders:
 *   {{session}} - session summary / title
 *   {{model}}   - current model name
 *   {{cwd}}     - current working directory path
 *
 * Unknown placeholders are left as-is.
 */
export function renderTitleTemplate(template: string, context: TerminalTitleContext): string {
  return template
    .replace(/\{\{session\}\}/g, context.session ?? "DsCode")
    .replace(/\{\{model\}\}/g, context.model ?? "")
    .replace(/\{\{cwd\}\}/g, context.cwd ?? "");
}

// ── Manager ───────────────────────────────────────────────────────────

/**
 * Manages terminal window title lifecycle.
 *
 * On construction, immediately sets the initial title (if a template is
 * provided).  On dispose, clears the title.
 */
export class TerminalTitleManager {
  private enabled: boolean;

  constructor(template: string | undefined, context: TerminalTitleContext) {
    this.enabled = Boolean(template) && process.stdout.isTTY;
    if (this.enabled) {
      this.update(template!, context);
    }
  }

  /** Update the title from a template and context. */
  update(template: string, context: TerminalTitleContext): void {
    if (!this.enabled) return;
    setTerminalTitle(renderTitleTemplate(template, context));
  }

  /** Clear the terminal title (call on shutdown). */
  dispose(): void {
    if (!this.enabled) return;
    clearTerminalTitle();
  }

  /** Whether terminal title control is available for this process. */
  get isAvailable(): boolean {
    return this.enabled;
  }
}
