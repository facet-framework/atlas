/** The colour scheme — what is checked is the behaviour, not the palette. */

import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DARK_QUERY,
  THEME_ATTR,
  applyTheme,
  resolveTheme,
  systemPrefersDark,
  useTheme,
  watchSystemTheme,
  type ThemeView,
} from "./theme";

/** An operating system to switch. */

function fakeSystem(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = prefersDark;
  const list = {
    get matches() {
      return matches;
    },
    media: DARK_QUERY,
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => {
      listeners.add(fn);
    },
    removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => {
      listeners.delete(fn);
    },
  };
  const view: ThemeView = {
    matchMedia: (query: string) =>
      (query === DARK_QUERY ? list : { matches: false }) as MediaQueryList,
  };
  return {
    view,
    listenerCount: () => listeners.size,
    /** The reader switches their system. */
    switchTo(dark: boolean) {
      matches = dark;
      for (const fn of [...listeners]) fn({ matches: dark } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  document.documentElement.removeAttribute(THEME_ATTR);
  window.localStorage.clear();
});

describe("resolveTheme — the choice beats the system, but only when there is one", () => {
  it("takes the choice, even against the system's preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("takes the system's preference without a choice", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });
});

describe("systemPrefersDark — what the system says, and what holds when it is silent", () => {
  it("reports what the media query reports", () => {
    expect(systemPrefersDark(fakeSystem(true).view)).toBe(true);
    expect(systemPrefersDark(fakeSystem(false).view)).toBe(false);
  });

  it("assumes light where there is no matchMedia", () => {
    // Server rendering and older test environments. Not a measurement, but
    // the same assumption the browser makes without information.
    expect(systemPrefersDark(undefined)).toBe(false);
    expect(systemPrefersDark({} as unknown as ThemeView)).toBe(false);
  });
});

describe("watchSystemTheme — listening and stopping again", () => {
  it("reports every switch of the system", () => {
    const system = fakeSystem(false);
    const seen: boolean[] = [];
    watchSystemTheme((dark) => seen.push(dark), system.view);

    system.switchTo(true);
    system.switchTo(false);

    expect(seen).toEqual([true, false]);
  });

  it("unhooks itself again", () => {
    const system = fakeSystem(false);
    const stop = watchSystemTheme(() => {}, system.view);
    expect(system.listenerCount()).toBe(1);

    stop();

    expect(system.listenerCount()).toBe(0);
  });

  it("copes with the older spelling too", () => {
    // Up to version 14, Safari only knew `addListener`. A reader on an older
    // device should still be able to follow their system.
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const legacy = {
      matchMedia: () =>
        ({
          matches: false,
          addListener: (fn: (event: MediaQueryListEvent) => void) => listeners.add(fn),
          removeListener: (fn: (event: MediaQueryListEvent) => void) => listeners.delete(fn),
        }) as unknown as MediaQueryList,
    };
    const seen: boolean[] = [];

    const stop = watchSystemTheme((dark) => seen.push(dark), legacy);
    for (const fn of [...listeners]) fn({ matches: true } as MediaQueryListEvent);
    expect(seen).toEqual([true]);

    stop();

    expect(listeners.size).toBe(0);
  });

  it("stays silent where there is no matchMedia", () => {
    expect(() => watchSystemTheme(() => {}, undefined)()).not.toThrow();
  });
});

describe("applyTheme — the stylesheet reads along at the root", () => {
  it("writes the scheme onto the element the rules hang on", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("dark");

    applyTheme("light");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("light");
  });
});

describe("useTheme — what holds also stands at the root", () => {
  it("follows the system's preference without a choice", () => {
    const system = fakeSystem(true);
    const { result } = renderHook(() => useTheme(null, system.view));

    expect(result.current).toBe("dark");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("dark");
  });

  it("without a choice also follows a later switch of the system", () => {
    // The point of the whole file: "no choice" is a state that stays.
    // Whoever writes the measured system preference away as a choice at
    // start stops following here — and that is exactly what the draft does.
    const system = fakeSystem(false);
    const { result } = renderHook(() => useTheme(null, system.view));
    expect(result.current).toBe("light");

    act(() => system.switchTo(true));

    expect(result.current).toBe("dark");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("dark");
  });

  it("leaves the choice standing when the system changes", () => {
    const system = fakeSystem(false);
    const { result } = renderHook(() => useTheme("light", system.view));

    act(() => system.switchTo(true));

    expect(result.current).toBe("light");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("light");
  });

  it("unhooks itself again on cleanup", () => {
    const system = fakeSystem(false);
    const { unmount } = renderHook(() => useTheme(null, system.view));
    expect(system.listenerCount()).toBe(1);

    unmount();

    expect(system.listenerCount()).toBe(0);
  });
});

describe("The script in the page head — so that nothing wrong flashes up", () => {
  const html = readFileSync(join(__dirname, "./standalone/index.html"), "utf8");
  const head = html.slice(0, html.indexOf("</head>"));

  it("stands in the head and runs without deferral", () => {
    // A `defer` or module script would only run once the browser has already
    // painted the light surface. That very flash is the reason for the
    // script, so it must not be deferred.
    const tag = head.match(/<script[^>]*theme-init\.js[^>]*>/);
    expect(tag).not.toBeNull();
    expect(tag?.[0]).not.toMatch(/\b(defer|async|type\s*=\s*["']module["'])/);
  });
});
