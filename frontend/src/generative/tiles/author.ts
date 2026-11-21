import { tx } from "@/i18n";
/** The tile set for "Record author" — grounded in `role.asks` ("Which
 * features have empty knowledge sections?", "Where is operational
 * documentation missing?") and
 * `Author.tsx`'s own `filled()` sort (emptiest first). */

import { emptiestRecords, topByReach, withoutKnowledge, withoutObservation } from "../context";
import { observationGapTile, techStackTile, knowledgeGapTile } from "../measured";
import { registerGenSet, type GenTile } from "../tiles";

registerGenSet("author", (v, nav): GenTile[] => {
  const emptiest = emptiestRecords(v, 6);
  const knowledgeGaps = withoutKnowledge(v, 6);
  const observationGaps = withoutObservation(v, 6);
  const core = topByReach(v, 6);
  return [
    {
      id: "up-next",
      kind: "generated",
      title: tx("ui.generative-tiles.author-which-record-should-filled-next"),
      ctx: emptiest.length ? emptiest.map((f) => f.id) : core.map((f) => f.id),
      request: tx("ui.generative-tiles.author-name-two-sentences-which-records-have"),
    },
    {
      id: "knowledge-question",
      kind: "generated",
      title: tx("ui.generative-tiles.author-what-would-someone-ask-first"),
      ctx: knowledgeGaps.length ? knowledgeGaps.map((f) => f.id) : core.map((f) => f.id),
      request: tx("ui.generative-tiles.author-name-two-sentences-question-reader-these"),
    },
    {
      id: "operational-gap",
      kind: "generated",
      title: tx("ui.generative-tiles.author-what-operational-information-missing"),
      ctx: observationGaps.length ? observationGaps.map((f) => f.id) : core.map((f) => f.id),
      request: tx("ui.generative-tiles.author-name-two-sentences-what-operation-block"),
    },
    observationGapTile(v, nav),
    knowledgeGapTile(v, nav),
    techStackTile(v),
  ];
});
