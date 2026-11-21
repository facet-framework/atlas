/** The generative section on the Overview: the tile set for the chosen
 * role, mounted below the key figures when the reader switched it on. */

import { useMemo } from "react";
import GenerativeSection from "@/generative/GenerativeSection";
import { NavContext, type Nav } from "@/nav";
import type { CoreRoleKey } from "@/roles";
import { readStored } from "@/state";
import type { PageContext } from "./context";
import { href } from "./route";
import { readShared } from "./shared-settings";

/** the reader's role key → its generative switch key. */
const CORE_ROLE_KEYS: Record<string, CoreRoleKey> = {
  leadership: "leadership",
  dev: "dev",
  review: "review",
  author: "author",
  owner: "owner",
  newcomer: "newcomer",
  agent: "agent",
};

export function coreRoleKey(role: string): CoreRoleKey | null {
  return CORE_ROLE_KEYS[role] ?? null;
}

/** The model the reader chose for generated tiles; `null` leaves the host's default. */
function storedModel(): string | null {
  const model = readStored().agent?.model;
  return typeof model === "string" && model ? model : null;
}

// @facet: assistance/briefings/generative-overview
// @facet-role: primary
/** The section for `ctx.role`, or `null` when its switch is off. */
export function OverviewGenerative({ ctx }: { ctx: PageContext }) {
  const key = coreRoleKey(ctx.role);
  const on = key != null && readShared().generativeOn.includes(key);
  const { go, ask, openPalette } = ctx;
  const nav = useMemo<Nav>(() => {
    const open = (fid: string) => go(href({ area: "record", id: fid }));
    const none = () => {};
    return {
      go: (_depth, fid) => (fid ? open(fid) : undefined),
      open,
      openScenario: (fid) => open(fid),
      openSheet: none,
      closeSheet: none,
      openArea: none,
      closeArea: none,
      openCatalogue: none,
      closeCatalogue: none,
      openSet: () => go(href({ area: "settings", section: "genui" })),
      closeSet: none,
      openPalette,
      ask: (q) => ask(q),
      setRole: none,
    };
  }, [go, ask, openPalette]);
  if (!on || !key) return null;
  return (
    <div className="reader-genui" data-testid="overview-generative" data-role={key}>
      <NavContext.Provider value={nav}>
        <GenerativeSection readerRole={key} v={ctx.derived} model={storedModel()} />
      </NavContext.Provider>
    </div>
  );
}
