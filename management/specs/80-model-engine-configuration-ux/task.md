# Spec 80: Model & Engine Configuration UX — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

---

## Tasks

### Task 1: Add new slash command kinds and command handlers registration

**Objective:** Register the 8 new slash commands in the type system and command infrastructure so they can be recognized and routed.

**Requirements Covered:** FR-009 (backward compat — bare `/model` untouched), FR-010 (validation framework).

**Design References:** Component 3 (Slash Command Registration), Component 6 (SessionManager Dispatch).

**Actions:**
1. Read `src/ui/types/commands.ts`.
2. Add 8 new literals to `COMMAND_KINDS` array: `"model-list"`, `"model-add"`, `"model-remove"`, `"model-info"`, `"model-key"`, `"model-default"`, `"model-params"`, `"model-thinking"`.
3. Add the same 8 literals to `PROMPT_COMMAND_KINDS` array.
4. Read `src/ui/core/slash-commands.ts`.
5. Add 8 new `SlashCommandItem` objects to `BUILTIN_SLASH_COMMANDS` with correct `kind`, `name`, `label`, `args`, and `description` fields per the design.
6. Read `src/ui/core/command-handlers.ts`.
7. Add the 8 new kinds to the `BUFFER_TEXT_COMMANDS` set.
8. Verify zero lines of existing code are removed or altered beyond additions.

**Validation:**
- Run `npm run typecheck` — must pass.
- Run `npm test` — all existing tests pass.
- Verify `/model` (bare) still opens the dropdown (smoke test).

**Status:** [x] done

---

### Task 2: Create `credential-vault.ts` — encrypted credential storage

**Objective:** Implement the AES-256-GCM encryption/decryption module with local keyfile management.

**Requirements Covered:** FR-011 (Encrypted API Key Storage).

**Design References:** Component 1 (credential-vault.ts).

**Actions:**
1. Create `src/common/credential-vault.ts`.
2. Implement `getCredentialKeyPath()` — resolves to `path.join(process.env.HOME || process.env.USERPROFILE || homedir(), ".dscode", ".credential-key")` where `homedir` is imported from `node:os`.
3. Implement `getOrCreateCredentialKey()` — reads or creates a 32-byte random keyfile with `0600` permissions. Error on wrong size.
4. Implement `encryptCredential(plaintext: string, providerName: string): string` — AES-256-GCM with random 12-byte IV, 16-byte auth tag, AAD bound to providerName, base64url encoding, `"aes256:"` prefix.
5. Implement `decryptCredential(encoded: string, providerName: string): string` — parse, verify, decrypt with AAD check.
6. Implement `isEncryptedCredential(value: string): boolean` — checks `"aes256:"` prefix.
7. Implement `credentialKeyExists(): boolean`.
8. Implement `deleteCredentialKey(): void`.

**Validation:**
- Run `npm run typecheck` — must pass.
- Create `src/tests/credential-vault.test.ts` with test cases 1–10 from design testing strategy.
- Run `npm test -- --testPathPattern credential-vault` — all 10 tests pass.

**Status:** [x] done

---

### Task 3: Extend settings schema with new fields

**Objective:** Add `topP`, `thinkingBudgets`, and `apiKeyEncrypted` fields to the Zod schema and TypeScript types.

**Requirements Covered:** FR-007 (`/model-params` data), FR-008 (`/model-thinking` data), FR-011 (encryption marker).

**Design References:** Component 4 (Settings Schema Extensions).

**Actions:**
1. Read `src/common/settings-schema.ts`.
2. Add `topP: z.number().min(0).max(1).optional()` to `deepcodingSettingsSchema`.
3. Add `thinkingBudgets: z.record(z.string(), z.number().int().min(1024)).optional()` to `deepcodingSettingsSchema`.
4. Add `apiKeyEncrypted: z.boolean().optional()` to `engineEntrySchema`.
5. Add `apiKeyEncrypted?: boolean` to the `EngineEntry` type.
6. Read `src/settings.ts`.
7. Add `topP?: number` to `DeepcodingSettings` type.
8. Add `thinkingBudgets?: Record<string, number>` to `DeepcodingSettings` type.
9. Add `topP?: number` to `ResolvedDeepcodingSettings` type.
10. Add `thinkingBudgets: Record<string, number>` to `ResolvedDeepcodingSettings` type (default `{}`).
11. In `resolveSettingsSources()`, resolve `topP` from project then user settings (project takes precedence).
12. In `resolveSettingsSources()`, resolve `thinkingBudgets` from project then user settings (project takes precedence), default `{}`.

