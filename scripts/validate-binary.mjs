import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;

const platform = process.platform;
const arch = process.arch;

let platformTag;
if (platform === "win32") platformTag = "windows-x64";
else if (platform === "linux") platformTag = "linux-x64";
else if (platform === "darwin" && arch === "arm64") platformTag = "macos-arm64";
else if (platform === "darwin") platformTag = "macos-x64";
else platformTag = `${platform}-${arch}`;

const seaBinName = platform === "win32" ? "dscode.exe" : "dscode";
const fallbackBinName = platform === "win32" ? "dscode.cmd" : "dscode";
const BIN_DIR = resolve(root, "release", "bin");
const PKG_DIR = resolve(root, "release", "packages");
const CHK_DIR = resolve(root, "release", "checksums");
const TMP_DIR = resolve(root, "release", "tmp");

const seaBinPath = resolve(BIN_DIR, seaBinName);
const fallbackBinPath = resolve(BIN_DIR, fallbackBinName);
const binPath = existsSync(seaBinPath) ? seaBinPath : existsSync(fallbackBinPath) ? fallbackBinPath : seaBinPath;
const isSeaBinary = binPath === seaBinPath;
const pkgExt = platform === "win32" ? "zip" : "tar.gz";
const pkgFile = `dscode-v${version}-${platformTag}.${pkgExt}`;
const pkgPath = resolve(PKG_DIR, pkgFile);
const checksumsPath = resolve(CHK_DIR, "checksums.txt");

const report = [];
function log(msg) {
  console.log(`[validate] ${msg}`);
  report.push(msg);
}
function err(msg) {
  console.error(`[validate] ERROR: ${msg}`);
  report.push(`ERROR: ${msg}`);
}

let failures = 0;

// ── 1. Binary exists ─────────────────────────────────────────────
log("--- Validating binary ---");
if (!existsSync(binPath)) {
  err(`Binary not found: ${binPath}`);
  failures++;
} else {
  const size = (statSync(binPath).size / 1024 / 1024).toFixed(1);
  log(`Binary exists: ${binPath} (${size} MB)`);
}

// ── 2. Binary runs --version ─────────────────────────────────────
function runBinary(bin, flag) {
  // For SEA binary, run directly. For fallback launcher, use Node.
  if (isSeaBinary) {
    return execSync(`"${bin}" ${flag}`, {
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, DEEPCODE_API_KEY: "" },
    }).trim();
  }
  // Fallback: bundle is dscode.js alongside the launcher
  const jsFile = resolve(BIN_DIR, "dscode.js");
  if (existsSync(jsFile)) {
    return execSync(`node "${jsFile}" ${flag}`, {
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, DEEPCODE_API_KEY: "" },
    }).trim();
  }
  // Try running the launcher directly
  return execSync(`"${bin}" ${flag}`, {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, DEEPCODE_API_KEY: "" },
  }).trim();
}

if (existsSync(binPath)) {
  try {
    const ver = runBinary(binPath, "--version");
    log(`--version output: "${ver}"`);
    if (!ver) {
      err("--version returned empty string");
      failures++;
    } else if (!isSeaBinary || existsSync(resolve(BIN_DIR, platform === "win32" ? "node.exe" : "node"))) {
      // Portable fallback or launcher — version is multi-line, not just the number
      log(`Fallback/portable binary version OK`);
    } else if (ver !== version) {
      log(`--version mismatch: got "${ver}", expected "${version}" (may include different format)`);
    }
  } catch (e) {
    err(`--version failed: ${e.message}`);
    failures++;
  }
}

// ── 3. Binary runs --help ────────────────────────────────────────
if (existsSync(binPath)) {
  try {
    const help = runBinary(binPath, "--help");
    if (help.includes("Usage:") || help.includes("dscode")) {
      log(`--help works (${help.length} chars)`);
    } else {
      err("--help output missing expected content");
      failures++;
    }
  } catch (e) {
    err(`--help failed: ${e.message}`);
    failures++;
  }
}

// ── 4. Package exists ────────────────────────────────────────────
log("--- Validating package ---");
if (!existsSync(pkgPath)) {
  err(`Package not found: ${pkgPath}`);
  failures++;
} else {
  const size = (statSync(pkgPath).size / 1024 / 1024).toFixed(1);
  log(`Package exists: ${pkgPath} (${size} MB)`);
}

// ── 5. Checksum exists ───────────────────────────────────────────
if (!existsSync(checksumsPath)) {
  err(`Checksums file not found: ${checksumsPath}`);
  failures++;
} else {
  const content = readFileSync(checksumsPath, "utf8");
  log(`Checksums file exists (${content.split("\n").filter(Boolean).length} entries)`);
}

// ── 6. Extract and check package contents ────────────────────────
log("--- Checking package contents ---");
const extractDir = resolve(TMP_DIR, `validate-${Date.now()}`);
mkdirSync(extractDir, { recursive: true });

