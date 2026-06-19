import { readFileSync, writeFileSync, copyFileSync, mkdirSync, chmodSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const platform = process.platform;
const arch = process.arch;
const isWindows = platform === "win32";

const BUNDLE_FILE = resolve(root, "release", "bundle", "dscode.mjs");
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

// ── Helpers ──────────────────────────────────────────────────────

// Future: Node 25.5+ supports --build-sea natively, removing the need for postject.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function supportsBuildSea() {
  const major = Number(process.versions.node.split(".")[0]);
  const minor = Number(process.versions.node.split(".")[1]);
  return major > 25 || (major === 25 && minor >= 5);
}

function buildSeaBlob() {
  const seaConfig = {
    main: BUNDLE_FILE,
    output: BLOB_FILE,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  };
  writeFileSync(SEA_CONFIG, JSON.stringify(seaConfig, null, 2));
  console.log(`[sea] SEA config written → ${SEA_CONFIG}`);
  console.log(`[sea] Generating blob...`);
  execSync(`node --experimental-sea-config "${SEA_CONFIG}"`, { stdio: "inherit", cwd: root });
  console.log(`[sea] Blob generated → ${BLOB_FILE}`);
}

function stripWindowsSignature(binPath) {
  const signtoolPaths = [
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.19041.0\\x64\\signtool.exe",
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe",
  ];
  for (const p of signtoolPaths) {
    if (existsSync(p)) {
      try {
        execSync(`"${p}" remove /s "${binPath}"`, { stdio: "pipe" });
        console.log("[sea] Stripped digital signature.");
        return;
      } catch {
        /* try next path */
      }
    }
  }
  console.warn("[sea] WARNING: Could not strip digital signature (signtool not found).");
}

function injectBlob(binPath) {
  console.log(`[sea] Injecting blob with postject...`);
  execSync(`npx postject "${binPath}" NODE_SEA_BLOB "${BLOB_FILE}"`, { stdio: "pipe", cwd: root });
  console.log(`[sea] ✅ SEA injection successful.`);
}

function signMacOS(binPath) {
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

function buildSEA() {
  buildSeaBlob();

  const binName = isWindows ? "dscode.exe" : "dscode";
  const binPath = resolve(BIN_DIR, binName);

  copyFileSync(NODE_BIN, binPath);
  console.log(`[sea] Node binary copied → ${binPath}`);

  if (isWindows) {
    stripWindowsSignature(binPath);
  }

  injectBlob(binPath);

  if (platform === "darwin") {
    signMacOS(binPath);
  }

  if (!isWindows) {
    chmodSync(binPath, 0o755);
    console.log("[sea] chmod +x applied.");
  }

  return { binPath, binName, method: "SEA (standalone)" };
}

// ── Cross-Platform Portable Fallback ─────────────────────────────

function buildPortable() {
  console.log("[sea] Building portable package...");

  const portableDir = resolve(BIN_DIR);
  const toClean = isWindows ? ["dscode.exe", "dscode.cmd", "dscode.mjs", "node.exe"] : ["dscode", "dscode.mjs", "node"];
  for (const f of toClean) {
    const fp = resolve(portableDir, f);
    if (existsSync(fp)) {
      try {
        rmSync(fp);
      } catch {
        /* OK */
      }
    }
  }

  const nodeDest = isWindows ? "node.exe" : "node";
  copyFileSync(NODE_BIN, resolve(portableDir, nodeDest));
  console.log(`[sea] ${nodeDest} copied.`);

  // Use the fully-bundled ESM file (external: tesseract.js) — self-contained, node_modules/tesseract.js copied above.
  if (!existsSync(BUNDLE_FILE)) {
    console.error("[sea] ERROR: Bundle not found. Run build:bundle first.");
    process.exit(1);
  }
  copyFileSync(BUNDLE_FILE, resolve(portableDir, "dscode.mjs"));
  console.log("[sea] dscode.mjs copied.");

  // Copy templates/ so getExtensionRoot() finds them at runtime.
  const templatesSrc = resolve(root, "templates");
  const templatesDest = resolve(portableDir, "templates");
  if (existsSync(templatesDest)) rmSync(templatesDest, { recursive: true, force: true });
  execSync(
    isWindows ? `xcopy /E /I /Q "${templatesSrc}" "${templatesDest}"` : `cp -r "${templatesSrc}" "${templatesDest}"`,
    { stdio: "pipe" }
  );
  console.log("[sea] templates/ copied.");

  // Copy tesseract.js (external in the bundle — needed for OCR).
  const tesseractSrc = resolve(root, "node_modules", "tesseract.js");
  const tesseractDest = resolve(portableDir, "node_modules", "tesseract.js");
  if (existsSync(tesseractDest)) rmSync(tesseractDest, { recursive: true, force: true });
  mkdirSync(resolve(portableDir, "node_modules"), { recursive: true });
  execSync(
    isWindows ? `xcopy /E /I /Q "${tesseractSrc}" "${tesseractDest}"` : `cp -r "${tesseractSrc}" "${tesseractDest}"`,
    { stdio: "pipe" }
  );
  console.log("[sea] node_modules/tesseract.js copied.");

  if (isWindows) {
    const cmdPath = resolve(portableDir, "dscode.cmd");
    const cmdContent = [
      "@echo off",
      "setlocal",
      'set "DSCODE_HOME=%~dp0"',
      '"%DSCODE_HOME%node.exe" "%DSCODE_HOME%dscode.mjs" %*',
      "exit /b %ERRORLEVEL%",
      "",
    ].join("\r\n");
    writeFileSync(cmdPath, cmdContent, "utf8");
    console.log("[sea] dscode.cmd created.");

    return { binPath: cmdPath, binName: "dscode.cmd", method: "portable" };
  }

  const launcherPath = resolve(portableDir, "dscode");
  const launcherContent = [
    "#!/usr/bin/env bash",
    'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'exec "$DIR/node" "$DIR/dscode.mjs" "$@"',
    "",
  ].join("\n");
  writeFileSync(launcherPath, launcherContent, "utf8");
  chmodSync(launcherPath, 0o755);
  console.log("[sea] dscode launcher created (chmod +x).");

  return { binPath: launcherPath, binName: "dscode", method: "portable" };
}

function validatePortablePackage() {
  console.log("[sea] Validating portable package...");
  const cmdPath = resolve(BIN_DIR, "dscode.cmd");
  if (!existsSync(cmdPath)) throw new Error("dscode.cmd not found");
  try {
    const ver = execSync(`"${cmdPath}" --version`, {
      cwd: BIN_DIR,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, DSCODE_NO_CHECK: "1" },
    });
    console.log(`[sea] --version: ${ver.trim()}`);
  } catch (e) {
    throw new Error(`Portable validation failed (--version): ${e.message}`, { cause: e });
  }
  try {
    execSync(`"${cmdPath}" --help`, {
      cwd: BIN_DIR,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, DSCODE_NO_CHECK: "1" },
    });
    console.log("[sea] --help: OK");
  } catch (e) {
    throw new Error(`Portable validation failed (--help): ${e.message}`, { cause: e });
  }
  console.log("[sea] ✅ Portable package validated.");
}

