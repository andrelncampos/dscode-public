# Spec 20: TUI Scalability — Design

## Architecture Overview

The refactoring extracts 6 hooks, 2 presentational components, 4 utility modules, and 1 types module from `App.tsx` and `PromptInput.tsx`. Zero behavior changes. All new modules follow the existing project conventions: TypeScript strict, double quotes, 2-space indent, kebab-case filenames, explicit return types.

## Module Map

```
src/ui/
├── types/                          # NEW directory
│   └── prompt-input-types.ts       # NEW — named prop interfaces
├── core/
│   ├── command-handlers.ts         # NEW — slash command dispatch
│   ├── error-classification.ts     # NEW — error pattern matching
│   ├── layout-constants.ts         # NEW — centralized magic numbers
│   └── index.ts                    # NEW — additive barrel export
├── components/
│   ├── StatusBar.tsx               # NEW — status line component
│   ├── PromptFooter.tsx            # NEW — prompt footer component
│   └── index.ts                    # MODIFIED — add StatusBar, PromptFooter exports
├── hooks/
│   ├── useStreamingState.ts        # NEW — streaming state + timer
│   ├── usePermissionFlow.ts        # NEW — permission state
│   ├── useSessionManager.ts        # NEW — session manager lifecycle
│   ├── useResizeHandler.ts         # NEW — terminal resize handler
│   ├── useWelcomeScreen.ts         # NEW — welcome screen state
│   └── index.ts                    # MODIFIED — add 5 hook exports
└── views/
    ├── App.tsx                     # MODIFIED — ~200 lines removed
    └── PromptInput.tsx             # MODIFIED — ~150 lines removed
```

## Component Interfaces

### QW#1: command-handlers.ts

```typescript
// src/ui/core/command-handlers.ts
import type { SlashCommandKind, SlashCommandItem } from "./slash-commands";
import type { SkillInfo } from "../../session";

export type CommandContext = {
  buffer: { text: string };
  busy: boolean;
  selectedSkills: SkillInfo[];
  onSubmit: (submission: {
    text: string;
    imageUrls: string[];
    selectedSkills?: SkillInfo[];
    command?: string;
  }) => void;
  resetPromptInput: () => void;
  clearSlashToken: () => void;
  addSelectedSkill: (skill: SkillInfo) => void;
  setShowSkillsDropdown: (show: boolean) => void;
  setShowModelDropdown: (show: boolean) => void;
  setOpenRawModelDropdown: (show: boolean) => void;
  setStatusMessage: (msg: string) => void;
};

export function executeSlashCommand(item: SlashCommandItem, ctx: CommandContext): boolean;
```

**Data flow:** PromptInput calls `handleSlashSelection(item)` → constructs `CommandContext` → calls `executeSlashCommand(item, ctx)` → dispatch map routes to handler.

**Error handling:** Unknown command kinds return `false`. Busy-state guard returns `false` with status message (except for `exit` kind).

**Internal structure:**
- `COMMAND_HANDLERS: Record<string, CommandHandler>` — fixed-text commands (skill, skills, model, raw, new, init, resume, continue, undo, mcp, exit)
- `BUFFER_TEXT_COMMANDS: Set<SlashCommandKind>` — commands that submit buffer text (steering-add, spec-plan, spec-new, spec-verify, spec-implement, spec-audit, spec-status)
- `FIXED_TEXT_COMMANDS: Partial<Record<SlashCommandKind, string>>` — commands that submit fixed text (steering-list → "/steering-list", spec-init → "/spec-init", spec-list → "/spec-list")

### QW#2: useStreamingState.ts

