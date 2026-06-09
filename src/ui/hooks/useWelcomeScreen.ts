import { useCallback, useMemo, useState } from "react";
import type { SessionMessage } from "../../session";
import { ANSI_CLEAR_SCREEN } from "../constants";

export type UseWelcomeScreenReturn = {
  showWelcome: boolean;
  setShowWelcome: (value: boolean | ((prev: boolean) => boolean)) => void;
  welcomeNonce: number;
  setWelcomeNonce: (value: number | ((prev: number) => number)) => void;
  welcomeItem: SessionMessage;
  bumpNonce: () => void;
  resetStaticView: (
    loadedMessages: SessionMessage[],
    setMessages: (msgs: SessionMessage[]) => void,
    options?: { clearScreen?: boolean }
  ) => void;
};

/**
 * Manages the welcome screen lifecycle and Static component reset logic.
 *
 * The welcome screen is shown when no session messages are present.
 * `resetStaticView` clears messages, bumps a nonce key (forcing re-render),
 * then re-loads messages — this is the mechanism for resetting Ink's <Static>.
 *
 * @returns Welcome visibility state, nonce, synthetic welcome message, and reset helpers
 * @sideEffects `resetStaticView` writes ANSI clear-screen escape and triggers setTimeout
 */
export function useWelcomeScreen(): UseWelcomeScreenReturn {
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeNonce, setWelcomeNonce] = useState(0);

  const bumpNonce = useCallback(() => {
    setWelcomeNonce((n) => n + 1);
  }, []);

  const resetStaticView = useCallback(
    (
      loadedMessages: SessionMessage[],
      setMessages: (msgs: SessionMessage[]) => void,
      options?: { clearScreen?: boolean }
    ) => {
      if (options?.clearScreen) {
        process.stdout.write(ANSI_CLEAR_SCREEN);
      }
      setMessages([]);
      setWelcomeNonce((n) => n + 1);
      setTimeout(() => {
        setMessages(loadedMessages);
        setShowWelcome(true);
      }, 0);
    },
    []
  );

  const welcomeItem: SessionMessage = useMemo(
    () => ({
      id: `__welcome__${welcomeNonce}`,
      sessionId: "",
      role: "system" as const,
      content: "",
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: "",
      updateTime: "",
    }),
    [welcomeNonce]
  );

  return {
    showWelcome,
    setShowWelcome,
    welcomeNonce,
    setWelcomeNonce,
    welcomeItem,
    bumpNonce,
    resetStaticView,
  };
}
