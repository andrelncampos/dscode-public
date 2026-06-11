// Tests for GitFileHistory integration: file-history initialization,
// snapshot tracking, manual-change detection, undo/restore, and Write tool checkpoints.
// These tests require OS-level temp dir isolation (they create .git directories).

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { GitFileHistory } from "../common/file-history";
import { getProjectCode, type SessionMessage } from "../session";
import {
  registerSessionHooks,
  createTempDir,
  setHomeDir,
  createSessionManager,
  createMockedClientSessionManager,
  createFileHistoryCommit,
  getFileHistoryGitDir,
  readFileHistoryManifest,
  runFileHistoryGit,
  createChatResponse,
  buildTestMessage,
  hasGit,
  flushPromises,
} from "./session-helpers";

registerSessionHooks();

// ── File-history checkpoint tracking ──────────────────────────────────

test("replySession records the current file-history branch head as checkpointHash", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-checkpoint-hash-workspace-");
  const home = createTempDir("deepcode-checkpoint-hash-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const checkpointHash = createFileHistoryCommit(home, workspace, sessionId, { "note.txt": "checkpoint\n" });

  await manager.replySession(sessionId, { text: "second prompt" });

  const userMessages = manager.listSessionMessages(sessionId).filter((message) => message.role === "user");
  assert.equal(userMessages[userMessages.length - 1]?.checkpointHash, checkpointHash);
});

test("createSession initializes file-history repo and session branch", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-file-history-init-workspace-");
  const home = createTempDir("deepcode-file-history-init-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  const gitDir = path.join(home, ".dscode", "projects", getProjectCode(workspace), "file-history", ".git");

  assert.ok(fs.existsSync(gitDir));
  assert.ok(userMessage?.checkpointHash);
  assert.equal(
    runFileHistoryGit(gitDir, workspace, ["rev-parse", "--verify", `refs/heads/${sessionId}^{commit}`]).trim(),
    userMessage.checkpointHash
  );
});

test("createSession initializes an empty file-history manifest without scanning existing files", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-file-history-empty-init-workspace-");
  const home = createTempDir("deepcode-file-history-empty-init-home-");
  setHomeDir(home);
  fs.writeFileSync(path.join(workspace, "unrelated.txt"), "keep me\n", "utf8");
  fs.mkdirSync(path.join(workspace, "nested"));
  fs.writeFileSync(path.join(workspace, "nested", "another.txt"), "also keep me\n", "utf8");

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  assert.ok(userMessage?.checkpointHash);

  const manifest = readFileHistoryManifest(home, workspace, userMessage.checkpointHash);
  assert.deepEqual(manifest.files, {});
});

// ── Manual-change detection ──────────────────────────────────────────

