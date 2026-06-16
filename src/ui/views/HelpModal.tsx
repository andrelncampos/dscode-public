import React, { useMemo } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { useLocale } from "../../i18n/context";
import {
  HELP_MODAL_MAX_WIDTH,
  HELP_MODAL_MIN_WIDTH,
  HELP_MODAL_MAX_HEIGHT,
  HELP_MODAL_KEY_COL_WIDTH,
  HELP_MODAL_KEY_COL_MAX_RATIO,
} from "../core/layout-constants";
import type { TerminalRuntimeProfile } from "../core/terminal-runtime";
import { detectTerminalRuntime } from "../core/terminal-runtime";

type HelpModalProps = {
  onClose: () => void;
};

type ShortcutEntry = {
  key: string;
  description: string;
  separator?: boolean;
};

function buildBaseShortcuts(t: (key: string) => string, profile: TerminalRuntimeProfile): ShortcutEntry[] {
  return [
    // ── Keyboard ──
    { key: "?", description: t("help.toggle") },
    { key: "Esc", description: t("help.close") },
    { key: "Ctrl+C", description: t("help.cancel") },
    { key: "Ctrl+O", description: t("help.view-output") },
    { key: "Ctrl+V", description: t("help.paste-image") },
    { key: "Ctrl+Z", description: t("help.undo") },
    { key: "Ctrl+Shift+Z", description: t("help.redo") },
    { key: "Ctrl+Left/Right", description: t("help.jump-word") },
    { key: "Alt+Left/Right", description: t("help.jump-word-mac") },
    { key: "Ctrl+A", description: t("help.line-start") },
    { key: "Ctrl+E", description: t("help.line-end") },
    { key: "Ctrl+K", description: t("help.kill-line") },
    { key: "Ctrl+W", description: t("help.delete-word") },
    { key: "Alt+Backspace", description: t("help.delete-word-alt") },
    { key: "Up/Down", description: t("help.history") },
    { key: "Tab", description: t("help.autocomplete") },
    { key: profile.newlinePrimaryShortcut, description: t("help.newline") },
    { key: "Enter", description: t("help.submit") },
    { key: "@", description: t("help.file-mention") },
    { key: "/", description: t("help.command-menu") },
    { key: "PageUp/PageDown", description: t("help.scroll-history") },
    // ── Conversation ──
    { key: "", description: "", separator: true },
    { key: "/model", description: t("help.model-cmd") },
    { key: "/new", description: t("help.new-cmd") },
    { key: "/resume", description: t("help.resume-cmd") },
    { key: "/continue", description: t("help.continue-cmd") },
    { key: "/init", description: t("help.init-cmd") },
    { key: "/undo", description: t("help.undo-cmd") },
    { key: "/exit", description: t("help.exit-cmd") },
    { key: "/skills", description: t("help.skills-cmd") },
    { key: "/cls", description: t("help.cls-cmd") },
    { key: "/raw", description: t("help.raw-cmd") },
    { key: "/mcp", description: t("help.mcp-cmd") },
    // ── Notes ──
    { key: "", description: "", separator: true },
    { key: "/notes-add", description: t("help.notes-add-cmd") },
    { key: "/notes", description: t("help.notes-cmd") },
    { key: "/notes-status", description: t("help.notes-status-cmd") },
    { key: "/notes-edit", description: t("help.notes-edit-cmd") },
    { key: "/notes-deadline", description: t("help.notes-deadline-cmd") },
    { key: "/notes-delete", description: t("help.notes-delete-cmd") },
    // ── Specs ──
    { key: "", description: "", separator: true },
    { key: "/spec-init", description: t("help.spec-init-cmd") },
    { key: "/spec-plan", description: t("help.spec-plan-cmd") },
    { key: "/spec-new", description: t("help.spec-new-cmd") },
    { key: "/spec-verify", description: t("help.spec-verify-cmd") },
    { key: "/spec-implement", description: t("help.spec-implement-cmd") },
    { key: "/spec-audit", description: t("help.spec-audit-cmd") },
    { key: "/spec-list", description: t("help.spec-list-cmd") },
    { key: "/spec-status", description: t("help.spec-status-cmd") },
    // ── Models ──
    { key: "", description: "", separator: true },
    { key: "/model-list", description: t("help.model-list-cmd") },
    { key: "/model-add", description: t("help.model-add-cmd") },
    { key: "/model-remove", description: t("help.model-remove-cmd") },
    { key: "/model-info", description: t("help.model-info-cmd") },
    { key: "/model-key", description: t("help.model-key-cmd") },
    { key: "/model-default", description: t("help.model-default-cmd") },
    { key: "/model-params", description: t("help.model-params-cmd") },
    { key: "/model-thinking", description: t("help.model-thinking-cmd") },
    // ── Steering & Budget ──
    { key: "", description: "", separator: true },
    { key: "/steering-add", description: t("help.steering-add-cmd") },
    { key: "/steering-list", description: t("help.steering-list-cmd") },
    { key: "/steering-remove", description: t("help.steering-remove-cmd") },
    { key: "/steering-alter", description: t("help.steering-alter-cmd") },
    { key: "/budget", description: t("help.budget-cmd") },
  ];
}

