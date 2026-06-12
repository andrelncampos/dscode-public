# Spec 80: Model & Engine Configuration UX — Design

## Design Approach

This spec follows **text-commands-only**: all 8 new subcommands (`/model-list`, `/model-add`, `/model-remove`, `/model-info`, `/model-key`, `/model-default`, `/model-params`, `/model-thinking`) are implemented as `BUFFER_TEXT_COMMANDS` — they are submitted to the session as prompt text with a `command` kind, processed synchronously in `SessionManager`, and produce response messages displayed in the chat. Zero new React/Ink components. Zero changes to `App.tsx`, `PromptInput.tsx`, or `ModelsDropdown`.

**Principles applied:**
- **P1 (Interface-First):** `credentialVault` exposes a minimal interface (encrypt, decrypt, isEncrypted). The command handlers consume it through a single import.
- **P2 (Canonical Types):** All commands read from `MODEL_CATALOG`, `DEFAULT_MODEL_PRICING`, and resolved settings — no duplicate data sources.
- **P4 (Surgical Changes):** Only files that need new behavior are touched. `slash-commands.ts` gets 8 new entries. `command-handlers.ts` gets 8 new `BUFFER_TEXT_COMMANDS` entries. `commands.ts` type file gets 8 new kind literals. `session.ts` gets a dispatch table for `/model-*` commands. `settings.ts` gets encryption integration.
- **P5 (Test Integrity):** All existing tests pass. New tests cover only new behavior.
- **P6 (Zero New Dependencies):** Encryption uses `node:crypto` (built-in). No npm packages added.
- **P7 (Provider-Agnostic Configuration):** New settings fields (`topP`, `thinkingBudgets`) are provider-agnostic.

---

## Architecture Decisions

### AD-SPEC80-001: All `/model-*` commands are BUFFER_TEXT_COMMANDS, not direct handlers

**Decision:** All new `/model-*` commands are registered as `BUFFER_TEXT_COMMANDS` — submitted to `SessionManager` as prompt text with a `command` field. `SessionManager` dispatches to handler functions based on the `command` value. No new entries in `COMMAND_HANDLERS` (the `Record<string, CommandHandler>` map).

**Rationale:** Multi-step commands (`/model-add`, `/model-params`) require reading subsequent user input. The `CommandContext` pattern (used by `command-handlers.ts`) only supports single-shot actions (toggle dropdown, submit fixed text). `BUFFER_TEXT_COMMANDS` already supports multi-turn interactions via `SessionManager`'s reply loop. Following L1 (layer work), this avoids adding complexity to the UI layer.

**Consequence:** `SessionManager` gets a new module `src/ui/core/model-command-handlers.ts` that exports handler functions invoked by `SessionManager.replySession()` when `command` starts with `"model-"`. Each handler receives `(session, settings, input: string) => Promise<string>` and returns the response text to display in chat.

### AD-SPEC80-002: Keyfile is separate from settings.json

**Decision:** The AES-256-GCM encryption key is stored in `~/.dscode/.credential-key` (NOT embedded in settings.json). This file has `0600` permissions.

**Rationale:** Storing the key in the same file as the ciphertext is equivalent to plaintext (anyone who can read settings.json can read the key). A separate keyfile with strict permissions provides a meaningful security boundary: the `settings.json` can be accidentally shared/committed/exposed without revealing the keys.

**Consequence:** The keyfile MUST be present on the same machine for decryption. Copying `settings.json` to another machine requires also copying `.credential-key`, or re-adding API keys. This is an acceptable tradeoff for a CLI tool.

### AD-SPEC80-003: AAD (Additional Authenticated Data) binds ciphertext to provider name

**Decision:** The GCM encryption includes the provider name as AAD: `encryptCredential(plaintext, providerName)` → ciphertext that can ONLY be decrypted with `decryptCredential(ciphertext, providerName)`. Using a different provider name produces an auth tag mismatch.

**Rationale:** Prevents an attacker from copying the ciphertext from `engines.openai.apiKey` to `engines.gemini.apiKey` in settings.json — the AAD check would fail. This is a defense-in-depth measure; the primary protection is the keyfile.

**Consequence:** All call sites must pass the correct provider name. The `resolveSettingsSources()` function already knows the provider name from the `engines` record key.

### AD-SPEC80-004: Auto-migration is lazy (on write), not eager (on read)

**Decision:** When reading a plaintext `apiKey`, the system returns it immediately (no blocking migration). The encryption happens on the next `writeSettings()` call. If the user never changes settings, the key stays plaintext — but any `/model-*` command that writes settings will trigger migration.

**Rationale:** Settings reads happen on every message send (hot path). Adding encryption on read would add latency to every message. Deferring to write ensures the hot path stays fast and migration happens naturally during any settings mutation.

**Consequence:** Plaintext keys may persist in `settings.json` if the user never modifies settings. This is acceptable — the next time they use `/model-add`, `/model-key`, `/model-default`, `/model-params`, `/model-thinking`, or even `/model` (which calls `writeModelConfigSelection`), migration happens automatically.

### AD-SPEC80-005: `topP` is a single optional field, not a nested params object

**Decision:** Add `topP?: number` to `DeepcodingSettings` and `ResolvedDeepcodingSettings`. Do NOT create a nested `generationParams: { temperature, maxTokens, topP }` object.

