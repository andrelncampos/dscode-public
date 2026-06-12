import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Static, Text, useInput } from "ink";
import { MessageView, RawModeExitPrompt } from "../components";
import { SessionList } from "./SessionList";
import { UndoSelector } from "./UndoSelector";
import { HelpModal } from "./HelpModal";
import ErrorBanner from "../components/ErrorBanner";
import { StatusHeader } from "../components/StatusHeader";
import { useResizeHandler } from "../hooks/useResizeHandler";
import { findExpandedThinkingId } from "../core/thinking-state";
import { WelcomeScreen } from "./WelcomeScreen";
import { AskUserQuestionPrompt } from "./AskUserQuestionPrompt";
import { McpStatusList } from "./McpStatusList";
import { ProcessStdoutView } from "./ProcessStdoutView";
import {
  type AskUserQuestionAnswers,
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
} from "../core/ask-user-question";
import { PermissionPrompt, type PermissionPromptResult } from "./PermissionPrompt";
import { computeSessionCost } from "../../common/model-capabilities";
import { getBudgetCosts } from "../../common/budget-tracker";
import { RawMode, useRawModeContext } from "../contexts";
import { useAppState, useAppActions } from "../contexts/AppStateContext";
import { isCollapsedThinking } from "../core/thinking-state";
import { ANSI_CLEAR_SCREEN } from "../constants";
import { ViewKind } from "../types";
import { PromptInput } from "./PromptInput";
import { resolveCurrentSettings } from "../../settings";
import { resolveLocale } from "../../i18n/locale";
import { getDictionary, resolveDictionary } from "../../i18n/dictionary";
import { createTFunction } from "../../i18n/translate";
import { LocaleContext, setActiveTFunction, type LocaleContextValue } from "../../i18n/context";
import type { PromptSubmission } from "../types/commands";
import type { SessionMessage } from "../../session";

type AppProps = {
  onRestart?: () => void;
};

