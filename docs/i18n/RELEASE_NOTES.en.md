## ⚡ V40: Performance-First Execution — 4 specs, zero regressions

Surgical optimization of I/O, CPU, and memory across 4 fronts. Result: faster sessions, lighter startup, leaner history.

### Session I/O (spec 420)
- **Incremental writes**: `appendFileSync` instead of rewriting the entire messages file
- **Sessions index cache**: `_cachedSessionsIndex` in memory — `loadSessionsIndex()` was called 6× per turn reading from disk
- **Directory guard**: `_projectDirEnsured` avoids unnecessary `mkdirSync`
- **String buffers**: `push` + `join` in streaming loops instead of `+=` (reallocation per chunk)

### Startup (spec 430)
- **Parallel skills**: `Promise.all` + `fs/promises` — simultaneous loading, zero sequential `readFileSync`
- **Cached templates**: Prompt templates (`templates/tools/*.md`, `templates/skills/*.md`) in immutable cache — no longer re-read from disk every turn

### Compaction & memory (spec 440)
- **Incremental hash**: `findStablePrefixEndIndex()` uses a single incremental SHA-256 instance — O(N) instead of O(N²)
- **Parallel turns**: `readRecentTurns()` decompresses files in parallel with `Promise.all`
- **Async backup**: `backupSpecFile()` uses `fs/promises.copyFile` — zero blocking

### Hardening (spec 450)
- **Limited concurrency**: `readRecentTurns` processes in batches of 8 with early termination — no wasted I/O
- **Mtime invalidation**: Sessions index cache checks `mtimeMs` — safe for multi-terminal use
- **ENOENT recovery**: `ensureProjectDir` resets the flag if `.dscode/` is deleted during a session
- **ESLint `no-floating-promises`**: Active rule — 5 violations fixed with `void`

---

## 🐛 PDF: Context Budget Fix (spec 460)

- **PDFs with compressed ObjStm**: `countPdfPages` returns `null` (not `0`) when regex heuristic fails. Large PDFs are no longer embedded as base64 in context — preventing overflow of the 1M token window.

---

## 🚀 Node.js 24 Native API Optimizations

- **Grep handler**: native `fs.globSync`, async parallel reads, streaming — **-143 lines, -1 dependency**
- **Glob handler**: Custom walker replaced by `fs.globSync` — **-51 lines**

---

## 🔧 Fixes

- **`cacheMode` in Zod schema**: Settings with `cacheMode` are no longer rejected as invalid
- **`/spec-pipe`**: Auto-creates session when none is active
- **FD leaks**: File descriptors closed in grep binary detection catch block and MCP client disconnect
- **Unused variable**: `unusedInBinaryDetection` regex removed from grep handler

---

## 📋 Documentation & infra

- **5 steering rules** in `AGENTS.md`: authorization, cross-check, verification, consequence, output
- **V39 and V40** documented in `vision.md`
- **Node 26 notice** on welcome screen: "Starting October 2026, DsCode will require Node.js 26."
- **Release notes** now use `RELEASE_NOTES.md` (not `--generate-notes`)

---

## 🚀 Node.js 24 — All-in

Complete migration to Node 24 as baseline. Zero compatibility with older versions.

### Native APIs replacing dependencies
- **`fs.globSync`** native replaces `glob` npm package — **-4 dependencies**
- **`node:zstd`** native replaces Brotli fallback from `node:zlib` — 4× smaller compressor
- **`Error.isError()`** → `getErrorMessage()` function cross-realm safe in 21 files
- **`structuredClone`** native — deep clone from 8 lines to 1
- **`esbuild` target `node24`** — no polyfills for Node 22
- **CI on Node 24** — build and test on real runtime

---

## 🍎 macOS Apple Silicon in automatic releases

- macOS ARM64 (`macos-latest`) now builds automatically on every tag push
- macOS Intel (`macos-13`) removed — GitHub deprecated runner, no queue wait
- Dry-run covers Windows, Linux, and macOS ARM64
- Checksum download fixed (root cause of `400 Bad Content-Length` error in v1.0.41)

---

## 🔄 Robust Auto-Update

- 100% aligned asset naming between CI and `update-check.ts`
- Portable packages (fallback when SEA fails) now copy **all** companion files: `dscode.mjs`, `node`, `templates/`, `node_modules/`
- File extraction and atomic binary replacement on all platforms

---

## 🖼️ Local OCR with Tesseract.js

- Offline OCR via `tesseract.js` for models without image support (e.g., DeepSeek V4)
- **Dynamic import** — `tesseract.js` only loads when OCR is actually used, zero startup impact
- All 12 transitive dependencies bundled in the portable package
- Extracted text truncated at 2000 characters (word boundary)
- `/image-paste` and `/image-upload` with automatic OCR fallback
- File drag-and-drop via terminal paste

---

## 🐛 Fixes

- **v1.0.41**: `400 Bad Content-Length` error on publish — checksums were not downloaded
- **v1.0.42/43**: macOS Intel stuck releases due to missing runner — removed from pipeline
- **Auto-update**: Portable packages broke on update — now copies companion files
- **Bundle**: Silent build failure — now `exit(1)` and CI detects it
- **OCR startup**: `regenerator-runtime` not found at startup — `tesseract.js` loaded on demand
- **Ink ErrorBanner error**, context window overflow, spec suffixes

---

## 📐 Specifications & build

- Specs 370-410: build validation, operational resilience, traceability, auto-update
- `validate-binary.mjs` uses tag version (not package.json)
- `release-dry-run.yml` covers 3 platforms
- README URL validation in CI
