import { tx } from "@/i18n";
import { short, type DerivedFeature, type DerivedModel } from "../derive";
import type { ConversationStep as Step } from "./conversations";

/** A path that was read becomes a jump target when it can be matched to a
 * Record unambiguously — via the Record file itself or via an anchored
 * file. If it stays ambiguous, no button is created: a jump that lands
 * somewhere else is worse than text with no jump at all. */

export function citesFor(
  v: DerivedModel,
  steps: Step[],
): {
  label: string;
  fid: string;
}[] {
  const out = new Map<string, string>();
  const only = (hits: DerivedFeature[]): DerivedFeature | null =>
    hits.length === 1 ? hits[0] : null;
  for (const step of steps) {
    const target = step.target;
    if (!target) continue;
    const hit =
      only(v.M.filter((f) => f.rec.path && target.includes(f.rec.path))) ??
      only(v.M.filter((f) => target.includes(f.id))) ??
      only(v.M.filter((f) => f.anchors.some((a) => target.includes(a.path))));
    if (hit) out.set(hit.id, short(hit.id));
  }
  return [...out.entries()].map(([fid, label]) => ({ fid, label }));
}

/** An answer, as it remains readable outside this surface. */

export function answerMarkdown(turn: {
  q: string;
  answer: string;
  cites: {
    label: string;
    fid: string;
  }[];
}): string {
  // No empty heading: a list with no entries would look like a section
  // someone forgot to fill in. If Atlas found nothing, the surface says
  // so — and the copy stays silent about it instead of claiming otherwise.
  const cites = turn.cites.length
    ? `\n\n**${tx("ui.ask.cites-jump-targets")}**\n${turn.cites.map((c) => `- ${c.fid}`).join("\n")}`
    : "";
  return `> ${turn.q}\n\n${turn.answer}${cites}`;
}
