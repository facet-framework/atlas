/** `render` in a named language for the page specs: the Atlas texts from a copy
 * of the Atlas i18next instance in that language, and the design system's own
 * labels from facet-ui's dictionary for it. The copy leaves the language of
 * every other spec alone. English is the default; German is asked for where a
 * spec proves the German rendering still holds. */

import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { TextProvider } from "@/chrome";
import i18n from "@/i18n";

const german = i18n.cloneInstance({ lng: "de" });
const english = i18n.cloneInstance({ lng: "en" });

function German({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={german}>
      <TextProvider locale="de">{children}</TextProvider>
    </I18nextProvider>
  );
}

function English({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={english}>
      <TextProvider locale="en">{children}</TextProvider>
    </I18nextProvider>
  );
}

/** `render` inside the German providers. `rerender` keeps the wrapper. */
export function renderInGerman(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  return render(ui, { ...options, wrapper: German });
}

/** `render` inside the English providers: the default the page specs render in.
 * The language is asked for explicitly rather than inherited from the browser
 * the specs pin (jest.setup.ts), so a page spec says which language it reads. */

export function renderInEnglish(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  return render(ui, { ...options, wrapper: English });
}