**Validation:**
- Run `npm run typecheck` — must pass.
- Run `npm test` — all existing tests pass (these fields are optional, existing behavior unchanged).

**Status:** [x] done

---

### Task 4: Integrate encryption into settings read/write

**Objective:** Wire credential-vault into `resolveSettingsSources()` (decrypt on read) and `writeSettings()`/`writeProjectSettings()` (encrypt on write).

**Requirements Covered:** FR-011 (Encrypted API Key Storage).

**Design References:** Component 5 (Encryption Integration in Settings Resolution).

**Actions:**
1. Read `src/settings.ts`.
2. Import `{ isEncryptedCredential, decryptCredential, encryptCredential }` from `credential-vault`.
3. Create `resolveApiKey(rawKey: string | undefined, engineName: string): string | undefined` helper — decrypts if encrypted, returns plaintext otherwise.
4. In `resolveSettingsSources()`, after the engines resolution block, wrap each `engines[name].apiKey` through `resolveApiKey()`.
5. Create `encryptApiKeys(settings: DeepcodingSettings): DeepcodingSettings` helper — iterates engines, encrypts any plaintext `apiKey` values, sets `apiKeyEncrypted: true`.
6. In `writeSettings()` and `writeProjectSettings()`, call `encryptApiKeys()` before `atomicWriteJsonFileSync()`.
7. Ensure encrypted keys are NOT double-encrypted (check `isEncryptedCredential` in the helper).

**Validation:**
- Run `npm run typecheck` — must pass.
- Run `npm test` — all existing tests pass.
- Create `src/tests/settings-encryption.test.ts` with test cases 31–35 from design testing strategy.
- Run `npm test -- --testPathPattern settings-encryption` — all 5 tests pass.

**Status:** [x] done

---

### Task 5: Create `model-command-handlers.ts` — non-wizard commands

**Objective:** Implement the four simple (single-shot) handlers: `handleModelList`, `handleModelInfo`, `handleModelDefault`, `handleModelRemove`.

**Requirements Covered:** FR-001, FR-003, FR-004, FR-006, FR-010.

**Design References:** Component 2 (`handleModelList`, `handleModelInfo`, `handleModelDefault`, `handleModelRemove`).

**Actions:**
1. Create `src/ui/core/model-command-handlers.ts`.
2. Define `ModelCommandContext` and `ModelCommandResult` types.
3. Implement `handleModelList(ctx)`:
   - Group `MODEL_CATALOG` by provider.
   - For each provider: determine key status (matching `createLlmProvider` logic), base URL, price range, model list.
   - Format as text (no React/Ink — plain text with box-drawing chars or simple formatting).
   - Return result.
4. Implement `handleModelInfo(ctx)`:
   - Extract model ID from `ctx.input`.
   - Look up in `MODEL_CATALOG` → `getModelCapabilities()`.
   - If not found, return error with usage hint.
   - Check API key status.
   - Format output per FR-004 spec.
5. Implement `handleModelDefault(ctx)`:
   - Extract model ID.
   - Validate exists in catalog.
   - Check provider key status → append warning to message if no key.
   - Read settings, set `model = id`, write settings.
   - Return success or "already default".
6. Implement `handleModelRemove(ctx)`:
   - Extract provider.
   - Validate configured (has `engines` entry).
   - Check if removing sole provider or active model's provider → confirmation prompt.
   - On confirmed removal: delete `engines[provider]`, write settings.
   - Return success or cancellation message.

**Validation:**
- Run `npm run typecheck` — must pass.
- Write handler-specific tests in `src/tests/model-command-handlers.test.ts`:
  - Test `handleModelList` with 4 providers, with no providers, with mixed key availability.
  - Test `handleModelInfo` for valid model, unknown model, model without pricing.
  - Test `handleModelDefault` for valid model, already-default, unknown model, no-key warning.
  - Test `handleModelRemove` for configured provider, not-configured, active model warning, sole provider warning.
- Run `npm test -- --testPathPattern model-command-handlers` — all handler tests pass.

**Status:** [x] done

---

### Task 6: Implement `handleModelAdd` — multi-step wizard

**Objective:** Implement the guided provider addition wizard (FR-002).

**Requirements Covered:** FR-002, FR-010 (validation), FR-011 (encryption on write).

**Design References:** Component 2 (`handleModelAdd` internal logic).

