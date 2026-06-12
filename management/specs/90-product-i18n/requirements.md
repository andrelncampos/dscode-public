# Spec 90: Product i18n — Requirements

## Value Delivery

From `vision.md` V14: Multi-Language Product UI

> The DsCode CLI product interface (menus, wizards, tips, error messages) speaks the
> user's language, detected automatically from the operating system locale.
>
> - **Zero-cost translation lookup:** All UI strings are served from static dictionaries —
>   no API calls, no dynamic translation. Detection via `process.env.LANG` / `LC_ALL` /
>   `Intl` on POSIX, `GetUserDefaultUILanguage` on Windows.
> - **Locale override:** Users can force a specific language via `settings.json`
>   (`"locale": "pt"`) or environment variable (`DEEPCODE_LOCALE=pt`), bypassing OS detection.
> - **Idiomatic translations:** Each language has a single dictionary file with all UI
>   strings. No placeholder or machine-translated text.
> - **Backward compatible:** Non-translated languages fall back to English. Existing
>   English UI is the default and zero behavior changes when locale detection fails.
> - **~120 strings:** Covers slash command descriptions, welcome screen tips, keyboard
>   shortcuts, model command wizard messages, and error messages.
>
> **Delivered by:** Spec 90 (product-i18n) — locale detection, dictionary files, React
> context injection, and translation of all ~120 UI strings to Portuguese and Spanish.
>
> **Intentionally out of scope:**
> - AI conversation language — the LLM system prompt and tool descriptions remain in English.
> - README localization — already handled separately.
> - RTL language support (Arabic, Hebrew, etc.).

---

## Functional Requirements

### FR-001: Locale Detection from Operating System

**What:** The system MUST detect the user's operating system locale at startup and
resolve it to a supported locale tag. Detection order: (1) `DEEPCODE_LOCALE`
environment variable, (2) `settings.json` `locale` field, (3) OS locale via
`process.env.LANG`, `process.env.LC_ALL`, `Intl.DateTimeFormat().resolvedOptions().locale`
(POSIX), or Windows API via child process calling `[System.Globalization.CultureInfo]::CurrentUICulture.Name`
in PowerShell (Windows). The resolved locale MUST be normalized to a 2-character
ISO 639-1 language code (`pt`, `es`, `en`, etc.).

**Why:** V14 requires zero-config language detection so users see their native
language without manual setup.

**Acceptance Criteria:**
- [ ] When `DEEPCODE_LOCALE=pt` is set, locale resolves to `pt` — regardless of OS locale.
- [ ] When `DEEPCODE_LOCALE=es` is set, locale resolves to `es` — regardless of OS locale.
- [ ] When `settings.json` has `"locale": "pt"` and `DEEPCODE_LOCALE` is unset, locale resolves to `pt`.
- [ ] When `settings.json` has `"locale": "es"` and `DEEPCODE_LOCALE` is unset, locale resolves to `es`.
- [ ] When neither env var nor settings specify locale, POSIX system with `LANG=pt_BR.UTF-8` resolves to `pt`.
- [ ] When neither env var nor settings specify locale, POSIX system with `LANG=es_ES.UTF-8` resolves to `es`.
- [ ] When neither env var nor settings specify locale, POSIX system with `LANG=en_US.UTF-8` resolves to `en`.
- [ ] When neither env var nor settings specify locale, Windows system with Portuguese UI resolves to `pt`.
- [ ] When neither env var nor settings specify locale, Windows system with Spanish UI resolves to `es`.
- [ ] When all detection fails (no env, no settings, unknown OS locale), resolves to `en`.
- [ ] Normalization: `pt_BR`, `pt_PT`, `pt-BR`, `pt-PT` all normalize to `pt`.
- [ ] Normalization: `es_ES`, `es_MX`, `es_AR`, `es-ES`, `es-MX`, `es-AR` all normalize to `es`.
- [ ] Normalization: `en_US`, `en_GB`, `en-US`, `en-GB` all normalize to `en`.
- [ ] Normalization: unknown locale `fr_FR` returns `null` from `normalizeLocale`, causing `resolveLocale` to fall through to subsequent priority sources and ultimately default to `en`.
- [ ] Normalization: empty string returns `null` from `normalizeLocale`.
- [ ] Normalization: `C` or `POSIX` locale returns `null` from `normalizeLocale`.

### FR-002: Locale Persistence in Settings

**What:** The `locale` setting MUST be accepted, validated, and persisted in
`settings.json` as a string field with values `"en"`, `"pt"`, or `"es"`. Unknown
values MUST be rejected with a validation error.