```typescript
// src/ui/hooks/useStreamingState.ts
import type { LlmStreamProgress, SessionEntry } from "../../session";

export type StreamingState = {
  busy: boolean;
  setBusy: (value: boolean | ((prev: boolean) => boolean)) => void;
  streamProgress: LlmStreamProgress | null;
  setStreamProgress: (value: LlmStreamProgress | null | ((prev: LlmStreamProgress | null) => LlmStreamProgress | null)) => void;
  runningProcesses: SessionEntry["processes"];
  setRunningProcesses: (value: SessionEntry["processes"] | ((prev: SessionEntry["processes"]) => SessionEntry["processes"])) => void;
  nowTick: number;
  loadingText: string | null;
};

export function useStreamingState(): StreamingState;
```

**Data flow:** App.tsx destructures `{ busy, setBusy, streamProgress, ... }` from hook. Timer effect runs `setInterval` at 500ms when `busy=true`, clears on `busy=false` or unmount. `loadingText` is computed via `useMemo` from `buildLoadingText` with `nowTick` in deps array.

**Edge cases:** When `busy` transitions to `false`, the interval is cleared and `loadingText` becomes `null`. The `nowTick` dependency in `useMemo` forces periodic recalculation for spinner animation — this is intentional (documented with eslint-disable comment).

### QW#3: usePermissionFlow.ts

```typescript
// src/ui/hooks/usePermissionFlow.ts
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
  setActiveAskPermissions: (value: SessionEntry["askPermissions"] | ...) => void;
  pendingPermissionReply: PendingPermissionReply | null;
  setPendingPermissionReply: (value: PendingPermissionReply | null | ...) => void;
  clearPendingPermission: () => void;
};

export function usePermissionFlow(): PermissionFlowReturn;
```

**Data flow:** `handlePrompt` sets `pendingPermissionReply` when user answers. `clearPendingPermission` nullifies it after consumption. `handlePermissionResult` and `handlePermissionCancel` remain in App.tsx as they depend on `sessionManager`, `handlePrompt`, `setPromptDraft`.

### QW#4: layout-constants.ts

All constants are readonly `export const`. No functions, no types. 30 exported constants organized in sections by consumer component:

```typescript
// src/ui/core/layout-constants.ts
// ─── SessionList ──────────────────────────────────────────────────
export const SESSION_LIST_ITEM_HEIGHT = 3;
export const SESSION_LIST_RESERVED_LINES_WITH_SEARCH = 12;
export const SESSION_LIST_RESERVED_LINES_NO_SEARCH = 9;
export const SESSION_LIST_MAX_HEIGHT = 30;
export const SESSION_LIST_MIN_WIDTH = 20;
export const SESSION_LIST_PADDING_X = 6;

// ─── HelpModal ────────────────────────────────────────────────────
export const HELP_MODAL_MAX_WIDTH = 60;
export const HELP_MODAL_MIN_WIDTH = 30;
export const HELP_MODAL_MAX_HEIGHT = 24;
export const HELP_MODAL_KEY_COL_WIDTH = 20;
export const HELP_MODAL_KEY_COL_MAX_RATIO = 0.35;

// ─── WelcomeScreen ───────────────────────────────────────────────
export const WELCOME_PANEL_MIN_WIDTH = 58;

// ─── ErrorBanner ─────────────────────────────────────────────────
export const ERROR_BANNER_MAX_VISIBLE_LINES = 6;
export const ERROR_BANNER_MAX_MESSAGE_LENGTH = 500;
export const ERROR_BANNER_INNER_PADDING = 4;

// ─── DropdownMenu ────────────────────────────────────────────────
export const DROPDOWN_DEFAULT_MAX_VISIBLE = 8;
export const DROPDOWN_MIN_LABEL_COL = 10;

// ─── SlashCommandMenu ────────────────────────────────────────────
export const SLASH_MENU_DEFAULT_MAX_VISIBLE = 6;

// ─── StreamingIndicator ──────────────────────────────────────────
export const STREAMING_BAR_MIN_WIDTH = 10;
export const STREAMING_BAR_MAX_WIDTH = 30;
export const STREAMING_DONE_DISPLAY_MS = 2000;

// ─── General ─────────────────────────────────────────────────────
export const MIN_SCREEN_WIDTH = 80;
export const PROMPT_PREFIX_WIDTH = 2;
```