export const HelpModal = React.memo(function HelpModal({ onClose }: HelpModalProps): React.ReactElement {
  const { columns, rows } = useWindowSize();
  const { t } = useLocale();

  const shortcuts = useMemo(() => {
    const profile = detectTerminalRuntime();
    const base = buildBaseShortcuts(t, profile);
    // For terminals that support Shift+Enter, the primary shortcut is already
    // set by the profile. For terminals that don't, show only Ctrl+J.
    // Always add Shift+Enter as a secondary option when the terminal may support it
    // but the primary fallback is Ctrl+J.
    if (!profile.shiftEnterCapable) {
      return base;
    }
    // Insert Ctrl+J as a fallback hint after the primary newline shortcut
    const newlineIndex = base.findIndex((s) => s.key === profile.newlinePrimaryShortcut);
    const result = [...base];
    if (newlineIndex !== -1 && profile.newlinePrimaryShortcut !== "Ctrl+J") {
      result.splice(newlineIndex + 1, 0, {
        key: "Ctrl+J",
        description: t("welcome.tip-insert-newline-alt"),
      });
    }
    return result;
  }, [t]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (!key.ctrl && !key.meta && !key.shift && input === "?") {
      onClose();
      return;
    }
    if (key.ctrl && (input === "c" || input === "C")) {
      onClose();
      return;
    }
  });

  const modalWidth = useMemo(
    () => Math.min(HELP_MODAL_MAX_WIDTH, Math.max(HELP_MODAL_MIN_WIDTH, columns - 4)),
    [columns]
  );
  const modalHeight = useMemo(() => Math.min(rows - 4, HELP_MODAL_MAX_HEIGHT), [rows]);
  const keyColWidth = useMemo(
    () => Math.min(HELP_MODAL_KEY_COL_WIDTH, Math.floor(modalWidth * HELP_MODAL_KEY_COL_MAX_RATIO)),
    [modalWidth]
  );

  return (
    <Box flexDirection="column" width={modalWidth} height={modalHeight} overflow="hidden" paddingX={1} marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderDimColor flexGrow={1} overflow="hidden" paddingX={1}>
        {/* Header */}
        <Box paddingY={1}>
          <Text bold color="#229ac3">
            {t("help.title")}
          </Text>
        </Box>

        {/* Shortcut rows */}
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {shortcuts.map((shortcut, idx) =>
            shortcut.separator ? (
              <Box key={`sep-${idx}`} flexShrink={0} height={1}>
                <Text> </Text>
              </Box>
            ) : (
              <Box key={shortcut.key} flexDirection="row" flexShrink={0} height={1}>
                <Box width={keyColWidth} flexShrink={0}>
                  <Text dimColor>{shortcut.key}</Text>
                </Box>
                <Box flexGrow={1} overflow="hidden">
                  <Text wrap="truncate-end">{shortcut.description}</Text>
                </Box>
              </Box>
            )
          )}
        </Box>

        {/* Footer */}
        <Box paddingY={1}>
          <Text dimColor>{t("help.press-esc")}</Text>
        </Box>
      </Box>
    </Box>
  );
});

export default HelpModal;
