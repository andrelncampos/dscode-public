<div align="center">

**🌐 Language:** [Português](../../README.md) | English | [Español](README.es.md) | [简体中文](README.zh-Hans.md) | [हिन्दी](README.hi.md)

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

**AI coding assistant in your terminal.**

<br/>
</div>

**DsCode** is a terminal-based AI coding assistant. You talk to an AI model (like DeepSeek V4) and it analyzes, suggests, reviews, and writes code in your project. It works on Windows, Linux, and macOS.

DsCode is derived from [DeepCode (lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli) and has its own evolution, maintained by [André Campos](https://github.com/andrelncampos).

---

## Who DsCode is for

DsCode is useful for:

- **Developers** who want AI assistance with everyday tasks.
- **Tech leads** who need to quickly review or understand codebases.
- **People already using AI to code** who want a fast, terminal-integrated workflow.
- **Teams that want to standardize** prompts, skills, and agents to maintain consistency.
- **DeepSeek V4 users** who want to take advantage of thinking mode, reasoning effort, and KV Cache.

---

## What DsCode helps with

| Task | How DsCode helps |
|---|---|
| **Analyze a codebase** | Ask "Explain this project's architecture" and the AI reads files and answers. |
| **Review code** | Ask "Review the changes in this diff before committing". |
| **Implement features** | Describe what you need and the AI generates or edits files. |
| **Refactor** | Ask "Simplify this function without changing its behavior". |
| **Investigate bugs** | Paste a stack trace and ask for help finding the cause. |
| **Create or use skills** | Skills are guides that teach the AI to work in a specific way. |
| **Work with Git** | The AI suggests branches, commit messages, and makes versioned changes. |
| **Configure reasoning** | Enable *thinking mode* for hard tasks — the AI "thinks" before responding. |
| **Integrate external tools** | With MCP, connect databases, browsers, APIs, and other tools. |

---

## Quick download

> ⚠️ **No releases have been published yet.** The instructions below show the download format once the first release is published. In the meantime, use the npm installation method (next section).

**Once a release is published**, go to the [GitHub Releases page](https://github.com/andrelncampos/dscode/releases) and download the file for your system:

| Operating System | Download File |
|---|---|
| Windows (x64) | `dscode-windows-x64.zip` |
| Linux (x64) | `dscode-linux-x64.tar.gz` |
| macOS (Intel x64) | `dscode-macos-x64.tar.gz` |
| macOS (Apple Silicon / ARM64) | `dscode-macos-arm64.tar.gz` |

Each release includes a `checksums.txt` file to verify download integrity.

---

## Installation by operating system

### Recommended installation (any OS)

The simplest way is via npm:

```bash
npm install -g @andrelncampos/dscode
```

Then run `dscode` inside any project folder. If you don't have Node.js installed, see prerequisites below.

**Single prerequisite**: [Node.js](https://nodejs.org) version **22** or later.

Check your version:

```bash
node --version
```

Output should be `v22.x.x` or `v24.x.x`. Older versions (18, 20) are not supported.

---

### Windows

#### Option 1: npm (recommended)

1. Install [Node.js 22+](https://nodejs.org).
2. Open **PowerShell** (or Git Bash, Terminal, CMD).
3. Install globally:

   ```powershell
   npm install -g @andrelncampos/dscode
   ```

4. Verify:

   ```powershell
   dscode --version
   ```

   Should show the version number (e.g., `1.0.1`).

5. Run in any project:

   ```powershell
   cd C:\my-project
   dscode
   ```

#### Option 2: Release binary

When releases are available:

1. Download `dscode-windows-x64.zip` from the Releases page.
2. Extract to a folder of your choice (e.g., `C:\dscode`).
3. Add the folder to your system PATH.
4. Run `dscode.exe` in the terminal.

#### Common Windows issues

- **"Command not found" after `npm install -g`**: The npm PATH may not be configured. Close and reopen the terminal, or check that `%APPDATA%\npm` is in PATH.
- **Permission error during installation**: Run PowerShell as administrator or configure npm's prefix to a local folder.

---

### Linux

#### Option 1: npm (recommended)

1. Install [Node.js 22+](https://nodejs.org) (use `nvm` or your distribution's package manager).

   ```bash
   # Example with nvm
   nvm install 22
   nvm use 22
   ```

2. Install globally:

   ```bash
   npm install -g @andrelncampos/dscode
   ```

3. Verify:

   ```bash
   dscode --version
   ```

4. Run:

   ```bash
   cd /path/to/project
   dscode
   ```

#### Option 2: Release binary

When releases are available:

1. Download `dscode-linux-x64.tar.gz`.
2. Extract:

   ```bash
   tar -xzf dscode-linux-x64.tar.gz
   ```

3. Make executable (if needed):

   ```bash
   chmod +x dscode
   ```

4. Move to PATH:

   ```bash
   sudo mv dscode /usr/local/bin/
   ```

#### Common Linux issues

- **Permission denied (EACCES) when installing globally**: Configure npm's prefix to a local directory or use `sudo`.
- **Shell does not recognize `dscode`**: Check that `/usr/local/bin` is in PATH. Reopen the terminal.

---

### macOS

#### Option 1: npm (recommended)

1. Install [Node.js 22+](https://nodejs.org) (use the official installer, Homebrew, or nvm).

   ```bash
   # Example with Homebrew
   brew install node@22
   ```

2. Install globally:

   ```bash
   npm install -g @andrelncampos/dscode
   ```

3. Verify:

   ```bash
   dscode --version
   ```

4. Run:

   ```bash
   cd /path/to/project
   dscode
   ```

#### Option 2: Release binary

When releases are available, download the correct file for your Mac:

- **Intel Mac**: `dscode-macos-x64.tar.gz`
- **Apple Silicon Mac (M1/M2/M3/M4)**: `dscode-macos-arm64.tar.gz`

Extract with:

```bash
tar -xzf dscode-macos-arm64.tar.gz
chmod +x dscode
sudo mv dscode /usr/local/bin/
```

#### Gatekeeper note

macOS may block execution of binaries downloaded from the internet. If that happens, you'll need to authorize it manually in **Security & Privacy** in System Preferences. **Do not disable Gatekeeper permanently** — only authorize DsCode.

---

## Installing from source

For those who want the latest development version or to contribute:

```bash
# 1. Clone the repository
git clone https://github.com/andrelncampos/dscode.git
cd dscode

# 2. Install dependencies
npm ci

# 3. Build (typecheck + lint + format + bundle)
npm run build

# 4. Create a local link (makes dscode available globally)
npm link

# 5. Verify
dscode --version
```

Now `dscode` is available as a global command in your terminal.

---

## Initial setup

DsCode reads its configuration from `~/.deepcode/settings.json` (in your home directory). You can also have a `.deepcode/settings.json` inside a specific project for local settings.

### Creating your first configuration

Create `~/.deepcode/settings.json`:

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "put_your_key_here"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

### Where to get your API key

| Provider | Where to get the key |
|---|---|
| **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com) → API Keys |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) → API Keys |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) → API Keys |

### Configuring with environment variables

As an alternative to `settings.json`, you can use environment variables. DsCode recognizes any variable with the `DEEPCODE_` prefix:

```bash
# Linux / macOS
export DEEPCODE_MODEL="deepseek-v4-pro"
export DEEPCODE_API_KEY="put_your_key_here"

# Windows PowerShell
$env:DEEPCODE_MODEL = "deepseek-v4-pro"
$env:DEEPCODE_API_KEY = "put_your_key_here"
```

### Available configuration options

| Field | Type | Description | Default |
|---|---|---|---|
| `env.MODEL` | string | AI model to use | `deepseek-v4-pro` |
| `env.BASE_URL` | string | Provider API base URL | `https://api.deepseek.com` |
| `env.API_KEY` | string | Provider API key | *(required)* |
| `thinkingEnabled` | boolean | Enables thinking mode (AI "thinks" before responding) | `true` for DeepSeek |
| `reasoningEffort` | string | Reasoning depth: `"high"` or `"max"` | `"max"` for V4 Pro |
| `temperature` | number | Response creativity (0 to 2) | *(provider default)* |
| `maxTokens` | number | Token limit per response | 65536 (Pro) / 32768 (Flash) |
| `debugLogEnabled` | boolean | Saves debug logs to `~/.deepcode/logs/` | `false` |
| `permissions` | object | Fine-grained permission control (read, write, network, etc.) | *(all allowed)* |
| `mcpServers` | object | MCP server configuration | *(none)* |
| `notify` | string | Script executed after each task completes | *(none)* |
| `webSearchTool` | string | Custom web search script | *(uses built-in)* |

⚠️ **Security**: Never share your `settings.json` with anyone. It contains your API key. DsCode's `.gitignore` already excludes `*.log` and `settings.json`.

---

## First use in 5 minutes

### Step 1: Install

```bash
npm install -g @andrelncampos/dscode
```

### Step 2: Configure your key

Create `~/.deepcode/settings.json` with your API key and preferred model (see the Configuration section above).

### Step 3: Open a project folder

```bash
cd /path/to/your/project
```

It can be any project: a Git repo, a personal project, even an empty folder.

### Step 4: Start DsCode

```bash
dscode
```

You'll see a welcome screen with a text input field. The assistant is ready.

### Step 5: Ask something simple

Type in the prompt field:

```
Explain the structure of this project in 3 sentences.
```

Press **Enter**. The AI will analyze the project files and respond.

### Step 6: Ask for a useful analysis

```
Analyze the codebase and point out possible improvements, without changing anything.
```

The AI will examine the code and suggest improvements. Use `Ctrl+O` to view the full output if needed.

### Step 7: Review and commit

When the AI makes changes to files, **review each diff** before committing. DsCode shows what was changed and you decide whether to accept it.

> 💡 **Tip**: Make a commit (`git commit`) before requesting large tasks. If something goes wrong, you can undo with `git reset --hard`.

---

## Practical usage examples

Each example below is something you can type in the DsCode prompt field.

| Task | What to type |
|---|---|
| **Understand the architecture** | "Explain this project's architecture, what the main modules are and how they communicate." |
| **Find bugs** | "Analyze src/ for possible bugs. Only point them out, don't change anything." |
| **Suggest improvements** | "Suggest performance and readability improvements for the code in src/." |
| **Implement a feature** | "Add email validation to the signup form in src/form.ts." |
| **Refactor** | "Refactor the processData() function in src/utils.ts to be clearer, without changing behavior." |
| **Review a diff** | "Review the last commit changes and point out problems." |
| **Create tests** | "Create unit tests for the validateUser() function in src/validators.ts." |
| **Use a skill** | "Use the security review skill to audit this code." |
| **Initialize an AGENTS.md** | Type `/init` to create a file with instructions the AI will follow in the project. |

DsCode works **conversationally**: you type what you need, the AI responds and uses tools (read files, run commands, edit code). You can confirm or reject each action.

---

## Key concepts

| Concept | What it is | When it matters |
|---|---|---|
| **Session** | An ongoing conversation between you and the AI. Each `/new` starts a clean session. | Start a new session when switching tasks to avoid mixing contexts. |
| **Context** | The entire conversation history the AI "remembers". Includes your messages, responses, and files read. | Long contexts use more tokens. Use `/new` to reset. |
| **Skills** | Markdown guides that teach the AI to follow specific rules. | Create a skill to standardize reviews, code style, or team processes. |
| **Tools** | Tools the AI can use: read files, run commands, edit code, search the web. | The AI decides which tools to use. You can block those you consider dangerous. |
| **Provider** | The company providing the AI model (DeepSeek, OpenAI, Anthropic, etc.). | Choose a provider based on cost, quality, and privacy. |
| **Model** | The specific AI model (e.g., `deepseek-v4-pro`, `gpt-4o`). | Different models have different quality, speed, and cost. |
| **Thinking mode** | The AI "thinks" (reasons) before responding, generating internal tokens you may or may not see. | Enable for complex tasks (debugging, architecture). Disable for speed. |
| **Reasoning effort** | Controls reasoning depth: `"high"` (good, faster) or `"max"` (best, slower). | Use `"max"` for hard problems and `"high"` for everyday tasks. |
| **Prompt cache** | DeepSeek caches repeated parts of the context to charge fewer tokens (KV Cache). | Happens automatically. Keep prompts stable to save money. |
| **Logs** | Debug files in `~/.deepcode/logs/` that record API calls. | Enable `debugLogEnabled` only to diagnose problems. |
| **Permissions** | Control what the AI can do: read files, write, access network, run commands. | Configure restrictive permissions if you want to review each action before execution. |
| **Workspace** | The root folder where DsCode is running. The AI only sees files in this folder (unless you authorize external access). | Open DsCode in the root of the project you want to work on. |
| **Compaction** | When the conversation gets too long, DsCode summarizes the history to fit the token limit. | Automatic. You can force a new session with `/new` if you prefer. |

---

## Using with DeepSeek

DsCode is optimized for DeepSeek V4 models.

### Supported models

| Model | Best for | Speed | Cost |
|---|---|---|---|
| `deepseek-v4-pro` | Complex tasks, architecture, debugging, deep reasoning | Normal | Higher |
| `deepseek-v4-flash` | Simple tasks, refactoring, quick reviews | Fast | Lower |

### DeepSeek configuration

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "put_your_key_here"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

### Thinking mode

*Thinking mode* allows the AI to reason before responding. Reasoning tokens appear (depending on display mode) and you can see how the AI reached its conclusion.

- **When to use**: Tasks requiring deep analysis (architecture, complex debugging, design decisions).
- **When to disable**: Simple, fast tasks (minor refactoring, quick questions).
- **Display control**: Use `/raw` to toggle between full reasoning view, summary, or hidden.

### Reasoning effort

- **`"max"`**: Deepest reasoning. Ideal for V4 Pro on complex tasks. Uses more tokens.
- **`"high"`**: Good balance. Sufficient for most daily tasks.

### KV Cache (automatic savings)

DeepSeek caches repeated parts of the context (KV Cache) and **does not charge** for cached tokens. To benefit:

- Keep the start of conversations stable (system prompt, initial instructions).
- Avoid unnecessarily restarting sessions — keeping the conversation reduces cost.
- DsCode manages caching automatically; you don't need to do anything.

### Cost considerations

- V4 Pro uses more tokens per response. Use for tasks that genuinely need it.
- V4 Flash is cheaper and faster. Use for reviews, refactoring, and everyday tasks.
- Monitor your usage on the [DeepSeek platform](https://platform.deepseek.com).

### DeepSeek best practices

1. Use `deepseek-v4-pro` for strategic tasks and `deepseek-v4-flash` for daily work.
2. Keep `thinkingEnabled: true` — reasoning significantly improves quality.
3. If the response is truncated, type "continue" — the AI picks up where it left off.
4. Avoid massive prompts. Be specific about which files to analyze.

---

## Security best practices

| What to do | Why |
|---|---|
| **Never paste API keys in GitHub issues** | Issues are public. Exposed keys can be used by others and incur charges. |
| **Never commit `settings.json`** | It contains your API key. The project's `.gitignore` already excludes it, but double-check. |
| **Review commands before allowing** | The AI may suggest shell commands. Read before confirming, especially if they involve `rm`, `sudo`, or network. |
| **Commit before requesting large changes** | If the AI does something wrong, `git reset --hard` undoes everything. Without a prior commit, this isn't possible. |
| **Read diffs before accepting** | DsCode shows each change. Review — the AI can make mistakes. |
| **Don't paste sensitive data in prompts** | Information like passwords, tokens, or customer data may appear in logs or responses. |
| **Sanitize logs before asking for help** | Logs in `~/.deepcode/logs/` may contain code snippets. Remove confidential information before sharing. |
| **Use a separate branch for experiments** | Create `git checkout -b ai-experiment` before requesting large changes. If something goes wrong, discard the branch. |

---

## Best practices to save tokens/credits

| Practice | Explanation |
|---|---|
| **Ask for analysis before implementation** | "Analyze this code and suggest improvements" uses fewer tokens than "Implement X" without context. |
| **Limit scope** | Instead of "Improve the entire project", say "Improve the `process()` function in `src/utils.ts`". |
| **Specify relevant files** | Say "Only analyze files in `src/api/`" — the AI reads fewer files, using fewer tokens. |
| **Use Flash for simple tasks** | `deepseek-v4-flash` is much cheaper. Use for routine tasks. |
| **Use Pro sparingly** | Reserve `deepseek-v4-pro` for tasks that genuinely need deep reasoning. |
| **Keep prompts concise** | Long prompts with unnecessary information waste tokens. |
| **Reset session with `/new` for new tasks** | Long sessions accumulate context and each subsequent message costs more. |

---

## Troubleshooting

| Problem | Likely cause | How to fix |
|---|---|---|
| **`dscode: command not found`** | Global npm not in PATH | Reopen terminal. On Windows, check `%APPDATA%\npm`. On Linux/macOS, check `~/.npm-global/bin`. |
| **`Node.js version not supported`** | Node below version 22 | Install or upgrade to [Node.js 22+](https://nodejs.org). |
| **`npm ci` failed** | Inconsistent dependencies | Delete `node_modules` and `package-lock.json`, then run `npm install`. |
| **401 error (Unauthorized)** | API key missing or invalid | Check that `API_KEY` is correct in `~/.deepcode/settings.json` or environment variable. |
| **429 error (Too Many Requests)** | Provider rate limit exceeded | Wait a few seconds and try again. Check your plan on the provider's platform. |
| **Truncated response** | Token limit reached | Increase `maxTokens` in `settings.json` or type "continue" to resume. |
| **Timeout / excessive delay** | Provider server overloaded or network issue | Wait. If persistent, switch models: use Flash instead of Pro temporarily. |
| **Windows permission error** | npm without write permission | Run PowerShell as administrator or configure npm's prefix. |
| **Linux/macOS permission error (EACCES)** | Global npm without permission | Configure npm's prefix to a local directory or use `sudo npm install -g`. |
| **`npm run build` failed** | Typecheck or lint error | Run commands separately to identify the error: `npm run typecheck`, `npm run lint`, `npm run bundle`. |
| **Logs not appearing** | `debugLogEnabled` is `false` (default) | Enable `"debugLogEnabled": true` in `settings.json`. Logs appear at `~/.deepcode/logs/debug.log`. |
| **Model not recognized** | Incorrect model name | Use exact names: `deepseek-v4-pro`, `deepseek-v4-flash`, or a valid OpenAI-compatible model. |
| **Token consumption too high** | Long context or overly broad tasks | Use `/new` to reset session. Be specific about files and scope. Don't ask to analyze the entire project. |
| **Error with large repositories** | Ignored files not being skipped | DsCode respects `.gitignore`. Check that your `.gitignore` is correct. |

---

## How to get help

If you encounter a problem, open an [issue on GitHub](https://github.com/andrelncampos/dscode/issues).

When reporting, include:

- **DsCode version**: `dscode --version`
- **Operating system**: Windows 11, Ubuntu 24.04, macOS 15, etc.
- **Node.js**: `node --version`
- **Model used**: `deepseek-v4-pro`, `deepseek-v4-flash`, etc.
- **Command executed** and the full error
- **Sanitized logs**, if relevant (remove keys, tokens, and private data)

⚠️ **Never send**:
- API keys or tokens
- Private prompts or confidential project data
- Complete `.env` or `settings.json` files
- Full unreviewed logs (they contain code snippets)

For security vulnerabilities, follow the instructions in [SECURITY.md](../../SECURITY.md). **Do not open public issues for security flaws.**

---

## Contributing

Contributions are welcome! See the full guide in [CONTRIBUTING.md](../../CONTRIBUTING.md).

Quick summary:

1. **Issues** are welcome for bugs, features, and questions.
2. **Pull requests** pass mandatory CI (typecheck + lint + format + tests + build).
3. **Security PRs** or changes to sensitive areas undergo stricter review.
4. Contributors declare they have the right to contribute the submitted code.

---

## Security

See [SECURITY.md](../../SECURITY.md) for the full policy.

- Report vulnerabilities privately (do not open a public issue).
- DsCode masks sensitive data in debug logs, but always review before sharing.
- Keep your API key safe: use environment variables or `settings.json` with restricted permissions (`chmod 600`).

---

## License and origin

DsCode is licensed under the **MIT License**.

This project is derived from [DeepCode (lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli), originally MIT licensed. The original copyright notice is preserved in [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE).

Third-party dependencies maintain their own licenses. See [NOTICE](../../NOTICE) for the dependency list and licenses.

---

## Official channels

| Channel | Link |
|---|---|
| **GitHub** | [github.com/andrelncampos/dscode](https://github.com/andrelncampos/dscode) |
| **Releases** | [github.com/andrelncampos/dscode/releases](https://github.com/andrelncampos/dscode/releases) |
| **npm** | `npm install -g @andrelncampos/dscode` |
| **Issues** | [github.com/andrelncampos/dscode/issues](https://github.com/andrelncampos/dscode/issues) |

⚠️ Install DsCode **only** from the official channels above. Do not trust versions published on third-party sites or unverified links.

---

<!-- LINK GROUP -->

[github-license-link]: https://github.com/andrelncampos/dscode/blob/main/LICENSE
[github-license-shield]: https://img.shields.io/github/license/andrelncampos/dscode?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
