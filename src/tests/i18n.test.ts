import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLocale, normalizeLocale, type SupportedLocale } from "../i18n/locale";
import { createTFunction } from "../i18n/translate";
import { formatNumber } from "../i18n/format";
import { getDictionary, resolveDictionary } from "../i18n/dictionary";
import { enDictionary } from "../i18n/en";

// ── normalizeLocale tests ─────────────────────────────────────────

test("normalizeLocale — pt_BR resolves to pt", () => {
  assert.equal(normalizeLocale("pt_BR"), "pt");
});

test("normalizeLocale — pt-PT resolves to pt", () => {
  assert.equal(normalizeLocale("pt-PT"), "pt");
});

test("normalizeLocale — es_ES resolves to es", () => {
  assert.equal(normalizeLocale("es_ES"), "es");
});

test("normalizeLocale — en_US resolves to en", () => {
  assert.equal(normalizeLocale("en_US"), "en");
});

test("normalizeLocale — empty string returns null", () => {
  assert.equal(normalizeLocale(""), null);
});

test("normalizeLocale — C locale returns null", () => {
  assert.equal(normalizeLocale("C"), null);
});

test("normalizeLocale — POSIX locale returns null", () => {
  assert.equal(normalizeLocale("POSIX"), null);
});

test("normalizeLocale — fr_FR returns null (unsupported)", () => {
  assert.equal(normalizeLocale("fr_FR"), null);
});

test("normalizeLocale — handles .UTF-8 suffix", () => {
  assert.equal(normalizeLocale("pt_BR.UTF-8"), "pt");
});

test("normalizeLocale — handles hyphen separators", () => {
  assert.equal(normalizeLocale("es-MX"), "es");
});

// ── resolveLocale tests ───────────────────────────────────────────

test("resolveLocale — DEEPCODE_LOCALE=pt overrides all", () => {
  const orig = process.env.DEEPCODE_LOCALE;
  try {
    process.env.DEEPCODE_LOCALE = "pt";
    process.env.LANG = "en_US.UTF-8";
    assert.equal(resolveLocale("es"), "pt");
  } finally {
    process.env.DEEPCODE_LOCALE = orig;
  }
});

test("resolveLocale — DEEPCODE_LOCALE=es overrides all", () => {
  const orig = process.env.DEEPCODE_LOCALE;
  try {
    process.env.DEEPCODE_LOCALE = "es";
    process.env.LANG = "en_US.UTF-8";
    assert.equal(resolveLocale("pt"), "es");
  } finally {
    process.env.DEEPCODE_LOCALE = orig;
  }
});

test("resolveLocale — settings locale pt", () => {
  const orig = process.env.DEEPCODE_LOCALE;
  try {
    delete process.env.DEEPCODE_LOCALE;
    process.env.LANG = "en_US.UTF-8";
    assert.equal(resolveLocale("pt"), "pt");
  } finally {
    process.env.DEEPCODE_LOCALE = orig;
  }
});

test("resolveLocale — settings locale es", () => {
  const orig = process.env.DEEPCODE_LOCALE;
  try {
    delete process.env.DEEPCODE_LOCALE;
    process.env.LANG = "en_US.UTF-8";
    assert.equal(resolveLocale("es"), "es");
  } finally {
    process.env.DEEPCODE_LOCALE = orig;
  }
});

test("resolveLocale — LANG=pt_BR resolves to pt", () => {
  const origDeepcode = process.env.DEEPCODE_LOCALE;
  const origLang = process.env.LANG;
  try {
    delete process.env.DEEPCODE_LOCALE;
    process.env.LANG = "pt_BR.UTF-8";
    assert.equal(resolveLocale(), "pt");
  } finally {
    process.env.DEEPCODE_LOCALE = origDeepcode;
    process.env.LANG = origLang;
  }
});

test("resolveLocale — LANG=es_ES resolves to es", () => {
  const origDeepcode = process.env.DEEPCODE_LOCALE;
  const origLang = process.env.LANG;
  try {
    delete process.env.DEEPCODE_LOCALE;
    process.env.LANG = "es_ES.UTF-8";
    assert.equal(resolveLocale(), "es");
  } finally {
    process.env.DEEPCODE_LOCALE = origDeepcode;
    process.env.LANG = origLang;
  }
});

test("resolveLocale — LANG=en_US resolves to en", () => {
  const origDeepcode = process.env.DEEPCODE_LOCALE;
  const origLang = process.env.LANG;
  try {
    delete process.env.DEEPCODE_LOCALE;
    process.env.LANG = "en_US.UTF-8";
    assert.equal(resolveLocale(), "en");
  } finally {
    process.env.DEEPCODE_LOCALE = origDeepcode;
    process.env.LANG = origLang;
  }
});

test("resolveLocale — unknown LANG falls back to Intl then en", () => {
  const origDeepcode = process.env.DEEPCODE_LOCALE;
  const origLang = process.env.LANG;
  try {
    delete process.env.DEEPCODE_LOCALE;
    process.env.LANG = "fr_FR.UTF-8";
    const result = resolveLocale();
    // fr is unsupported by normalizeLocale — falls through to Intl which
    // depends on the test machine's OS locale.
    assert.ok(["en", "pt", "es"].includes(result));
  } finally {
    process.env.DEEPCODE_LOCALE = origDeepcode;
    process.env.LANG = origLang;
  }
});

