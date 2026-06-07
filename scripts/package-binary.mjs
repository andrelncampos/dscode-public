import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  readdirSync, copyFileSync
} from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;

const platform = process.platform;
const arch = process.arch;

const BIN_DIR = resolve(root, "release", "bin");
const PKG_DIR = resolve(root, "release", "packages");
const CHK_DIR = resolve(root, "release", "checksums");
const TMP_DIR = resolve(root, "release", "tmp");

// Determine platform tag
let platformTag;
if (platform === "win32") platformTag = "windows-x64";
else if (platform === "linux") platformTag = "linux-x64";
else if (platform === "darwin" && arch === "arm64") platformTag = "macos-arm64";
else if (platform === "darwin") platformTag = "macos-x64";
else {
  console.error(`[package] Unsupported platform: ${platform} ${arch}`);
  process.exit(1);
}

const binName = platform === "win32" ? "dscode.exe" : "dscode";
const binPath = resolve(BIN_DIR, binName);

// Look for either SEA binary or launcher-based fallback
const altBin = platform === "win32"
  ? resolve(BIN_DIR, "dscode.cmd")
  : resolve(BIN_DIR, "dscode");
const actualBin = existsSync(binPath) ? binPath
  : existsSync(altBin) ? altBin : null;

if (!actualBin) {
  console.error(`[package] ERROR: No binary found in ${BIN_DIR}. Run build:binary first.`);
  process.exit(1);
}

console.log(`[package] Using: ${actualBin}`);

// ── Sensitive file blacklist ─────────────────────────────────────
const SENSITIVE_PATTERNS = [
  /\.env$/i, /\.env\./i,
  /\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/, /\.crt$/,
  /id_rsa/, /id_ed25519/,
  /\.log$/,
  /node_modules\//,
  /\.git\//,
  /data\//,
  /release\/tmp\//,
  /coverage\//,
];

// ── Create package ────────────────────────────────────────────────
mkdirSync(PKG_DIR, { recursive: true });
mkdirSync(CHK_DIR, { recursive: true });

const pkgName = `dscode-v${version}-${platformTag}`;
const pkgExt = platform === "win32" ? "zip" : "tar.gz";
const pkgFile = `${pkgName}.${pkgExt}`;
const pkgPath = resolve(PKG_DIR, pkgFile);

// Files to include in the package
const LIC_FILE = resolve(root, "LICENSE");
const NOTICE_FILE = resolve(root, "NOTICE");
const README_FILE = resolve(root, "README.md");

// Include all files from bin/ directory (SEA binary or launcher + bundle)
const binEntries = readdirSync(BIN_DIR);
const binFiles = binEntries.map(f => resolve(BIN_DIR, f));

const filesToPack = [...binFiles];
if (existsSync(LIC_FILE)) filesToPack.push(LIC_FILE);
if (existsSync(NOTICE_FILE)) filesToPack.push(NOTICE_FILE);
if (existsSync(README_FILE)) filesToPack.push(README_FILE);

console.log(`[package] Files to pack: ${filesToPack.map(f => basename(f)).join(", ")}`);

// Validate no sensitive files
for (const f of filesToPack) {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(basename(f))) {
      console.error(`[package] ERROR: Sensitive file detected in package: ${f}`);
      process.exit(1);
    }
  }
}

// Create the archive
const tmpPkgDir = resolve(TMP_DIR, pkgName);
if (existsSync(tmpPkgDir)) {
  execSync(platform === "win32" ? `rmdir /s /q "${tmpPkgDir}"` : `rm -rf "${tmpPkgDir}"`, { stdio: "pipe" });
}
mkdirSync(tmpPkgDir, { recursive: true });

for (const f of filesToPack) {
  const dest = resolve(tmpPkgDir, basename(f));
  if (f !== dest) {
    copyFileSync(f, dest);
  }
}

console.log(`[package] Creating ${pkgExt} archive: ${pkgFile}...`);

if (platform === "win32") {
  // Use PowerShell to create zip
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${tmpPkgDir}\\*' -DestinationPath '${pkgPath}' -Force"`,
    { stdio: "inherit" }
  );
} else {
  execSync(
    `tar -czf "${pkgPath}" -C "${tmpPkgDir}" .`,
    { stdio: "inherit" }
  );
}

console.log(`[package] Package created → ${pkgPath}`);

// ── Generate SHA256 checksum ─────────────────────────────────────
function sha256File(filePath) {
  const hash = createHash("sha256");
  const data = readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

const pkgHash = sha256File(pkgPath);
const checksumsFile = resolve(CHK_DIR, "checksums.txt");
const checksumLine = `${pkgHash}  ${pkgFile}\n`;
writeFileSync(checksumsFile, checksumLine, "utf8");
console.log(`[package] Checksum: ${pkgHash}`);
console.log(`[package] Checksums file → ${checksumsFile}`);

// ── Report ───────────────────────────────────────────────────────
const pkgSize = (readFileSync(pkgPath).length / 1024 / 1024).toFixed(1);
console.log(`\n[package] ✅ Package ready:`);
console.log(`  Package:  ${pkgPath} (${pkgSize} MB)`);
console.log(`  Checksum: ${pkgHash}`);
