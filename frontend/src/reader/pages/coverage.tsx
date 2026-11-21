/** On the developer's Overview, below the comparison: the two ways the code is
 * out of step with the records, side by side and never summed — anchors
 * pointing at no record, with their place, and the files nobody described,
 * measured in lines where the run counted them. An orphan row opens the
 * anchors page, where every anchor stands with its record. */

import { Badge, Pagination, Section } from "@facet-tools/ui";
import { useText } from "@/chrome";
import type { PageContext } from "../context";
import { anchorCoverage } from "../derive-roles";
import { href } from "../route";

const PAGE = 6;

type CoverageState = { orphans: number; files: number };

const slice = <R,>(rows: readonly R[], page: number) => rows.slice((page - 1) * PAGE, page * PAGE);

function Pager({
  ctx,
  page,
  total,
  onPage,
}: {
  ctx: PageContext;
  page: number;
  total: number;
  onPage: (n: number) => void;
}) {
  if (total <= PAGE) return null;
  return (
    <Pagination
      page={page}
      pageSize={PAGE}
      total={total}
      pageSizes={[PAGE]}
      compact={ctx.mobile}
      onPage={onPage}
    />
  );
}

export function AnchorCoverage({ ctx }: { ctx: PageContext }) {
  const { t } = ctx;
  const { number: nf } = useText();
  const [s, set] = ctx.slot<CoverageState>("overview-coverage", { orphans: 1, files: 1 });
  const [, setAnchors] = ctx.slot<{
    view: string;
    query: string;
    page: number;
    dir: string | null;
    role: string | null;
  }>("contents:anchor", { view: "treemap", query: "", page: 1, dir: null, role: null });
  const c = anchorCoverage(ctx.model);
  const head =
    c.measure.unit === "lines"
      ? t("ui.reader-pages.coverage-undescribed-total-lines", {
          undescribed: nf(c.measure.undescribed),
          total: nf(c.measure.total),
        })
      : c.measure.unit === "files"
        ? t("ui.reader-pages.coverage-count-files-lines-not-counted", {
            count: c.measure.undescribed,
          })
        : "—";
  return (
    <div data-testid="overview-dev-coverage">
      <Section title={t("ui.reader-pages.coverage-anchors-files")}>
        <div
          style={{
            display: "grid",
            gap: "var(--t-s-4)",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <div className="t-stack" style={{ gap: 6, minWidth: 0 }} data-testid="coverage-orphans">
            <span className="t-row t-row--between">
              <span className="t-label">
                {t("ui.reader-pages.coverage-anchors-without-record")}
              </span>
              <span className="t-meta">{nf(c.orphans.length)}</span>
            </span>
            {c.orphans.length ? (
              <>
                <div
                  className="t-surface t-a-list"
                  role="list"
                  aria-label={t("ui.reader-pages.coverage-anchors-without-record")}
                >
                  {slice(c.orphans, s.orphans).map((o) => (
                    <div key={`${o.path}:${o.line}`} role="listitem">
                      <button
                        type="button"
                        className="t-list-row"
                        onClick={() => {
                          // The anchors page, as a table narrowed to this anchor's file.
                          setAnchors({
                            view: "table",
                            query: o.path,
                            page: 1,
                            dir: null,
                            role: null,
                          });
                          ctx.go(href({ area: "contents", kind: "anchor" }));
                        }}
                      >
                        <span />
                        <span className="t-list-row__main">
                          <span className="t-list-row__title t-mono t-wrap">{`${o.path}:${o.line}`}</span>
                          <span className="t-list-row__sub t-mono t-wrap">
                            {t("ui.reader-pages.coverage-facet-id", { id: o.id })}
                          </span>
                        </span>
                        <span className="t-row">
                          <Badge tone="bad" plain>
                            {t("ui.reader-pages.coverage-no-record")}
                          </Badge>
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
                <Pager
                  ctx={ctx}
                  page={s.orphans}
                  total={c.orphans.length}
                  onPage={(orphans) => set({ orphans })}
                />
              </>
            ) : (
              <p className="t-muted">
                {t("ui.reader-pages.coverage-no-anchor-points-missing-record")}
              </p>
            )}
          </div>
          <div className="t-stack" style={{ gap: 6, minWidth: 0 }} data-testid="coverage-files">
            <span className="t-row t-row--between">
              <span className="t-label">{t("ui.reader-pages.coverage-files-without-anchor")}</span>
              <span
                className="t-meta"
                data-testid="coverage-files-head"
                title={
                  c.measure.unit === "none" ? t("ui.reader-pages.coverage-not-measured") : undefined
                }
              >
                {head}
              </span>
            </span>
            {c.undescribed?.length ? (
              <>
                <div
                  className="t-surface t-a-list"
                  role="list"
                  aria-label={t("ui.reader-pages.coverage-files-without-anchor")}
                >
                  {slice(c.undescribed, s.files).map((f) => (
                    <div key={f.path} role="listitem" className="t-list-row">
                      <span />
                      <span className="t-list-row__main">
                        <span className="t-list-row__title t-mono t-wrap">{f.path}</span>
                      </span>
                      <span className="t-meta">
                        {t("ui.reader-pages.coverage-n-lines", { n: nf(f.loc) })}
                      </span>
                    </div>
                  ))}
                </div>
                <Pager
                  ctx={ctx}
                  page={s.files}
                  total={c.undescribed.length}
                  onPage={(files) => set({ files })}
                />
              </>
            ) : (
              <p className="t-muted" data-testid="coverage-files-empty">
                {c.undescribed
                  ? t("ui.reader-pages.coverage-every-file-read-described")
                  : t("ui.reader-pages.coverage-scan-sent-no-file-list")}
              </p>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
