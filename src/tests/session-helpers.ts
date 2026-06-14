// Shared helpers for session test files.
// Each test file imports the functions it needs and registers its own hooks.

import { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GitFileHistory } from "../common/file-history";
import { SessionManager, getProjectCode, type SessionMessage } from "../session";

// ── Shared state ─────────────────────────────────────────────────────

export const originalFetch = globalThis.fetch;
export const originalConsoleWarn = console.warn;
export const originalHome = process.env.HOME;
export const originalUserProfile = process.env.USERPROFILE;
export const tempDirs: string[] = [];

export let sharedWorkspace: string;
export let sharedHome: string;
export let subdirCounter = 0;

/** Set homedir in a cross-platform way (HOME on Unix, USERPROFILE on Windows). */
export function setHomeDir(dir: string): void {
  process.env.HOME = dir;
  if (process.platform === "win32") {
    process.env.USERPROFILE = dir;
  }
}

export function registerSessionHooks(): void {
  // Create shared workspace/home once for the entire test file.
  before(() => {
    sharedWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-session-workspace-"));
    sharedHome = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-session-home-"));
  });

  after(() => {
    fs.rmSync(sharedWorkspace, { recursive: true, force: true });
    fs.rmSync(sharedHome, { recursive: true, force: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalConsoleWarn;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    // Clean per-test subdirectories.
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
}

// ── Temp dir helpers ─────────────────────────────────────────────────

export function createTempDir(prefix: string): string {
  // Tests that initialize GitFileHistory repos require full OS-level isolation.
  if (
    prefix.includes("checkpoint") ||
    prefix.includes("file-history") ||
    prefix.includes("manual-change") ||
    prefix.includes("manual-delete") ||
    prefix.includes("untracked-manual") ||
    prefix.includes("no-manual") ||
    prefix.includes("permission-no") ||
    prefix.includes("undo-") ||
    prefix.includes("outside")
  ) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }
  // Fast path: subdirectories within the shared parent (avoids mkdtempSync overhead).
  const parent = prefix.includes("home") ? sharedHome : sharedWorkspace;
  const dir = path.join(parent, `${prefix}${subdirCounter++}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

// ── Session manager factories ─────────────────────────────────────────

export function createSessionManager(projectRoot: string): SessionManager {
  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
      telemetryEnabled: true,
    }),
    getResolvedSettings: () => ({ model: "test-model", cacheMode: "off", providerName: "deepseek" }),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: () => {},
  });
}

export function createNotifyingSessionManager(
  projectRoot: string,
  responses: unknown[],
  notifyPath: string,
  notifyOutput: string
): SessionManager {
  const client = {
    chat: {
      completions: {
        create: async () => {
          const response = responses.shift();
          assert.ok(response, "expected a queued chat response");
          if (response instanceof Error) {
            throw response;
          }
          return response;
        },
      },
    },
  };

  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
      notify: notifyPath,
      env: {
        NOTIFY_OUTPUT: notifyOutput,
        STATUS: "stale-status",
        FAIL_REASON: "stale-failure",
        BODY: "stale-body",
        TITLE: "stale-title",
      },
    }),
    getResolvedSettings: () => ({ model: "test-model", cacheMode: "off", providerName: "deepseek" }),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: () => {},
  });
}

export function createMockedClientSessionManager(projectRoot: string, responses: unknown[]): SessionManager {
  const client = {
    chat: {
      completions: {
        create: async () => {
          const response = responses.shift();
          assert.ok(response, "expected a queued chat response");
          return response;
        },
      },
    },
  };

  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model", cacheMode: "off", providerName: "deepseek" }),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: () => {},
  });
}

export function createPermissionSessionManager(
  projectRoot: string,
  responses: unknown[],
  permissions: {
    allow: any[];
    deny: any[];
    ask: any[];
    defaultMode: "allowAll" | "askAll";
  }
): SessionManager {
  const client = {
    chat: {
      completions: {
        create: async () => {
          const response = responses.shift();
          assert.ok(response, "expected a queued chat response");
          return response;
        },
      },
    },
  };

  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model", permissions, cacheMode: "off", providerName: "deepseek" }),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: () => {},
  });
}

export function createMockedClientSessionManagerWithClient(projectRoot: string, client: unknown): SessionManager {
  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model", cacheMode: "off", providerName: "deepseek" }),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: () => {},
  });
}

// ── Response factories ────────────────────────────────────────────────

export class APIUserAbortError extends Error {}

export function createChatResponse(content: string, usage: Record<string, unknown>): unknown {
  return {
    choices: [{ message: { content } }],
    usage,
  };
}

export function createToolCallResponse(toolCalls: unknown[], usage: Record<string, unknown>): unknown {
  return {
    choices: [{ message: { content: "", tool_calls: toolCalls } }],
    usage,
  };
}

export function buildTestMessage(
  id: string,
  sessionId: string,
  role: SessionMessage["role"],
  content: string
): SessionMessage {
  return {
    id,
    sessionId,
    role,
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
  };
}

export async function* createChatStreamResponse(
  chunks: Record<string, unknown>[]
): AsyncGenerator<Record<string, unknown>> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ── Git / file-history helpers ────────────────────────────────────────

export function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function createFileHistoryCommit(
  home: string,
  workspace: string,
  sessionId: string,
  files: Record<string, string>
): string {
  const projectCode = getProjectCode(workspace);
  const gitDir = path.join(home, ".dscode", "projects", projectCode, "file-history", ".git");
  const fileHistory = new GitFileHistory(workspace, gitDir);
  fileHistory.ensureSession(sessionId);

  const filePaths: string[] = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(workspace, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    filePaths.push(filePath);
  }
  const commitHash = fileHistory.recordCheckpoint(sessionId, filePaths, "checkpoint");
  assert.ok(commitHash);
  return commitHash;
}

export function getFileHistoryGitDir(home: string, workspace: string): string {
  const projectCode = getProjectCode(workspace);
  return path.join(home, ".dscode", "projects", projectCode, "file-history", ".git");
}

export function readFileHistoryManifest(home: string, workspace: string, checkpointHash: string): any {
  const gitDir = getFileHistoryGitDir(home, workspace);
  return JSON.parse(
    runFileHistoryGit(gitDir, workspace, ["cat-file", "blob", `${checkpointHash}:.deepcode-file-history.json`])
  );
}

export function runFileHistoryGit(
  gitDir: string,
  workspace: string,
  args: string[],
  input = "",
  env: NodeJS.ProcessEnv = process.env
): string {
  return execFileSync(
    "git",
    ["-c", "core.autocrlf=false", "-c", "core.eol=lf", `--git-dir=${gitDir}`, `--work-tree=${workspace}`, ...args],
    {
      encoding: "utf8",
      input,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
}

// ── Notify / MCP / misc helpers ──────────────────────────────────────

export function createNotifyRecorderScript(dir: string): string {
  const scriptPath = path.join(dir, "notify-recorder.cjs");
  fs.writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("fs");
const keys = ["DURATION", "STATUS", "FAIL_REASON", "BODY", "TITLE"];
const record = {};
for (const key of keys) {
  record[key] = Object.hasOwn(process.env, key) ? process.env[key] : null;
}
fs.appendFileSync(process.env.NOTIFY_OUTPUT, JSON.stringify(record) + "\\n", "utf8");
`,
    "utf8"
  );
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

export async function waitForNotifyRecords(
  outputPath: string,
  expectedCount: number
): Promise<Array<Record<string, unknown>>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(outputPath)) {
      const records = fs
        .readFileSync(outputPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      if (records.length >= expectedCount) {
        return records;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`expected ${expectedCount} notify records in ${outputPath}`);
}

export async function waitForMcpStatus(manager: SessionManager, expectedStatus: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (manager.getMcpStatus()[0]?.status === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`expected MCP status ${expectedStatus}`);
}

export function escapeRegExp(value: string): string {
  return RegExp.escape(value);
}

export async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export function createSessionAndMessages(manager: SessionManager, sessionId: string, summary: string): string {
  const now = new Date().toISOString();
  const index = (manager as any).loadSessionsIndex();
  index.entries.push({
    id: sessionId,
    summary,
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "completed",
    failReason: null,
    usage: null,
    usagePerModel: null,
    activeTokens: 0,
    createTime: now,
    updateTime: now,
    processes: null,
  });
  (manager as any).saveSessionsIndex(index);

  const projectDir = (manager as any).getProjectStorage().projectDir;
  const messagePath = path.join(projectDir, `${sessionId}.jsonl`);
  const msg = JSON.stringify({
    id: "msg-1",
    sessionId,
    role: "user",
    content: summary,
    visible: true,
    createTime: now,
    updateTime: now,
  });
  fs.writeFileSync(messagePath, `${msg}\n`, "utf8");

  return sessionId;
}
