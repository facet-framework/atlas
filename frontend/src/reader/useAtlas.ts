/** The logic layer of the surface: where the reader is, where they were,
 * which palette they read in. Pages stay pure; they get what this returns. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addressUrl, parse, readAddress, ROOT, type Addressing, type Route } from "./route";
import * as V from "./history";
import { readPreferences, usePreferences } from "./preferences";
import { isPluginThemeId } from "@/plugin/themes";

export const THEME_KEY = "facet.atlas.theme";
/** Focus mode, on or off; stored on its own, so the palette key keeps its shape. */
export const FOCUS_KEY = "facet.atlas.focus";

/** The palette and its version. `system`: light and dark follow the operating
 * system; it holds while nobody chose a version, and a version chosen against
 * the system's ends it. The palette is FACET, Paper or a plugin's theme
 * (`<plugin>:<name>`); which one is drawn decides `drawnPalette`. */

export type ReaderTheme = { theme: string; mode: "dark" | "light"; system?: boolean };

/** The version the operating system asks for. */
function systemMode(): ReaderTheme["mode"] {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The palette and version this browser holds; without a stored choice the
 * palette follows the system's version. */

export function loadTheme(
  s: Pick<Storage, "getItem"> | undefined,
  prefersLight: boolean,
): ReaderTheme {
  try {
    const raw = s?.getItem(THEME_KEY);
    if (raw) {
      const t = JSON.parse(raw) as Partial<ReaderTheme>;
      if (
        (t.theme === "facet" ||
          t.theme === "paper" ||
          (typeof t.theme === "string" && isPluginThemeId(t.theme))) &&
        (t.mode === "dark" || t.mode === "light")
      ) {
        // A palette that follows the system takes the system's version now, not the stored one.
        return t.system === true
          ? { theme: t.theme, mode: prefersLight ? "light" : "dark", system: true }
          : { theme: t.theme, mode: t.mode };
      }
    }
  } catch {
    /** fall through to the default */
  }
  return { theme: "facet", mode: prefersLight ? "light" : "dark", system: true };
}

/** Focus mode as stored; anything but the stored "on" is off. */
export function loadFocus(s: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return s?.getItem(FOCUS_KEY) === "on";
  } catch {
    return false;
  }
}

/** Where a fresh start opens: the address as given, unless it is the bare
 * `/` and the reader keeps restoring the last place — then the place the
 * history's cursor stood on. A deep link always wins. */

export function startPath(address: string, restoreLast: boolean, history: V.History): string {
  const last = V.current(history)?.path;
  return address === ROOT && restoreLast && last && last !== ROOT && last.startsWith(ROOT)
    ? last
    : address;
}