**Why:** Users must be able to override auto-detection persistently.

**Acceptance Criteria:**
- [ ] `settings.json` with `"locale": "pt"` is accepted and rounds-trips through read→write→read.
- [ ] `settings.json` with `"locale": "es"` is accepted and rounds-trips.
- [ ] `settings.json` with `"locale": "en"` is accepted and rounds-trips.
- [ ] `settings.json` with `"locale": "fr"` is rejected with a clear validation error mentioning valid values.
- [ ] `settings.json` with `"locale": "PT"` (uppercase) is rejected.
- [ ] `settings.json` without `locale` field does NOT add one automatically.
- [ ] `DEFAULT_SETTINGS` in `settings.ts` does NOT include a `locale` key (zero default).
- [ ] `ensureSettingsDefaults()` does NOT add a `locale` field to settings objects missing it.

### FR-003: Static Translation Dictionary Files

**What:** Each supported language MUST have a single TypeScript/JSON dictionary
file containing ALL UI strings keyed by a unique string identifier. The English
dictionary is the source of truth for key names. Portuguese and Spanish dictionaries
MUST contain every key from English. **Portuguese means Brazilian Portuguese
(pt_BR) — all translations MUST use Brazilian vocabulary, spelling, and grammar
conventions, never European Portuguese.** A translation key absent from a non-English
dictionary at runtime MUST trigger fallback to the English value for that key
(not a crash or empty string).

**Why:** V14 requires zero-cost static lookup — no API calls, no runtime translation.

**Acceptance Criteria:**
- [ ] File `src/i18n/en.ts` exists and exports an object with all ~190 string keys.
- [ ] File `src/i18n/pt.ts` exists and exports an object with all keys from `en.ts`.
- [ ] File `src/i18n/es.ts` exists and exports an object with all keys from `en.ts`.
- [ ] All three dictionaries export the same TypeScript type `I18nDictionary`.
- [ ] Adding a new key to `en.ts` without adding it to `pt.ts` causes a TypeScript
      compile error via `satisfies` or equivalent constraint.
- [ ] Runtime lookup `t("missing_key")` returns `"missing_key"` (not crash, not empty).
- [ ] Runtime lookup `t("existing_key")` for locale `pt` missing that key returns
      the English value (not crash, not empty string).

### FR-004: Translation Function (t)

**What:** The system MUST provide a synchronous function `t(key, replacements?)`
that accepts a translation key string and an optional map of placeholder replacements,
and returns the translated string for the currently active locale. Placeholders in
template strings (`{{name}}`) MUST be replaced with corresponding values from the
`replacements` map. Missing replacements MUST leave the placeholder intact.

**Why:** All UI components must call a single function to get translated strings.

**Acceptance Criteria:**
- [ ] `t("welcome.tip", { shortcut: "Ctrl+V", action: "Paste image" })` with template
      `"{{shortcut}}: {{action}}"` returns `"Ctrl+V: Paste image"` (English).
- [ ] `t("welcome.tip", { shortcut: "Ctrl+V", action: "Colar imagem" })` with
      Portuguese dictionary returns `"Ctrl+V: Colar imagem"`.
- [ ] `t("key.with.missing.replacement", {})` with template `"Hello {{name}}"` returns
      `"Hello {{name}}"` (placeholder preserved).
- [ ] `t("nonexistent.key")` returns `"nonexistent.key"`.
- [ ] `t("existing.key")` is synchronous — no Promise, no callback.
- [ ] `t()` does not throw for any input.

### FR-005: React Context for Active Locale

**What:** A React context `LocaleContext` MUST provide the active locale code and
the `t()` function to all descendant components. The context MUST be provided at
the top level of the component tree in `App.tsx`.

**Why:** All UI components need access to the translation function without prop
drilling. This follows the existing pattern used by `AppContext` and `AppStateContext`.

**Acceptance Criteria:**
- [ ] `LocaleContext` is a React context with value `{ locale: string; t: I18nTFunction }`.
- [ ] `useLocale()` hook is provided for consuming components.
- [ ] All components that currently render user-facing strings use `useLocale().t(key)`.
- [ ] The context value does NOT change at runtime (locale is static for a process lifetime).

### FR-006: Translation of All ~190 UI Strings

**What:** Every user-facing string displayed in the terminal UI MUST be translated
to Portuguese and Spanish. The scope includes:

