import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createOpenAIClient } from "../../common/openai-client";
import { resolveCurrentSettings } from "../../settings";
import { SessionManager } from "../../session";
import type { LlmStreamProgress, SessionEntry, SessionMessage, SkillInfo } from "../../session";

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

/**
 * Creates and manages the SessionManager singleton for the app lifecycle.
 *
 * Initializes MCP servers, sets up session list polling, and wires up
 * all callbacks (assistant messages, status updates, streaming progress,
 * MCP status changes, process stdout). Disposes the session manager on unmount.
 *
 * @param projectRoot - Project root directory path
 * @param callbacks - Event handlers for session lifecycle events
 * @returns sessionManager instance, session list, skills, and refresh functions
 * @sideEffects Creates SessionManager, initializes MCP servers, starts polling
 */
export function useSessionManager(projectRoot: string, callbacks: SessionManagerCallbacks): UseSessionManagerReturn {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const sessionManager = useMemo(() => {
    return new SessionManager({
      projectRoot,
      createOpenAIClient: () => createOpenAIClient(projectRoot),
      getResolvedSettings: () => resolveCurrentSettings(projectRoot),
      renderMarkdown: (text: string) => text,
      onAssistantMessage: (message: SessionMessage) => {
        callbacksRef.current.onAssistantMessage(message);
      },
      onSessionEntryUpdated: (entry: SessionEntry) => {
        callbacksRef.current.onSessionEntryUpdated(entry);
      },
      onLlmStreamProgress: (progress: LlmStreamProgress) => {
        callbacksRef.current.onLlmStreamProgress(progress);
      },
      onMcpStatusChanged: () => {
        callbacksRef.current.onMcpStatusChanged();
      },
      onProcessStdout: (pid: number, chunk: string | Buffer) => {
        callbacksRef.current.onProcessStdout(pid, chunk);
      },
    });
  }, [projectRoot]);

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  const refreshSessionsList = useCallback((): void => {
    setSessions(sessionManager.listSessions());
  }, [sessionManager]);

  const refreshSkills = useCallback(
    async (sessionId?: string): Promise<void> => {
      try {
        const list = await sessionManager.listSkills(sessionId ?? sessionManager.getActiveSessionId() ?? undefined);
        setSkills(list);
      } catch {
        // ignore
      }
    },
    [sessionManager]
  );

  useLayoutEffect(() => {
    const settings = resolveCurrentSettings(projectRoot);
    void sessionManager.initMcpServers(settings.mcpServers);
  }, [projectRoot, sessionManager]);

  useEffect(() => {
    return () => {
      sessionManager.dispose();
    };
  }, [sessionManager]);

  useEffect(() => {
    refreshSessionsList();
    void refreshSkills();
  }, [refreshSessionsList, refreshSkills]);

  useEffect(() => {
    createOpenAIClient(projectRoot);
  }, [projectRoot]);

  return {
    sessionManager,
    sessions,
    skills,
    refreshSessionsList,
    refreshSkills,
  };
}
