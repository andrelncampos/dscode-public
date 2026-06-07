<div align="center">

**🌐 语言:** [Português](../../README.md) | [English](README.en.md) | [Español](README.es.md) | 简体中文 | [हिन्दी](README.hi.md)

</div>

<br/>

<div align="center">
<br/>
<br/>
<p align="center">
  <img src='https://avatars.githubusercontent.com/u/118287711?s=200&v=4' width='100' alt="DsCode"/>
</p>
<h1>DsCode</h1>

[![][github-license-shield]][github-license-link]

**终端里的 AI 编程助手。**

<br/>
</div>

**DsCode** 是一个运行在终端中的 AI 编程助手。你可以与 AI 模型（如 DeepSeek V4）对话，它会分析、建议、审查并在你的项目中编写代码。支持 Windows、Linux 和 macOS。

DsCode 源自 [DeepCode (lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli)，但有自己的演进方向，由 [André Campos](https://github.com/andrelncampos) 维护。

---

## DsCode 适合谁

DsCode 对以下人群有用：

- **开发者**：希望在日常工作中获得 AI 帮助。
- **技术负责人**：需要快速审查或理解代码库。
- **已经在使用 AI 编程的人**：想要一个快速、集成在终端中的工作流。
- **希望标准化的团队**：统一 prompts、skills 和 agents 以保持一致性。
- **DeepSeek V4 用户**：想要充分利用 thinking mode、reasoning effort 和 KV Cache。

---

## DsCode 能帮什么忙

| 任务 | DsCode 如何帮助 |
|---|---|
| **分析代码库** | 问"解释这个项目的架构"，AI 读取文件并回答。 |
| **审查代码** | 问"审查这个 diff，在提交前指出问题"。 |
| **实现功能** | 描述你的需求，AI 生成或编辑文件。 |
| **重构** | 问"简化这个函数，不改变行为"。 |
| **调查 bug** | 粘贴 stack trace，请 AI 帮助找到原因。 |
| **创建或使用 skills** | Skills 是教 AI 以特定方式工作的指南。 |
| **使用 Git** | AI 建议分支、提交信息并做版本化修改。 |
| **配置推理** | 为困难任务启用 *thinking mode*——AI 在回答前"思考"。 |
| **集成外部工具** | 通过 MCP，连接数据库、浏览器、API 和其他工具。 |

---

## 安装

### 通过 npm（推荐）

```bash
npm install -g @andrelncampos/dscode
```

**前提条件**：[Node.js](https://nodejs.org) 版本 **22** 或更高。

验证安装：

```bash
dscode --version
```

**更新：**

```bash
npm update -g @andrelncampos/dscode
```

**卸载：**

```bash
npm uninstall -g @andrelncampos/dscode
```

### 通过二进制文件（未来）

> ⚠️ **尚未发布任何 release。** 以下说明展示了首次发布后的下载格式。在此期间，请使用上面的 npm 安装方式。

从 [GitHub Releases 页面](https://github.com/andrelncampos/dscode/releases) 下载二进制文件。无需 Node.js——二进制文件是独立的。

| 操作系统 | 文件 |
|---|---|
| Windows (x64) | `dscode-windows-x64.zip` |
| Linux (x64) | `dscode-linux-x64.tar.gz` |
| macOS (Intel x64) | `dscode-macos-x64.tar.gz` |
| macOS (Apple Silicon / ARM64) | `dscode-macos-arm64.tar.gz` |

每个 release 包含一个 `checksums.txt` 文件用于 SHA256 校验。

### 从源代码安装

```bash
git clone https://github.com/andrelncampos/dscode.git
cd dscode
npm ci
npm run build
npm link
dscode --version
```

---

## 初始配置

DsCode 从 `~/.dscode/settings.json`（你的用户目录）读取配置。你也可以在特定项目中使用 `.dscode/settings.json` 进行本地设置。

### 创建你的第一个配置

创建 `~/.dscode/settings.json`：

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "在此放入你的密钥"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

### 在哪里获取 API 密钥

| 提供商 | 获取密钥的位置 |
|---|---|
| **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com) → API Keys |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) → API Keys |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) → API Keys |

### 使用环境变量配置

作为 `settings.json` 的替代方案，你可以使用环境变量。DsCode 识别任何带 `DEEPCODE_` 前缀的变量：

```bash
# Linux / macOS
export DEEPCODE_MODEL="deepseek-v4-pro"
export DEEPCODE_API_KEY="在此放入你的密钥"

# Windows PowerShell
$env:DEEPCODE_MODEL = "deepseek-v4-pro"
$env:DEEPCODE_API_KEY = "在此放入你的密钥"
```

### 可用的配置选项

| 字段 | 类型 | 描述 | 默认值 |
|---|---|---|---|
| `env.MODEL` | string | 要使用的 AI 模型 | `deepseek-v4-pro` |
| `env.BASE_URL` | string | 提供商的 API 基础 URL | `https://api.deepseek.com` |
| `env.API_KEY` | string | 提供商的 API 密钥 | *(必填)* |
| `thinkingEnabled` | boolean | 启用推理模式 | DeepSeek 为 `true` |
| `reasoningEffort` | string | 推理深度：`"high"` 或 `"max"` | V4 Pro 为 `"max"` |
| `temperature` | number | 回复的创造性（0 到 2） | *(使用提供商默认值)* |
| `maxTokens` | number | 每次回复的 token 限制 | 65536 (Pro) / 32768 (Flash) |
| `debugLogEnabled` | boolean | 将调试日志保存到 `~/.dscode/logs/` | `false` |
| `telemetryEnabled` | boolean | 发送匿名使用统计 | `false` |
| `permissions` | object | 细粒度权限控制 | *(全部允许)* |
| `mcpServers` | object | MCP 服务器配置 | *(无)* |
| `notify` | string | 每次任务完成后执行的脚本 | *(无)* |
| `webSearchTool` | string | 自定义网页搜索脚本 | *(使用内置)* |

⚠️ **安全**：永远不要与任何人分享你的 `settings.json`。它包含你的 API 密钥。DsCode 的 `.gitignore` 已排除 `*.log` 和 `settings.json`。

---

## 5 分钟快速上手

### 第 1 步：安装

```bash
npm install -g @andrelncampos/dscode
```

### 第 2 步：配置你的密钥

创建 `~/.dscode/settings.json`，填入你的 API 密钥和首选模型（见上方配置部分）。

### 第 3 步：打开一个项目文件夹

```bash
cd /path/to/your/project
```

可以是任何项目：Git 仓库、个人项目，甚至空文件夹。

### 第 4 步：启动 DsCode

```bash
dscode
```

你会看到一个带有文本输入框的欢迎屏幕。助手已准备就绪。

**提示：** 输入 `@` 来搜索和提及项目文件——AI 可以读取和编辑你引用的文件。

### 第 5 步：问一些简单的问题

在提示框中输入：

```
用 3 句话解释这个项目的结构。
```

按 **Enter**。AI 将分析项目文件并回答。

### 第 6 步：请求有用的分析

```
分析代码库，指出可能的改进点，不要做任何修改。
```

AI 将检查代码并提出改进建议。使用 `Ctrl+O` 展开输出或查看运行中的进程。

### 第 7 步：审查和提交

当 AI 对文件进行更改时，在提交前**审查每个 diff**。DsCode 显示更改内容，由你决定是否接受。

> 💡 **提示**：在请求大型任务之前进行提交（`git commit`）。如果出现问题，可以使用 `git reset --hard` 撤销。

---

## 命令和快捷键

### 斜杠命令

在提示框中输入 `/` 打开命令菜单：

| 命令 | 操作 |
|---|---|
| `/model` | 选择模型、thinking mode 和 reasoning effort |
| `/new` | 开始新对话（清除上下文） |
| `/init` | 创建 `AGENTS.md` 文件，包含 AI 在项目中的指令 |
| `/resume` | 恢复之前的对话 |
| `/continue` | 继续当前对话（如为空则恢复） |
| `/undo` | 将代码或对话恢复到之前的状态 |
| `/mcp` | 显示 MCP 服务器状态和可用工具 |
| `/raw` | 切换推理显示模式（完整、摘要、隐藏） |
| `/exit` | 退出 DsCode |

### 键盘快捷键

| 快捷键 | 操作 |
|---|---|
| `Enter` | 发送提示 |
| `Shift+Enter` | 插入换行 |
| `@` | 搜索和提及项目文件 |
| `Tab` | 自动补全（命令和文件提及） |
| `/` | 打开斜杠命令菜单 |
| `Ctrl+O` | 展开输出 / 查看运行中的进程 |
| `Ctrl+V` | 粘贴剪贴板图片 |
| `Ctrl+X` | 清除已粘贴的图片 |
| `Ctrl+C` | 取消提示 / 中断 AI |
| `Esc` | 关闭模态框 / 中断 |
| `Ctrl+Z` | 撤销上次提示编辑 |
| `Ctrl+Shift+Z` | 重做提示编辑 |
| `Ctrl+W` | 删除前一个词 |
| `Ctrl+A` | 移至行首 |
| `Ctrl+E` | 移至行尾 |
| `Ctrl+K` | 删除从光标到行尾的内容 |
| `Alt+←/→` | 按词导航 |
| `↑/↓` | 导航历史记录（空提示时）或菜单 |
| `PageUp/PageDown` | 滚动消息历史 |
| `?` | 打开/关闭帮助屏幕（显示所有快捷键） |

---

## 实用示例

以下每个示例都是你可以在 DsCode 提示框中输入的内容。

| 任务 | 输入内容 |
|---|---|
| **理解架构** | "解释这个项目的架构，主要模块有哪些，它们如何通信。" |
| **查找 bug** | "分析 src/ 中的潜在 bug。只指出，不要修改任何内容。" |
| **建议改进** | "为 src/ 中的代码建议性能和可读性改进。" |
| **实现功能** | "在 src/form.ts 的注册表单中添加邮箱验证。" |
| **重构** | "重构 src/utils.ts 中的 processData() 函数，使其更清晰，不改变行为。" |
| **审查 diff** | "审查最后一次提交的更改并指出问题。" |
| **创建测试** | "为 src/validators.ts 中的 validateUser() 函数创建单元测试。" |
| **使用 skill** | "使用安全审查 skill 审计此代码。" |
| **初始化 AGENTS.md** | 输入 `/init` 创建包含 AI 在项目中将遵循的指令的文件。 |

DsCode 以**对话方式**工作：你输入需求，AI 回复并使用工具。你可以确认或拒绝每个操作。

---

## 核心概念

| 概念 | 含义 | 何时重要 |
|---|---|---|
| **会话 (Session)** | 你和 AI 之间的持续对话。每次 `/new` 开始一个干净的会话。 | 切换任务时开始新会话以避免混合上下文。 |
| **上下文 (Context)** | AI"记住"的全部对话历史。包括你的消息、回复和读取的文件。 | 长上下文消耗更多 token。使用 `/new` 重置。 |
| **Skills** | 教 AI 遵循特定规则的 Markdown 指南。 | 创建 skill 来标准化审查、代码风格或团队流程。 |
| **Tools** | AI 使用的工具：`bash`（shell）、`read`/`write`/`edit`（文件）、`glob`/`grep`（搜索）、`WebSearch`/`WebFetch`（网页）、`AskUserQuestion`（提问）、`UpdatePlan`（任务）。 | AI 决定使用哪些。你可以通过 `permissions` 阻止危险的工具。 |
| **`@` 提及** | 在提示框中输入 `@` 搜索和引用项目文件。 | 用于引导 AI："分析 @src/utils.ts"——它已经知道要读取哪个文件。 |
| **Provider** | 提供 AI 模型的公司（DeepSeek、OpenAI、Anthropic 等）。 | 根据成本、质量和隐私选择提供商。 |
| **模型 (Model)** | 具体的 AI 模型（例如 `deepseek-v4-pro`、`gpt-4o`）。 | 不同模型有不同的质量、速度和成本。 |
| **Thinking mode** | AI 在回答前"思考"（推理），生成你可能看到或不看到的内部 token。 | 对复杂任务（调试、架构）启用。对速度要求高时禁用。 |
| **Reasoning effort** | 控制推理深度：`"high"`（好，更快）或 `"max"`（最好，更慢）。 | 对困难问题使用 `"max"`，对日常工作使用 `"high"`。 |
| **Prompt cache** | DeepSeek 缓存重复的上下文部分以减少 token 收费（KV Cache）。 | 自动发生。保持提示稳定以节省费用。 |
| **Logs** | `~/.dscode/logs/` 中的调试文件，记录 API 调用。 | 仅在诊断问题时启用 `debugLogEnabled`。 |
| **Permissions** | 控制 AI 可以做什么：读取文件、写入、访问网络、运行命令。 | 如果要在执行前审查每个操作，配置限制性权限。 |
| **Workspace** | DsCode 运行的根文件夹。AI 只看到此文件夹中的文件（除非你授权外部访问）。 | 在你想要工作的项目的根目录中打开 DsCode。 |
| **压缩 (Compaction)** | 当对话变得太长时，DsCode 摘要历史记录以适应 token 限制。 | 自动。如果你愿意，可以用 `/new` 强制新会话。 |

---

## 如何使用 DeepSeek

DsCode 针对 DeepSeek V4 模型进行了优化。

### 支持的模型

| 模型 | 最适合 | 速度 | 成本 |
|---|---|---|---|
| `deepseek-v4-pro` | 复杂任务、架构、调试、深度推理 | 正常 | 较高 |
| `deepseek-v4-flash` | 简单任务、重构、快速审查 | 快速 | 较低 |

### DeepSeek 配置

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "在此放入你的密钥"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

### Thinking mode

*Thinking mode* 允许 AI 在回答前进行推理。推理 token 会显示（取决于显示模式），你可以看到 AI 是如何得出结论的。

- **何时使用**：需要深度分析的任务（架构、复杂调试、设计决策）。
- **何时禁用**：简单快速的任务（小重构、简单问题）。
- **显示控制**：使用 `/raw` 在完整推理视图、摘要和隐藏之间切换。

### Reasoning effort

- **`"max"`**：最深度的推理。适合 V4 Pro 处理复杂任务。消耗更多 token。
- **`"high"`**：良好的平衡。足够大多数日常任务使用。

### KV Cache（自动节省）

DeepSeek 缓存上下文中的重复部分（KV Cache），并且**不收取**缓存 token 的费用。为了受益：

- 保持对话开头稳定（system prompt、初始指令）。
- 避免不必要的会话重启——保持对话可以降低成本。
- DsCode 自动管理缓存；你无需做任何事情。

### 成本注意事项

- V4 Pro 每次回复消耗更多 token。用于真正需要的任务。
- V4 Flash 更便宜更快。用于审查、重构和日常任务。
- 在 [DeepSeek 平台](https://platform.deepseek.com) 上监控你的使用量。

### DeepSeek 最佳实践

1. 对战略性任务使用 `deepseek-v4-pro`，对日常工作使用 `deepseek-v4-flash`。
2. 保持 `thinkingEnabled: true`——推理显著提高质量。
3. 如果回复被截断，输入"继续"——AI 会从中断处继续。
4. 避免过大的提示。明确指定要分析哪些文件。

---

## 安全最佳实践

| 应该做什么 | 为什么 |
|---|---|
| **永远不要在 GitHub issues 中粘贴 API 密钥** | Issues 是公开的。暴露的密钥可能被他人使用并产生费用。 |
| **永远不要提交 `settings.json`** | 它包含你的 API 密钥。项目的 `.gitignore` 已排除它，但请再次确认。 |
| **在允许之前审查命令** | AI 可能建议 shell 命令。在确认前阅读，特别是涉及 `rm`、`sudo` 或网络的命令。 |
| **在请求大型更改之前提交** | 如果 AI 做错了什么，`git reset --hard` 可以撤销一切。没有预先提交，这不可能。 |
| **在接受之前阅读 diffs** | DsCode 显示每次更改。审查——AI 可能会犯错误。 |
| **不要在提示中粘贴敏感数据** | 像密码、token 或客户数据这样的信息可能出现在日志或回复中。 |
| **在求助前清理日志** | `~/.dscode/logs/` 中的日志可能包含代码片段。在分享前删除机密信息。 |
| **为实验使用单独的分支** | 在请求大型更改之前创建 `git checkout -b ai-experiment`。如果出现问题，丢弃分支。 |

---

## 节省 token/额度的最佳实践

| 实践 | 说明 |
|---|---|
| **先请求分析再实现** | "分析此代码并建议改进"比没有上下文直接"实现 X"消耗更少的 token。 |
| **限制范围** | 不要"改进整个项目"，而是说"改进 `src/utils.ts` 中的 `process()` 函数"。 |
| **指定相关文件** | 说"只分析 `src/api/` 中的文件"——AI 读取更少的文件，消耗更少的 token。 |
| **对简单任务使用 Flash** | `deepseek-v4-flash` 便宜得多。用于日常任务。 |
| **适度使用 Pro** | 将 `deepseek-v4-pro` 留给真正需要深度推理的任务。 |
| **保持提示简洁** | 包含不必要信息的长提示会浪费 token。 |
| **对每个新任务使用 `/new` 重置会话** | 长会话会累积上下文，每条后续消息成本更高。 |

---

## 故障排除

| 问题 | 可能原因 | 解决方法 |
|---|---|---|
| **`dscode: command not found`** | 全局 npm 不在 PATH 中 | 重新打开终端。在 Windows 上，检查 `%APPDATA%\npm`。在 Linux/macOS 上，检查 `~/.npm-global/bin`。 |
| **`Node.js version not supported`** | Node 低于版本 22 | 安装或升级到 [Node.js 22+](https://nodejs.org)。 |
| **`npm ci` 失败** | 依赖不一致 | 删除 `node_modules` 和 `package-lock.json`，然后运行 `npm install`。 |
| **401 错误 (Unauthorized)** | API 密钥缺失或无效 | 检查 `~/.dscode/settings.json` 中或环境变量中的 `API_KEY` 是否正确。 |
| **429 错误 (Too Many Requests)** | 超过提供商的速率限制 | 等待几秒后重试。在提供商平台上检查你的计划。 |
| **回复被截断** | 达到 token 限制 | 在 `settings.json` 中增加 `maxTokens`，或输入"继续"来恢复。 |
| **超时 / 延迟过长** | 提供商服务器过载或网络问题 | 等待。如果持续，切换模型：暂时使用 Flash 代替 Pro。 |
| **Windows 权限错误** | npm 没有写入权限 | 以管理员身份运行 PowerShell 或配置 npm 的 prefix。 |
| **Linux/macOS 权限错误 (EACCES)** | 全局 npm 没有权限 | 配置 npm 的 prefix 到本地目录或使用 `sudo npm install -g`。 |
| **`npm run build` 失败** | Typecheck 或 lint 错误 | 分别运行命令来识别错误：`npm run typecheck`，`npm run lint`，`npm run bundle`。 |
| **日志未出现** | `debugLogEnabled` 为 `false`（默认） | 在 `settings.json` 中启用 `"debugLogEnabled": true`。日志出现在 `~/.dscode/logs/debug.log`。 |
| **模型未被识别** | 模型名称不正确 | 使用确切的名称：`deepseek-v4-pro`，`deepseek-v4-flash`，或有效的 OpenAI 兼容模型。 |
| **Token 消耗过高** | 上下文过长或任务过于宽泛 | 使用 `/new` 重置会话。对文件和范围保持具体。 |
| **大型仓库出错** | 忽略的文件未被跳过 | DsCode 遵守 `.gitignore`。检查你的 `.gitignore` 是否正确。 |

---

## 如何获取帮助

如果遇到问题，在 [GitHub 上开一个 issue](https://github.com/andrelncampos/dscode/issues)。

报告问题时，请包括：

- **DsCode 版本**：`dscode --version`
- **操作系统**：Windows 11、Ubuntu 24.04、macOS 15 等
- **Node.js**：`node --version`
- **使用的模型**：`deepseek-v4-pro`、`deepseek-v4-flash` 等
- **执行的命令**和完整错误信息
- **清理后的日志**，如果相关（删除密钥、token 和私人数据）

⚠️ **永远不要发送**：
- API 密钥或 token
- 你的私人提示或机密项目数据
- 完整的 `.env` 或 `settings.json` 文件
- 未经审查的完整日志（包含代码片段）

对于安全漏洞，请按照 [SECURITY.md](../../SECURITY.md) 中的说明操作。**不要为安全缺陷公开发布 issue。**

---

## 贡献

欢迎贡献！查看 [CONTRIBUTING.md](../../CONTRIBUTING.md) 的完整指南。

快速摘要：

1. **Issues** 欢迎用于 bug、功能和建议。
2. **Pull requests** 通过强制 CI（typecheck + lint + format + tests + build）。
3. **安全相关的 PR** 或对敏感区域的更改将经过更严格的审查。
4. 贡献者声明有权贡献所提交的代码。

---

## 安全

查看 [SECURITY.md](../../SECURITY.md) 了解完整政策。

- 私下报告漏洞（不要公开发布 issue）。
- DsCode 在调试日志中遮蔽敏感数据，但在分享前始终要审查。
- 保护你的 API 密钥：使用环境变量或带有限制权限的 `settings.json`（`chmod 600`）。

---

## 许可证和来源

DsCode 使用 **MIT 许可证**。

本项目源自 [DeepCode (lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli)，原始许可为 MIT。原始版权声明保存在 [LICENSE](../../LICENSE) 和 [NOTICE](../../NOTICE) 中。

第三方依赖保持各自的许可证。请参阅 [NOTICE](../../NOTICE) 了解依赖列表及其许可证。

---

## 官方渠道

| 渠道 | 链接 |
|---|---|
| **GitHub** | [github.com/andrelncampos/dscode](https://github.com/andrelncampos/dscode) |
| **Releases** | [github.com/andrelncampos/dscode/releases](https://github.com/andrelncampos/dscode/releases) |
| **npm** | `npm install -g @andrelncampos/dscode` |
| **Issues** | [github.com/andrelncampos/dscode/issues](https://github.com/andrelncampos/dscode/issues) |

⚠️ **仅**从上述官方渠道安装 DsCode。不要信任第三方网站或未经验证的链接上发布的版本。

---

<!-- LINK GROUP -->

[github-license-link]: https://github.com/andrelncampos/dscode/blob/main/LICENSE
[github-license-shield]: https://img.shields.io/github/license/andrelncampos/dscode?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
