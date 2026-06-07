# Contributing to dscode

Thank you for your interest in contributing!

## How to contribute

Contributions are accepted via **pull requests** only. No external contributor has direct push access to the `main` branch.

## Before you start

1. Search [existing issues](https://github.com/andrelncampos/dscode/issues) to avoid duplicates.
2. For significant changes, open an issue first to discuss scope and approach.
3. Read [SECURITY.md](./SECURITY.md) to understand how to report vulnerabilities.

## Pull request process

1. **Branch naming**: Use a descriptive name prefixed with the change type:
   - `feat/short-description` — new feature
   - `fix/short-description` — bug fix
   - `chore/short-description` — tooling, deps
   - `docs/short-description` — documentation
   - `refactor/short-description` — code restructuring

2. **Commit messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `style:`

3. **CI must pass**: All PRs must pass:
   - TypeScript type checking (`npm run typecheck`)
   - ESLint (`npm run lint`)
   - Prettier format check (`npm run format:check`)
   - Build (`npm run bundle`)
   - Tests (`npm test`)

4. **PRs may be rejected** for security, scope, quality, or maintenance concerns. The maintainers reserve the right to decline contributions that do not align with the project's direction.

## Local development setup

```bash
git clone https://github.com/andrelncampos/dscode.git
cd dscode
npm install
```

### Available commands

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run lint` | ESLint across `src/` |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier on all `src/**/*.{ts,tsx}` |
| `npm run format:check` | Prettier in check-only mode |
| `npm run check` | Runs typecheck + lint + format:check together |
| `npm run bundle` | esbuild bundles `src/cli.tsx` → `dist/cli.js` |
| `npm run build` | `check` + `bundle` — full development gate |
| `npm test` | Runs all tests |
| `npm run test:single -- <file>` | Run a single test file |

### Before submitting a PR

```bash
npm run build   # typecheck + lint + format:check + bundle
npm test        # all tests must pass
```

## Code standards

- This project uses **TypeScript strict mode**.
- **2 spaces** indentation, **double quotes**, **semicolons required**, **LF line endings**.
- Run `npm run format` before committing. A pre-commit hook (Husky + lint-staged) auto-formats staged files.
- Match existing code style. Avoid cosmetic refactors unrelated to your change.

## What NOT to submit

- **No secrets**: Never include API keys, tokens, passwords, private keys, or credentials in your PR.
- **No private logs**: Do not include debug.log, error.log, or any log files containing prompts or LLM responses.
- **No copied code**: You must have the right to contribute the code you submit. Do not copy code from sources with incompatible licenses.
- **No unreviewed AI-generated code**: AI-assisted code is acceptable only if you have reviewed it and take full responsibility for it.
- **No personal data**: Do not include email addresses, user paths, IP addresses, or other identifiable information.
- **No compiled artifacts**: Do not commit `dist/` or `node_modules/`.

## License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers this project. You represent that you have the right to grant this license for your contributions.

Original code copyright belongs to the [lessweb/deepcode-cli](https://github.com/lessweb/deepcode-cli) authors. See [NOTICE](./NOTICE) for details.
