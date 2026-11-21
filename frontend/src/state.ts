/** Persist reader preferences while discarding unknown settings. */

/** The state of the interface — the same fields the design keeps in `S`. */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AreaPlace } from "./plugin/areas";
import {
  forStorage,
  restoreConversations,
  newConversation,
  type Conversation,
} from "./ask/conversations";

export type AgentChoice = {
  /** The program, as it is invoked. */
  bin: string;
  /** The default model — changeable per question, this only holds the default. */
  model: string;
  cwd: string;

  autoScroll?: boolean;
};
export const DEFAULT_AGENT: AgentChoice = {
  bin: "claude",
  model: "sonnet",
  cwd: "",
};

export type Depth = 0 | 1 | 2;
export type AskSize = "min" | "normal" | "full";

/** The one filter list the ledger and the bench share. */

export type ScenFilter = "all" | "open" | "unbacked" | "proven" | "dev";
/** The audience being filtered by — the second row below the evidence bar. */

export type AudFilter = "all" | "product" | "engineering";
/** `term` opens one glossary entry, `glossary` the whole list. Both are
 * reference works like the other sheets — you open them beside what you are
 * reading instead of losing sight of it. */

export type SheetKind = "anchor" | "rules" | "rec" | "config" | "term" | "glossary";

/** Where in the catalogue the reader is — or `null` while the area is closed. */

export type CataloguePlace = {
  /** The open content kind (key from `CATALOGUE`), or `null` for the grid. */
  kind: string | null;
  /** The selected entry of the list on the left. */
  id: string | null;
  /** The filter in the header. */
  q: string;
  /** Whether below 820 px the list stands instead of the detail (button "‹ List"). */
  showlist: boolean;
  /** The collapsed groups of a grouped list (today: the glossary). */

  closed: string[];
};

/** Where in the settings the reader is — or `null` while they are closed. */

export type SetPlace = {
  /** The open page. There is no "no page selected" state. */

  page: string;
  /** The filter above the page list. */
  q: string;
};

export type AtlasState = {
  depth: Depth;
  fid: string | null;
  sid: string | null;
  raw: boolean;
  mfilter: ScenFilter;
  tfilter: ScenFilter;
  /** The audience — **one** for all surfaces, unlike the two evidence filters. */

  aud: AudFilter;
  role: string;
  size: AskSize;
  opencat: string[];
  openfeat: string[];
  sheet: [SheetKind, string | null] | null;
  /** Open plugin area and its opaque state; null when closed. The core must not
   * type plugin-owned fields, which would require core changes for plugin work.
   * Not persisted: a new reader session starts at Overview. */

  area: AreaPlace | null;
  /** The catalogue — `null` while it is closed. */

  catalogue: CataloguePlace | null;
  /** The settings — `null` while they are closed. */

  set: SetPlace | null;
  /** What the reader configured for the AI page — for this browser. */
  agent: AgentChoice;

  /** The ids of the plugins the reader switched off. */

  pluginsOff: string[];
  /** The keys of the core roles whose generative section is switched on. */

  generativeOn: string[];
  /** The conversations in the chat — they survive a restart. */

  conversations: Conversation[];
};

export const STORAGE_KEY = "facet.atlas.state";

export const initialState: AtlasState = {
  depth: 0,
  fid: null,
  sid: null,
  raw: false,
  mfilter: "open",
  tfilter: "open",
  // Unfiltered, and so with the unclassified rest in view: the surface does
  // not start by taking away part of the corpus.
  aud: "all",
  role: "dev",
  size: "normal",
  opencat: [],
  openfeat: [],
  sheet: null,
  area: null,
  catalogue: null,
  set: null,
  agent: DEFAULT_AGENT,
  pluginsOff: [],
  generativeOn: [],
  conversations: [newConversation(1)],
};

/** Only these fields survive a restart. */
const PERSISTED = [
  "raw",
  "mfilter",
  "tfilter",
  "aud",
  "size",
  "opencat",
  // A choice from the settings surface. The **place** there does not
  // survive (`set` is not in this list), the choice does.
  "agent",
  // A second choice from the settings surface, for the same reason: whoever
  // switched a plugin off did not mean "until the next reload".
  "pluginsOff",
  // A third: whoever switched a role's generative section on did not mean
  // "until the next reload" either.
  "generativeOn",
  // The only field that can grow. It stands **last** on purpose: the write
  // fallback below drops it first when the storage overflows, and the order
  // here says why.
  "conversations",
] as const;

/** What may be dropped when the storage overflows. */

const DISCARDABLE = "conversations" as const;

const FILTER_KEYS = ["mfilter", "tfilter"] as const;
const FILTERS: readonly ScenFilter[] = ["all", "open", "unbacked", "proven", "dev"];
const AUD_VALUES: readonly AudFilter[] = ["all", "product", "engineering"];

/** A valid remembered filter value. */

export function parseFilter(value: unknown): ScenFilter | undefined {
  return FILTERS.includes(value as ScenFilter) ? (value as ScenFilter) : undefined;
}

/** A remembered audience filter, or nothing. */

export function parseAudience(value: unknown): AudFilter | undefined {
  return AUD_VALUES.includes(value as AudFilter) ? (value as AudFilter) : undefined;
}