**Constantes sem modificação de consumidor:** ErrorBanner, DropdownMenu, e SlashCommandMenu têm constantes definidas neste módulo mas seus arquivos fonte não são modificados neste spec. As constantes existem para referência futura e para que novos consumidores possam usá-las sem criar novos magic numbers.

**Data flow:** Components import directly: `import { SESSION_LIST_ITEM_HEIGHT } from "../core/layout-constants"`.

### QW#5: View Router

The `renderInteractiveArea()` function is defined inside the `App` component body (access to closure variables). Returns `React.ReactElement | null`.

**Decision tree (in order):**
1. `showProcessStdout` → `<ProcessStdoutView>`
2. `view === "session-list"` → `<SessionList>`
3. `view === "undo"` → `<UndoSelector>`
4. `view === "mcp-status"` → `<McpStatusList>`
5. `shouldShowQuestionPrompt && pendingQuestion && !busy` → `<AskUserQuestionPrompt>`
6. `activeStatus === "ask_permission" && activeAskPermissions && ...` → `<PermissionPrompt>`
7. `canShowHelp` → `<HelpModal>`
8. `isExiting` → `null`
9. Default → `<PromptInput>`

### QW#6: useSessionManager.ts

```typescript
// src/ui/hooks/useSessionManager.ts
export type SessionManagerCallbacks = {
  onAssistantMessage: (message: SessionMessage) => void;
  onSessionEntryUpdated: (entry: SessionEntry) => void;
  onLlmStreamProgress: (progress: LlmStreamProgress) => void;
  onMcpStatusChanged: () => void;
  onProcessStdout: (pid: number, chunk: string | Buffer) => void;
};

export type UseSessionManagerReturn = {
  sessionManager: SessionManager;
  sessions: SessionEntry[];
  skills: SkillInfo[];
  refreshSessionsList: () => void;
  refreshSkills: (sessionId?: string) => Promise<void>;
};

export function useSessionManager(projectRoot: string, callbacks: SessionManagerCallbacks): UseSessionManagerReturn;
```

**Data flow:** Hook creates `SessionManager` via `useMemo` (keyed on `projectRoot`). Callbacks are stored in `useRef` to avoid `useMemo` dependency changes. Lifecycle: `useLayoutEffect` for MCP init, `useEffect` for dispose, `useEffect` for initial session list + skills load, `useEffect` for warm OpenAI client.

**Edge case:** `onMcpStatusChanged` callback references `sessionManager.getMcpStatus()` — this works because `callbacksRef.current` is updated each render, and when the callback fires, `sessionManager` already exists in the component's closure scope.

### QW#7: StatusBar.tsx

```typescript
// src/ui/components/StatusBar.tsx
type StatusBarProps = { line: string | null };
export const StatusBar = React.memo(function StatusBar({ line }: StatusBarProps): React.ReactElement | null;
```

Returns `null` when `line` is falsy. Renders `<Box><Text dimColor>{line}</Text></Box>` otherwise.

### QW#8: PromptFooter.tsx

```typescript
// src/ui/components/PromptFooter.tsx
type PromptFooterProps = {
  busy: boolean;
  streamProgress: LlmStreamProgress | null;
  nowTick: number;
  modelName: string;
  screenWidth: number;
  statusMessage: string | null;
  footerText: string;
  showFooterText: boolean;
};

export const PromptFooter = React.memo(function PromptFooter(props: PromptFooterProps): React.ReactElement | null;
```

**Decision tree:**
1. `showFooterText` → `null`
2. `busy && streamProgress` → `<StreamingIndicator>`
3. Otherwise → model name (magenta) + footer text (dimColor) with key coloring via `ColoredFooter` (internal helper)

