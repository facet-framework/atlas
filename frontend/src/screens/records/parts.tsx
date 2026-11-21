/** Small views shared by the records collection, the record and its sheets.
 * Candidates for the shared library: ProofMosaic, CommitSpark, SectionRail,
 * StepList, CodeView, DependencyGraph. */

import type { CSSProperties, ReactNode, Ref } from "react";
import { Badge, Dot, Icon, type IconName } from "@facet-tools/ui";

import { useText } from "../text";
import {
  KIND_LABEL,
  LIFECYCLE,
  STEP_LABEL,
  TAG,
  type GwtStep,
  type Lifecycle,
  type RecordKind,
} from "./model";

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

export function LifecycleBadge({ lifecycle }: { lifecycle: Lifecycle }) {
  const { t } = useText();
  const l = LIFECYCLE[lifecycle];
  return <Badge tone={l.tone}>{t(l.label)}</Badge>;
}

export function KindBadge({ kind }: { kind: RecordKind }) {
  const { t } = useText();
  return (
    <Badge tone={kind === "assumption" ? "signal" : "neutral"} plain>
      {t(KIND_LABEL[kind])}
    </Badge>
  );
}

/** Proven scenarios as a short bar with the count beside it. No scenarios is a dash. */
export function ProofBar({
  proven,
  total,
  wide,
}: {
  proven: number;
  total: number;
  wide?: boolean;
}) {
  const { t } = useText();
  const measured = total > 0;
  const full = measured && proven === total;
  return (
    <span
      className={cx("t-b-proof", wide && "t-b-proof--wide")}
      title={
        measured
          ? t("ui.screens-records.parts-proven-total-promises-named-test", {
              proven,
              total,
            })
          : t("ui.screens-records.parts-no-promises")
      }
    >
      <span className="t-b-proof__track" aria-hidden="true">
        {measured ? (
          <span
            className={cx("t-b-proof__fill", !full && "t-b-proof__fill--open")}
            style={{ "--t-value": proven / total } as CSSProperties}
          />
        ) : null}
      </span>
      <span className="t-mono t-num">{measured ? `${proven}/${total}` : "—"}</span>
    </span>
  );
}