function App({ onRestart: _onRestart }: AppProps): React.ReactElement {
  const { mode } = useRawModeContext();
  const state = useAppState();
  const actions = useAppActions();
  const initialPromptSubmittedRef = useRef(false);

  const {
    projectRoot,
    sessionManager,
    skills,
    sessions,
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
  } = state;

  // Locale resolution — computed once at startup, stable for process lifetime
  const locale = resolveLocale(resolvedSettings.locale);
  const rawDict = getDictionary(locale);
  const dict = resolveDictionary(locale, rawDict);
  const t = createTFunction(dict);
  const localeValue: LocaleContextValue = { locale, t };
  // Register t-function for non-React modules (model-command-handlers, exit-summary).
  // Deferred to useEffect so the render pass stays pure.
  useEffect(() => {
    setActiveTFunction(t);
  }, [t]);

  // Provider keys for ModelsDropdown: which providers have API keys configured
  const providerKeys = useMemo(() => {
    const keys = new Set<string>();
    if (resolvedSettings.apiKey) keys.add("deepseek");
    if (resolvedSettings.engines.openai?.apiKey || resolvedSettings.apiKey) keys.add("openai");
    if (resolvedSettings.engines.anthropic?.apiKey) keys.add("anthropic");
    return keys;
  }, [resolvedSettings.apiKey, resolvedSettings.engines.openai?.apiKey, resolvedSettings.engines.anthropic?.apiKey]);

  const handleSubmit = useCallback(
    (submission: PromptSubmission) => {
      void actions.handlePrompt(submission);
    },
    [actions]
  );

  const handleInterrupt = useCallback(() => {
    actions.handleInterrupt();
  }, [actions]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      void actions.handleSelectSession(sessionId);
    },
    [actions]
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      void actions.handleDeleteSession(id);
    },
    [actions]
  );

  const handleUndoRestore = actions.handleUndoRestore;
  const handleModelConfigChange = actions.handleModelConfigChange;

  // Initial prompt auto-submit
  useEffect(() => {
    if (initialPromptSubmittedRef.current) return;
    initialPromptSubmittedRef.current = true;
    // The initial prompt is now handled inside AppStateProvider
  }, []);

  // Resize handler
  useResizeHandler({
    columns: screenWidth,
    stdout: undefined,
    mode,
    busy,
    getActiveSessionId: () => sessionManager.getActiveSessionId(),
    loadVisibleMessages: (id) => sessionManager.listSessionMessages(id).filter((m) => m.visible),
    getCurrentMessages: () => [],
    setMessages: actions.setMessages,
    setShowWelcome: actions.setShowWelcome,
    setWelcomeNonce: () => {},
    write: (data: string) => process.stdout.write(data),
  });

  // Derived values
  const messagesRef = useRef<SessionMessage[]>(messages);
  messagesRef.current = messages;
  const expandedThinkingId = findExpandedThinkingId(messages);
  const pendingQuestion = useMemo(() => findPendingAskUserQuestion(messages, activeStatus), [activeStatus, messages]);
  const shouldShowQuestionPrompt = Boolean(pendingQuestion && !dismissedQuestionIds.has(pendingQuestion.messageId));
  const canShowHelp =
    helpVisible &&
    view === ViewKind.Chat &&
    !shouldShowQuestionPrompt &&
    activeStatus !== "ask_permission" &&
    !showProcessStdout &&
    !busy;
  const usagePerModel = sessionManager.getSession(sessionManager.getActiveSessionId() ?? "")?.usagePerModel ?? null;
  let sessionTokens = 0;
  let sessionCost: number | null = null;
  if (usagePerModel) {
    let totalTokens = 0;
    for (const usage of Object.values(usagePerModel)) totalTokens += usage.total_tokens;
    if (totalTokens > 0) {
      sessionTokens = totalTokens;
      sessionCost = computeSessionCost(usagePerModel, resolvedSettings.modelPricing);
    }
  }
  const budgetCosts = getBudgetCosts(projectRoot ?? "");

  const showWelcomeInStatic = showWelcome && view === ViewKind.Chat;
  const staticItems = useMemo(() => {
    if (mode === RawMode.Raw) return [];
    if (showWelcomeInStatic) return [welcomeItem, ...messages];
    return messages;
  }, [mode, showWelcomeInStatic, messages, welcomeItem]);

  const renderStaticItem = useCallback(
    (item: SessionMessage) => {
      if (item.id.startsWith("__welcome__")) {
        return (
          <WelcomeScreen
            key={item.id}
            projectRoot={projectRoot}
            settings={resolvedSettings}
            skills={skills}
            width={screenWidth}
          />
        );
      }
      return (
        <MessageView
          key={item.id}
          message={item}
          collapsed={isCollapsedThinking(item, expandedThinkingId)}
          width={screenWidth}
        />
      );
    },
    [projectRoot, resolvedSettings, skills, screenWidth, expandedThinkingId]
  );

  const handleQuestionAnswers = useCallback(
    (answers: AskUserQuestionAnswers) => {
      handleSubmit({ text: formatAskUserQuestionAnswers(answers), imageUrls: [] });
    },
    [handleSubmit]
  );

  const handleQuestionCancel = useCallback(() => {
    if (!pendingQuestion) return;
    actions.setDismissedQuestionIds((prev) => new Set(prev).add(pendingQuestion.messageId));
  }, [pendingQuestion, actions]);

  const handlePermissionResult = useCallback(
    (result: PermissionPromptResult) => {
      const sessionId = sessionManager.getActiveSessionId();
      if (!sessionId) return;
      actions.setPromptDraft(null);
      if (result.hasDeny) {
        actions.setActiveAskPermissions(undefined);
        actions.setPendingPermissionReply({
          sessionId,
          permissions: result.permissions,
          alwaysAllows: result.alwaysAllows,
        });
        actions.setStatusLine("Permission denied. Add a reply, then press Enter to continue.");
        sessionManager.denySessionPermission(sessionId);
        return;
      }
      handleSubmit({
        text: "/continue",
        imageUrls: [],
        command: "continue",
        permissions: result.permissions,
        alwaysAllows: result.alwaysAllows,
      });
    },
    [handleSubmit, sessionManager, actions]
  );

  const handlePermissionCancel = useCallback(() => {
    sessionManager.interruptActiveSession();
    actions.setActiveStatus("interrupted");
    actions.setActiveAskPermissions(undefined);
    actions.setPromptDraft(null);
    actions.refreshSessionsList();
  }, [sessionManager, actions]);

  const shouldShowWelcomeOverlay = !welcomeOverlayDismissed && view === ViewKind.Chat && !busy;

  useInput(
    (_input, key) => {
      if (key.return) {
        process.stdout.write(ANSI_CLEAR_SCREEN);
        actions.setWelcomeOverlayDismissed(true);
        actions.setShowWelcome(false);
      }
    },
    { isActive: shouldShowWelcomeOverlay }
  );

  if (shouldShowWelcomeOverlay) {
    return (
      <LocaleContext.Provider value={localeValue}>
        <Box
          flexDirection="column"
          width={screenWidth}
          height={screenHeight}
          justifyContent="center"
          alignItems="center"
        >
          <WelcomeScreen projectRoot={projectRoot} settings={resolvedSettings} skills={skills} width={screenWidth} />
          <Box marginTop={2}>
            <Text bold color="cyan">
              {t("status.press-enter-start")}
            </Text>
          </Box>
        </Box>
      </LocaleContext.Provider>
    );
  }

  if (mode === RawMode.Raw) {
    return (
      <LocaleContext.Provider value={localeValue}>
        <RawModeExitPrompt onExit={(prev) => actions.handleRawModeChange(prev)} />
      </LocaleContext.Provider>
    );
  }

  function renderInteractiveArea(): React.ReactElement | null {
    if (showProcessStdout) {
      return (
        <ProcessStdoutView
          processStdoutRef={{ current: new Map() }}
          runningProcesses={runningProcesses}
          onDismiss={() => actions.setShowProcessStdout(false)}
          onAdjustTimeout={(deltaMs: number) => sessionManager.adjustActiveBashTimeout(deltaMs)}
          screenWidth={screenWidth}
          screenHeight={screenHeight}
        />
      );
    }

    switch (view) {
      case ViewKind.SessionList:
        return (
          <SessionList
            sessions={sessions}
            currentSessionId={sessionManager.getActiveSessionId() ?? undefined}
            onSelect={(id) => void handleSelectSession(id)}
            onCancel={() => actions.setView(ViewKind.Chat)}
            onDelete={(id) => {
              void handleDeleteSession(id);
            }}
            onRename={(id, newName) => {
              if (sessionManager.renameSession(id, newName)) {
                actions.refreshSessionsList();
                actions.setStatusLine(`Session renamed to "${newName}".`);
              } else {
                actions.setErrorLine("Failed to rename session.");
              }
            }}
          />
        );
      case ViewKind.Undo:
        return (
          <UndoSelector
            targets={undoTargets}
            onSelect={(target, restoreMode) => void handleUndoRestore(target, restoreMode)}
            onCancel={() => {
              actions.setPromptDraft(null);
              actions.setView(ViewKind.Chat);
            }}
          />
        );
      case ViewKind.McpStatus:
        return (
          <McpStatusList
            statuses={mcpStatuses}
            onCancel={() => actions.setView(ViewKind.Chat)}
            onReconnect={(name) => {
              const latest = resolveCurrentSettings(projectRoot);
              void sessionManager.reconnectMcpServer(name, latest.mcpServers?.[name]);
            }}
          />
        );
      default:
        break;
    }

    if (shouldShowQuestionPrompt && pendingQuestion && !busy) {
      return (
        <AskUserQuestionPrompt
          questions={pendingQuestion.questions}
          onSubmit={handleQuestionAnswers}
          onCancel={handleQuestionCancel}
        />
      );
    }

    if (
      activeStatus === "ask_permission" &&
      activeAskPermissions &&
      activeAskPermissions.length > 0 &&
      !pendingPermissionReply &&
      !busy
    ) {
      return (
        <PermissionPrompt
          requests={activeAskPermissions}
          onSubmit={handlePermissionResult}
          onCancel={handlePermissionCancel}
        />
      );
    }

    if (canShowHelp) {
      return <HelpModal onClose={() => actions.setHelpVisible(false)} />;
    }

    if (isExiting) return null;

    return (
      <PromptInput
        projectRoot={projectRoot}
        screenWidth={screenWidth}
        skills={skills}
        modelConfig={resolvedSettings}
        promptHistory={messages
          .filter((m) => m.role === "user" && typeof m.content === "string")
          .map((m) => (m.content ?? "").trim())
          .filter((c) => c.length > 0)}
        busy={busy}
        loadingText={loadingText}
        streamProgress={streamProgress}
        nowTick={nowTick}
        runningProcesses={runningProcesses}
        promptDraft={promptDraft}
        sessionTokens={sessionTokens}
        sessionCost={sessionCost}
        dailyCost={budgetCosts.todayCost}
        projectCost={budgetCosts.projectTotal}
        onSubmit={handleSubmit}
        onModelConfigChange={handleModelConfigChange}
        onRawModeChange={actions.handleRawModeChange}
        onInterrupt={handleInterrupt}
        onToggleProcessStdout={() => actions.setShowProcessStdout(true)}
        onToggleHelp={() => actions.setHelpVisible(!helpVisible)}
        helpVisible={helpVisible}
        placeholder="Type your message..."
        providerKeys={providerKeys}
      />
    );
  }

  return (
    <LocaleContext.Provider value={localeValue}>
      <Box flexDirection="column" width={screenWidth} minWidth={80} overflowX="hidden">
        <Static items={staticItems}>{renderStaticItem}</Static>
        <StatusHeader
          statsLine=""
          lastBashCommand={lastBashCommand}
          modelName={resolvedSettings.model}
          statusMessage={statusLine}
          busy={busy}
          streamProgress={streamProgress}
          nowTick={nowTick}
          screenWidth={screenWidth}
        />
        {errorLine ? (
          <ErrorBanner
            message={errorLine}
            severity="error"
            maxWidth={screenWidth}
            dismissable
            onDismiss={() => actions.setErrorLine(null)}
            autoDismiss
          />
        ) : null}
        {renderInteractiveArea()}
      </Box>
    </LocaleContext.Provider>
  );
}

export default App;