**Actions:**
1. Add `handleModelAdd(ctx)` to `model-command-handlers.ts`.
2. Implement step machine: `init` → `baseUrl` → `apiKey` → `confirm` → write.
3. **Step "init":** Extract provider from `/model-add <provider>`. Validate provider exists in `MODEL_CATALOG`. Check not already configured in `engines`. Return base URL prompt.
4. **Step "baseUrl":** Accept input (empty = default, non-empty = validate URL). Return API key prompt.
5. **Step "apiKey":** Accept input. Validate non-empty and ≥8 chars. Return confirmation prompt showing masked key.
6. **Step "confirm":** Accept input. `"retry"` → return to baseUrl step. ENTER → write.
7. **Write:** Call `encryptCredential(apiKey, provider)`. Build `EngineEntry`. Call `writeSettings()`. Build success message with model list from catalog and pricing.
8. Each step returns `{ message, needsMoreInput: true, wizardState: { step, ... } }`.

**Validation:**
- Add tests for `handleModelAdd` to `model-command-handlers.test.ts`:
  - Full wizard flow: gemini init → baseUrl (default) → apiKey (valid) → confirm (ENTER) → verify settings written.
  - Already-configured error (including when key is set via env var `DEEPCODE_ENGINE_OPENAI_API_KEY` — EC2).
  - Unknown provider error.
  - Short API key rejection.
  - Invalid base URL rejection.
  - "retry" at confirm step.
- `npm test -- --testPathPattern model-command-handlers` — all tests pass.

**Status:** [x] done

---

### Task 7: Implement `handleModelKey` — API key update

**Objective:** Implement the API key update handler (FR-005).

**Requirements Covered:** FR-005, FR-011.

**Design References:** Component 2 (`handleModelKey` internal logic).

**Actions:**
1. Add `handleModelKey(ctx)` to `model-command-handlers.ts`.
2. Extract provider. Validate exists in `MODEL_CATALOG`.
3. Check if provider has an `engines` entry. If not, return error with hint about env vars.
4. If first call (bare `/model-key <provider>`): show current key status (decrypted prefix/suffix, or env var note, or "not set") and prompt for new key.
5. If second call (wizardState present): validate new key (non-empty, ≥8 chars), encrypt, write to `engines[provider].apiKey`. Return success.

**Validation:**
- Add tests:
  - Key update flow: show current, enter new, verify encrypted and written.
  - Not-configured provider error.
  - Short key rejection.
- `npm test -- --testPathPattern model-command-handlers` — tests pass.

**Status:** [x] done

---

### Task 8: Implement `handleModelParams` — generation parameter editor

**Objective:** Implement the multi-step generation parameter editor (FR-007).

**Requirements Covered:** FR-007, FR-010.

**Design References:** Component 2 (`handleModelParams` internal logic).

**Actions:**
1. Add `handleModelParams(ctx)` to `model-command-handlers.ts`.
2. Implement step machine: `init` → `chooseParam` → `enterValue` → (loop back to `chooseParam`) → `done`.
3. **Step "init":** Read current `temperature`, `maxTokens`, `topP` from `ctx.settings`. Read current model's `maxOutput` from `MODEL_CATALOG`. Show current values. Prompt for parameter selection.
4. **Step "chooseParam":** Parse input. `"done"` → write all pending values, return success. Valid param → prompt for value.
5. **Step "enterValue":**
   - `temperature`: validate `0.0–2.0` float.
   - `max_tokens`: validate `1–<modelMaxOutput>` integer.
   - `top_p`: validate `0.0–1.0` float or `"none"` to clear.
   - Update pending value. Return to `chooseParam`.
6. **Write on "done":** Read settings, set `temperature`, `maxTokens`, `topP` (omit if `undefined`), call `writeSettings()`.

**Validation:**
- Add tests:
  - Change temperature from 1.0 to 0.7 → verify written.
  - Change max_tokens to valid value → verify written.
  - Set top_p to 0.9 → verify written; clear top_p to "none" → verify omitted.
  - Reject temperature 2.5, max_tokens 999999, top_p -0.1.
  - "done" writes all three at once.
- `npm test -- --testPathPattern model-command-handlers` — tests pass.

**Status:** [x] done

---

### Task 9: Implement `handleModelThinking` — thinking budget configuration

**Objective:** Implement the thinking budget configuration handler (FR-008).

**Requirements Covered:** FR-008, FR-010.

**Design References:** Component 2 (`handleModelThinking` internal logic).