/** One square per scenario: filled when proven, outlined when open. */
export function ProofMosaic({
  cells,
  size = 12,
  label,
}: {
  cells: { id: string; proven: boolean }[];
  size?: number;
  label: string;
}) {
  const { t } = useText();
  const perRow = Math.max(1, Math.min(cells.length, 12));
  const rows = Math.ceil(cells.length / perRow);
  const gap = 3;
  const w = perRow * (size + gap) - gap;
  const h = rows * (size + gap) - gap;
  return (
    <svg
      className="t-b-mosaic"
      width={w}
      height={Math.max(h, size)}
      viewBox={`0 0 ${w} ${Math.max(h, size)}`}
      role="img"
      aria-label={label}
    >
      {cells.map((c, i) => (
        <rect
          key={c.id}
          x={(i % perRow) * (size + gap)}
          y={Math.floor(i / perRow) * (size + gap)}
          width={size}
          height={size}
          rx={2.5}
          className={c.proven ? "t-b-mosaic__on" : "t-b-mosaic__off"}
        >
          <title>{`${c.id}: ${t(c.proven ? "ui.screens-records.parts-test-named" : "ui.screens-records.parts-open")}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** Commits per month over the last `months` months, as thin bars. */
export function CommitSpark({
  dates,
  months = 12,
  now,
}: {
  dates: string[];
  months?: number;
  now: string;
}) {
  const { t } = useText();
  const [ny, nm] = now.split("-").map(Number);
  const buckets = Array.from({ length: months }, () => 0);
  for (const d of dates) {
    const [y, m] = d.split("-").map(Number);
    const back = (ny - y) * 12 + (nm - m);
    if (back >= 0 && back < months) buckets[months - 1 - back] += 1;
  }
  const max = Math.max(1, ...buckets);
  const bw = 6;
  const gap = 3;
  const h = 28;
  return (
    <svg
      className="t-b-spark"
      width={months * (bw + gap)}
      height={h}
      viewBox={`0 0 ${months * (bw + gap)} ${h}`}
      role="img"
      aria-label={t("ui.screens-records.parts-commits-per-month-last-months-months", { months })}
    >
      {buckets.map((n, i) => {
        const bh = n ? Math.max(3, (n / max) * h) : 1;
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={h - bh}
            width={bw}
            height={bh}
            rx={1.5}
            className={n ? "t-b-spark__bar" : "t-b-spark__zero"}
          />
        );
      })}
    </svg>
  );
}

export type RailItem = {
  key: string;
  label: string;
  count?: ReactNode;
  tone?: "ok" | "warn" | "plan" | "bad";
};

/** Section index of a long page. The current section is marked, every entry jumps. */
export function SectionRail({
  items,
  current,
  onPick,
  label,
}: {
  items: RailItem[];
  current?: string;
  onPick?: (key: string) => void;
  label?: string;
}) {
  const { t } = useText();
  return (
    <nav className="t-b-rail" aria-label={label ?? t("ui.screens-records.parts-sections")}>
      <ol>
        {items.map((it) => (
          <li key={it.key}>
            <a
              href={`#${it.key}`}
              className="t-b-rail__item"
              aria-current={it.key === current ? "location" : undefined}
              onClick={(e) => {
                e.preventDefault();
                onPick?.(it.key);
              }}
            >
              {it.tone ? <Dot tone={it.tone} /> : <span className="t-b-rail__pad" />}
              <span className="t-wrap">{it.label}</span>
              {it.count != null ? <span className="t-b-rail__count">{it.count}</span> : null}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The same index on a phone: a horizontal strip of chips under the head. */
export function SectionChips({
  items,
  current,
  onPick,
  navRef,
}: {
  items: RailItem[];
  current?: string;
  onPick?: (key: string) => void;
  /** Receives the strip, for a page that measures what covers its top. */
  navRef?: Ref<HTMLElement>;
}) {
  const { t } = useText();
  return (
    <nav className="t-b-chipnav" aria-label={t("ui.screens-records.parts-sections")} ref={navRef}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className="t-chip"
          aria-pressed={it.key === current}
          onClick={() => onPick?.(it.key)}
        >
          {it.tone ? <Dot tone={it.tone} /> : null}
          {it.label}
          {it.count != null ? <span className="t-chip__count">{it.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/** A step's text cut at every `<name>` that names a declared column. A
 * placeholder no column declares stays text: prose carries angle brackets
 * that were never meant as parameters. */

export function splitParams(
  text: string,
  columns: ReadonlySet<string>,
): ({ kind: "text"; text: string } | { kind: "param"; name: string })[] {
  if (!columns.size || !text.includes("<")) return [{ kind: "text", text }];
  const parts: ({ kind: "text"; text: string } | { kind: "param"; name: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(/<([^<>\n]+)>/g)) {
    const name = m[1].trim();
    if (!columns.has(name)) continue;
    const at = m.index ?? 0;
    if (at > last) parts.push({ kind: "text", text: text.slice(last, at) });
    parts.push({ kind: "param", name });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** Given/When/Then rows. `params` are an Outline's declared columns, drawn as
 * parameter tokens; `render` draws the prose around them (markup, terms). */

export function StepList({
  steps,
  params,
  render,
}: {
  steps: GwtStep[];
  params?: ReadonlySet<string>;
  render?: (text: string) => ReactNode;
}) {
  const { t } = useText();
  const prose = (text: string) => (render ? render(text) : text);
  return (
    <dl className="t-b-steps">
      {steps.map((s, i) => (
        <div key={i} className={cx("t-b-steps__row", `t-b-steps__row--${s.kw}`)}>
          <dt>{t(STEP_LABEL[s.kw])}</dt>
          <dd>
            {params?.size
              ? splitParams(s.text, params).map((part, j) =>
                  part.kind === "param" ? (
                    <span
                      key={j}
                      className="t-b-param"
                      data-testid="step-param"
                      title={t("ui.screens-records.parts-column-name", { name: part.name })}
                    >
                      {part.name}
                    </span>
                  ) : (
                    <span key={j}>{prose(part.text)}</span>
                  ),
                )
              : prose(s.text)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Source with line numbers. YAML keys and comments get a quiet colour. */
export function CodeView({
  text,
  lang,
  firstLine = 1,
  mark,
  label,
  zoom,
}: {
  text: string;
  lang: "yaml" | "json" | "go" | "text";
  /** Code zoom in percent; the page's own code size when absent. */
  zoom?: number;
  firstLine?: number;
  /** Line numbers (absolute) to highlight. */
  mark?: number[];
  label: string;
}) {
  const lines = text.split("\n");
  return (
    <div className="t-b-code" role="region" aria-label={label}>
      <pre style={zoom != null ? { fontSize: `calc(var(--t-fs-12) * ${zoom / 100})` } : undefined}>
        {lines.map((l, i) => {
          const n = firstLine + i;
          return (
            <span
              key={i}
              className={cx("t-b-code__line", mark?.includes(n) && "t-b-code__line--mark")}
            >
              <span className="t-b-code__n" aria-hidden="true">
                {n}
              </span>
              <code>{highlight(l, lang)}</code>
            </span>
          );
        })}
      </pre>
    </div>
  );
}

function highlight(line: string, lang: string): ReactNode {
  if (lang === "yaml") {
    if (/^\s*#/.test(line)) return <span className="t-b-code__c">{line}</span>;
    const m = /^(\s*-?\s*)([A-Za-z_][\w.-]*)(:)(.*)$/.exec(line);
    if (m)
      return (
        <>
          {m[1]}
          <span className="t-b-code__k">{m[2]}</span>
          {m[3]}
          <span className="t-b-code__v">{m[4]}</span>
        </>
      );
    return line;
  }
  if (lang === "json") {
    const m = /^(\s*)("[^"]+")(:)(.*)$/.exec(line);
    if (m)
      return (
        <>
          {m[1]}
          <span className="t-b-code__k">{m[2]}</span>
          {m[3]}
          <span className="t-b-code__v">{m[4]}</span>
        </>
      );
    return line;
  }
  if (lang === "go" && /^\s*\/\//.test(line)) {
    return <span className={line.includes(TAG) ? "t-b-code__a" : "t-b-code__c"}>{line}</span>;
  }
  return line;
}

/** Who this record needs (right) and who needs it (left), drawn as curves into
 * the record in the middle. Every node is a link. */

export function DependencyGraph({
  center,
  upstream,
  downstream,
  onOpen,
}: {
  center: string;
  upstream: string[];
  downstream: string[];
  onOpen?: (id: string) => void;
}) {
  const { t } = useText();
  const rowH = 30;
  const rows = Math.max(upstream.length, downstream.length, 1);
  const h = rows * rowH + 10;
  const w = 960;
  const cy = h / 2;
  const yAt = (i: number, n: number) => cy + (i - (n - 1) / 2) * rowH;
  const node = (id: string, x: number, y: number, anchor: "start" | "end", key: string) => (
    <g key={key} className="t-b-graph__node" transform={`translate(${x} ${y})`}>
      <a
        href={`#/record/${id}`}
        onClick={(e) => {
          e.preventDefault();
          onOpen?.(id);
        }}
      >
        <text textAnchor={anchor} dy="0.35em">
          {id}
        </text>
      </a>
    </g>
  );
  return (
    <svg
      className="t-b-graph"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={t("ui.screens-records.parts-dependencies-id", { id: center })}
    >
      {downstream.map((_, i) => (
        <path
          key={`dl${i}`}
          d={`M 420 ${yAt(i, downstream.length)} C 450 ${yAt(i, downstream.length)}, 450 ${cy}, 470 ${cy}`}
        />
      ))}
      {upstream.map((_, i) => (
        <path
          key={`ul${i}`}
          d={`M 490 ${cy} C 510 ${cy}, 510 ${yAt(i, upstream.length)}, 540 ${yAt(i, upstream.length)}`}
        />
      ))}
      <circle cx={480} cy={cy} r={11} className="t-b-graph__center" />
      {downstream.map((id, i) => node(id, 414, yAt(i, downstream.length), "end", `d${id}`))}
      {upstream.map((id, i) => node(id, 546, yAt(i, upstream.length), "start", `u${id}`))}
      {!downstream.length ? (
        <text x={414} y={cy} dy="0.35em" textAnchor="end" className="t-b-graph__none">
          {t("ui.screens-records.parts-nobody-depends")}
        </text>
      ) : null}
      {!upstream.length ? (
        <text x={546} y={cy} dy="0.35em" className="t-b-graph__none">
          {t("ui.screens-records.parts-needs-nothing")}
        </text>
      ) : null}
    </svg>
  );
}

/** A labelled figure for the record head. `null` is shown as not measured. */
export function Figure({
  label,
  value,
  of,
  tone,
  icon,
  foot,
}: {
  label: string;
  value: number | null;
  of?: number;
  tone?: "ok" | "warn" | "plan" | "bad";
  icon: IconName;
  foot?: ReactNode;
}) {
  const { t, number } = useText();
  return (
    <div className="t-b-figure" data-testid={`figure-${icon}`}>
      <span className="t-b-figure__label">
        <Icon name={icon} size={14} />
        {label}
      </span>
      <span className={cx("t-b-figure__value", tone && `t-${tone}`)}>
        {value == null ? "—" : number(value)}
        {of != null ? <small> / {number(of)}</small> : null}
      </span>
      {value == null ? (
        <span className="t-meta">{t("ui.screens-records.parts-not-measured")}</span>
      ) : (
        foot
      )}
    </div>
  );
}
