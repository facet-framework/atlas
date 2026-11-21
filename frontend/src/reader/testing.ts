/** Real translators for specs: Atlas words from the shipped locale files and
 * facet-ui words from its shipped dictionaries, in either language. */

import i18n from "@/i18n";

import { de, en } from "@/chrome";
import { createText } from "@/screens/text";
import type { T } from "./text";

export type TestLanguage = "en" | "de";

/** The Atlas translate function in `language`, independent of the active language. */
export const atlasT = (language: TestLanguage): T => i18n.getFixedT(language) as unknown as T;

/** The words a surface shows in `language`: the Atlas pages' own (`ui.*` keys,
 * from the locale files, figures formatted as the pages format them) and
 * facet-ui's (read from its dictionaries). */

export function uiT(language: TestLanguage): T {
  const dictionary: Record<string, string> = language === "de" ? de : en;
  const pages = createText(language).t;
  return (key, params) =>
    key === "shell.top.proven"
      ? pages("ui.reader.testing-test-named", params)
      : key.startsWith("ui.")
        ? pages(key, params)
        : (dictionary[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
            String(params?.[name] ?? ""),
          );
}
