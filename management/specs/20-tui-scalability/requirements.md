# Spec 20: TUI Scalability — Requirements

## Value Block

V1: Terminal-Native Conversational Interface — maintainability enhancement.

## Non-Functional Requirements

### NFR1: Type Safety
All code must pass `npm run typecheck` with zero errors.

### NFR2: Test Integrity
All 37 existing tests must pass via `npm run test` after every QW.

### NFR3: Behavior Preservation
No user-facing behavior may change. All refactoring is internal-only.

### NFR4: Lint Integrity
`npm run lint` must not introduce new warnings. Existing warnings are permitted.

### NFR5: Code Reduction Targets
- `App.tsx` must be reduced by at least 200 lines from its pre-spec state.
- `PromptInput.tsx` must be reduced by at least 150 lines from its pre-spec state.

### NFR6: No New Dependencies
No npm packages may be added. Use only what is already declared in `package.json`.

### NFR7: No New Tests
No new test files may be created. Only existing tests must be preserved.

### NFR8: Commit Isolation
Each QW must be a single, atomic git commit with message format: `refactor(ui): QW#N — descrição curta`

## Functional Requirements

### FR1: Command Handler Dispatch Map (QW#1)
The 14+ `if`/`else if` blocks in `handleSlashSelection` (PromptInput.tsx) must be replaced by a centralized dispatch map in `src/ui/core/command-handlers.ts`.
- **Acceptance Criterion:** `handleSlashSelection` becomes a thin wrapper that calls `executeSlashCommand(item, ctx)`.
- **Acceptance Criterion:** Adding a new slash command requires editing only `command-handlers.ts` (and `slash-commands.ts` for registration).
- **Acceptance Criterion:** `src/tests/slash-commands.test.ts` passes without modification.

### FR2: useStreamingState Hook (QW#2)
Streaming-related state (`busy`, `streamProgress`, `runningProcesses`, `nowTick`, `loadingText`) and the interval timer `useEffect` must be extracted from `App.tsx` into `src/ui/hooks/useStreamingState.ts`.
- **Acceptance Criterion:** `App.tsx` no longer contains `useState` for those 4 values, the timer `useEffect`, or the `loadingText` `useMemo`.
- **Acceptance Criterion:** The hook returns a named type `StreamingState` with explicit return type.

### FR3: usePermissionFlow Hook (QW#3)
Permission state (`activeAskPermissions`, `pendingPermissionReply`) must be extracted from `App.tsx` into `src/ui/hooks/usePermissionFlow.ts`.
- **Acceptance Criterion:** `App.tsx` no longer contains `useState` for those 2 values.
- **Acceptance Criterion:** The hook returns named types `PermissionFlowReturn` and `PendingPermissionReply`.
- **Acceptance Criterion:** `handlePermissionResult` and `handlePermissionCancel` remain in `App.tsx`.

### FR4: Centralized Layout Constants (QW#4)
All magic numbers from TUI layout must be extracted into `src/ui/core/layout-constants.ts`.
- **Acceptance Criterion:** SessionList, HelpModal, WelcomeScreen, and StreamingIndicator import their layout numbers from this module.
- **Acceptance Criterion:** Zero magic numbers remain in the 4 modified components. Constants for ErrorBanner, DropdownMenu, and SlashCommandMenu are defined in layout-constants.ts for future use but those components are not modified in this spec.

### FR5: Type-Safe View Router (QW#5)
The nested ternary cascade in `App.tsx` JSX must be replaced by `renderInteractiveArea()` using `switch/case`.
- **Acceptance Criterion:** `App.tsx` JSX contains `{renderInteractiveArea()}` instead of the ternary chain.
- **Acceptance Criterion:** The `View` type alias is exported from `App.tsx`.

### FR6: useSessionManager Hook (QW#6)
SessionManager creation, lifecycle effects (init MCP, dispose, warm client), `refreshSessionsList`, and `refreshSkills` must be extracted into `src/ui/hooks/useSessionManager.ts`.
- **Acceptance Criterion:** `App.tsx` no longer creates `SessionManager` via `useMemo`, no longer has the 4 lifecycle `useEffect` hooks for session manager, and no longer defines `refreshSessionsList`/`refreshSkills`.

### FR7: StatusBar Component (QW#7)
The inline status bar JSX in `App.tsx` must be extracted into `src/ui/components/StatusBar.tsx`.
- **Acceptance Criterion:** `App.tsx` uses `<StatusBar line={statusLine} />` instead of inline `<Box><Text dimColor>...`.

### FR8: PromptFooter Component (QW#8)
The footer section of `PromptInput.tsx` (model name, footer text, `ColoredFooter`, `StreamingIndicator`) must be extracted into `src/ui/components/PromptFooter.tsx`.
- **Acceptance Criterion:** `PromptInput.tsx` no longer defines `KEY_COLOR`, `ColoredFooter`, or inline footer JSX.
- **Acceptance Criterion:** `PromptInput.tsx` uses `<PromptFooter ... />`.

### FR9: Lazy Scan of File Mentions (QW#9)
File mention scanning must be deferred until the user types `@`.
- **Acceptance Criterion:** `scanFileMentionItems(projectRoot)` is not called on mount.
- **Acceptance Criterion:** File mention rescan still happens after the assistant creates new files (via existing `wasBusyRef` effect).
- **Acceptance Criterion:** `src/tests/file-mentions.test.ts` passes without modification.

