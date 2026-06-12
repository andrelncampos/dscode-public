# Spec 80: Model & Engine Configuration UX — Requirements

## Value Delivery

Delivers the remaining half of value block **V13** (Model Selection & Configuration) from vision.md — the provider management, API key configuration, generation parameter editing, and thinking budget tuning that Spec 60 left out of scope.

> **V13 (partial):** *"/model-add, /model-remove, /model-list, /model-info for provider management. /model-key to update API keys without editing settings.json manually. /model-default to set the default model. /model-params to configure generation parameters (temperature, max tokens, top_p). /model-thinking to tune per-model thinking budgets."*

Also extends V13 with encrypted credential storage (FR-011).

---

## Functional Requirements

### FR-001: `/model-list` — List Configured Providers

**What:** The system SHALL respond to the slash command `/model-list` (submitted as a BUFFER_TEXT_COMMAND) with a formatted message listing all providers referenced in `MODEL_CATALOG`, grouped by provider, showing for each:

1. **Provider name** (e.g., `deepseek`, `openai`, `anthropic`, `gemini`).
2. **API key status**: `"✅ key"` if the provider has a configured API key (via `engines.<provider>.apiKey` or global `apiKey` for DeepSeek/OpenAI fallback), `"❌ no key"` otherwise.
3. **Base URL**: The effective base URL (resolved from `engines.<provider>.baseURL` or the provider default).
4. **Model count**: Number of models from `MODEL_CATALOG` belonging to that provider.
5. **Price range**: Lowest and highest input price from `DEFAULT_MODEL_PRICING` for that provider's models, formatted as `"$X.XX–$Y.YY/1M tokens"`.
6. **Model list**: Each model's `id`, `displayName`, and per-unit pricing from `DEFAULT_MODEL_PRICING`.

**Why:** Currently there is zero visibility into which providers are configured. Users must open `settings.json` manually to check API key status. This command makes provider configuration inspectable from within the chat.

**Acceptance Criteria:**
- [ ] Typing `/model-list` and pressing Enter produces a formatted message listing all providers.
- [ ] Each provider shows: name, API key status (✅/❌), base URL, model count, price range.
- [ ] Models are listed with their `id`, `displayName`, and pricing.
- [ ] The key status check logic matches `createLlmProvider` resolution: DeepSeek has key if global `apiKey` is truthy; OpenAI has key if `engines.openai.apiKey` OR global `apiKey` is truthy; Anthropic has key if `engines.anthropic.apiKey` is truthy; Gemini has key if `engines.gemini.apiKey` is truthy.
- [ ] The command works both with bare `/model-list` and prefix `/model-list` with leading text (uses `BUFFER_TEXT_COMMANDS` pattern — submitted to session for processing).
- [ ] Output is plain text (no React/Ink components) since it's rendered as a system message in the chat.
- [ ] If `MODEL_CATALOG` is empty, shows `"No models in catalog."`.

---

### FR-002: `/model-add <provider>` — Guided Provider Addition Wizard

**What:** The system SHALL provide an interactive wizard for adding a new provider's API key and base URL. The command `/model-add <provider>` SHALL be a BUFFER_TEXT_COMMAND that submits to the session for multi-step processing.

**Step 1 — Validate provider:**
- Extract `<provider>` from the command text (`/model-add gemini` → `gemini`).
- If `<provider>` is absent, respond: `"Usage: /model-add <provider>. Valid providers: gemini."` (only show providers NOT already configured with an API key).
- If `<provider>` already has a configured API key at the RESOLVED level (i.e., after applying env vars and global fallback — `deepseek`/`openai` may use global `apiKey`; `anthropic`/`gemini` only use `engines.<provider>.apiKey`), respond: `"Provider '<provider>' already has an API key configured. Use /model-key <provider> to update it."`
  - NOTE: The key status resolution logic is identical to FR-001's key status check: `deepseek` has key if resolved `apiKey` is truthy; `openai` has key if `engines.openai.apiKey` OR resolved `apiKey` is truthy; `anthropic` has key if resolved `engines.anthropic.apiKey` is truthy; `gemini` has key if resolved `engines.gemini.apiKey` is truthy.
  - If the provider has a key ONLY via env var (`DEEPCODE_ENGINE_<PROVIDER>_API_KEY`), it is STILL considered "configured" — the env var provides the key.
- If `<provider>` is not a known provider in `MODEL_CATALOG`, respond: `"Unknown provider '<provider>'. Valid providers: deepseek, openai, anthropic, gemini."`
- Valid provider names SHALL be extracted from `MODEL_CATALOG` entries (union of all `provider` values).