**Internal helper `ColoredFooter`:** Splits `footerText` by ` · `, matches `/^(\S+)\s+(.+)$/` to colorize the key in cyan and dim the description.

### QW#9: Lazy Scan (PromptInput.tsx internal)

**State change:**
- Before: `useState<FileMentionItem[]>(() => scanFileMentionItems(projectRoot))`
- After: `useState<FileMentionItem[]>([])` + `useRef(false)` for scanned flag

**Trigger change:**
- `useEffect` on mount is removed
- `hasFileMentionToken` effect now checks `fileMentionScannedRef.current` — scans on first `@` detection only if not yet scanned
- `wasBusyRef` effect (existing) continues to trigger rescan after assistant creates files

### QW#10: error-classification.ts

```typescript
// src/ui/core/error-classification.ts
export type ErrorClassification = { label: string; hint: string };
export function classifyError(message: string): ErrorClassification;
```

**Data:** `ERROR_PATTERNS` array of 10 entries, each with `pattern` (case-insensitive substring match), `label` (human-readable category), `hint` (actionable suggestion).

**Fallback:** `{ label: "Error", hint: "Press Enter to continue." }` when no pattern matches.

### QW#11: useResizeHandler.ts

```typescript
// src/ui/hooks/useResizeHandler.ts
export type ResizeHandlerOptions = {
  columns: number; stdout: NodeJS.WriteStream | undefined; mode: RawMode; busy: boolean;
  getActiveSessionId: () => string | null;
  loadVisibleMessages: (sessionId: string) => SessionMessage[];
  getCurrentMessages: () => SessionMessage[];
  setMessages: (value: SessionMessage[] | ((prev: SessionMessage[]) => SessionMessage[])) => void;
  setShowWelcome: (value: boolean | ((prev: boolean) => boolean)) => void;
  setWelcomeNonce: (value: number | ((prev: number) => number)) => void;
  write: (data: string) => void;
};
export function useResizeHandler(options: ResizeHandlerOptions): void;
```

**Data flow:** Single `useEffect` with `lastRenderedColumnsRef`. On first render, records initial columns. On subsequent renders, if columns change:
- Raw mode: writes ANSI clear screen + re-renders messages
- Interactive mode: writes ANSI clear screen, clears messages, bumps welcomeNonce, reloads via `setTimeout(0)`

### QW#12: prompt-input-types.ts

```typescript
// src/ui/types/prompt-input-types.ts
import type { LlmStreamProgress, SessionEntry, SkillInfo } from "../../session";
import type { ModelConfigSelection } from "../../settings";

export type PromptStreamState = {
  busy: boolean;
  loadingText?: string | null;
  streamProgress?: LlmStreamProgress | null;
  nowTick?: number;
  runningProcesses?: SessionEntry["processes"];
};

export type PromptModelState = {
  modelConfig: ModelConfigSelection;
  skills: SkillInfo[];
};

export type PromptDisplayState = {
  screenWidth: number;
  promptHistory: string[];
  promptDraft?: import("../views/PromptInput").PromptDraft | null;
  helpVisible?: boolean;
  disabled?: boolean;
  placeholder?: string;
};
```

**Usage in PromptInput.tsx:**
```typescript
type Props = PromptStreamState & PromptModelState & PromptDisplayState & {
  projectRoot: string;
  onSubmit: (submission: PromptSubmission) => void;
  onModelConfigChange: (selection: ModelConfigSelection) => string | Promise<string>;
  onRawModeChange?: (mode: string) => void;
  onInterrupt: () => void;
  onToggleProcessStdout?: () => void;
  onToggleHelp?: () => void;
};
```

### QW#13: core/index.ts (barrel)

Re-exports 9 modules. Additive only — no existing imports modified.

