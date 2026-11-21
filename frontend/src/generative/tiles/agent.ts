import { tx } from "@/i18n";
/** The tile set for "Agent" — grounded in `role.asks` ("Which anchors have no
 * record?", "How are the records connected?"). */

import { mostAnchored, topByReach } from "../context";
import { densestAnchorTile, techStackTile, orphanedAnchorTile } from "../measured";
import { registerGenSet, type GenTile } from "../tiles";

registerGenSet("agent", (v, nav): GenTile[] => {
  const dense = mostAnchored(v, 6);
  const core = topByReach(v, 6);
  return [
    {
      id: "connections",
      kind: "generated",
      title: tx("ui.generative-tiles.agent-how-these-records-connected"),
      ctx: core.map((f) => f.id),
      request: tx("ui.generative-tiles.agent-name-two-sentences-how-these-records"),
    },
    {
      id: "most-anchored",
      kind: "generated",
      title: tx("ui.generative-tiles.agent-which-records-have-most-anchors"),
      ctx: dense.map((f) => f.id),
      request: tx("ui.generative-tiles.agent-name-two-sentences-what-these-records"),
    },
    {
      id: "entry-point",
      kind: "generated",
      title: tx("ui.generative-tiles.agent-where-would-agent-start-reading"),
      ctx: core.map((f) => f.id),
      request: tx("ui.generative-tiles.agent-name-two-sentences-which-record-gives"),
    },
    orphanedAnchorTile(v),
    densestAnchorTile(v, nav),
    techStackTile(v),
  ];
});
