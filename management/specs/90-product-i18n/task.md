# Spec 90: Product i18n — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the
completion of all preceding tasks.

---

## Tasks

### Task 1: Create `src/i18n/` directory and core types

**Objective:** Create the i18n module skeleton with all foundational types and interfaces.

**Requirements Covered:** FR-003, FR-004, FR-005, NFR-004

**Design References:** Component 2 (dictionaries), Component 5 (context), Component 3 (translate)

**Actions:**
1. Create directory `src/i18n/`.
2. Create `src/i18n/dictionary.ts`:
   ```typescript
   import { enDictionary } from "./en";
   export type I18nDictionary = typeof enDictionary;
   export type I18nKey = keyof I18nDictionary & string;
   export { enDictionary } from "./en";
   export { ptDictionary } from "./pt";
   export { esDictionary } from "./es";
   export function getDictionary(locale: string): I18nDictionary;
   export function resolveDictionary(locale: string, dict: I18nDictionary): I18nDictionary;
   ```
   Implement `getDictionary` as a switch returning the correct dictionary or `enDictionary`.
   Implement `resolveDictionary` as a Proxy that falls back to `enDictionary` for missing keys.
3. Create `src/i18n/translate.ts`:
   ```typescript
   export type I18nReplacements = Record<string, string | number>;
   export type I18nTFunction = { (key: string, replacements?: I18nReplacements): string };
   export function createTFunction(dictionary: I18nDictionary): I18nTFunction;
   ```
   Implement: lookup key in dictionary, if absent return key as-is. Replace `{{placeholder}}` with values from replacements map.
4. Create `src/i18n/context.ts`:
   ```typescript
   export type LocaleContextValue = { locale: string; t: I18nTFunction };
   export const LocaleContext = React.createContext<LocaleContextValue>(...);
   export function useLocale(): LocaleContextValue;
   export function setActiveTFunction(t: I18nTFunction): void;
   export function getActiveTFunction(): I18nTFunction;
   ```
   Implement `setActiveTFunction`/`getActiveTFunction` as module-level variable
   getter/setter for non-React modules that need the t-function (model-command-handlers,
   exit-summary, session.ts).
5. Create `src/i18n/format.ts`:
   ```typescript
   export function formatNumber(n: number, locale: string): string;
   ```
   Implement using `Intl.NumberFormat`.

**Validation:**
- [ ] `npx tsc --noEmit` passes for these 4 new files.
- [ ] Files exist: `src/i18n/dictionary.ts`, `translate.ts`, `context.ts`, `format.ts`.

**Status:** [x] done

---

### Task 2: Create English dictionary (`en.ts`)

**Objective:** Create the English dictionary as the source of truth for all translation keys.

**Requirements Covered:** FR-003, FR-006

**Design References:** Component 2 — `src/i18n/en.ts`

**Actions:**
1. Create `src/i18n/en.ts`.
2. Export `const enDictionary` as a `const` object with ALL ~190 keys listed in the
   design document (Component 2, `en.ts` structure), grouped by category:
   - 31 `cmd.*` keys (slash command descriptions)
   - 11 `welcome.*` keys (welcome screen tips + info)
   - 32 `help.*` keys (help modal shortcuts + title)
   - 14 `error.*` keys (error classification labels/hints)
   - 76 `model.*` keys (model command wizard — all labels, templates, prompts, errors)
   - 10 `exit.*` keys (exit summary headers/labels)
   - 12 `status.*` keys (status bar/header messages)
   - 3 `permission.*` keys (permission prompt labels)
3. Export `enDictionary` as default export.
4. Export with `as const` for literal type inference.

**Validation:**
- [ ] File `src/i18n/en.ts` exists and exports `enDictionary`.
- [ ] `Object.keys(enDictionary).length >= 185`.
- [ ] `npx tsc --noEmit` passes.

**Status:** [x] done

---

### Task 3: Create Portuguese dictionary (`pt.ts`)

**Objective:** Translate all ~190 English strings to Portuguese (Brazilian).

**Requirements Covered:** FR-003, FR-006

**Design References:** Component 2 — `src/i18n/pt.ts`

