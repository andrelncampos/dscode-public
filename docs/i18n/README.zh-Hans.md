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
[![][github-stars-shield]][github-stars-link]

**自动规划、实现、验证和审计代码的 AI 助手 — 零供应商锁定。**

<br/>
</div>

**DsCode** 是一个运行在终端中的 AI 编程助手。你可以与 **16 个模型对话，涵盖 DeepSeek V4、OpenAI GPT-5.x、Anthropic Claude 和 Google Gemini** — 它会分析、建议、审查和编写你项目中的代码。

不同之处：DsCode 是**唯一**拥有完整规范驱动开发（SDD）流水线的助手。它不止写代码 — 它**规划**构建内容，**验证**质量，**实现**任务，并**审计**结果。每一步都带有自动修正功能。

---

## DsCode 的独特之处

```mermaid
flowchart LR
    P["/spec-plan<br/>规划"] --> N["/spec-new<br/>创建规范"]
    N --> I["/spec-implement<br/>实现"]
    I --> D[✅ 已交付]
    I -. "可选，按请求" .-> T["/spec-test<br/>审计"]
    T -- "符合性已证明" --> A[🔒 Audited]
    T -. "发现作为下一次 /spec-plan 的输入" .-> P
```

| 能力 | 功能 | 为什么没有其他工具拥有 |
|---|---|---|
| **SDD 流水线** | 交付周期：规划 → 创建 → 实现，可选显式诊断审计 | NONSTOP 自主与确定性质量门 — LLM 起草，代码决定 |
| **多供应商** | DeepSeek V4、OpenAI GPT-5.x、Anthropic Claude、Google Gemini | 无需更改任何配置即可切换供应商 |
| **技能作为代理** | 拥有独立模型、工具和 thinking 的隔离子代理 | 每个技能在沙箱中运行 — 不污染主上下文 |
| **原生 MCP** | 连接数据库、浏览器和外部 API | 跨 3 层集成：技能、规范和 TUI |
| **Steering** | AI 在每个会话中遵循的持久规则 | 细粒度控制：按位置添加、列出、编辑和移除规则 |

---

## DsCode 的 SDD 如何工作

DsCode 的 SDD 旨在**交付软件**，而不是堆积形式。它只规划必要的部分，实施、按比例验证，并以明确的结果结束——即使仍有未完成项。

**NONSTOP 是默认行为。** 一个失败的测试、一个未找到的文本判据，或与实现不一致的文档，本身不会中断工作：它们会产生诊断，在可操作时进行一次有界修正，然后继续。停止只保留给真正的阻碍：安全、权限、完整性、用户显式取消，或无法安全执行。

**按比例验证。** 实施过程中，代理执行局部检查和与改动相关的测试。技术栈的 quality gates 和最终测试在收尾时**只执行一次**，针对最终状态。最终验证集绝不省略——也绝不在每个任务后重复。

`/spec-pipe` 的**三种终态结果**：

| 结果 | 含义 |
|---|---|
| `COMPLETED` | 所有任务已实现并持久化，无待办 |
| `COMPLETED_WITH_WARNINGS` | 已交付工作，并清楚列明未完成项、已跳过的检查或未完成任务 |
| `BLOCKED` | 强制阻碍——安全、完整性、权限、取消或运行环境不可用 |

三者都不依赖 `audited`：结果描述的是**实现**。`/spec-pipe` 执行 `spec-new → spec-implement` 并**交付**；它不会自动运行 `/spec-test`。需要独立审计时请运行 `/spec-test <n>`：它是唯一能授予 `audited` 的权威，且仅在符合性得到证明时授予；发现问题时，它保留 `implemented` 并写出 `/spec-plan` 可消费的报告。

**流水线不会浪费时间自我认证。** `/spec-pipe` 既不运行质量包，也不运行定向测试套件，也不运行任务声明的 `validationCommands`：没有延后，因此收尾时不恢复任何内容，记录的事实是 `not-applicable`。文本判据、未证明的义务和文档漂移会作为具名待办进入报告：它们不会否决交付，也不会重开已完成的任务。`/spec-test` 保留严格审计；它不修复代码，也不重开任务；未运行它绝不被表述为批准。

