import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import { getErrorMessage } from "../common/error-utils.js";

const MAX_RESULTS = 500;
const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB
const MATCH_LINE_CONTEXT_CHARS = 200;
const CONCURRENCY = 16;

// Safety net in case .gitignore is missing or incomplete.
// fs.globSync respects .gitignore by default; these only apply when there is no
// .gitignore or when it doesn't cover them.
const EXCLUDE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  "out/**",
  ".next/**",
  ".nuxt/**",
  ".venv/**",
  "venv/**",
  "__pycache__/**",
  ".pytest_cache/**",
  ".mypy_cache/**",
  ".ruff_cache/**",
  ".gradle/**",
  ".idea/**",
  ".vscode/**",
  "target/**",
  "*.pyc",
  "*.pyo",
  "*.class",
  "*.jar",
  "*.war",
];

type GrepMatch = {
  file: string;
  line: number;
  column: number;
  match: string;
  line_content: string;
};

type GrepResult = {
  pattern: string;
  matches: GrepMatch[];
  truncated: boolean;
  files_searched: number;
};

export async function handleGrepTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
  if (!pattern) {
    return {
      ok: false,
      name: "grep",
      error: 'Missing required "pattern" string.',
    };
  }

  // Validate regex eagerly so errors surface before any I/O.
  try {
    new RegExp(pattern, "g");
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      ok: false,
      name: "grep",
      error: `Invalid regex pattern: ${message}`,
    };
  }

  const globFilter = typeof args.glob === "string" ? args.glob.trim() : "";
  const searchPathArg = typeof args.path === "string" ? args.path.trim() : "";
  const searchPath = searchPathArg ? path.resolve(context.projectRoot, searchPathArg) : context.projectRoot;

  // Verify the search path is inside the project root
  const relativeSearchPath = path.relative(context.projectRoot, searchPath);
  if (relativeSearchPath.startsWith("..") || path.isAbsolute(relativeSearchPath)) {
    return {
      ok: false,
      name: "grep",
      error: `Path "${searchPathArg}" is outside the project root.`,
    };
  }

  let searchStat: fs.Stats;
  try {
    searchStat = fs.statSync(searchPath);
  } catch {
    return {
      ok: false,
      name: "grep",
      error: `Path "${searchPathArg}" not found.`,
    };
  }

  // ── Single-file path ──────────────────────────────────────────────
  if (searchStat.isFile()) {
    const relPath = path.relative(context.projectRoot, searchPath).replace(/\\/g, "/");
    const { matches } = await searchFileStreaming(searchPath, relPath, pattern, MAX_RESULTS);
    const truncated = matches.length > MAX_RESULTS;
    const result: GrepResult = {
      pattern,
      matches: truncated ? matches.slice(0, MAX_RESULTS) : matches,
      truncated,
      files_searched: 1,
    };
    return { ok: true, name: "grep", output: JSON.stringify(result, null, 2) };
  }

  // ── Directory: discover files with native glob ─────────────────────
  const effectiveGlob = globFilter ? (/[/\\]/.test(globFilter) ? globFilter : `**/${globFilter}`) : "**/*";

  let fileRelPaths: string[];
  try {
    const raw = fs.globSync(effectiveGlob, {
      cwd: searchPath,
      exclude: EXCLUDE_PATTERNS,
    });
    fileRelPaths = raw.map((p) => p.replace(/\\/g, "/"));
  } catch {
    return {
      ok: false,
      name: "grep",
      error: `Invalid glob pattern: ${globFilter}`,
    };
  }

  // ── Search files in parallel batches ──────────────────────────────
  const allMatches: GrepMatch[] = [];
  let filesSearched = 0;

  for (let i = 0; i < fileRelPaths.length && allMatches.length <= MAX_RESULTS; i += CONCURRENCY) {
    const batch = fileRelPaths.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((relPath) => {
        const fullPath = path.resolve(searchPath, relPath);
        return searchFileStreaming(fullPath, relPath, pattern, MAX_RESULTS - allMatches.length);
      })
    );

    for (const { matches, searched } of results) {
      if (searched) filesSearched++;
      allMatches.push(...matches);
      if (allMatches.length > MAX_RESULTS) break;
    }
  }

  const truncated = allMatches.length > MAX_RESULTS;
  const result: GrepResult = {
    pattern,
    matches: truncated ? allMatches.slice(0, MAX_RESULTS) : allMatches,
    truncated,
    files_searched: filesSearched,
  };

  return {
    ok: true,
    name: "grep",
    output: JSON.stringify(result, null, 2),
  };
}

// ── Streaming async file search ──────────────────────────────────────

interface FileSearchResult {
  matches: GrepMatch[];
  searched: boolean;
}

async function searchFileStreaming(
  fullPath: string,
  relPath: string,
  pattern: string,
  maxResults: number
): Promise<FileSearchResult> {
  if (maxResults <= 0) return { matches: [], searched: false };

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(fullPath);
  } catch {
    return { matches: [], searched: false };
  }

  if (stat.size > MAX_FILE_SIZE_BYTES) return { matches: [], searched: false };

  // Read first 4KB to detect binary files.
  let headBuf: Buffer;
  try {
    const fd = await fs.promises.open(fullPath, "r");
    headBuf = Buffer.alloc(4096);
    const { bytesRead } = await fd.read(headBuf, 0, 4096, 0);
    await fd.close();
    headBuf = headBuf.subarray(0, bytesRead);
  } catch {
    return { matches: [], searched: false };
  }

  if (isBinary(headBuf)) return { matches: [], searched: false };

  // Stream line-by-line with early termination.
  const matches: GrepMatch[] = [];
  const regex = new RegExp(pattern, "g");
  let lineNum = 0;

  const stream = fs.createReadStream(fullPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      lineNum++;
      regex.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null && matches.length < maxResults) {
        matches.push({
          file: relPath,
          line: lineNum,
          column: match.index + 1,
          match: match[0],
          line_content: truncateLineContent(line, MATCH_LINE_CONTEXT_CHARS),
        });
        // Prevent infinite loop on zero-length matches
        if (match[0].length === 0) regex.lastIndex += 1;
      }

      if (matches.length >= maxResults) {
        break;
      }
    }
  } catch {
    // Stream errors (e.g., file deleted mid-read) → return partial matches.
  } finally {
    rl.close();
  }

  return { matches, searched: true };
}

// ── Helpers ──────────────────────────────────────────────────────────

function isBinary(buf: Buffer): boolean {
  return buf.indexOf(0) !== -1;
}

function truncateLineContent(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  return line.slice(0, maxChars) + "…";
}
