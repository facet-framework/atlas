/** What every page gets from the container: the model, its derived views,
 * navigation, and a slot of container state per page. */

import type { AtlasModel } from "@/model";
import type { DerivedModel } from "@/derive";
import type { DomainView, FeatureView, OverviewExtras, RecordRow } from "./derive-reader";
import type { ReaderTheme } from "./useAtlas";
import type { T } from "./text";
import type { ReaderPlugins } from "./plugin-host";
import type { TestReportReader } from "./test-report";

export type Slot = <T extends object>(key: string, init: T) => [T, (patch: Partial<T>) => void];

export type PageContext = {
  model: AtlasModel;
  derived: DerivedModel;
  features: FeatureView[];
  domains: DomainView[];
  rows: RecordRow[];
  role: string;
  /** Atlas words in the active language; changes identity with the language. */
  t: T;
  /** The active language tag (`en`, `de`, …), for dates and numbers. */
  language: string;
  go: (path: string) => void;
  /** The same place under another address: no new history entry, the address readers follow. */
  replace?: (path: string) => void;
  back: () => void;
  mobile: boolean;
  slot: Slot;
  /** The breadcrumb sibling list of this place: which segment is open and what
   * its search field holds. It belongs to the place in the history, so going
   * back finds it as it was and a fresh visit finds it closed. */

  crumb: CrumbState & {
    toggle: (key: string) => void;
    setQuery: (query: string) => void;
    close: () => void;
  };
  overview: OverviewExtras;
  theme: ReaderTheme;
  setTheme: (t: ReaderTheme) => void;
  /** Focus mode: stored in this browser, applied to the whole shell. */
  focus: boolean;
  setFocus: (on: boolean) => void;
  /** Open the chat with a question (sent at once) or just with context. */
  ask: (question?: string) => void;
  openPalette: () => void;
  copy: (text: string) => void;
  /** Content kinds pinned to the menu, in pin order. */
  pinned: readonly string[];
  /** Pin (`true`) or unpin a content kind; the choice is stored per browser. */
  pin: (kind: string, on: boolean) => void;
  /** Where the reviewer's bench reads the judged test report; `null`/absent asks nothing. */
  readTestReport?: TestReportReader | null;
  /** The session's plugin host and what its surfaces read; absent in page tests. */
  plugins?: ReaderPlugins;
  /** Read the repository again, keeping the place; absent where nothing can. */
  reread?: () => void;
};

/** The open sibling list of a place's path and its search text. The container
 * keeps one per path: a fresh visit forgets the target's, the history finds it. */

export type CrumbState = { open: string | null; query: string };
export const CRUMB_CLOSED: CrumbState = { open: null, query: "" };

/** A slot over a plain state object; the container passes `setState`. */
export function makeSlot(
  state: Record<string, object>,
  setState: (fn: (prev: Record<string, object>) => Record<string, object>) => void,
): Slot {
  return <T extends object>(key: string, init: T) => {
    const value = { ...init, ...(state[key] as Partial<T> | undefined) } as T;
    const set = (patch: Partial<T>) =>
      setState((prev) => ({ ...prev, [key]: { ...init, ...(prev[key] as T), ...patch } }));
    return [value, set];
  };
}
