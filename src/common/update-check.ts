import React from "react";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { render, type Instance } from "ink";
import { UpdatePrompt, type UpdatePromptChoice } from "../ui";

export type PackageInfo = {
  name: string;
  version: string;
};

type UpdateState = {
  pending?: {
    currentVersion: string;
    latestVersion: string;
    packageName: string;
    checkedAt: string;
  } | null;
  ignoredVersions?: string[];
};

const UPDATE_STATE_FILE = "update-check.json";
export const UPDATE_SUCCESS_MESSAGE = "✅ Update complete! Please restart DsCode.";

export async function promptForPendingUpdate(
  packageInfo: PackageInfo,
  githubToken?: string
): Promise<{ installed: boolean }> {
  const state = readUpdateState();
  const pending = state.pending;
  if (!pending) {
    return { installed: false };
  }

  if (compareVersions(packageInfo.version, pending.latestVersion) >= 0) {
    writeUpdateState({ ...state, pending: null });
    return { installed: false };
  }

  if (state.ignoredVersions?.includes(pending.latestVersion)) {
    writeUpdateState({ ...state, pending: null });
    return { installed: false };
  }

  const installCommand = `Downloading dscode v${pending.latestVersion}`;
  const choice = await promptUpdateChoice({
    currentVersion: packageInfo.version,
    latestVersion: pending.latestVersion,
    installCommand,
  });

  if (choice === "install") {
    const ok = await downloadAndInstallFromGitHub(pending.latestVersion, githubToken);
    if (ok) {
      writeUpdateState({ ...state, pending: null });
      process.stdout.write(`${UPDATE_SUCCESS_MESSAGE}\n\n`);
    }
    return { installed: ok };
  }

  if (choice === "ignore-version") {
    const ignoredVersions = Array.from(new Set([...(state.ignoredVersions ?? []), pending.latestVersion]));
    writeUpdateState({ ...state, pending: null, ignoredVersions });
    return { installed: false };
  }

  writeUpdateState({ ...state, pending: null });
  return { installed: false };
}

export async function checkForUpdate(packageInfo: PackageInfo, githubToken?: string): Promise<boolean> {
  if (!packageInfo.name || !packageInfo.version) {
    return false;
  }

  try {
    const latestVersion = await fetchLatestGitHubVersion(githubToken);
    if (!latestVersion || compareVersions(latestVersion, packageInfo.version) <= 0) {
      clearPendingUpdate();
      return false;
    }

    const state = readUpdateState();
    if (state.ignoredVersions?.includes(latestVersion)) {
      clearPendingUpdate(state);
      return false;
    }

    writeUpdateState({
      ...state,
      pending: {
        currentVersion: packageInfo.version,
        latestVersion,
        packageName: packageInfo.name,
        checkedAt: new Date().toISOString(),
      },
    });
    return true;
  } catch {
    // Update checks must never affect CLI startup or normal operation.
    return false;
  }
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}

export function getUpdateStatePath(): string {
  return path.join(os.homedir(), ".dscode", UPDATE_STATE_FILE);
}

async function promptUpdateChoice({
  currentVersion,
  latestVersion,
  installCommand,
}: {
  currentVersion: string;
  latestVersion: string;
  installCommand: string;
}): Promise<"install" | "ignore-once" | "ignore-version"> {
  const { promise, resolve } = Promise.withResolvers<UpdatePromptChoice>();
  let selected = false;
  let instance: Instance | null = null;
  const handleSelect = (choice: UpdatePromptChoice): void => {
    if (selected) {
      return;
    }
    selected = true;
    resolve(choice);
    instance?.unmount();
  };

  instance = render(
    React.createElement(UpdatePrompt, {
      currentVersion,
      latestVersion,
      installCommand,
      onSelect: handleSelect,
    }),
    { exitOnCtrlC: false }
  );
  return promise;
}

// ─── GitHub API ────────────────────────────────────────────────────────────────

async function fetchLatestGitHubVersion(githubToken?: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (githubToken) {
      headers["Authorization"] = `Bearer ${githubToken}`;
    }
    const response = await fetch("https://api.github.com/repos/andrelncampos/dscode-public/releases/latest", {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name?: string };
    if (typeof data.tag_name !== "string") return null;
    return data.tag_name.replace(/^v/, "");
  } catch {
    return null;
  }
}

