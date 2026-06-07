import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Preferred configuration directory name. */
export const CONFIG_DIR = ".dscode";

/** Legacy configuration directory name — read fallback and migration source. */
export const LEGACY_CONFIG_DIR = ".deepcode";

// ---------------------------------------------------------------------------
// Path helpers — always return .dscode paths
// ---------------------------------------------------------------------------

/** Absolute path to the project-level .dscode directory. */
export function getProjectDscodeDir(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_DIR);
}

/** Absolute path to the project-level .deepcode directory (legacy). */
export function getProjectLegacyDir(projectRoot: string): string {
  return path.join(projectRoot, LEGACY_CONFIG_DIR);
}

/**
 * Absolute path to the git worktree root .dscode directory, or null when
 * the project is not inside a Git repository.
 */
export function getGitRootDscodeDir(projectRoot: string): string | null {
  const gitRoot = resolveGitRoot(projectRoot);
  return gitRoot ? path.join(gitRoot, CONFIG_DIR) : null;
}

/**
 * Absolute path to the git worktree root .deepcode directory (legacy),
 * or null when not inside a Git repository.
 */
export function getGitRootLegacyDir(projectRoot: string): string | null {
  const gitRoot = resolveGitRoot(projectRoot);
  return gitRoot ? path.join(gitRoot, LEGACY_CONFIG_DIR) : null;
}

/** Absolute path to the user-level ~/.dscode directory. */
export function getUserDscodeDir(): string {
  return path.join(os.homedir(), CONFIG_DIR);
}

/** Absolute path to the user-level ~/.deepcode directory (legacy). */
export function getUserLegacyDir(): string {
  return path.join(os.homedir(), LEGACY_CONFIG_DIR);
}

// ---------------------------------------------------------------------------
// Generic read helper — tries .dscode first, falls back to .deepcode
// ---------------------------------------------------------------------------

/**
 * Resolve a sub-path relative to a config directory, preferring .dscode
 * over .deepcode.  Returns the first existing path or null.
 *
 * Example:
 *   resolveConfigSubpath(projectRoot, "AGENTS.md")
 *   → tries <projectRoot>/.dscode/AGENTS.md, then <projectRoot>/.deepcode/AGENTS.md
 */
export function resolveConfigSubpath(basePath: string, subPath: string): string | null {
  const preferred = path.join(basePath, CONFIG_DIR, subPath);
  if (fs.existsSync(preferred)) {
    return preferred;
  }
  const legacy = path.join(basePath, LEGACY_CONFIG_DIR, subPath);
  return fs.existsSync(legacy) ? legacy : null;
}

/**
 * Resolve a config directory itself, preferring .dscode over .deepcode.
 * Returns the first existing directory path or null.
 */
export function resolveConfigDir(basePath: string): string | null {
  const preferred = path.join(basePath, CONFIG_DIR);
  if (fs.existsSync(preferred)) {
    return preferred;
  }
  const legacy = path.join(basePath, LEGACY_CONFIG_DIR);
  return fs.existsSync(legacy) ? legacy : null;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Copy a directory recursively (synchronous).  Creates `dest` if needed and
 * copies all files and subdirectories from `src`.
 */
function copyDirectorySync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      // Symbolic links to directories are treated as directories.
      if (fs.lstatSync(srcPath).isSymbolicLink()) {
        // Copy symlink as-is
        const linkTarget = fs.readlinkSync(srcPath);
        fs.symlinkSync(linkTarget, destPath);
      } else {
        copyDirectorySync(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Migrate .deepcode → .dscode at a single base path level.
 *
 * If `.dscode` does not exist and `.deepcode` does, the entire contents of
 * `.deepcode` are copied into `.dscode`.
 *
 * Returns `true` when a migration was performed, `false` otherwise.
 */
export function migrateFromDeepcode(basePath: string): boolean {
  const dscodeDir = path.join(basePath, CONFIG_DIR);
  const deepcodeDir = path.join(basePath, LEGACY_CONFIG_DIR);

  // Already migrated — nothing to do.
  if (fs.existsSync(dscodeDir)) {
    return false;
  }

  // No legacy directory to migrate from.
  if (!fs.existsSync(deepcodeDir)) {
    return false;
  }

  try {
    copyDirectorySync(deepcodeDir, dscodeDir);
    return true;
  } catch {
    // If copy fails, don't crash the CLI.  The fallback reads will still
    // work because resolveConfigSubpath / resolveConfigDir check legacy paths.
    return false;
  }
}

/**
 * Run migration at all three levels:
 *   1) Project root  (the current working directory / project)
 *   2) Git root      (the containing Git worktree, if any)
 *   3) User home     (~)
 *
 * The git root is skipped when it coincides with the project root.
 *
 * Returns the set of base paths that were actually migrated.
 */
export function migrateAllLevels(projectRoot: string): string[] {
  const migrated: string[] = [];

  // 1) Project level
  if (migrateFromDeepcode(projectRoot)) {
    migrated.push(projectRoot);
  }

  // 2) Git root level (skip if same as project root)
  const gitRoot = resolveGitRoot(projectRoot);
  if (gitRoot !== null && path.resolve(gitRoot) !== path.resolve(projectRoot)) {
    if (migrateFromDeepcode(gitRoot)) {
      migrated.push(gitRoot);
    }
  }

  // 3) User home
  const homeDir = os.homedir();
  const resolvedHome = path.resolve(homeDir);
  const alreadyMigrated = migrated.some((p) => path.resolve(p) === resolvedHome);
  if (!alreadyMigrated) {
    if (migrateFromDeepcode(homeDir)) {
      migrated.push(homeDir);
    }
  }

  return migrated;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

let cachedGitRoot: string | null | undefined;

/**
 * Return the absolute path to the Git worktree root for `projectRoot`,
 * or null when not inside a Git repository.
 */
function resolveGitRoot(projectRoot: string): string | null {
  if (cachedGitRoot !== undefined) {
    return cachedGitRoot;
  }

  try {
    const stdout = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    });
    const trimmed = stdout.trim();
    cachedGitRoot = trimmed ? path.resolve(trimmed) : null;
  } catch {
    cachedGitRoot = null;
  }

  return cachedGitRoot;
}
