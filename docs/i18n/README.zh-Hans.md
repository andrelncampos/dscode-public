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

## 快速下载

> ⚠️ **尚未发布任何 release。** 以下说明展示了首次发布后的下载格式。在此期间，请使用 npm 安装方式（下一节）。

**当有 release 发布后**，访问 [GitHub Releases 页面](https://github.com/andrelncampos/dscode/releases) 并下载适合你系统的文件：

| 操作系统 | 下载文件 |
|---|---|
| Windows (x64) | `dscode-windows-x64.zip` |
| Linux (x64) | `dscode-linux-x64.tar.gz` |
| macOS (Intel x64) | `dscode-macos-x64.tar.gz` |
| macOS (Apple Silicon / ARM64) | `dscode-macos-arm64.tar.gz` |

每个 release 包含一个 `checksums.txt` 文件用于验证下载完整性。

---

## 按操作系统安装

### 推荐安装方式（所有系统）

最简单的方式是通过 npm：

```bash
npm install -g @andrelncampos/dscode
```

然后在任何项目文件夹中运行 `dscode`。如果你还没有安装 Node.js，请查看下面的前提条件。

**唯一前提条件**：[Node.js](https://nodejs.org) 版本 **22** 或更高。

检查你的版本：

```bash
node --version
```

输出应为 `v22.x.x` 或 `v24.x.x`。更旧的版本（18, 20）不支持。

---

### Windows

#### 选项 1：npm（推荐）

1. 安装 [Node.js 22+](https://nodejs.org)。
2. 打开 **PowerShell**（或 Git Bash、终端、CMD）。
3. 全局安装：

   ```powershell
   npm install -g @andrelncampos/dscode
   ```

4. 验证：

   ```powershell
   dscode --version
   ```

   应显示版本号（例如：`1.0.1`）。

5. 在任何项目中运行：

   ```powershell
   cd C:\my-project
   dscode
   ```

#### 选项 2：Release 二进制文件

当有 release 可用时：

1. 从 Releases 页面下载 `dscode-windows-x64.zip`。
2. 解压到你选择的文件夹（例如：`C:\dscode`）。
3. 将该文件夹添加到系统 PATH。
4. 在终端中运行 `dscode.exe`。

#### Windows 常见问题

- **`npm install -g` 后"命令未找到"**：npm 的 PATH 可能未配置。关闭并重新打开终端，或检查 `%APPDATA%\npm` 是否在 PATH 中。
- **安装时权限错误**：以管理员身份运行 PowerShell 或配置 npm 的 prefix 到本地文件夹。

---

### Linux

#### 选项 1：npm（推荐）

1. 安装 [Node.js 22+](https://nodejs.org)（使用 `nvm` 或发行版的包管理器）。

   ```bash
   # 使用 nvm 的示例
   nvm install 22
   nvm use 22
   ```

2. 全局安装：

   ```bash
   npm install -g @andrelncampos/dscode
   ```

3. 验证：

   ```bash
   dscode --version
   ```

4. 运行：

   ```bash
   cd /path/to/project
   dscode
   ```

#### 选项 2：Release 二进制文件

当有 release 时：

1. 下载 `dscode-linux-x64.tar.gz`。
2. 解压：

   ```bash
   tar -xzf dscode-linux-x64.tar.gz
   ```

3. 设为可执行（如果需要）：

   ```bash
   chmod +x dscode
   ```

4. 移动到 PATH：

   ```bash
   sudo mv dscode /usr/local/bin/
   ```

#### Linux 常见问题

- **全局安装时权限被拒绝（EACCES）**：配置 npm 的 prefix 到本地目录或使用 `sudo`。
- **Shell 不识别 `dscode`**：检查 `/usr/local/bin` 是否在 PATH 中。重新打开终端。

---

### macOS

#### 选项 1：npm（推荐）

1. 安装 [Node.js 22+](https://nodejs.org)（使用官方安装程序、Homebrew 或 nvm）。

   ```bash
   # 使用 Homebrew 的示例
   brew install node@22
   ```

2. 全局安装：

   ```bash
   npm install -g @andrelncampos/dscode
   ```

3. 验证：

   ```bash
   dscode --version
   ```

4. 运行：

   ```bash
   cd /path/to/project
   dscode
   ```

#### 选项 2：Release 二进制文件

当有 release 时，下载适合你 Mac 的文件：

- **Intel 芯片 Mac**：`dscode-macos-x64.tar.gz`
- **Apple Silicon Mac (M1/M2/M3/M4)**：`dscode-macos-arm64.tar.gz`

解压：

```bash
tar -xzf dscode-macos-arm64.tar.gz
chmod +x dscode
sudo mv dscode /usr/local/bin/
```

#### 关于 Gatekeeper

macOS 可能会阻止运行从互联网下载的二进制文件。如果发生这种情况，你需要在系统偏好设置的**安全性与隐私**中手动授权。**不要永久禁用 Gatekeeper**——仅授权 DsCode。

---

## 从源代码安装

如果你想使用最新的开发版本或参与贡献：

```bash
# 1. 克隆仓库
git clone https://github.com/andrelncampos/dscode.git
cd dscode

# 2. 安装依赖
npm ci

# 3. 构建（typecheck + lint + format + bundle）
npm run build

# 4. 创建本地链接（使 dscode 全局可用）
npm link

# 5. 验证
dscode --version
```

现在 `dscode` 已作为全局命令在你的终端中可用。

---

## 初始配置

DsCode 从 `~/.deepcode/settings.json`（你的用户目录）读取配置。你也可以在特定项目中使用 `.deepcode/settings.json` 进行本地设置。

### 创建你的第一个配置

创建 `~/.deepcode/settings.json`：

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
| `thinkingEnabled` | boolean | 启用推理模式（AI 在回答前"思考"） | DeepSeek 为 `true` |
| `reasoningEffort` | string | 推理深度：`"high"` 或 `"max"` | V4 Pro 为 `"max"` |
| `temperature` | number | 回复的创造性（0 到 2） | *(使用提供商默认值)* |
| `maxTokens` | number | 每次回复的 token 限制 | 65536 (Pro) / 32768 (Flash) |
| `debugLogEnabled` | boolean | 将调试日志保存到 `~/.deepcode/logs/` | `false` |
| `permissions` | object | 细粒度权限控制（读、写、网络等） | *(全部允许)* |
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

创建 `~/.deepcode/settings.json`，填入你的 API 密钥和首选模型（见上方配置部分）。

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

AI 将检查代码并提出改进建议。如果需要，使用 `Ctrl+O` 查看完整输出。

### 第 7 步：审查和提交

当 AI 对文件进行更改时，在提交前**审查每个 diff**。DsCode 显示更改内容，由你决定是否接受。

> 💡 **提示**：在请求大型任务之前进行提交（`git commit`）。如果出现问题，可以使用 `git reset --hard` 撤销。

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

DsCode 以**对话方式**工作：你输入需求，AI 回复并使用工具（读取文件、运行命令、编辑代码）。你可以确认或拒绝每个操作。

---

## 核心概念

| 概念 | 含义 | 何时重要 |
|---|---|---|
| **会话 (Session)** | 你和 AI 之间的持续对话。每次 `/new` 开始一个干净的会话。 | 切换任务时开始新会话以避免混合上下文。 |
| **上下文 (Context)** | AI"记住"的全部对话历史。包括你的消息、回复和读取的文件。 | 长上下文消耗更多 token。使用 `/new` 重置。 |
| **Skills** | 教 AI 遵循特定规则的 Markdown 指南。 | 创建 skill 来标准化审查、代码风格或团队流程。 |
| **Tools** | AI 可以使用的工具：读取文件、运行命令、编辑代码、搜索网页。 | AI 决定使用哪些工具。你可以阻止认为危险的工具。 |
| **Provider** | 提供 AI 模型的公司（DeepSeek、OpenAI、Anthropic 等）。 | 根据成本、质量和隐私选择提供商。 |
| **模型 (Model)** | 具体的 AI 模型（例如 `deepseek-v4-pro`、`gpt-4o`）。 | 不同模型有不同的质量、速度和成本。 |
| **Thinking mode** | AI 在回答前"思考"（推理），生成你可能看到或不看到的内部 token。 | 对复杂任务（调试、架构）启用。对速度要求高时禁用。 |
| **Reasoning effort** | 控制推理深度：`"high"`（好，更快）或 `"max"`（最好，更慢）。 | 对困难问题使用 `"max"`，对日常工作使用 `"high"`。 |
| **Prompt cache** | DeepSeek 缓存重复的上下文部分以减少 token 收费（KV Cache）。 | 自动发生。保持提示稳定以节省费用。 |
| **Logs** | `~/.deepcode/logs/` 中的调试文件，记录 API 调用。 | 仅在诊断问题时启用 `debugLogEnabled`。 |
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
| **在求助前清理日志** | `~/.deepcode/logs/` 中的日志可能包含代码片段。在分享前删除机密信息。 |
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
| **401 错误 (Unauthorized)** | API 密钥缺失或无效 | 检查 `~/.deepcode/settings.json` 中或环境变量中的 `API_KEY` 是否正确。 |
| **429 错误 (Too Many Requests)** | 超过提供商的速率限制 | 等待几秒后重试。在提供商平台上检查你的计划。 |
| **回复被截断** | 达到 token 限制 | 在 `settings.json` 中增加 `maxTokens`，或输入"继续"来恢复。 |
| **超时 / 延迟过长** | 提供商服务器过载或网络问题 | 等待。如果持续，切换模型：暂时使用 Flash 代替 Pro。 |
| **Windows 权限错误** | npm 没有写入权限 | 以管理员身份运行 PowerShell 或配置 npm 的 prefix。 |
| **Linux/macOS 权限错误 (EACCES)** | 全局 npm 没有权限 | 配置 npm 的 prefix 到本地目录或使用 `sudo npm install -g`。 |
| **`npm run build` 失败** | Typecheck 或 lint 错误 | 分别运行命令来识别错误：`npm run typecheck`，`npm run lint`，`npm run bundle`。 |
| **日志未出现** | `debugLogEnabled` 为 `false`（默认） | 在 `settings.json` 中启用 `"debugLogEnabled": true`。日志出现在 `~/.deepcode/logs/debug.log`。 |
| **模型未被识别** | 模型名称不正确 | 使用确切的名称：`deepseek-v4-pro`，`deepseek-v4-flash`，或有效的 OpenAI 兼容模型。 |
| **Token 消耗过高** | 上下文过长或任务过于宽泛 | 使用 `/new` 重置会话。对文件和范围保持具体。不要要求分析整个项目。 |
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
