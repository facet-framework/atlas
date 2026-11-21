import type { Depth, SheetKind } from "../state";

/** The verbs the host offers a plugin. A subset of Nav, chosen deliberately. */
export type PluginVerbs = {
  /** Jump to a depth of the register. */
  go: (depth: Depth, fid?: string | null) => void;
  /** Open a feature. */
  open: (fid: string) => void;
  /** Open a scenario. */
  openScenario: (fid: string, sid: string) => void;
  /** Open a named area — the plugin's own, or one the core provides. */
  openArea: (area: string, arg?: string | null) => void;
  /** Close whatever area is open. */
  closeArea: () => void;
  /** Look a term up in the glossary. */

  openTerm: (term: string) => void;
  /** Open the catalogue, optionally on one kind and one entry. */

  openCatalogue: (kind?: string | null, id?: string | null) => void;
  /** Switch the reader's role. */

  setRole: (role: string) => void;
};

/** The verb names, as data. */

export const VERB_NAMES = [
  "go",
  "open",
  "openScenario",
  "openArea",
  "closeArea",
  "openTerm",
  "openCatalogue",
  "setRole",
] as const;

/** Verbs the core has and a plugin does not get, with the reason. */

export const WITHHELD_VERBS: Record<string, string> = {
  // The conversation with the companion is the reader's. A plugin that could
  // open it could also read what was asked — see the place context.
  openSheet: "the companion sheet carries the reader's own conversation",
  closeSheet: "same",
  // Settings are the host's surface. A plugin changing them would change
  // something the reader chose, without the reader asking.
  openSet: "the reader's choices are not a plugin's to move",
};

/** Builds the verb object handed to a plugin. */

// @facet: customization/contributions/plugin-verbs
// @facet-role: primary
export function narrowVerbs(nav: {
  go: (depth: Depth, fid?: string | null, sid?: string | null) => void;
  open: (fid: string) => void;
  openScenario: (fid: string, sid: string) => void;
  openArea: (area: string, arg?: string | null) => void;
  closeArea: () => void;
  openSheet: (kind: SheetKind, arg?: string | null) => void;
  openCatalogue: (kind?: string | null, id?: string | null) => void;
  setRole: (role: string) => void;
}): PluginVerbs {
  return {
    go: (depth, fid) => nav.go(depth, fid),
    open: (fid) => nav.open(fid),
    openScenario: (fid, sid) => nav.openScenario(fid, sid),
    // Narrowed, not forwarded. `openSheet` takes a kind, and one of its kinds
    // is the companion; handing the general verb over to show a glossary
    // entry would hand over that one too. The kind is fixed here, where the
    // host can see it, rather than trusted to the caller.
    openTerm: (term) => nav.openSheet("term", term),
    openCatalogue: (kind, id) => nav.openCatalogue(kind ?? null, id ?? null),
    setRole: (role) => nav.setRole(role),
    openArea: (area, arg) => nav.openArea(area, arg ?? null),
    closeArea: () => nav.closeArea(),
  };
}