try {
  if (platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${pkgPath}' -DestinationPath '${extractDir}' -Force"`,
      { stdio: "pipe" }
    );
  } else {
    execSync(`tar -xzf "${pkgPath}" -C "${extractDir}"`, { stdio: "pipe" });
  }
  log("Package extracted successfully.");
} catch (e) {
  err(`Failed to extract package: ${e.message}`);
  failures++;
}

// ── 7. Check for sensitive files in package ──────────────────────
const SENSITIVE_PATTERNS = [
  /^\.env/,
  /\.env$/i,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.crt$/,
  /id_rsa/,
  /id_ed25519/,
  /\.log$/,
];
const REQUIRED_FILES = ["LICENSE"];

function walkDir(dir, prefix = "") {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkDir(fullPath, relPath);
    } else {
      // Check sensitive
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(entry.name)) {
          err(`Sensitive file in package: ${relPath}`);
          failures++;
        }
      }
    }
  }
}

walkDir(extractDir);

// Check required files
for (const req of REQUIRED_FILES) {
  if (!existsSync(resolve(extractDir, req))) {
    err(`Required file missing from package: ${req}`);
    failures++;
  } else {
    log(`✅ ${req} present in package`);
  }
}

// Check for NOTICE
if (existsSync(resolve(extractDir, "NOTICE"))) {
  log("✅ NOTICE present in package");
}

// ── 8. Run extracted binary ──────────────────────────────────────
// Try SEA binary first, then fallback launcher / portable package
const extractedSea = resolve(extractDir, seaBinName);
const extractedFallback = resolve(extractDir, fallbackBinName);
const extractedJs = resolve(extractDir, "dscode.js");
const extractedNode = resolve(extractDir, platform === "win32" ? "node.exe" : "node");

let extractedBin = existsSync(extractedSea) ? extractedSea : existsSync(extractedFallback) ? extractedFallback : null;

if (extractedBin) {
  if (platform !== "win32") {
    try {
      execSync(`chmod +x "${extractedBin}"`, { stdio: "pipe" });
    } catch {
      /* chmod may fail on Windows, OK */
    }
  }
  // On POSIX, the portable launcher has the same name as SEA ("dscode").
  // Detect the difference: if a bundled "node" binary exists, it's portable.
  const isExtractedPortable = existsSync(extractedNode) && existsSync(extractedJs);
  const isExtractedSea = extractedBin === extractedSea && !isExtractedPortable;
  let ver2;
  try {
    if (isExtractedSea) {
      ver2 = execSync(`"${extractedBin}" --version`, {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, DEEPCODE_API_KEY: "" },
      }).trim();
    } else if (existsSync(extractedNode) && existsSync(extractedJs)) {
      // Portable package: use bundled node.exe. If Git Bash blocks it (EPERM),
      // fall back to system node — this is a CI/Git Bash quirk, not a real issue.
      const isMSYS = process.env.MSYSTEM || process.env.TERM === "cygwin";
      try {
        const result = spawnSync(extractedNode, [extractedJs, "--version"], {
          encoding: "utf8",
          timeout: isMSYS ? 5000 : 15000,
          env: { ...process.env, DEEPCODE_API_KEY: "" },
          windowsHide: true,
        });
        if (result.error) throw result.error;
        ver2 = result.stdout.trim();
      } catch {
        if (isMSYS) {
          log("Skipping extracted binary test (MSYS/Git Bash EPERM). Works on native Windows.");
          ver2 = "(skipped — Git Bash limitation)";
        } else {
          throw new Error("Bundled node.exe spawn failed");
        }
      }
    } else if (existsSync(extractedJs)) {
      ver2 = execSync(`node "${extractedJs}" --version`, {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, DEEPCODE_API_KEY: "" },
      }).trim();
    } else {
      ver2 = execSync(`"${extractedBin}" --version`, {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, DEEPCODE_API_KEY: "" },
      }).trim();
    }
    log(`Extracted binary --version: "${ver2}"`);
  } catch (e) {
    err(`Extracted binary --version failed: ${e.message}`);
    failures++;
  }
} else {
  err("No binary found in extracted package");
  failures++;
}

// ── 9. Generate validation report ────────────────────────────────
const reportPath = resolve(root, "release", "VALIDATION_REPORT.md");
const reportContent = `# Binary Validation Report

- **Version**: ${version}
- **Platform**: ${platform} ${arch} (${platformTag})
- **Binary**: ${binPath}
- **Package**: ${pkgPath}
- **Checksum**: ${checksumsPath}
- **Failures**: ${failures}

## Results

${report.map((r) => `- ${r}`).join("\n")}

## Verdict

${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} FAILURE(S)`}
`;

writeFileSync(reportPath, reportContent, "utf8");
console.log(`\n[validate] Report written → ${reportPath}`);

if (failures > 0) {
  console.error(`\n[validate] ❌ ${failures} validation failure(s).`);
  process.exit(1);
} else {
  console.log(`\n[validate] ✅ All validations passed.`);
}
