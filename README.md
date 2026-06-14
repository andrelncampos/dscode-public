<div align="center">

<img src="https://raw.githubusercontent.com/andrelncampos/dscode-public/main/media/logo.svg" width="120" alt="DsCode"/>

# DsCode

**AI coding assistant in your terminal. Free. Private. Powerful.**

[![npm version](https://img.shields.io/npm/v/@andrelncampos/dscode?color=%234d6BFE&labelColor=black&style=flat-square)](https://www.npmjs.com/package/@andrelncampos/dscode)
[![npm downloads](https://img.shields.io/npm/dm/@andrelncampos/dscode?color=%234d6BFE&labelColor=black&style=flat-square)](https://www.npmjs.com/package/@andrelncampos/dscode)
[![node](https://img.shields.io/badge/node-%3E%3D24-4d6BFE?labelColor=black&style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-proprietary-4d6BFE?labelColor=black&style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-4d6BFE?labelColor=black&style=flat-square)]()

<br/>

```
npm install -g @andrelncampos/dscode && dscode
```

<br/>

</div>

---

## Why DsCode

DsCode puts a **production-grade AI engineer** inside your terminal. It reads your codebase, writes and edits files, runs shell commands, searches the web, and connects to external tools — all through a fast, keyboard-driven TUI.

**16 models. 4 providers. Zero context switching.**

| | DsCode | Copilot Chat | Cursor | Claude Code |
|---|---|---|---|---|
| **Works in terminal** | ✅ Native TUI | ❌ IDE only | ❌ IDE only | ✅ CLI |
| **Provider freedom** | ✅ DeepSeek, OpenAI, Anthropic, Gemini + any OpenAI-compatible | ❌ GitHub only | ❌ Limited | ⚠️ Anthropic only |
| **Multi-provider thinking mode** | ✅ Per-provider (max/high/medium/low) | ❌ | ❌ | ⚠️ Claude only |
| **MCP support** | ✅ Full: skills, SDD, TUI inspection & actions | ❌ | ⚠️ Partial | ⚠️ Partial |
| **Spec-Driven Development** | ✅ Built-in SDD cycle (verify → implement → audit) | ❌ | ❌ | ❌ |
| **Custom skills & agents** | ✅ Markdown-based, subagents, skill-level MCP | ❌ | ⚠️ Rules only | ⚠️ Hooks |
| **Steering system** | ✅ Persistent per-project rules | ❌ | ❌ | ❌ |
| **Image paste** | ✅ Ctrl+V from clipboard | ❌ | ✅ | ❌ |
| **Privacy** | ✅ Your code stays on your machine | ✅ | ⚠️ | ✅ |

---

## Quick start

```bash
# 1. Install (requires Node.js 24+)
npm install -g @andrelncampos/dscode

# 2. Set your API key
mkdir -p ~/.dscode
echo '{"env":{"MODEL":"deepseek-v4-pro","API_KEY":"sk-your-key"}}' > ~/.dscode/settings.json

# 3. Open a project and start
cd /path/to/your/project
dscode
```

> 💡 **Don't have an API key?** Get one at [platform.deepseek.com](https://platform.deepseek.com), [platform.openai.com](https://platform.openai.com), [console.anthropic.com](https://console.anthropic.com), or [aistudio.google.com](https://aistudio.google.com).

---

## Features

### 🧠 Multi-provider intelligence

Switch between 16 models across DeepSeek, OpenAI, Anthropic, and Google Gemini — or bring any OpenAI-compatible API. Each provider gets native thinking mode, reasoning effort control, and pricing tracking.

```
/model              # opens model picker with thinking mode per provider
/model-list         # all configured providers with status and pricing
/model-info gpt-5.4 # full details: context window, pricing, capabilities
```

### 🛠️ MCP — Model Context Protocol

Connect to external tools: databases, browsers, APIs, local servers. Full lifecycle support:

- **Skills carry MCP**: a `postgres-dba` skill bundles `query`, `list_tables`, `describe` plus safety rules
- **SDD + MCP**: specs declare tool dependencies; `/spec-new` queries real data sources
- **TUI inspection**: server status, scope, policy badges, execution history, keyboard shortcuts for approve/deny/disable

```
/mcp                # opens full MCP management panel
```

### 📋 SDD — Spec-Driven Development

Plan, specify, implement, and audit features with a built-in engineering workflow. Both quality checkpoints auto-fix issues — **idempotent, safe to run repeatedly**.

```
/spec-plan          # brainstorm → specs aligned with product vision
/spec-new 42        # generate requirements, design, and tasks
/spec-verify 42     # check and auto-fix gaps (run until "0 issues")
/spec-implement 42  # execute all tasks sequentially
/spec-audit 42      # audit and auto-fix bugs (run until clean)
```

### 🎯 Skills & subagents

Teach the AI to follow specific workflows. Skills are Markdown files — simple to write, powerful to run. Skills with `mode: agent` execute as isolated subagents with their own model, tools, and temperature.

```yaml
---
name: security-review
description: Audits code for security vulnerabilities
mode: agent
model: deepseek-v4-pro
tools: [Read, Grep, Glob, Bash]
---

Review the diff for: hardcoded secrets, unsafe eval,
path traversal, missing input validation.
```

### ⌨️ Terminal-native UX

Built with React/Ink. Keyboard-driven, no popups, no browser tabs.

| Shortcut | Action |
|---|---|
| `Enter` | Send prompt |
| `@` | Mention project files |
| `/` | Command menu |
| `Ctrl+V` | Paste clipboard image |
| `Ctrl+O` | Expand output |
| `Esc` | Interrupt AI |
| `Ctrl+D` ×2 | Quit |

### 🔐 Security-first

- **API keys encrypted** with AES-256-GCM at rest
- **Steering rules** enforce per-project policies
- **Audit mode** (`dscode --audit`): read-only, no file writes, no commands
- **Permission system**: allow/deny/ask per tool category per session
- **Works offline**: your code never leaves your machine

### 📦 Auto-updates

DsCode checks for new versions at startup. If an update is available, you're prompted in-session — no restart needed to discover updates.

```bash
dscode --update     # explicit check: "DsCode is up to date" or prompt to install
dscode --version    # shows version + node + platform
```

---

## Configuration

All settings in `~/.dscode/settings.json` or `.dscode/settings.json`:

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "API_KEY": "sk-your-key-here",
    "BASE_URL": "https://api.deepseek.com"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max",
  "temperature": 0.3,
  "maxTokens": 65536
}
```

### Multiple providers with `engines`

```json
{
  "env": { "MODEL": "deepseek-v4-pro", "API_KEY": "sk-deepseek-key" },
  "engines": {
    "openai": { "apiKey": "sk-openai-key" },
    "anthropic": { "apiKey": "sk-ant-anthropic-key" },
    "gemini": { "apiKey": "AIza-gemini-key" }
  }
}
```

Switch models with `/model` — DsCode routes to the correct provider automatically.

---

## Installation

| Method | Command |
|---|---|
| **npm** (recommended) | `npm install -g @andrelncampos/dscode` |
| **Standalone binaries** | [GitHub Releases](https://github.com/andrelncampos/dscode-public/releases) — Windows, Linux, macOS (Intel + Apple Silicon) |

Standalone binaries are fully self-contained — no Node.js required.

---

## License

**DsCode is free to use. Source code is not public.**

The product is provided at no cost for individual and professional use. Redistribution is permitted only of the official binaries obtained from this repository or npm.

DsCode is derived from [DeepCode](https://github.com/lessweb/deepcode-cli) (MIT). Copyright notices are preserved.

---

## Links

| Channel | URL |
|---|---|
| **Website** | [github.com/andrelncampos/dscode-public](https://github.com/andrelncampos/dscode-public) |
| **npm** | [npmjs.com/package/@andrelncampos/dscode](https://www.npmjs.com/package/@andrelncampos/dscode) |
| **Releases** | [github.com/andrelncampos/dscode-public/releases](https://github.com/andrelncampos/dscode-public/releases) |
| **Issues** | [github.com/andrelncampos/dscode-public/issues](https://github.com/andrelncampos/dscode-public/issues) |

---

<div align="center">

**Free. Private. Terminal-native.**

<br/>

</div>
