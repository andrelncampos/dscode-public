import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStdout, useWindowSize } from "ink";
import chalk from "chalk";
import type { ModelConfigSelection, ResolvedDeepcodingSettings } from "../../settings";
import { resolveCurrentSettings, writeModelConfigSelection } from "../../settings";
import { getModelCapabilities } from "../../common/model-catalog";
import { createOpenAIClient } from "../../common/openai-client";
import { createLlmProvider } from "../../common/llm-provider-registry";
import type { OpenAIMessageConverterOptions } from "../../common/openai-message-converter";
import { SessionManager } from "../../session";
import type {
  LlmStreamProgress,
  MessageMeta,
  SessionEntry,
  SessionMessage,
  SessionStatus,
  SkillInfo,
  UndoTarget,
} from "../../session";
import type { PendingPermissionReply } from "../hooks/usePermissionFlow";
import { buildLoadingText } from "../core/loading-text";
import {
  buildPromptDraftFromSessionMessage,
  buildStatusLine,
  buildSyntheticUserMessage,
  formatModelConfig,
  isCurrentSessionEmpty,
  renderRawModeMessages,
} from "../utils";
import { buildExitSummaryText } from "../exit-summary";
import { getActiveTFunction } from "../../i18n/context";
import { renderMessageToStdout } from "../components/MessageView/utils";
import { ANSI_CLEAR_SCREEN } from "../constants";
import { ViewKind } from "../types";
import { RawMode, useRawModeContext } from "./RawModeContext";
import type { PromptDraft, PromptSubmission } from "../views/PromptInput";
import type { UndoRestoreMode } from "../views/UndoSelector";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AppStore {
  // Project
  projectRoot: string;

  // Session
  sessionManager: SessionManager;
  sessions: SessionEntry[];
  skills: SkillInfo[];

  // Streaming / busy
  busy: boolean;
  streamProgress: LlmStreamProgress | null;
  runningProcesses: SessionEntry["processes"];
  nowTick: number;
  loadingText: string | null;

  // Permissions
  activeAskPermissions: SessionEntry["askPermissions"];
  pendingPermissionReply: PendingPermissionReply | null;

  // Welcome / static
  showWelcome: boolean;
  welcomeItem: SessionMessage;

  // View
  view: ViewKind;

  // Messages
  messages: SessionMessage[];
  undoTargets: UndoTarget[];

  // UI state
  promptDraft: PromptDraft | null;
  statusLine: string;
  lastBashCommand: string | null;
  sessionCwd: string | null;
  errorLine: string | null;
  activeStatus: SessionStatus | null;
  dismissedQuestionIds: Set<string>;
  isExiting: boolean;
  welcomeOverlayDismissed: boolean;
  resolvedSettings: ResolvedDeepcodingSettings;
  mcpStatuses: ReturnType<SessionManager["getMcpStatus"]>;
  showProcessStdout: boolean;
  helpVisible: boolean;

  // Screen
  screenWidth: number;
  screenHeight: number;
}

export interface AppActions {
  setBusy: (value: boolean | ((prev: boolean) => boolean)) => void;
  setStreamProgress: (
    value: LlmStreamProgress | null | ((prev: LlmStreamProgress | null) => LlmStreamProgress | null)
  ) => void;
  setRunningProcesses: (
    value: SessionEntry["processes"] | ((prev: SessionEntry["processes"]) => SessionEntry["processes"])
  ) => void;
  setActiveAskPermissions: (
    value: SessionEntry["askPermissions"] | ((prev: SessionEntry["askPermissions"]) => SessionEntry["askPermissions"])
  ) => void;
  setPendingPermissionReply: (
    value: PendingPermissionReply | null | ((prev: PendingPermissionReply | null) => PendingPermissionReply | null)
  ) => void;
  setShowWelcome: (value: boolean | ((prev: boolean) => boolean)) => void;
  setView: (value: ViewKind) => void;
  setMessages: (value: SessionMessage[] | ((prev: SessionMessage[]) => SessionMessage[])) => void;
  setUndoTargets: (value: UndoTarget[]) => void;
  setPromptDraft: (value: PromptDraft | null) => void;
  setStatusLine: (value: string) => void;
  setLastBashCommand: (value: string | null) => void;
  setSessionCwd: (value: string | null) => void;
  setErrorLine: (value: string | null) => void;
  setActiveStatus: (value: SessionStatus | null) => void;
  setDismissedQuestionIds: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setIsExiting: (value: boolean) => void;
  setWelcomeOverlayDismissed: (value: boolean) => void;
  setResolvedSettings: (value: ResolvedDeepcodingSettings) => void;
  setMcpStatuses: (value: ReturnType<SessionManager["getMcpStatus"]>) => void;
  setShowProcessStdout: (value: boolean) => void;
  setHelpVisible: (value: boolean) => void;

