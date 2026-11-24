import {
  Button,
  Tabs,
  Meter,
  DataTable,
  Icon,
  BandChart,
  categoryColor,
  Sunburst,
} from "@facet-tools/ui";

import { useText } from "../text";
import type { TextKey } from "../text";
import { KeyValues, KindFrame, MiniStat } from "./frame";
import type { CalibrationMetric, Outlier, TaxDomain, ViewDef } from "./model";

/** Taxonomy ----------------------------------------------------------------- */

export type TaxonomyView = "tree" | "sun";

export type TaxonomyPageProps = {
  view: TaxonomyView;
  domains: TaxDomain[];
  expanded: string[];
  selected?: string | null;
  mobile?: boolean;
  onView?: (v: TaxonomyView) => void;
  onToggle?: (id: string) => void;
  onSelect?: (id: string) => void;
  onOpenOverview?: (id: string) => void;
};

const T_VIEWS: (ViewDef<TaxonomyView> & { label: TextKey })[] = [
  { value: "tree", label: "ui.screens-contents.structure-tree", icon: "tree" },
  { value: "sun", label: "ui.screens-contents.structure-sun", icon: "globe" },
];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Taxonomy: domains and capabilities the record ids are drawn from — as a tree or a sunburst. */
export function TaxonomyPage(p: TaxonomyPageProps) {
  const { t, number } = useText();
  const caps = p.domains.flatMap((d) => d.capabilities.map((c) => ({ ...c, domain: d })));
  const records = sum(caps.map((c) => c.records));
  const empty = caps.filter((c) => c.records === 0).length;
  const sel =
    p.domains.find((d) => d.id === p.selected) ?? caps.find((c) => c.id === p.selected) ?? null;
  return (
    <KindFrame
      groupId="Registry"
      testId="taxonomy-page"
      kindLabel={t("ui.screens-contents.structure-taxonomy")}
      group="Registry"
      figure={p.domains.length}
      sentence={t("ui.screens-contents.structure-areas-areas-caps-capabilities-records-records", {
        areas: p.domains.length,
        caps: caps.length,
        records,
      })}
      lead={
        empty
          ? t("ui.screens-contents.structure-count-capabilities-without-record", { count: empty })
          : t("ui.screens-contents.structure-every-capability-carries-records")
      }
      stats={
        <>
          <MiniStat label={t("ui.screens-contents.structure-areas")} value={p.domains.length} />
          <MiniStat label={t("ui.screens-contents.structure-capabilities")} value={caps.length} />
          <MiniStat
            label={t("ui.screens-contents.structure-empty")}
            value={empty}
            tone={empty ? "warn" : undefined}
          />
        </>
      }
      views={T_VIEWS.map((v) => ({ ...v, label: t(v.label) }))}
      view={p.view}
      onView={p.onView}
    >
      {p.view === "tree" ? (
        <ul
          className="t-c-tree"
          role="tree"
          aria-label={t("ui.screens-contents.structure-taxonomy")}
          data-testid="taxonomy-tree"
        >
          {p.domains.map((d) => {
            const open = p.expanded.includes(d.id);
            const dr = sum(d.capabilities.map((c) => c.records));
            const dp = sum(d.capabilities.map((c) => c.proven));
            return (
              <li
                key={d.id}
                role="treeitem"
                aria-expanded={open}
                aria-selected={p.selected === d.id}
              >
                <div className="t-c-tree__row t-c-tree__row--domain">
                  <button
                    type="button"
                    className="t-c-tree__caret"
                    aria-label={t(
                      open
                        ? "ui.screens-contents.structure-collapse-name"
                        : "ui.screens-contents.structure-expand-name",
                      { name: d.title },
                    )}
                    onClick={() => p.onToggle?.(d.id)}
                  >
                    <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
                  </button>
                  <button
                    type="button"
                    className="t-c-tree__name"
                    onClick={() => p.onSelect?.(d.id)}
                  >
                    <span className="t-h3">{d.title}</span>
                    <span className="t-meta">{d.id}</span>
                  </button>
                  <span className="t-badge t-badge--plain t-hide-mobile">{d.klass}</span>
                  <span className="t-meta t-hide-mobile">{d.team}</span>
                  <span className="t-c-tree__meter">
                    <Meter
                      value={dr ? dp / dr : null}
                      thin
                      label={t("ui.screens-contents.structure-team-test-named", { team: d.title })}
                    />
                  </span>
                  <span className="t-num t-c-tree__n">{number(dr)}</span>
                </div>
                {open ? (
                  <ul role="group" className="t-c-tree__children">
                    {d.capabilities.map((c) => (
                      <li key={c.id} role="treeitem" aria-selected={p.selected === c.id}>
                        <button
                          type="button"
                          className="t-c-tree__row"
                          onClick={() => p.onSelect?.(c.id)}
                        >
                          <span className="t-c-tree__indent" aria-hidden="true" />
                          <span className="t-c-tree__name">
                            <span>{c.title}</span>
                            <span className="t-meta">{c.id}</span>
                          </span>
                          <span className="t-meta t-hide-mobile">
                            {t("ui.screens-contents.structure-count-promises", {
                              count: c.scenarios,
                            })}
                          </span>
                          <span className="t-c-tree__meter">
                            <Meter
                              value={c.records ? c.proven / c.records : null}
                              thin
                              label={t("ui.screens-contents.structure-team-test-named", {
                                team: c.title,
                              })}
                            />
                          </span>
                          <span
                            className={c.records ? "t-num t-c-tree__n" : "t-num t-c-tree__n t-warn"}
                          >
                            {number(c.records)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="t-c-sunlayout" data-testid="taxonomy-sun">
          <Sunburst
            label={t("ui.screens-contents.structure-taxonomy-sunburst")}
            size={p.mobile ? 340 : 520}
            selected={p.selected}
            legend={false}
            nodes={p.domains.map((d) => ({
              key: d.id,
              label: d.title,
              value: Math.max(1, sum(d.capabilities.map((c) => c.records))),
              children: d.capabilities.map((c) => ({
                key: c.id,
                label: c.title,
                value: Math.max(1, c.records),
                tone: c.records === 0 ? "warn" : undefined,
              })),
            }))}
            center={
              <>
                <span className="t-c-taxonomy-count">
                  {sel
                    ? number(
                        "capabilities" in sel
                          ? sum(sel.capabilities.map((c) => c.records))
                          : sel.records,
                      )
                    : number(records)}
                </span>
                <span className="t-meta">
                  {sel ? sel.title : t("ui.screens-contents.structure-records")}
                </span>
              </>
            }
          />
          <div className="t-stack">
            <ul
              className="t-c-plain t-stack"
              style={{ gap: 4 }}
              aria-label={t("ui.screens-contents.structure-areas")}
            >
              {p.domains.map((d, i) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="t-c-legendrow"
                    aria-pressed={p.selected === d.id}
                    onClick={() => p.onSelect?.(d.id)}
                  >
                    <span
                      className="t-c-explanation__sw"
                      style={{
                        background: categoryColor(i),
                      }}
                    />
                    <span style={{ flex: 1 }}>{d.title}</span>
                    <span className="t-meta">
                      {t("ui.screens-contents.structure-count-cap", {
                        count: d.capabilities.length,
                      })}
                    </span>
                    <span className="t-num">
                      {number(sum(d.capabilities.map((c) => c.records)))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {sel ? (
              <div className="t-raised t-pad t-stack" data-testid="taxonomy-detail">
                <span className="t-eyebrow">
                  {"capabilities" in sel
                    ? t("ui.screens-contents.structure-area")
                    : t("ui.screens-contents.structure-capability")}
                </span>
                <span className="t-h2">{sel.title}</span>
                {"capabilities" in sel ? <p className="t-c-small t-ink2">{sel.purpose}</p> : null}
                <KeyValues
                  items={
                    "capabilities" in sel
                      ? [
                          [
                            "Id",
                            <span className="t-mono" key="i">
                              {sel.id}
                            </span>,
                          ],
                          [t("ui.screens-contents.structure-class"), sel.klass],
                          ["By team", sel.team],
                          [
                            t("ui.screens-contents.structure-capabilities"),
                            sel.capabilities.length,
                          ],
                        ]
                      : [
                          [
                            "Id",
                            <span className="t-mono" key="i">
                              {sel.id}
                            </span>,
                          ],
                          ["Records", sel.records],
                          [t("ui.screens-contents.structure-promises"), sel.scenarios],
                          [
                            t("ui.screens-contents.structure-test-named"),
                            `${sel.proven} / ${sel.records}`,
                          ],
                        ]
                  }
                />
                <Button size="small" iconAfter="forward" onClick={() => p.onOpenOverview?.(sel.id)}>
                  {t("ui.screens-contents.structure-open-overview")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </KindFrame>
  );
}

/** Calibration ---------------------------------------------------------------- */

export type CalibrationView = "bands" | "outliers";

export type CalibrationPageProps = {
  view: CalibrationView;
  metrics: CalibrationMetric[];
  outliers: Outlier[];
  metric?: string;
  onView?: (v: CalibrationView) => void;
  onMetric?: (key: string) => void;
  onOpenRecord?: (id: string) => void;
};

const C_VIEWS: (ViewDef<CalibrationView> & { label: TextKey })[] = [
  { value: "bands", label: "ui.screens-contents.structure-bands", icon: "barChart" },
  { value: "outliers", label: "ui.screens-contents.structure-outliers", icon: "warning" },
];

/** Visible word for the side of the band an outlier lies on. */
const SIDE: Record<Outlier["side"], TextKey> = {
  above: "ui.screens-contents.structure-above",
  below: "ui.screens-contents.structure-below",
};

/** Calibration: whether the registry has the shape the specification suggests. */
export function CalibrationPage(p: CalibrationPageProps) {
  const { t, plural } = useText();
  const outside = sum(p.metrics.map((m) => m.above + m.below));
  const inBand = p.metrics.filter((m) => m.median >= m.band.low && m.median <= m.band.high).length;
  const metric = p.metric ?? p.metrics[0]?.key;
  const current = p.metrics.find((m) => m.key === metric);
  const rows = p.outliers.filter((o) => o.metric === metric);
  return (
    <KindFrame
      groupId="Registry"
      testId="calibration-page"
      kindLabel={t("ui.screens-contents.structure-calibration")}
      group="Registry"
      figure={inBand}
      of={p.metrics.length}
      tone={inBand === p.metrics.length ? "ok" : "warn"}
      sentence={t("ui.screens-contents.structure-inband-total-lie-within-band", {
        inBand: plural("ui.screens-contents.structure-count-medians", inBand),
        total: plural("ui.screens-contents.structure-count-medians", p.metrics.length),
      })}
      lead={
        <>
          <span className="t-c-lead-line">
            {t("ui.screens-contents.structure-band-typical-range-facet-gives-measure")}
          </span>
          <span className="t-c-lead-line">
            {t("ui.screens-contents.structure-count-data-points-lie-outside-their", {
              count: outside,
            })}
          </span>
        </>
      }
      views={C_VIEWS.map((v) => ({ ...v, label: t(v.label) }))}
      view={p.view}
      onView={p.onView}
    >
      {p.view === "bands" ? (
        <div className="t-stack" style={{ gap: 14 }} data-testid="calibration-bands">
          <div className="t-c-explanation">
            <span
              className="t-c-explanation__sw"
              style={{ background: "var(--t-ok-wash)", outline: "1px solid var(--t-ok)" }}
            />{" "}
            {t("ui.screens-contents.structure-band")}
            <span className="t-c-explanation__bar" /> {t("ui.screens-contents.structure-median")}
            <span className="t-c-explanation__whisk" /> {t("ui.screens-contents.structure-range")}
            <span
              className="t-c-explanation__sw t-c-explanation__sw--round"
              style={{ background: "var(--t-warn)" }}
            />{" "}
            {t("ui.screens-contents.structure-outside")}
          </div>
          {p.metrics.map((m) => (
            <article key={m.key} className="t-surface t-pad t-c-bandcard">
              <header className="t-row t-row--wrap">
                <span className="t-h3">{m.label}</span>
                <span className="t-meta">
                  {t("ui.screens-contents.structure-count-samples", { count: m.samples })}
                </span>
                <span className="t-spacer" />
                <span
                  className={
                    m.median >= m.band.low && m.median <= m.band.high
                      ? "t-badge t-badge--ok"
                      : "t-badge t-badge--warn"
                  }
                >
                  {t("ui.screens-contents.structure-median")} {m.median} {m.unit}
                </span>
              </header>
              <BandChart
                label={t("ui.screens-contents.structure-metric-median-median-band-low-high", {
                  metric: m.label,
                  median: m.median,
                  low: m.band.low,
                  high: m.band.high,
                  min: m.min,
                  max: m.max,
                })}
                min={m.min}
                max={m.max}
                median={m.median}
                band={m.band}
                values={m.values}
              />
              <div className="t-row t-row--wrap t-c-small">
                <span className="t-meta">
                  {t("ui.screens-contents.structure-band")} {m.band.low}–{m.band.high}
                </span>
                <span className="t-meta">
                  {t("ui.screens-contents.structure-range")} {m.min}–{m.max}
                </span>
                <span className="t-spacer" />
                <button
                  type="button"
                  className="t-c-linkish"
                  onClick={() => {
                    p.onMetric?.(m.key);
                    p.onView?.("outliers");
                  }}
                >
                  <span className={m.below ? "t-warn" : "t-muted"}>
                    {t("ui.screens-contents.structure-count-below", { count: m.below })}
                  </span>
                  {" · "}
                  <span className={m.above ? "t-warn" : "t-muted"}>
                    {t("ui.screens-contents.structure-count-above", { count: m.above })}
                  </span>
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="t-stack" data-testid="calibration-outliers">
          <div className="t-c-tabscroll">
            <Tabs
              label={t("ui.screens-contents.structure-metric")}
              value={metric ?? ""}
              items={p.metrics.map((m) => ({
                value: m.key,
                label: m.label,
                count: m.above + m.below,
              }))}
              onChange={p.onMetric}
            />
          </div>
          {current ? (
            <div className="t-row t-row--wrap t-c-small">
              <span className="t-meta">
                {t("ui.screens-contents.structure-band")} {current.band.low}–{current.band.high}{" "}
                {current.unit} {t("ui.screens-contents.structure-median-label")} {current.median}
              </span>
            </div>
          ) : null}
          <DataTable
            label={t("ui.screens-contents.structure-outliers")}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => p.onOpenRecord?.(r.id)}
            columns={[
              {
                key: "id",
                label: t("ui.screens-contents.structure-where"),
                render: (r) => <span className="t-mono t-c-small">{r.id}</span>,
              },
              {
                key: "side",
                label: t("ui.screens-contents.structure-side"),
                render: (r) => <span className="t-badge t-badge--warn">{t(SIDE[r.side])}</span>,
              },
              {
                key: "value",
                label: t("ui.screens-contents.structure-value"),
                numeric: true,
                render: (r) => <span className="t-num">{r.value}</span>,
              },
              {
                key: "dist",
                label: t("ui.screens-contents.structure-distance-band"),
                hideOnMobile: true,
                render: (r) => (
                  <span className="t-c-outbar" aria-hidden="true">
                    <span
                      style={{ width: `${Math.min(100, (r.value / (current?.max || 1)) * 100)}%` }}
                    />
                  </span>
                ),
              },
              {
                key: "band",
                label: "Band",
                hideOnMobile: true,
                render: (r) => <span className="t-meta">{r.band}</span>,
              },
            ]}
          />
          {rows.length === 0 ? (
            <p className="t-meta t-c-center">
              {t("ui.screens-contents.structure-no-outliers-metric")}
            </p>
          ) : null}
        </div>
      )}
    </KindFrame>
  );
}