function validatePosixPortable() {
  console.log("[sea] Validating portable package...");
  const launcherPath = resolve(BIN_DIR, "dscode");
  if (!existsSync(launcherPath)) throw new Error("dscode not found");
  try {
    const ver = execSync(`"${launcherPath}" --version`, {
      cwd: BIN_DIR,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, DSCODE_NO_CHECK: "1" },
    });
    console.log(`[sea] --version: ${ver.trim()}`);
  } catch (e) {
    throw new Error(`Portable validation failed (--version): ${e.message}`, { cause: e });
  }
  try {
    execSync(`"${launcherPath}" --help`, {
      cwd: BIN_DIR,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, DSCODE_NO_CHECK: "1" },
    });
    console.log("[sea] --help: OK");
  } catch (e) {
    throw new Error(`Portable validation failed (--help): ${e.message}`, { cause: e });
  }
  console.log("[sea] ✅ Portable package validated.");
}

// ── Main ─────────────────────────────────────────────────────────

console.log(`[sea] Node ${process.version} — ${platform} ${arch}`);

let result;

try {
  result = buildSEA();
} catch (seaError) {
  const errMsg = seaError instanceof Error ? seaError.message : String(seaError);
  console.warn(`[sea] ⚠️  SEA build failed: ${errMsg}`);
  console.warn("[sea] Postject may not support this Node binary on this platform.");
  console.warn("[sea] Falling back to portable package.");

  try {
    result = buildPortable();
    if (isWindows) {
      validatePortablePackage();
    } else {
      validatePosixPortable();
    }
  } catch (portableError) {
    const pMsg = portableError instanceof Error ? portableError.message : String(portableError);
    console.error(`[sea] Portable build also failed: ${pMsg}`);
    process.exit(1);
  }
}

// ── Report ───────────────────────────────────────────────────────
console.log(`\n[sea] Done:`);
console.log(`  Method:   ${result.method}`);
console.log(`  Platform: ${platform} ${arch}`);
console.log(`  Binary:   ${result.binPath}`);
try {
  const size = readFileSync(result.binPath).length / 1024;
  console.log(`  Size:     ${size.toFixed(1)} KB`);
} catch {
  /* OK */
}
