import { tx } from "../i18n";
/** Prose in which declared terms point to their definition, and the author's
 * markup is read rather than typed out again. */

import { isSafeHref, linkTerms, parseInline, type MdInline } from "@/model";
import type { DerivedGlossary } from "../derive";
import { useNav } from "../nav";
import { isSearchable } from "./parts";

/** A piece of running text with its terms in it. */

function Terms({ text, glossary }: { text: string; glossary: DerivedGlossary | null }) {
  const nav = useNav();

  if (!glossary || !text) return <>{text}</>;

  const parts = linkTerms(text, glossary.index);
  // Nothing found means: touch nothing. Otherwise the same sentence would end
  // up in two different node trees depending on whether it was found.
  if (!parts.some((part) => part.kind === "term")) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) =>
        part.kind === "term" ? (
          <button
            key={i}
            type="button"
            className="term"
            data-testid="prose-term"
            title={tx("ui.term.prose-look-up-term-first-value", { v0: part.term })}
            onClick={() => nav.openSheet("term", part.term)}
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

/** A span, drawn — and inside it the terms, provided a search happens there. */

function Stueck({ part, glossary }: { part: MdInline; glossary: DerivedGlossary | null }) {
  const content = isSearchable(part) ? <Terms text={part.text} glossary={glossary} /> : part.text;

  switch (part.kind) {
    case "code":
      // This is an identifier, not part of a sentence. A term in backticks is
      // the name in code; linking it would mean asserting a meaning that
      // nobody intended at this spot.
      return <code>{content}</code>;
    case "strong":
      return <strong>{content}</strong>;
    case "em":
      return <em>{content}</em>;
    case "link":
      // What may not be visited becomes text with its address behind it —
      // the same rule as in the library: staying silent would be worse than
      // showing it.
      return isSafeHref(part.href) ? (
        <a href={part.href} target="_blank" rel="noreferrer noopener">
          {content}
        </a>
      ) : (
        <span>{`${part.text} (${part.href})`}</span>
      );
    default:
      return <>{content}</>;
  }
}

export default function Prose({
  text,
  glossary,
}: {
  text: string;
  glossary: DerivedGlossary | null;
}) {
  const parts = parseInline(text);

  // A sentence with no markup takes the same path as before this change. This
  // is not a shortcut — both paths would produce the same tree today — but
  // the assurance that it still does even once something changes later on the
  // path for marked-up sentences.
  if (parts.length === 1 && parts[0].kind === "text" && parts[0].text === text)
    return <Terms text={text} glossary={glossary} />;

  return (
    <>
      {parts.map((part, i) => (
        <Stueck key={i} part={part} glossary={glossary} />
      ))}
    </>
  );
}