**Actions:**
1. Create `src/i18n/pt.ts`.
2. Import `I18nDictionary` type from `./dictionary`.
3. Export `const ptDictionary` with ALL keys from `enDictionary`, translated to
   idiomatic Brazilian Portuguese. Use `as const satisfies I18nDictionary` for
   compile-time verification.
4. Export as default.

**Translation guidelines:**
- Use Brazilian Portuguese conventions (`você` not `tu`, `controle` not `controlo`).
- Preserve `{{placeholder}}` patterns unchanged.
- Preserve keyboard key names in English (`Enter`, `Ctrl+J`, `Esc`, etc.).
- Preserve technical terms in English (`API key`, `base URL`, `thinking mode`).
- Command names (`/model`, `/new`, `/undo`, etc.) stay in English.
- ✅ emoji prefix preserved.

**Validation:**
- [ ] File `src/i18n/pt.ts` exists.
- [ ] `Object.keys(ptDictionary).length === Object.keys(enDictionary).length`.
- [ ] `npx tsc --noEmit` passes (including `satisfies` check).
- [ ] No two keys in pt.ts have the same Portuguese translation unless they are
      genuinely the same string (e.g., "Delete word before cursor" appears twice).

**Status:** [x] done

---

### Task 4: Create Spanish dictionary (`es.ts`)

**Objective:** Translate all ~190 English strings to Spanish.

**Requirements Covered:** FR-003, FR-006

**Design References:** Component 2 — `src/i18n/es.ts`

**Actions:**
1. Create `src/i18n/es.ts`.
2. Import `I18nDictionary` type from `./dictionary`.
3. Export `const esDictionary` with ALL keys from `enDictionary`, translated to
   idiomatic Spanish. Use `as const satisfies I18nDictionary`.
4. Export as default.

**Translation guidelines:**
- Use neutral Spanish (avoid regionalisms specific to Spain or Mexico).
- Preserve `{{placeholder}}` patterns unchanged.
- Preserve keyboard key names in English.
- Preserve technical terms in English.
- Command names stay in English.
- ✅ emoji prefix preserved.

**Validation:**
- [ ] File `src/i18n/es.ts` exists.
- [ ] `Object.keys(esDictionary).length === Object.keys(enDictionary).length`.
- [ ] `npx tsc --noEmit` passes (including `satisfies` check).

**Status:** [x] done

---

### Task 5: Create `resolveLocale()` in `locale.ts`

**Objective:** Implement OS locale detection with priority order and normalization.

**Requirements Covered:** FR-001, FR-008, FR-010

**Design References:** Component 1 — locale detection

**Actions:**
1. Create `src/i18n/locale.ts`.
2. Export type `SupportedLocale = "en" | "pt" | "es"`.
3. Implement and export `function normalizeLocale(raw: string): SupportedLocale | null`:
   - Trim, lowercase.
   - Strip charset/encoding suffix (`.UTF-8`, `.utf8`, etc.).
   - Strip country/region subtag after `_` or `-` (`pt_BR` → `pt`).
   - Return `"pt"`, `"es"`, or `"en"` if matched; otherwise return `null` (unsupported).
   - Handle `"C"` and `"POSIX"` → `null` (unsupported, caller falls through).
   - Handle empty string → `null`.
4. Implement and export `function resolveLocale(settingsLocale?: string | null): SupportedLocale`:
   - Priority 1: `process.env.DEEPCODE_LOCALE` — if set and non-empty, call `normalizeLocale`.
     If non-null, return it. Else fall through.
   - Priority 2: `settingsLocale` — if provided, call `normalizeLocale`. If non-null, return it.
     Else fall through.
   - Priority 3: POSIX detection — read `process.env.LANG` || `process.env.LC_ALL`.
     Call `normalizeLocale`. If non-null, return it.
   - Priority 4: `Intl.DateTimeFormat().resolvedOptions().locale`.
     Call `normalizeLocale`. If non-null, return it.
   - Priority 5: Windows detection via `execSync("powershell -NoProfile -Command ...")`.
     Wrap in try/catch. Parse output. Call `normalizeLocale`. If non-null, return it.
   - Default: return `"en"`.
5. Import `execSync` from `node:child_process` for Windows detection.

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] Function exports: `resolveLocale`, `normalizeLocale`, `SupportedLocale`.

**Status:** [x] done

---

### Task 6: Add `locale` to settings schema and types

