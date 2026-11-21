import { tx } from "@/i18n";
/** The tile set for "Developer" — three generated questions grounded in
 * `Dev.tsx`'s own vocabulary and `role.asks`, three measured facts. */

import { drifted, mostUnbacked, topByReach } from "../context";
import { driftTile, newestTile, techStackTile } from "../measured";
import { registerGenSet, type GenTile } from "../tiles";

registerGenSet("dev", (v, nav): GenTile[] => {
  const drift = drifted(v, 6);
  const unproven = mostUnbacked(v, 6);
  const core = topByReach(v, 6);
  return [
    {
      id: "drift-reason",
      kind: "generated",
      title: tx("ui.generative-tiles.dev-why-does-drift-matter"),
      ctx: drift.length ? drift.map((f) => f.id) : core.map((f) => f.id),
      request: tx("ui.generative-tiles.dev-name-two-sentences-what-risky-about"),
    },
    {
      id: "next-action",
      kind: "generated",
      title: tx("ui.generative-tiles.dev-where-should-next-test-go"),
      ctx: unproven.length ? unproven.map((f) => f.id) : core.map((f) => f.id),
      request: tx("ui.generative-tiles.dev-name-records-most-acceptance-criteria-without"),
    },
    {
      id: "risk",
      kind: "generated",
      title: tx("ui.generative-tiles.dev-what-depends-most-code"),
      ctx: core.map((f) => f.id),
      request: tx("ui.generative-tiles.dev-say-two-sentences-which-records-serve"),
    },
    techStackTile(v),
    driftTile(v, nav),
    newestTile(v, nav),
  ];
});