**Actions:**
1. Add `handleModelThinking(ctx)` to `model-command-handlers.ts`.
2. Extract model ID from input.
3. Validate model exists in `MODEL_CATALOG`.
4. If model's `reasoning.type !== "extended"`: return error with list of extended-thinking models.
5. Show current budget: `settings.thinkingBudgets[modelId]` → `MODEL_CATALOG.reasoning.budgetTokens` → default 8192.
6. If first call: prompt for new budget.
7. If second call: validate (integer, 1024 ≤ budget ≤ model.maxOutput). Write `settings.thinkingBudgets[modelId] = budget`.
8. Return success.

**Validation:**
- Add tests:
  - Set budget for claude-haiku-4-5 to 32768 → verify written.
  - Empty input → uses 8192 default.
  - Budget too low (512) → rejected.
  - Budget too high (exceeds maxOutput) → rejected.
  - Non-extended model → error with helpful message.
- `npm test -- --testPathPattern model-command-handlers` — tests pass.

**Status:** [x] done

---

### Task 10: Wire model-* command dispatch in SessionManager

**Objective:** Add the dispatch logic in `SessionManager.replySession()` so that `command: "model-*"` triggers the appropriate handler and multi-step wizards persist state.

**Requirements Covered:** All FRs (connects command submission to handler execution).

**Design References:** Component 6 (SessionManager Dispatch).

**Actions:**
1. Read `src/session.ts`.
2. Import `* as ModelCommandHandlers` from `model-command-handlers`.
3. Import `MODEL_CATALOG` from `model-catalog`.
4. Add `pendingCommandWizard` field to the `SessionManager` class: `private pendingCommandWizard: { command: string; wizardState: Record<string, unknown> } | null = null;`.
5. In `replySession()`, before the main `createLlmProvider()` path:
   - Check if `command` starts with `"model-"`.
   - If so, build `ModelCommandContext` from current settings, catalog, input, and any pending wizard state.
   - Build handler name: `"handle" + pascalCase(command)` (e.g., `"model-list"` → `"handleModelList"`).
   - Call the handler: `const handler = (ModelCommandHandlers as Record<string, Function>)[handlerName]`.
   - If handler found, call it and process `ModelCommandResult`:
     - Add `result.message` as system message.
     - If `result.settingsChanged`, call `clearSettingsCache()`.
     - If `result.needsMoreInput`, set `this.pendingCommandWizard = { command, wizardState: result.wizardState }` and end the reply turn early.
     - If NOT `needsMoreInput`, clear `this.pendingCommandWizard`.
   - Do NOT proceed to LLM API call for model-* commands.
6. For subsequent messages with `pendingCommandWizard` set:
   - Before normal processing, inject the pending wizard state into a synthetic `ModelCommandContext` and re-invoke the same handler with the user's raw text as input.
   - Clear `pendingCommandWizard` if handler says `needsMoreInput: false`.

**Validation:**
- Smoke test: Type `/model-list` and press Enter → chat shows formatted provider list.
- Smoke test: Type `/model-add gemini` → wizard interaction flow.
- Smoke test: `/model-info gpt-5.5` → shows model details.
- Run `npm test` — all existing tests pass (no regressions in session handling).

**Status:** [x] done

---

### Task 11: Final integration tests and edge case verification

**Objective:** Write comprehensive integration tests covering edge cases and ensure 100% requirement coverage.

**Requirements Covered:** All FRs (EC1–EC19 edge cases from requirements).

**Design References:** Testing Strategy section, Edge Cases table.

**Actions:**
1. Add test for EC1: `/model-list` with no keys configured → all show ❌.
2. Add test for EC3: `/model-add` → wrong key → `/model-key` overwrite.
3. Add test for EC5: `/model-params` rejects temperature 2.5.
4. Add test for EC8: keyfile deleted → decrypt error → recovery instructions.
5. Add test for EC10: plaintext key in settings.json → auto-migrated on next write.
6. Add test for EC11: budget too low rejected.
7. Add test for EC15: provider removed → still in catalog list but ❌.
8. Add test for EC18: two providers with same key → different ciphertexts.
9. Run full test suite: `npm test` — all tests pass, zero regressions.
10. Run `npm run typecheck` — zero errors.
11. Manual smoke test on a real project: `/model-list`, `/model-add`, `/model-info`, `/model-key`, `/model-remove`, `/model-default`, `/model-params`, `/model-thinking`.

**Validation:**
- Step 9 passes.
- Step 10 passes.
- Step 11: all 8 commands produce expected output.

**Status:** [x] done