**Objective:** Add the `locale` field to the Zod schema, TypeScript types, and settings resolution pipeline.

**Requirements Covered:** FR-002, NFR-005

**Design References:** Component 6 — settings schema extension

**Actions:**
1. In `src/common/settings-schema.ts`:
   - Add `locale: z.enum(["en", "pt", "es"]).optional()` to `deepcodingSettingsSchema`.
   - Position it between `topP` and `thinkingBudgets` fields.
2. In `src/settings.ts`:
   - Add `locale?: "en" | "pt" | "es"` to `DeepcodingSettings` type.
   - Add `locale?: "en" | "pt" | "es"` to `ResolvedDeepcodingSettings` type (optional — `undefined` means "auto-detect"; OS fallback is handled by `resolveLocale()` in App.tsx).
   - In `resolveSettingsSources()`, resolve `locale` from env/settings only
     (no OS detection — that's done later by `resolveLocale()` in App.tsx):
     ```typescript
     function resolveSettingsLocale(
       env: Record<string, string>,
       project: DeepcodingSettings | null | undefined,
       user: DeepcodingSettings | null | undefined
     ): "en" | "pt" | "es" | undefined {
       const raw = trimString(env.LOCALE) || project?.locale || user?.locale;
       if (raw === "pt" || raw === "es" || raw === "en") return raw;
       return undefined;
     }
     const locale = resolveSettingsLocale(systemEnv, projectSettings, userSettings);
     ```
   - Add `locale` to the return object of `resolveSettingsSources()`.
3. Do NOT add `locale` to `DEFAULT_SETTINGS` — it is intentionally absent.
4. Do NOT add `locale` to `ensureSettingsDefaults()` — locale is never backfilled.

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] `settings.json` with `"locale": "pt"` is accepted by Zod.
- [ ] `settings.json` with `"locale": "fr"` is rejected by Zod.
- [ ] `ResolvedDeepcodingSettings.locale` type is `"en" | "pt" | "es" | undefined`.

**Status:** [x] done

---

### Task 7: Wire locale into App.tsx

**Objective:** Resolve locale at startup, create the translation function, and provide
it via React context to all descendant components.

**Requirements Covered:** FR-001, FR-005, FR-009

**Design References:** Component 7 — integration in App.tsx

**Actions:**
1. In `src/ui/views/App.tsx`:
   - Import `resolveLocale` from `../../i18n/locale`.
   - Import `getDictionary`, `resolveDictionary` from `../../i18n/dictionary`.
   - Import `createTFunction` from `../../i18n/translate`.
   - Import `LocaleContext`, `LocaleContextValue`, `setActiveTFunction` from `../../i18n/context`.
   - After `settings` is resolved, compute:
     ```typescript
     const locale = resolveLocale(settings.locale);
     const rawDict = getDictionary(locale);
     const dict = resolveDictionary(locale, rawDict);
     const t = createTFunction(dict);
     const localeValue: LocaleContextValue = { locale, t };
     // Register t-function for non-React modules (model-command-handlers, exit-summary)
     setActiveTFunction(t);
     ```
   - Wrap the component tree's outermost `<Box>` (or equivalent) with:
     ```tsx
     <LocaleContext.Provider value={localeValue}>
       {/* existing component tree */}
     </LocaleContext.Provider>
     ```
   - This MUST be inside the component function, not at module level.
   - The `localeValue` object MUST be stable for the component lifetime (computed
     once in the component body before JSX).
