# Spec 90: Product i18n — Design

## Design Approach

**Strategy:** Minimal, zero-dependency i18n via static TypeScript dictionaries,
a synchronous translation function, and a React context. Locale is resolved once
at startup by reading `DEEPCODE_LOCALE` env var → `settings.json` `locale` field →
OS locale detection — falling back to `en`.

**Key design decisions:**

1. **All dictionaries imported statically at compile time** — no `fs.readFileSync`,
   no dynamic `import()`. All three dictionaries (~190 keys each) are ES module
   imports. This adds <5ms to startup and ~45KB to bundle.

2. **English is the type authority** — `type I18nDictionary = typeof enDictionary`.
   Portuguese and Spanish dictionaries use `satisfies I18nDictionary` for compile-time
   guarantee that all keys exist.

3. **No `i18next` or library** — placeholder replacement is a simple regex over a
   maximum of 5 replacements. Hashmap lookup is O(1). No pluralization engine,
   no ICU message format, no date/time library.

4. **Locale resolution is synchronous and pure** — no async OS calls except on
   Windows where a child process is spawned to call PowerShell. This spawn is
   synchronous (`execSync`). The result is cached for process lifetime.

5. **React context follows existing pattern** — `LocaleContext` mirrors
   `AppContext` / `AppStateContext` in structure and usage. A `useLocale()` hook
   provides `{ locale, t }`.

---

## Architecture Decisions

No new ADR entries needed. This spec follows existing architecture principles:

| Principle | How it's applied |
|-----------|-----------------|
| P1 (Interface-First) | `I18nDictionary` type, `I18nTFunction` type, `LocaleContext` |
| P2 (Canonical Types) | Single `I18nDictionary` type derived from English |
| P3 (Streaming-First) | N/A — no server communication |
| P4 (Surgical Changes) | Only string literals are replaced with `t()` calls |
| P5 (Test Integrity) | Existing tests pass unmodified; new tests for i18n behavior |
| P6 (Zero Dependencies) | No new npm packages |
| P7 (Provider-Agnostic) | `locale` is a top-level setting, not under any provider |

---

## Component / Module Breakdown

### Component 1: `resolveLocale()`

**File:** `src/i18n/locale.ts` (new file)

**Purpose:** Detect and resolve the user's locale at startup.

**Interface:**
```typescript
export type SupportedLocale = "en" | "pt" | "es";

export function resolveLocale(
  settingsLocale?: string | null
): SupportedLocale;
```

**Parameters:**
- `settingsLocale`: the value of `settings.json` `locale` field (already validated
  by Zod), or `undefined`/`null` if not set.

**Internal Logic:**
1. Read `process.env.DEEPCODE_LOCALE`. If present and non-empty, normalize it.
   If normalized value is non-null, return it. Else fall through to step 2.
2. If `settingsLocale` is provided, normalize it. If non-null, return it.
   Else fall through to step 3.
3. Detect OS locale:
   a. POSIX: Read `process.env.LANG` || `process.env.LC_ALL`. If set, extract
      the language subtag via `normalizeLocale`. If non-null, return it.
   b. All platforms: Try `Intl.DateTimeFormat().resolvedOptions().locale`.
      Normalize it. If non-null, return it.
   c. Windows-specific: Execute `powershell -NoProfile -Command "[System.Globalization.CultureInfo]::CurrentUICulture.Name"`
      via `execSync`. Normalize the result. If non-null, return it.
4. Default: return `"en"`.

**Normalization function:**
```typescript
function normalizeLocale(raw: string): SupportedLocale | null {
  const cleaned = raw.trim().toLowerCase().replace(/[_-].*$/, "");
  if (cleaned === "pt" || cleaned === "es" || cleaned === "en") {
    return cleaned;
  }
  return null; // unsupported — caller falls through to next priority source
}
```
Signatures affected:
```typescript
function normalizeLocale(raw: string): SupportedLocale | null;
function resolveLocale(settingsLocale?: string | null): SupportedLocale;
```
`resolveLocale` uses `normalizeLocale` internally. It returns `"en"` only as the
final fallback after all priority sources are exhausted. `normalizeLocale` itself
returns `null` for unsupported locales to allow the caller to try the next source.

**Dependencies:** `node:child_process` (execSync) — already in project; `Intl` — built-in.

**Error Handling:**
- `execSync` throws if PowerShell is unavailable → catch and fall through to `Intl`.
- `Intl.DateTimeFormat` throws only in pre-ES2020 environments → unreachable (Node ≥24).
- All code paths return a `SupportedLocale`. The function never returns `null` or throws.

---

### Component 2: Translation Dictionaries

**Files:**
- `src/i18n/en.ts` (new)
- `src/i18n/pt.ts` (new)
- `src/i18n/es.ts` (new)
- `src/i18n/dictionary.ts` (new — barrel export + types)

