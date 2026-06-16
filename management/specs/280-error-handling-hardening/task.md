---
name: error-handling-hardening
status: verified
references: V29, L7
---

# Spec 280: Error Handling Hardening — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially. Tasks 1-2 are independent of each other and can be done in any order. Tasks 3-5 depend on 1-2.

## Tasks

### Task 1: Add `classifyApiError` Pure Function + Unit Tests

**Objective:** Create the error classification function and its test file.

**Requirements Covered:** FR-002.
**Design References:** Component 1 in design.md.

**Actions:**
1. Open `src/common/error-logger.ts`.
2. Add after the `ApiErrorLogEntry` type and before `logApiError`:

```typescript
export function classifyApiError(err: unknown): string {
  // Extract status and message from various error shapes
  let status: number | undefined;
  let message: string;
  let code: string | undefined;

  if (err instanceof Error) {
    message = err.message;
    code = (err as NodeJS.ErrnoException).code;
    status = (err as Record<string, unknown>).status as number | undefined;
    if (status === undefined) {
      const resp = (err as Record<string, unknown>).response as Record<string, unknown> | undefined;
      status = resp?.status as number | undefined;
    }
  } else if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    message = typeof e.message === "string" ? e.message : String(err);
    status = typeof e.status === "number" ? e.status : undefined;
    code = typeof e.code === "string" ? e.code : undefined;
    if (status === undefined) {
      const resp = e.response as Record<string, unknown> | undefined;
      status = resp?.status as number | undefined;
    }
  } else if (typeof err === "string") {
    message = err;
  } else {
    return "Unknown error: (no details)";
  }

  // Network errors (no HTTP status)
  if (status === undefined && code !== undefined) {
    if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "ECONNRESET") {
      return "Network error — check your connection";
    }
  }

  // HTTP status-based classification
  if (status !== undefined) {
    if (status === 401) return "Authentication failed — check your API key";
    if (status === 403) return "Access denied — your account may lack access to this model";
    if (status === 404) return "Model not found — the model name may be incorrect or unavailable in your region";
    if (status === 429) return "Rate limit exceeded — wait and retry";
    if (status === 413) return "Request too large — reduce input size";
    if (status === 400 && /context|length/i.test(message)) {
      return "Context length exceeded — reduce conversation size";
    }
    if (status >= 400 && status < 500) return `Client error (HTTP ${status}): ${message}`;
    if (status >= 500) return `Provider server error (HTTP ${status}) — the API may be down`;
  }

  return `Unknown error: ${message}`;
}
```

3. Create `src/tests/error-logger.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyApiError } from "../common/error-logger";

test("classifyApiError — 401 → auth failure", () => {
  assert.equal(
    classifyApiError({ status: 401, message: "Unauthorized" }),
    "Authentication failed — check your API key"
  );
});

test("classifyApiError — 403 → access denied", () => {
  assert.equal(
    classifyApiError({ status: 403, message: "Forbidden" }),
    "Access denied — your account may lack access to this model"
  );
});

test("classifyApiError — 404 → model not found", () => {
  assert.equal(
    classifyApiError({ status: 404, message: "Not found" }),
    "Model not found — the model name may be incorrect or unavailable in your region"
  );
});

test("classifyApiError — 429 → rate limit", () => {
  assert.equal(
    classifyApiError({ status: 429, message: "Too many requests" }),
    "Rate limit exceeded — wait and retry"
  );
});

test("classifyApiError — 413 → request too large", () => {
  assert.equal(
    classifyApiError({ status: 413, message: "Payload too large" }),
    "Request too large — reduce input size"
  );
});

test("classifyApiError — 400 + context keyword", () => {
  assert.equal(
    classifyApiError({ status: 400, message: "context length exceeded" }),
    "Context length exceeded — reduce conversation size"
  );
});

test("classifyApiError — 400 + length keyword", () => {
  assert.equal(
    classifyApiError({ status: 400, message: "This model's maximum context length is 8192 tokens" }),
    "Context length exceeded — reduce conversation size"
  );
});

test("classifyApiError — ECONNREFUSED", () => {
  assert.equal(
    classifyApiError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" }),
    "Network error — check your connection"
  );
});

test("classifyApiError — ETIMEDOUT", () => {
  assert.equal(
    classifyApiError({ code: "ETIMEDOUT", message: "timeout" }),
    "Network error — check your connection"
  );
});

test("classifyApiError — 502 → provider error", () => {
  assert.equal(
    classifyApiError({ status: 502, message: "Bad gateway" }),
    "Provider server error (HTTP 502) — the API may be down"
  );
});

test("classifyApiError — 4xx unknown", () => {
  assert.equal(
    classifyApiError({ status: 418, message: "I'm a teapot" }),
    "Client error (HTTP 418): I'm a teapot"
  );
});

test("classifyApiError — null input", () => {
  assert.equal(
    classifyApiError(null),
    "Unknown error: (no details)"
  );
});

test("classifyApiError — plain string", () => {
  assert.equal(
    classifyApiError("connection refused"),
    "Unknown error: connection refused"
  );
});

test("classifyApiError — 400 without context/length keywords", () => {
  assert.equal(
    classifyApiError({ status: 400, message: "Bad request" }),
    "Client error (HTTP 400): Bad request"
  );
});

test("classifyApiError — 429 without message", () => {
  assert.equal(
    classifyApiError({ status: 429 }),
    "Rate limit exceeded — wait and retry"
  );
});
```

