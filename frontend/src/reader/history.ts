/** The history behind `‹ ›`: places of this browser, newest last, with a cursor. */

import type { T } from "./text";
import { DEFAULT_PREFERENCES } from "./preferences";

/** The limit until the reader sets another in the settings. */
export const HISTORY_LIMIT = DEFAULT_PREFERENCES.historyLimit;
export const HISTORY_KEY = "facet.atlas.history";

/** What the place menu shows as a place's kind; the visible word comes from Atlas. */
export type PlaceKind =
  "overviewPage" | "area" | "record" | "plugin" | "overview" | "content" | "settings";

/** A place whose name is a fixed word of the surface, not data. The word is
 * resolved when the list is drawn, so the list follows a language change and
 * the stored history carries no language. */

export type PlaceName =
  | { id: "overview" | "product" | "records" | "glossary" | "settings" | "ask" }
  | { id: "area" | "capability" | "contents"; arg?: string };

export type Place = {
  path: string;
  /** The name as it was worded at the visit; shown when `name` is absent. */
  label: string;
  name?: PlaceName;
  kind: PlaceKind;
  sub?: string;
  /** Epoch milliseconds of the visit. */
  at: number;
};

export type History = { places: Place[]; cursor: number };

export const EMPTY: History = { places: [], cursor: -1 };

export function canBack(v: History): boolean {
  return v.cursor > 0;
}

export function canForward(v: History): boolean {
  return v.cursor >= 0 && v.cursor < v.places.length - 1;
}

/** The history cut to `limit` places: the oldest go first, and the place under
 * the cursor always stays, so a short limit never moves the reader. */

export function trim(v: History, limit: number = HISTORY_LIMIT): History {
  const max = Math.max(1, Math.floor(limit));
  const overflow = v.places.length - max;
  if (overflow <= 0) return v;
  const start = Math.min(overflow, Math.max(0, v.cursor));
  return { places: v.places.slice(start, start + max), cursor: v.cursor - start };
}

/** Record a visit within the default limit; see `visitWithin`. */
export function visit(v: History, place: Place): History {
  return visitWithin(v, place, HISTORY_LIMIT);
}

/** Record a visit, keeping at most `limit` places. Revisiting the current place
 * only refreshes its label. */

export function visitWithin(v: History, place: Place, limit: number): History {
  const current = v.places[v.cursor];
  if (current && current.path === place.path) {
    const places = v.places.slice();
    places[v.cursor] = { ...place, at: current.at };
    return { places, cursor: v.cursor };
  }
  const kept = v.places.slice(0, v.cursor + 1);
  kept.push(place);
  return trim({ places: kept, cursor: kept.length - 1 }, limit);
}

/** The place under the cursor, renamed: the address changed without the
 * reader going anywhere (a plugin area naming its place by another of its
 * names). Nothing is added and nothing ahead of the cursor is dropped; the
 * visit keeps its time. An empty history gets the place as its first visit. */

export function replaceCurrent(v: History, place: Place): History {
  const current = v.places[v.cursor];
  if (!current) return visit(v, place);
  const places = v.places.slice();
  places[v.cursor] = { ...place, at: current.at };
  return { places, cursor: v.cursor };
}

export function back(v: History): History {
  return canBack(v) ? { ...v, cursor: v.cursor - 1 } : v;
}

export function forward(v: History): History {
  return canForward(v) ? { ...v, cursor: v.cursor + 1 } : v;
}

/** Jump to a place picked from the list, by its index. */
export function jump(v: History, index: number): History {
  return index >= 0 && index < v.places.length ? { ...v, cursor: index } : v;
}

export function current(v: History): Place | undefined {
  return v.places[v.cursor];
}

/** The words of the fixed place names, in the language of `t`. */
export function placeLabel(p: Place, t: T): string {
  const n = p.name;
  if (!n) return p.label;
  switch (n.id) {
    case "overview":
      return t("ui.reader.history-overview");
    case "product":
      return t("ui.reader.history-product");
    case "records":
      return t("ui.reader.history-records");
    case "glossary":
      return t("ui.reader.history-glossary");
    case "settings":
      return t("ui.reader.history-settings");
    case "ask":
      return t("ui.reader.history-ask-atlas");
    case "area":
      return t("ui.reader.history-area-name", { name: n.arg ?? "" });
    case "capability":
      return t("ui.reader.history-capability-name", { name: n.arg ?? "" });
    case "contents":
      return n.arg
        ? t("ui.reader.history-contents-kind", { kind: n.arg })
        : t("ui.reader.history-contents");
  }
  // Unknown name metadata falls back to the label recorded at the visit.
  return p.label;
}

/** The list as the place menu shows it: newest first, the current one marked. */
export function listing(v: History, t: T, now: number = Date.now()) {
  return v.places
    .map((p, i) => ({
      key: String(i),
      label: placeLabel(p, t),
      kind: p.kind,
      sub: p.sub,
      time: clock(p.at, now),
      current: i === v.cursor,
    }))
    .reverse();
}

function clock(at: number, now: number): string {
  const d = new Date(at);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

/** Storage --------------------------------------------------------------------- */

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isPlace(x: unknown): x is Place {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.path === "string" &&
    typeof p.label === "string" &&
    typeof p.kind === "string" &&
    typeof p.at === "number" &&
    (p.name === undefined || isPlaceName(p.name))
  );
}

/** A stored name is an object with a string `id` and, if present, a string `arg`. */
function isPlaceName(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const n = x as Record<string, unknown>;
  return typeof n.id === "string" && (n.arg === undefined || typeof n.arg === "string");
}

/** Read the stored history, at most `limit` places. Anything unreadable gives an empty one, never an error. */
export function load(storage: StorageLike | undefined, limit: number = HISTORY_LIMIT): History {
  try {
    const raw = storage?.getItem(HISTORY_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as { places?: unknown; cursor?: unknown };
    const places = Array.isArray(parsed.places) ? parsed.places.filter(isPlace) : [];
    if (!places.length) return EMPTY;
    const cursor =
      typeof parsed.cursor === "number"
        ? Math.min(Math.max(0, parsed.cursor), places.length - 1)
        : places.length - 1;
    return trim({ places, cursor }, limit);
  } catch {
    return EMPTY;
  }
}

/** Store the history. A full or blocked storage loses the history, not the page. */
export function save(storage: StorageLike | undefined, v: History): boolean {
  try {
    if (!v.places.length) storage?.removeItem(HISTORY_KEY);
    else storage?.setItem(HISTORY_KEY, JSON.stringify(v));
    return storage != null;
  } catch {
    return false;
  }
}