**`src/i18n/dictionary.ts` interface:**
```typescript
import { enDictionary } from "./en";

export type I18nDictionary = {
  readonly [K in keyof typeof enDictionary]: string;
};
export type I18nKey = keyof I18nDictionary & string;

export { enDictionary } from "./en";
export { ptDictionary } from "./pt";
export { esDictionary } from "./es";

export function getDictionary(locale: string): I18nDictionary {
  switch (locale) {
    case "pt": return ptDictionary;
    case "es": return esDictionary;
    default: return enDictionary;
  }
}

export function resolveDictionary(
  locale: string,
  dict: I18nDictionary
): I18nDictionary {
  // Returns a proxy that falls back to enDictionary for missing keys.
  // At compile time, satisfies prevents missing keys; at runtime this
  // is a safety net.
  return new Proxy(dict, {
    get(target, prop) {
      if (typeof prop === "string" && prop in target) {
        return target[prop as keyof I18nDictionary];
      }
      if (typeof prop === "string" && prop in enDictionary) {
        return enDictionary[prop as keyof I18nDictionary];
      }
      return undefined;
    },
  }) as I18nDictionary;
}
```

**`src/i18n/en.ts` structure:**
```typescript
const enDictionary = {
  // Slash command descriptions
  "cmd.list-skills": "List available skills",
  "cmd.select-model": "Select model, thinking mode and effort control",
  "cmd.start-fresh": "Start a fresh conversation",
  "cmd.initialize-agents": "Initialize an AGENTS.md file with instructions for LLM",
  "cmd.resume-conversation": "Pick a previous conversation to continue",
  "cmd.continue-conversation": "Continue the active conversation or pick one to resume",
  "cmd.undo-restore": "Restore code and/or conversation to a previous point",
  "cmd.mcp-status": "Show MCP server status and available tools",
  "cmd.toggle-display-mode": "Toggle display mode for viewing or collapsing reasoning content",
  "cmd.steering-add": "Add a steering rule to the STEERINGS section of AGENTS.md",
  "cmd.steering-list": "List all steering rules from the STEERINGS section of AGENTS.md",
  "cmd.spec-init": "Initialize SDD structure: vision, arch, roadmap, ADR, and lessons files",
  "cmd.spec-plan": "Plan specs from brainstorming, align with vision, update roadmap",
  "cmd.spec-new": "Create a new spec with requirements, design, and task documents",
  "cmd.spec-verify": "Verify spec completeness, determinism, and alignment with vision",
  "cmd.spec-implement": "Implement all tasks from a spec sequentially",
  "cmd.spec-audit": "Audit implementation quality and correctness for a spec",
  "cmd.spec-list": "List all specs with their statuses from the roadmap",
  "cmd.spec-status": "Show detailed status of a specific spec or all specs",
  "cmd.quit-dscode": "Quit DsCode CLI",
  "cmd.clear-screen": "Clear the terminal screen",
  "cmd.model-list": "List configured LLM providers with their models and pricing",
  "cmd.model-add": "Add a new LLM provider with API key and base URL",
  "cmd.model-remove": "Remove a configured LLM provider",
  "cmd.model-info": "Show detailed information about a specific model",
  "cmd.model-key": "Update API key for a configured provider",
  "cmd.model-default": "Set the default model",
  "cmd.model-params": "Configure generation parameters (temperature, max_tokens, top_p)",
  "cmd.model-thinking": "Configure thinking budget for extended-thinking models",
  "cmd.no-description": "(no description)",

  // Welcome screen
  "welcome.tip-send-prompt": "Send the prompt",
  "welcome.tip-insert-newline": "Insert a newline",
  "welcome.tip-insert-newline-alt": "Insert a newline (terminal-dependent)",
  "welcome.tip-paste-image": "Paste an image from the clipboard",
  "welcome.tip-interrupt": "Interrupt the current model turn",
  "welcome.tip-slash-commands": "Open the skills and commands menu",
  "welcome.tip-quit": "Quit DsCode CLI",
  "welcome.thinking-active": "thinking mode active",
  "welcome.non-thinking": "non-thinking mode",
  "welcome.label-by": "by",
  "welcome.version": "v{{version}}",

  // Help modal title
  "help.title": "Keyboard Shortcuts & Commands",
  "help.toggle": "Toggle help (this screen)",
  "help.close": "Close current modal / cancel / interrupt",
  "help.cancel": "Cancel input / interrupt",
  "help.view-output": "View live process output / expand paste",
  "help.paste-image": "Paste clipboard image",
  "help.undo": "Undo last prompt edit",
  "help.redo": "Redo last prompt edit",
  "help.jump-word": "Jump word left/right",
  "help.jump-word-mac": "Jump word left/right (macOS)",
  "help.line-start": "Move to line start",
  "help.line-end": "Move to line end",
  "help.kill-line": "Kill line from cursor",
  "help.delete-word": "Delete word before cursor",
  "help.delete-word-alt": "Delete word before cursor",
  "help.history": "Navigate history (when prompt empty) / navigate menus",
  "help.autocomplete": "Autocomplete (slash commands, file mentions)",
  "help.newline": "Insert newline in prompt (always available)",
  "help.submit": "Submit prompt (when not in menu)",
  "help.file-mention": "Trigger file mention autocomplete",
  "help.command-menu": "Trigger slash command menu",
  "help.model-cmd": "Change model",
  "help.new-cmd": "New conversation",
  "help.resume-cmd": "Resume previous conversation",
  "help.undo-cmd": "Restore code/conversation to earlier point",
  "help.raw-cmd": "Toggle raw display mode",
  "help.mcp-cmd": "Show MCP server status",
  "help.exit-cmd": "Quit dscode",
  "help.scroll-history": "Scroll message history",
  "help.press-esc": "Press Esc to close",

  // Error classification
  "error.auth-label": "Authentication Error",
  "error.auth-hint": "Check your API key in settings.json",
  "error.timeout-label": "Timeout",
  "error.timeout-hint": "The server took too long. Press Enter to retry.",
  "error.connection-refused-label": "Connection Refused",
  "error.connection-refused-hint": "Check your internet connection and base URL.",
  "error.network-label": "Network Error",
  "error.network-hint": "Check your internet connection and base URL.",
  "error.cancelled-label": "Cancelled",
  "error.cancelled-hint": "Request was cancelled. You can try again.",
  "error.permission-label": "Permission Error",
  "error.permission-hint": "Check your permission settings with /permissions.",
  "error.generic-label": "Error",
  "error.generic-hint": "Press Enter to continue.",

  // Model command output labels
  "model.status-key": "key",
  "model.status-no-key": "no key",
  "model.status-no-pricing": "no pricing",
  "model.unknown-base-url": "unknown",
  "model.no-models-in-catalog": "No models in catalog.",
  "model.provider-unconfigured": "Provider '{{provider}}' is not configured. Use /model-add {{provider}} first.",
  "model.unknown-model": "Unknown model '{{modelId}}'. Use /model to see available models.",
  "model.already-default": "{{displayName}} is already the default model.",
  "model.set-default": "✅ Default model set to {{displayName}} ({{modelId}}).",
  "model.no-api-key-warning": "Warning: No API key configured for {{provider}}. This model won't work until you configure one with /model-add {{provider}} or /model-key {{provider}}.",
  "model.removed": "✅ Provider '{{provider}}' removed. Models from this provider are still listed in /model but will need an API key to use.",
  "model.cancelled": "Cancelled.",
  "model.key-updated": "✅ API key for {{provider}} updated. {{maskedKey}}",
  "model.key-encrypted": "Current key: encrypted (cannot decrypt — keyfile may be missing).",
  "model.key-env-var": "Current key: set via environment variable DEEPCODE_ENGINE_{{providerUpper}}_API_KEY.",
  "model.key-not-set": "Current key: not set.",
  "model.params-updated": "✅ Generation parameters updated: {{params}}.",
  "model.thinking-updated": "✅ Thinking budget for {{displayName}} set to {{budget}} tokens.",
  "model.usage-model-add": "Usage: /model-add <provider>. Valid providers: {{providers}}.",
  "model.unknown-provider": "Unknown provider '{{provider}}'. Valid providers: {{valid}}.",
  "model.already-configured": "Provider '{{provider}}' already has an API key configured. Use /model-key {{provider}} to update it.",
  "model.wizard-base-url": "Base URL: {{defaultBaseUrl}}. Press ENTER to accept default, or type a custom URL:",
  "model.wizard-invalid-url": "Invalid URL. Must start with http:// or https://.",
  "model.wizard-api-key-prompt": "API Key required. Obtain one at: {{keyUrl}}.\nEnter API key (or ESC to cancel):",
  "model.wizard-key-too-short": "API key must be at least 8 characters.",
  "model.wizard-confirm": "Press ENTER to confirm, or type \"retry\" to re-enter:\n  Provider: {{provider}}\n  Base URL: {{baseUrl}}\n  API Key: {{maskedKey}}",
  "model.wizard-unexpected": "Unexpected wizard state.",
  "model.format-provider": "Provider:  {{provider}}",
  "model.format-base-url": "Base URL:  {{baseUrl}}",
  "model.format-api-key": "API Key:   {{maskedKey}}",
  "model.format-available-models": "Available models ({{count}}):",
  "model.format-use-model": "Use /model to select a {{provider}} model.",
  "model.format-section-header": "── {{provider}} ──",
  "model.usage-model-remove": "Usage: /model-remove <provider>. Currently configured: {{configured}}.",
  "model.not-configured": "Provider '{{provider}}' is not configured. Nothing to remove.",
  "model.remove-sole-warning": "Warning: {{provider}} is the only configured provider and is currently active. Removing it will leave no API keys. Continue? Type 'yes' to confirm.",
  "model.remove-current-warning": "Warning: the current model '{{model}}' uses {{provider}}. After removal, switch to another model with /model. Continue? Type 'yes' to confirm.",
  "model.remove-confirm": "Remove provider '{{provider}}'? Type 'yes' to confirm.",
  "model.usage-model-info": "Usage: /model-info <model-id>. Example: /model-info gpt-5.5",
  "model.info-model": "Model:       {{displayName}} ({{id}})",
  "model.info-provider": "Provider:    {{provider}}",
  "model.info-context": "Context:     {{context}}",
  "model.info-max-output": "Max Output:  {{maxOutput}}",
  "model.info-multimodal": "Multimodal:  {{multimodal}}",
  "model.info-thinking": "Thinking:    {{type}}",
  "model.info-default": "  Default:   {{effort}}",
  "model.info-budget": "  Budget:    {{budget}}",
  "model.info-pricing": "Pricing:     ${{input}}/${{output}} per 1M tokens (cached: ${{cached}}/1M)",
  "model.info-pricing-na": "Pricing:     not available",
  "model.info-status-key-ok": "Status:      ✅ API key configured",
  "model.info-status-no-key": "Status:      ❌ No API key configured",
  "model.label-yes": "yes",
  "model.label-no": "no",
  "model.usage-model-default": "Usage: /model-default <model-id>. Current default: {{display}} ({{modelId}}).",
  "model.usage-model-key": "Usage: /model-key <provider>. Configured providers: {{providers}}.",
  "model.env-var-hint": "Note: {{provider}} may have a key set via environment variable {{envVar}}. Setting a key in settings.json will override the env var.",
  "model.wizard-enter-key": "Enter new API key (or ESC to cancel):",
  "model.params-current": "Current generation parameters:",
  "model.params-temperature": "  Temperature:  {{value}} (range: 0.0–2.0)",
  "model.params-max-tokens": "  Max Tokens:   {{value}} (range: 1–{{max}})",
  "model.params-top-p": "  Top P:        {{value}} (range: 0.0–1.0, or \"not set\")",
  "model.params-not-set": "not set",
  "model.params-choose": "Which parameter? (temperature/max_tokens/top_p) or 'done' to finish:",
  "model.params-enter-temperature": "Enter temperature (0.0–2.0, current: {{current}}):",
  "model.params-enter-max-tokens": "Enter max tokens (1–{{max}}, current: {{current}}):",
  "model.params-enter-top-p": "Enter top_p (0.0–1.0, or 'none' to unset, current: {{current}}):",
  "model.params-invalid-choice": "Invalid parameter. Choose temperature, max_tokens, top_p, or 'done'.",
  "model.params-error-temperature": "Temperature must be between 0.0 and 2.0.",
  "model.params-error-max-tokens": "Max tokens must be between 1 and {{max}}.",
  "model.params-error-top-p": "Top P must be between 0.0 and 1.0, or 'none' to unset.",
  "model.usage-model-thinking": "Usage: /model-thinking <model-id>. Models with configurable thinking budget: {{models}}.",
  "model.thinking-not-extended": "Model '{{displayName}}' has reasoning type '{{type}}'. Thinking budget is only configurable for extended thinking models. Models with configurable budgets: {{models}}.",
  "model.thinking-current": "Current thinking budget: {{budget}} tokens\nMax output tokens: {{maxOutput}}\n\nEnter thinking budget in tokens (1024–{{maxOutput}}, or ENTER for default {{default}}):",
  "model.thinking-error-range": "Budget must be between 1024 and {{max}}.",
  "model.key-current": "Current key: {{display}}",
  "model.format-provider-line": "  {{keyStatus}}  ·  {{baseUrl}}  ·  {{modelCount}} models  ·  {{priceRange}}",
  "model.format-model-line": "    {{modelId}}  {{displayName}}  {{pricing}}",

  // Exit summary
  "exit.goodbye": "Goodbye!",
  "exit.model-usage": "Model Usage",
  "exit.input-tokens": "Input Tokens",
  "exit.output-tokens": "Output Tokens",
  "exit.cached-tokens": "Cached Tokens",
  "exit.reqs": "Reqs",
  "exit.cost-usd": "Cost (USD)",
  "exit.session-cost": "Session:   {{cost}}",
  "exit.today-cost": "Today:     {{cost}}",
  "exit.project-cost": "Project:   {{cost}}",

  // Status bar / header
  "status.thinking": "thinking",
  "status.cwd": "cwd",
  "status.thinking-mode": "thinking mode active",
  "status.non-thinking-mode": "non-thinking mode",
  "status.streaming": "Streaming...",
  "status.waiting": "Waiting...",
  "status.no-session": "No active session",
  "status.press-enter": "Press Enter to continue",
  "status.model-loading": "Loading models...",
  "status.processing": "Processing...",
  "status.interrupted": "Interrupted",
  "status.session-stats": "Session: {{name}} | Model: {{model}} | Turns: {{turns}}",

  // Permission prompt
  "permission.allow": "Allow",
  "permission.deny": "Deny",
  "permission.ask": "Ask",
} as const;

export { enDictionary };
export default enDictionary;
```

