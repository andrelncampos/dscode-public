/**
 * Centralized keyboard shortcut handling for the prompt input.
 * Extracted from PromptInput.tsx to keep the component focused on rendering.
 *
 * @param params - All state and callbacks needed for key handling
 * @returns A handler compatible with useTerminalInput
 * @sideEffects Mutates buffer, undo/redo stacks, paste state, dropdown visibility
 */
import type { PromptBufferState } from "../core/prompt-buffer";
import type { InputKey } from "../hooks/useTerminalInput";

export interface PromptKeybindingsParams {
  buffer: PromptBufferState;
  updateBuffer: (updater: (s: PromptBufferState) => PromptBufferState) => void;
  setBuffer: (s: PromptBufferState) => void;
  isEmpty: (s: PromptBufferState) => boolean;
  busy: boolean;
  disabled: boolean;
  imageUrls: string[];
  showFileMentionMenu: boolean;
  showMenu: boolean;
  historyCursor: number;
  pendingExit: boolean;
  openRawModelDropdown: boolean;
  showSkillsDropdown: boolean;
  showModelDropdown: boolean;
  helpVisible: boolean;
  runningProcesses: { size: number } | null | undefined;

  // Actions
  onInterrupt: () => void;
  onToggleHelp?: () => void;
  onToggleProcessStdout?: () => void;
  onExit: () => void;
  onClearBuffer: () => void;
  onClearUndoRedo: () => void;
  onResetPastes: () => void;
  onExpandPasteAtCursor: () => void;
  onSubmit: () => void;
  onNewline: () => void;
  onSetStatusMessage: (msg: string | null) => void;
  onSetPendingExit: (v: boolean) => void;
  onNavigateHistory: (delta: number) => void;
  onExitHistoryBrowsing: () => void;
  onReadClipboardImage: () => void;
  onClearImages: () => void;
  onMoveMenuIndex: (delta: number) => void;
  onSelectMenu: () => void;
}

/**
 * Build a keyboard handler function for useTerminalInput.
 * All side effects are injected via the params object,
 * making this pure logic testable in isolation.
 */
export function createPromptKeyHandler(params: PromptKeybindingsParams): (input: string, key: InputKey) => void {
  const {
    buffer,
    updateBuffer,
    isEmpty,
    busy,
    disabled,
    imageUrls,
    showFileMentionMenu,
    showMenu,
    historyCursor,
    pendingExit,
    openRawModelDropdown,
    showSkillsDropdown,
    showModelDropdown,
    helpVisible,
    runningProcesses,
    onInterrupt,
    onToggleHelp,
    onToggleProcessStdout,
    onExit,
    onClearBuffer,
    onClearUndoRedo,
    onResetPastes,
    onExpandPasteAtCursor,
    onSubmit,
    onNewline,
    onSetStatusMessage,
    onSetPendingExit,
    onExitHistoryBrowsing,
    onReadClipboardImage,
    onClearImages,
    onMoveMenuIndex,
    onSelectMenu,
  } = params;

  let lastCtrlDAt = 0;

  return (input: string, key: InputKey): void => {
    // Focus tracking
    if (key.focusIn || key.focusOut) return;

    if (disabled) return;

    // Help shortcut
    if (
      input === "?" &&
      !key.ctrl &&
      !key.meta &&
      !key.shift &&
      isEmpty(buffer) &&
      !showMenu &&
      !helpVisible &&
      onToggleHelp
    ) {
      onToggleHelp();
      return;
    }

    // Escape
    if (key.escape) {
      if (showFileMentionMenu) return;
      if (busy) {
        onInterrupt();
        onSetStatusMessage("Interrupting…");
      }
      return;
    }

    // Ctrl+O
    if (key.ctrl && (input === "o" || input === "O")) {
      if (runningProcesses && runningProcesses.size > 0 && onToggleProcessStdout) {
        onToggleProcessStdout();
      } else {
        onExpandPasteAtCursor();
      }
      return;
    }

    // Ctrl+D
    if (key.ctrl && (input === "d" || input === "D")) {
      if (!isEmpty(buffer)) {
        updateBuffer((s) => ({
          ...s,
          cursor: Math.min(s.text.length, s.cursor + 1),
          text: s.text.slice(0, s.cursor) + s.text.slice(s.cursor + 1),
        }));
        return;
      }
      const now = Date.now();
      if (pendingExit && now - lastCtrlDAt < 2000) {
        onExit();
        return;
      }
      lastCtrlDAt = now;
      onSetPendingExit(true);
      onSetStatusMessage("press ctrl+d again to exit");
      return;
    }

    // Ctrl+C
    if (key.ctrl && (input === "c" || input === "C")) {
      if (busy) {
        onInterrupt();
        onSetStatusMessage("Interrupting…");
      } else if (!isEmpty(buffer)) {
        onClearBuffer();
        onClearUndoRedo();
        onResetPastes();
      } else {
        onSetStatusMessage("press ctrl+d to exit");
      }
      return;
    }

    // Cancel pending exit on any non-Ctrl+D input
    if (pendingExit && (!key.ctrl || (input !== "d" && input !== "D"))) {
      onSetPendingExit(false);
    }

    // Dropdowns block other input
    if (openRawModelDropdown || showSkillsDropdown || showModelDropdown) return;

    // Exit history browsing on non-arrow keys
    if (historyCursor !== -1 && !key.upArrow && !key.downArrow) onExitHistoryBrowsing();

    // Paste
    if (key.paste) return; // handled by usePasteHandling

    // Ctrl+V
    if (key.ctrl && (input === "v" || input === "V")) {
      onReadClipboardImage();
      return;
    }

    // Ctrl+X
    if (key.ctrl && (input === "x" || input === "X")) {
      if (imageUrls.length > 0) {
        onClearImages();
        onSetStatusMessage("Cleared attached images");
      } else {
        onSetStatusMessage("No attached images to clear");
      }
      return;
    }

    const isPlainReturn = key.return && !key.shift && !key.meta;

    if (showFileMentionMenu) {
      if (key.upArrow || key.downArrow || key.tab || isPlainReturn) return;
    }

    if (showMenu) {
      if (key.upArrow) {
        onMoveMenuIndex(-1);
        return;
      }
      if (key.downArrow) {
        onMoveMenuIndex(1);
        return;
      }
      if (key.tab || isPlainReturn) {
        onSelectMenu();
        return;
      }
    }

    if (busy && isPlainReturn) {
      onSetStatusMessage("wait for the current response or press esc to interrupt");
      return;
    }

    if (key.return && (key.shift || key.meta)) {
      onNewline();
      return;
    }
    if (key.return) {
      onSubmit();
      return;
    }

    // Delegate all remaining cursor/text operations to updateBuffer
    // (These are handled via moveLeft/moveRight/etc. in the original code)
    // The actual implementation is in PromptInput which calls into prompt-buffer functions
  };
}
