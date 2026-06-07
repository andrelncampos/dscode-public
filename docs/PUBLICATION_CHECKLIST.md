# Publication Checklist — Manual Steps

This checklist covers steps that must be performed **manually** on GitHub before making the repository public.

## Before going public

### 1. Secret scanning on full history
- [ ] Run a full secret scan across the entire Git history (not just HEAD).
  - Use `gitleaks detect --source . --verbose` locally.
  - Review findings. If any real secrets are found, rotate them immediately.
  - Command: `gitleaks detect --source . --report-format json --report-path gitleaks-report.json`

### 2. Rotate any exposed credentials
- [ ] If any API key, token, or credential was ever committed (even if later removed), rotate it.
  - Generate a new key from the provider (DeepSeek, OpenAI, etc.).
  - Revoke the old key.
  - Update your local `~/.deepcode/settings.json` with the new key.
  - **Do NOT commit settings.json** — it is already in `.gitignore`.

### 3. Branch protection / ruleset for `main`
Go to: Repository Settings → Rules → Rulesets (or Branches)

- [ ] **Block direct push to `main`**: Only allow push via pull request.
- [ ] **Require pull request** before merging.
- [ ] **Require status checks to pass** before merging:
  - CI (`build-and-test`)
  - Security (`npm-audit`, `secret-scan`, `dangerous-files`)
  - CodeQL (`analyze`)
  - Dependency Review
- [ ] **Require conversation resolution** before merging.
- [ ] **Require CODEOWNERS review** for sensitive paths.
- [ ] **Block force push**.
- [ ] **Block branch deletion**.

### 4. Fork workflow approval
- [ ] For pull requests from forks, require manual approval to run workflows.
  - GitHub Settings → Actions → General → "Fork pull request workflows from outside collaborators" → "Require approval for first-time contributors"

### 5. Secret scanning and push protection
- [ ] Enable **secret scanning** (GitHub Advanced Security or the free tier).
  - Repository Settings → Code security → Secret scanning → Enable.
- [ ] Enable **push protection** to block commits containing known secret patterns.
  - Repository Settings → Code security → Push protection → Enable.

### 6. Dependabot alerts
- [ ] Enable **Dependabot alerts** for vulnerable dependencies.
  - Repository Settings → Code security → Dependabot alerts → Enable.
- [ ] Enable **Dependabot security updates** to auto-open PRs for critical fixes.
  - Repository Settings → Code security → Dependabot security updates → Enable.

### 7. Reserve npm package name (if applicable)
- [ ] The package `@andrelncampos/dscode` is already published.
  - Verify the package is not claimed by impersonators.
  - If publishing for the first time: `npm publish --dry-run` to test.

### 8. Define official release channels
- [ ] GitHub Releases: https://github.com/andrelncampos/dscode/releases
- [ ] npm: `npm install -g @andrelncampos/dscode`
- [ ] Ensure README.md lists ONLY these channels.

### 9. Review documentation before going public
- [ ] README.md: correct links, no placeholders, no private data.
- [ ] LICENSE: present and matches the declared license (MIT).
- [ ] NOTICE: includes upstream copyright and third-party notices.
- [ ] SECURITY.md: has valid contact information.
- [ ] CONTRIBUTING.md: accurate local development steps.
- [ ] CODEOWNERS: valid GitHub handle.

### 10. Create first signed release
- [ ] Create a signed Git tag for the first release: `git tag -s v1.0.1 -m "v1.0.1"`
- [ ] Push the tag: `git push origin v1.0.1`
- [ ] Create a GitHub Release from the tag.

### 11. Verify no auto-publish
- [ ] Confirm that no GitHub Actions workflow publishes to npm automatically.
  - The `release-dry-run.yml` workflow only validates packaging — it does NOT publish.
  - No `npm publish` step exists in any workflow.
- [ ] Confirm that `prepack` script (`npm run build`) only builds, does not publish.

### 12. Issue template security warnings
- [ ] Verify that `bug_report.yml` warns against pasting secrets.
- [ ] Verify that `config.yml` redirects security reports to SECURITY.md.
- [ ] Verify that issue templates are visible when creating a new issue.

## After going public

### 13. Monitor
- [ ] Watch for security alerts from GitHub (Dependabot, secret scanning, CodeQL).
- [ ] Monitor new issues for accidental secret disclosure.
- [ ] Review and merge Dependabot PRs regularly (weekly).

### 14. Community health files
- [ ] Consider adding a `CODE_OF_CONDUCT.md` (e.g., Contributor Covenant).
- [ ] Consider adding a `GOVERNANCE.md` if the project gains multiple maintainers.
