import type { TextKey } from "../text";
import { useText } from "../text";
import {
  Icon,
  Badge,
  Button,
  SearchField,
  Segment,
  EmptyState,
  Finding,
  Meter,
  Section,
  Metric,
  DataTable,
  Pagination,
  type Column,
  type SortDir,
} from "@facet-tools/ui";

import { Mosaic, Pyramid, Ring, pct, pctText, shareTone } from "./charts";
import type { CapabilityView, DomainView, DriftView, FeatureView, TestMix } from "./model";
import { LIFECYCLE, PathBar } from "./parts";

export type CapabilityPageView = "field" | "table";

export type AnchorFile = { path: string; anchors: number; records: number; roles: string[] };

export type CapabilityPageProps = {
  domain: DomainView;
  domains: DomainView[];
  capability: CapabilityView;
  features: FeatureView[];
  files: AnchorFile[];
  tests: TestMix | null;
  drift: DriftView[];
  teamName?: string;
  view: CapabilityPageView;
  query?: string;
  sort?: { key: string; dir: SortDir };
  mobile?: boolean;
  crumbOpen?: string | null;
  onToggleCrumb?: (key: string) => void;
  /** The open sibling list's search text, when the container holds it. */
  crumbQuery?: string;
  onCrumbQuery?: (query: string) => void;
  /** Esc or a press outside the open sibling list. */
  onCloseCrumb?: () => void;
  onNavigate?: (target: string) => void;
  onOpenDomain?: (id: string) => void;
  onOpenCapability?: (domain: string, capability: string) => void;
  onOpenRecord?: (id: string) => void;
  onView?: (v: CapabilityPageView) => void;
  onQuery?: (q: string) => void;
  onSort?: (key: string) => void;
  /** Page of the sharpness field (1-based), 24 cards per page. */
  page?: number;
  onPage?: (page: number) => void;
  onNewRecord?: () => void;
};

const VIEWS: { value: CapabilityPageView; label: TextKey; icon: "grid" | "table" }[] = [
  { value: "field", label: "ui.screens-frame.capabilitypage-focus-map", icon: "grid" },
  { value: "table", label: "ui.screens-frame.capabilitypage-table", icon: "table" },
];

const matches = (f: FeatureView, q: string) =>
  !q || (f.slug + " " + f.summary).toLowerCase().includes(q.toLowerCase());

