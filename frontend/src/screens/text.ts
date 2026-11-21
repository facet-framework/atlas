/** Atlas page text uses ui.screens-* keys and the reader's active language.
 * t fills {{name}} parameters and formats numbers; plural uses Intl.PluralRules;
 * number formats a figure. Preformat numeric parameters because i18next alone
 * interpolates 1234 without the locale's grouping separators. */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  useText as useDesignText,
  type PluralKey as DesignPluralKey,
  type TextKey as DesignKey,
} from "@/chrome";
import i18n from "@/i18n";

/** A key of the Atlas locale files. */
export type TextKey = string;
/** The key of a text that has a `-one` and an `-other` form, without the suffix. */
export type PluralKey = string;
/** Values for `{{name}}` placeholders. Numbers are formatted for the active language. */
export type TextParams = Readonly<Record<string, string | number>>;

export type FacetText = {
  /** The active language tag, e.g. "en" or "de". */
  locale: string;
  /** The text for `key` with its parameters filled in. */
  t: (key: TextKey, params?: TextParams) => string;
  /** The `-one` or `-other` form of `key` for `count`; `{{count}}` is available as a parameter. */
  plural: (key: PluralKey, count: number, params?: TextParams) => string;
  /** A number formatted for the active language. */
  number: (n: number) => string;
};

type Lookup = (key: string, params: Record<string, string>) => string;

function build(locale: string, lookup: Lookup): FacetText {
  const nf = new Intl.NumberFormat(locale);
  const rules = new Intl.PluralRules(locale);
  const number = (n: number) => nf.format(n);
  const strings = (params?: TextParams) => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(params ?? {}))
      out[name] = typeof value === "number" ? number(value) : value;
    return out;
  };
  const t = (key: TextKey, params?: TextParams) => {
    const count = params?.count;
    const resolved =
      params && Object.hasOwn(params, "count") && !/-(?:one|other)$/.test(key)
        ? `${key}-${typeof count === "number" && rules.select(count) === "one" ? "one" : "other"}`
        : key;
    return lookup(resolved, strings(params));
  };
  const plural = (key: PluralKey, count: number, params?: TextParams) => {
    const form = rules.select(count) === "one" ? "one" : "other";
    return t(`${key}-${form}`, { count, ...params });
  };
  return { locale, t, plural, number };
}

/** The page text in `locale` outside React, for data that is built once. */
export function createText(locale: string): FacetText {
  const fixed = i18n.getFixedT(locale);
  return build(locale, (key, params) => fixed(key, params));
}

/** The page text in the active Atlas language; renders again when it changes. */
export function useText(): FacetText {
  const { t, i18n: active } = useTranslation();
  const locale = active.resolvedLanguage ?? active.language;
  return useMemo(() => build(locale, (key, params) => t(key, params)), [t, locale]);
}

/** The words of a reader surface that names the design system's own labels
 * (facet-ui keys such as `shell.nav.item.overview`) beside page texts: a `ui.*`
 * key reads the Atlas locale files, any other key facet-ui's dictionary. */

export function useSurfaceText(): FacetText {
  const page = useText();
  const design = useDesignText();
  return useMemo(() => {
    const own = (key: string) => key.startsWith("ui.");
    return {
      locale: page.locale,
      number: page.number,
      t: (key, params) => (own(key) ? page.t(key, params) : design.t(key as DesignKey, params)),
      plural: (key, count, params) =>
        own(key)
          ? page.plural(key, count, params)
          : design.plural(key as DesignPluralKey, count, params),
    };
  }, [page, design]);
}
