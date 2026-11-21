/**
 * The wiki's front page — generated, and it says so.
 *
 * A wiki
 * has a natural reading order, and a wall of tiles does not represent it.
 * Instead the areas as sections with their `purpose`, the pages as numbered
 * rows with category and status.
 *
 * **It declares itself generated.** For as long as no human has written an
 * `index.md`, this page is a fabrication and not a statement — and an
 * overview that passes itself off as a written page would let the reader
 * believe somebody wanted this order.
 *
 * **The list is the report.** The maintenance signals stand at the bottom,
 * and they stand as a list and not as a number: "3 pages without a category"
 * is a number nobody can do anything with; three rows with three titles are
 * three things somebody can do.
 *
 * **It counts the references** — and it says how many it looked at. The
 * number carries its denominator: "2 of 14 lead nowhere" says something,
 * "2 dead references" does not say whether fourteen were checked or a
 * thousand.
 *
 * An unresolvable record id in the front matter stands on its own and not
 * among the dead references: the specification makes it an **error**, while a dead
 * reference is a warning. Thrown together, the report would lose exactly the
 * difference it exists for.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

import { useMemo } from "react";
import { tx } from "../../../../frontend/src/i18n";
import { monoText } from "./mono";
import { parsePage } from "./markdown";
import type { WikiModel, WikiPage } from "../model/model";
import Status from "./Status";
import { pageRefs, type Corpus, type WikiRef } from "./citations";
import "../wiki.css";

/** A finding about a page — row by row, never as a sum. */
type Finding = { p: WikiPage; text: string; ref: WikiRef & { dead: true } };

