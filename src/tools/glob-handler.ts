import * as fs from "node:fs";
import * as path from "node:path";
import ignore from "ignore";
import { minimatch } from "minimatch";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";

const MAX_RESULTS = 500;
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

type GlobResult = {
  pattern: string;
  matches: string[];
  truncated: boolean;
};

export async function handleGlobTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
  if (!pattern) {
    return {
      ok: false,
      name: "glob",
      error: 'Missing required "pattern" string.',
    };
  }

  const matcher = loadGitignoreMatcher(context.projectRoot);
  const matches: string[] = [];
  const queue: string[] = [context.projectRoot];

  while (queue.length > 0 && matches.length < MAX_RESULTS + 1) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.relative(context.projectRoot, fullPath).replace(/\\/g, "/");

      if (matcher(relPath, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && minimatch(relPath, pattern, { matchBase: true })) {
        matches.push(relPath);
      }
    }
  }

  const truncated = matches.length > MAX_RESULTS;
  const result: GlobResult = {
    pattern,
    matches: truncated ? matches.slice(0, MAX_RESULTS) : matches,
    truncated,
  };

  return {
    ok: true,
    name: "glob",
    output: JSON.stringify(result, null, 2),
  };
}

function loadGitignoreMatcher(projectRoot: string): (relPath: string, isDir: boolean) => boolean {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const ig = ignore();
  ig.add(DEFAULT_IGNORE);

  if (!fs.existsSync(gitignorePath)) {
    return (relPath: string, isDir: boolean) => {
      if (!relPath) {
        return false;
      }
      const candidate = isDir ? `${relPath}/` : relPath;
      return ig.ignores(candidate);
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(gitignorePath, "utf8");
  } catch {
    // Use only default ignores if .gitignore cannot be read.
    return (relPath: string, isDir: boolean) => {
      if (!relPath) {
        return false;
      }
      const candidate = isDir ? `${relPath}/` : relPath;
      return ig.ignores(candidate);
    };
  }

  ig.add(content);
  return (relPath: string, isDir: boolean) => {
    if (!relPath) {
      return false;
    }
    const candidate = isDir ? `${relPath}/` : relPath;
    return ig.ignores(candidate);
  };
}
