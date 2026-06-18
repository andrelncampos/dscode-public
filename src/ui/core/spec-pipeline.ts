import type { SessionManager } from "../../session";

const MAX_VERIFY_ATTEMPTS = 5;
const MAX_AUDIT_ATTEMPTS = 5;

const VERIFY_DONE_MARKER = "No gaps found — 0 changes made.";
const AUDIT_DONE_MARKER = "No issues found — 0 changes made.";

/**
 * Runs the full SDD pipeline for a spec:
 *   1. /spec-new    — create spec documents
 *   2. /spec-verify — loop until zero gaps  (max 5 attempts)
 *   3. /spec-implement — implement the spec
 *   4. /spec-audit  — loop until zero issues (max 5 attempts)
 *
 * Returns a status message describing the result.
 */
export async function runSpecPipeline(specNumber: string, sessionManager: SessionManager): Promise<string> {
  const sessionId = sessionManager.getActiveSessionId();
  if (!sessionId) {
    return "No active session. Start a session first with /new.";
  }

  const submit = (text: string) => sessionManager.handleUserPrompt({ text, imageUrls: [], skills: [] });

  const lastAssistantContent = (): string | undefined => {
    const messages = sessionManager.listSessionMessages(sessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && typeof messages[i].content === "string") {
        return messages[i].content as string;
      }
    }
    return undefined;
  };

  // ── Step 1: spec-new ──
  await submit(`/spec-new ${specNumber}`);

  // ── Step 2: spec-verify (loop) ──
  let verified = false;
  for (let attempt = 0; attempt < MAX_VERIFY_ATTEMPTS; attempt++) {
    await submit(`/spec-verify ${specNumber}`);
    const content = lastAssistantContent();
    if (content?.includes(VERIFY_DONE_MARKER)) {
      verified = true;
      break;
    }
  }
  if (!verified) {
    return `Spec ${specNumber}: verify did not reach zero gaps after ${MAX_VERIFY_ATTEMPTS} attempts. Review manually.`;
  }

  // ── Step 3: spec-implement ──
  await submit(`/spec-implement ${specNumber}`);

  // ── Step 4: spec-audit (loop) ──
  let audited = false;
  for (let attempt = 0; attempt < MAX_AUDIT_ATTEMPTS; attempt++) {
    await submit(`/spec-audit ${specNumber}`);
    const content = lastAssistantContent();
    if (content?.includes(AUDIT_DONE_MARKER)) {
      audited = true;
      break;
    }
  }
  if (!audited) {
    return `Spec ${specNumber}: audit did not reach zero issues after ${MAX_AUDIT_ATTEMPTS} attempts. Review manually.`;
  }

  return `Spec ${specNumber} pipeline completed: created → verified → implemented → audited.`;
}

/**
 * Formats batch results into a deterministic Markdown summary string.
 * Exported for testability — external callers should use runSpecPipelineBatch instead.
 */
export function buildBatchSummary(ok: string[], failed: { spec: string; reason: string }[]): string {
  const total = ok.length + failed.length;

  // Single spec — return simple format (backward compat)
  if (total === 1) {
    if (ok.length === 1) {
      return `Spec ${ok[0]} pipeline completed: created → verified → implemented → audited.`;
    }
    return failed[0].reason; // verbatim from runSpecPipeline
  }

  // Multi-spec — Markdown report
  const lines: string[] = ["## Pipeline Batch Complete", ""];
  lines.push(`${ok.length}/${total} specs completed successfully.`);

  if (ok.length > 0) {
    lines.push("");
    lines.push("**Successful:**");
    for (const spec of ok) {
      lines.push(`- Spec ${spec}: created → verified → implemented → audited`);
    }
  }

  if (failed.length > 0) {
    lines.push("");
    lines.push("**Failed:**");
    for (const entry of failed) {
      lines.push(`- Spec ${entry.spec}: ${entry.reason}`);
    }
  }

  return lines.join("\n");
}

const PIPELINE_SUCCESS_MARKER = "pipeline completed";

/**
 * Runs the full SDD pipeline for an array of spec numbers sequentially.
 * Single spec is a degenerate case (array with one element).
 * Returns an aggregated result string (Markdown for batch, simple for single).
 */
export async function runSpecPipelineBatch(specNumbers: string[], sessionManager: SessionManager): Promise<string> {
  if (specNumbers.length === 0) {
    return "No spec numbers provided.";
  }

  const sessionId = sessionManager.getActiveSessionId();
  if (!sessionId) {
    return "No active session. Start a session first with /new.";
  }

  const ok: string[] = [];
  const failed: { spec: string; reason: string }[] = [];

  for (const specNumber of specNumbers) {
    try {
      const result = await runSpecPipeline(specNumber, sessionManager);
      if (result.includes(PIPELINE_SUCCESS_MARKER)) {
        ok.push(specNumber);
      } else {
        failed.push({ spec: specNumber, reason: result });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ spec: specNumber, reason: `Unexpected error: ${message}` });
    }
  }

  return buildBatchSummary(ok, failed);
}