2. Ensure `settings` is already available in `App`'s scope (it's currently passed
   via props or context — verify and adjust if needed).

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` succeeds.
- [ ] Launching DsCode with `DEEPCODE_LOCALE=pt` shows Portuguese strings (manual smoke test).
- [ ] Launching DsCode with no env/settings shows English strings (unchanged behavior).

**Status:** [x] done

---

### Task 8: Translate slash command descriptions

**Objective:** Replace all hardcoded English descriptions in `slash-commands.ts` with `t()` calls.

**Requirements Covered:** FR-006 (slash commands)

**Design References:** Component 8 — string replacement

**Actions:**
1. In `src/ui/core/slash-commands.ts`:
   - This file exports helper functions with `BUILTIN_SLASH_COMMANDS` as a module-level
     `const`. Translation must happen at call sites, not at module init.
   - **Design:** Store translation **keys** in the `description` field of
     `BUILTIN_SLASH_COMMANDS` (e.g., `"cmd.list-skills"` instead of `"List available skills"`).
     Then `formatSlashCommandDescription()` accepts a `t` function parameter and
     translates the key at render time:
     ```typescript
     export function formatSlashCommandDescription(
       description: string,
       t: I18nTFunction
     ): string {
       const translated = t(description);
       return translated.trim().replace(/\s+/g, " ");
     }
     ```
   - Update `buildWelcomeTips()` in `WelcomeScreen.tsx` to pass `t`.
   - Update `SlashCommandMenu` component to pass `t`.
2. Change all 31 descriptions in `BUILTIN_SLASH_COMMANDS` from English strings to
   translation keys (e.g., `"List available skills"` → `"cmd.list-skills"`).
3. Update `buildSlashCommands()` — skill descriptions come from loaded skill files
   and should stay as-is (they're not product UI; they come from skill authors).
4. Update all callers of `formatSlashCommandDescription` and `description` reads
   to pass `t` where needed.

**Callers to update:**
- `src/ui/views/WelcomeScreen.tsx` — `buildWelcomeTips` and `WelcomeScreen` rendering.
- `src/ui/views/SlashCommandMenu.tsx` — menu item rendering.
- `src/ui/views/PromptInput.tsx` — slash command display.
- Any other component reading `description` from `SlashCommandItem`.

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` succeeds.
- [ ] Slash command descriptions show in Portuguese when locale is `pt`.
- [ ] Slash command descriptions show in English when locale is `en`.

**Status:** [x] done

---

### Task 9: Translate welcome screen tips

**Objective:** Replace hardcoded English strings in `WelcomeScreen.tsx` with `t()` calls.

**Requirements Covered:** FR-006 (welcome screen)

**Design References:** Component 8

**Actions:**
1. In `src/ui/views/WelcomeScreen.tsx`:
   - Import `{ useLocale }` from `../i18n/context`.
   - In `WelcomeScreen` component: `const { t } = useLocale()`.
   - Replace shortcut tip descriptions:
     ```typescript
     // Before:
     { label: "Enter", description: "Send the prompt" },
     // After:
     { label: "Enter", description: t("welcome.tip-send-prompt") },
     ```
   - Replace version line strings:
     ```typescript
     // Before:
     {settings.thinkingEnabled ? "thinking mode active" : "non-thinking mode"}
     // After:
     {settings.thinkingEnabled ? t("welcome.thinking-active") : t("welcome.non-thinking")}
     ```
   - Replace `"by"` label:
     ```typescript
     // Before: "by Andre LN Campos"
     // After: t("welcome.label-by") + " Andre LN Campos"
     ```
   - The `getShortcutTips` function is called inside `buildWelcomeTips` which is called
     inside `WelcomeScreen`. Both need access to `t`. Pass `t` as parameter to
     `buildWelcomeTips` and `getShortcutTips`.