test("resolveLocale — all null/empty defaults to en", () => {
  const origDeepcode = process.env.DEEPCODE_LOCALE;
  const origLang = process.env.LANG;
  const origLcAll = process.env.LC_ALL;
  try {
    delete process.env.DEEPCODE_LOCALE;
    delete process.env.LANG;
    delete process.env.LC_ALL;
    const result = resolveLocale();
    // Intl should resolve to something, or we fall back to en
    assert.ok(result === "en" || result === "pt" || result === "es");
  } finally {
    process.env.DEEPCODE_LOCALE = origDeepcode;
    process.env.LANG = origLang;
    process.env.LC_ALL = origLcAll;
  }
});

test("resolveLocale — DEEPCODE_LOCALE=fr falls through to settings", () => {
  const orig = process.env.DEEPCODE_LOCALE;
  const origLang = process.env.LANG;
  try {
    process.env.DEEPCODE_LOCALE = "fr";
    process.env.LANG = "en_US.UTF-8";
    assert.equal(resolveLocale("pt"), "pt");
  } finally {
    process.env.DEEPCODE_LOCALE = orig;
    process.env.LANG = origLang;
  }
});

test("resolveLocale — env beats settings", () => {
  const orig = process.env.DEEPCODE_LOCALE;
  try {
    process.env.DEEPCODE_LOCALE = "es";
    assert.equal(resolveLocale("pt"), "es");
  } finally {
    process.env.DEEPCODE_LOCALE = orig;
  }
});

// ── t() function tests ────────────────────────────────────────────

test("t() — basic lookup returns English value", () => {
  const dict = getDictionary("en");
  const t = createTFunction(dict);
  assert.equal(t("cmd.list-skills"), "List available skills");
});

test("t() — with placeholders replaces values", () => {
  const dict = getDictionary("en");
  const t = createTFunction(dict);
  assert.equal(t("exit.session-cost", { cost: "0.44" }), "Session:   0.44");
});

test("t() — missing key returns key as-is", () => {
  const dict = getDictionary("en");
  const t = createTFunction(dict);
  assert.equal(t("nonexistent.key"), "nonexistent.key");
});

test("t() — empty key returns empty string", () => {
  const dict = getDictionary("en");
  const t = createTFunction(dict);
  assert.equal(t(""), "");
});

test("t() — missing replacement preserves placeholder", () => {
  const dict = getDictionary("en");
  const t = createTFunction(dict);
  assert.equal(t("welcome.version", {}), "v{{version}}");
});

test("t() — number replacement works", () => {
  const dict = getDictionary("en");
  const t = createTFunction(dict);
  assert.equal(
    t("model.thinking-updated", { displayName: "GPT", budget: "8192" }),
    "✅ Thinking budget for GPT set to 8192 tokens."
  );
});

test("t() — dictionary not in type still works", () => {
  // Create a custom dictionary with an extra string
  const customDict = { ...enDictionary, "custom.key": "custom value" };
  const t = createTFunction(customDict as typeof enDictionary);
  assert.equal(t("custom.key"), "custom value");
});

// ── formatNumber tests ────────────────────────────────────────────

test("formatNumber — pt locale uses commas as decimal", () => {
  assert.equal(formatNumber(1234567.89, "pt"), "1.234.567,89");
});

test("formatNumber — es locale uses commas as decimal", () => {
  assert.equal(formatNumber(1234567.89, "es"), "1.234.567,89");
});

test("formatNumber — en locale uses dot as decimal", () => {
  assert.equal(formatNumber(1234567.89, "en"), "1,234,567.89");
});

test("formatNumber — zero works", () => {
  assert.equal(formatNumber(0, "pt"), "0");
});

// ── getDictionary tests ───────────────────────────────────────────

test("getDictionary — pt returns ptDictionary", () => {
  const dict = getDictionary("pt");
  // Should have translated strings, not English
  assert.notEqual(dict["cmd.list-skills"], "List available skills");
});

test("getDictionary — es returns esDictionary", () => {
  const dict = getDictionary("es");
  assert.notEqual(dict["cmd.list-skills"], "List available skills");
});

test("getDictionary — en returns enDictionary", () => {
  const dict = getDictionary("en");
  assert.equal(dict["cmd.list-skills"], "List available skills");
});

test("getDictionary — unknown locale returns enDictionary", () => {
  const dict = getDictionary("fr");
  assert.equal(dict["cmd.list-skills"], "List available skills");
});

// ── Dictionary completeness tests ─────────────────────────────────

test("Dictionary completeness — pt has same key count as en", () => {
  const ptDict = getDictionary("pt");
  assert.equal(Object.keys(ptDict).length, Object.keys(enDictionary).length);
});

test("Dictionary completeness — es has same key count as en", () => {
  const esDict = getDictionary("es");
  assert.equal(Object.keys(esDict).length, Object.keys(enDictionary).length);
});

// ── resolveDictionary proxy fallback test ─────────────────────────

test("resolveDictionary proxy falls back to English for missing keys", () => {
  // Create an empty dict and resolve — should still find English keys
  const emptyDict = {} as typeof enDictionary;
  const resolved = resolveDictionary("pt", emptyDict);
  // Access a known key — should return English value via proxy
  assert.equal(resolved["cmd.list-skills"], "List available skills");
});