**策略随调用而定。** `/spec-pipe` 负责交付。`/spec-implement` 与 `/spec-test` 等直接命令保留严格语义，不会继承该策略——同一执行器、同一封存权威、同一持久状态。

**技术栈无关。** Prettier、ESLint、TypeScript 和 npm 不是通用要求：验证器依据实际检测到的技术栈选择。.NET、Java、Python、Go、Rust、Delphi 等走同一路径。

规范细节：[sdd-base.txt](../../sdd-contrato/sdd-base.txt) 与 [sdd-fluxo.md](../../sdd-contrato/sdd-fluxo.md)。

---

## 快速对比

|  | DsCode | GitHub Copilot | Cursor | Claude Code | Amazon Kiro |
|---|---|---|---|---|---|
| **终端原生** | ✅ 原生 TUI | ❌ 仅 IDE | ❌ 仅 IDE | ✅ CLI | ⚠️ IDE + CLI |
| **多供应商** | ✅ 4 个供应商 | ❌ 仅 GitHub | ⚠️ 有限 | ❌ 仅 Anthropic | ❌ 仅 Bedrock |
| **SDD 流水线** | ✅ 完整 + 自动修正 | ❌ | ❌ | ❌ | ✅ 基于 IDE |
| **技能/代理** | ✅ 隔离子代理 | ❌ | ⚠️ 规则 | ⚠️ Hooks | ✅ Powers |
| **免费** | ✅ 无费用 | ⚠️ 有限 | ⚠️ 有限 | ⚠️ 积分 | ❌ Bedrock 费用 |

> **Amazon Kiro** 是最接近的竞争对手 — 两者都有 SDD、Steering 和 Skills。区别在于：DsCode 是**终端原生、多供应商且免费**；Kiro **锁定在 Amazon Bedrock 并按模型使用量收费**。

---

## 30 秒安装