**`src/i18n/pt.ts` structure:**
```typescript
import type { I18nDictionary } from "./dictionary";

const ptDictionary = {
  "cmd.list-skills": "Listar skills disponíveis",
  // ... all ~190 keys translated to Brazilian Portuguese (pt_BR)
} as const satisfies I18nDictionary;

export { ptDictionary };
export default ptDictionary;
```

**⚠️ Portuguese = Brazilian Portuguese (pt_BR).** All pt.ts translations MUST use
Brazilian vocabulary (`você`, not `tu`), spelling (`controle`, not `controlo`),
and grammar conventions. European Portuguese is explicitly rejected.

**`src/i18n/es.ts` structure:**
```typescript
import type { I18nDictionary } from "./dictionary";

const esDictionary = {
  "cmd.list-skills": "Listar skills disponibles",
  // ... all ~190 keys translated to Spanish
} as const satisfies I18nDictionary;

export { esDictionary };
export default esDictionary;
```

**Key naming convention:** `category.subcategory-key-name` using dot notation.
All keys are kebab-case after the first dot. Categories: `cmd`, `welcome`, `help`,
`error`, `model`, `exit`, `status`, `permission`.

**Dependencies:** None. Pure TypeScript objects.

**Error Handling:** If a key is missing from a non-English dictionary, the
`resolveDictionary()` proxy returns the English fallback value. This is a safety
net — the `satisfies I18nDictionary` constraint prevents this at compile time.