**Validation:** `npx tsc --noEmit` passes. `node --import tsx --test src/tests/error-logger.test.ts` — 15 tests pass.

**Status:** [x] done

---

### Task 2: Harden `logApiError` + Add `category` Field

**Objective:** Make the error logger write to stderr when it fails internally. Add optional `category` field to `ApiErrorLogEntry`.

**Requirements Covered:** FR-001.
**Design References:** Components 2 and 3 in design.md.

**Actions:**
1. Open `src/common/error-logger.ts`.
2. Add `category?: string;` field to `ApiErrorLogEntry` type after the `error.stack?` line.
3. In `logApiError`, add `category: entry.category` to the `logLine` object.
4. Replace the silent catch block (lines 78-80) with:

```typescript
  } catch (logErr: unknown) {
    try {
      const msg = logErr instanceof Error ? logErr.message : String(logErr);
      process.stderr.write(`[dscode] Failed to write to error log: ${msg}\n`);
    } catch {
      // Last resort: even stderr failed. Nothing more we can do.
    }
  }
```

**Validation:** `npx tsc --noEmit` passes.

**Status:** [x] done

---

### Task 3: Integrate `classifyApiError` into `session.ts`

**Objective:** Use classified error messages for API failures shown to the user.

**Requirements Covered:** FR-003, FR-005.
**Design References:** Component 4 in design.md.

**Actions:**
1. Open `src/session.ts`.
2. Update the import from `./common/error-logger` to include `classifyApiError`:
   ```
   import { logApiError, classifyApiError } from "./common/error-logger";
   ```
3. **Inner catch (~line 1571):** Find the `catch (error) {` block that calls `logApiError` and re-throws.
   Before the `logApiError` call, add:
   ```typescript
   const category = classifyApiError(error);
   ```
   Add `category` to the `logApiError` entry object.
4. **Outer catch (~line 1739):** Find the outer `catch (error) {` that builds the user-facing message.
   After line 1740 (`const errMessage = ...`), add:
   ```typescript
   const category = classifyApiError(error);
   ```
   Replace line 1760 (`\`Request failed: ${errMessage}\``) with:
   ```typescript
   `API error: ${category}`
   ```

**Validation:** `npx tsc --noEmit` passes. `npm test` — all tests pass.

**Status:** [x] done

---

### Task 4: Audit Tier-1 Catch Blocks

**Objective:** Add comments or stderr output to every silent catch block in session.ts, prompt.ts, settings.ts.

**Requirements Covered:** FR-004.
**Design References:** Component 5 in design.md (audit table).

**Actions:**
1. Open `src/session.ts`. For each silent catch block listed in the audit table (Component 5):
   - Add `// intentional: <reason>` comment for legitimate blocks.
   - Add `process.stderr.write(...)` for diagnostic gap blocks (lines 2769, 3718).
2. Open `src/prompt.ts`. For all 6 silent catch blocks: add `// intentional: <reason>` comments.
3. Open `src/settings.ts`. For each silent catch block:
   - Add `// intentional: <reason>` comments for legitimate blocks.
   - Add `process.stderr.write(...)` for diagnostic gap blocks (lines 1047, 1080).

**Validation:** `npx tsc --noEmit` passes. `npm test` — all tests pass.

**Status:** [x] done

---

### Task 5: Run Full Test Suite + Manual Smoke Test

**Objective:** Verify zero regressions and correct error messages.

**Requirements Covered:** NFR-001, NFR-002.
**Design References:** Testing Strategy in design.md.

**Actions:**
1. Run `npm test` — confirm all tests pass (214 pass, 0 fail expected).
2. Run `node --import tsx --test src/tests/error-logger.test.ts` — confirm 15 pass.
3. Manual smoke test (optional but recommended):
   - Set an invalid API key, send a message, verify error: `"API error: Authentication failed — check your API key"`.
   - Disconnect network, send a message, verify error: `"API error: Network error — check your connection"`.

**Validation:** `npm test` → 214+ pass, 0 fail. `error-logger.test.ts` → 15 pass.

**Status:** [x] done
