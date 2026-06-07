export type NewPromptReportOptions = {
  enabled: boolean;
  timeoutMs?: number;
};

/**
 * Fire-and-forget report of a new prompt session.
 *
 * Telemetry is permanently disabled. No data is sent.
 */
export function reportNewPrompt(_options: NewPromptReportOptions): void {
  return;
}
