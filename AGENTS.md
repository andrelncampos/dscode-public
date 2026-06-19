## Steering

- Always use Brazilian Portuguese (pt_BR) — vocabulary, spelling, and grammar — when producing Portuguese text. Never use European Portuguese conventions.
- Always run `git add .` before executing `git commit`.
- Pre-existing test failures and errors must be fixed immediately when discovered. Never leave known test failures unresolved.
- Never push to remote without explicit authorization.
- Only publish or push when the user gives explicit verbal authorization — \"sim\" (yes), \"pode\" (go ahead), or equivalent unambiguous confirmation. Never infer consent from context or preceding requests.
- When both a TypeScript type and a Zod schema define the same configuration shape, compare them key-by-key to ensure they stay in sync. Never add a field to one without adding it to the other.
- When changing CI or infrastructure, verify beyond \"it exists\" and \"it works locally\" — confirm the underlying resource (runner, service, endpoint) is actually available and reachable.
- Before committing CI changes, simulate the full workflow end-to-end — trace what happens to dependent jobs when this job fails, is skipped, or waits indefinitely.
- After each implementation step, validate the output — type-check, build the bundle, review diffs, and confirm release notes exist before pushing.
