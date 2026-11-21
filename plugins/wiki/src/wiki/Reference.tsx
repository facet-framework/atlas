/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

import { useVerbs } from "../verbs";
import { resolveRef, type Corpus, type RefTarget } from "./citations";

export default function Reference({
  text,
  target,
  k,
  onWiki,
}: {
  /** What the author wrote — never replaced, not even on a match. */
  text: string;
  /** The part after `atlas:`. */
  target: string;
  k: Corpus;
  /**
   * Where a reference to another wiki page leads.
   *
   * Its own handle and not `verbs.openArea("wiki", …)`: inside the area the
   * jump is a change of place on the same surface, and sending it through
   * opening the area would reset filter and rail. Without the handle, the
   * reference takes the general route.
   */
  onWiki?: (address: string) => void;
}) {
  const verbs = useVerbs();
  const r = resolveRef(target, k);

  if (r.dead) {
    return (
      <span
        className="wiki-ref"
        data-dead="true"
        data-testid="wiki-dead-ref"
        title={r.why}
      >
        <s>{text}</s>
        <code>{r.target}</code>
        <em>{r.why}</em>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="wiki-ref"
      data-testid="wiki-ref"
      title={r.note ?? undefined}
      onClick={() => jump(r.jump)}
    >
      {text}
      {r.mark?.as === "tag" ? (
        <span
          className="wiki-ref__mark"
          data-kind={r.mark.kind}
          data-testid="wiki-ref-mark"
        >
          {r.mark.label}
        </span>
      ) : null}
      {r.mark?.as === "dot" ? (
        // The dot carries the proof colour; the word stands in the title, so
        // the information also reaches where colour alone does not carry.
        <span
          className="wiki-ref__dot"
          data-kind={r.mark.kind}
          data-testid="wiki-ref-dot"
          title={r.mark.label}
          aria-label={r.mark.label}
        />
      ) : null}
    </button>
  );

  function jump(to: RefTarget): void {
    switch (to.to) {
      case "record":
        return verbs.open(to.id);
      case "promise":
        return verbs.openScenario(to.id, to.sid);
      case "catalogue":
        return verbs.openCatalogue(to.kind, to.id);
      case "term":
        return verbs.openTerm(to.term);
      case "role":
        return verbs.setRole(to.key);
      case "wiki":
        return onWiki ? onWiki(to.address) : verbs.openArea("wiki", to.address);
    }
  }
}