**Rationale:** `temperature` and `maxTokens` are already top-level fields in settings. Nesting would break backward compatibility with existing `settings.json` files and add unnecessary diff noise. A flat structure is consistent with the existing schema.

**Consequence:** Three separate top-level fields control generation: `temperature`, `maxTokens`, `topP`. All three are edited together via `/model-params` but stored separately for backward compatibility.

---

## Component / Module Breakdown

### Component 1: `credential-vault.ts` — Encrypted Credential Storage

**File:** `src/common/credential-vault.ts` (NEW)

**Purpose:** Provide AES-256-GCM encryption/decryption for API keys, backed by a local keyfile.

**Interface:**
```typescript
import * as crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // bytes
const AUTH_TAG_LENGTH = 16; // bytes
const KEY_LENGTH = 32; // bytes
const PREFIX = "aes256:";

/** Encrypt a plaintext credential, bound to a specific provider via AAD. */
export function encryptCredential(plaintext: string, providerName: string): string;

/** Decrypt a credential previously encrypted with encryptCredential. */
export function decryptCredential(encoded: string, providerName: string): string;

/** Check if a value is an encrypted credential (starts with "aes256:"). */
export function isEncryptedCredential(value: string): boolean;

/** Get the credential key file path. */
export function getCredentialKeyPath(): string;

/** Generate (if needed) and return the 32-byte credential key. */
export function getOrCreateCredentialKey(): Buffer;

/** Check if the keyfile exists and is valid. */
export function credentialKeyExists(): boolean;

/** Delete the keyfile (for recovery). */
export function deleteCredentialKey(): void;
```

**Internal Logic:**

**`encryptCredential(plaintext, providerName)`:**
1. `const key = getOrCreateCredentialKey()` — get or create the 32-byte key.
2. `const iv = crypto.randomBytes(IV_LENGTH)` — random 12-byte IV.
3. `const cipher = crypto.createCipheriv(ALGORITHM, key, iv)`.
4. `cipher.setAAD(Buffer.from(providerName, "utf8"))` — bind to provider.
5. `const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])`.
6. `const tag = cipher.getAuthTag()` — 16-byte GCM auth tag.
7. Return `PREFIX + [iv, tag, encrypted].map(b => b.toString("base64url")).join(":")`.

**`decryptCredential(encoded, providerName)`:**
1. Verify `encoded.startsWith(PREFIX)`. If not, throw `new Error("Not an encrypted credential")`.
2. `const parts = encoded.slice(PREFIX.length).split(":")`.
3. If `parts.length !== 3`, throw `new Error("Invalid encrypted credential format")`.
4. `const [ivB64, tagB64, ctB64] = parts`.
5. `const iv = Buffer.from(ivB64, "base64url")`; verify length === 12.
6. `const tag = Buffer.from(tagB64, "base64url")`; verify length === 16.
7. `const ct = Buffer.from(ctB64, "base64url")`.
8. `const key = getOrCreateCredentialKey()`.
9. `const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)`.
10. `decipher.setAAD(Buffer.from(providerName, "utf8"))` — same AAD as encryption.
11. `decipher.setAuthTag(tag)`.
12. `const decrypted = Buffer.concat([decipher.update(ct), decipher.final()])`.
13. Return `decrypted.toString("utf8")`.
14. On `decipher.final()` throwing due to auth tag mismatch: throw `new Error("Authentication failed — key may have been tampered with or wrong provider")`.

**`getOrCreateCredentialKey()`:**
1. `const keyPath = getCredentialKeyPath()` → resolves to `path.join(process.env.HOME || process.env.USERPROFILE || homedir(), ".dscode", ".credential-key")` where `homedir` is imported from `node:os`.
2. If file exists: `const data = fs.readFileSync(keyPath)`; verify `data.length === 32`; if not, throw `new Error("Credential keyfile is corrupt (expected 32 bytes, got <n>). Delete ~/.dscode/.credential-key and re-add API keys with /model-key.")`; return `data`.
3. If file does not exist: `const key = crypto.randomBytes(32)`; `fs.mkdirSync(path.dirname(keyPath), { recursive: true })`; `fs.writeFileSync(keyPath, key, { mode: 0o600 })`; return `key`.

**`getCredentialKeyPath()`:**
- Returns `path.join(process.env.HOME || process.env.USERPROFILE || homedir(), ".dscode", ".credential-key")` where `homedir` is imported from `node:os`.

**`credentialKeyExists()`:**
- Returns `fs.existsSync(getCredentialKeyPath())`.

**`deleteCredentialKey()`:**
- `fs.unlinkSync(getCredentialKeyPath())` if exists; swallow `ENOENT`.

**Dependencies:** `node:crypto`, `node:fs`, `node:path`, `node:os` (for `homedir`).

**Error Handling:**
| Error | Exception thrown | Recovery |
|-------|-----------------|----------|
| Keyfile missing | `Error("Credential keyfile not found at <path>.")` | `rm -rf ~/.dscode/.credential-key` then `/model-key` |
| Keyfile wrong size | `Error("Credential keyfile is corrupt (expected 32 bytes, got <n>).")` | `rm ~/.dscode/.credential-key` then `/model-key` |
| Auth tag mismatch | `Error("Authentication failed...")` with provider info | `/model-key <provider>` to re-add |
| Invalid format (non-aes256) | `Error("Not an encrypted credential")` | Treat as plaintext |
| Invalid format (wrong parts) | `Error("Invalid encrypted credential format")` | `/model-key <provider>` to re-add |

