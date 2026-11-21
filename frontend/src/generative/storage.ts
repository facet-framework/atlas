/** Storage for generated tile texts — the same pattern as `ask/conversations.ts`,
 * kept separately instead of in `AtlasState`. */

import { useCallback, useState } from "react";

/** A remembered tile text, with its provenance. */
export type GenEntry = {
  text: string;
  /** How many records were in the context — counted from the context list, not estimated. */
  ctxN: number;
  /** How many records the registry holds in total, at the time of the run. */
  ofN: number;
  model: string;
  /** Timestamp of the run, in milliseconds. */
  at: number;
  /** Hash over the context records — the basis for the staleness check. */
  hash: string;
  /** UI language the text was generated in; a missing one counts as stale. */
  lang?: string;
  /** Error text of the last regeneration attempt, if one failed. */
  err?: string;
};

/** Tile texts, stored under the tile id. */
export type GenStorage = Record<string, GenEntry>;

export const GEN_STORAGE_KEY = "facet.atlas.generative";

/** How many entries are remembered in total — the most recent ones. */

export const MAX_GEN_ENTRIES = 60;

/** How many characters of a generated text are remembered. */
export const MAX_GEN_TEXT = 1200;

const text = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const numericValue = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function asEntry(v: unknown): GenEntry | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  // Without text and without a timestamp there is nothing to show and nothing
  // to go stale — an entry carrying neither is not a tile text.
  if (typeof e.text !== "string" || !e.text) return null;
  if (typeof e.at !== "number" || !Number.isFinite(e.at)) return null;
  if (typeof e.hash !== "string") return null;
  const truncated = e.text.length > MAX_GEN_TEXT ? e.text.slice(0, MAX_GEN_TEXT) : e.text;
  return {
    text: truncated,
    ctxN: numericValue(e.ctxN),
    ofN: numericValue(e.ofN),
    model: text(e.model),
    at: e.at,
    hash: e.hash,
    ...(typeof e.lang === "string" && e.lang ? { lang: e.lang } : {}),
    ...(typeof e.err === "string" && e.err ? { err: e.err } : {}),
  };
}

/** A stored value, brought into the shape of this build. */

export function parseGenStorage(value: unknown): GenStorage {
  if (!value || typeof value !== "object") return {};
  const out: GenStorage = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const e = asEntry(raw);
    if (e) out[key] = e;
  }
  return out;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readGenStorage(storage?: Pick<Storage, "getItem">): GenStorage {
  const store = storage ?? safeLocalStorage();
  if (!store) return {};
  try {
    return parseGenStorage(JSON.parse(store.getItem(GEN_STORAGE_KEY) || "{}"));
  } catch {
    return {};
  }
}

/** Caps the number of entries — the oldest are dropped first. */

export function capped(map: GenStorage, max: number = MAX_GEN_ENTRIES): GenStorage {
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, max));
}

export function writeGenStorage(map: GenStorage, storage?: Pick<Storage, "setItem">): boolean {
  const store = storage ?? safeLocalStorage();
  if (!store) return false;
  try {
    store.setItem(GEN_STORAGE_KEY, JSON.stringify(capped(map)));
    return true;
  } catch {
    // A private window, blocked cookies, an overflowing storage — the same
    // handling as in `state.ts`: the value still applies for this session, it
    // just does not survive a restart.
    return false;
  }
}

/** The tile text storage as a hook — reads once, writes on every change. */

export function useGenStorage(storage?: Pick<Storage, "getItem" | "setItem">) {
  const [map, setMap] = useState<GenStorage>(() => readGenStorage(storage));

  const apply = useCallback(
    (key: string, entry: GenEntry) => {
      setMap((prev) => {
        const next = capped({ ...prev, [key]: entry });
        writeGenStorage(next, storage);
        return next;
      });
    },
    [storage],
  );

  return [map, apply] as const;
}