test("replySession snapshots manual edits to tracked files before appending the user prompt", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-prompt-checkpoint-manual-edit-workspace-");
  const home = createTempDir("deepcode-prompt-checkpoint-manual-edit-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "hello_world.py");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "create hello world" });
  const gitDir = getFileHistoryGitDir(home, workspace);
  const fileHistory = new GitFileHistory(workspace, gitDir);

  fs.writeFileSync(filePath, 'print("Hello, World!")\n', "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "created hello world"));

  const manualEdit = 'if name == main:\n  print("Hello, World!")\n';
  fs.writeFileSync(filePath, manualEdit, "utf8");
  await manager.replySession(sessionId, { text: "I manually edited @hello_world.py, note it" });
  const manualEditUserMessage = manager
    .listSessionMessages(sessionId)
    .filter((message) => message.role === "user")
    .at(-1);
  assert.ok(manualEditUserMessage?.checkpointHash);

  fs.writeFileSync(filePath, 'if __name__ == "__main__":\n  print("Hello, World!")\n', "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "fixed hello world"));

  manager.restoreSessionCode(sessionId, manualEditUserMessage.id);

  assert.equal(fs.readFileSync(filePath, "utf8"), manualEdit);
});

test("replySession inserts hidden system notice for manually changed tracked files", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-manual-change-notice-workspace-");
  const home = createTempDir("deepcode-manual-change-notice-home-");
  setHomeDir(home);

  const firstPath = path.join(workspace, "a.txt");
  const secondPath = path.join(workspace, "b.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(firstPath, "one\n", "utf8");
  fs.writeFileSync(secondPath, "two\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [secondPath, firstPath], "track files"));

  fs.writeFileSync(secondPath, "two changed\n", "utf8");
  fs.writeFileSync(firstPath, "one changed\n", "utf8");
  await manager.replySession(sessionId, { text: "check manual changes" });

  const messages = manager.listSessionMessages(sessionId);
  const userIndex = messages.findIndex(
    (message) => message.role === "user" && message.content === "check manual changes"
  );
  assert.ok(userIndex > 0);
  const notice = messages[userIndex - 1];
  assert.equal(notice?.role, "system");
  assert.equal(notice?.visible, false);
  assert.equal(notice?.content, `Note that the user manually modified these files:\n${firstPath}\n${secondPath}`);
});

test("replySession does not insert manual-change notice when tracked files are unchanged", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-no-manual-change-notice-workspace-");
  const home = createTempDir("deepcode-no-manual-change-notice-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "tracked.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(filePath, "same\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "track file"));

  await manager.replySession(sessionId, { text: "second prompt" });

  const notices = manager
    .listSessionMessages(sessionId)
    .filter(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.startsWith("Note that the user manually modified these files:")
    );
  assert.equal(notices.length, 0);
});

test("replySession reports manual deletion of a tracked file", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-manual-delete-notice-workspace-");
  const home = createTempDir("deepcode-manual-delete-notice-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "deleted.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(filePath, "delete me\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "track file"));

  fs.unlinkSync(filePath);
  await manager.replySession(sessionId, { text: "check deletion" });

  const notice = manager
    .listSessionMessages(sessionId)
    .find(
      (message) =>
        message.role === "system" &&
        message.content === `Note that the user manually modified these files:\n${filePath}`
    );
  assert.ok(notice);
});

test("replySession ignores manually created untracked files", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-untracked-manual-file-workspace-");
  const home = createTempDir("deepcode-untracked-manual-file-home-");
  setHomeDir(home);

  const trackedPath = path.join(workspace, "tracked.txt");
  const untrackedPath = path.join(workspace, "untracked.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(trackedPath, "tracked\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [trackedPath], "track file"));

  fs.writeFileSync(untrackedPath, "new manual file\n", "utf8");
  await manager.replySession(sessionId, { text: "second prompt" });

  const notices = manager
    .listSessionMessages(sessionId)
    .filter(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.startsWith("Note that the user manually modified these files:")
    );
  assert.equal(notices.length, 0);
});

test("replySession does not insert manual-change notice for /continue", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-continue-no-manual-change-notice-workspace-");
  const home = createTempDir("deepcode-continue-no-manual-change-notice-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "tracked.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(filePath, "before\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "track file"));

  fs.writeFileSync(filePath, "manual change\n", "utf8");
  await manager.replySession(sessionId, { text: "/continue" });

  const notices = manager
    .listSessionMessages(sessionId)
    .filter(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.startsWith("Note that the user manually modified these files:")
    );
  assert.equal(notices.length, 0);
});

test("replySession does not insert manual-change notice for permission-only replies", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-permission-no-manual-change-notice-workspace-");
  const home = createTempDir("deepcode-permission-no-manual-change-notice-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "tracked.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(filePath, "before\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "track file"));
  const assistant = (manager as any).buildAssistantMessage(
    sessionId,
    "Need permission",
    [
      {
        id: "call-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: filePath }) },
      },
    ],
    null
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, assistant);

  fs.writeFileSync(filePath, "manual change\n", "utf8");
  await manager.replySession(sessionId, { permissions: [{ toolCallId: "call-read", permission: "allow" }] });

  const notices = manager
    .listSessionMessages(sessionId)
    .filter(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.startsWith("Note that the user manually modified these files:")
    );
  assert.equal(notices.length, 0);
});

// ── Write tool file-history integration ───────────────────────────────

test("Write tool advances file-history while preserving the user prompt checkpoint", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-write-checkpoint-workspace-");
  const home = createTempDir("deepcode-write-checkpoint-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "index.html");
  const manager = createMockedClientSessionManager(workspace, [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-write-index",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({ file_path: filePath, content: "<h1>Hello</h1>\n" }),
                },
              },
            ],
          },
        },
      ],
    },
    createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ]);

  const sessionId = await manager.createSession({ text: "create an index page" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  assert.ok(userMessage?.checkpointHash);
  assert.equal(fs.existsSync(filePath), true);

  manager.restoreSessionCode(sessionId, userMessage.id);

  assert.equal(fs.existsSync(filePath), false);
});