  // Compound actions
  refreshSessionsList: () => void;
  refreshSkills: (sessionId?: string) => Promise<void>;
  resetToWelcome: () => Promise<void>;
  navigateToSubView: (targetView: ViewKind) => void;
  handlePrompt: (submission: PromptSubmission) => Promise<void>;
  handleInterrupt: () => void;
  handleSelectSession: (sessionId: string) => Promise<void>;
  handleDeleteSession: (id: string) => Promise<void>;
  handleUndoRestore: (target: UndoTarget, restoreMode: UndoRestoreMode) => Promise<void>;
  handleRawModeChange: (nextMode: string) => void;
  handleModelConfigChange: (selection: ModelConfigSelection) => string;
  reloadActiveSessionView: (sessionId: string) => void;
}

const AppStoreContext = createContext<AppStore | null>(null);
const AppActionsContext = createContext<AppActions | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function AppStateProvider({
  projectRoot,
  initialPrompt: _initialPrompt,
  children,
}: {
  projectRoot: string;
  initialPrompt?: string;
  children: React.ReactNode;
}) {
  const { stdout, write } = useStdout();
  const { columns, rows } = useWindowSize();
  const screenWidth = columns ?? stdout?.columns ?? 80;
  const screenHeight = rows ?? stdout?.rows ?? 24;
  const { mode: rawMode, setMode: setRawMode } = useRawModeContext();

  // Refs
  const processStdoutRef = useRef<Map<number, string>>(new Map());
  const rawModeRef = useRef<RawMode>(rawMode);
  const writeRef = useRef(write);
  const messagesRef = useRef<SessionMessage[]>([]);

  // ── Sub-state: streaming ──
  const [busy, setBusy] = useState(false);
  const [streamProgress, setStreamProgress] = useState<LlmStreamProgress | null>(null);
  const [runningProcesses, setRunningProcesses] = useState<SessionEntry["processes"]>(null);
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [busy]);

  const loadingText = useMemo(
    () => (busy ? buildLoadingText({ progress: streamProgress, processes: runningProcesses, now: Date.now() }) : null),
    [busy, streamProgress, runningProcesses]
  );

  // ── Sub-state: permissions ──
  const [activeAskPermissions, setActiveAskPermissions] = useState<SessionEntry["askPermissions"]>(undefined);
  const [pendingPermissionReply, setPendingPermissionReply] = useState<PendingPermissionReply | null>(null);

  // ── Sub-state: welcome ──
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeNonce, _setWelcomeNonce] = useState(0);
  const setWelcomeNonce = useCallback((updater: number | ((prev: number) => number)) => {
    _setWelcomeNonce(updater);
  }, []);
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

  const resetStaticView = useCallback(
    (
      loadedMessages: SessionMessage[],
      setMessagesFn: (msgs: SessionMessage[]) => void,
      options?: { clearScreen?: boolean }
    ) => {
      if (options?.clearScreen) process.stdout.write(ANSI_CLEAR_SCREEN);
      setMessagesFn([]);
      setWelcomeNonce((n: number) => n + 1);
      setTimeout(() => {
        setMessagesFn(loadedMessages);
        setShowWelcome(true);
      }, 0);
    },
    [setWelcomeNonce]
  );

  // ── Sub-state: app-level ──
  const [view, _setView] = useState<ViewKind>(ViewKind.Chat);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [undoTargets, setUndoTargets] = useState<UndoTarget[]>([]);
  const [promptDraft, setPromptDraft] = useState<PromptDraft | null>(null);
  const [statusLine, setStatusLine] = useState("");
  const [lastBashCommand, setLastBashCommand] = useState<string | null>(null);
  const [sessionCwd, setSessionCwd] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<SessionStatus | null>(null);
  const [dismissedQuestionIds, setDismissedQuestionIds] = useState<Set<string>>(() => new Set());
  const [isExiting, setIsExiting] = useState(false);
  const [welcomeOverlayDismissed, setWelcomeOverlayDismissed] = useState(false);
  const [resolvedSettings, setResolvedSettings] = useState(() => resolveCurrentSettings(projectRoot));
  const [mcpStatuses, setMcpStatuses] = useState<ReturnType<SessionManager["getMcpStatus"]>>([]);
  const [showProcessStdout, setShowProcessStdout] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);

  // Helper to set view and hide welcome
  const navigateToSubView = useCallback(
    (targetView: ViewKind) => {
      setShowWelcome(false);
      _setView(targetView);
    },
    [setShowWelcome]
  );

  // ── Session manager ──
  const callbacksRef = useRef<{
    onAssistantMessage: (msg: SessionMessage) => void;
    onSessionEntryUpdated: (entry: SessionEntry) => void;
    onLlmStreamProgress: (progress: LlmStreamProgress) => void;
    onMcpStatusChanged: () => void;
    onProcessStdout: (pid: number, chunk: string | Buffer) => void;
  }>({
    onAssistantMessage: () => {},
    onSessionEntryUpdated: () => {},
    onLlmStreamProgress: () => {},
    onMcpStatusChanged: () => {},
    onProcessStdout: () => {},
  });

  const sessionManager = useMemo(() => {
    return new SessionManager({
      projectRoot,
      createOpenAIClient: () => createOpenAIClient(projectRoot),
      createLlmProvider: (converterOptions?: OpenAIMessageConverterOptions) =>
        createLlmProvider(projectRoot, converterOptions),
      getResolvedSettings: () => resolveCurrentSettings(projectRoot),
      renderMarkdown: (text: string) => text,
      onAssistantMessage: (msg) => callbacksRef.current.onAssistantMessage(msg),
      onSessionEntryUpdated: (entry) => callbacksRef.current.onSessionEntryUpdated(entry),
      onLlmStreamProgress: (progress) => callbacksRef.current.onLlmStreamProgress(progress),
      onMcpStatusChanged: () => callbacksRef.current.onMcpStatusChanged(),
      onProcessStdout: (pid, chunk) => callbacksRef.current.onProcessStdout(pid, chunk),
      terminalTitleTemplate: resolveCurrentSettings(projectRoot).terminalTitleTemplate,
    });
  }, [projectRoot]);

  // Wire up callbacks after sessionManager is created
  callbacksRef.current = {
    onAssistantMessage: (message) => {
      setMessages((prev) => [...prev, message]);
      if (rawModeRef.current === RawMode.Raw) {
        process.stdout.write("\n");
        process.stdout.write(renderMessageToStdout(message, rawModeRef.current) + "\n\n");
      }
    },
    onSessionEntryUpdated: (entry) => {
      setStatusLine(buildStatusLine(entry, resolvedSettings));
      setLastBashCommand(entry.lastBashCommand);
      setSessionCwd(entry.cwd);
      sessionManager.updateTerminalTitle(entry.cwd);
      setRunningProcesses(entry.processes);
      setActiveStatus(entry.status);
      // Only keep askPermissions when status is ask_permission; clear otherwise
      // to prevent stale arrays from retriggering the PermissionPrompt after submission
      if (entry.status === "ask_permission") {
        setActiveAskPermissions(entry.askPermissions);
      } else {
        setActiveAskPermissions(undefined);
      }
    },
    onLlmStreamProgress: (() => {
      let lastUpdate = 0;
      let pendingTimer: ReturnType<typeof setTimeout> | null = null;
      let latestProgress: LlmStreamProgress | null = null;
      return (progress: LlmStreamProgress) => {
        if (progress.phase === "end") {
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
          }
          latestProgress = null;
          setStreamProgress(null);
          return;
        }
        latestProgress = progress;
        const now = Date.now();
        const elapsed = now - lastUpdate;
        if (elapsed >= 100) {
          lastUpdate = now;
          setStreamProgress(progress);
          return;
        }
        if (!pendingTimer) {
          pendingTimer = setTimeout(() => {
            pendingTimer = null;
            lastUpdate = Date.now();
            if (latestProgress) setStreamProgress(latestProgress);
          }, 100 - elapsed);
        }
      };
    })(),
    onMcpStatusChanged: () => setMcpStatuses(sessionManager.getMcpStatus()),
    onProcessStdout: (pid, chunk) => {
      const buf = processStdoutRef.current;
      const current = buf.get(pid) ?? "";
      const MAX_STDOUT_BUFFER = 1_000_000;
      if (current.length >= MAX_STDOUT_BUFFER) return;
      const text = typeof chunk === "string" ? chunk : String(chunk);
      const available = MAX_STDOUT_BUFFER - current.length;
      buf.set(pid, current + text.slice(0, available));
    },
  };

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  const refreshSessionsList = useCallback(() => setSessions(sessionManager.listSessions()), [sessionManager]);
  const refreshSkills = useCallback(
    async (sessionId?: string) => {
      try {
        const list = await sessionManager.listSkills(sessionId ?? sessionManager.getActiveSessionId() ?? undefined);
        setSkills(list);
      } catch {
        /* ignore */
      }
    },
    [sessionManager]
  );

  // Init
  useEffect(() => {
    const settings = resolveCurrentSettings(projectRoot);
    void sessionManager.initMcpServers(settings.mcpServers);
  }, [projectRoot, sessionManager]);

  useEffect(
    () => () => {
      sessionManager.dispose();
    },
    [sessionManager]
  );
  useEffect(() => {
    refreshSessionsList();
    void refreshSkills();
  }, [refreshSessionsList, refreshSkills]);
  useEffect(() => {
    createOpenAIClient(projectRoot);
  }, [projectRoot]);

  // ── Compound actions ──

  rawModeRef.current = rawMode;
  messagesRef.current = messages;
  writeRef.current = write;

  function loadVisibleMessages(mgr: SessionManager, sessionId: string): SessionMessage[] {
    return mgr.listSessionMessages(sessionId).filter((m) => m.visible);
  }

  const resetToWelcome = useCallback(async () => {
    writeRef.current(ANSI_CLEAR_SCREEN);
    sessionManager.setActiveSessionId(null);
    setStatusLine("");
    setLastBashCommand(null);
    setSessionCwd(null);
    setErrorLine(null);
    setRunningProcesses(null);
    setActiveStatus(null);
    setActiveAskPermissions(undefined);
    setPendingPermissionReply(null);
    setDismissedQuestionIds(new Set());
    resetStaticView([], setMessages);
    await refreshSkills();
  }, [sessionManager, resetStaticView, refreshSkills, setActiveAskPermissions, setPendingPermissionReply]);

  const handleInterrupt = useCallback(() => {
    sessionManager.interruptActiveSession();
  }, [sessionManager]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      sessionManager.setActiveSessionId(sessionId);
      resetStaticView(loadVisibleMessages(sessionManager, sessionId), setMessages, { clearScreen: true });
      const session = sessionManager.getSession(sessionId);
      setStatusLine(session ? buildStatusLine(session, resolvedSettings) : "");
      setLastBashCommand(session?.lastBashCommand ?? null);
      setSessionCwd(session?.cwd ?? null);
      setRunningProcesses(session?.processes ?? null);
      setActiveStatus(session?.status ?? null);
      setActiveAskPermissions(session?.askPermissions);
      if (pendingPermissionReply && pendingPermissionReply.sessionId !== sessionId) {
        setPendingPermissionReply(null);
      }
      await refreshSkills(sessionId);
    },
    [
      sessionManager,
      resetStaticView,
      pendingPermissionReply,
      refreshSkills,
      setActiveAskPermissions,
      setPendingPermissionReply,
      resolvedSettings,
    ]
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const isActiveSession = sessionManager.getActiveSessionId() === id;
      if (isActiveSession) sessionManager.setActiveSessionId(null);
      sessionManager.deleteSession(id);
      refreshSessionsList();
      if (isActiveSession) await resetToWelcome();
    },
    [sessionManager, refreshSessionsList, resetToWelcome]
  );

  const reloadActiveSessionView = useCallback(
    (sessionId: string) =>
      resetStaticView(loadVisibleMessages(sessionManager, sessionId), setMessages, { clearScreen: true }),
    [resetStaticView, sessionManager]
  );

  const handleUndoRestore = useCallback(
    async (target: UndoTarget, restoreMode: UndoRestoreMode) => {
      const sessionId = sessionManager.getActiveSessionId();
      if (!sessionId) {
        setErrorLine("No active session to undo.");
        _setView(ViewKind.Chat);
        setShowWelcome(true);
        return;
      }
      const errors: string[] = [];
      if (restoreMode === "code-and-conversation") {
        try {
          sessionManager.restoreSessionCode(sessionId, target.message.id);
        } catch (error) {
          errors.push(`Code restore failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      let conversationRestored = false;
      try {
        sessionManager.restoreSessionConversation(sessionId, target.message.id);
        conversationRestored = true;
      } catch (error) {
        errors.push(`Conversation restore failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      refreshSessionsList();
      await refreshSkills(sessionId);
      _setView(ViewKind.Chat);
      setErrorLine(errors.length > 0 ? errors.join(" ") : null);
      if (conversationRestored) {
        setPromptDraft(buildPromptDraftFromSessionMessage(target.message, Date.now()));
      }
      reloadActiveSessionView(sessionId);
    },
    [reloadActiveSessionView, refreshSessionsList, refreshSkills, sessionManager, setShowWelcome]
  );

  const handleModelConfigChange = useCallback(
    (selection: ModelConfigSelection): string => {
      const current = resolveCurrentSettings(projectRoot);
      const { changed } = writeModelConfigSelection(selection, current, projectRoot);
      const next = resolveCurrentSettings(projectRoot);
      setResolvedSettings(next);
      if (!changed) return "Model settings unchanged";
      const activeSessionId = sessionManager.getActiveSessionId();
      const meta: MessageMeta = { isModelChange: true };
      const content = `/model\n└ Set model to ${selection.model} (${selection?.thinkingEnabled ? selection?.reasoningEffort : "no thinking"})`;
      if (activeSessionId) {
        sessionManager.addSessionSystemMessage(activeSessionId, content, true, meta);
      } else {
        const now = new Date().toISOString();
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: "local",
            role: "system" as const,
            content,
            contentParams: null,
            messageParams: null,
            compacted: false,
            visible: true,
            createTime: now,
            updateTime: now,
            meta,
          },
        ]);
      }
      let message = `Model settings updated: ${formatModelConfig(current)} → ${formatModelConfig(next)}`;
      const caps = getModelCapabilities(next.model);
      const provider = caps?.provider;
      if (provider && provider !== "deepseek") {
        const engineKey = next.engines[provider]?.apiKey;
        if (!engineKey) {
          message += `\nWarning: No API key configured for ${provider}. Set engines.${provider}.apiKey.`;
        }
      }
      return message;
    },
    [projectRoot, sessionManager]
  );

  const handlePrompt = useCallback(
    async (submission: PromptSubmission) => {
      if (submission.command === "exit") {
        setIsExiting(true);
        setTimeout(() => {
          const activeSessionId = sessionManager.getActiveSessionId();
          const session = activeSessionId ? sessionManager.getSession(activeSessionId) : null;
          const summary = buildExitSummaryText({ session, projectRoot, t: getActiveTFunction() });
          process.stdout.write("\n");
          process.stdout.write(chalk.rgb(34, 154, 195)("> /exit "));
          process.stdout.write("\n\n");
          process.stdout.write(summary);
          process.stdout.write("\n\n");
          sessionManager.dispose();
        }, 0);
        return;
      }
      if (submission.command === "new") {
        await resetToWelcome();
        refreshSessionsList();
        return;
      }
      if (submission.command === "resume") {
        refreshSessionsList();
        navigateToSubView(ViewKind.SessionList);
        return;
      }
      if (submission.command === "continue" && isCurrentSessionEmpty(sessionManager)) {
        refreshSessionsList();
        navigateToSubView(ViewKind.SessionList);
        return;
      }
      if (submission.command === "undo") {
        const activeSessionId = sessionManager.getActiveSessionId();
        if (!activeSessionId) {
          setErrorLine("No active session to undo.");
          return;
        }
        setUndoTargets(sessionManager.listUndoTargets(activeSessionId));
        navigateToSubView(ViewKind.Undo);
        return;
      }
      if (submission.command === "mcp") {
        setMcpStatuses(sessionManager.getMcpStatus());
        navigateToSubView(ViewKind.McpStatus);
        return;
      }

      const prompt = {
        text: submission.text,
        imageUrls: submission.imageUrls,
        skills:
          submission.selectedSkills && submission.selectedSkills.length > 0 ? submission.selectedSkills : undefined,
        permissions: submission.permissions,
        alwaysAllows: submission.alwaysAllows,
      };
      const activeSessionId = sessionManager.getActiveSessionId();
      const permissionReply =
        pendingPermissionReply && activeSessionId === pendingPermissionReply.sessionId ? pendingPermissionReply : null;
      if (permissionReply) {
        prompt.permissions = permissionReply.permissions;
        prompt.alwaysAllows = permissionReply.alwaysAllows;
      }

      const trimmedText = (submission.text ?? "").trim();
      const selectedSkillNames = submission.selectedSkills?.map((s) => s.name).filter(Boolean) ?? [];
      const userDisplayContent =
        trimmedText ||
        (selectedSkillNames.length > 0 ? `Use skills: ${selectedSkillNames.join(", ")}` : "") ||
        (submission.imageUrls.length > 0 ? "[Image]" : "");
      if (userDisplayContent && submission.command !== "continue") {
        setMessages((prev) => [...prev, buildSyntheticUserMessage(userDisplayContent, submission.imageUrls.length)]);
      }

      setBusy(true);
      setErrorLine(null);
      const activeProcesses = activeSessionId ? (sessionManager.getSession(activeSessionId)?.processes ?? null) : null;
      setRunningProcesses(activeProcesses);
      setShowProcessStdout(false);
      if (!activeProcesses || activeProcesses.size === 0) processStdoutRef.current.clear();
      try {
        await sessionManager.handleUserPrompt(prompt);
        if (permissionReply) setPendingPermissionReply(null);
        await refreshSkills();
        refreshSessionsList();
      } catch (error) {
        setErrorLine(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
        setStreamProgress(null);
        const finalActiveSessionId = sessionManager.getActiveSessionId();
        setRunningProcesses(
          finalActiveSessionId ? (sessionManager.getSession(finalActiveSessionId)?.processes ?? null) : null
        );
      }
    },
    [
      sessionManager,
      pendingPermissionReply,
      projectRoot,
      refreshSkills,
      refreshSessionsList,
      navigateToSubView,
      resetToWelcome,
      setBusy,
      setPendingPermissionReply,
      setRunningProcesses,
      setStreamProgress,
    ]
  );

  const handleRawModeChange = useCallback(
    (nextMode: string) => {
      const activeSessionId = sessionManager.getActiveSessionId();
      setRawMode(nextMode as RawMode);
      setShowWelcome(false);
      setMessages([]);
      process.stdout.write(ANSI_CLEAR_SCREEN);
      setTimeout(() => {
        if (nextMode === RawMode.Raw) {
          const allMessages = activeSessionId ? loadVisibleMessages(sessionManager, activeSessionId) : [];
          renderRawModeMessages(allMessages, nextMode);
        } else if (activeSessionId) {
          handleSelectSession(activeSessionId);
        } else {
          setWelcomeNonce((n: number) => n + 1);
          setShowWelcome(true);
        }
      }, 200);
    },
    [handleSelectSession, sessionManager, setRawMode, setShowWelcome, setWelcomeNonce]
  );

  // ── Context values ──

  const state: AppStore = {
    projectRoot,
    sessionManager,
    sessions,
    skills,
    busy,
    streamProgress,
    runningProcesses,
    nowTick,
    loadingText,
    activeAskPermissions,
    pendingPermissionReply,
    showWelcome,
    welcomeItem,
    view,
    messages,
    undoTargets,
    promptDraft,
    statusLine,
    lastBashCommand,
    sessionCwd,
    errorLine,
    activeStatus,
    dismissedQuestionIds,
    isExiting,
    welcomeOverlayDismissed,
    resolvedSettings,
    mcpStatuses,
    showProcessStdout,
    helpVisible,
    screenWidth,
    screenHeight,
  };

  const actions: AppActions = {
    setBusy,
    setStreamProgress,
    setRunningProcesses,
    setActiveAskPermissions,
    setPendingPermissionReply,
    setShowWelcome,
    setView: _setView,
    setMessages,
    setUndoTargets,
    setPromptDraft,
    setStatusLine,
    setLastBashCommand,
    setSessionCwd,
    setErrorLine,
    setActiveStatus,
    setDismissedQuestionIds,
    setIsExiting,
    setWelcomeOverlayDismissed,
    setResolvedSettings,
    setMcpStatuses,
    setShowProcessStdout,
    setHelpVisible,
    refreshSessionsList,
    refreshSkills,
    resetToWelcome,
    navigateToSubView,
    handlePrompt,
    handleInterrupt,
    handleSelectSession,
    handleDeleteSession,
    handleUndoRestore,
    handleRawModeChange,
    handleModelConfigChange,
    reloadActiveSessionView,
  };

  return (
    <AppStoreContext.Provider value={state}>
      <AppActionsContext.Provider value={actions}>{children}</AppActionsContext.Provider>
    </AppStoreContext.Provider>
  );
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useAppState(): AppStore {
  const ctx = useContext(AppStoreContext);
  if (!ctx) throw new Error("useAppState must be used within AppStoreProvider");
  return ctx;
}

export function useAppActions(): AppActions {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error("useAppActions must be used within AppActionsProvider");
  return ctx;
}