---

### Component 2: `model-command-handlers.ts` — Command Handler Functions

**File:** `src/ui/core/model-command-handlers.ts` (NEW)

**Purpose:** Pure functions that handle each `/model-*` command. They receive settings, model catalog data, and user input; they return a response string.

**Interface:**
```typescript
import type { ResolvedDeepcodingSettings } from "../../settings";
import type { ModelEntry } from "../../common/model-catalog";

export type ModelCommandContext = {
  settings: ResolvedDeepcodingSettings;
  catalog: ModelEntry[];
  /** The full user input text (e.g., "/model-add gemini" or subsequent wizard responses). */
  input: string;
  /** Path to the user's settings.json directory (~/.dscode). */
  settingsDir: string;
  /** For multi-step commands: the accumulated state from previous steps. */
  wizardState?: Record<string, unknown>;
};

export type ModelCommandResult = {
  /** Response text to display in chat. */
  message: string;
  /** If true, the command needs more user input (wizard continues). */
  needsMoreInput: boolean;
  /** Updated wizard state for next step (only when needsMoreInput). */
  wizardState?: Record<string, unknown>;
  /** If true, settings were modified and the session should re-resolve settings. */
  settingsChanged: boolean;
};

export function handleModelList(ctx: ModelCommandContext): ModelCommandResult;
export function handleModelAdd(ctx: ModelCommandContext): ModelCommandResult;
export function handleModelRemove(ctx: ModelCommandContext): ModelCommandResult;
export function handleModelInfo(ctx: ModelCommandContext): ModelCommandResult;
export function handleModelKey(ctx: ModelCommandContext): ModelCommandResult;
export function handleModelDefault(ctx: ModelCommandContext): ModelCommandResult;
export function handleModelParams(ctx: ModelCommandContext): ModelCommandResult;
export function handleModelThinking(ctx: ModelCommandContext): ModelCommandResult;
```

**Internal Logic for each handler:**

#### `handleModelList(ctx)`
1. Group `ctx.catalog` by `provider`.
2. For each provider group:
   - Determine key status using the same logic as `createLlmProvider`:
     - `deepseek`: key exists if `ctx.settings.apiKey` is truthy.
     - `openai`: key exists if `ctx.settings.engines.openai?.apiKey` OR `ctx.settings.apiKey` is truthy.
     - `anthropic`: key exists if `ctx.settings.engines.anthropic?.apiKey` is truthy.
     - `gemini`: key exists if `ctx.settings.engines.gemini?.apiKey` is truthy.
   - Resolve base URL: `engines[provider].baseURL` or provider default.
   - Compute price range: min and max `DEFAULT_MODEL_PRICING[id].inputPrice` across provider's models.
   - List models with pricing from `DEFAULT_MODEL_PRICING`.
3. Format as text:
   ```
   ┌─ deepseek ─────────────────────────────────────────────────
   │ ✅ key  ·  https://api.deepseek.com  ·  2 models  ·  $0.14–$0.44/1M
   │   deepseek-v4-pro    DeepSeek V4 Pro     $0.44/$0.87
   │   deepseek-v4-flash  DeepSeek V4 Flash   $0.14/$0.28
   └─────────────────────────────────────────────────────────────
   ```
   (Repeat for each provider.)
4. Return `{ message: formattedText, needsMoreInput: false, settingsChanged: false }`.

#### `handleModelAdd(ctx)`
This is a multi-step wizard. State machine driven by `wizardState.step`:

**Step "init":**
- Extract provider from `ctx.input`. Format: `/model-add <provider>`.
- Validate provider exists in `MODEL_CATALOG`. If not: return error listing valid providers from `MODEL_CATALOG`.
- Check if provider already has a key at the RESOLVED level (same logic as `handleModelList` key status: deepseek→global apiKey; openai→engine key OR global apiKey; anthropic→engine key; gemini→engine key).
- If already configured, return error `"Provider '<provider>' already has an API key configured. Use /model-key <provider> to update it."` with `needsMoreInput: false`.
- Determine default base URL for this provider:
  | Provider | Default Base URL |
  |---|---|
  | `deepseek` | `https://api.deepseek.com` |
  | `openai` | `https://api.openai.com/v1` |
  | `anthropic` | `https://api.anthropic.com` |
  | `gemini` | `https://generativelanguage.googleapis.com/v1beta` |
- Return: `{ message: "Base URL: <defaultUrl>. Press ENTER to accept default, or type a custom URL:", needsMoreInput: true, wizardState: { step: "baseUrl", provider, defaultBaseUrl } }`.

