/** The reader's labels: the two built-in languages, the ones somebody brings
 * themselves, and the one function that reads a label outside React. */

import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import { initialLanguage } from "./language";

const STORAGE_LANGUAGE = "facet-atlas-language";
const STORAGE_CUSTOM = "facet-atlas-languages";

export type Translation = typeof en;
export type CustomLanguageFile = {
  code: string;
  name: string;
  translation: Translation;
  /** The design system's own labels in this language, by facet-ui key. Optional:
   * a label it does not carry stays English. */

  facet?: Record<string, string>;
};

const builtins: Resource = { de: { translation: de }, en: { translation: en } };

function savedCustomLanguages(): CustomLanguageFile[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_CUSTOM) ?? "[]");
    return Array.isArray(value) ? value.filter(isCustomLanguageFile) : [];
  } catch {
    return [];
  }
}

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

export function isCustomLanguageFile(value: unknown): value is CustomLanguageFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<CustomLanguageFile>;
  return (
    typeof file.code === "string" &&
    /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(file.code) &&
    typeof file.name === "string" &&
    file.name.length > 0 &&
    JSON.stringify(keys(file.translation).sort()) === JSON.stringify(keys(en).sort()) &&
    (file.facet === undefined || isLabelMap(file.facet))
  );
}

/** A flat map of label key to label text; anything else is not one. */
function isLabelMap(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/** The design system's labels a language file brought for `code`; none for a built-in language. */
export function facetLabels(code: string): Record<string, string> | undefined {
  return savedCustomLanguages().find((l) => l.code === code)?.facet;
}

for (const language of savedCustomLanguages()) {
  builtins[language.code] = { translation: language.translation };
}

function browserLanguage(): string {
  let saved: string | null = null;
  try {
    if (typeof window !== "undefined") saved = localStorage.getItem(STORAGE_LANGUAGE);
  } catch {
    // Browsing with storage disabled must still allow language selection.
  }
  return initialLanguage(
    saved,
    typeof navigator === "undefined" ? [] : navigator.languages,
    Object.keys(builtins),
  );
}

void i18n.use(initReactI18next).init({
  pluralSeparator: "-",
  resources: builtins,
  lng: browserLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

if (typeof window !== "undefined") {
  document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language;
  i18n.on("languageChanged", (language) => {
    try {
      localStorage.setItem(STORAGE_LANGUAGE, language);
    } catch {
      // The active language remains usable without persistent browser storage.
    }
    document.documentElement.lang = language;
  });
}

export function customLanguages(): CustomLanguageFile[] {
  return savedCustomLanguages();
}

export async function addCustomLanguage(value: unknown): Promise<void> {
  const language = value;
  if (!isCustomLanguageFile(language)) throw new Error("Invalid Atlas language file");
  const languages = savedCustomLanguages().filter(({ code }) => code !== language.code);
  languages.push(language);
  localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(languages));
  i18n.addResourceBundle(language.code, "translation", language.translation, true, true);
  await i18n.changeLanguage(language.code);
}

/** Read a translated label from render helpers which cannot use React hooks. */

export function tx(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}

export default i18n;