1. **Slash command descriptions** (31 strings from `slash-commands.ts`):
   `list-skills`, `select-model`, `start-fresh`, `initialize-agents`, `resume-conversation`,
   `continue-conversation`, `undo-restore`, `mcp-status`, `toggle-display-mode`,
   `steering-add`, `steering-list`, `spec-init`, `spec-plan`, `spec-new`,
   `spec-verify`, `spec-implement`, `spec-audit`, `spec-list`, `spec-status`,
   `quit-dscode`, `clear-screen`, `model-list`, `model-add`, `model-remove`,
   `model-info`, `model-key`, `model-default`, `model-params`, `model-thinking`,
   `no-description`

2. **Welcome screen tips** (11 strings from `WelcomeScreen.tsx`):
   `tip-send-prompt`, `tip-insert-newline`, `tip-insert-newline-alt`,
   `tip-paste-image`, `tip-interrupt`, `tip-slash-commands`, `tip-quit`,
   `thinking-active`, `non-thinking`, `label-by`,
   `version`

3. **Help modal shortcuts** (32 strings from `HelpModal.tsx`):
   `help-title`, `help-toggle`, `help-close`, `help-cancel`, `help-view-output`,
   `help-paste-image`, `help-undo`, `help-redo`, `help-jump-word-left-right`,
   `help-jump-word-mac`, `help-line-start`, `help-line-end`, `help-kill-line`,
   `help-delete-word`, `help-delete-word-alt`, `help-history-navigate`,
   `help-autocomplete`, `help-newline`, `help-submit`, `help-file-mention`,
   `help-command-menu`, `help-model-cmd`, `help-new-cmd`, `help-resume-cmd`,
   `help-undo-cmd`, `help-raw-cmd`, `help-mcp-cmd`, `help-exit-cmd`,
   `help-scroll-history`, `help-press-esc`, `help-title`

4. **Error classification** (10 patterns from `error-classification.ts`):
   `error-auth-label`, `error-auth-hint`, `error-timeout-label`, `error-timeout-hint`,
   `error-connection-refused-label`, `error-connection-refused-hint`,
   `error-network-label`, `error-network-hint`, `error-cancelled-label`,
   `error-cancelled-hint`, `error-permission-label`, `error-permission-hint`,
   `error-generic-label`, `error-generic-hint`

5. **Model command wizard messages** (~60 strings from `model-command-handlers.ts`):
   All user-facing wizard prompts, usage instructions, field labels,
   formatting templates, success messages, warning messages, and error
   messages for all 8 model commands (`/model-list`, `/model-add`,
   `/model-remove`, `/model-info`, `/model-key`, `/model-default`,
   `/model-params`, `/model-thinking`).

6. **Status / footer / header** (~15 strings from `StatusBar.tsx`,
   `SessionStatsHeader.tsx`, `StreamingIndicator.tsx`, `StatusHeader.tsx`):
   Model display, session info, cost tracking labels, streaming status text.

7. **Permission prompt** (3 strings from `PermissionPrompt.tsx`): allow/deny/ask labels.

8. **Exit summary** (~8 strings from `exit-summary.ts`): goodbye header,
   column headers (`Model Usage`, `Input Tokens`, `Output Tokens`, `Cached Tokens`),
   cost labels (`Cost (USD)`, `Session`, `Today`, `Project`), `Reqs` header.

**Why:** V14 explicitly states "Covers slash command descriptions, welcome screen
tips, keyboard shortcuts, model command wizard messages, and error messages."
All product UI must speak the user's language.

**Acceptance Criteria:**
- [ ] All 31 slash command descriptions are translated to `pt` and `es`.
- [ ] All 11 welcome screen strings are translated to `pt` and `es`.
- [ ] All 32 help modal strings are translated to `pt` and `es`.
- [ ] All 14 error classification labels/hints are translated to `pt` and `es`.
- [ ] All ~60 model command wizard strings are translated to `pt` and `es`.
- [ ] All ~15 status/footer/header strings are translated to `pt` and `es`.
- [ ] All 3 permission prompt strings are translated to `pt` and `es`.
- [ ] All ~8 exit summary strings are translated to `pt` and `es`.
- [ ] No hardcoded English strings remain in rendered UI when locale is `pt` or `es`.
- [ ] `npm run typecheck` passes (0 errors).
- [ ] `npm test` passes all 663 tests with zero regressions.

### FR-007: Locale-Aware Formatting Helpers

**What:** The system MUST provide helpers for locale-aware formatting:
`formatNumber(n)` respecting locale thousands/decimal separators.

**Why:** Portuguese uses `1.234.567,89` while English uses `1,234,567.89`.
Spanish uses `1.234.567,89`.

