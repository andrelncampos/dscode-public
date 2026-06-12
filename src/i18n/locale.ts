import { execSync } from "node:child_process";

export type SupportedLocale = "en" | "pt" | "es";

/**
 * Normalize a raw locale string to a SupportedLocale or null.
 * Returns null for unsupported locales so the caller can fall through
 * to the next priority source.
 */
export function normalizeLocale(raw: string): SupportedLocale | null {
  // Strip charset/encoding suffix, then strip country/region subtag
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\..*$/, "") // strip .UTF-8, .utf8, etc.
    .replace(/[-_].*$/, ""); // strip _BR, -PT, -Latn-BR, etc.

  if (cleaned === "pt" || cleaned === "es" || cleaned === "en") {
    return cleaned;
  }
  return null; // unsupported — caller falls through to next priority source
}

/**
 * Resolve the user's locale from environment variables, settings, and OS detection.
 *
 * Priority order:
 * 1. DEEPCODE_LOCALE env var
 * 2. settings.locale field (passed as argument)
 * 3. POSIX: LANG / LC_ALL env vars
 * 4. All platforms: Intl.DateTimeFormat
 * 5. Windows: PowerShell GetUserDefaultUILanguage
 * 6. Default: "en"
 */
export function resolveLocale(settingsLocale?: string | null): SupportedLocale {
  // Priority 1: DEEPCODE_LOCALE env var
  const envLocale = process.env.DEEPCODE_LOCALE;
  if (envLocale && envLocale.trim()) {
    const normalized = normalizeLocale(envLocale);
    if (normalized) return normalized;
  }

  // Priority 2: settings.json locale
  if (settingsLocale && settingsLocale.trim()) {
    const normalized = normalizeLocale(settingsLocale);
    if (normalized) return normalized;
  }

  // Priority 3: POSIX LANG / LC_ALL
  const lang = process.env.LANG || process.env.LC_ALL;
  if (lang) {
    const normalized = normalizeLocale(lang);
    if (normalized) return normalized;
  }

  // Priority 4: Intl.DateTimeFormat (all platforms)
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale) {
      const normalized = normalizeLocale(intlLocale);
      if (normalized) return normalized;
    }
  } catch {
    // Intl not available — fall through
  }

  // Priority 5: Windows detection via PowerShell
  if (process.platform === "win32") {
    try {
      const output = execSync(
        'powershell -NoProfile -Command "[System.Globalization.CultureInfo]::CurrentUICulture.Name"',
        { encoding: "utf8", timeout: 3000 }
      );
      if (output && output.trim()) {
        const normalized = normalizeLocale(output);
        if (normalized) return normalized;
      }
    } catch {
      // PowerShell unavailable — fall through
    }
  }

  // Default: English
  return "en";
}