---

### Component 3: Translation Function `t()`

**File:** `src/i18n/translate.ts` (new file)

**Interface:**
```typescript
import type { I18nDictionary, I18nKey } from "./dictionary";

export type I18nReplacements = Record<string, string | number>;

export type I18nTFunction = {
  (key: I18nKey, replacements?: I18nReplacements): string;
  (key: string): string;
};

export function createTFunction(dictionary: I18nDictionary): I18nTFunction {
  return (key: string, replacements?: I18nReplacements): string => {
    const template = (dictionary as Record<string, string>)[key];
    if (!template) {
      return key;
    }
    if (!replacements || Object.keys(replacements).length === 0) {
      return template;
    }
    return template.replace(
      /\{\{(\w+)\}\}/g,
      (_, name: string) => {
        const value = replacements[name];
        return value !== undefined ? String(value) : `{{${name}}}`;
      }
    );
  };
}
```

**Internal Logic:**
1. Look up `key` in dictionary. If absent, return `key` as-is (safe fallback).
2. If no replacements, return template string as-is.
3. Replace all `{{placeholder}}` patterns with corresponding values from
   `replacements` map.
4. If a placeholder has no corresponding value, leave it intact.

**Dependencies:** None.

**Error Handling:** Never throws. Always returns a string.

---

