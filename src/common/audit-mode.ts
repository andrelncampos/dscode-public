/**
 * Audit mode detection.
 *
 * Set once at CLI startup via setAuditMode(), read anywhere via isAuditMode().
 * When audit mode is active, the CLI self-restricts:
 *  - No shell command execution
 *  - No file writes outside .dscode
 *  - Network only for LLM API calls (enforced at tool level)
 *
 * Combine with Node 24 Permission Model for OS-level sandbox:
 *   node --experimental-permission --permission-child-process=0 dscode.js --audit
 */

let auditMode = false;

/** Must be called once at CLI startup, before any session is created. */
export function setAuditMode(enabled: boolean): void {
  auditMode = enabled;
}

/** True when the CLI is running in audit/safe mode. */
export function isAuditMode(): boolean {
  return auditMode;
}
