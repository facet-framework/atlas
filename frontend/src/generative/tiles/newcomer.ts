import { tx } from "@/i18n";

import { topByReach, mostConnected, emptiestRecords } from "../context";
import { oldestTile, newestTile, techStackTile } from "../measured";
import { registerGenSet, type GenTile } from "../tiles";

registerGenSet("newcomer", (v, nav): GenTile[] => {
  const core = topByReach(v, 6);
  const nutzer = mostConnected(v, 6);
  const notable = [...emptiestRecords(v, v.M.length)].reverse().slice(0, 6);
  return [
    {
      id: "core",
      kind: "generated",
      title: tx("ui.generative-tiles.newcomer-what-core-features"),
      ctx: core.map((f) => f.id),
      request: tx("ui.generative-tiles.newcomer-name-three-sentences-what-project-does"),
    },
    {
      id: "users",
      kind: "generated",
      title: tx("ui.generative-tiles.newcomer-who"),
      ctx: nutzer.map((f) => f.id),
      request: tx("ui.generative-tiles.newcomer-name-user-groups-these-records-presuppose"),
    },
    {
      id: "distinctive",
      kind: "generated",
      title: tx("ui.generative-tiles.newcomer-what-makes-distinctive"),
      ctx: notable.map((f) => f.id),
      request: tx("ui.generative-tiles.newcomer-say-three-sentences-what-product-does"),
    },
    techStackTile(v),
    newestTile(v, nav),
    oldestTile(v, nav),
  ];
});