### Component 4: `formatNumber()`

**File:** `src/i18n/format.ts` (new file)

**Interface:**
```typescript
export function formatNumber(n: number, locale: string): string;
```

**Internal Logic:**
Uses `Intl.NumberFormat` with the resolved locale:
```typescript
export function formatNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}
```

**Dependencies:** `Intl` — built-in.

**Error Handling:** Returns native JS string for `NaN`/`Infinity` (`"NaN"`, `"∞"`).

---

### Component 5: `LocaleContext` + `useLocale` Hook

**Files:** `src/i18n/context.ts` (new file)

**Interface:**
```typescript
import React from "react";
import type { I18nTFunction } from "./translate";

export type LocaleContextValue = {
  locale: string;
  t: I18nTFunction;
};

export const LocaleContext = React.createContext<LocaleContextValue>({
  locale: "en",
  t: (key: string) => key,
});

export function useLocale(): LocaleContextValue {
  return React.useContext(LocaleContext);
}

// ── Global t-function access for non-React code ─────────────────

let _activeT: I18nTFunction = (key: string) => key;

/** Called once during App startup to register the active t-function for
 *  non-React code (model-command-handlers, exit-summary, session.ts). */
export function setActiveTFunction(t: I18nTFunction): void {
  _activeT = t;
}

/** Returns the currently active t-function. Safe to call from any module. */
export function getActiveTFunction(): I18nTFunction {
  return _activeT;
}
```