test("Write checkpoints restore tool-touched files outside the workspace and leave unrelated files alone", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-write-outside-workspace-");
  const outsideDir = createTempDir("deepcode-write-outside-target-");
  const home = createTempDir("deepcode-write-outside-home-");
  setHomeDir(home);

  const outsideFilePath = path.join(outsideDir, "outside.txt");
  const unrelatedWorkspaceFilePath = path.join(workspace, "unrelated.txt");
  const manager = createMockedClientSessionManager(workspace, [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-write-outside",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({ file_path: outsideFilePath, content: "outside\n" }),
                },
              },
            ],
          },
        },
      ],
    },
    createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ]);

  const sessionId = await manager.createSession({ text: "create an outside file" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  assert.ok(userMessage?.checkpointHash);
  assert.equal(fs.readFileSync(outsideFilePath, "utf8"), "outside\n");

  fs.writeFileSync(unrelatedWorkspaceFilePath, "keep\n", "utf8");
  manager.restoreSessionCode(sessionId, userMessage.id);

  assert.equal(fs.existsSync(outsideFilePath), false);
  assert.equal(fs.readFileSync(unrelatedWorkspaceFilePath, "utf8"), "keep\n");
});

test("missing git executable does not block sessions or Write tool calls", async () => {
  const workspace = createTempDir("deepcode-no-git-write-workspace-");
  const home = createTempDir("deepcode-no-git-write-home-");
  setHomeDir(home);

  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const filePath = path.join(workspace, "index.html");
    const manager = createMockedClientSessionManager(workspace, [
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-write-no-git",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({ file_path: filePath, content: "<h1>No Git</h1>\n" }),
                  },
                },
              ],
            },
          },
        ],
      },
      createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
    ]);

    const sessionId = await manager.createSession({ text: "create an index page" });
    const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");

    assert.equal(fs.readFileSync(filePath, "utf8"), "<h1>No Git</h1>\n");
    assert.equal(userMessage?.checkpointHash, undefined);
    assert.equal(manager.getSession(sessionId)?.status, "completed");
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
});

// ── Undo / restore ────────────────────────────────────────────────────

test("restoreSessionConversation truncates messages before the selected user prompt", async () => {
  const workspace = createTempDir("deepcode-undo-conversation-workspace-");
  const home = createTempDir("deepcode-undo-conversation-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const firstAssistant = (manager as any).buildAssistantMessage(
    sessionId,
    "first answer",
    null,
    null
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, firstAssistant);
  await manager.replySession(sessionId, { text: "second prompt" });
  const secondUserMessage = manager
    .listSessionMessages(sessionId)
    .filter((message) => message.role === "user")
    .at(-1);
  assert.ok(secondUserMessage);
  const secondAssistant = (manager as any).buildAssistantMessage(
    sessionId,
    "second answer",
    null,
    null
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, secondAssistant);

  manager.restoreSessionConversation(sessionId, secondUserMessage.id);

  const contents = manager.listSessionMessages(sessionId).map((message) => message.content);
  assert.ok(contents.includes("first prompt"));
  assert.ok(contents.includes("first answer"));
  assert.ok(!contents.includes("second prompt"));
  assert.ok(!contents.includes("second answer"));
  assert.equal(manager.getSession(sessionId)?.assistantReply, "first answer");
});

