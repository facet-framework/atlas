import { useMemo, type ReactNode } from "react";
import { TextProvider as Provider, useText as useDesignText } from "@facet-tools/ui";
import { en, type Dictionary } from "./en";
import { de } from "./de";
import { createText, type FacetText } from "./text";
export * from "./text";
export type TextProviderProps = {
  locale?: string;
  dictionary?: Partial<Dictionary>;
  children: ReactNode;
};
export function TextProvider({ locale = "en", dictionary, children }: TextProviderProps) {
  const labels = useMemo(
    () => ({ ...(locale.toLowerCase().split("-")[0] === "de" ? de : en), ...dictionary }),
    [locale, dictionary],
  );
  return (
    <Provider locale={locale} dictionary={labels}>
      {children}
    </Provider>
  );
}
export function useText(): FacetText {
  const shared = useDesignText() as FacetText;
  return useMemo(() => {
    const own = createText(shared.locale);
    return {
      ...own,
      t: (key, params) => {
        const value = shared.t(key, params);
        return value === key ? own.t(key, params) : value;
      },
      plural: (key, count, params) => {
        const value = shared.plural(key, count, params);
        return value === `${key}.one` || value === `${key}.other`
          ? own.plural(key, count, params)
          : value;
      },
    };
  }, [shared]);
}
