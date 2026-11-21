/** The companion's answer, read rather than typed out. */

import { useMemo, type ReactNode } from "react";
import { isSafeHref, parseMarkdown, type MdBlock, type MdInline } from "@/model";

/** The writing caret, for as long as the answer is still running. */
const CARET = <span className="caret" data-testid="answer-caret" />;

function Inline({ parts }: { parts: MdInline[] }) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.kind) {
          case "strong":
            return <strong key={i}>{part.text}</strong>;
          case "em":
            return <em key={i}>{part.text}</em>;
          case "code":
            return <code key={i}>{part.text}</code>;
          case "link":
            // A target nobody may visit becomes text with its address behind
            // it — the same rule as in the library: withholding it would be
            // worse than showing it.
            return isSafeHref(part.href) ? (
              <a key={i} href={part.href} target="_blank" rel="noreferrer noopener">
                {part.text}
              </a>
            ) : (
              <span key={i}>{`${part.text} (${part.href})`}</span>
            );
          default:
            return <span key={i}>{part.text}</span>;
        }
      })}
    </>
  );
}

function Block({ block, tail }: { block: MdBlock; tail?: ReactNode }) {
  switch (block.kind) {
    case "heading":
      // Two levels are enough: an answer in a conversation is not a document.
      return block.level <= 2 ? (
        <h3>
          <Inline parts={block.inline} />
          {tail}
        </h3>
      ) : (
        <h4>
          <Inline parts={block.inline} />
          {tail}
        </h4>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <Inline parts={item} />
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "code":
      return (
        <pre>
          {block.language ? <span className="lang">{block.language}</span> : null}
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote>
          <Inline parts={block.inline} />
          {tail}
        </blockquote>
      );
    case "rule":
      return <hr />;
    default:
      return (
        <p>
          <Inline parts={block.inline} />
          {tail}
        </p>
      );
  }
}

/** Blocks at whose end the caret can stand inside the sentence. */
function carriesTail(block: MdBlock): boolean {
  return block.kind === "paragraph" || block.kind === "heading" || block.kind === "quote";
}

// @facet: assistance/conversations/companion-answer
// @facet-role: primary
export default function Answer({ text, running }: { text: string; running: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  // The caret belongs at the end of what is written, not underneath it: it
  // marks the place the next letter appears. If the answer currently ends on a
  // list or a code block there is no such place inside a sentence, and then it
  // stands behind the block.
  const last = blocks.length - 1;
  const inSentence = running && last >= 0 && carriesTail(blocks[last]);

  return (
    <div className="answer">
      {blocks.map((block, i) => (
        <Block key={i} block={block} tail={inSentence && i === last ? CARET : undefined} />
      ))}
      {running && !inSentence ? CARET : null}
    </div>
  );
}
