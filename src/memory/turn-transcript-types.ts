/** Canonical turn transcript persisted between sessions. */
export type TurnTranscript = {
  /** Schema version */
  v: 1;
  /** Unique turn identifier */
  id: string;
  /** ISO-8601 creation timestamp */
  ts: string;
  /** Working directory when the turn happened */
  cwd: string;
  /** Git metadata (null if unavailable) */
  git: TurnGitInfo | null;
  /** Environment info */
  env: TurnEnvInfo;
  /** Canonical user message */
  u: string;
  /** Canonical assistant response */
  a: string;
  /** Actions executed during this turn */
  act: TurnAction[];
  /** Files touched during this turn */
  files: TurnFileRecord[];
  /** Errors detected */
  err: TurnErrorRecord[];
};

export type TurnGitInfo = {
  branch: string;
};

export type TurnEnvInfo = {
  terminal: string;
  platform: string;
  node: string;
};

/** A single action executed by the agent in a turn. */
export type TurnAction = TurnShellAction | TurnReadAction | TurnWriteAction | TurnEditAction | TurnOtherAction;

export type TurnShellAction = {
  k: "shell";
  cmd: string;
  cwd: string;
  exit: number | null;
  out: string;
  err: string;
};

export type TurnReadAction = {
  k: "read";
  path: string;
};

export type TurnWriteAction = {
  k: "write";
  path: string;
};

export type TurnEditAction = {
  k: "edit";
  path: string;
};

export type TurnOtherAction = {
  k: "other";
  name: string;
  summary: string;
};

/** A file touched during a turn. */
export type TurnFileRecord = {
  /** Relative or absolute path */
  p: string;
  /** Operation: read, write, edit, delete */
  op: "read" | "write" | "edit" | "delete";
  /** Diff preview for write/edit operations (truncated to maxDiffChars) */
  diff?: string;
};

/** An error detected during a turn. */
export type TurnErrorRecord = {
  kind: string;
  message: string;
};

// ── Memory settings ───────────────────────────────────────────────────

export type MemorySettings = {
  enabled: boolean;
  mode: "turn-transcript";
  recentTurns: number;
  maxTurnFiles: number;
  maxContextChars: number;
  maxUserCharsPerTurn: number;
  maxAssistantCharsPerTurn: number;
  maxStdoutCharsPerTurn: number;
  maxStderrCharsPerTurn: number;
  maxDiffCharsPerTurn: number;
  compression: "zstd" | "brotli";
  compressionLevel: number;
  stripAnsi: boolean;
  collapseWhitespace: boolean;
  dedupeRepeatedLines: boolean;
  storeTurnTranscripts: boolean;
};

export type MemoryTurnLimits = {
  maxUserChars: number;
  maxAssistantChars: number;
  maxStdoutChars: number;
  maxStderrChars: number;
  maxDiffChars: number;
};
