import React from "react";
import { Box, Text } from "ink";

type StatusBarProps = {
  line: string | null;
};

export const StatusBar = React.memo(function StatusBar({ line }: StatusBarProps): React.ReactElement | null {
  if (!line) {
    return null;
  }

  return (
    <Box>
      <Text dimColor>{line}</Text>
    </Box>
  );
});
