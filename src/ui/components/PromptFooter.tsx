import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import type { LlmStreamProgress } from "../../session";

type PromptFooterProps = {
  busy: boolean;
  streamProgress: LlmStreamProgress | null;
  statusMessage: string | null;
  footerText: string;
  showFooterText: boolean;
};

const KEY_COLOR = "cyan";
const FLASH_DURATION_MS = 5000;
const BLINK_INTERVAL_MS = 400;

function ColoredFooter({ text }: { text: string }): React.ReactElement {
  const parts = text.split(" · ");
  return (
    <Text>
      {parts.map((part, i) => {
        const match = part.match(/^(\S+)\s+(.+)$/);
        if (match) {
          const key = match[1]!;
          const desc = match[2]!;
          return (
            <React.Fragment key={i}>
              {i > 0 ? <Text dimColor> · </Text> : null}
              <Text color={KEY_COLOR}>{key}</Text>
              <Text dimColor> {desc}</Text>
            </React.Fragment>
          );
        }
        return (
          <React.Fragment key={i}>
            {i > 0 ? <Text dimColor> · </Text> : null}
            <Text dimColor>{part}</Text>
          </React.Fragment>
        );
      })}
    </Text>
  );
}

export const PromptFooter = React.memo(function PromptFooter({
  busy,
  streamProgress,
  statusMessage,
  footerText,
  showFooterText,
}: PromptFooterProps): React.ReactElement | null {
  const prevBusy = useRef(busy);
  const [readyFlash, setReadyFlash] = useState(false);
  const [blinkOn, setBlinkOn] = useState(true);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Detect busy → false transition
    if (prevBusy.current && !busy) {
      // Ring terminal bell
      process.stdout.write("\x07");
      setReadyFlash(true);
      setBlinkOn(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (blinkTimer.current) clearInterval(blinkTimer.current);
      flashTimer.current = setTimeout(() => {
        setReadyFlash(false);
        if (blinkTimer.current) {
          clearInterval(blinkTimer.current);
          blinkTimer.current = null;
        }
      }, FLASH_DURATION_MS);
      blinkTimer.current = setInterval(() => {
        setBlinkOn((prev) => !prev);
      }, BLINK_INTERVAL_MS);
    }
    prevBusy.current = busy;
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (blinkTimer.current) clearInterval(blinkTimer.current);
    };
  }, [busy]);

  if (showFooterText) {
    return null;
  }

  // Show "✓ Ready" flash with blinking after completion
  if (readyFlash) {
    return (
      <Box>
        <Text bold color={blinkOn ? "green" : "#e6b800"}>
          ✓ Ready
        </Text>
      </Box>
    );
  }

  // When busy and streaming, StatusHeader already shows the full StreamingIndicator.
  // Only render footer hints here to avoid duplication.
  if (busy && streamProgress) {
    return (
      <Box>
        <Text dimColor>esc to interrupt · ctrl+c to cancel input</Text>
      </Box>
    );
  }

  return (
    <Box>
      {statusMessage || (busy && footerText.trim()) ? (
        <Text dimColor>{footerText}</Text>
      ) : (
        <ColoredFooter text={footerText} />
      )}
    </Box>
  );
});
