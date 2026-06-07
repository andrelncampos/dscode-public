import { readFileSync, writeFileSync, copyFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const _version = pkg.version;

const platform = process.platform;
const arch = process.arch;

const BUNDLE_FILE = resolve(root, "release", "bundle", "dscode.cjs");
const SEA_CONFIG = resolve(root, "release", "sea-config.json");
const BLOB_FILE = resolve(root, "release", "blob", "dscode.blob");
const BIN_DIR = resolve(root, "release", "bin");
const NODE_BIN = process.execPath;

if (!existsSync(BUNDLE_FILE)) {
  console.error("[sea] ERROR: Bundle not found. Run build:bundle first.");
  process.exit(1);
}

mkdirSync(resolve(root, "release", "blob"), { recursive: true });
mkdirSync(BIN_DIR, { recursive: true });

// ── Step 1: Generate SEA config ──────────────────────────────────
const seaConfig = {
  main: BUNDLE_FILE,
  output: BLOB_FILE,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
};

writeFileSync(SEA_CONFIG, JSON.stringify(seaConfig, null, 2));
console.log(`[sea] SEA config written → ${SEA_CONFIG}`);

// ── Step 2: Generate blob ────────────────────────────────────────
console.log(`[sea] Generating blob...`);
execSync(`node --experimental-sea-config "${SEA_CONFIG}"`, {
  stdio: "inherit",
  cwd: root,
});
console.log(`[sea] Blob generated → ${BLOB_FILE}`);

// ── Step 3: Attempt SEA injection ────────────────────────────────
let binName,
  binPath,
  seaSuccess = false;
if (platform === "win32") {
  binName = "dscode.exe";
} else {
  binName = "dscode";
}
binPath = resolve(BIN_DIR, binName);

copyFileSync(NODE_BIN, binPath);
console.log(`[sea] Node binary copied → ${binPath}`);

// Windows: strip digital signature
if (platform === "win32") {
  const signtoolPaths = [
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.19041.0\\x64\\signtool.exe",
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe",
  ];
  let signtool = null;
  for (const p of signtoolPaths) {
    if (existsSync(p)) {
      signtool = p;
      break;
    }
  }
  if (signtool) {
    try {
      execSync(`"${signtool}" remove /s "${binPath}"`, { stdio: "pipe" });
      console.log("[sea] Stripped digital signature (Windows).");
    } catch (e) {
      console.warn("[sea] WARNING: Could not strip signature:", e.message);
    }
  }
}

// Attempt postject injection
try {
  console.log(`[sea] Injecting blob with postject (sentinel: NODE_SEA_BLOB)...`);
  execSync(`npx postject "${binPath}" NODE_SEA_BLOB "${BLOB_FILE}"`, { stdio: "pipe", cwd: root });
  console.log(`[sea] ✅ SEA injection successful.`);

  // macOS post-processing
  if (platform === "darwin") {
    try {
      execSync(`codesign --remove-signature "${binPath}"`, { stdio: "pipe" });
    } catch {
      /* OK */
    }
    try {
      execSync(`codesign --sign - "${binPath}"`, { stdio: "pipe" });
      console.log("[sea] Ad-hoc signed macOS binary.");
    } catch (e) {
      console.warn("[sea] WARNING: ad-hoc signing failed:", e.message);
    }
  }

  if (platform !== "win32") {
    chmodSync(binPath, 0o755);
    console.log("[sea] chmod +x applied.");
  }

  seaSuccess = true;
} catch (e) {
  console.warn(`[sea] ⚠️  SEA injection failed: ${e.message}`);
  console.warn("[sea] Postject may not support this Node binary on this platform.");
  console.warn("[sea] Falling back to launcher-based package.");
}

// ── Step 4: Fallback — launcher-based package ────────────────────
if (!seaSuccess) {
  // Remove the copied Node binary (not needed for fallback)
  try {
    execSync(platform === "win32" ? `del "${binPath}"` : `rm -f "${binPath}"`, { stdio: "pipe" });
  } catch {
    /* OK */
  }

  // Use dist/cli.js (the working ESM bundle with external packages) as fallback
  const distBundle = resolve(root, "dist", "cli.js");
  const launcherBin = platform === "win32" ? resolve(BIN_DIR, "dscode.cmd") : resolve(BIN_DIR, "dscode");
  const bundleDest = resolve(BIN_DIR, "dscode.js");

  if (!existsSync(distBundle)) {
    console.error("[sea] ERROR: dist/cli.js not found. Run build first.");
    process.exit(1);
  }

  copyFileSync(distBundle, bundleDest);

  if (platform === "win32") {
    writeFileSync(launcherBin, `@echo off\r\nnode "%~dp0\\dscode.js" %*\r\n`, "utf8");
  } else {
    writeFileSync(
      launcherBin,
      "#!/usr/bin/env bash\n" +
        'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\n' +
        'exec node "$DIR/dscode.js" "$@"\n',
      "utf8"
    );
    chmodSync(launcherBin, 0o755);
  }

  console.log(`[sea] Fallback launcher created → ${launcherBin}`);
  console.log(`[sea] Bundle copied → ${bundleDest}`);
}

// ── Report ───────────────────────────────────────────────────────
const finalBin = existsSync(binPath) ? binPath : resolve(BIN_DIR, platform === "win32" ? "dscode.cmd" : "dscode");
const method = seaSuccess ? "SEA (standalone)" : "launcher (requires Node.js)";

console.log(`\n[sea] Done:`);
console.log(`  Method:   ${method}`);
console.log(`  Platform: ${platform} ${arch}`);
console.log(`  Binary:   ${finalBin}`);
if (existsSync(finalBin)) {
  console.log(`  Size:     ${(readFileSync(finalBin).length / 1024).toFixed(1)} KB`);
}
