import { createText as translate, type TextParams } from "@facet-tools/ui";
import { en, type Dictionary, type TextKey } from "./en";
import { de } from "./de";
export type { TextParams } from "@facet-tools/ui";
export type FacetLocale = "en" | "de";
export type PluralKey = {
  [K in TextKey]: K extends `${infer B}.other` ? (`${B}.one` extends TextKey ? B : never) : never;
}[TextKey];
export type FacetText = {
  locale: string;
  t: (key: TextKey, params?: TextParams) => string;
  plural: (key: PluralKey, count: number, params?: TextParams) => string;
  number: (n: number) => string;
};
export function createText(locale: string, overrides?: Partial<Dictionary>): FacetText {
  return translate(locale, {
    ...(locale.toLowerCase().split("-")[0] === "de" ? de : en),
    ...overrides,
  }) as FacetText;
}
export const ENGLISH_TEXT = createText("en");
