/**
 * The body of a page — markdown, drawn.
 *
 * The blocks arrive finished from `markdown.ts`; this component presents them
 * against the optional running corpus.
 *
 * **The `atlas:` reference** is resolved against the running corpus.
 * If it resolves it is a jump and carries what it resolved to — a record's
 * lifecycle mark, a promise's state of proof. If it does not resolve it is
 * **dead** and is drawn dead: title struck through, path in mono, the reason
 * as a quiet mono afterword, all of it inline.
 *
 * **The embedding** computes from the corpus. It stands in a figure of its own with its
 * provenance line — `Einbettung.tsx` draws it, including the three non-states.
 *
 * The corpus arrives as a property and not out of a context: this surface
 * draws prose and is meant to stay testable without Atlas around it. It may be
 * `null` when no corpus is available.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import { tx } from "../../../../frontend/src/i18n";
import Embed from "./Embed";
import type { WikiBlock, WikiInline } from "./markdown";
import Reference from "./Reference";
import type { Corpus } from "./citations";

export default function Body({
  blocks,
  category,
  k = null,
  onWiki,
}: {
  blocks: WikiBlock[];
  category?: string | null;
  /** The running corpus — `null` for as long as there is none. */
  k?: Corpus | null;
  /** Where a reference to another wiki page leads (see `Reference`). */
  onWiki?: (address: string) => void;
}) {
  return (
    <div className="t-d-md wiki-body" data-category={category ?? undefined}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} k={k} onWiki={onWiki} />
      ))}
    </div>
  );
}

function Block({
  block,
  k,
  onWiki,
}: {
  block: WikiBlock;
  k: Corpus | null;
  onWiki?: (address: string) => void;
}) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p className="t-d-md__p">
          <Line parts={block.inline} k={k} onWiki={onWiki} />
        </p>
      );
    case "heading": {
      const Tag = `h${Math.min(block.level, 6)}` as "h2";
      return (
        <Tag
          className="t-d-md__h"
          data-step={block.step !== null || undefined}
          data-testid={block.step !== null ? "wiki-step-heading" : undefined}
        >
          {block.step !== null ? (
            <span className="wiki-body__no t-mono">{block.step}</span>
          ) : null}
          <Line parts={block.inline} k={k} onWiki={onWiki} />
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="t-d-md__quote">
          <Line parts={block.inline} k={k} onWiki={onWiki} />
        </blockquote>
      );
    case "code":
      return (
        <pre className="wiki-body__code" data-testid="wiki-code-block">
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr />;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="t-d-md__list">
          {block.items.map((item, i) => (
            <li key={i}>
              <p className="t-d-md__p">
                <Line parts={item.inline} k={k} onWiki={onWiki} />
              </p>
              {item.blocks.map((inner, j) => (
                <Block key={j} block={inner} k={k} onWiki={onWiki} />
              ))}
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <table className="t-table t-table--dense">
          <thead>
            <tr>
              {block.head.map((cell, i) => (
                <th key={i}>
                  <Line parts={cell} k={k} onWiki={onWiki} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <Line parts={cell} k={k} onWiki={onWiki} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "embed":
      return k ? <Embed yaml={block.yaml} k={k} /> : null;
  }
}

function Line({
  parts,
  k,
  onWiki,
}: {
  parts: WikiInline[];
  k: Corpus | null;
  onWiki?: (address: string) => void;
}) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.kind) {
          case "strong":
            return <strong key={i}>{part.text}</strong>;
          case "em":
            return <em key={i}>{part.text}</em>;
          case "code":
            return (
              <code key={i} className="t-d-md__code">
                {part.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {part.text}
              </a>
            );
          case "atlas":
            // With a corpus somebody looks and the result is drawn; without
            // one the reference stands as unresolved. The two look
            // different because they say different things: "dead" means
            // somebody looked and found nothing, "unresolved" means
            // nobody looked.
            return k ? (
              <Reference
                key={i}
                text={part.text}
                target={part.target}
                k={k}
                onWiki={onWiki}
              />
            ) : (
              <span
                key={i}
                className="wiki-ref"
                data-pending="true"
                data-testid="wiki-ref-pending"
                title={tx(
                  "ui.wiki-src-wiki.body-atlas-target-not-resolved-over-any",
                  {
                    target: part.target,
                  },
                )}
              >
                {part.text}
                <code>{part.target}</code>
              </span>
            );
          case "unsafe":
            // The same thing `isSafeHref` does for the reader's answers: what
            // is not a known scheme does not become a click. In a file anybody
            // may write, that holds all the more.
            return (
              <span
                key={i}
                className="wiki-ref"
                data-dead="true"
                data-testid="wiki-unsafe-href"
                title={tx("ui.wiki-src-wiki.body-scheme-not-allowed")}
              >
                {part.text}
                <code>{part.href}</code>
                <em>{tx("ui.wiki-src-wiki.body-scheme-not-allowed")}</em>
              </span>
            );
          default:
            return <span key={i}>{part.text}</span>;
        }
      })}
    </>
  );
}
