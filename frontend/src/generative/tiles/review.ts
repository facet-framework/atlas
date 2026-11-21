import { tx } from "@/i18n";
/** The tile set for "Test & Review" — grounded in `role.asks` ("Which
 * feature has the largest gap between its commitments and linked tests?",
 * "Which commitments have no linked tests?") and `Review.tsx`'s own `featState` grading. */

import { mostUnbacked, topByReach, worstGraded } from "../context";
import { proofGapTile, techStackTile, knowledgeGapTile } from "../measured";
import { registerGenSet, type GenTile } from "../tiles";

registerGenSet("review", (v, nav): GenTile[] => {
  const gaps = worstGraded(v, 6);
  const unproven = mostUnbacked(v, 6);
  const core = topByReach(v, 6);
  return [
    {
      id: "largest-gap",
      kind: "generated",
      title: tx("ui.generative-tiles.review-which-feature-has-largest-gap"),
      ctx: gaps.length ? gaps.map((f) => f.id) : core.map((f) => f.id),
      request: tx("ui.generative-tiles.review-name-two-sentences-which-records-have"),
    },
    {
      id: "what-to-check",
      kind: "generated",
      title: tx("ui.generative-tiles.review-which-commitment-needs-test-reference-next"),
      ctx: unproven.length ? unproven.map((f) => f.id) : core.map((f) => f.id),
      request: tx("ui.generative-tiles.review-name-two-sentences-which-acceptance-criteria"),
    },
    {
      id: "pattern",
      kind: "generated",
      title: tx("ui.generative-tiles.review-there-pattern-gaps"),
      ctx: (gaps.length || unproven.length ? [...gaps, ...unproven].slice(0, 6) : core).map(
        (f) => f.id,
      ),
      request: tx("ui.generative-tiles.review-say-two-sentences-whether-these-gaps"),
    },
    proofGapTile(v, nav),
    knowledgeGapTile(v, nav),
    techStackTile(v),
  ];
});