export default function Front({
  w,
  onOpen,
  k = null,
}: {
  w: WikiModel;
  onOpen: (address: string) => void;
  /** The running corpus — `null` for as long as there is none. */
  k?: Corpus | null;
}) {
  const filled = w.areas.filter((a) => a.state !== "empty").length;

  /*
   * Read every page once and resolve its references. Over *all* pages and not
   * over the first: a count that stops after the first find reports too
   * little — and a measured number that is too small is worse than none at
   * all, because nothing about it shows that it is incomplete.
   */
  const report = useMemo(() => {
    if (!k) return null;
    let seen = 0;
    const dead: Finding[] = [];
    const unknownRecords: { p: WikiPage; id: string }[] = [];
    const unread: { p: WikiPage; target: string; why: string }[] = [];
    for (const p of w.pages) {
      const refs = pageRefs(parsePage(p.body, p.front.category), p.records, k);
      seen += refs.all.length;
      for (const entry of refs.dead) {
        if (entry.ref.dead) dead.push({ p, text: entry.text, ref: entry.ref });
      }
      for (const id of refs.unknownRecords) unknownRecords.push({ p, id });
      for (const entry of refs.unread)
        unread.push({ p, target: entry.target, why: entry.why });
    }
    return { seen, dead, unknownRecords, unread };
  }, [k, w.pages]);

  /*
   * When the report stands there at all.
   *
   * When there is something to report — and also as soon as **references have
   * been looked at**. The second case is the more important and the less
   * obvious one: a wiki whose references all resolve differs from one whose
   * references nobody has checked only by the sentence that says so. Without
   * it, "checked, all in order" and "never looked" would look the same — and
   * that is exactly the confusion this surface exists against.
   *
   * A wiki with no references and no finding gets no section: nothing was
   * checked there because there was nothing to check.
   */
  const hasReport =
    w.uncategorised.length > 0 ||
    w.undeclaredCategories.length > 0 ||
    w.unexplained.length > 0 ||
    Boolean(
      report &&
      (report.dead.length ||
        report.unknownRecords.length ||
        report.seen ||
        report.unread.length),
    );

  return (
    <article className="wiki-front" data-testid="wiki-front">
      <p className="t-label">{tx("ui.wiki-src-wiki.front-wiki")}</p>
      <p className="wiki-front__sentence" style={{ marginTop: 8 }}>
        <b>
          {tx("ui.wiki-src-wiki.front-count-pages", { count: w.pages.length })}
        </b>{" "}
        {tx("ui.wiki-src-wiki.front-count-areas-written-people-ai-what", {
          count: filled,
        })}
      </p>
      <p className="t-meta">
        {monoText(
          "ui.wiki-src-wiki.front-overview-generated-there-no-file",
          { file: "index.md" },
          ["file"],
        )}
      </p>

      {w.areas.map((area) => {
        const rows = w.inArea(area.id);
        return (
          <section
            key={area.id}
            className="wiki-front__sec"
            data-state={area.state}
          >
            <div className="wiki-front__head">
              <p className="t-label">
                {area.title ?? (
                  <>
                    <span className="t-mono">{area.id}</span> ·{" "}
                    {tx("ui.wiki-src-wiki.front-not-declared")}
                  </>
                )}
              </p>
              <span className="t-meta t-mono">
                {rows.length
                  ? tx("ui.wiki-src-wiki.front-count-pages", {
                      count: rows.length,
                    })
                  : tx("ui.wiki-src-wiki.front-declared-no-page-yet")}
              </span>
            </div>
            {area.purpose ? (
              <p className="wiki-front__purpose">{area.purpose}</p>
            ) : null}
            {area.domain ? (
              <p className="t-meta">
                {monoText(
                  "ui.wiki-src-wiki.front-area-also-taxonomy-domain-domain",
                  { domain: area.domain },
                  ["domain"],
                )}
              </p>
            ) : null}
            {rows.length ? (
              <div className="wiki-front__list">
                {rows.map((p) => (
                  <Row key={p.address} p={p} w={w} onOpen={onOpen} />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}

      {hasReport ? (
        <section
          className="wiki-front__sec"
          aria-label={tx("ui.wiki-src-wiki.front-maintenance-signals")}
        >
          <div className="wiki-front__head">
            <p className="t-label">
              {tx("ui.wiki-src-wiki.front-maintenance-signals")}
            </p>
            <span className="t-meta t-mono">facet wiki check</span>
          </div>
          <div className="wiki-kv">
            {/*
             * The errors first: a record id no registry holds a record for is
             * an error under the specification — the same treatment as an orphaned anchor,
             * for the same reason. Everything below it warns.
             */}
            {(report?.unknownRecords ?? []).map(({ p, id }) => (
              <div key={`rec-${p.address}-${id}`}>
                <span>
                  <span className="wiki-kv__t">
                    <button
                      type="button"
                      className="t-d-linkbtn"
                      onClick={() => onOpen(p.address)}
                    >
                      {p.title}
                    </button>
                  </span>
                  <span className="wiki-kv__d">
                    <code>records: {id}</code> —{" "}
                    {tx("ui.wiki-src-wiki.front-no-record-registry")}
                  </span>
                </span>
                <span
                  className="wiki-kv__r t-bad"
                  data-testid="wiki-report-verdict"
                >
                  {tx("ui.wiki-src-wiki.front-error")}
                </span>
              </div>
            ))}
            {(report?.dead ?? []).map(({ p, text, ref }, i) => (
              <div key={`ref-${p.address}-${ref.target}-${i}`}>
                <span>
                  <span className="wiki-kv__t">
                    <button
                      type="button"
                      className="t-d-linkbtn"
                      onClick={() => onOpen(p.address)}
                    >
                      {p.title}
                    </button>
                  </span>
                  <span className="wiki-kv__d">
                    {monoText(
                      "ui.wiki-src-wiki.front-dead-reference-target-why",
                      { target: ref.target, why: ref.why },
                      ["target"],
                      "code",
                    )}
                    {text
                      ? ` ${tx("ui.wiki-src-wiki.front-text", { text })}`
                      : ""}
                  </span>
                </span>
                <span
                  className="wiki-kv__r t-bad"
                  data-testid="wiki-report-verdict"
                >
                  {tx("ui.wiki-src-wiki.front-warning")}
                </span>
              </div>
            ))}
            {(report?.unread ?? []).map(({ p, target, why }, i) => (
              <div key={`unread-${p.address}-${target}-${i}`}>
                <span>
                  <span className="wiki-kv__t">
                    <button
                      type="button"
                      className="t-d-linkbtn"
                      onClick={() => onOpen(p.address)}
                    >
                      {p.title}
                    </button>
                  </span>
                  <span className="wiki-kv__d">
                    <code>{target}</code> — {why}
                  </span>
                </span>
                <span className="wiki-kv__r" data-testid="wiki-report-verdict">
                  {tx("ui.wiki-src-wiki.front-not-read")}
                </span>
              </div>
            ))}
            {w.uncategorised.map((p) => (
              <div
                key={`catalogue-${p.address}`}
                data-testid="wiki-report-uncategorised"
              >
                <span>
                  <span className="wiki-kv__t">{p.title}</span>
                  <span className="wiki-kv__d">
                    {tx("ui.wiki-src-wiki.front-no-category-filed-nobody")}
                  </span>
                </span>
                <span className="wiki-kv__r" data-testid="wiki-report-verdict">
                  {tx("ui.wiki-src-wiki.front-note")}
                </span>
              </div>
            ))}
            {w.undeclaredCategories.map((p) => (
              <div
                key={`undeclared-catalogue-${p.address}`}
                data-testid="wiki-report-undeclared-category"
              >
                <span>
                  <span className="wiki-kv__t">{p.title}</span>
                  <span className="wiki-kv__d">
                    {monoText(
                      "ui.wiki-src-wiki.front-category-category-not-explained-wiki-yaml",
                      { category: p.front.category ?? "" },
                      ["category"],
                      "code",
                    )}
                  </span>
                </span>
                <span className="wiki-kv__r" data-testid="wiki-report-verdict">
                  {tx("ui.wiki-src-wiki.front-note")}
                </span>
              </div>
            ))}
            {w.unexplained.map((p) => (
              <div
                key={`st-${p.address}`}
                data-testid="wiki-report-unexplained"
              >
                <span>
                  <span className="wiki-kv__t">{p.title}</span>
                  <span className="wiki-kv__d">
                    {monoText(
                      "ui.wiki-src-wiki.front-no-status-no-reviewed-nobody-has",
                      { status: "status", reviewed: "reviewed" },
                      ["status", "reviewed"],
                      "code",
                    )}
                  </span>
                </span>
                <span className="wiki-kv__r" data-testid="wiki-report-verdict">
                  {tx("ui.wiki-src-wiki.front-note")}
                </span>
              </div>
            ))}
          </div>
          {/*
           * What was counted, with its denominator. Without it a number would
           * stand here that does not say how much was looked at — and "0 dead
           * references" without a denominator would look the same whether
           * twenty were checked or none. Without a corpus nothing is counted
           * at all, and then that is what stands here, instead of a finding
           * nobody made.
           */}
          <p className="t-meta">
            {report
              ? report.seen === 0
                ? tx(
                    "ui.wiki-src-wiki.front-no-page-wiki-names-atlas-reference",
                  )
                : report.dead.length === 0
                  ? // "all of them resolve" does not carry for exactly one —
                    // then it is one, and it resolves.
                    tx("ui.wiki-src-wiki.front-refs-pages-looked-verdict", {
                      refs: tx("ui.wiki-src-wiki.front-count-references", {
                        count: report.seen,
                      }),
                      pages: tx("ui.wiki-src-wiki.front-count-pages", {
                        count: w.pages.length,
                      }),
                      verdict: tx("ui.wiki-src-wiki.front-all-them-resolve", {
                        count: report.seen,
                      }),
                    })
                  : // The verb follows the number of dead ones, not the
                    // denominator: "1 of 9 … leads nowhere", "2 of 9 … lead nowhere".
                    tx("ui.wiki-src-wiki.front-dead-seen-noun-verb", {
                      dead: report.dead.length,
                      seen: report.seen,
                      noun: tx("ui.wiki-src-wiki.front-references-looked", {
                        count: report.seen,
                      }),
                      verb: tx("ui.wiki-src-wiki.front-lead-nowhere", {
                        count: report.dead.length,
                      }),
                    })
              : tx(
                  "ui.wiki-src-wiki.front-references-not-resolved-over-any-corpus",
                )}{" "}
            {/*
             * "checks the same" holds only for as long as it is the same. The
             * inline reader does not nest: what sits inside `**…**` or inside
             * a code span it reads as text, and the host counts it. Where that
             * happens it stands above row by row — and here it then says
             * "more", not "the same".
             */}
            <span className="t-mono">facet wiki check</span>{" "}
            {report?.unread.length
              ? tx(
                  "ui.wiki-src-wiki.front-sees-count-more-references-command-line",
                  {
                    count: report.unread.length,
                  },
                )
              : tx("ui.wiki-src-wiki.front-checks-same-command-line")}
          </p>
        </section>
      ) : null}
    </article>
  );
}

function Row({
  p,
  w,
  onOpen,
}: {
  p: WikiPage;
  w: WikiModel;
  onOpen: (address: string) => void;
}) {
  const catalogue = p.front.category ? w.category(p.front.category) : null;
  return (
    <button
      type="button"
      className="wiki-front__row"
      onClick={() => onOpen(p.address)}
    >
      {/*
       * A digit where `order` stands, and a dash where none does. Inventing a
       * running number out of the position would be a reading order nobody
       * declared.
       */}
      <span className="wiki-front__no t-mono">
        {p.front.order ? String(p.front.order).padStart(2, "0") : "—"}
      </span>
      <span>
        {p.group ? <span className="t-mono t-meta">{p.group}</span> : null}
        <span className="wiki-kv__t">{p.title}</span>
        {p.summary ? <span className="t-meta">{p.summary}</span> : null}
      </span>
      <span className="wiki-front__meta">
        {p.front.category ? (
          catalogue ? (
            <span className="wiki-front__kat">{catalogue.title}</span>
          ) : (
            // A category `wiki.yaml` does not declare is not a sixth rubric —
            // it is a word nobody introduced.
            <span className="wiki-front__kat t-bad">
              <span className="t-mono">{p.front.category}</span> —{" "}
              {tx("ui.wiki-src-wiki.front-not-declared")}
            </span>
          )
        ) : (
          <span className="t-muted">
            {tx("ui.wiki-src-wiki.front-no-category")}
          </span>
        )}
        <Status p={p} />
      </span>
    </button>
  );
}
