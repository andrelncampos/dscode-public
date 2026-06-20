import * as fs from "node:fs";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import { getErrorMessage } from "../common/error-utils.js";

const MAX_RESULTS = 500;

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

  // If the pattern has no directory component (no / or \), prepend **/ so it
  // matches in any subdirectory — preserving the matchBase behavior the old
  // minimatch-based implementation had.
  const effectivePattern = /[/\\]/.test(pattern) ? pattern : `**/${pattern}`;

  let allMatches: string[];
  try {
    allMatches = fs.globSync(effectivePattern, {
      cwd: context.projectRoot,
      exclude: EXCLUDE_PATTERNS,
    });
  } catch (error) {
    return {
      ok: false,
      name: "glob",
      error: `Invalid glob pattern: ${getErrorMessage(error)}`,
    };
  }

  // Normalize Windows backslashes to POSIX separators.
  const normalized = allMatches.map((p) => p.replace(/\\/g, "/"));

  const truncated = normalized.length > MAX_RESULTS;
  const result: GlobResult = {
    pattern,
    matches: truncated ? normalized.slice(0, MAX_RESULTS) : normalized,
    truncated,
  };

  return {
    ok: true,
    name: "glob",
    output: JSON.stringify(result, null, 2),
  };
}