export function parseAgent(value: unknown): AgentChoice {
  if (!value || typeof value !== "object") return DEFAULT_AGENT;
  const v = value as Record<string, unknown>;
  const text = (k: keyof AgentChoice) =>
    typeof v[k] === "string" ? (v[k] as string) : (DEFAULT_AGENT[k] as string);
  return {
    bin: text("bin"),
    model: text("model"),
    cwd: text("cwd"),
  };
}

export function readStored(storage?: Pick<Storage, "getItem">): Partial<AtlasState> {
  const store = storage ?? safeLocalStorage();
  if (!store) return {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const source = parsed as Record<string, unknown>;
    const out: Partial<AtlasState> = {};
    for (const key of PERSISTED) {
      if (source[key] !== undefined) (out as Record<string, unknown>)[key] = source[key];
    }
    for (const key of FILTER_KEYS) {
      if (out[key] === undefined) continue;
      const filter = parseFilter(out[key]);
      if (filter === undefined) delete out[key];
      else out[key] = filter;
    }
    if (out.aud !== undefined) {
      const aud = parseAudience(out.aud);
      if (aud === undefined) delete out.aud;
      else out.aud = aud;
    }
    if (out.agent !== undefined) out.agent = parseAgent(out.agent);
    // Clear busy/running flags because no stream survives a reload.
    if (out.conversations !== undefined)
      out.conversations = restoreConversations(out.conversations);
    return out;
  } catch {
    // A browser without storage (private window, blocked cookies) must not
    // keep Atlas from opening.
    return {};
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Clears what this browser has remembered. */

export function resetBrowserState(storage?: Pick<Storage, "removeItem">): boolean {
  const store = storage ?? safeLocalStorage();
  if (!store) return false;
  try {
    store.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Writes the remembered state — and saves the rest when it does not fit. */

export function writeState(
  state: AtlasState,
  storage?: Pick<Storage, "setItem">,
): "complete" | "without-conversations" | "nothing" {
  const store = storage ?? safeLocalStorage();
  if (!store) return "nothing";
  const keep: Record<string, unknown> = {};
  for (const key of PERSISTED) {
    keep[key] = key === DISCARDABLE ? forStorage(state.conversations) : state[key];
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(keep));
    return "complete";
  } catch {
    // Retry without conversations after quota or storage-access errors.
  }
  try {
    delete keep[DISCARDABLE];
    store.setItem(STORAGE_KEY, JSON.stringify(keep));
    // The conversations are gone — role and filters are kept.
    return "without-conversations";
  } catch {
    // Then only for this session.
    return "nothing";
  }
}

export function useAtlasState(seed?: Partial<AtlasState>) {
  const [state, setState] = useState<AtlasState>(() => {
    const merged = { ...initialState, ...readStored(), ...seed };
    return {
      ...merged,
      conversations: merged.conversations.length ? merged.conversations : [newConversation(1)],
      // Not restorable, whatever was stored.
      depth: 0,
      fid: null,
      sid: null,
      sheet: null,
      area: null,
      set: null,
    };
  });

  /** What the storage accepted on the last write. */

  const [storageResult, setStorageResult] = useState<
    "complete" | "without-conversations" | "nothing"
  >("complete");

  /** Change a piece of state. */

  const patch = useCallback(
    (next: Partial<AtlasState> | ((prev: AtlasState) => Partial<AtlasState>)) => {
      setState((prev) => ({ ...prev, ...(typeof next === "function" ? next(prev) : next) }));
    },
    [],
  );

  useEffect(() => {
    const result = writeState(state);
    /** The rule warns about cascades: a `setState` in the body of an effect
     * renders again, and this effect runs on **every** change — so on every
     * text chunk the agent sends. */

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStorageResult((prev) => (prev === result ? prev : result));
  }, [state]);

  return [state, patch, storageResult] as const;
}

/** Paging. */

/** One page of a list. */

export type Paged<T> = { slice: T[]; page: number; pages: number; total: number; fill: number };

export function usePager() {
  const [pages, setPages] = useState<Record<string, number>>({});

  // `paged` is read while rendering and therefore depends on the state itself.
  // A ref written during render would be the wrong tool: it makes exactly the
  // update unreliable that it was meant for.

  const paged = useCallback(
    <T>(key: string, items: T[], per: number): Paged<T> => {
      const count = Math.max(1, Math.ceil(items.length / per));
      const page = Math.min(pages[key] ?? 0, count - 1);
      const slice = items.slice(page * per, (page + 1) * per);
      return {
        slice,
        page,
        pages: count,
        total: items.length,
        // From the shown length, not from the division remainder: the last
        // page is the only one that can be short, and it is short by exactly
        // what it shows less.
        fill: count > 1 ? per - slice.length : 0,
      };
    },
    [pages],
  );

  const goto = useCallback((key: string, page: number) => {
    setPages((prev) => ({ ...prev, [key]: Math.max(0, page) }));
  }, []);

  const reset = useCallback((key: string) => {
    setPages((prev) => (prev[key] ? { ...prev, [key]: 0 } : prev));
  }, []);

  return useMemo(() => ({ paged, goto, reset }), [paged, goto, reset]);
}

export type Pager = ReturnType<typeof usePager>;
