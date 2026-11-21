/** A record's prose on the record page: the author's inline markup (code,
 * bold, italic, links) and the project's glossary terms in the same sentence. */

import type { ReactNode } from "react";
import { isSafeHref, linkTerms, parseInline, type MdInline } from "@/model";

/** The glossary's terms in search order and what a chosen term opens. */
export type ProseTerms = {
  index: string[];
  onTerm: (term: string) => void;
  title: (term: string) => string;
};

function Terms({ text, terms }: { text: string; terms: ProseTerms | null }) {
  if (!terms || !text) return <>{text}</>;
  const parts = linkTerms(text, terms.index);
  if (!parts.some((p) => p.kind === "term")) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.kind === "term" ? (
          <button
            key={i}
            type="button"
            className="t-term"
            data-testid="prose-term"
            title={terms.title(part.term)}
            onClick={(e) => {
              // A term inside a clickable row opens its lookup, not the row.
              e.stopPropagation();
              terms.onTerm(part.term);
            }}
          >
            {part.text}
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Piece({ part, terms }: { part: MdInline; terms: ProseTerms | null }) {
  switch (part.kind) {
    case "code":
      return <code className="t-mono">{part.text}</code>;
    case "strong":
      return (
        <strong>
          <Terms text={part.text} terms={terms} />
        </strong>
      );
    case "em":
      return (
        <em>
          <Terms text={part.text} terms={terms} />
        </em>
      );
    case "link":
      return isSafeHref(part.href) ? (
        <a href={part.href} target="_blank" rel="noreferrer noopener">
          {part.text}
        </a>
      ) : (
        <span>{`${part.text} (${part.href})`}</span>
      );
    default:
      return <Terms text={part.text} terms={terms} />;
  }
}

// @facet: workspace/controls/prose-markup
// @facet-role: primary
export function Prose({ text, terms }: { text: string; terms: ProseTerms | null }) {
  const parts = parseInline(text);
  if (parts.length === 1 && parts[0].kind === "text" && parts[0].text === text)
    return <Terms text={text} terms={terms} />;
  return (
    <>
      {parts.map((part, i) => (
        <Piece key={i} part={part} terms={terms} />
      ))}
    </>
  );
}

/** A render function for the record page's `renderProse`. */
export function proseRenderer(terms: ProseTerms | null): (text: string) => ReactNode {
  return function renderProse(text) {
    return <Prose text={text} terms={terms} />;
  };
}
