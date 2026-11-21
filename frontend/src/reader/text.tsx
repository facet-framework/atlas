/** The language of the surface. */

import { useMemo, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { TextProvider } from "@/chrome";
import { facetLabels } from "@/i18n";

/** A language file's design-system labels, as facet-ui takes them. */
type Labels = ComponentProps<typeof TextProvider>["dictionary"];

export type T = (key: string, params?: Record<string, string | number>) => string;

export type ReaderLanguage = { t: T; language: string };

/** The Atlas translate function and the active language tag. */
export function useT(): ReaderLanguage {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  return useMemo(() => ({ t: ((key, params) => t(key, params)) as T, language }), [t, language]);
}

/** facet-ui in the Atlas language; wraps every surface, boot screen included.
 * A language added from a file brings the design system's labels with it. */

// @facet: customization/languages/language
// @facet-role: primary
export function ReaderText({ children }: { children: ReactNode }) {
  const { language, t } = useT();
  const dictionary = useMemo(
    () => ({
      "shell.top.proven": t("ui.reader.text-test-named"),
      ...facetLabels(language),
    }),
    [language, t],
  );
  return (
    <TextProvider locale={language} dictionary={dictionary as Labels}>
      {children}
    </TextProvider>
  );
}
