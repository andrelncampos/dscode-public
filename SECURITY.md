# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in dscode, **please do not open a public issue**.

Instead, report it privately by emailing the maintainer at the address listed on the GitHub profile: https://github.com/andrelncampos

Please include the following in your report:

- **Affected version(s)**: Which version(s) of dscode are affected?
- **Description**: A clear description of the vulnerability.
- **Steps to reproduce**: How can the vulnerability be triggered?
- **Impact**: What is the potential impact? (e.g., data exposure, command execution, file access)
- **Suggested fix**: If you have a proposed fix, include it.
- **Environment**: OS, Node.js version, and any relevant configuration.

## What qualifies as a vulnerability?

Examples of relevant vulnerabilities:

- **API key leakage**: Exposure of user API keys, tokens, or credentials in logs, error messages, or debug output.
- **Unauthorized command execution**: Bypass of the permission system allowing the LLM to execute commands without user approval.
- **Operational prompt injection**: Manipulation of system prompts or agent instructions that compromise the assistant's behavior.
- **Path traversal**: Unauthorized read/write access to files outside the intended working directory.
- **Permission bypass**: Circumventing the configured permission scopes (read-in-cwd, write-out-cwd, network, etc.).
- **Log leakage**: Sensitive data (prompts, LLM responses, environment variables) exposed in log files.
- **Supply chain attack**: Compromised dependencies, build artifacts, or tampered distribution channels.

## Response policy

- You will receive an acknowledgment within **72 hours**.
- We will investigate and provide an initial assessment within **7 days**.
- We will work with you on a timeline for disclosure and fix.
- We do not offer bug bounties at this time.
- We do not make SLAs (Service Level Agreements) for response time — these are best-effort targets.

## Supported versions

Only the latest published version of dscode receives security updates. Older versions are not supported.

## Security best practices for users

1. **Never paste API keys or tokens** in GitHub issues, pull requests, or public discussions.
2. **Keep your API keys out of prompts** — the assistant may echo them in responses or logs.
3. **Review permissions** before allowing tool execution. Configure `permissions` in `~/.deepcode/settings.json`.
4. **Audit debug logs** if you enable `debugLogEnabled`. Debug logs are stored at `~/.deepcode/logs/debug.log` and may contain code and prompts (with secrets masked).
5. **Use environment variables** for `API_KEY` instead of hardcoding in `settings.json`.
6. **Verify the source** of any npm package by checking the GitHub repository URL before installation.
