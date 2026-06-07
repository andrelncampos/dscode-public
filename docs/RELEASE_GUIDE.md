# Release Guide — Manual Process

This guide describes how to create and publish a release manually. The `release.yml` workflow can automate parts of this, but a manual process is documented here as a fallback and reference.

## Prerequisites

- Push access to the repository
- Node.js 22+ installed locally
- Git configured with GPG signing (recommended for tags)

## Step by step

### 1. Ensure everything passes locally

```bash
cd /path/to/dscode
npm ci
npm run check     # typecheck + lint + format:check
npm test         # all tests (fast + heavy)
npm run build    # generates dist/cli.js
```

If any step fails, fix it before creating a release.

### 2. Update version (if needed)

Edit the `version` field in `package.json`. Follow [Semantic Versioning](https://semver.org/):

- `patch` (1.0.1 → 1.0.2): bug fixes
- `minor` (1.0.1 → 1.1.0): new features, backward-compatible
- `major` (1.0.1 → 2.0.0): breaking changes

Also update `package-lock.json`:

```bash
npm install
```

Commit the version bump:

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to x.y.z"
```

### 3. Create a signed tag

```bash
git tag -s v1.0.1 -m "v1.0.1"
git push origin v1.0.1
```

### 4. Build platform packages

The release artifacts contain the bundled CLI (`dist/cli.js`) plus platform-specific launcher scripts.

#### Build the bundled JS

```bash
npm run bundle
```

This creates `dist/cli.js`.

#### Create platform launcher scripts

**Windows launcher** (`scripts/launchers/dscode.cmd`):

```cmd
@echo off
node "%~dp0\cli.js" %*
```

**Unix launcher** (`scripts/launchers/dscode`):

```bash
#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/cli.js" "$@"
```

Make the Unix launcher executable:

```bash
chmod +x scripts/launchers/dscode
```

#### Create release archives

```bash
mkdir -p release-artifacts

# Windows x64
cp dist/cli.js scripts/launchers/dscode.cmd LICENSE NOTICE README.md /tmp/dscode-pkg/
cd /tmp/dscode-pkg && zip -r /path/to/release-artifacts/dscode-windows-x64.zip ./*

# Linux x64
cp dist/cli.js scripts/launchers/dscode LICENSE NOTICE README.md /tmp/dscode-pkg/
cd /tmp/dscode-pkg && tar -czf /path/to/release-artifacts/dscode-linux-x64.tar.gz ./*

# macOS x64 (same binary as Linux, but separate archive for clarity)
cp dist/cli.js scripts/launchers/dscode LICENSE NOTICE README.md /tmp/dscode-pkg/
cd /tmp/dscode-pkg && tar -czf /path/to/release-artifacts/dscode-macos-x64.tar.gz ./*

# macOS ARM64 (same binary, separate archive)
cp dist/cli.js scripts/launchers/dscode LICENSE NOTICE README.md /tmp/dscode-pkg/
cd /tmp/dscode-pkg && tar -czf /path/to/release-artifacts/dscode-macos-arm64.tar.gz ./*
```

### 5. Generate checksums

```bash
cd release-artifacts
sha256sum * > checksums.txt
# On macOS: shasum -a 256 * > checksums.txt
# On Windows PowerShell: Get-FileHash * -Algorithm SHA256 | Format-Table -AutoSize
```

### 6. Create GitHub Release

1. Go to [GitHub Releases](https://github.com/andrelncampos/dscode/releases).
2. Click "Draft a new release".
3. Choose the tag you created (e.g., `v1.0.1`).
4. Title: `v1.0.1`
5. Description: copy from CHANGELOG or write a summary of changes.
6. Upload all files from `release-artifacts/` plus `checksums.txt`.
7. Check "Set as the latest release" (for stable) or "Set as a pre-release" (for alpha/beta/rc).
8. Click "Publish release".

### 7. Publish to npm (optional, requires npm account)

```bash
npm publish --access public
```

> ⚠️ Only publish if the release is stable and you have npm credentials configured.

### 8. Verify the release

1. Download a release artifact from the GitHub Release page.
2. Verify the checksum.
3. Extract and run `dscode --version` from a different machine or VM.
4. Test basic functionality: `dscode -h`, `dscode --version`.

## Automated release workflow

The CI workflow `.github/workflows/release.yml` automates steps 4-6 (building and uploading artifacts to GitHub Releases). It triggers on version tags (`v*`).

The workflow does NOT publish to npm automatically. npm publication remains a manual decision.

## Platform note

The distributed "binaries" are actually Node.js bundles (dist/cli.js) packaged with launcher scripts. This means the user still needs **Node.js 22+** installed on their system to run DsCode from release archives. The npm global install handles this automatically.
