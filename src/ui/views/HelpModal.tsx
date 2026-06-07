import React, { useMemo } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";

type HelpModalProps = {
  onClose: () => void;
};

type ShortcutEntry = {
  key: string;
  description: string;
};

const SHORTCUTS: ShortcutEntry[] = [
  { key: "?", description: "Toggle help (this screen)" },
  { key: "Esc", description: "Close current modal / cancel / interrupt" },
  { key: "Ctrl+C", description: "Cancel input / interrupt" },
  { key: "Ctrl+O", description: "View live process output / expand paste" },
  { key: "Ctrl+V", description: "Paste clipboard image" },
  { key: "Ctrl+Z", description: "Undo last prompt edit" },
  { key: "Ctrl+Shift+Z", description: "Redo last prompt edit" },
  { key: "Ctrl+Left/Right", description: "Jump word left/right" },
  { key: "Alt+Left/Right", description: "Jump word left/right (macOS)" },
  { key: "Ctrl+A", description: "Move to line start" },
  { key: "Ctrl+E", description: "Move to line end" },
  { key: "Ctrl+K", description: "Kill line from cursor" },
  { key: "Ctrl+W", description: "Delete word before cursor" },
  { key: "Alt+Backspace", description: "Delete word before cursor" },
  { key: "Up/Down", description: "Navigate history (when prompt empty) / navigate menus" },
  { key: "Tab", description: "Autocomplete (slash commands, file mentions)" },
  { key: "Shift+Enter", description: "Insert newline in prompt" },
  { key: "Enter", description: "Submit prompt (when not in menu)" },
  { key: "@", description: "Trigger file mention autocomplete" },
  { key: "/", description: "Trigger slash command menu" },
  { key: "/model", description: "Change model" },
  { key: "/new", description: "New conversation" },
  { key: "/resume", description: "Resume previous conversation" },
  { key: "/undo", description: "Restore code/conversation to earlier point" },
  { key: "/raw", description: "Toggle raw display mode" },
  { key: "/mcp", description: "Show MCP server status" },
  { key: "/exit", description: "Quit dscode" },
  { key: "PageUp/PageDown", description: "Scroll message history" },
];

const KEY_COL_WIDTH = 20;

export const HelpModal = React.memo(function HelpModal({ onClose }: HelpModalProps): React.ReactElement {
  const { columns, rows } = useWindowSize();

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

  const modalWidth = useMemo(() => Math.min(60, Math.max(30, columns - 4)), [columns]);
  const modalHeight = useMemo(() => Math.min(rows - 4, 24), [rows]);
  const keyColWidth = useMemo(() => Math.min(KEY_COL_WIDTH, Math.floor(modalWidth * 0.35)), [modalWidth]);

  return (
    <Box flexDirection="column" width={modalWidth} height={modalHeight} overflow="hidden" paddingX={1} marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderDimColor flexGrow={1} overflow="hidden" paddingX={1}>
        {/* Header */}
        <Box paddingY={1}>
          <Text bold color="#229ac3">
            Keyboard Shortcuts
          </Text>
        </Box>

        {/* Shortcut rows */}
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {SHORTCUTS.map((shortcut) => (
            <Box key={shortcut.key} flexDirection="row" flexShrink={0} height={1}>
              <Box width={keyColWidth} flexShrink={0}>
                <Text dimColor>{shortcut.key}</Text>
              </Box>
              <Box flexGrow={1} overflow="hidden">
                <Text wrap="truncate-end">{shortcut.description}</Text>
              </Box>
            </Box>
          ))}
        </Box>

        {/* Footer */}
        <Box paddingY={1}>
          <Text dimColor>Press Esc or ? to close</Text>
        </Box>
      </Box>
    </Box>
  );
});

export default HelpModal;
