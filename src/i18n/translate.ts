import type { I18nDictionary } from "./dictionary";

export type I18nReplacements = Record<string, string | number>;

export type I18nTFunction = {
  (key: string, replacements?: I18nReplacements): string;
};

export function createTFunction(dictionary: I18nDictionary): I18nTFunction {
  return (key: string, replacements?: I18nReplacements): string => {
    // Handle null/undefined/empty key
    if (!key) return "";

    const template = (dictionary as Record<string, string>)[key];
    if (!template) {
      return key;
    }
    if (!replacements || Object.keys(replacements).length === 0) {
      return template;
    }
    return template.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => {
      const value = replacements[name];
      return value !== undefined ? String(value) : `{{${name}}}`;
    });
  };
}
