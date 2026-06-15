/**
 * Kitty Keyboard Protocol — lifecycle management.
 *
 * The Kitty protocol enables terminals to report key events with full modifier
 * information (Shift, Ctrl, Alt, Meta, Super, Hyper, CapsLock, NumLock).
 *
 * Without it, Enter and Shift+Enter are indistinguishable (both arrive as 0x0D).
 * With flag 8 ("report all keys as escape codes"), Shift+Enter arrives as
 * CSI 13;2u — fully distinguishable.
 *
 * Flags used (25 = 1 + 8 + 16):
 *   1  — disambiguate escape codes
 *   8  — report all keys as escape codes
 *   16 — report associated text (preserves text for printable keys)
 *
 * Protocol docs: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 *
 * Safety:
 *   - Query (CSI ? u) is safe to send to ANY terminal — unsupported terminals
 *     simply ignore it (200 ms timeout).
 *   - Push/Pop uses a stack — CSI > flags u pushes, CSI < u pops.
 *   - Restore is registered for SIGINT, SIGTERM, uncaughtException, beforeExit.
 *   - Alternate screen and main screen maintain independent stacks.
 */

// ── Protocol constants ────────────────────────────────────────────────

const CSI = "\x1b[";
const KITTY_QUERY = `${CSI}?u`; // Query protocol support
const KITTY_PUSH_PREFIX = `${CSI}>`;
const KITTY_PUSH_SUFFIX = "u";
const KITTY_POP = `${CSI}<u`; // Pop one level from the stack

/** Response pattern: CSI ? <flags> u */
const KITTY_QUERY_RESPONSE_RE = /^\x1b\[\?(\d+)(?:;(\d+))?u$/;

const KITTY_QUERY_TIMEOUT_MS = 200;
const KITTY_ENABLED_VALUE = 25; // 1 + 8 + 16 (disambiguate + report all keys + associated text)

// ── Internal state ────────────────────────────────────────────────────

import { useEffect, useState } from "react";

let kittyActive = false;
let kittySupported: boolean | null = null;

// ── Listeners (for React components to react to Kitty state changes) ────

type KittyChangeListener = (active: boolean) => void;
const listeners = new Set<KittyChangeListener>();

function notifyListeners(active: boolean): void {
  for (const l of listeners) l(active);
}

/** Subscribe to Kitty protocol state changes. Returns unsubscribe function. */
export function onKittyChange(listener: KittyChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── Public API ─────────────────────────────────────────────────────────

export type KittyProtocolMode = "auto" | "enabled" | "disabled";

export type KittyProtocolState = {
  /** Whether the terminal confirmed Kitty protocol support. */
  supported: boolean | null; // null = not yet queried
  /** Whether the protocol is currently active. */
  active: boolean;
  /** Flags value pushed to the terminal. */
  flags: number | null;
};

/** Read the current state (for diagnostics like /keys). */
export function getKittyProtocolState(): KittyProtocolState {
  return {
    supported: kittySupported,
    active: kittyActive,
    flags: kittyActive ? KITTY_ENABLED_VALUE : null,
  };
}

/**
 * React hook: returns true when the Kitty Keyboard Protocol is active.
 * Updates reactively when the protocol activates or deactivates.
 */
export function useKittyProtocolActive(): boolean {
  const [active, setActive] = useState(kittyActive);
  useEffect(() => onKittyChange(setActive), []);
  return active;
}

/**
 * Activate the Kitty Keyboard Protocol.
 *
 * In "auto" mode, queries the terminal first (safe CSI ? u). Only activates
 * if the terminal responds confirming support.
 *
 * In "enabled" mode, activates without querying (for terminals like WezTerm
 * that support it but may not respond to the query).
 *
 * In "disabled" mode, does nothing.
 *
 * Returns a cleanup function. Call it on app shutdown to restore the
 * terminal's keyboard mode stack.
 */
export function enableKittyProtocol(
  mode: KittyProtocolMode,
  stdin: NodeJS.ReadStream | null,
  stdout: NodeJS.WriteStream | null
): () => void {
  if (mode === "disabled" || !stdin || !stdout || !stdin.isTTY || !stdout.isTTY) {
    return () => {};
  }

  if (mode === "enabled") {
    return activateKittyProtocol(stdin, stdout);
  }

  // "auto" mode: query first, then activate if supported.
  queryKittySupport(stdin, stdout, (supported) => {
    if (supported) {
      activateKittyProtocol(stdin, stdout);
    }
  });

  return () => deactivateKittyProtocol(stdout);
}

// ── Internal implementation ───────────────────────────────────────────

function queryKittySupport(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  onResult: (supported: boolean) => void
): void {
  const responseBuffer: string[] = [];
  let resolved = false;

  const resolve = (supported: boolean) => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timer);
    stdin.removeListener("data", onData);
    kittySupported = supported;
    onResult(supported);
  };

  const timer = setTimeout(() => {
    // No response within timeout — terminal does not support Kitty.
    resolve(false);
  }, KITTY_QUERY_TIMEOUT_MS);

  const onData = (data: Buffer | string) => {
    if (resolved) return;
    const raw = String(data);
    responseBuffer.push(raw);

    // Check if we have a complete response (CSI ? flags u).
    const combined = responseBuffer.join("");
    const match = combined.match(KITTY_QUERY_RESPONSE_RE);
    if (match) {
      // Response received — terminal supports Kitty.
      resolve(true);
    } else if (combined.length > 64) {
      // Garbage — something responded but not with a Kitty query reply.
      resolve(false);
    }
  };

  stdin.on("data", onData);

  // Send the query.
  stdout.write(KITTY_QUERY);
}

function activateKittyProtocol(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream): () => void {
  if (kittyActive) return () => {}; // Already active.

  const pushSequence = `${KITTY_PUSH_PREFIX}${KITTY_ENABLED_VALUE}${KITTY_PUSH_SUFFIX}`;
  stdout.write(pushSequence);
  kittyActive = true;
  kittySupported = true;
  notifyListeners(true);

  // Register restore handlers.
  const pop = () => {
    if (!kittyActive) return;
    try {
      stdout.write(KITTY_POP);
    } catch {
      // Terminal may already be closed — ignore.
    }
    kittyActive = false;
    notifyListeners(false);
  };

  const onExit = () => pop();
  const onSignal = () => {
    pop();
    process.exit(1);
  };

  process.on("beforeExit", onExit);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // Also try to restore on uncaught exceptions.
  const onUncaught = () => pop();
  process.on("uncaughtException", onUncaught);

  return () => {
    process.removeListener("beforeExit", onExit);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("uncaughtException", onUncaught);
    pop();
  };
}

function deactivateKittyProtocol(stdout: NodeJS.WriteStream): void {
  if (!kittyActive) return;
  try {
    stdout.write(KITTY_POP);
  } catch {
    // Ignore.
  }
  kittyActive = false;
  notifyListeners(false);
}

/** Build a push sequence string for arbitrary flag values. */
export function buildKittyPushSequence(flags: number): string {
  return `${KITTY_PUSH_PREFIX}${flags}${KITTY_PUSH_SUFFIX}`;
}

/** Build a pop sequence string. */
export function buildKittyPopSequence(): string {
  return KITTY_POP;
}