2. Update `buildWelcomeTips` signature: `(skills: SkillInfo[], t: I18nTFunction)`.
3. Update `getShortcutTips` signature: `(t: I18nTFunction)`.

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm test` passes all 663 tests.
- [ ] Welcome screen shows Portuguese tips when locale is `pt`.

**Status:** [x] done

---

### Task 10: Translate help modal shortcuts

**Objective:** Replace hardcoded English descriptions in `HelpModal.tsx` with `t()` calls.

**Requirements Covered:** FR-006 (help modal)

**Design References:** Component 8

**Actions:**
1. In `src/ui/views/HelpModal.tsx`:
   - Import `{ useLocale }` from `../i18n/context`.
   - In the component: `const { t } = useLocale()`.
   - Replace all 32 shortcut descriptions in `BASE_SHORTCUTS` with `t("help.xxx")` calls.
   - The `BASE_SHORTCUTS` array is defined inside the component or in module scope —
     if module scope, wrap in a `useMemo` that depends on `t`.
   - Replace modal title `"Keyboard Shortcuts & Commands"` with `t("help.title")`.
   - Replace `"Press Esc to close"` with `t("help.press-esc")`.

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] Help modal shows Portuguese descriptions when locale is `pt`.

**Status:** [x] done

---

### Task 11: Translate error classification labels and hints

**Objective:** Replace hardcoded English error labels and hints with `t()` calls.

**Requirements Covered:** FR-006 (error classification)

**Design References:** Component 8

**Actions:**
1. In `src/ui/core/error-classification.ts`:
   - This file exports `classifyError(message): ErrorClassification`. It's not a
     React component — it's pure logic.
   - **Challenge:** `t()` is only available via React context, but `classifyError`
     is called from non-React code (e.g., `session.ts`).
   - **Solution:** `classifyError` returns error **keys** instead of English strings.
     The caller translates using `t()`:
     ```typescript
     // Before:
     { pattern: "API key", label: "Authentication Error", hint: "Check your API key..." }
     // After:
     { pattern: "API key", labelKey: "error.auth-label", hintKey: "error.auth-hint" }
     ```
   - Change `ErrorClassification` type:
     ```typescript
     export type ErrorClassification = {
       labelKey: string;
       hintKey: string;
     };
     ```
   - Update all callers of `classifyError` to use `t(labelKey)` and `t(hintKey)`
     instead of directly displaying `label` and `hint`.
2. Identify all callers of `classifyError`:
   - `ErrorBanner` component (TSX) — uses React context, can call `t()`.
   - Any non-React callers — pass `t` function as parameter or restructure.
   - Search for `classifyError(` calls across the codebase.
3. Update `grep` to find all callers, then update each.

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] Error messages show Portuguese labels when locale is `pt`.
- [ ] `grep -r "classifyError" src/` shows all callers are updated.

**Status:** [x] done

---

### Task 12: Translate model command wizard messages

**Objective:** Replace all hardcoded English messages in `model-command-handlers.ts` with `t()` calls.

**Requirements Covered:** FR-006 (model command wizard)

**Design References:** Component 8

**Actions:**
1. In `src/ui/core/model-command-handlers.ts`:
   - This file exports handler functions that return `ModelCommandResult` with a
     `message: string` field. These handlers are NOT React components.
   - **Solution:** Add `t: I18nTFunction` to `ModelCommandContext`:
     ```typescript
     export type ModelCommandContext = {
       settings: ResolvedDeepcodingSettings;
       catalog: ModelEntry[];
       input: string;
       settingsDir: string;
       wizardState?: Record<string, unknown>;
       t: I18nTFunction;  // NEW
     };
     ```
2. In each handler, replace templated English messages with `t()` calls:
   - `"No models in catalog."` → `t("model.no-models-in-catalog")`
   - `'Unknown model \'${modelId}\'. Use /model to see available models.'` →
     `t("model.unknown-model", { modelId })`
   - `"Cancelled."` → `t("model.cancelled")`
   - All other ~60 string literals.
3. In `session.ts` (or wherever `handleModelAdd`, `handleModelRemove`, etc. are called),
   populate `ctx.t` by calling `getActiveTFunction()` (already exported from `src/i18n/context.ts`
   and initialized by Task 7). Pass `t` into `ModelCommandContext` before dispatching.
4. Verify that the `ModelCommandContext` type is imported and updated everywhere.

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm test` passes all 663 tests.
- [ ] Model wizard messages show Portuguese when locale is `pt`.
- [ ] All `t()` keys used in handlers exist in `enDictionary`.

**Status:** [x] done

---

### Task 13: Translate exit summary strings

**Objective:** Replace hardcoded English strings in `exit-summary.ts` with `t()` calls.

**Requirements Covered:** FR-006 (exit summary)

**Design References:** Component 8

**Actions:**
1. In `src/ui/exit-summary.ts`:
   - `buildExitSummaryText` is a pure function — not a React component.
   - **Solution:** Accept `t: I18nTFunction` as a parameter:
     ```typescript
     type ExitSummaryInput = {
       session: SessionEntry | null;
       projectRoot?: string;
       t: I18nTFunction;  // NEW
     };
     ```
   - Replace all English labels:
     - `"Goodbye!"` → `t("exit.goodbye")`
     - `"Model Usage"` → `t("exit.model-usage")`
     - `"Input Tokens"` → `t("exit.input-tokens")`
     - `"Output Tokens"` → `t("exit.output-tokens")`
     - `"Cached Tokens"` → `t("exit.cached-tokens")`
     - `"Reqs"` → `t("exit.reqs")`
     - `"Cost (USD)"` → `t("exit.cost-usd")`
     - `"Session:   ${cost}"` → `t("exit.session-cost", { cost })`
     - `"Today:     ${cost}"` → `t("exit.today-cost", { cost })`
     - `"Project:   ${cost}"` → `t("exit.project-cost", { cost })`
2. Update caller(s) of `buildExitSummaryText` to pass `t` (from `getActiveTFunction()`).

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] Exit summary shows Portuguese labels when locale is `pt`.