// Matches package-binary.mjs platform naming: dscode-v{VERSION}-{platformTag}.{ext}
function getPlatformTag(): string {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "win32") return "windows-x64";
  if (platform === "linux") return "linux-x64";
  if (platform === "darwin" && arch === "arm64") return "macos-arm64";
  if (platform === "darwin") return "macos-x64";
  return `${platform}-${arch}`;
}

function getAssetName(version: string): string {
  const platformTag = getPlatformTag();
  const ext = process.platform === "win32" ? "zip" : "tar.gz";
  return `dscode-v${version}-${platformTag}.${ext}`;
}

function getBinaryName(): string {
  return process.platform === "win32" ? "dscode.exe" : "dscode";
}

async function downloadAndInstallFromGitHub(version: string, githubToken?: string): Promise<boolean> {
  const homeDir = os.homedir();
  const updatesDir = path.join(homeDir, ".dscode", "updates");
  fs.mkdirSync(updatesDir, { recursive: true });

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (githubToken) {
      headers["Authorization"] = `Bearer ${githubToken}`;
    }

    const releaseResp = await fetch(
      `https://api.github.com/repos/andrelncampos/dscode-public/releases/tags/v${version}`,
      { headers, signal: AbortSignal.timeout(15000) }
    );
    if (!releaseResp.ok) return false;
    const release = (await releaseResp.json()) as {
      assets?: Array<{ name: string; browser_download_url: string; size: number }>;
    };

    const assetName = getAssetName(version);
    const asset = (release.assets ?? []).find((a) => a.name === assetName);
    if (!asset) {
      process.stderr.write(`No binary available for ${assetName}. Available assets:\n`);
      for (const a of release.assets ?? []) {
        process.stderr.write(`  - ${a.name}\n`);
      }
      return false;
    }

    const archivePath = path.join(updatesDir, assetName);
    const extractDir = path.join(updatesDir, `dscode-v${version}-extract`);

    process.stdout.write(`\n⬇  Downloading dscode v${version} (${assetName})...\n\n`);

    const downloadResp = await fetch(asset.browser_download_url, {
      signal: AbortSignal.timeout(300000),
      redirect: "follow",
    });
    if (!downloadResp.ok) return false;
    const buffer = Buffer.from(await downloadResp.arrayBuffer());
    fs.writeFileSync(archivePath, buffer);

    // Extract the binary from the archive
    const binaryName = getBinaryName();
    const extractMarker = path.join(extractDir, binaryName);

    if (!fs.existsSync(extractMarker)) {
      process.stdout.write(`📦 Extracting ${binaryName} from archive...\n`);
      // Clean previous extraction if any
      try {
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch {
        /* ok */
      }
      fs.mkdirSync(extractDir, { recursive: true });

      if (assetName.endsWith(".zip")) {
        if (process.platform === "win32") {
          execSync(
            `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`,
            { stdio: "pipe" }
          );
        } else {
          execSync(`unzip -o "${archivePath}" -d "${extractDir}"`, { stdio: "pipe" });
        }
      } else {
        execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: "pipe" });
      }

      if (!fs.existsSync(extractMarker)) {
        process.stderr.write(`Binary ${binaryName} not found after extraction.\n`);
        return false;
      }
    }

    const destPath = path.join(updatesDir, `dscode-v${version}${process.platform === "win32" ? ".exe" : ""}`);
    fs.copyFileSync(extractMarker, destPath);

    // Atomic replacement
    const currentPath = process.execPath;
    const oldPath = currentPath + ".old";

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.renameSync(currentPath, oldPath);
        break;
      } catch {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          process.stderr.write("Could not replace binary. Close other instances and try again.\n");
          return false;
        }
      }
    }

    try {
      fs.copyFileSync(destPath, currentPath);
    } catch {
      try {
        fs.renameSync(oldPath, currentPath);
      } catch {
        /* rollback best-effort */
      }
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// ─── State management ──────────────────────────────────────────────────────────

function readUpdateState(): UpdateState {
  const statePath = getUpdateStatePath();
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as UpdateState;
    return {
      pending: parsed.pending ?? null,
      ignoredVersions: Array.isArray(parsed.ignoredVersions)
        ? parsed.ignoredVersions.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0
          )
        : [],
    };
  } catch {
    return {};
  }
}

function writeUpdateState(state: UpdateState): void {
  const statePath = getUpdateStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function clearPendingUpdate(state = readUpdateState()): void {
  if (!state.pending) {
    return;
  }
  writeUpdateState({ ...state, pending: null });
}

function parseVersion(value: string): number[] {
  return value
    .split("-", 1)[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}
