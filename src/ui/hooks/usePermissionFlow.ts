import { useCallback, useState } from "react";
import type { PermissionScope } from "../../settings";
import type { SessionEntry } from "../../session";
import type { UserToolPermission } from "../../common/permissions";

export type PendingPermissionReply = {
  sessionId: string;
  permissions: UserToolPermission[];
  alwaysAllows: PermissionScope[];
};

export type PermissionFlowReturn = {
  activeAskPermissions: SessionEntry["askPermissions"];
  setActiveAskPermissions: (
    value: SessionEntry["askPermissions"] | ((prev: SessionEntry["askPermissions"]) => SessionEntry["askPermissions"])
  ) => void;
  pendingPermissionReply: PendingPermissionReply | null;
  setPendingPermissionReply: (
    value: PendingPermissionReply | null | ((prev: PendingPermissionReply | null) => PendingPermissionReply | null)
  ) => void;
  clearPendingPermission: () => void;
};

/**
 * Manages the permission-request lifecycle for tool execution approval.
 *
 * Tracks the currently active permission requests (`activeAskPermissions`)
 * and any pending reply that the user has composed but not yet submitted.
 *
 * @returns Permission state, setters, and a `clearPendingPermission` helper
 * @sideEffects None — pure state management
 */
export function usePermissionFlow(): PermissionFlowReturn {
  const [activeAskPermissions, setActiveAskPermissions] = useState<SessionEntry["askPermissions"]>(undefined);
  const [pendingPermissionReply, setPendingPermissionReply] = useState<PendingPermissionReply | null>(null);

  const clearPendingPermission = useCallback(() => {
    setPendingPermissionReply(null);
  }, []);

  return {
    activeAskPermissions,
    setActiveAskPermissions,
    pendingPermissionReply,
    setPendingPermissionReply,
    clearPendingPermission,
  };
}
