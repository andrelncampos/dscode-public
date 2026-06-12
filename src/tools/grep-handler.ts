import * as fs from "node:fs";
import * as path from "node:path";
import ignore from "ignore";
import { minimatch } from "minimatch";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";

const MAX_RESULTS = 500;
const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB
const MATCH_LINE_CONTEXT_CHARS = 200;

const DEFAULT_IGNORE = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".nuxt/",
  ".venv/",
  "venv/",
  "__pycache__/",
  "*.pyc",
  "*.pyo",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  ".gradle/",
  ".idea/",
  ".vscode/",
  "*.class",
  "*.jar",
  "*.war",
  "target/",
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

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "g");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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

  const matcher = loadGitignoreMatcher(context.projectRoot);
  const matches: GrepMatch[] = [];
  let filesSearched = 0;

  if (searchStat.isFile()) {
    // Search a single file
    const relPath = path.relative(context.projectRoot, searchPath).replace(/\\/g, "/");
    searchFile(searchPath, relPath, regex, matches, false);
    filesSearched = 1;
  } else {
    // Walk directory recursively
    const queue: string[] = [searchPath];
    while (queue.length > 0 && matches.length < MAX_RESULTS + 1) {
      const current = queue.pop();
      if (!current) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (matches.length > MAX_RESULTS) break;

        const fullPath = path.join(current, entry.name);
        const relPath = path.relative(context.projectRoot, fullPath).replace(/\\/g, "/");

        if (matcher(relPath, entry.isDirectory())) {
          continue;
        }

        if (entry.isDirectory()) {
          queue.push(fullPath);
        } else if (entry.isFile()) {
          if (globFilter && !minimatch(relPath, globFilter, { matchBase: true })) {
            continue;
          }
          searchFile(fullPath, relPath, regex, matches, matches.length >= MAX_RESULTS);
          if (matches.length <= MAX_RESULTS) {
            filesSearched++;
          }
        }
      }
    }
  }

  const truncated = matches.length > MAX_RESULTS;
  const result: GrepResult = {
    pattern,
    matches: truncated ? matches.slice(0, MAX_RESULTS) : matches,
    truncated,
    files_searched: filesSearched,
  };

  return {
    ok: true,
    name: "grep",
    output: JSON.stringify(result, null, 2),
  };
}

function searchFile(fullPath: string, relPath: string, regex: RegExp, matches: GrepMatch[], skip: boolean): void {
  if (skip) return;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return;
  }

  if (stat.size > MAX_FILE_SIZE_BYTES) return;

  let content: string;
  try {
    content = fs.readFileSync(fullPath, "utf8");
  } catch {
    return;
  }

  // Skip binary files (check first 4096 bytes for null bytes)
  if (isBinary(content.slice(0, 4096))) return;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length && matches.length <= MAX_RESULTS; i++) {
    const line = lines[i];
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null && matches.length <= MAX_RESULTS) {
      const column = match.index + 1; // 1-indexed
      const matchedText = match[0];
      const lineContent = truncateLineContent(line, MATCH_LINE_CONTEXT_CHARS);
      matches.push({
        file: relPath,
        line: i + 1, // 1-indexed
        column,
        match: matchedText,
        line_content: lineContent,
      });
      // Prevent infinite loop on zero-length matches
      if (matchedText.length === 0) {
        regex.lastIndex += 1;
      }
    }
  }
}

function isBinary(chunk: string): boolean {
  if (!chunk) return false;
  // Check for null bytes which indicate binary content
  return chunk.indexOf("\0") !== -1;
}

function truncateLineContent(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  return line.slice(0, maxChars) + "…";
}

function loadGitignoreMatcher(projectRoot: string): (relPath: string, isDir: boolean) => boolean {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const ig = ignore();
  ig.add(DEFAULT_IGNORE);

  if (!fs.existsSync(gitignorePath)) {
    return (relPath: string, isDir: boolean) => {
      if (!relPath) return false;
      const candidate = isDir ? `${relPath}/` : relPath;
      return ig.ignores(candidate);
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(gitignorePath, "utf8");
  } catch {
    return (relPath: string, isDir: boolean) => {
      if (!relPath) return false;
      const candidate = isDir ? `${relPath}/` : relPath;
      return ig.ignores(candidate);
    };
  }

  ig.add(content);
  return (relPath: string, isDir: boolean) => {
    if (!relPath) return false;
    const candidate = isDir ? `${relPath}/` : relPath;
    return ig.ignores(candidate);
  };
}