从 **[发布页面](https://github.com/andrelncampos/dscode-public/releases)** 下载二进制文件。需要 **[Node.js 24+](https://nodejs.org)**。

| 系统 | 文件 |
|---|---|
| Windows (x64) | `dscode-windows-x64.zip` |
| Linux (x64) | `dscode-linux-x64.tar.gz` |
| macOS (Apple Silicon) | `dscode-macos-arm64.tar.gz` |

解压并运行 `./dscode`。DsCode 在启动时自动检查更新。

---

## 首次使用

### 1. 配置你的密钥

创建 `~/.dscode/settings.json`，填入你的 API 密钥：

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "你的密钥"
  },
  "thinkingEnabled": true
}
```

### 2. 打开项目并启动

```bash
cd /你的/项目/路径
dscode
```

### 3. 参加互动教程

输入 `/quickstart` 参加 5 分钟教程。AI 通过构建示例项目演示完整的 SDD 流水线 — 你通过观察运行来学习，而不是阅读文档。

或运行 `dscode --quickstart` 直接进入教程。

---

## 你可以做什么

| 任务 | 在提示框中输入 |
|---|---|
| **理解项目** | "用 3 句话解释这个项目的架构。" |
| **审查代码** | "在我推送之前审查最后一次提交的更改。" |
| **实现功能** | "在 `src/form.ts` 的表单中添加邮箱验证。" |
| **重构** | "简化 `processData()` 函数，不改变其行为。" |
| **调查错误** | "分析这个堆栈跟踪并找到根本原因。" |
| **创建测试** | "为 `src/validators.ts` 中的 `validateUser()` 编写单元测试。" |
| **规划功能** | `/spec-plan` — 描述你想要的，AI 创建完整的规范。 |
| **创建规则** | `/steering-add 始终使用 TypeScript 严格模式` |

---

## 常用命令

在提示框中输入 `/` 查看完整菜单。以下是你最常用的命令：

| 命令 | 描述 |
|---|---|
| `/new` | 新对话 — 重置上下文 |
| `/model` | 在 4 个供应商的 16 个模型之间切换 |
| `/quickstart` | 5 分钟 SDD 流水线互动教程 |
| `/spec-plan` | 使用规范规划新功能 |
| `/spec-pipe <n>` | SDD 交付：new → implement（不自动认证） |
| [`/spec-test`](../spec-test_en.md) | 对规格进行独立诊断审计；仅在符合性得到证明时授予 `audited` |
| `/init` | 创建 `AGENTS.md` 为 AI 提供指令 |
| `/steering-add` | 添加 AI 在每个会话中遵循的规则 |
| `/budget` | 按模型和时区查看项目成本 |
| `/context` | 查看会话的 tokens、成本和缓存 |
| `/help` | 完整的命令和键盘快捷键列表 |

> 📋 [52 个命令的完整列表](https://github.com/andrelncampos/dscode-public#todos-os-comandos-slash) — 包括模型管理、笔记、MCP 和技能。

---

## 技能和自主代理

技能是 Markdown 指南，教 AI 以特定方式工作。DsCode 从 3 个来源加载技能：

| 位置 | 用途 |
|---|---|
| `templates/skills/`（内置） | 6 个内置技能 — 3 个始终加载（`karpathy-guidelines`、`project-structure`、`sdd-workflow`），其余按需加载 |
| `./.dscode/skills/<名称>/SKILL.md` | 项目技能（优先级最高） |
| `./.agents/skills/<名称>/SKILL.md` | 项目技能（兼容） |

技能可以作为**自主代理**（`mode: agent`）运行 — 每个代理拥有自己的模型、工具和 thinking，在沙箱中执行而不污染主上下文。

```yaml
# 示例：.agents/skills/reviewer/SKILL.md
name: reviewer
description: 审查代码中的错误和改进点
mode: agent
model: deepseek-flash
tools: [read, grep, glob, bash]
```

---

## 安全

| 实践 | 原因 |
|---|---|
| **允许前审查命令** | AI 可能建议 `rm`、`sudo` 或网络访问 |
| **大型任务前提交** | `git reset --hard` 可在出错时撤销所有更改 |
| **审查差异** | DsCode 显示每个更改 — AI 可能会出错 |
| **永远不要提交 `settings.json`** | 它包含你的 API 密钥（`.gitignore` 已排除） |
| **为实验使用单独分支** | 在风险更改前执行 `git checkout -b ai-experiment` |

---

## 许可证和起源

**DsCode 在 MIT 许可证下分发。** 二进制文件和其他公共制品可以免版税地使用、复制、重新分发、修改、再许可和出售——适用于个人、学术、专业或商业用途。

DsCode 是闭源软件，其可执行发行版在 MIT 许可证下提供。DsCode 特定修改的源代码不包含在公共发行版中。因此，DsCode 不作为开源软件呈现。

本项目源自 [DeepCode (lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli)，最初基于 MIT 许可。原始版权声明保留在 [LICENSE](LICENSE) 和 [NOTICE](NOTICE) 中。完整组件和许可证列表请参阅 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

## 官方渠道

| 渠道 | 链接 |
|---|---|
| **GitHub** | [github.com/andrelncampos/dscode-public](https://github.com/andrelncampos/dscode-public) |
| **发布** | [github.com/andrelncampos/dscode-public/releases](https://github.com/andrelncampos/dscode-public/releases) |
| **问题** | [github.com/andrelncampos/dscode-public/issues](https://github.com/andrelncampos/dscode-public/issues) |

⚠️ **仅**从上述官方渠道安装 DsCode。不要信任第三方网站的版本。

---

<!-- LINK GROUP -->

[github-license-link]: https://github.com/andrelncampos/dscode-public/blob/master/LICENSE
[github-license-shield]: https://img.shields.io/github/license/andrelncampos/dscode?color=4d6BFE&labelColor=black&style=flat-square
[github-stars-link]: https://github.com/andrelncampos/dscode-public/stargazers
[github-stars-shield]: https://img.shields.io/github/stars/andrelncampos/dscode?color=yellow&labelColor=black&style=flat-square
