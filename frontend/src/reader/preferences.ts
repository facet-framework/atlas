/** The reader's own choices in Atlas that act outside the settings page:
 * density and motion of the shell, whether a fresh start returns to the last
 * place, whether chat sessions outlive the page, whether the chat follows a
 * growing answer, how many places the history keeps, and how tall the product
 * city stands and when it names its areas and buildings. Stored per browser
 * under one key; a stored value this version does not know falls back to its
 * default, field by field. */

import { useSyncExternalStore } from "react";
import { STOREY_LENSES, type StoreyLens } from "@/screens/frame/storeyLens";

export const PREFERENCES_KEY = "facet.atlas.preferences";

/** The history keeps at least one place (the one the reader is on) and at most this many. */
export const HISTORY_LIMIT_MIN = 1;
export const HISTORY_LIMIT_MAX = 1000;

/** Least heights the product city may be given, in pixels; `null` leaves it to the window. */
export const CITY_HEIGHTS = [480, 640, 800, 960, 1200] as const;
export type CityHeight = (typeof CITY_HEIGHTS)[number];

/** How the product city draws its names: a tag hanging from the foundation, a
 * pin standing on the roof, or map lettering without a box. */
export const CITY_LABELS = ["tag", "pin", "map"] as const;
export type CityLabels = (typeof CITY_LABELS)[number];

export type Preferences = {
  density: "compact" | "normal" | "spacious";
  /** `system` follows `prefers-reduced-motion`; `reduced` holds whatever the system says. */
  motion: "system" | "reduced";
  /** A start on the bare `/` address opens the place the reader was on last. */
  restoreLast: boolean;
  /** Off: chat sessions are not stored and end with the page. */
  keepChat: boolean;
  /** How many places `‹ ›` keeps. */
  historyLimit: number;
  /** On: the chat follows the end of a growing answer instead of pinning the question to the top. */
  followAnswer: boolean;
  /** The product city's least height; `null` follows the window. */
  cityHeight: CityHeight | null;
  /** `hover`: the city names only the place under the pointer and the chosen one. */
  cityNames: "always" | "hover";
  /** How the city draws its names. */
  cityLabels: CityLabels;
  storeyLens: StoreyLens;
};

export const DEFAULT_PREFERENCES: Preferences = {
  density: "normal",
  motion: "system",
  restoreLast: true,
  keepChat: true,
  historyLimit: 200,
  followAnswer: false,
  cityHeight: null,
  cityNames: "always",
  cityLabels: "tag",
  storeyLens: "tests",
};

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The limit as a whole number in range, or `null` for anything else (text, 0, 1.5, 5000). */
export function parseHistoryLimit(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : v;
  return typeof n === "number" &&
    Number.isInteger(n) &&
    n >= HISTORY_LIMIT_MIN &&
    n <= HISTORY_LIMIT_MAX
    ? n
    : null;
}

/** The stored choices; each field that is missing or not understood is its default. */
export function readPreferences(s: Pick<Storage, "getItem"> | undefined = storage()): Preferences {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(s?.getItem(PREFERENCES_KEY) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      raw = parsed as Record<string, unknown>;
  } catch {
    /** every field keeps its default */
  }
  const d = DEFAULT_PREFERENCES;
  return {
    density:
      raw.density === "compact" || raw.density === "normal" || raw.density === "spacious"
        ? raw.density
        : d.density,
    motion: raw.motion === "reduced" || raw.motion === "system" ? raw.motion : d.motion,
    restoreLast: typeof raw.restoreLast === "boolean" ? raw.restoreLast : d.restoreLast,
    keepChat: typeof raw.keepChat === "boolean" ? raw.keepChat : d.keepChat,
    historyLimit: parseHistoryLimit(raw.historyLimit) ?? d.historyLimit,
    followAnswer: typeof raw.followAnswer === "boolean" ? raw.followAnswer : d.followAnswer,
    cityHeight:
      raw.cityHeight === null
        ? null
        : (CITY_HEIGHTS.find((h) => h === raw.cityHeight) ?? d.cityHeight),
    cityNames:
      raw.cityNames === "hover" || raw.cityNames === "always" ? raw.cityNames : d.cityNames,
    cityLabels: CITY_LABELS.find((l) => l === raw.cityLabels) ?? d.cityLabels,
    storeyLens: STOREY_LENSES.find((lens) => lens === raw.storeyLens) ?? d.storeyLens,
  };
}

const listeners = new Set<() => void>();
/** The last read, so `useSyncExternalStore` sees one object until something changed. */
let cached: { text: string | null; value: Preferences } | null = null;

function snapshot(): Preferences {
  let text: string | null = null;
  try {
    text = storage()?.getItem(PREFERENCES_KEY) ?? null;
  } catch {
    text = null;
  }
  if (!cached || cached.text !== text) cached = { text, value: readPreferences() };
  return cached.value;
}

/** Store `patch` over the current choices. `false` when the browser refuses:
 * the choice then does not hold, and the caller leaves its control as it was. */

export function writePreferences(patch: Partial<Preferences>): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(PREFERENCES_KEY, JSON.stringify({ ...readPreferences(s), ...patch }));
  } catch {
    return false;
  }
  listeners.forEach((fn) => fn());
  return true;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/** The reader's choices, kept current across the settings page, the shell and other tabs. */
export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_PREFERENCES);
}

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribeMotion(fn: () => void) {
  const mq = window.matchMedia?.(REDUCE);
  mq?.addEventListener?.("change", fn);
  return () => mq?.removeEventListener?.("change", fn);
}

/** Whether the system asks for reduced motion, kept current when it changes. */
export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia?.(REDUCE).matches ?? false,
    () => false,
  );
}

/** Motion is reduced when the reader chose it or the system asks for it. */
export function useReducedMotion(): boolean {
  const { motion } = usePreferences();
  const system = useSystemReducedMotion();
  return motion === "reduced" || system;
}
