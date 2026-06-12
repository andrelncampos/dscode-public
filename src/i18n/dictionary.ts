import { enDictionary } from "./en";
import { ptDictionary } from "./pt";
import { esDictionary } from "./es";

export type I18nDictionary = {
  readonly [K in keyof typeof enDictionary]: string;
};
export type I18nKey = keyof I18nDictionary & string;

export { enDictionary, ptDictionary, esDictionary };

export function getDictionary(locale: string): I18nDictionary {
  switch (locale) {
    case "pt":
      return ptDictionary;
    case "es":
      return esDictionary;
    default:
      return enDictionary;
  }
}

export function resolveDictionary(_locale: string, dict: I18nDictionary): I18nDictionary {
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
