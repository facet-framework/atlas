import { tx } from "@/i18n";
/** The small recurring parts of the reader surface. */

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { audUnclassified, type DerivedScenario } from "./derive";
import type { AudFilter, Paged } from "./state";
/** The mono small-caps line above a section. */
export function K({ children }: { children: ReactNode }) {
  return <p className="k">{children}</p>;
}
/** Section head: label on the left, count on the right. */
export function SecHead({
  label,
  n,
  children,
}: {
  label: ReactNode;
  n?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="sechead" data-testid="sechead">
      <p className="k" data-testid="sechead-label">
        {label}
      </p>
      {n !== undefined && n !== null ? (
        <span className="n" data-testid="sechead-n">
          {n}
        </span>
      ) : null}
      {children}
    </div>
  );
}
/** A section with spacing above it. */
export function Sec({ children }: { children: ReactNode }) {
  return (
    <div className="sec" data-testid="sec">
      {children}
    </div>
  );
}
/** The mark behind a scenario's id whose behavior the record declares a
 * defect (the specification). */

export function DevTag({ big = false }: { big?: boolean }) {
  return (
    <span className={big ? "t-badge t-badge--warn" : "t-badge t-badge--warn t-badge--plain"}>
      {tx("ui.root.ui-deviation")}
    </span>
  );
}
/** The quiet sentence with which a surface explains itself or reports its nothing. */
export function Verdict({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <p className="verdict" style={style} data-testid="verdict">
      {children}
    </p>
  );
}
/** The invisible rows that bring a short last page to the height of a full
 * one. */