**Step "baseUrl":**
- `const input = ctx.input.trim()`.
- If input is empty → use default base URL for this provider.
- If input is non-empty → validate URL format (starts with http:// or https://). Invalid → error, `needsMoreInput: true` with same step re-prompt.
- Return: `{ message: "API Key required. Obtain one at: <url>.\nEnter API key (or ESC to cancel):", needsMoreInput: true, wizardState: { step: "apiKey", provider, baseUrl: input || default } }`.

**Step "apiKey":**
- `const apiKey = ctx.input.trim()`.
- Validate: non-empty AND ≥8 chars. Invalid → error re-prompt with same step.
- Return: `{ message: "Press ENTER to confirm, or type \"retry\" to re-enter:\n  Provider: <provider>\n  Base URL: <baseUrl>\n  API Key: <first4>...<last4>", needsMoreInput: true, wizardState: { step: "confirm", provider, baseUrl, apiKey } }`.

**Step "confirm":**
- If input is `"retry"` → return to baseUrl step: `{ message: "Base URL: <previous>. Press ENTER...", needsMoreInput: true, wizardState: { step: "baseUrl", provider, baseUrl, apiKey: undefined } }`.
- If input is empty (ENTER) → proceed to write.
- Write settings:
  1. `const encrypted = encryptCredential(apiKey, provider)`.
  2. Read current settings via `readSettings()`.
  3. Set `settings.engines[provider] = { apiKey: encrypted }`.
  4. If `baseUrl` differs from provider default, set `settings.engines[provider].baseURL = baseUrl`.
  5. Call `writeSettings(settings)`.
- Build success message with model list from catalog.
- Return `{ message: successText, needsMoreInput: false, settingsChanged: true }`.

#### `handleModelRemove(ctx)`
- Extract provider from input: `/model-remove <provider>`. If absent: return error listing currently configured providers.
- Validate provider exists in `MODEL_CATALOG`. If not: return error.
- Check if provider has a configuration in `engines` (i.e., `engines[provider]` key exists in raw settings). If not: return `"Provider '<provider>' is not configured. Nothing to remove."`.
- Determine if this is a dangerous removal:
  1. Check if this provider is the **sole** provider with an API key (using same resolved logic as `handleModelList`): count providers with keys. If count === 1 AND the current model's provider matches → WARN: `"Warning: <provider> is the only configured provider and is currently active. Removing it will leave no API keys. Continue? Type 'yes' to confirm."`
  2. Else if the current model's provider matches this provider but others have keys → WARN: `"Warning: the current model '<model-id>' uses <provider>. After removal, switch to another model with /model. Continue? Type 'yes' to confirm."`
  3. Otherwise → no warning, show simple confirmation: `"Remove provider '<provider>'? Type 'yes' to confirm."`
- If warning/confirmation shown: return `{ message: warning, needsMoreInput: true, wizardState: { step: "confirmRemove", provider } }`.
- On `step === "confirmRemove"`: if `ctx.input.trim()` === `"yes"` → delete `delete settings.engines[provider]`, write settings, return `{ message: "✅ Provider '<provider>' removed...", needsMoreInput: false, settingsChanged: true }`. Any other input → return `{ message: "Cancelled.", needsMoreInput: false, settingsChanged: false }`.
- If no warning was needed (edge case): delete immediately without confirmation prompt.

#### `handleModelInfo(ctx)`
- Extract model ID from input: `/model-info <id>`.
- Look up in `MODEL_CATALOG`. On not found, return error.
- Query `getModelCapabilities(id)`.
- Check API key status for model's provider.
- Format output (FR-004).
- Return `{ message: formattedText, needsMoreInput: false, settingsChanged: false }`.

#### `handleModelKey(ctx)`
- Extract provider from input: `/model-key <provider>`.
- Validate provider exists in `MODEL_CATALOG`. On unknown: return error listing valid providers.
- If provider is not in `ctx.settings.engines` (no entry at all): return error `"Provider '<provider>' is not configured. Use /model-add <provider> first."` with an additional hint if a matching env var `DEEPCODE_ENGINE_<PROVIDER_UPPER>_API_KEY` exists: `"Note: <provider> may have a key set via environment variable DEEPCODE_ENGINE_<PROVIDER_UPPER>_API_KEY. Setting a key in settings.json will override the env var."`
- If first call (bare `/model-key <provider>`, wizardState is undefined or step is "init"):
  - Check current key state:
    1. If `engines[provider].apiKey` exists in settings (raw, pre-resolution): try decrypt via `decryptCredential()`; on success, show `"Current key: <first4>...<last4>"`; on decrypt failure, show `"Current key: encrypted (cannot decrypt — keyfile may be missing)."`
    2. If NO `engines[provider].apiKey` in settings BUT the resolved `ctx.settings.engines[provider]?.apiKey` is truthy (from env var): show `"Current key: set via environment variable DEEPCODE_ENGINE_<PROVIDER_UPPER>_API_KEY."`
    3. If no key at all: show `"Current key: not set."`
  - Prompt: `"Enter new API key (or ESC to cancel):"`
  - Return `{ needsMoreInput: true, wizardState: { step: "enterKey", provider } }`.
- If second call (wizardState.step === "enterKey"):
  - Validate: input non-empty AND ≥8 chars. Invalid → re-prompt same step.
  - Encrypt via `encryptCredential(apiKey, provider)`.
  - Read settings, set `engines[provider] = { apiKey: encryptedText, apiKeyEncrypted: true }` (preserve existing `baseURL` if any).
  - Write settings.
  - Return `{ message: "✅ API key for <provider> updated. <first4>...<last4>", needsMoreInput: false, settingsChanged: true }`.

#### `handleModelDefault(ctx)`
- Extract model ID: `/model-default <id>`.
- Validate model exists in catalog.
- Check provider key status for warning.
- Write `settings.model = id` via `writeSettings()`.
- Return `{ message: "✅ Default model set to <displayName> (<id>).", needsMoreInput: false, settingsChanged: true }`.

#### `handleModelParams(ctx)`
Multi-step editor. State machine:

**Step "init":**
- Read current `temperature` (default `1.0` if undefined), `maxTokens` (default the model's `maxOutput` if undefined), `topP` (may be `undefined` = "not set") from `ctx.settings`.
- Read current model's `maxOutput` from `MODEL_CATALOG` for the current model.
- Show current values with their valid ranges.
- Prompt: `"Which parameter? (temperature/max_tokens/top_p) or 'done' to finish:"`
- Returns `{ needsMoreInput: true, wizardState: { step: "chooseParam", pending: { temperature: settings.temperature ?? 1.0, maxTokens: settings.maxTokens ?? modelMaxOutput, topP: settings.topP }, currentModel: settings.model } }`.

**Step "chooseParam":**
- Parse input: `temperature`, `max_tokens`, `top_p`, or `done`.
- If `done`: write all pending values, return success.
- If valid param: prompt for new value, advance to "enterValue" step.
- Returns `{ needsMoreInput: true, wizardState: { step: "enterValue", param, pending, currentModel, modelMax } }`.

**Step "enterValue":**
- Validate input per FR-007 rules (range, type).
- Update pending value.
- Return to "chooseParam" step.

#### `handleModelThinking(ctx)`
- Extract model ID: `/model-thinking <id>`.
- Validate model exists in `MODEL_CATALOG`. If not: return error with suggestion to use `/model`.
- If model's `reasoning.type !== "extended"`: return error `"Model '<displayName>' has reasoning type '<type>'. Thinking budget is only configurable for extended thinking models."` followed by list of extended-thinking models from catalog.
- Compute current budget via resolution chain:
  1. `ctx.settings.thinkingBudgets[modelId]` (user override in settings).
  2. `MODEL_CATALOG.find(m => m.id === modelId)?.reasoning.budgetTokens` (catalog default).
  3. `8192` (hardcoded fallback).
- Show current budget and model maxOutput.
- If first call (wizardState undefined or step "init"): prompt `"Enter thinking budget in tokens (1024–<maxOutput>, or ENTER for default 8192):"`. Return `{ needsMoreInput: true, wizardState: { step: "enterBudget", modelId, maxOutput } }`.
- If second call (step === "enterBudget"):
  - Parse input: if empty → budget = 8192. Otherwise parse as integer.
  - Validate: integer, 1024 ≤ budget ≤ maxOutput. Invalid → re-prompt same step.
  - Read settings, set `settings.thinkingBudgets[modelId] = budget`.
  - Write settings.
  - Return `{ message: "✅ Thinking budget for <displayName> set to <budget> tokens.", needsMoreInput: false, settingsChanged: true }`.

**Dependencies:** `credential-vault.ts` (for encrypt/decrypt), `model-catalog.ts` (MODEL_CATALOG, getModelCapabilities), `model-capabilities.ts` (DEFAULT_MODEL_PRICING), `settings.ts` (readSettings, writeSettings, DeepcodingSettings).

---

### Component 3: Slash Command Registration

**File:** `src/ui/core/slash-commands.ts` (MODIFY)

**Changes:** Add 8 new `SlashCommandItem` entries to `BUILTIN_SLASH_COMMANDS`:

```typescript
{
  kind: "model-list",
  name: "model-list",
  label: "/model-list",
  description: "List configured LLM providers with their models and pricing",
},
{
  kind: "model-add",
  name: "model-add",
  label: "/model-add",
  args: ["<provider>"],
  description: "Add a new LLM provider with API key and base URL",
},
{
  kind: "model-remove",
  name: "model-remove",
  label: "/model-remove",
  args: ["<provider>"],
  description: "Remove a configured LLM provider",
},
{
  kind: "model-info",
  name: "model-info",
  label: "/model-info",
  args: ["<model-id>"],
  description: "Show detailed information about a specific model",
},
{
  kind: "model-key",
  name: "model-key",
  label: "/model-key",
  args: ["<provider>"],
  description: "Update API key for a configured provider",
},
{
  kind: "model-default",
  name: "model-default",
  label: "/model-default",
  args: ["<model-id>"],
  description: "Set the default model",
},
{
  kind: "model-params",
  name: "model-params",
  label: "/model-params",
  description: "Configure generation parameters (temperature, max_tokens, top_p)",
},
{
  kind: "model-thinking",
  name: "model-thinking",
  label: "/model-thinking",
  args: ["<model-id>"],
  description: "Configure thinking budget for extended-thinking models",
},
```

**File:** `src/ui/types/commands.ts` (MODIFY)

Add 8 new literals to `COMMAND_KINDS`:
```typescript
"model-list",
"model-add",
"model-remove",
"model-info",
"model-key",
"model-default",
"model-params",
"model-thinking",
```

Add 8 new literals to `PROMPT_COMMAND_KINDS`:
```typescript
"model-list",
"model-add",
"model-remove",
"model-info",
"model-key",
"model-default",
"model-params",
"model-thinking",
```

**File:** `src/ui/core/command-handlers.ts` (MODIFY)

Add 8 new entries to `BUFFER_TEXT_COMMANDS`:
```typescript
const BUFFER_TEXT_COMMANDS: Set<SlashCommandKind> = new Set([
  "steering-add",
  "spec-plan",
  "spec-new",
  "spec-verify",
  "spec-implement",
  "spec-audit",
  "spec-status",
  "model-list",      // NEW
  "model-add",       // NEW
  "model-remove",    // NEW
  "model-info",      // NEW
  "model-key",       // NEW
  "model-default",   // NEW
  "model-params",    // NEW
  "model-thinking",  // NEW
]);
```

No changes to `COMMAND_HANDLERS` or `FIXED_TEXT_COMMANDS` — all new commands are `BUFFER_TEXT_COMMANDS`.

---

### Component 4: Settings Schema Extensions

**File:** `src/common/settings-schema.ts` (MODIFY)

**New field `topP`:**
```typescript
// Inside deepcodingSettingsSchema, add:
topP: z.number().min(0).max(1).optional(),
```

**New field `thinkingBudgets`:**
```typescript
// Inside deepcodingSettingsSchema, add:
thinkingBudgets: z.record(z.string(), z.number().int().min(1024)).optional(),
```

**New field `apiKeyEncrypted` on EngineEntry:**
```typescript
// In EngineEntry type and engineEntrySchema, add:
apiKeyEncrypted: z.boolean().optional(),
```

This field is set to `true` when an API key is encrypted. It is informational — the system detects encryption from the `aes256:` prefix. But having it in the schema allows the system to distinguish "encrypted key" from "plaintext but happens to start with aes256:" (unlikely, but safe).

**File:** `src/settings.ts` (MODIFY)

**Add `topP` to `DeepcodingSettings`:**
```typescript
topP?: number;
```

**Add `thinkBudgets` to `DeepcodingSettings`:**
```typescript
thinkingBudgets?: Record<string, number>;
```

**Add `topP` to `ResolvedDeepcodingSettings`:**
```typescript
topP?: number;
```

**Add `thinkingBudgets` to `ResolvedDeepcodingSettings`:**
```typescript
thinkingBudgets: Record<string, number>; // default: {}
```

**Resolve `topP` in `resolveSettingsSources()`:**
```typescript
topP: projectSettings?.topP ?? userSettings?.topP, // undefined is valid (not set)
```

**Resolve `thinkingBudgets` in `resolveSettingsSources()`:**
```typescript
thinkingBudgets: projectSettings?.thinkingBudgets ?? userSettings?.thinkingBudgets ?? {},
```

---

### Component 5: Encryption Integration in Settings Resolution

**File:** `src/settings.ts` (MODIFY)

**New helper function:**
```typescript
import { isEncryptedCredential, decryptCredential } from "./common/credential-vault";

function resolveApiKey(rawKey: string | undefined, engineName: string): string | undefined {
  if (!rawKey) return undefined;
  if (isEncryptedCredential(rawKey)) {
    return decryptCredential(rawKey, engineName);
  }
  // Plaintext — return as-is; will be encrypted on next write.
  return rawKey;
}
```

**Integration in `resolveSettingsSources()`:**
After the existing engine resolution block (where `engines[name].apiKey` is populated from env vars and settings), wrap each key:

```typescript
// After the existing merge logic for engines:
for (const [engineName, config] of Object.entries(resolvedEngines)) {
  if (config.apiKey) {
    config.apiKey = resolveApiKey(config.apiKey, engineName);
  }
}
```

**Integration in `writeSettings()`:**
Before writing, encrypt any plaintext keys:

```typescript
import { encryptCredential, isEncryptedCredential } from "./common/credential-vault";

function encryptApiKeys(settings: DeepcodingSettings): DeepcodingSettings {
  if (!settings.engines) return settings;
  const engines = { ...settings.engines };
  for (const [name, config] of Object.entries(engines)) {
    if (config.apiKey && !isEncryptedCredential(config.apiKey)) {
      engines[name] = {
        ...config,
        apiKey: encryptCredential(config.apiKey, name),
        apiKeyEncrypted: true,
      };
    }
  }
  return { ...settings, engines };
}

// In writeSettings and writeProjectSettings, before atomicWriteJsonFileSync:
settings = encryptApiKeys(settings);
```

---

### Component 6: `SessionManager` Dispatch for `/model-*` Commands

**File:** `src/session.ts` (MODIFY)

**New import:**
```typescript
import * as ModelCommandHandlers from "./ui/core/model-command-handlers";
```

**Dispatch in `replySession()`:**
In the method where `command` is processed (near the existing `/init`, `/mcp`, etc. handling), add a branch:

```typescript
if (command && command.startsWith("model-")) {
  const ctx: ModelCommandHandlers.ModelCommandContext = {
    settings: this.getResolvedSettings(),
    catalog: MODEL_CATALOG,
    input: text,
    settingsDir: path.dirname(getUserSettingsPath()),
  };
  const handler = ModelCommandHandlers[`handle${pascalCase(command)}`];
  if (handler) {
    const result = handler(ctx);
    if (result.message) {
      this.addSystemMessage(result.message);
    }
    if (result.settingsChanged) {
      // Invalidate settings cache so next message uses fresh settings.
      clearSettingsCache();
    }
    if (result.needsMoreInput) {
      // Store wizard state for the next message.
      this.pendingCommandWizard = { command, wizardState: result.wizardState };
    }
    return;
  }
}
```

**Wizard state persistence:**
- Add a field `pendingCommandWizard` to `SessionManager` class:
  ```typescript
  private pendingCommandWizard: { command: string; wizardState: Record<string, unknown> } | null = null;
  ```
- On next user message, if `pendingCommandWizard` is set, inject `wizardState` into the command context and pass the raw user input as the wizard response.

---

## Data Flow

### `/model-list` Flow
```
User types /model-list
  → PromptInput captures text "/model-list"
  → executeSlashCommand finds "model-list" in BUFFER_TEXT_COMMANDS
  → onSubmit({ text: "/model-list", command: "model-list" })
  → SessionManager.replySession() receives command="model-list"
  → ModelCommandHandlers.handleModelList(ctx)
  → Reads MODEL_CATALOG, DEFAULT_MODEL_PRICING, resolved settings
  → Formats provider table as text
  → addSystemMessage(formattedText)
  → Returns (no settings changed, no more input needed)
```

### `/model-add` Flow (multi-step)
```
User types /model-add gemini
  → onSubmit({ text: "/model-add gemini", command: "model-add" })
  → handleModelAdd({ step: "init" })
  → Returns: needsMoreInput=true, wizardState={ step:"baseUrl", provider:"gemini" }
  → System stores pendingCommandWizard
  → System message shows base URL prompt

User types ENTER (empty)
  → next reply: pendingCommandWizard detected → injects wizardState
  → handleModelAdd({ step: "baseUrl", wizardState, input: "" })
  → Returns: needsMoreInput=true, wizardState={ step:"apiKey", provider:"gemini", baseUrl:"https://..." }
  → System message shows API key prompt

User types AIzaSyB...
  → handleModelAdd({ step: "apiKey", input: "AIzaSyB..." })
  → Returns: needsMoreInput=true, wizardState={ step:"confirm", ..., apiKey:"AIzaSyB..." }
  → System message shows confirmation

User types ENTER (confirm)
  → handleModelAdd({ step: "confirm", input: "" })
  → encryptCredential("AIzaSyB...", "gemini")
  → writeSettings with encrypted key
  → Returns: needsMoreInput=false, settingsChanged=true
  → System clears pendingCommandWizard
  → System message shows success with model list
```

### Encryption on Write Flow
```
Any code calls writeSettings(settings)
  → encryptApiKeys(settings) iterates engines entries
  → For each apiKey that is NOT isEncryptedCredential:
      apiKey = encryptCredential(apiKey, engineName)
      apiKeyEncrypted = true
  → atomicWriteJsonFileSync writes to disk
  → settings.json now contains ciphertext
```

### Decryption on Read Flow
```
resolveSettingsSources() is called
  → Resolves engines from env vars + user + project settings
  → For each engine config: resolveApiKey(config.apiKey, engineName)
  → If starts with "aes256:" → decryptCredential → plaintext in memory
  → If not → return as-is (plaintext legacy)
  → ResolvedDeepcodingSettings.engines[name].apiKey = plaintext
  → LLM providers use plaintext directly
```

---

## Data Structures

| Type/Field | File | Definition | Default |
|---|---|---|---|
| `topP` | `settings-schema.ts` → `deepcodingSettingsSchema` | `z.number().min(0).max(1).optional()` | `undefined` |
| `thinkingBudgets` | `settings-schema.ts` → `deepcodingSettingsSchema` | `z.record(z.string(), z.number().int().min(1024)).optional()` | `{}` |
| `apiKeyEncrypted` | `settings-schema.ts` → `engineEntrySchema` | `z.boolean().optional()` | `false` |
| `DeepcodingSettings.topP` | `settings.ts` | `topP?: number` | omitted when unset |
| `DeepcodingSettings.thinkingBudgets` | `settings.ts` | `thinkingBudgets?: Record<string, number>` | omitted when empty |
| `ResolvedDeepcodingSettings.topP` | `settings.ts` | `topP?: number` | `undefined` |
| `ResolvedDeepcodingSettings.thinkingBudgets` | `settings.ts` | `thinkingBudgets: Record<string, number>` | `{}` |
| `SessionManager.pendingCommandWizard` | `session.ts` | `{ command: string; wizardState: Record<string, unknown> } \| null` | `null` |
| `ModelCommandContext` | `model-command-handlers.ts` | `{ settings, catalog, input, settingsDir, wizardState? }` | N/A (stack value) |
| `ModelCommandResult` | `model-command-handlers.ts` | `{ message, needsMoreInput, wizardState?, settingsChanged }` | N/A (return value) |

---

## File / Module Layout

```
src/
├── common/
│   ├── credential-vault.ts            ← NEW: encryptCredential, decryptCredential, isEncryptedCredential
│   ├── model-catalog.ts               ← NO CHANGE (reads only)
│   ├── model-capabilities.ts          ← NO CHANGE (reads only)
│   ├── settings-schema.ts             ← MODIFY: add topP, thinkingBudgets, apiKeyEncrypted
│   └── ... all other files unchanged
├── settings.ts                        ← MODIFY: topP, thinkingBudgets, resolveApiKey, encryptApiKeys
├── session.ts                         ← MODIFY: dispatch model-* commands, pendingCommandWizard
├── ui/
│   ├── core/
│   │   ├── slash-commands.ts          ← MODIFY: 8 new entries in BUILTIN_SLASH_COMMANDS
│   │   ├── command-handlers.ts        ← MODIFY: 8 new entries in BUFFER_TEXT_COMMANDS
│   │   └── model-command-handlers.ts  ← NEW: handleModelList, handleModelAdd, etc.
│   ├── types/
│   │   └── commands.ts                ← MODIFY: 8 new kind literals
│   ├── components/
│   │   └── ModelsDropdown/            ← NO CHANGE
│   ├── contexts/
│   │   └── AppStateContext.tsx         ← NO CHANGE
│   └── utils/
│       └── index.ts                    ← NO CHANGE
└── tests/
    ├── credential-vault.test.ts       ← NEW: encrypt, decrypt, AAD mismatch, keyfile ops
    ├── model-command-handlers.test.ts ← NEW: handler tests for all 8 commands
    ├── settings-encryption.test.ts     ← NEW: settings resolution with encrypted keys, migration
    └── ... all existing tests unchanged
```

---

## Testing Strategy

### New Test Files

**`credential-vault.test.ts` (NEW):**
1. `encryptCredential returns aes256: prefix` — verify format.
2. `decryptCredential round-trips correctly` — encrypt then decrypt, verify equality.
3. `decryptCredential throws with wrong AAD (provider)` — encrypt with "openai", decrypt with "gemini" → auth tag mismatch.
4. `decryptCredential throws with tampered ciphertext` — modify one character in ciphertext → decrypt throws.
5. `isEncryptedCredential detects encrypted values` — true for "aes256:...", false for "sk-...".
6. `getOrCreateCredentialKey creates keyfile with 0600` — verify file exists, size=32, mode=0600.
7. `getOrCreateCredentialKey reuses existing keyfile` — call twice, get same key.
8. `getOrCreateCredentialKey throws on corrupt keyfile` — write wrong-size file, verify error.
9. `deleteCredentialKey removes keyfile` — delete, verify gone.
10. `Two encryptions of same plaintext produce different ciphertexts` — verify IV randomness.

**`model-command-handlers.test.ts` (NEW):**
11. `handleModelList with all 4 providers configured` — verify output contains all providers, key status, models, pricing.
12. `handleModelList with no keys configured` — verify all show ❌ no key.
13. `handleModelAdd init with valid provider` — verify base URL prompt.
14. `handleModelAdd init with already-configured provider` — verify error.
15. `handleModelAdd init with unknown provider` — verify error.
16. `handleModelAdd baseUrl step with custom URL` — verify validation (valid/invalid).
17. `handleModelAdd apiKey step with valid key` — verify confirm prompt shows masked key.
18. `handleModelAdd apiKey step with short key` — verify error.
19. `handleModelAdd confirm step with "retry"` — verify returns to baseUrl step.
20. `handleModelAdd confirm step with ENTER` — verify writes settings (mock writeSettings).
21. `handleModelRemove with confirmation` — verify "yes" removes, other input cancels.
22. `handleModelInfo for existing model` — verify output format, all fields.
23. `handleModelInfo for nonexistent model` — verify error.
24. `handleModelKey update flow` — verify encrypt-and-write.
25. `handleModelDefault sets model` — verify settings.model updated.
26. `handleModelDefault warns when provider has no key` — verify warning in message.
27. `handleModelParams full flow` — temperature change, max_token change, top_p set/clear.
28. `handleModelParams validation errors` — out-of-range values rejected.
29. `handleModelThinking for extended model` — verify budget set.
30. `handleModelThinking for non-extended model` — verify error.

**`settings-encryption.test.ts` (NEW):**
31. `resolveSettingsSources decrypts encrypted apiKey` — write encrypted key, read settings, verify plaintext returned.
32. `resolveSettingsSources passes through plaintext apiKey` — legacy key still works.
33. `writeSettings encrypts plaintext apiKeys on write` — write plaintext key, read back settings.json, verify ciphertext.
34. `writeSettings leaves encrypted apiKeys unchanged` — write encrypted key, write settings again, verify ciphertext unchanged (no double-encrypt).
35. `encrypted key decryption failure falls back to error message` — corrupt ciphertext → error surfaced.

---

## Migration / Rollback

**Migration (plaintext → encrypted):**
- No manual migration required.
- First `writeSettings()` call after this spec is deployed auto-encrypts all plaintext `apiKey` values.
- Users will see a log message: `"Migrating plaintext API key for <provider> to encrypted storage."`
- After migration, `settings.json` contains no plaintext keys.

**Rollback:**
- Revert the commit.
- Any encrypted keys in `settings.json` will fail to decrypt (no `credential-vault.ts` available).
- Users must manually restore plaintext keys by editing `settings.json`.
- The `apiKeyEncrypted` field in settings is ignored by pre-Spec-80 code (Zod strips unknown fields via `strictObject`).
- New fields (`topP`, `thinkingBudgets`) are ignored by pre-Spec-80 code.
- No persistent state corruption on rollback.
