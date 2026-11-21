import { tx } from "@/i18n";
/** The tile set for "Ownership" — grounded in `role.asks` ("Which team
 * owns the most features?", "What depends on what?") and `Owner.tsx`'s own
 * team columns and "most connected" panel. */

import { largestTeam, mostConnected, topByReach } from "../context";
import { newestTile, teamsTile, techStackTile } from "../measured";
import { registerGenSet, type GenTile } from "../tiles";

registerGenSet("owner", (v, nav): GenTile[] => {
  const core = topByReach(v, 6);
  const connected = mostConnected(v, 6);
  const team = largestTeam(v, 6);
  return [
    {
      id: "team-responsibility",
      kind: "generated",
      title: tx("ui.generative-tiles.owner-what-does-team-own"),
      ctx: team ? team.features.map((f) => f.id) : core.map((f) => f.id),
      request: tx("ui.generative-tiles.owner-name-two-sentences-what-these-records"),
    },
    {
      id: "dependencies",
      kind: "generated",
      title: tx("ui.generative-tiles.owner-what-depends-most-what"),
      ctx: connected.map((f) => f.id),
      request: tx("ui.generative-tiles.owner-name-two-sentences-which-these-records"),
    },
    {
      id: "reach",
      kind: "generated",
      title: tx("ui.generative-tiles.owner-what-has-greatest-reach"),
      ctx: core.map((f) => f.id),
      request: tx("ui.generative-tiles.owner-say-two-sentences-which-records-serve"),
    },
    teamsTile(v),
    newestTile(v, nav),
    techStackTile(v),
  ];
});
