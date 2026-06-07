# How to install and verify releases

## Choosing the right file

Each release on the [GitHub Releases](https://github.com/andrelncampos/dscode/releases) page includes multiple archive files. Pick the one that matches your system:

| File | Operating System | Architecture |
|---|---|---|
| `dscode-windows-x64.zip` | Windows 10/11 | x86-64 (Intel/AMD) |
| `dscode-linux-x64.tar.gz` | Linux | x86-64 (Intel/AMD) |
| `dscode-macos-x64.tar.gz` | macOS | Intel x86-64 |
| `dscode-macos-arm64.tar.gz` | macOS | Apple Silicon (M1/M2/M3/M4) |

Not sure what you have?

- **Windows**: Press `Win + Pause` → look for "System type" → "64-bit"
- **Linux**: Run `uname -m` → `x86_64` means Intel/AMD
- **macOS**: Click  → "About This Mac" → "Chip" shows `Apple M...` or "Processor" shows `Intel`

## Verifying the download

Each release includes a `checksums.txt` file. To verify your download:

### Windows (PowerShell)

```powershell
Get-FileHash dscode-windows-x64.zip -Algorithm SHA256
# Compare the output with checksums.txt
```

### Linux / macOS

```bash
shasum -a 256 dscode-linux-x64.tar.gz
# or
sha256sum dscode-linux-x64.tar.gz
# Compare the output with checksums.txt
```

## Installing from a release archive

### Windows

1. Extract `dscode-windows-x64.zip` to a folder (e.g., `C:\dscode`).
2. Add the folder to your PATH:
   - Search "Environment Variables" in Windows
   - Edit `Path` (User or System)
   - Add `C:\dscode`
3. Open a new terminal and run:

   ```powershell
   dscode --version
   ```

### Linux / macOS

1. Extract:

   ```bash
   tar -xzf dscode-linux-x64.tar.gz
   ```

   (Replace with your actual file name.)

2. Make executable (if needed):

   ```bash
   chmod +x dscode
   ```

3. Move to a directory in PATH:

   ```bash
   sudo mv dscode /usr/local/bin/
   ```

4. Verify:

   ```bash
   dscode --version
   ```

## Upgrading to a new version

### npm (recommended for npm users)

```bash
npm update -g @andrelncampos/dscode
```

### Release archives

Download the new version from [Releases](https://github.com/andrelncampos/dscode/releases) and replace the old files.

## Uninstalling

### npm

```bash
npm uninstall -g @andrelncampos/dscode
```

### Release archives

Delete the extracted folder and remove it from PATH.

- **Windows**: Remove the folder from PATH via System Settings and delete the folder.
- **Linux/macOS**: `sudo rm /usr/local/bin/dscode` and delete any remaining extracted files.

## Release types

- **Stable releases**: Tagged versions (e.g., `v1.0.1`). Safe for production use.
- **Pre-releases**: Tagged as `-alpha`, `-beta`, or `-rc`. For testing only.

## Confirming official channels

Official releases are published **only** on:

- [GitHub Releases](https://github.com/andrelncampos/dscode/releases)
- [npm registry](https://www.npmjs.com/package/@andrelncampos/dscode)

If you find DsCode distributed through other channels, assume it is unofficial and potentially unsafe.
