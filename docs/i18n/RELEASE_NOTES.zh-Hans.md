## ⚡ V40: Performance-First Execution — 4 specs, zero regressions

在 I/O、CPU 和内存方面进行精准优化，覆盖 4 个方面。结果：更快的会话、更轻量的启动、更精简的历史记录。

### Session I/O (spec 420)
- **增量写入**: `appendFileSync` 替代重写整个消息文件
- **会话索引缓存**: `_cachedSessionsIndex` 存在于内存中 — `loadSessionsIndex()` 原来每轮被调用 6 次，每次都从磁盘读取
- **目录守卫**: `_projectDirEnsured` 避免不必要的 `mkdirSync`
- **字符串缓冲区**: 流式循环中使用 `push` + `join` 替代 `+=`（每次 chunk 都重新分配内存）

### Startup (spec 430)
- **并行 skills**: `Promise.all` + `fs/promises` — 同时加载，零顺序 `readFileSync`
- **缓存的模板**: Prompt 模板 (`templates/tools/*.md`, `templates/skills/*.md`) 使用不可变缓存 — 不再每轮从磁盘重新读取

### Compaction & memory (spec 440)
- **增量哈希**: `findStablePrefixEndIndex()` 使用单个增量 SHA-256 实例 — O(N) 替代 O(N²)
- **并行 turns**: `readRecentTurns()` 使用 `Promise.all` 并行解压文件
- **异步备份**: `backupSpecFile()` 使用 `fs/promises.copyFile` — 零阻塞

### Hardening (spec 450)
- **有限并发**: `readRecentTurns` 以 8 个为一批处理，支持提前终止 — 不浪费 I/O
- **mtime 失效**: 会话索引缓存检查 `mtimeMs` — 多终端使用安全
- **ENOENT 恢复**: 如果 `.dscode/` 在会话期间被删除，`ensureProjectDir` 重置标志
- **ESLint `no-floating-promises`**: 规则已启用 — 5 处违规用 `void` 修复

---

## 🐛 PDF: Context Budget Fix (spec 460)

- **压缩 ObjStm 的 PDF**: 当正则启发式失败时，`countPdfPages` 返回 `null`（而非 `0`）。大型 PDF 不再作为 base64 嵌入上下文中 — 防止超出 1M token 窗口。

---

## 🚀 Node.js 24 原生 API 优化

- **Grep handler**: 原生 `fs.globSync`，异步并行读取，流式处理 — **-143 行，-1 依赖**
- **Glob handler**: 自定义遍历器替换为 `fs.globSync` — **-51 行**

---

## 🔧 修复

- **`cacheMode` 在 Zod schema 中**: 包含 `cacheMode` 的 settings 不再被拒绝为无效
- **`/spec-pipe`**: 没有活跃会话时自动创建会话
- **FD 泄漏**: grep 二进制检测 catch 块和 MCP client disconnect 中的文件描述符已关闭
- **未使用变量**: grep handler 中的 `unusedInBinaryDetection` 正则已移除

---

## 📋 文档与基础设施

- **5 条 steering 规则** 添加到 `AGENTS.md`：授权、交叉检查、验证、后果、输出
- **V39 和 V40** 已记录在 `vision.md`
- **Node 26 通知** 在欢迎界面："从 2026 年 10 月起，DsCode 将要求 Node.js 26。"
- **Release notes** 现在使用 `RELEASE_NOTES.md`（而非 `--generate-notes`）

---

## 🚀 Node.js 24 — All-in

完全迁移到 Node 24 作为基线。零旧版本兼容性。

### 替代依赖的原生 API
- **`fs.globSync`** 原生替代 npm `glob` 包 — **-4 依赖**
- **`node:zstd`** 原生替代 `node:zlib` 的 Brotli 回退 — 压缩器体积缩小 4 倍
- **`Error.isError()`** → `getErrorMessage()` 函数，跨 realm 安全，覆盖 21 个文件
- **`structuredClone`** 原生 — 深拷贝从 8 行变为 1 行
- **esbuild target `node24`** — 无需 Node 22 polyfills
- **CI 使用 Node 24** — 在真实运行时构建和测试

---

## 🍎 macOS Apple Silicon 自动发布

- macOS ARM64 (`macos-latest`) 现在每次 tag 推送时自动构建
- macOS Intel (`macos-13`) 已移除 — GitHub 已弃用该 runner，无需排队等待
- Dry-run 覆盖 Windows、Linux 和 macOS ARM64
- 校验和下载已修复（v1.0.41 中 `400 Bad Content-Length` 错误的根本原因）

---

## 🔄 健壮的自动更新

- CI 与 `update-check.ts` 之间资产命名 100% 一致
- Portable 包（SEA 失败时的回退）现在复制**所有**配套文件：`dscode.mjs`、`node`、`templates/`、`node_modules/`
- 所有平台上的文件提取和原子二进制替换

---

## 🖼️ 本地 OCR（Tesseract.js）

- 通过 `tesseract.js` 离线 OCR，用于不支持图像的模型（如 DeepSeek V4）
- **动态导入** — `tesseract.js` 仅在实际使用 OCR 时加载，零启动影响
- 所有 12 个传递依赖项打包在 portable 包中
- 提取的文本截断为 2000 个字符（词边界）
- `/image-paste` 和 `/image-upload` 支持自动 OCR 回退
- 通过终端粘贴进行文件拖放

---

## 🐛 修复

- **v1.0.41**: 发布时 `400 Bad Content-Length` 错误 — 校验和未被下载
- **v1.0.42/43**: macOS Intel 因缺少 runner 阻塞发布 — 已从 pipeline 中移除
- **Auto-update**: Portable 包更新时出现问题 — 现在复制配套文件
- **Bundle**: 构建失败时静默 — 现在 `exit(1)` 并且 CI 会检测到
- **OCR startup**: 启动时找不到 `regenerator-runtime` — `tesseract.js` 按需加载
- **Ink ErrorBanner 错误**、上下文窗口溢出、spec 后缀

---

## 📐 规范与构建

- Specs 370-410：构建验证、操作弹性、可追溯性、自动更新
- `validate-binary.mjs` 使用 tag 版本（而非 package.json）
- `release-dry-run.yml` 覆盖 3 个平台
- CI 中的 README URL 验证