**Status:** [x] done

---

### Task 14: Translate status bar, header, and footer strings

**Objective:** Replace hardcoded English in status components and session.ts status messages.

**Requirements Covered:** FR-006 (status/header/footer)

**Design References:** Component 8

**Actions:**
1. In `src/ui/components/StatusBar.tsx`: import `{ useLocale }`, translate all strings.
2. In `src/ui/components/SessionStatsHeader.tsx`: import `{ useLocale }`, translate.
3. In `src/ui/components/StreamingIndicator.tsx`: import `{ useLocale }`, translate.
4. In `src/ui/components/StatusHeader.tsx`: import `{ useLocale }`, translate.
5. In `src/ui/components/ErrorBanner.tsx`: import `{ useLocale }`, translate.
6. For non-React code that outputs status messages (e.g., `session.ts` system messages),
   use `getActiveTFunction()`.

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] All status components render translated strings when locale is Portuguese.
- [ ] `npm test` passes all 663 tests.

**Status:** [x] done

---

### Task 15: Translate permission prompt strings

**Objective:** Replace hardcoded English in `PermissionPrompt.tsx` with `t()` calls.

**Requirements Covered:** FR-006 (permission prompt)

**Design References:** Component 8

**Actions:**
1. In `src/ui/views/PermissionPrompt.tsx`:
   - Import `{ useLocale }`.
   - Replace `"Allow"`, `"Deny"`, `"Ask"` with `t("permission.allow")`, etc.

**Validation:**
- [ ] `npx tsc --noEmit` passes.
- [ ] Permission prompt shows Portuguese labels when locale is `pt`.

**Status:** [x] done

---

### Task 16: Write unit tests for i18n module

**Objective:** Create comprehensive tests for `resolveLocale`, `normalizeLocale`, `t()`,
`formatNumber`, `getDictionary`, and `resolveDictionary`.

**Requirements Covered:** NFR-005

**Design References:** Testing Strategy section

**Actions:**
1. Create `src/tests/i18n.test.ts`.
2. Write tests for all 35 scenarios listed in the Testing Strategy.
3. Use `node:test` (the built-in test runner — consistent with existing tests).
4. Mock `process.env` in before/after hooks for locale tests.
5. Mock `execSync` for Windows locale tests.
6. Test `t()` with Portuguese dictionary to verify translation correctness.

**Validation:**
- [ ] `node src/tests/run-tests.mjs` passes including new i18n tests.
- [ ] `npm test` passes all tests (663 + ~35 new = ~698).

**Status:** [x] done

---

### Task 17: Full build, lint, and test verification

**Objective:** Run the complete quality gates and ensure zero regressions.

**Requirements Covered:** FR-006 (all), FR-010, NFR-001, NFR-003, NFR-005

**Actions:**
1. `npm run typecheck` — must pass with 0 errors.
2. `npm run lint` — must pass with 0 errors.
3. `npm run format:check` — must pass with 0 warnings.
4. `npm run build` — must succeed.
5. `npm test` — must pass all tests with 0 failures.
6. Manual smoke tests:
   - `DEEPCODE_LOCALE=pt node dist/cli.js` — verify welcome screen, `/model-list`, help modal in Portuguese.
   - `DEEPCODE_LOCALE=es node dist/cli.js` — verify welcome screen, `/model-list`, help modal in Spanish.
   - No env var — verify everything is English (unchanged).
7. Verify dictionary sizes: `Buffer.byteLength(JSON.stringify(enDictionary))` < 20000.
8. Verify startup time: locale resolution + dictionary loading < 5ms.

**Validation:**
- [ ] All gates pass.
- [ ] No regressions in existing tests.

**Status:** [x] done