### FR10: Error Classification Module (QW#10)
The `ERROR_PATTERNS` array and `classifyError` function must be extracted from `ErrorBanner.tsx` into `src/ui/core/error-classification.ts`.
- **Acceptance Criterion:** `ErrorBanner.tsx` imports `classifyError` from `../core/error-classification`.

### FR11: useResizeHandler Hook (QW#11)
The terminal resize `useEffect` and `lastRenderedColumnsRef` must be extracted from `App.tsx` into `src/ui/hooks/useResizeHandler.ts`.
- **Acceptance Criterion:** `App.tsx` no longer contains `lastRenderedColumnsRef` or the resize `useEffect`.

### FR12: Typed PromptInput Props (QW#12)
PromptInput props must be refactored into named interfaces (`PromptStreamState`, `PromptModelState`, `PromptDisplayState`) in `src/ui/types/prompt-input-types.ts`.
- **Acceptance Criterion:** The `Props` type in `PromptInput.tsx` is an intersection of the 3 named types plus 7 additional callbacks.
- **Acceptance Criterion:** No call-site changes needed — the type is structurally identical.

### FR13: Barrel Exports for core/ (QW#13)
A barrel file `src/ui/core/index.ts` must be created re-exporting all core modules.
- **Acceptance Criterion:** The barrel is additive only — no existing imports are changed.
- **Acceptance Criterion:** The barrel re-exports all 9 listed core modules (loading-text, prompt-buffer, slash-commands, file-mentions, thinking-state, ask-user-question, clipboard, error-classification, layout-constants).

### FR14: useWelcomeScreen Hook (QW#14)
Welcome screen state (`showWelcome`, `welcomeNonce`, `welcomeItem`, `resetStaticView`) must be extracted from `App.tsx` into `src/ui/hooks/useWelcomeScreen.ts`.
- **Acceptance Criterion:** `App.tsx` no longer contains `useState` for showWelcome/welcomeNonce, the `welcomeItem` useMemo, or the `resetStaticView` useCallback.

### FR15: Debounce Stream Progress (QW#15)
`setStreamProgress` calls during active streaming must be debounced to at most 1 update per 100ms.
- **Acceptance Criterion:** A 100ms debounce via IIFE closure wraps `setStreamProgress` in the `onLlmStreamProgress` callback.
- **Acceptance Criterion:** When `phase === "end"`, the pending timer is cancelled and state is cleared immediately (no debounce delay).
- **Acceptance Criterion:** StreamingIndicator updates smoothly without visual stutter.

## Edge Cases

### EC1: Busy State
When `busy=true`, all slash commands except `exit` must be blocked with status message "wait for the current response or press esc to interrupt". This behavior is preserved in the command handler dispatch (QW#1).

### EC2: Empty Slash Command Text
When a slash command is invoked with an empty buffer, the command name itself is used as fallback text (e.g., `/spec-plan` submits with text `/spec-plan` if buffer is empty). Preserved in `BUFFER_TEXT_COMMANDS` (QW#1).

### EC3: Stdout Buffer Overflow
When process stdout exceeds 1MB (`MAX_STDOUT_BUFFER = 1_000_000`), new chunks are silently discarded. Preserved in `onProcessStdout` callback (QW#6).

### EC4: Raw Mode Resize
When in `RawMode.Raw`, terminal resize clears the screen via ANSI escape and re-renders all messages. Preserved in `useResizeHandler` (QW#11).

### EC5: Permission Reply Interleaving
When a new permission request arrives while a previous one is pending, `pendingPermissionReply` is nullified. Preserved in `handlePrompt` -> `clearPendingPermission()` (QW#3).

### EC6: File Mention Token Detection
The `@` token detector in PromptInput must continue working after lazy scan changes. `hasFileMentionToken` must trigger scan on first detection (QW#9).

### EC7: Hook Initialization Order
`useSessionManager` (QW#6) must be initialized before `useResizeHandler` (QW#11) and `renderInteractiveArea` (QW#5) since they consume `sessionManager`. Enforced by implementation order.

### EC8: Welcome Screen on Resize After Messages Load
After a terminal resize in interactive mode, messages are cleared and re-rendered with a fresh welcome item. `resetStaticView` must use `setTimeout(0)` to flush React reconciliation. Preserved in `useWelcomeScreen` (QW#14).

## Dependencies

- **Spec 10 (more-effectiveness-and-economy):** No direct dependency. QW#15 (debounce) and QW#9 (lazy scan) are performance improvements orthogonal to Spec 10's cost-optimization work.
- **ADR-001:** All changes use the existing TypeScript + Ink + esbuild stack.
- **ADR-004:** No changes to EJS template system.

## Implementation Order

Strictly enforced: QW#4 → QW#10 → QW#13 → QW#12 → QW#1 → QW#7 → QW#8 → QW#9 → QW#15 → QW#14 → QW#2 → QW#3 → QW#11 → QW#6 → QW#5.

Rationale: Each QW depends only on previously implemented QWs. QW#6 depends on QW#14, QW#2, QW#3, QW#11 because those hooks are consumed inside the callbacks object. QW#5 depends on QW#6 because `renderInteractiveArea` uses `sessionManager`.