**Acceptance Criteria:**
- [ ] `formatNumber(1234567.89, "pt")` returns `"1.234.567,89"`.
- [ ] `formatNumber(1234567.89, "es")` returns `"1.234.567,89"`.
- [ ] `formatNumber(1234567.89, "en")` returns `"1,234,567.89"`.
- [ ] `formatNumber(0, "pt")` returns `"0"`.
- [ ] Cost display `$0.44` is locale-independent (always `$`, no i18n of currency symbol).

### FR-008: Environment Variable `DEEPCODE_LOCALE`

**What:** The system MUST read the `DEEPCODE_LOCALE` environment variable during
settings resolution and use its value to override OS locale detection.
`DEEPCODE_LOCALE` takes highest priority among all locale sources.

**Why:** Users need a non-persistent way to override locale that works across
machines without modifying `settings.json`.

**Acceptance Criteria:**
- [ ] `DEEPCODE_LOCALE=pt` overrides `settings.json` `"locale": "es"`.
- [ ] `DEEPCODE_LOCALE=es` overrides OS locale `pt`.
- [ ] `DEEPCODE_LOCALE=fr` (unsupported) falls through to next-priority source.
- [ ] `DEEPCODE_LOCALE=` (empty string) is ignored.

### FR-009: Locale Constant for Process Lifetime

**What:** The resolved locale MUST be computed once at startup and remain
constant for the process lifetime. Dynamically changing locale mid-session
is out of scope.

**Why:** Simplifies implementation. If a user changes `locale` in `settings.json`
during a session, it takes effect on next startup — consistent with how other
settings (model, temperature) behave today.

**Acceptance Criteria:**
- [ ] `resolveLocale()` is called once and its result is stored.
- [ ] Changing `settings.json` `locale` while DsCode is running does NOT change
      UI language until next restart.
- [ ] The locale value is available synchronously to all components via context.

### FR-010: Backward Compatibility — English Default

**What:** When locale detection resolves to any language other than `pt` or `es`,
English MUST be used. English is also the compile-time default. All existing
behavior is preserved when locale is English.

**Why:** V14 requires "Non-translated languages fall back to English. Existing
English UI is the default and zero behavior changes when locale detection fails."

**Acceptance Criteria:**
- [ ] When locale resolves to `en`, all UI strings are exactly the same as before
      this spec (no changes to message content).
- [ ] When locale resolves to `fr` (unsupported), English is used.
- [ ] When locale detection returns `null`/`undefined`, English is used.
- [ ] `npm test` passes all existing tests with locale `en`.

---

## Non-Functional Requirements

### NFR-001: Performance — Zero Overhead at Startup

**What:** Locale detection and dictionary loading MUST add less than 5ms to startup
time. Dictionary files are imported statically at compile time (TypeScript `import`),
not loaded via `fs.readFileSync` at runtime.

**Acceptance Criteria:**
- [ ] Dictionary imports are static ES module imports — no dynamic `import()` or `require()`.
- [ ] `resolveLocale()` returns in <1ms (pure string ops, no I/O).
- [ ] `t()` returns in <0.01ms per call (hashmap lookup + regex replace).

### NFR-002: Performance — No Runtime Cost per Render

**What:** Translation lookups are O(1) hashmap accesses. No regex operations on
every render beyond placeholder replacement (which is bounded to 5 replacements per string).

**Acceptance Criteria:**
- [ ] `t()` does zero array scans or iterations beyond placeholder replacement.
- [ ] Ink component re-renders do not retrigger locale detection or dictionary loading.

### NFR-003: Memory — Dictionary Size

**What:** All three dictionaries loaded simultaneously MUST consume less than 60KB
of heap memory combined. Each dictionary is a flat object with ~190 keys.

**Acceptance Criteria:**
- [ ] `Buffer.byteLength(JSON.stringify(enDictionary))` < 20KB.
- [ ] `Buffer.byteLength(JSON.stringify(ptDictionary))` < 20KB.
- [ ] `Buffer.byteLength(JSON.stringify(esDictionary))` < 20KB.

### NFR-004: Maintainability — Type Safety

**What:** The `I18nDictionary` type MUST be derived from the English dictionary
object. Non-English dictionaries MUST use `satisfies I18nDictionary` to ensure
compile-time verification that all keys exist.

**Acceptance Criteria:**
- [ ] `type I18nDictionary = { readonly [K in keyof typeof enDictionary]: string }` — type is derived from English keys, values are `string`.
- [ ] `ptDictionary` is `satisfies I18nDictionary`.
- [ ] `esDictionary` is `satisfies I18nDictionary`.
- [ ] Adding a key to English without adding to Portuguese causes `tsc` error.