**Internal Logic:**
- `LocaleContext` is a standard React context with default value `{ locale: "en", t: identity }`.
- `useLocale()` calls `React.useContext(LocaleContext)` — identical pattern to
  `useAppContext()` and `useAppStateContext()` in the existing codebase.
- The context is provided at the top of the component tree by `App.tsx` (or its wrapper).
- `setActiveTFunction(t)` is called in `App.tsx` immediately after `createTFunction(dict)`.
  This stores the t-function in a module-level variable accessible to non-React modules.
- `getActiveTFunction()` is used by `model-command-handlers.ts`, `exit-summary.ts`,
  `session.ts`, and any other non-React code that needs translated strings.

**Dependencies:** `react` — already in project.

**Error Handling:** If used outside provider, defaults to English identity function
(safe fallback — renders English strings as keys, which is visually obvious).
If `getActiveTFunction()` is called before `setActiveTFunction()` is invoked,
returns the English identity stashed at module init time.

---

### Component 6: Settings Schema Extension

**File:** `src/common/settings-schema.ts` (modify existing)

**Changes:**
1. Add a `locale` field to `deepcodingSettingsSchema`:
```typescript
export const deepcodingSettingsSchema = z.strictObject({
  // ... existing fields ...
  locale: z.enum(["en", "pt", "es"]).optional(),
});
```

2. The field is optional (`optional()`) — absence means "auto-detect."

**File:** `src/settings.ts` (modify existing)

**Changes:**
1. Add `locale?: "en" | "pt" | "es"` to `DeepcodingSettings` type.
2. Add `locale?: "en" | "pt" | "es"` to `ResolvedDeepcodingSettings` type (optional — `undefined` means "auto-detect").
3. In `resolveSettingsSources()`, add a helper to resolve `locale` from env/settings only
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
4. Add `locale` to the return object of `resolveSettingsSources()`.
5. `DEFAULT_SETTINGS` does NOT include a `locale` key.
6. `ensureSettingsDefaults()` does NOT backfill `locale`.

---

### Component 7: Integration in App.tsx

**File:** `src/ui/views/App.tsx` (modify existing)

**Changes:**
1. Import `resolveLocale`, `getDictionary`, `resolveDictionary`, `createTFunction`,
   `LocaleContext`, `LocaleContextValue`, `setActiveTFunction`.
2. In the `App` component, before rendering:
   ```typescript
   const settings = resolveCurrentSettings();
   const locale = resolveLocale(settings.locale);
   const rawDict = getDictionary(locale);
   const dict = resolveDictionary(locale, rawDict);
   const t = createTFunction(dict);
   const localeValue: LocaleContextValue = { locale, t };
   // Register t-function for non-React code (must happen once, before any render)
   setActiveTFunction(t);
   ```
3. Wrap the existing component tree with:
   ```tsx
   <LocaleContext.Provider value={localeValue}>
     {/* existing tree */}
   </LocaleContext.Provider>
   ```

---

### Component 8: String Replacement in All Components

**Files:** Every file listed in FR-006 scope (modify existing — surgical edits)

**Pattern for each component:**
1. Import `{ useLocale }` from `"../i18n/context"` or relative path.
2. Call `const { t } = useLocale()` in the component.
3. Replace each hardcoded English string with `t("key.name", replacements?)`.

**Examples:**

*Before (`slash-commands.ts`):*
```typescript
{ description: "List available skills" }
```

*After:*
```typescript
{ description: t("cmd.list-skills") }
```

*Before (`WelcomeScreen.tsx`):*
```typescript
const tips = [
  { label: "Enter", description: "Send the prompt" },
  { label: "Ctrl+J", description: "Insert a newline" },
];
```

*After:*
```typescript
const tips = [
  { label: "Enter", description: t("welcome.tip-send-prompt") },
  { label: "Ctrl+J", description: t("welcome.tip-insert-newline") },
];
```

*Note:* Keyboard key labels (`Enter`, `Ctrl+J`, `Esc`, `?`, `Up/Down`, `PageUp/PageDown`,
`Tab`, `@`, `/`, etc.) are NOT translated — they are physical key labels that don't change
across languages.

*Before (`HelpModal.tsx`):*
```typescript
{ key: "?", description: "Toggle help (this screen)" }
```

*After:*
```typescript
{ key: "?", description: t("help.toggle") }
```

*Before (`model-command-handlers.ts` — wizard messages):*
```typescript
message: `Usage: /model-add <provider>. Valid providers: ${...}`,
```

*After:*
```typescript
message: t("model.usage-model-add", { providers: validProviders }),
```

---

## Data Flow

