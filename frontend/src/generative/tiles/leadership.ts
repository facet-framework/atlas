import { tx } from "@/i18n";
/** The tile set for "Leadership" — grounded in `role.asks` ("Which feature
 * has the largest gap between its commitments and linked tests?") and `Leadership.tsx`'s
 * own rule: no vocabulary. That role's whole page manages without
 * "unbacked", "proves", "anchor" or "record" (`Leadership.tsx`'s own docstring)
 * — the instructions below carry the same restriction into what the model
 * is asked to write, not only what this file names its own variables. */

import { topByReach, worstGraded } from "../context";
import { errorTile, newestTile, techStackTile } from "../measured";
import { registerGenSet, type GenTile } from "../tiles";

registerGenSet("leadership", (v, nav): GenTile[] => {
  const backlog = worstGraded(v, 6);
  const core = topByReach(v, 6);
  return [
    {
      id: "status",
      kind: "generated",
      title: tx("ui.generative-tiles.leadership-how-product-doing"),
      ctx: core.map((f) => f.id),
      request: tx(
        "ui.generative-tiles.leadership-describe-three-sentences-without-technical-terms",
      ),
    },
    {
      id: "largest-backlog",
      kind: "generated",
      title: tx("ui.generative-tiles.leadership-where-largest-backlog"),
      ctx: backlog.length ? backlog.map((f) => f.id) : core.map((f) => f.id),
      request: tx("ui.generative-tiles.leadership-name-two-sentences-without-technical-terms"),
    },
    {
      id: "next-step",
      kind: "generated",
      title: tx("ui.generative-tiles.leadership-what-most-useful-next-step"),
      ctx: backlog.length ? backlog.map((f) => f.id) : core.map((f) => f.id),
      request: tx("ui.generative-tiles.leadership-say-two-sentences-without-technical-terms"),
    },
    errorTile(v, nav),
    newestTile(v, nav),
    techStackTile(v),
  ];
});