function Ghost({
  rows,
  missing,
  rowSelector,
}: {
  rows: number;
  missing: number;
  rowSelector?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // No dependency list, so after every paint: a change of filter swaps the
  // text inside the same rows, and then the remembered height becomes stale
  // without any of the numbers here having changed.
  useLayoutEffect(() => {
    const ghost = ref.current;
    if (!ghost) return;
    /** This page's rows, backwards from the placeholder. */

    const ownRows: Element[] = [];
    for (
      let node = ghost.previousElementSibling;
      node && ownRows.length < rows;
      node = node.previousElementSibling
    ) {
      const isOwn = rowSelector
        ? node.matches(rowSelector)
        : !node.classList.contains("ghost") && !node.classList.contains("pager");
      if (isOwn) ownRows.push(node);
    }
    const measure = () => {
      if (!ownRows.length) return;
      const total = ownRows.reduce((a, row) => a + row.getBoundingClientRect().height, 0);
      const mean = total / ownRows.length;
      ghost.style.height = mean > 0 ? `${mean * missing}px` : "";
    };
    measure();
    // A font loading late and a narrowing window change the row height
    // without React redrawing anything. The rows are observed, not the
    // placeholder — otherwise it would move itself in circles.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const row of ownRows) observer.observe(row);
    return () => observer.disconnect();
  });
  return (
    <div
      ref={ref}
      className="ghost"
      data-testid="ghost"
      aria-hidden="true"
      style={{ "--n": String(missing) } as CSSProperties}
    />
  );
}
/** Paging under a list. */

// @facet: workspace/controls/paging
// @facet-role: primary
export function Pager<T>({
  name,
  page,
  onGoto,
  terse,
  rowSelector,
}: {
  name: string;
  page: Paged<T>;
  onGoto: (key: string, page: number) => void;
  terse?: boolean;
  rowSelector?: string;
}) {
  if (page.pages <= 1) return null;
  return (
    <>
      {page.fill > 0 ? (
        <Ghost rows={page.slice.length} missing={page.fill} rowSelector={rowSelector} />
      ) : null}
      <div className="pager" data-testid="pager">
        <button
          type="button"
          className="btn"
          disabled={page.page === 0}
          onClick={() => onGoto(name, page.page - 1)}
          data-testid="pager-prev"
        >
          {tx("ui.root.ui-back")}
        </button>
        <span className="pi" data-testid="pager-info">
          {terse
            ? `${page.page + 1}/${page.pages}`
            : tx("ui.root.ui-first-value-entries-page-second-value", {
                v0: page.total,
                v1: page.page + 1,
                thirdValue: page.pages,
              })}
        </span>
        <button
          type="button"
          className="btn"
          disabled={page.page >= page.pages - 1}
          onClick={() => onGoto(name, page.page + 1)}
          data-testid="pager-next"
        >
          {tx("ui.root.ui-next")}
        </button>
      </div>
    </>
  );
}
/** A row of key and value, as the detail view needs it repeatedly. */
export function Rows({
  rows,
  style,
}: {
  rows: {
    label: ReactNode;
    value: ReactNode;
    bad?: boolean;
  }[];
  style?: React.CSSProperties;
}) {
  return (
    <div className="rows" style={style} data-testid="rows">
      {rows.map((row, i) => (
        <div key={i} className={row.bad ? "bad" : undefined} data-testid="rows-row">
          <span>{row.label}</span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  );
}
/** The Facet Atlas mark: two blocks offset by 22 units. */

export function Mark({ size = 15 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ width: size, height: size, display: "block" }}
    >
      <rect x="0" y="0" width="44" height="78" fill="var(--facet-ink)" />
      <rect x="56" y="22" width="44" height="78" fill="var(--facet-signal)" />
    </svg>
  );
}
/** The loading state of the same mark: five bars as a sine wave (chapter 07). */
export function LoadMark() {
  return (
    <svg className="loadmark" viewBox="0 0 158 100" aria-label={tx("ui.root.ui-atlas-reads")}>
      {[
        ["0", "var(--facet-ink)", "-2s"],
        ["34", "var(--facet-signal)", "-1.8s"],
        ["68", "var(--facet-resting)", "-1.6s"],
        ["102", "var(--facet-resting)", "-1.4s"],
        ["136", "var(--facet-resting)", "-1.2s"],
      ].map(([x, fill, delay]) => (
        <rect
          key={x}
          x={x}
          y="11"
          width="22"
          height="78"
          fill={fill}
          style={{ animationDelay: delay }}
        />
      ))}
    </svg>
  );
}
/** Anything literal from the repository stands in mono — ids, paths, commits. */
export function Mono({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}
/** The second filter row: who the sentences are written for — and what is
 * left standing beside it. */

export function AudienceFilter({
  filter,
  onSelect,
  list,
  filters,
  label,
}: {
  filter: AudFilter;
  onSelect: (value: AudFilter) => void;
  list: DerivedScenario[];
  filters: readonly [AudFilter, string][];
  label: (n: number, total: number, filtering: boolean) => ReactNode;
}) {
  const un = audUnclassified(list);
  return (
    // The group carries its name for the screen reader too: two "all"
    // buttons stand one below the other on the surface, and without this
    // label they would be indistinguishable from each other.
    <div
      className="filter aud"
      role="group"
      aria-label={tx("ui.root.ui-readership")}
      data-testid="filter-aud"
    >
      <span className="fl">{tx("ui.root.ui-readership")}</span>
      {filters.map(([value, text]) => (
        <button
          key={value}
          type="button"
          className={`btn ${filter === value ? "on" : ""}`}
          aria-pressed={filter === value}
          onClick={() => onSelect(value)}
        >
          {text}
        </button>
      ))}
      {list.length ? (
        <span className="audnote" data-testid="audnote">
          {label(un, list.length, filter !== "all")}
        </span>
      ) : null}
    </div>
  );
}
/** The sentence beside the readership row. */

export function audienceNote(n: number, total: number, filtering: boolean): ReactNode {
  if (!filtering) {
    return tx("ui.root.ui-n-total-unclassified", { n, total });
  }
  if (n === 0) return tx("ui.root.ui-nothing-unclassified-besides");
  // The sentence as a string, not as JSX text: it carries a quotation mark,
  // and written as an entity the source would conceal the exact
  // wording the design specifies.
  const verb =
    n === 1 ? tx("ui.root.ui-one-unclassified-lies") : tx("ui.root.ui-unclassified-ones-lie");
  return (
    <>
      <b>{n}</b> {tx("ui.root.ui-first-value-aside-not-not-applicable", { v0: verb })}
    </>
  );
}