### Startup sequence (cold path — runs once):

```
1. cli.tsx starts
2. resolveCurrentSettings() called
   → reads settings.json, env vars
   → returns ResolvedDeepcodingSettings with locale field
3. resolveLocale(settings.locale) called
   → checks DEEPCODE_LOCALE env var
   → checks settings.locale
   → detects OS locale (LANG, Intl, PowerShell)
   → fallback "en"
   → returns SupportedLocale
4. getDictionary(locale) → returns {en|pt|es}Dictionary
5. resolveDictionary(locale, dict) → returns proxy with English fallback
6. createTFunction(dictWithFallback) → returns t()
7. LocaleContext.Provider wraps component tree with { locale, t }
```

### Per-render sequence (hot path — runs on every Ink render):

```
1. Component calls useLocale().t("key.name", { replace1: "val1" })
2. t() does O(1) hashmap lookup in dictionary
3. If replacements provided, regex replaces {{placeholders}} (bounded to 5)
4. Returns translated string
5. Ink renders the string
```

---

## Data Structures

### `I18nDictionary`
```typescript
// Derived from enDictionary at compile time
type I18nDictionary = {
  readonly "cmd.list-skills": string;
  readonly "cmd.select-model": string;
  // ... ~190 readonly string properties with exact keys
};
```

### `SupportedLocale`
```typescript
type SupportedLocale = "en" | "pt" | "es";
```

### `I18nReplacements`
```typescript
type I18nReplacements = Record<string, string | number>;
```

### `I18nTFunction`
```typescript
type I18nTFunction = {
  (key: I18nKey, replacements?: I18nReplacements): string;
  (key: string): string;
};
```

### `LocaleContextValue`
```typescript
type LocaleContextValue = {
  locale: string;
  t: I18nTFunction;
};
```

### Settings extension
```typescript
// In DeepcodingSettings (settings.ts)
locale?: "en" | "pt" | "es";  // top-level, optional

// In ResolvedDeepcodingSettings (settings.ts)
locale?: "en" | "pt" | "es";  // undefined means "auto-detect"

// In settings-schema.ts Zod schema
locale: z.enum(["en", "pt", "es"]).optional(),
```

---

## File / Module Layout

```
src/
├── i18n/                          ← NEW directory
│   ├── context.ts                 ← LocaleContext, useLocale
│   ├── dictionary.ts              ← I18nDictionary type, getDictionary, resolveDictionary
│   ├── en.ts                      ← English dictionary (~190 keys)
│   ├── es.ts                      ← Spanish dictionary (~190 keys)
│   ├── format.ts                  ← formatNumber
│   ├── locale.ts                  ← resolveLocale, SupportedLocale, normalizeLocale
│   ├── pt.ts                      ← Portuguese dictionary (~190 keys)
│   └── translate.ts               ← createTFunction, I18nTFunction, I18nReplacements
│
├── common/
│   └── settings-schema.ts         ← MODIFY: add locale field to Zod schema
│
├── settings.ts                    ← MODIFY: add locale to types, resolveLocale in pipeline
│
└── ui/
    ├── views/
    │   ├── App.tsx                ← MODIFY: provide LocaleContext
    │   ├── WelcomeScreen.tsx      ← MODIFY: replace strings with t()
    │   ├── HelpModal.tsx          ← MODIFY: replace strings with t()
    │   ├── PermissionPrompt.tsx   ← MODIFY: replace strings with t()
    │   └── ...
    ├── components/
    │   ├── StatusBar.tsx          ← MODIFY: replace strings with t()
    │   ├── SessionStatsHeader.tsx ← MODIFY: replace strings with t()
    │   ├── StreamingIndicator.tsx ← MODIFY: replace strings with t()
    │   ├── StatusHeader.tsx       ← MODIFY: replace strings with t()
    │   └── ErrorBanner.tsx        ← MODIFY: replace strings with t()
    └── core/
        ├── slash-commands.ts      ← MODIFY: call t() for descriptions
        ├── model-command-handlers.ts ← MODIFY: replace ~60 strings with t()
        ├── error-classification.ts   ← MODIFY: replace 14 strings with t()
        └── command-handlers.ts    ← MODIFY: replace strings with t()

src/tests/
└── i18n.test.ts                   ← NEW: tests for resolveLocale, t, formatNumber
```

**No new npm packages. Zero new dependencies.**

---

## Testing Strategy

### Unit Tests (`src/tests/i18n.test.ts`)

