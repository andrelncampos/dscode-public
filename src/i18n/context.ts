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