export function CapabilityPage(p: CapabilityPageProps) {
  const { domain: d, capability: c, features: fs, query = "" } = p;
  const { t, number: nf } = useText();
  const scen = fs.reduce((a, f) => a + f.scenarios, 0);
  const proven = fs.reduce((a, f) => a + f.proven, 0);
  const share = pct(proven, scen);
  const hits = fs.filter((f) => matches(f, query)).length;
  const empty = fs.length === 0;

  return (
    <div className="t-page t-a-over" data-testid="capability">
      <PathBar
        mobile={p.mobile}
        openKey={p.crumbOpen}
        onToggleSiblings={p.onToggleCrumb}
        query={p.crumbQuery}
        onQuery={p.onCrumbQuery}
        onClose={p.onCloseCrumb}
        crumbs={[
          {
            key: "product",
            label: t("ui.screens-frame.capabilitypage-product"),
            onClick: () => p.onNavigate?.("product"),
          },
          {
            key: d.id,
            label: d.id,
            mono: true,
            onClick: () => p.onOpenDomain?.(d.id),
            siblings: p.domains.map((s) => ({
              key: s.id,
              label: s.title,
              sub: s.id,
              icon: "buildings",
              current: s.id === d.id,
              onSelect: () => p.onOpenDomain?.(s.id),
            })),
          },
          {
            key: c.id,
            label: c.id,
            mono: true,
            siblings: d.capabilities.map((s) => ({
              key: s.id,
              label: s.title,
              sub: `${d.id}/${s.id}`,
              icon: "layers",
              current: s.id === c.id,
              onSelect: () => p.onOpenCapability?.(d.id, s.id),
            })),
          },
        ]}
      />
      <div className="t-a-over__head">
        <Finding
          eyebrow={t("ui.screens-frame.capabilitypage-capability-domain-team-team", {
            domain: d.title,
            team: p.teamName ?? d.team,
          })}
          figure={empty ? "—" : pctText(share, t)}
          tone={empty ? undefined : shareTone(share)}
          sentence={c.title}
          lead={c.purpose}
          aside={
            <span className="t-meta">
              {empty
                ? t("ui.screens-frame.capabilitypage-no-promise-yet")
                : t("ui.screens-frame.capabilitypage-proven-scenarios-scenarios-carry-test", {
                    proven,
                    scenarios: scen,
                  })}
            </span>
          }
        />
        <div className="t-a-over__stats t-stagger">
          <Metric value={fs.length} label="Records" />
          <Metric
            value={empty ? null : proven}
            of={empty ? undefined : scen}
            label={
              empty
                ? t("ui.screens-frame.capabilitypage-scenarios-not-measured")
                : t("ui.screens-frame.capabilitypage-scenarios-named-test")
            }
          />
          <Metric
            value={p.files.length}
            label={t("ui.screens-frame.capabilitypage-anchor-files")}
          />
          <Metric
            value={p.drift.length}
            tone={p.drift.length ? "warn" : "ok"}
            label={t("ui.screens-frame.capabilitypage-drift")}
          />
        </div>
      </div>

      {empty ? (
        <EmptyState
          icon="document"
          title={t("ui.screens-frame.capabilitypage-title-has-no-record-yet", { title: c.title })}
          body={t("ui.screens-frame.capabilitypage-capability-sits-taxonomy-under-domain-records", {
            domain: d.title,
            prefix: `${d.id}/${c.id}`,
          })}
          action={
            <>
              <Button variant="primary" icon="plus" onClick={p.onNewRecord}>
                {t("ui.screens-frame.capabilitypage-create-record")}
              </Button>
              <Button icon="buildings" onClick={() => p.onOpenDomain?.(d.id)}>
                {t("ui.screens-frame.capabilitypage-area")}
              </Button>
            </>
          }
        />
      ) : (
        <div className="t-a-over__grid">
          <div className="t-a-over__main">
            <Section
              title={t("ui.screens-frame.capabilitypage-records")}
              meta={
                query
                  ? t("ui.screens-frame.capabilitypage-hits-total-sharp", {
                      hits,
                      total: fs.length,
                    })
                  : nf(fs.length)
              }
              actions={
                <Segment
                  label={t("ui.screens-frame.capabilitypage-view")}
                  value={p.view}
                  options={VIEWS.map((v) => ({ ...v, label: t(v.label) }))}
                  onChange={p.onView}
                />
              }
            >
              <div className="t-a-cap-search">
                <SearchField
                  label={t("ui.screens-frame.capabilitypage-search-capability")}
                  value={query}
                  placeholder={t("ui.screens-frame.capabilitypage-search-title", {
                    title: c.title,
                  })}
                  onChange={p.onQuery}
                />
              </div>
              {p.view === "field" ? <Field {...p} /> : <Table {...p} />}
            </Section>
            <Section
              title={t("ui.screens-frame.capabilitypage-test-mosaic")}
              meta={t("ui.screens-frame.capabilitypage-one-cell-per-scenario")}
            >
              <div
                className="t-surface t-a-mosaics"
                role="group"
                aria-label={t("ui.screens-frame.capabilitypage-test-mosaic")}
              >
                {fs.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="t-a-mosaics__row"
                    onClick={() => p.onOpenRecord?.(f.id)}
                  >
                    <span className="t-mono t-wrap">{f.slug}</span>
                    <Mosaic
                      cells={
                        f.mosaic ?? Array.from({ length: f.scenarios }, (_, i) => i < f.proven)
                      }
                      label={f.slug}
                      size={10}
                    />
                    <span className="t-meta t-num">
                      {f.proven}/{f.scenarios}
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          </div>
          <aside
            className="t-a-over__side"
            aria-label={t("ui.screens-frame.capabilitypage-capability-glance")}
          >
            <section
              className="t-surface t-pad t-stack"
              style={{ gap: 8 }}
              aria-label={t("ui.screens-frame.capabilitypage-tests-kind")}
            >
              <div className="t-a-panel-head">
                <span className="t-h3">{t("ui.screens-frame.capabilitypage-tests-kind")}</span>
              </div>
              <Pyramid mix={p.tests} />
            </section>
            <section
              className="t-surface t-pad t-stack"
              style={{ gap: 6 }}
              aria-label={t("ui.screens-frame.capabilitypage-anchor-files")}
            >
              <div className="t-a-panel-head">
                <span className="t-h3">{t("ui.screens-frame.capabilitypage-anchor-files")}</span>
                <span className="t-meta">{nf(p.files.length)}</span>
              </div>
              {p.files.slice(0, 10).map((f) => (
                <div key={f.path} className="t-a-file">
                  <Icon name="file" size={14} />
                  <span className="t-mono t-wrap" title={f.path}>
                    {f.path}
                  </span>
                  <span className="t-meta">
                    {f.records}
                    {/** i18n-spacing: joined */}
                    {t("ui.screens-frame.capabilitypage-label")}
                  </span>
                </div>
              ))}
              {p.files.length > 10 ? (
                <Button size="small" variant="quiet" onClick={() => p.onNavigate?.("anchor")}>
                  {t("ui.screens-frame.capabilitypage-all-count-files", { count: p.files.length })}
                </Button>
              ) : null}
            </section>
            <section
              className="t-surface t-pad t-stack"
              style={{ gap: 8 }}
              aria-label={t("ui.screens-frame.capabilitypage-knowledge-gaps")}
            >
              <div className="t-a-panel-head">
                <span className="t-h3">{t("ui.screens-frame.capabilitypage-knowledge-gaps")}</span>
                <span className="t-meta">
                  {t("ui.screens-frame.capabilitypage-count-slots", {
                    count: fs.reduce((a, f) => a + f.knowledgeOpen, 0),
                  })}
                </span>
              </div>
              <KnowledgeBars features={fs} />
            </section>
            <section
              className="t-surface t-pad t-stack"
              style={{ gap: 6 }}
              aria-label={t("ui.screens-frame.capabilitypage-drift")}
            >
              <div className="t-a-panel-head">
                <span className="t-h3">{t("ui.screens-frame.capabilitypage-drift")}</span>
                <span className="t-meta">{nf(p.drift.length)}</span>
              </div>
              {p.drift.length ? (
                p.drift.map((x) => (
                  <div key={x.path + x.record} className="t-a-file">
                    <Icon name="offsetBlocks" size={14} className="t-warn" />
                    <span className="t-mono t-wrap">{x.path}</span>
                    <span className="t-meta">{x.changedAt.slice(5)}</span>
                  </div>
                ))
              ) : (
                <p className="t-a-calm">
                  <Icon name="check" size={16} className="t-ok" />{" "}
                  {t("ui.screens-frame.capabilitypage-no-drift")}
                </p>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

/** Records with 0, 1, … 5 open Knowledge slots. */
function KnowledgeBars({ features }: { features: FeatureView[] }) {
  const { t } = useText();
  const buckets = [0, 1, 2, 3, 4, 5].map(
    (k) => features.filter((f) => f.knowledgeOpen === k).length,
  );
  const max = Math.max(1, ...buckets);
  return (
    <div
      className="t-a-kbars"
      role="list"
      aria-label={t("ui.screens-frame.capabilitypage-records-open-knowledge-slots")}
    >
      {buckets.map((n, k) => (
        <div key={k} role="listitem" className="t-a-kbars__row">
          <span className="t-meta">
            {k === 0
              ? t("ui.screens-frame.capabilitypage-full")
              : t("ui.screens-frame.capabilitypage-count-open", { count: k })}
          </span>
          <Meter
            value={n / max}
            thin
            tone={k === 0 ? "ok" : "warn"}
            label={t("ui.screens-frame.capabilitypage-count-open", { count: k })}
          />
          <span className="t-num t-meta">{n}</span>
        </div>
      ))}
    </div>
  );
}

const FIELD_PAGE = 24;

function Field({
  features,
  query = "",
  page = 1,
  mobile,
  onPage,
  onOpenRecord,
}: CapabilityPageProps) {
  const { t } = useText();
  // Hits come first and stay sharp; the rest recedes behind them.
  const ordered = query
    ? [...features.filter((f) => matches(f, query)), ...features.filter((f) => !matches(f, query))]
    : features;
  const shown = ordered.slice((page - 1) * FIELD_PAGE, page * FIELD_PAGE);
  return (
    <>
      <div
        className="t-a-field"
        role="list"
        aria-label={t("ui.screens-frame.capabilitypage-focus-map")}
      >
        {shown.map((f) => {
          const hit = matches(f, query);
          const p = pct(f.proven, f.scenarios);
          return (
            <div
              key={f.id}
              role="listitem"
              className="t-depth"
              data-depth={query && !hit ? "2" : "0"}
            >
              <button
                type="button"
                className="t-surface t-a-card t-interactive"
                data-testid={`card-${f.slug}`}
                onClick={() => onOpenRecord?.(f.id)}
              >
                <span className="t-row t-row--between">
                  <span className="t-mono t-wrap">{f.slug}</span>
                  {f.lifecycle !== "active" ? (
                    <Badge tone={f.lifecycle === "planned" ? "plan" : "neutral"}>
                      {t(LIFECYCLE[f.lifecycle])}
                    </Badge>
                  ) : null}
                </span>
                <span className="t-muted t-clamp-2 t-a-card__summary">{f.summary}</span>
                <span className="t-row t-row--between">
                  <span className="t-row t-meta" style={{ gap: 10 }}>
                    <span>
                      {t("ui.screens-frame.capabilitypage-count-sc", { count: f.scenarios })}
                    </span>
                    <span>
                      {t("ui.screens-frame.capabilitypage-count-anchors", { count: f.anchors })}
                    </span>
                    {f.drift ? (
                      <span className="t-warn">{t("ui.screens-frame.capabilitypage-drift")}</span>
                    ) : null}
                  </span>
                  <Ring value={p} size={34} label={f.slug}>
                    <span className="t-a-ring__small">{p == null ? "—" : p}</span>
                  </Ring>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {ordered.length > FIELD_PAGE ? (
        <Pagination
          page={page}
          pageSize={FIELD_PAGE}
          total={ordered.length}
          pageSizes={[24]}
          compact={mobile}
          onPage={onPage}
        />
      ) : null}
    </>
  );
}

/** Sort value of a table column; equal values fall back to the slug so the order is stable. */
function sortValue(f: FeatureView, key: string): number | string {
  switch (key) {
    case "scenarios":
      return f.scenarios;
    case "proven":
      return f.scenarios ? f.proven / f.scenarios : -1;
    case "tests":
      return f.tests;
    case "anchors":
      return f.anchors;
    case "knowledge":
      return 5 - f.knowledgeOpen;
    case "drift":
      return f.drift;
    default:
      return f.slug;
  }
}

export function byColumn(key: string, dir: SortDir) {
  return (a: FeatureView, b: FeatureView) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    const r = x < y ? -1 : x > y ? 1 : 0;
    if (r !== 0) return dir === "asc" ? r : -r;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  };
}

function Table({ features, query = "", sort, onSort, onOpenRecord }: CapabilityPageProps) {
  const { t, number: nf } = useText();
  const rows = features.filter((f) => matches(f, query));
  const ordered = sort ? [...rows].sort(byColumn(sort.key, sort.dir)) : rows;
  const cols: Column<FeatureView>[] = [
    {
      key: "slug",
      label: "Record",
      sortable: true,
      render: (f) => <span className="t-mono">{f.slug}</span>,
    },
    {
      key: "scenarios",
      label: t("ui.screens-frame.capabilitypage-scenarios"),
      numeric: true,
      sortable: true,
      render: (f) => nf(f.scenarios),
    },
    {
      key: "proven",
      label: t("ui.screens-frame.capabilitypage-test-named"),
      sortable: true,
      render: (f) => (
        <Mosaic
          cells={f.mosaic ?? Array.from({ length: f.scenarios }, (_, i) => i < f.proven)}
          label={f.slug}
          size={7}
        />
      ),
    },
    {
      key: "tests",
      label: "Tests",
      numeric: true,
      sortable: true,
      hideOnMobile: true,
      render: (f) => nf(f.tests),
    },
    {
      key: "anchors",
      label: t("ui.screens-frame.capabilitypage-anchors"),
      numeric: true,
      sortable: true,
      hideOnMobile: true,
      render: (f) => nf(f.anchors),
    },
    {
      key: "knowledge",
      label: t("ui.screens-frame.capabilitypage-knowledge"),
      numeric: true,
      sortable: true,
      hideOnMobile: true,
      render: (f) => `${5 - f.knowledgeOpen}/5`,
    },
    {
      key: "drift",
      label: t("ui.screens-frame.capabilitypage-drift"),
      numeric: true,
      sortable: true,
      render: (f) =>
        f.drift ? <Badge tone="warn">{f.drift}</Badge> : <span className="t-muted">—</span>,
    },
  ];
  return (
    <DataTable
      label={t("ui.screens-frame.capabilitypage-records-capability")}
      columns={cols}
      rows={ordered}
      rowKey={(f) => f.id}
      sort={sort}
      onSort={onSort}
      onRowClick={(f) => onOpenRecord?.(f.id)}
      dense
    />
  );
}
