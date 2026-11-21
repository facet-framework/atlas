/** The question Atlas AI receives when a reader answers an open knowledge
 * slot: the slot's own question, its name and the record, so the agent can
 * read the record and propose the answer. */

import { records } from "@/screens";
import type { FacetText } from "@/screens/text";
import { RECORD_SLOTS } from "./derive-reader";
import type { T } from "./text";

/** The prompt for `slot` (an index into `RECORD_SLOTS` or its key) of record `id`. */
export function knowledgePrompt(
  t: T,
  tt: FacetText["t"],
  id: string,
  slot: number | string,
): string {
  const key = typeof slot === "number" ? RECORD_SLOTS[slot] : slot;
  return t("ui.reader.knowledge-ask-propose-answer-question-slot-record-id", {
    question: tt(records.KNOWLEDGE_TEXT[key as records.KnowledgeKey].question),
    slot: tt(records.KNOWLEDGE_TEXT[key as records.KnowledgeKey].label),
    id,
  });
}