test("restoreSessionCode restores project files from the recorded Git checkpoint", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-undo-code-workspace-");
  const home = createTempDir("deepcode-undo-code-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  const sessionId = "session-code-restore";
  const checkpointHash = createFileHistoryCommit(home, workspace, sessionId, { "tracked.txt": "before\n" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  assert.ok(fileHistory.recordCheckpoint(sessionId, [path.join(workspace, "new.txt")], "pre-create new.txt"));
  createFileHistoryCommit(home, workspace, sessionId, { "tracked.txt": "after\n", "new.txt": "remove me\n" });
  fs.writeFileSync(path.join(workspace, "tracked.txt"), "after\n", "utf8");
  fs.writeFileSync(path.join(workspace, "new.txt"), "remove me\n", "utf8");

  (manager as any).appendSessionMessage(sessionId, {
    ...buildTestMessage("user-with-checkpoint", sessionId, "user", "restore here"),
    checkpointHash,
  });

  manager.restoreSessionCode(sessionId, "user-with-checkpoint");

  assert.equal(fs.readFileSync(path.join(workspace, "tracked.txt"), "utf8"), "before\n");
  assert.equal(fs.existsSync(path.join(workspace, "new.txt")), false);
});

test("restoreSessionCode preserves files that predate their first tracked mutation", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-undo-preexisting-files-workspace-");
  const home = createTempDir("deepcode-undo-preexisting-files-home-");
  setHomeDir(home);

  const readmePath = path.join(workspace, "README.md");
  const readmeEnPath = path.join(workspace, "README-en.md");
  const readmeZhPath = path.join(workspace, "README-zh_CN.md");
  fs.writeFileSync(readmePath, "这是一个hello world演示项目\n", "utf8");
  fs.writeFileSync(readmeEnPath, "This is a hello world demo project.\n", "utf8");
  fs.writeFileSync(readmeZhPath, "", "utf8");

  const manager = createSessionManager(workspace);
  const sessionId = "session-undo-preexisting-files";
  const gitDir = getFileHistoryGitDir(home, workspace);
  const fileHistory = new GitFileHistory(workspace, gitDir);
  fileHistory.ensureSession(sessionId);

  const targetCheckpoint = fileHistory.recordCheckpoint(
    sessionId,
    [readmePath, readmeEnPath],
    "checkpoint before syncing all readmes"
  );
  assert.ok(targetCheckpoint);

  assert.ok(fileHistory.recordCheckpoint(sessionId, [readmeZhPath], "pre-sync zh readme"));
  fs.writeFileSync(readmePath, "Synced readme\n", "utf8");
  fs.writeFileSync(readmeEnPath, "Synced readme\n", "utf8");
  fs.writeFileSync(readmeZhPath, "Synced readme\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [readmePath, readmeEnPath, readmeZhPath], "synced readmes"));

  (manager as any).appendSessionMessage(sessionId, {
    ...buildTestMessage("user-with-readme-checkpoint", sessionId, "user", "sync README*.md"),
    checkpointHash: targetCheckpoint,
  });

  manager.restoreSessionCode(sessionId, "user-with-readme-checkpoint");

  assert.equal(fs.readFileSync(readmePath, "utf8"), "这是一个hello world演示项目\n");
  assert.equal(fs.readFileSync(readmeEnPath, "utf8"), "This is a hello world demo project.\n");
  assert.equal(fs.readFileSync(readmeZhPath, "utf8"), "");
});

test("restoreSessionCode restores deleted tracked files and leaves unrelated files alone", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-undo-deleted-files-workspace-");
  const home = createTempDir("deepcode-undo-deleted-files-home-");
  setHomeDir(home);

  const trackedPath = path.join(workspace, "tracked.txt");
  const unrelatedPath = path.join(workspace, "unrelated.txt");
  fs.writeFileSync(trackedPath, "before delete\n", "utf8");
  fs.writeFileSync(unrelatedPath, "do not touch\n", "utf8");

  const manager = createSessionManager(workspace);
  const sessionId = "session-undo-deleted-files";
  const gitDir = getFileHistoryGitDir(home, workspace);
  const fileHistory = new GitFileHistory(workspace, gitDir);
  fileHistory.ensureSession(sessionId);
  const targetCheckpoint = fileHistory.recordCheckpoint(sessionId, [trackedPath], "before delete");
  assert.ok(targetCheckpoint);

  fs.unlinkSync(trackedPath);
  assert.ok(fileHistory.recordCheckpoint(sessionId, [trackedPath], "after delete"));

  (manager as any).appendSessionMessage(sessionId, {
    ...buildTestMessage("user-before-delete", sessionId, "user", "restore deleted file"),
    checkpointHash: targetCheckpoint,
  });

  manager.restoreSessionCode(sessionId, "user-before-delete");

  assert.equal(fs.readFileSync(trackedPath, "utf8"), "before delete\n");
  assert.equal(fs.readFileSync(unrelatedPath, "utf8"), "do not touch\n");
});
