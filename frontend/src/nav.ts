/** What every surface may trigger with a click. */

import { createContext, useContext } from "react";
import type { Depth, SheetKind } from "./state";

export type Nav = {
  /** Jump to a depth. Without `fid` the chosen feature stays put. */
  go: (depth: Depth, fid?: string | null, sid?: string | null) => void;
  /** Open a feature (depth 2). */
  open: (fid: string) => void;
  /** Open a scenario (depth 3). */
  openScenario: (fid: string, sid: string) => void;
  openSheet: (kind: SheetKind, arg?: string | null) => void;
  closeSheet: () => void;
  /** Open a plugin's area — by its name. */

  openArea: (area: string, arg?: string | null) => void;
  closeArea: () => void;
  /** Open the catalogue — with no content kind on its grid. */

  openCatalogue: (kind?: string | null, id?: string | null) => void;
  closeCatalogue: () => void;
  /** Open the settings — with no page specified on its first page. */

  openSet: (page?: string) => void;
  closeSet: () => void;
  openPalette: () => void;
  /** Ask Atlas a question — the surface at the bottom edge. */
  ask: (question: string) => void;
  /** Switch the role — rearranges the whole interface. */
  setRole: (role: string) => void;
};

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav outside NavContext — Atlas is not mounted.");
  return nav;
}