### NFR-005: Testability

**What:** The `t()` function and `resolveLocale()` MUST be pure functions
testable without React, Ink, or terminal dependencies. Dictionary objects
MUST be importable in Node.js test files.

**Acceptance Criteria:**
- [ ] `resolveLocale()` is a standalone function with no React dependency.
- [ ] `t(dict, key, replacements)` is a standalone function with no React dependency.
- [ ] Dictionary files are plain TypeScript objects — no JSX, no hooks.
- [ ] Unit tests exist for `resolveLocale()` covering all priority order cases.
- [ ] Unit tests exist for `t()` covering key lookup, fallback, and placeholder replacement.
- [ ] Unit tests exist for `formatNumber()` covering pt, es, en formatting.
- [ ] Integration tests exist verifying that components render translated strings.

---

## Constraints

1. **P6 (Zero New Dependencies):** No npm package is added. Locale detection uses
   built-in Node.js APIs (`process.env`, `Intl`, child_process for Windows).
   Dictionary files are plain TypeScript. Placeholder replacement is a simple
   regex — no `i18next`, `react-intl`, or similar library.

2. **P4 (Surgical Changes):** Existing files are modified only where strings are
   replaced with `t()` calls. No reformatting, refactoring, or "while I'm here"
   improvements to adjacent code.

3. **P1 (Interface-First):** The i18n system is exposed through a clean interface
   (`I18nDictionary`, `t()`, `resolveLocale()`, `useLocale()`).

4. **P7 (Provider-Agnostic Configuration):** The `locale` field is a top-level
   setting in `settings.json`, not nested under any provider namespace.

5. **No RTL support:** Arabic, Hebrew, and other RTL languages are out of scope.
   Terminal emulators have inconsistent RTL support and this would require layout
   changes in Ink/Yoga.

6. **AI conversation remains English:** The LLM system prompt, tool definitions,
   and skill documents are NOT translated. Only the product shell (CLI UI) is
   translated.

7. **No dynamic language switching:** Locale is resolved once at startup. There
   is no `/locale` command or in-session toggle.

---

## Edge Cases & Error States

- **E1:** `settings.json` contains `"locale": "PT"` (uppercase) → rejected by Zod
  enum validator; error written to stderr; locale falls back to OS detection.
- **E2:** `DEEPCODE_LOCALE=fr` + `settings.json` `"locale": "pt"` → `fr` is
  unsupported, falls through to `pt` from settings.
- **E3:** OS locale is `zh_CN` → not in supported set, resolves to `en`.
- **E4:** Dictionary file for `pt` is missing a key that `en` has → runtime
  fallback returns English value for that key. TypeScript `satisfies` prevents
  this at compile time.
- **E5:** `t()` is called with `undefined` or `null` key → returns empty string `""`.
- **E6:** `formatNumber(NaN, "pt")` → returns `"NaN"` (Native JS behavior, acceptable).
- **E7:** `formatNumber(Infinity, "es")` → returns `"∞"` (Native JS behavior, acceptable).
- **E8:** Windows PowerShell fails to execute for locale detection → falls back to
  `Intl.DateTimeFormat().resolvedOptions().locale`.
- **E9:** `Intl.DateTimeFormat` returns a locale with script subtag like `pt-Latn-BR` →
  normalization extracts `pt` correctly.
- **E10:** Multiple `DEEPCODE_*` env vars coexist — `DEEPCODE_LOCALE` is read
  independently from `DEEPCODE_MODEL`, `DEEPCODE_API_KEY`, etc.

---

## Dependencies

- **None on other specs.** Spec 90 is standalone. No dependency on specs 30–80.
- **Internal dependency:** `settings.ts` (settings resolution pipeline), `settings-schema.ts`
  (Zod schema for `locale` field).
- **Existing libraries:** `zod` (for schema validation), `react` (for context), `ink`
  (for component rendering). All already in `package.json`.

---

## Out of Scope

1. AI conversation translation (LLM prompts, tool descriptions, skill documents).
2. README localization (already in `docs/i18n/`).
3. RTL language support (Arabic, Hebrew, Persian).
4. Dynamic language switching during a session (requires restart).
5. `/locale` slash command for in-session switching.
6. Translation of `budget.md`, log files, or debug output.
7. Machine translation via API (statements like "Powered by Google Translate").
8. Pluralization rules (`1 message` vs `2 messages`) — English-style plural suffixes
   are acceptable for V1.
9. Date/time formatting beyond `formatNumber`.
10. Translation of EXE binary metadata (Windows version info).
