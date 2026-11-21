/** The colour scheme — a choice the reader made, or none. */

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** `null` does not mean "light" but "nobody has chosen". */
export type ThemeChoice = Theme | null;

/** As much window as the colour scheme needs. */

export type ThemeView = Pick<Window, "matchMedia">;

/** The media query through which the system reports its preference. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The attribute the stylesheet hangs on. */

export const THEME_ATTR = "data-t-mode";

/** What applies: the choice if there is one, otherwise the system's preference. */

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice) return choice;
  return systemPrefersDark ? "dark" : "light";
}

/** What the system says right now. */

export function systemPrefersDark(view: ThemeView | undefined = globalThis.window) {
  if (!view || typeof view.matchMedia !== "function") return false;
  return view.matchMedia(DARK_QUERY).matches;
}

/** Writes the scheme onto the root, where the stylesheet reads it. */
export function applyTheme(
  theme: Theme,
  root: Element | null = globalThis.document?.documentElement,
) {
  root?.setAttribute(THEME_ATTR, theme);
}

/** Listens while nobody has chosen. */

export function watchSystemTheme(
  onChange: (prefersDark: boolean) => void,
  view: ThemeView | undefined = globalThis.window,
): () => void {
  if (!view || typeof view.matchMedia !== "function") return () => {};
  const query = view.matchMedia(DARK_QUERY);
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  // `addListener` is the older spelling; up to version 14 Safari knew only it.
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }
  query.addListener(handler);
  return () => query.removeListener(handler);
}

/** The scheme that applies right now — and it is on the root as well. */

export function useTheme(
  choice: ThemeChoice,
  view: ThemeView | undefined = globalThis.window,
): Theme {
  const [prefersDark, setPrefersDark] = useState(() => systemPrefersDark(view));
  useEffect(() => watchSystemTheme(setPrefersDark, view), [view]);

  const theme = resolveTheme(choice, prefersDark);
  useEffect(() => applyTheme(theme), [theme]);

  return theme;
}