// @facet: workspace/navigation/history
// @facet-role: primary
/** Follow the browser's address and keep `‹ ›` in step with it. */
export function useAtlas(
  placeOf: (route: Route, path: string) => V.Place,
  addressing: Addressing = "path",
) {
  const { historyLimit } = usePreferences();
  const [history, setHistory] = useState<V.History>(() => V.load(storage(), historyLimit));
  const [path, setPath] = useState(() => {
    const at = window.location;
    const address = readAddress(addressing, at);
    const start = startPath(address, readPreferences().restoreLast, V.load(storage()));
    if (addressing === "path") {
      if (start !== at.pathname) window.history.replaceState(null, "", start);
    } else if (start !== at.hash.replace(/^#/, ""))
      window.history.replaceState(null, "", addressUrl(addressing, start, at));
    return start;
  });
  const [theme, setThemeState] = useState<ReaderTheme>(() =>
    loadTheme(storage(), window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false),
  );
  const [focus, setFocusState] = useState(() => loadFocus(storage()));
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.("(max-width: 767px)").matches ?? false,
  );
  const route = useMemo(() => parse(path), [path]);
  // The namer may be a fresh function on every render; only the path decides
  // whether a visit happened, so it is read through a ref.
  const namer = useRef(placeOf);
  const limit = useRef(historyLimit);
  useEffect(() => {
    namer.current = placeOf;
    limit.current = historyLimit;
  });

  // The address `replace` put in place, so the visit below renames the
  // current place instead of recording a new one.
  const replaced = useRef<{ from: string; to: string } | null>(null);

  // Record the visit once the place is known. A browser back or forward that
  // lands on the neighbour of the cursor moves the cursor instead.
  useEffect(() => {
    // A child may canonicalize its address before this effect sees the old path.
    if (replaced.current !== null && replaced.current.to !== path) return;
    const place = namer.current(route, path);
    const renamed = replaced.current?.to === path ? replaced.current.from : null;
    replaced.current = null;
    setHistory((v) => {
      const prev = v.places[v.cursor - 1];
      const next = v.places[v.cursor + 1];
      const moved =
        renamed !== null && v.places[v.cursor]?.path === renamed
          ? V.replaceCurrent(v, place)
          : prev?.path === path
            ? V.back(v)
            : next?.path === path
              ? V.forward(v)
              : V.visitWithin(v, place, limit.current);
      V.save(storage(), moved);
      return moved;
    });
  }, [path, route]);

  // A lower limit cuts the stored history at once, not only at the next visit.
  const [cutAt, setCutAt] = useState(historyLimit);
  if (cutAt !== historyLimit) {
    setCutAt(historyLimit);
    const cut = V.trim(history, historyLimit);
    if (cut !== history) {
      V.save(storage(), cut);
      setHistory(cut);
    }
  }

  useEffect(() => {
    const onPop = () => {
      const at = window.location;
      setPath(readAddress(addressing, at));
    };
    window.addEventListener("popstate", onPop);
    const mq = window.matchMedia?.("(max-width: 767px)");
    const onMq = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq?.addEventListener?.("change", onMq);
    return () => {
      window.removeEventListener("popstate", onPop);
      mq?.removeEventListener?.("change", onMq);
    };
  }, [addressing]);

  const go = useCallback(
    (to: string) => {
      if (to === readAddress(addressing, window.location)) return;
      window.history.pushState(null, "", addressUrl(addressing, to, window.location));
      setPath(to);
      window.scrollTo?.({ top: 0 });
    },
    [addressing],
  );

  /** The same place under another address: the browser's entry and the
   * history's current place are renamed, nothing is added, and everything that
   * reads the address (breadcrumbs, the history list, the chat's context)
   * follows. The scroll position stays, because the reader did not move. */

  const replace = useCallback(
    (to: string) => {
      const from = readAddress(addressing, window.location);
      if (to === from) return;
      window.history.replaceState(
        window.history.state,
        "",
        addressUrl(addressing, to, window.location) +
          (addressing === "path" ? window.location.hash : ""),
      );
      replaced.current = { from, to };
      setPath(to);
    },
    [addressing],
  );

  // The cursor moves with the address, not one render later: a second step
  // right after the first (⌥← then ⌥→) must already see where the first went.
  const step = useCallback(
    (move: (v: V.History) => V.History, offset: number) => {
      const target = history.places[history.cursor + offset];
      if (!target) return;
      const moved = move(history);
      setHistory(moved);
      V.save(storage(), moved);
      go(target.path);
    },
    [go, history],
  );
  const back = useCallback(() => step(V.back, -1), [step]);
  const forward = useCallback(() => step(V.forward, 1), [step]);

  const jump = useCallback(
    (index: number) => {
      const target = history.places[index];
      if (!target) return;
      const jumped = V.jump(history, index);
      setHistory(jumped);
      V.save(storage(), jumped);
      window.history.pushState(null, "", addressUrl(addressing, target.path, window.location));
      setPath(target.path);
    },
    [addressing, history],
  );

  const clear = useCallback(() => {
    const only = V.current(history);
    const fresh = only ? V.visit(V.EMPTY, only) : V.EMPTY;
    setHistory(fresh);
    V.save(storage(), fresh);
  }, [history]);

  // @facet: customization/themes/theme-switch
  // @facet-role: primary
  const setTheme = useCallback((t: ReaderTheme) => {
    // Following holds only while the version is the system's: choosing the
    // other one is a choice against it and ends following.
    const next: ReaderTheme =
      t.system && t.mode === systemMode()
        ? { ...t, system: true }
        : {
            theme: t.theme,
            mode: t.mode,
          };
    setThemeState(next);
    try {
      storage()?.setItem(THEME_KEY, JSON.stringify(next));
    } catch {
      /** the choice holds for this visit only */
    }
  }, []);

  // While the palette follows the system, a change there changes the version here.
  const following = theme.system === true;
  useEffect(() => {
    if (!following) return;
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq?.addEventListener) return;
    const on = (e: MediaQueryListEvent) =>
      setThemeState((t) => (t.system ? { ...t, mode: e.matches ? "light" : "dark" } : t));
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [following]);

  const setFocus = useCallback((on: boolean) => {
    setFocusState(on);
    try {
      if (on) storage()?.setItem(FOCUS_KEY, "on");
      else storage()?.removeItem(FOCUS_KEY);
    } catch {
      /** the choice holds for this visit only */
    }
  }, []);

  return {
    route,
    path,
    history,
    theme,
    focus,
    mobile,
    go,
    replace,
    back,
    forward,
    jump,
    clear,
    setTheme,
    setFocus,
  };
}