| Test # | What it tests | Input | Expected output |
|--------|--------------|-------|----------------|
| 1 | `resolveLocale` — DEEPCODE_LOCALE=pt | env `DEEPCODE_LOCALE=pt` | `"pt"` |
| 2 | `resolveLocale` — DEEPCODE_LOCALE=es | env `DEEPCODE_LOCALE=es` | `"es"` |
| 3 | `resolveLocale` — settings pt | `resolveLocale("pt")` | `"pt"` |
| 4 | `resolveLocale` — settings es | `resolveLocale("es")` | `"es"` |
| 5 | `resolveLocale` — LANG=pt_BR | env `LANG=pt_BR.UTF-8` | `"pt"` |
| 6 | `resolveLocale` — LANG=es_ES | env `LANG=es_ES.UTF-8` | `"es"` |
| 7 | `resolveLocale` — LANG=en_US | env `LANG=en_US.UTF-8` | `"en"` |
| 8 | `resolveLocale` — unknown | env `LANG=fr_FR.UTF-8` | `"en"` |
| 9 | `resolveLocale` — all null/empty | no env, settings null | `"en"` |
| 10 | `resolveLocale` — DEEPCODE_LOCALE=fr | env `DEEPCODE_LOCALE=fr` | `"en"` (fallback) |
| 11 | `resolveLocale` — env beats settings | `DEEPCODE_LOCALE=es`, settings `"pt"` | `"es"` |
| 12 | `normalizeLocale` — pt_BR | `"pt_BR"` | `"pt"` |
| 13 | `normalizeLocale` — pt-PT | `"pt-PT"` | `"pt"` |
| 14 | `normalizeLocale` — empty | `""` | `null` |
| 15 | `normalizeLocale` — C | `"C"` | `null` |
| 16 | `t()` — basic lookup | `t("cmd.list-skills")` | `"List available skills"` |
| 17 | `t()` — with placeholders | `t("exit.session-cost", {cost: "0.44"})` | `"Session:   0.44"` |
| 18 | `t()` — missing key | `t("nonexistent")` | `"nonexistent"` |
| 19 | `t()` — null/undefined key | `t("")` | `""` |
| 20 | `t()` — missing replacement | `t("welcome.version", {})` | `"v{{version}}"` |
| 21 | `t()` — number replacement | `t("model.thinking-updated", {displayName: "GPT", budget: 8192})` | `"✅ Thinking budget for GPT set to 8192 tokens."` |
| 22 | `t()` — with `key` in dictionary not in type | `t("some_string")` | `"some_string"` |
| 23 | `formatNumber` — pt | `formatNumber(1234567.89, "pt")` | `"1.234.567,89"` |
| 24 | `formatNumber` — es | `formatNumber(1234567.89, "es")` | `"1.234.567,89"` |
| 25 | `formatNumber` — en | `formatNumber(1234567.89, "en")` | `"1,234,567.89"` |
| 26 | `formatNumber` — zero | `formatNumber(0, "pt")` | `"0"` |
| 27 | `getDictionary` — pt | `getDictionary("pt")` | returns `ptDictionary` object |
| 28 | `getDictionary` — es | `getDictionary("es")` | returns `esDictionary` object |
| 29 | `getDictionary` — en | `getDictionary("en")` | returns `enDictionary` object |
| 30 | `getDictionary` — unknown | `getDictionary("fr")` | returns `enDictionary` object |
| 31 | Dictionary type safety — pt | `ptDictionary satisfies I18nDictionary` | compile-time pass |
| 32 | Dictionary type safety — es | `esDictionary satisfies I18nDictionary` | compile-time pass |
| 33 | Dictionary completeness | Count keys in pt vs en | equal count |
| 34 | Dictionary completeness | Count keys in es vs en | equal count |
| 35 | `resolveDictionary` proxy fallback | Create proxy with empty dict, get known key | returns English value |

### Integration Tests (existing test files)

- Verify `npm test` passes all 663 existing tests with zero changes (locale stays `en`).
- Smoke test: manually set `DEEPCODE_LOCALE=pt` and verify welcome screen renders Portuguese.
- Smoke test: manually set `DEEPCODE_LOCALE=es` and verify slash command menu renders Spanish.

### Regression Check

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm run format:check` — 0 warnings.
- `npm run build` — succeeds.
- `npm test` — 663+ tests pass, 0 failures.

---

## Migration / Rollback

### Migration

No migration needed. This spec adds new behavior (locale detection, translation)
and new files. Existing English strings are extracted to `en.ts` but their runtime
values are unchanged. Users who don't set `locale` or `DEEPCODE_LOCALE` see
identical output to before.

Settings files without `locale` field continue to work — no migration script needed.

### Rollback

Reverting this spec means:
1. Remove `src/i18n/` directory.
2. Revert `src/settings.ts` changes (remove `locale` field).
3. Revert `src/common/settings-schema.ts` changes.
4. Revert all component changes (restore hardcoded English strings).
5. Revert `src/ui/views/App.tsx` to remove `LocaleContext.Provider`.

Rollback is safe because no data structures are permanently altered — only code changes.
