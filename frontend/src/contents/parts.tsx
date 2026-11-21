import { tx } from "@/i18n";
/** The building blocks of the detail column — the same ones the design names
 * `head`, `facts`, `sec` and `kv`. */

import type { ReactNode } from "react";
/** The head of a detail column: the id in mono, the lead below it. */
export function Header({ id, lead }: { id: ReactNode; lead?: ReactNode }) {
  return (
    <>
      <p className="kid">{id}</p>
      {lead ? <p className="lead">{lead}</p> : null}
    </>
  );
}
/** An id whose last segment is emphasised — `a/b/<b>c</b>`. */
export function Identity({ id }: { id: string }) {
  const segs = id.split("/");
  const last = segs.pop() ?? id;
  return (
    <>
      {segs.length ? `${segs.join("/")}/` : ""}
      <b>{last}</b>
    </>
  );
}
/** A value in the facts grid: text, plus optionally its colour. */
export type Fact = [string, ReactNode, ("ok" | "bad" | "warn")?];
/** The facts grid below the head. */
export function Facts({ rows }: { rows: Fact[] }) {
  return (
    <div className="facts">
      {rows.map(([k, v, cls]) => (
        <div key={k} data-testid="catalogue-fact">
          <p className="k" data-testid="catalogue-fact-name">
            {k}
          </p>
          <p className={`v ${cls ?? ""}`} data-testid="catalogue-fact-value">
            {v}
          </p>
        </div>
      ))}
    </div>
  );
}
/** A section with a heading, an optional counter and content. */
export function Section({
  title,
  n,
  children,
}: {
  title: ReactNode;
  n?: number | string | null;
  children: ReactNode;
}) {
  return (
    <div className="sec">
      <div className="sechead">
        <p className="k">{title}</p>
        {n !== null && n !== undefined ? <span className="n">{n}</span> : null}
      </div>
      {children}
    </div>
  );
}
/** A row of a `kv` list: title, description, margin value. */
export type KeyValueRow = {
  key: string;
  t: ReactNode;
  d?: ReactNode;
  r?: ReactNode;
  cls?: "ok" | "bad" | "warn";
  onClick?: () => void;
};
/** The list of title, description and margin value. */

export function Kv({ rows }: { rows: KeyValueRow[] }) {
  if (!rows.length) return <p className="verdict">—</p>;
  return (
    <div className="kv">
      {rows.map((row) =>
        row.onClick ? (
          <button type="button" key={row.key} onClick={row.onClick}>
            <span>
              <span className="t">{row.t}</span>
              {row.d ? <span className="d">{row.d}</span> : null}
            </span>
            {row.r !== undefined ? <span className={`r ${row.cls ?? ""}`}>{row.r}</span> : null}
          </button>
        ) : (
          <div key={row.key}>
            <span>
              <span className="t">{row.t}</span>
              {row.d ? <span className="d">{row.d}</span> : null}
            </span>
            {row.r !== undefined ? <span className={`r ${row.cls ?? ""}`}>{row.r}</span> : null}
          </div>
        ),
      )}
    </div>
  );
}
/** The reading paragraph: what the surface means, in one sentence. */
export function Reading({ children }: { children: ReactNode }) {
  return (
    <p className="reading">
      <span className="k">{tx("ui.contents.parts-reading")}</span>
      {children}
    </p>
  );
}
/** A value this run did not measure. */

export function Undetermined({ children }: { children: ReactNode }) {
  return <span className="unknown">{children}</span>;
}
