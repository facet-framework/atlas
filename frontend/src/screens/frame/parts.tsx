/** Pieces shared by the group A pages: the path bar, open-promise and commit lists. */
import type { TextKey } from "../text";
import { useText } from "../text";
import { Dot, ListRow, Breadcrumbs, type Crumb } from "@facet-tools/ui";

import { Mosaic } from "./charts";
import type { CommitView, FeatureView } from "./model";

/** Text keys of the lifecycle labels; the record keeps the English value. */
export const LIFECYCLE: Record<FeatureView["lifecycle"], TextKey> = {
  active: "ui.screens-frame.parts-active",
  planned: "ui.screens-frame.parts-planned",
  deprecated: "ui.screens-frame.parts-deprecated",
};

/** The clickable path. Desktop: every segment a place, carets open siblings.
 * Mobile: one compact line (`navigation / atlas`) whose earlier segments are
 * tappable; no back arrow of its own, because the top bar's ‹ is history and
 * this line is hierarchy. */

export function PathBar({
  crumbs,
  openKey,
  mobile,
  onToggleSiblings,
  query,
  onQuery,
  onClose,
}: {
  crumbs: Crumb[];
  openKey?: string | null;
  mobile?: boolean;
  onToggleSiblings?: (key: string) => void;
  /** The open sibling list's search text, when the container holds it. */
  query?: string;
  onQuery?: (query: string) => void;
  /** Esc or a press outside the open sibling list. */
  onClose?: () => void;
}) {
  const { t } = useText();
  if (mobile) {
    return (
      <nav className="t-a-pathline" aria-label={t("ui.screens-frame.parts-path")}>
        <ol>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            const cls = c.mono ? "t-mono" : undefined;
            return (
              <li key={c.key}>
                {i > 0 ? (
                  <span className="t-a-pathline__sep" aria-hidden="true">
                    /
                  </span>
                ) : null}
                {last ? (
                  <span className={cls} aria-current="page">
                    {c.label}
                  </span>
                ) : (
                  <button type="button" className="t-a-link" onClick={c.onClick}>
                    <span className={cls}>{c.label}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }
  return (
    <div className="t-a-path">
      <Breadcrumbs
        crumbs={crumbs}
        openKey={openKey}
        onToggleSiblings={onToggleSiblings}
        query={query}
        onQuery={onQuery}
        onClose={onClose}
      />
    </div>
  );
}

export function OpenRecordList({
  features,
  limit,
  onOpenRecord,
  label,
}: {
  features: FeatureView[];
  limit: number;
  onOpenRecord?: (id: string) => void;
  label?: string;
}) {
  const { t, number: nf } = useText();
  const open = features
    .filter((f) => f.proven < f.scenarios)
    .sort((a, b) => b.scenarios - b.proven - (a.scenarios - a.proven))
    .slice(0, limit);
  if (!open.length) return <p className="t-muted">{t("ui.screens-frame.parts-no-open-promise")}</p>;
  return (
    <div
      className="t-surface t-a-list"
      role="list"
      aria-label={label ?? t("ui.screens-frame.parts-open-promises")}
    >
      {open.map((f) => (
        <div key={f.id} role="listitem">
          <ListRow
            title={<span className="t-mono">{f.id}</span>}
            sub={t("ui.screens-frame.parts-open-open-tests-tests-lifecycle", {
              open: nf(f.scenarios - f.proven),
              tests: nf(f.tests),
              lifecycle: t(LIFECYCLE[f.lifecycle]),
            })}
            lead={<Dot tone="warn" />}
            trail={
              <Mosaic
                cells={f.mosaic ?? Array.from({ length: f.scenarios }, (_, i) => i < f.proven)}
                label={f.slug}
                size={8}
              />
            }
            onClick={() => onOpenRecord?.(f.id)}
          />
        </div>
      ))}
    </div>
  );
}

/** Recent commits on records. `null` means the history was not read — that is
 * different from `[]`, a read history without commits, and the two say so
 * differently instead of both rendering an empty list. */

export function CommitList({
  commits,
  limit,
  onOpenRecord,
}: {
  commits: CommitView[] | null;
  limit: number;
  onOpenRecord?: (id: string) => void;
}) {
  const { t } = useText();
  if (commits == null)
    return (
      <p
        className="t-muted"
        data-testid="commits-unmeasured"
        title={t("ui.screens-frame.parts-not-measured")}
      >
        — · {t("ui.screens-frame.parts-not-measured")}
      </p>
    );
  if (!commits.length)
    return (
      <p className="t-muted" data-testid="commits-none">
        {t("ui.screens-frame.parts-no-commits-records-yet")}
      </p>
    );
  return (
    <ol className="t-a-commits">
      {commits.slice(0, limit).map((c) => (
        <li key={c.sha}>
          <span className="t-meta">{c.date}</span>
          <span className="t-stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="t-a-commits__subject">{c.subject}</span>
            <button
              type="button"
              className="t-a-link t-mono t-wrap"
              onClick={() => onOpenRecord?.(c.record)}
            >
              {c.sha} · {c.record}
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}
