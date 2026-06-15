export { useTerminalInput, parseTerminalInput, dispatchTerminalInput, classifyReturnAction } from "./useTerminalInput";
export type { InputKey, DscodeReturnAction } from "./useTerminalInput";

export {
  enableKittyProtocol,
  getKittyProtocolState,
  useKittyProtocolActive,
  buildKittyPushSequence,
  buildKittyPopSequence,
} from "./kitty-protocol";
export type { KittyProtocolMode, KittyProtocolState } from "./kitty-protocol";

export {
  useHiddenTerminalCursor,
  useTerminalExtendedKeys,
  useBracketedPaste,
  usePromptTerminalCursor,
  useTerminalFocusReporting,
  getPromptCursorPlacement,
  hardWrapText,
  measureTextPosition,
} from "./cursor";

export { usePasteHandling } from "./usePasteHandling";
export type { PasteRegion, PasteHandlingState, PasteHandlingActions } from "./usePasteHandling";

export { useHistoryNavigation } from "./useHistoryNavigation";
export type { HistoryNavigationState, HistoryNavigationActions } from "./useHistoryNavigation";

export { useStreamingState, type StreamingState } from "./useStreamingState";
export { usePermissionFlow, type PendingPermissionReply, type PermissionFlowReturn } from "./usePermissionFlow";
export { useSessionManager, type SessionManagerCallbacks, type UseSessionManagerReturn } from "./useSessionManager";
export { useResizeHandler, type ResizeHandlerOptions } from "./useResizeHandler";
export { useWelcomeScreen, type UseWelcomeScreenReturn } from "./useWelcomeScreen";