```
export { buildLoadingText, type LoadingTextInput } from "./loading-text";
export { ...prompt-buffer exports... } from "./prompt-buffer";
export { ...slash-commands exports... } from "./slash-commands";
export { ...file-mentions exports... } from "./file-mentions";
export { ...thinking-state exports... } from "./thinking-state";
export { ...ask-user-question exports... } from "./ask-user-question";
export { ...clipboard exports... } from "./clipboard";
export { classifyError, type ErrorClassification } from "./error-classification";
export { ...layout-constants exports... } from "./layout-constants";
```

**Nota:** O módulo `prompt-undo-redo.ts` não é incluído — exporta funções internas usadas apenas pelo `PromptInput.tsx`.

### QW#14: useWelcomeScreen.ts

```typescript
// src/ui/hooks/useWelcomeScreen.ts
export type UseWelcomeScreenReturn = {
  showWelcome: boolean;
  setShowWelcome: (value: boolean | ((prev: boolean) => boolean)) => void;
  welcomeNonce: number;
  setWelcomeNonce: (value: number | ((prev: number) => number)) => void;
  welcomeItem: SessionMessage;
  bumpNonce: () => void;
  resetStaticView: (loadedMessages: SessionMessage[], setMessages: (msgs: SessionMessage[]) => void, options?: { clearScreen?: boolean }) => void;
};
export function useWelcomeScreen(): UseWelcomeScreenReturn;
```

**Data flow:** `welcomeItem` is a `useMemo` keyed on `welcomeNonce`. `resetStaticView` takes a `setMessages` callback as parameter (not captured from closure) so the hook remains reusable. `bumpNonce` is a convenience wrapper for `setWelcomeNonce((n) => n + 1)`.

### QW#15: Debounce (App.tsx inline)

**Mechanism:** IIFE in the callbacks object creates a closure with `lastUpdate`, `pendingTimer`, `latestProgress`.

```
onLlmStreamProgress: (() => {
  let lastUpdate = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let latestProgress: LlmStreamProgress | null = null;

  return (progress: LlmStreamProgress) => {
    if (progress.phase === "end") { /* immediate clear */ }
    latestProgress = progress;
    const now = Date.now();
    const elapsed = now - lastUpdate;
    if (elapsed >= 100) { /* immediate update */ return; }
    if (!pendingTimer) { /* schedule deferred update */ }
  };
})(),
```

**Edge case:** When `phase === "end"`, pending timer is cleared via `clearTimeout` and `setStreamProgress(null)` is called synchronously. When a new streaming session starts, the closure state is fresh (new IIFE if callbacks object is recreated) or carries over (same IIFE if not). The `latestProgress` variable ensures the last buffered progress is always rendered after the 100ms window.

## Data Flow Summary

```
User types → PromptInput
  → onSubmit → App.handleSubmit
    → sessionManager.sendMessage
      → onLlmStreamProgress (debounced 100ms) → setStreamProgress → useStreamingState → PromptFooter
      → onAssistantMessage → setMessages → MessageView
      → onSessionEntryUpdated → setStatusLine, setRunningProcesses, setActiveStatus, setActiveAskPermissions
        → StatusBar, useStreamingState, usePermissionFlow
      → onMcpStatusChanged → setMcpStatuses → McpStatusList
      → onProcessStdout → processStdoutRef → ProcessStdoutView

Slash command → handleSlashSelection → executeSlashCommand (dispatch map) → onSubmit/ctx callbacks

Terminal resize → useResizeHandler → ANSI clear + message reload

Permission request → PermissionPrompt → handlePermissionResult → handlePrompt → clearPendingPermission
```

## Alignment with Architectural Principles

1. **KISS:** Each module does exactly one thing. Hooks encapsulate state + single effect. Components are presentational.
2. **DRY:** Layout constants eliminate duplicate magic numbers. Dispatch map eliminates duplicate if/else branches. Barrel avoids repeated import paths.
3. **ADR-001 (TypeScript + Ink + esbuild):** All new files are `.ts` or `.tsx`, strict mode, explicit return types.
4. **ADR-004 (EJS Templates):** No changes to template system.