**Step 2 — Confirm base URL:**
- Show the default base URL for this provider (from the provider's default — e.g., `https://generativelanguage.googleapis.com/v1beta` for Gemini, `https://api.openai.com/v1` for OpenAI, `https://api.anthropic.com` for Anthropic).
- If the provider is `deepseek`, show `"https://api.deepseek.com"` (same as global `baseURL` default).
- Prompt: `"Base URL: <default>. Press ENTER to accept default, or type a custom URL:"`
- The user SHALL enter a value. Empty/Enter = accept default. Non-empty = custom URL.
- Validate URL format: must start with `http://` or `https://`. If invalid, respond `"Invalid URL. Must start with http:// or https://."` and re-prompt.

**Step 3 — Enter API key:**
- Show: `"API Key required. Obtain one at: <provider-key-url>"`
  - Gemini: `https://aistudio.google.com/apikey`
  - OpenAI: `https://platform.openai.com/api-keys`
  - Anthropic: `https://console.anthropic.com/settings/keys`
  - DeepSeek: `https://platform.deepseek.com/api_keys`
- Prompt: `"Enter API key (or ESC to cancel):"`
- The user SHALL enter the key value.
- Minimum validation: key SHALL NOT be empty. Key SHALL be at least 8 characters. If invalid, respond `"API key must be at least 8 characters."` and re-prompt.

**Step 4 — Confirmation:**
- Show a preview of what will be saved:
  ```
  Provider:  <provider>
  Base URL:  <url>
  API Key:   <first-4-chars>...<last-4-chars>
  
  Press ENTER to confirm, or type "retry" to re-enter:
  ```
- If user types `"retry"`, return to Step 2 (re-enter base URL).
- If user presses ENTER (empty input), proceed to Step 5.

**Step 5 — Write configuration:**
- Call `credentialVault.encryptCredential(apiKey, providerName)` to encrypt the API key.
- Build `EngineEntry` with `apiKey: "<ciphertext>"` and optionally `baseURL` (omit if default).
- Read current settings via `readSettings()`.
- Set `settings.engines[provider].apiKey` to the encrypted ciphertext.
- Set `settings.engines[provider].baseURL` to the custom URL (only if non-default).
- Write settings via `writeSettings(settings)`.
- Show success message listing:
  - Provider name
  - Base URL
  - API key prefix/suffix (first 4 + last 4 chars from the **plaintext**)
  - List of available models for this provider from `MODEL_CATALOG` with their pricing
  - Hint: `"Use /model to select a <provider> model."`

**Why:** Currently adding a provider requires 5 manual steps outside the app. This wizard reduces it to a single guided flow within the chat.

**Acceptance Criteria:**
- [ ] `/model-add gemini` with `gemini` not configured starts the wizard.
- [ ] Step 2 accepts default base URL on ENTER; Step 2 rejects invalid URLs and re-prompts.
- [ ] Step 3 accepts API key; rejects empty or <8 chars and re-prompts.
- [ ] Step 4 shows masked key preview (`AIza...B123`); "retry" returns to Step 2; ENTER proceeds.
- [ ] Step 5 encrypts the key via `credentialVault.encryptCredential()` and writes to `settings.json`.
- [ ] Success message shows all available models for the provider with pricing.
- [ ] `/model-add openai` when `engines.openai.apiKey` already exists shows error: `"Provider 'openai' already has an API key configured. Use /model-key openai to update it."`
- [ ] `/model-add foo` where `foo` is not in `MODEL_CATALOG` shows error listing valid providers.
- [ ] `/model-add` with no provider shows usage message.
- [ ] The command is a `BUFFER_TEXT_COMMAND` — submitted to session for multi-step processing.

---

### FR-003: `/model-remove <provider>` — Remove Provider Configuration

**What:** The system SHALL respond to `/model-remove <provider>` by removing the provider's entry from `engines` in settings.

**Behavior:**
- Extract `<provider>` from the command text.
- If `<provider>` is absent: `"Usage: /model-remove <provider>. Currently configured: <list of providers with keys>."`
- If `<provider>` is the **sole** provider with an API key AND it's the provider of the currently active model, show warning:
  `"Warning: <provider> is the only configured provider and is currently active. Removing it will leave no API keys. Continue? Type 'yes' to confirm."`
  - Wait for `"yes"` input. Any other input cancels.
- If `<provider>` is the provider of the currently active model (but other providers have keys), show warning:
  `"Warning: the current model '<model-id>' uses <provider>. After removal, switch to another model with /model. Continue? Type 'yes' to confirm."`
  - Wait for `"yes"` input. Any other input cancels.
- If `<provider>` has no configuration in `engines` (no `engines.<provider>` key in settings): `"Provider '<provider>' is not configured. Nothing to remove."`
- On confirmed removal:
  - Read settings.
  - Delete `engines[provider]`.
  - Write settings.
  - Respond: `"✅ Provider '<provider>' removed. Models from this provider are still listed in /model but will need an API key to use."`

**Why:** Users need a way to remove providers they no longer use, without manually editing settings.json. The confirmation guards prevent accidental removal of the active provider.

**Acceptance Criteria:**
- [ ] `/model-remove gemini` with configured `gemini` removes `engines.gemini` from settings.
- [ ] Warning shown when removing the only configured provider.
- [ ] Warning shown when removing the currently active model's provider.
- [ ] `"yes"` must be typed exactly to confirm; any other input cancels.
- [ ] `/model-remove gemini` when `gemini` is not configured shows `"not configured"` message.
- [ ] Provider's models remain in `MODEL_CATALOG` — only the `engines` entry is removed.

---

### FR-004: `/model-info <id>` — Model Detail View

**What:** The system SHALL respond to `/model-info <model-id>` by displaying comprehensive information about a specific model.

**Output format:**
```
Model:       <displayName> (<id>)
Provider:    <provider>
Context:     <contextWindow formatted> tokens (e.g., "1M")
Max Output:  <maxOutput formatted> tokens (e.g., "131K")
Multimodal:  yes/no
Thinking:    <reasoningType> (e.g., "adaptive", "effort", "extended", "none")
  Default:   <defaultEffort>
  Budget:    <budgetTokens formatted> tokens (only if reasoning.type === "extended" and budgetTokens is set)
Pricing:     $<inputPrice>/$<outputPrice> per 1M tokens (cached: $<cacheReadPrice>/1M)
Status:      ✅ API key configured / ❌ No API key configured
```

**Edge cases:**
- If `<model-id>` is absent: `"Usage: /model-info <model-id>. Example: /model-info gpt-5.5"`
- If `<model-id>` is not in `MODEL_CATALOG`: `"Unknown model '<model-id>'. Use /model to see available models."`
- If `getModelCapabilities(modelId)` returns `pricing: null`: show `"Pricing: not available"`.
- If `reasoning.type === "none"`: omit the `Default` and `Budget` lines.
- API key status uses the same logic as FR-001.

**Why:** Users need to inspect model capabilities and pricing before selecting a model. Currently this information is only available by reading `model-catalog.ts` source code.

**Acceptance Criteria:**
- [ ] `/model-info gpt-5.5` shows all fields in the output format.
- [ ] `/model-info gemini-3.1-flash-lite` shows `Thinking: none` with no Default/Budget lines.
- [ ] `/model-info claude-haiku-4-5` shows `Budget: 16.4K tokens`.
- [ ] `/model-info nonexistent` shows `"Unknown model 'nonexistent'"` error.
- [ ] `/model-info` with no argument shows usage message.
- [ ] API key status matches actual configuration.

---

### FR-005: `/model-key <provider>` — Update API Key

**What:** The system SHALL allow updating a provider's API key via `/model-key <provider>`.

**Behavior:**
- Extract `<provider>` from the command text.
- If `<provider>` is absent: `"Usage: /model-key <provider>. Configured providers: <list>."`
- If `<provider>` is not configured (no `engines.<provider>` entry): `"Provider '<provider>' is not configured. Use /model-add <provider> first."` (Note: the user might have the key set via env var `DEEPCODE_ENGINE_<PROVIDER>_API_KEY` — show a warning: `"Note: <provider> may have a key set via environment variable DEEPCODE_ENGINE_<PROVIDER_UPPER>_API_KEY. Setting a key in settings.json will override the env var."`)
- Show current key prefix:
  - If `engines.<provider>.apiKey` exists: decrypt, show `"Current key: <first-4-chars>...<last-4-chars>"`
  - If no key in settings but env var exists: `"Current key: set via environment variable"`
  - If no key at all: `"Current key: not set"`
- Prompt: `"Enter new API key (or ESC to cancel):"`
- Accept input (same validation as FR-002 Step 3: non-empty, ≥8 chars).
- Encrypt the key via `credentialVault.encryptCredential()`.
- Write to settings: `engines[provider].apiKey = <ciphertext>`.
- Respond: `"✅ API key for <provider> updated. <first-4>...<last-4>"`.
- If the provider previously had a plaintext key (pre-FR-011 migration), the old plaintext is overwritten with ciphertext — the migration happens as a side effect.

**Why:** Users need to update API keys when they rotate credentials without editing settings.json. Combined with FR-011 (encryption), old keys are securely overwritten.

**Acceptance Criteria:**
- [ ] `/model-key gemini` with existing `engines.gemini` entry prompts for new key.
- [ ] Current key is shown decrypted with first-4/last-4 masking.
- [ ] New key is encrypted and written, overwriting old value.
- [ ] Plaintext keys (pre-migration) are encrypted on write.
- [ ] `/model-key foo` with no `engines.foo` entry shows "not configured" error.
- [ ] Empty or short (<8 chars) keys are rejected with re-prompt.
- [ ] Success message shows the new key's masked prefix/suffix.

---

### FR-006: `/model-default <id>` — Set Default Model

**What:** The system SHALL set the default model via `/model-default <model-id>`.

**Behavior:**
- Extract `<model-id>` from the command text.
- If `<model-id>` is absent: `"Usage: /model-default <model-id>. Current default: <current-default-displayName> (<current-default-id>)."`
- If `<model-id>` is not in `MODEL_CATALOG`: `"Unknown model '<model-id>'. Use /model to see available models."`
- Check if the model's provider has an API key configured. If not, show warning:
  `"Warning: No API key configured for <provider>. This model won't work until you configure one with /model-add <provider> or /model-key <provider>."`
- Read settings, set `settings.model = <model-id>`.
- Also update `MODEL_CATALOG` isDefault markers? NO — `isDefault` in the catalog is the STATIC factory default, not the user's preference. The user's default is stored in `settings.model`.
- Write settings via `writeSettings()`.
- Respond: `"✅ Default model set to <displayName> (<id>)."`
- If the model is already the default (current `settings.model === modelId`): `"<displayName> is already the default model."`

**Why:** Currently users must edit `settings.json` to change the default model. This command makes it a one-line operation.

**Acceptance Criteria:**
- [ ] `/model-default gpt-5.5` sets `settings.model = "gpt-5.5"`.
- [ ] Warning shown if provider has no API key configured.
- [ ] `/model-default deepseek-v4-pro` when it's already default shows "already the default".
- [ ] `/model-default nonexistent` shows error.
- [ ] Does NOT modify `MODEL_CATALOG` — only writes `settings.model`.

---

### FR-007: `/model-params` — Configure Generation Parameters

**What:** The system SHALL provide an interactive editor for generation parameters (temperature, max_tokens, top_p) via `/model-params`.

**Behavior:**
- The command is a BUFFER_TEXT_COMMAND.
- Show current values from resolved settings:
  ```
  Current generation parameters:
    Temperature:  <current> (range: 0.0–2.0)
    Max Tokens:   <current> (range: 1–<model-max>)
    Top P:        <current> (range: 0.0–1.0, or "not set")
  ```
- Prompt user to select which parameter to change: `"Which parameter? (temperature/max_tokens/top_p) or 'done' to finish:"`
- Accept one of: `temperature`, `max_tokens`, `top_p`, `done`.
- If `done`: write settings and show summary of changes.
- Per parameter editing:
  - **Temperature:** Prompt `"Enter temperature (0.0–2.0, current: <current>):"`. Validate: must be a number in range. On valid input, update pending value.
  - **Max Tokens:** Prompt `"Enter max tokens (1–<model-max>, current: <current>):"`. Read model's `maxOutput` from `MODEL_CATALOG` for the current model. Validate: must be an integer in range. On valid input, update pending value.
  - **Top P:** Prompt `"Enter top_p (0.0–1.0, or 'none' to unset, current: <current>):"`. Validate: number in range or `"none"` to clear. On valid input, update pending value.
- After each parameter edit, re-show the current values and re-prompt `"Which parameter?..."`.
- On `done`:
  - Write `settings.temperature`, `settings.maxTokens`, `settings.topP` (new field!) to settings.
    - `topP` is a NEW field in `DeepcodingSettings` and `ResolvedDeepcodingSettings`. It is optional (`number | undefined`). Default is `undefined`.
    - If `top_p` is set to `"none"` (cleared), write `undefined`/omit the field.
  - Respond with summary: `"✅ Generation parameters updated: temperature=<x>, max_tokens=<y>, top_p=<z>."`

**Why:** Generation parameters exist in the settings schema (`temperature`, `maxTokens`) but zero UI exposes them. Users cannot configure them without editing settings.json. Adding `top_p` completes the standard set.

**Acceptance Criteria:**
- [ ] `/model-params` shows current values from resolved settings.
- [ ] User can cycle through temperature, max_tokens, top_p editing.
- [ ] Validation rejects out-of-range values and re-prompts.
- [ ] "done" writes all changes to settings and shows summary.
- [ ] `topP` field is added to `settings-schema.ts` (Zod: `z.number().min(0).max(1).optional()`), `DeepcodingSettings`, and `ResolvedDeepcodingSettings`.
- [ ] Max tokens limit is derived from current model's `maxOutput` in `MODEL_CATALOG`.
- [ ] If `top_p` is cleared (`"none"`), the field is omitted from settings.json.

---

### FR-008: `/model-thinking <id>` — Configure Per-Model Thinking Budget

**What:** The system SHALL allow configuring the thinking budget (token limit) for models that support extended thinking, via `/model-thinking <model-id>`.

**Behavior:**
- Extract `<model-id>` from the command text.
- If `<model-id>` is absent: `"Usage: /model-thinking <model-id>. Models with configurable thinking budget: <list of models with reasoning.type === 'extended'>."`
- If `<model-id>` is not in `MODEL_CATALOG`: `"Unknown model '<model-id>'."`
- If the model's `reasoning.type` is not `"extended"`: `"Model '<displayName>' has reasoning type '<type>'. Thinking budget is only configurable for extended thinking models. Models with configurable budgets: <list>."`
- If `reasoning.type === "extended"`:
  - Show current budget: `"Current thinking budget: <budgetTokens> tokens"` (from `MODEL_CATALOG` entry's `reasoning.budgetTokens` or default 8192).
  - Show model's max output: `"Max output tokens: <maxOutput>"`
  - Prompt: `"Enter thinking budget in tokens (1024–<maxOutput>, or ENTER for default 8192):"`
  - Validate: must be an integer ≥1024 and ≤ model's `maxOutput`.
  - If ENTER (empty input), use 8192.
- Write the thinking budget to a NEW settings field: `settings.thinkingBudgets: Record<string, number>` (mapping model ID → budget tokens).
  - Add to `DeepcodingSettings` and `ResolvedDeepcodingSettings`.
  - Add to Zod schema: `z.record(z.string(), z.number().int().min(1024)).optional()`.
  - Resolution: when a model's thinking budget is needed, first check `settings.thinkingBudgets[modelId]`, then fall back to `MODEL_CATALOG[modelId].reasoning.budgetTokens`, then to default 8192.
- Respond: `"✅ Thinking budget for <displayName> set to <budget> tokens."`

**Why:** Currently thinking budgets are hardcoded in `model-catalog.ts` (e.g., Claude Haiku at 16384). Users cannot tune it. Different use cases need different thinking budgets — larger for complex analysis, smaller for cost saving.

**Acceptance Criteria:**
- [ ] `/model-thinking claude-haiku-4-5` shows current budget, accepts new value.
- [ ] `/model-thinking gpt-5.5` shows error (reasoning type is "effort", not "extended").
- [ ] New field `thinkingBudgets` added to settings schema and resolved settings.
- [ ] Budget resolution: settings override → catalog entry → default 8192.
- [ ] Validation: budget must be between 1024 and model's maxOutput.
- [ ] ENTER on empty input uses default 8192.

---

### FR-009: `/model` Backward Compatibility

**What:** The bare `/model` command (no subcommand) SHALL continue to open the model selection dropdown exactly as implemented in Spec 60. No changes to the dropdown behavior, rendering, or command handler.

**Acceptance Criteria:**
- [ ] Typing `/model` and pressing Enter opens the model selection dropdown.
- [ ] Dropdown shows all 16 models grouped by 4 providers.
- [ ] Thinking mode selection works identically to Spec 60.
- [ ] Arrow keys, Enter/Space, Escape navigation unchanged.
- [ ] All existing tests for `ModelsDropdown` pass.

---

### FR-010: Validation and Error Messages

**What:** All `/model-*` subcommands SHALL validate inputs and provide clear, actionable error messages.

**Validation rules:**
| Rule | Applies to | Error message |
|------|-----------|---------------|
| Provider name must exist in `MODEL_CATALOG` | `/model-add`, `/model-remove`, `/model-key` | `"Unknown provider '<name>'. Valid providers: <list>."` |
| API key must be non-empty and ≥8 chars | `/model-add`, `/model-key` | `"API key must be at least 8 characters."` |
| Base URL must start with `http://` or `https://` | `/model-add` | `"Invalid URL. Must start with http:// or https://."` |
| Model ID must exist in `MODEL_CATALOG` | `/model-info`, `/model-default`, `/model-thinking` | `"Unknown model '<id>'. Use /model to see available models."` |
| Temperature must be 0.0–2.0 | `/model-params` | `"Temperature must be between 0.0 and 2.0."` |
| Max tokens must be integer ≥1 and ≤ model maxOutput | `/model-params` | `"Max tokens must be between 1 and <maxOutput>."` |
| Top P must be 0.0–1.0 or "none" | `/model-params` | `"Top P must be between 0.0 and 1.0, or 'none' to unset."` |
| Thinking budget must be integer ≥1024 and ≤ model maxOutput | `/model-thinking` | `"Budget must be between 1024 and <maxOutput>."` |
| Provider already configured (for `/model-add`) | `/model-add` | `"Provider '<name>' already has an API key configured. Use /model-key <name> to update it."` |
| Provider not configured (for `/model-remove`, `/model-key`) | `/model-remove`, `/model-key` | `"Provider '<name>' is not configured. <extra hint>"` |

**Why:** Consistent validation prevents cryptic errors from malformed settings.json entries.

**Acceptance Criteria:**
- [ ] Each validation rule in the table is tested with at least one test case.
- [ ] Error messages include actionable hints (e.g., `"Use /model to see available models"`).
- [ ] Validation happens before any settings write — no partial writes.

---

### FR-011: Encrypted API Key Storage

**What:** The system SHALL encrypt API keys before writing them to `settings.json` and decrypt them transparently when reading.

**Encryption scheme:** AES-256-GCM with a local keyfile.

**Key management:**
- A 32-byte random key is stored at `~/.dscode/.credential-key` with filesystem permissions `0600`.
- If the keyfile does not exist, it is created automatically on first use (first encrypt or decrypt call).
- If the keyfile exists but is the wrong size (≠32 bytes), the system SHALL error: `"Credential keyfile is corrupt. Delete ~/.dscode/.credential-key and re-add API keys with /model-key."`
- If the keyfile is deleted after encryption, the system SHALL error on decrypt: `"Credential keyfile not found. All API keys must be re-added with /model-key <provider>."`

**Encrypted format:**
```
aes256:<base64url_iv>:<base64url_auth_tag>:<base64url_ciphertext>
```
- IV: 12 random bytes per encryption operation.
- Auth tag: 16 bytes (GCM authentication).
- AAD (additional authenticated data): `providerName` — binds the ciphertext to the specific provider, preventing cross-provider ciphertext copying.
- All base64 encoding uses the URL-safe variant (no `+` or `/`).

**New component:** `src/common/credential-vault.ts`

**Interface:**
```typescript
export function encryptCredential(plaintext: string, providerName: string): string;
export function decryptCredential(encoded: string, providerName: string): string;
export function isEncryptedCredential(value: string): boolean;
export function getOrCreateCredentialKey(): Buffer;
export function credentialKeyExists(): boolean;
export function deleteCredentialKey(): void;
```

**Integration with settings.ts:**
- `resolveSettingsSources()`: After resolving `engines[name].apiKey`, call `decryptIfNeeded(apiKey, name)`. If the value starts with `"aes256:"`, decrypt it via `credentialVault.decryptCredential()`. Otherwise, treat as plaintext (existing behavior) and schedule it for encryption on next write.
- `writeModelConfigSelection()` and `writeSettings()`: Before writing, call `encryptIfNeeded(apiKey, name)` on each `engines[name].apiKey`. If it's plaintext, encrypt it. If it's already encrypted, leave as-is (re-encrypting would change the IV unnecessarily).

**Migration (auto-encrypt on read):**
- When `resolveSettingsSources()` encounters a plaintext `apiKey` (value does NOT start with `"aes256:"`), it returns the plaintext for immediate use AND emits a log message:
  `"Migrating plaintext API key for <provider> to encrypted storage."`
- On the next `writeSettings()` call, the key is encrypted before writing. This is a natural side effect — no separate migration pass needed.
- After write, the `settings.json` no longer contains plaintext keys.

**Error handling:**
- AUTH TAG MISMATCH: `"API key for <provider> could not be decrypted (auth tag mismatch). The encrypted value may have been tampered with. Re-add with /model-key <provider>."`
- CORRUPT FORMAT: `"API key for <provider> has an invalid encrypted format. Re-add with /model-key <provider>."`
- KEYFILE MISSING: `"Credential keyfile not found at ~/.dscode/.credential-key. All API keys must be re-added with /model-key <provider>."`
- KEYFILE CORRUPT: `"Credential keyfile is corrupt (wrong size). Delete ~/.dscode/.credential-key and re-add API keys with /model-key."`

**Why:** Plaintext API keys in `settings.json` are a security risk — accidental git commits, screen shares, or file sharing can expose credentials. Encryption-at-rest with a separate keyfile mitigates the most common exposure vectors.

**Acceptance Criteria:**
- [ ] `encryptCredential("sk-test-key", "openai")` returns a string starting with `"aes256:"`.
- [ ] `decryptCredential(encrypted, "openai")` returns `"sk-test-key"`.
- [ ] `decryptCredential(encrypted, "gemini")` throws auth tag mismatch (AAD differs).
- [ ] `isEncryptedCredential("aes256:...")` returns `true`; `isEncryptedCredential("sk-...")` returns `false`.
- [ ] Keyfile is created automatically with `0600` permissions on first use.
- [ ] Keyfile corruption produces a clear error message with recovery instructions.
- [ ] Plaintext keys are auto-migrated to encrypted on write.
- [ ] All new API keys from `/model-add` and `/model-key` are encrypted.
- [ ] `settings.json` contains NO plaintext API keys after migration.
- [ ] System still boots correctly when `settings.json` contains encrypted keys.

---

## Non-Functional Requirements

### NFR-001: Zero New npm Dependencies

**What:** This spec SHALL NOT add, remove, or update any npm packages. Encryption uses only `node:crypto` (built-in).

**Acceptance Criteria:**
- [ ] `package.json` has zero changes.
- [ ] `package-lock.json` has zero changes.

### NFR-002: Type Safety

**What:** All new code SHALL pass TypeScript type checking with zero errors.

**Acceptance Criteria:**
- [ ] `npm run typecheck` passes with zero errors.

### NFR-003: Test Coverage

**What:** New modules and modified settings paths SHALL be covered by tests.

**Acceptance Criteria:**
- [ ] Tests for `credential-vault.ts`: encrypt, decrypt, AAD mismatch, keyfile create/corrupt/missing.
- [ ] Tests for each `/model-*` command handler.
- [ ] Tests for settings resolution with encrypted keys.
- [ ] Tests for settings migration (plaintext → encrypted on write).
- [ ] All existing tests pass with zero failures.

### NFR-004: Performance

**What:** Encryption/decryption operations SHALL complete in <1ms (AES-256-GCM on 32-byte keys is negligible). Settings resolution SHALL not add measurable latency (<5ms overhead for decrypting keys).

**Acceptance Criteria:**
- [ ] `encryptCredential()` completes in <1ms for typical API key lengths (~50 chars).
- [ ] `decryptCredential()` completes in <1ms.
- [ ] Settings resolution overhead from decrypting keys is <5ms (measured with 4 providers).

### NFR-005: Deterministic Behavior

**What:** Encrypting the same plaintext twice SHALL produce different ciphertexts (random IV per operation). Decrypting a valid ciphertext with the correct provider SHALL always produce the exact original plaintext.

**Acceptance Criteria:**
- [ ] Two calls to `encryptCredential("same-key", "openai")` produce different ciphertexts.
- [ ] Both ciphertexts decrypt to `"same-key"` when using correct provider name.

---

## Constraints

1. **C1:** `SessionMessage` type SHALL NOT change (ADR-004).
2. **C2:** `ILlmProvider` interface SHALL NOT change (ADR-002).
3. **C3:** `MODEL_CATALOG` SHALL NOT be modified by this spec (it is the source of truth from Spec 60/70; this spec only reads it).
4. **C4:** `DEFAULT_MODEL_PRICING` SHALL NOT be modified.
5. **C5:** The bare `/model` command handler and `ModelsDropdown` component SHALL NOT be modified.
6. **C6:** All new commands SHALL use the existing `BUFFER_TEXT_COMMANDS` or `FIXED_TEXT_COMMANDS` pattern — no new UI components or dropdowns.
7. **C7:** The `engines` field in settings SHALL continue to use its existing structure (`Record<string, { apiKey?: string; baseURL?: string }>`) — but `apiKey` values may now be ciphertext or plaintext.
8. **C8:** New settings fields (`topP`, `thinkingBudgets`) SHALL be optional with sensible defaults — existing `settings.json` files must remain valid.
9. **C9:** The credential keyfile path SHALL be `~/.dscode/.credential-key` (same directory as user `settings.json`).

---

## Edge Cases & Error States

| # | Scenario | Expected Behavior |
|---|---|---|
| EC1 | User types `/model-list` when no providers have API keys configured | All providers shown with `❌ no key`. Models listed normally. |
| EC2 | User types `/model-add openai` when `engines.openai.apiKey` is set via env var `DEEPCODE_ENGINE_OPENAI_API_KEY` but NOT in settings.json | Detect env var via `resolveSettingsSources()`: `engines.openai.apiKey` exists in resolved settings. Show "already configured" error. |
| EC3 | User types `/model-add gemini` and enters the key wrong → confirms → realizes mistake | Uses `/model-key gemini` to overwrite. The old ciphertext is replaced. |
| EC4 | User types `/model-remove openai` then regrets it | Re-add with `/model-add openai`. The old key is gone (encrypted value was deleted); user must re-enter the key. |
| EC5 | User sets `temperature: 2.5` via `/model-params` | Validation rejects: `"Temperature must be between 0.0 and 2.0."` Re-prompt. |
| EC6 | User sets `top_p: "none"` via `/model-params` | Field is cleared (set to `undefined` in resolved settings). Subsequent `/model-params` shows `"Top P: not set"`. |
| EC7 | User changes `max_tokens` to 999999 for DeepSeek V4 Pro (maxOutput: 131072) | Validation rejects: `"Max tokens must be between 1 and 131072."` Re-prompt. |
| EC8 | `~/.dscode/.credential-key` is deleted after API keys are encrypted | On next settings read, `decryptCredential()` throws keyfile-missing error. Settings resolution fails with clear error message. App shows error on startup. User must `rm ~/.dscode/.credential-key` (if exists but wrong) and re-add keys via `/model-key`. |
| EC9 | User copies `settings.json` to another machine without copying `.credential-key` | Keys cannot be decrypted. System shows keyfile-not-found error on startup. User must re-add keys. |
| EC10 | User has `engines.gemini.apiKey: "plaintext-old-key"` in settings.json (pre-FR-011) | First read: decrypt sees it's plaintext, returns it normally. First write (any settings change): encrypts it automatically. |
| EC11 | User sets thinking budget to 512 for a model | Validation rejects: `"Budget must be between 1024 and <maxOutput>."` |
| EC12 | User types `/model-list` while a response is streaming | `BUFFER_TEXT_COMMANDS` are blocked when busy (existing behavior in `executeSlashCommand`). The command is held until the stream completes, then processed. |
| EC13 | User types `/model-add gemini` but Gemini has `reasoning.type: "adaptive"` and no thinking budget configuration | `/model-add` does not configure thinking — only API key and base URL. Thinking budget is configured separately via `/model-thinking`. This is expected — no error. |
| EC14 | User types `/model-default deepseek-v4-pro` but has no API keys at all | Model is set as default. No warning (FR-006 only warns if the model's provider has no key). Since `deepseek` has global `apiKey` fallback, and if that's also empty, the warning is shown on next message send (Spec 60 FR-005). |
| EC15 | User has 4 providers, removes one with `/model-remove`, then types `/model-list` | Removed provider still appears (it's in `MODEL_CATALOG`) but shows `❌ no key`. Its models are listed with pricing. |
| EC16 | User configures a custom base URL with trailing slash `/` | URL is stored as-entered (no normalization). The provider's client factory handles trailing slash (existing behavior in `createOpenAIClient`, etc.) |
| EC17 | User encrypts a key, then the keyfile permissions are set to `0777` | The `getOrCreateCredentialKey()` function creates the file with `0600` but does NOT validate existing file permissions. If permissions are wrong, the OS still allows the owning user to read. This is acceptable for a CLI tool. |
| EC18 | Two providers have the same API key value | Each encryption is independent (different IV, different AAD). Ciphertexts differ. No information leaked about the keys being identical. |
| EC19 | User interrupts a wizard step with Ctrl+C | The process exits (existing DsCode behavior). No partial settings write occurred — wizard writes only on final confirmation. |

---

## Dependencies

- **Spec 60** (`model-selection-configuration`): Provides `MODEL_CATALOG`, `ModelEntry`, `ModelCapabilities`, `getModelCapabilities()`, `THINKING_OPTIONS_BY_TYPE`, `ThinkingEffort` type, `ModelConfigSelection` type. This spec READS these types and functions but does NOT modify them.
- **Spec 30** (`provider-agnostic-llm-layer`): Provides `ILlmProvider` and `createLlmProvider()` — used indirectly via key status checks.
- **ADR-002** (Provider Interface Pattern): `createLlmProvider()` key resolution logic is the reference for API key status checks.
- **P7** (Provider-Agnostic Configuration): `engines` namespace already exists in settings — this spec adds encryption to the `apiKey` field but does NOT change the namespace structure.
- **L1** (Layer Multi-Provider Work): Each FR is independently testable. The spec is one cohesive unit but tasks are ordered sequentially.

---

## Out of Scope

- **Provider health checks** (pinging API endpoints to verify key validity) — the key status check only tests whether a key is CONFIGURED, not whether it's VALID.
- **API key rotation automation** — users manually update keys via `/model-key`.
- **Multi-user credential sharing** — the keyfile is per-OS-user, not shared.
- **Keychain/OS-level credential storage** (DPAPI, macOS Keychain, libsecret) — this spec uses local AES-256-GCM. OS keychain is a potential future upgrade (Spec 85 candidate).
- **Model search/filter in `/model` dropdown** — the dropdown is unchanged from Spec 60. Search/filter is a future UX enhancement.
- **Quick-switch syntax** (`/model gpt-5.5` to switch without dropdown) — this is a future enhancement.
- **Cost preview during model selection** — the `/model` dropdown is unchanged. Cost info is available via `/model-info` and `/model-list`.
- **OAuth or interactive browser-based authentication** for providers — only API key authentication is supported.
- **Key rotation logging or audit trail** — key changes are written to settings but not separately logged.
- **Custom provider registration** outside `MODEL_CATALOG` — providers must exist in the catalog.
- **Settings import/export** for sharing provider configurations between machines.
