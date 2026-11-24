import { useText } from "../text";
import {
  Icon,
  Badge,
  Button,
  EmptyState,
  Finding,
  ListRow,
  Meter,
  Section,
  Metric,
} from "@facet-tools/ui";

import { Mosaic, Ring, pct, pctText, shareTone } from "./charts";
import type { AdrView, CommitView, DomainView, DriftView, FeatureView } from "./model";
import { CommitList, OpenRecordList, PathBar } from "./parts";

export type DomainLinkView = { domain: string; title: string; count: number; examples: string[] };

export type DomainPageProps = {
  domain: DomainView;
  /** All domains, for the sibling caret in the path. */
  domains: DomainView[];
  features: FeatureView[];
  links: { incoming: DomainLinkView[]; outgoing: DomainLinkView[] };
  drift: DriftView[];
  adrs: AdrView[];
  /** `null` = history not read; `[]` = read, no commits. */
  recent: CommitView[] | null;
  teamName?: string;
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
  onOpenCapability?: (capability: string) => void;
  onOpenRecord?: (id: string) => void;
  onNewRecord?: (capability?: string) => void;
};

export function DomainPage(p: DomainPageProps) {
  const { domain: d, features: fs } = p;
  const { t, plural, number: nf } = useText();
  const scen = fs.reduce((a, f) => a + f.scenarios, 0);
  const proven = fs.reduce((a, f) => a + f.proven, 0);
  const share = pct(proven, scen);
  const anchors = fs.reduce((a, f) => a + f.anchors, 0);
  const know = fs.reduce((a, f) => a + f.knowledgeOpen, 0);
  const empty = fs.length === 0;

  return (
    <div className="t-page t-a-over" data-testid="domain">
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
            label: t("ui.screens-frame.domainpage-product"),
            onClick: () => p.onNavigate?.("product"),
          },
          {
            key: d.id,
            label: d.id,
            mono: true,
            siblings: p.domains.map((s) => ({
              key: s.id,
              label: s.title,
              sub: s.id,
              icon: "buildings",
              current: s.id === d.id,
              onSelect: () => p.onOpenDomain?.(s.id),
            })),
          },
        ]}
      />
      <div className="t-a-over__head">
        <Finding
          eyebrow={t("ui.screens-frame.domainpage-area-cls-team-team", {
            cls:
              d.cls === "core"
                ? t("ui.screens-frame.domainpage-core")
                : t("ui.screens-frame.domainpage-supporting"),
            team: p.teamName ?? d.team,
          })}
          figure={empty ? "—" : pctText(share, t)}
          tone={empty ? undefined : shareTone(share)}
          sentence={d.title}
          lead={d.purpose}
          aside={
            <span className="t-meta">
              {empty
                ? t("ui.screens-frame.domainpage-no-promise-yet")
                : t("ui.screens-frame.domainpage-proven-scenarios-scenarios-carry-test", {
                    proven,
                    scenarios: scen,
                  })}
            </span>
          }
        />
        <div className="t-a-over__stats t-stagger">
          <Metric value={fs.length} label="Records" />
          <Metric
            value={d.capabilities.length}
            label={t("ui.screens-frame.domainpage-capabilities")}
          />
          <Metric
            value={empty ? null : proven}
            of={empty ? undefined : scen}
            label={
              empty
                ? t("ui.screens-frame.domainpage-scenarios-not-measured")
                : t("ui.screens-frame.domainpage-scenarios-named-test")
            }
          />
          <Metric value={anchors} label={t("ui.screens-frame.domainpage-anchors")} />
          <Metric
            value={p.drift.length}
            tone={p.drift.length ? "warn" : "ok"}
            label={t("ui.screens-frame.domainpage-files-drift")}
          />
          <Metric
            value={know}
            tone={know ? "warn" : undefined}
            label={t("ui.screens-frame.domainpage-knowledge-slots-open")}
          />
        </div>
      </div>

      {empty ? (
        <EmptyState
          icon="document"
          title={t("ui.screens-frame.domainpage-title-has-no-records-yet", { title: d.title })}
          body={t("ui.screens-frame.domainpage-taxonomy-names-count-capabilities-none-has", {
            count: d.capabilities.length,
          })}
          action={
            <Button variant="primary" icon="plus" onClick={() => p.onNewRecord?.()}>
              {t("ui.screens-frame.domainpage-create-first-record")}
            </Button>
          }
        />
      ) : null}

      <div className="t-a-over__grid">
        <div className="t-a-over__main">
          <Section
            title={t("ui.screens-frame.domainpage-capabilities")}
            meta={t("ui.screens-frame.domainpage-count-share-test-named", {
              count: d.capabilities.length,
            })}
          >
            <div
              className="t-a-tiles t-stagger"
              role="group"
              aria-label={t("ui.screens-frame.domainpage-capabilities")}
            >
              {d.capabilities.map((c) => {
                const cf = fs.filter((f) => f.capability === c.id);
                const cs = cf.reduce((a, f) => a + f.scenarios, 0);
                const cp = cf.reduce((a, f) => a + f.proven, 0);
                const drift = cf.reduce((a, f) => a + f.drift, 0);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="t-surface t-a-tile t-interactive"
                    data-empty={cf.length === 0 || undefined}
                    data-testid={`cap-${c.id}`}
                    onClick={() => p.onOpenCapability?.(c.id)}
                  >
                    <span className="t-row t-row--between" style={{ alignItems: "flex-start" }}>
                      <span className="t-stack" style={{ gap: 2, minWidth: 0 }}>
                        <span className="t-h3">{c.title}</span>
                        <span className="t-meta">{c.id}</span>
                      </span>
                      <Ring value={pct(cp, cs)} size={48} label={c.title} />
                    </span>
                    <span className="t-muted t-clamp-2 t-a-tile__purpose">{c.purpose}</span>
                    {cf.length ? (
                      <>
                        <Mosaic
                          cells={cf.map((f) => f.proven === f.scenarios && f.scenarios > 0)}
                          label={t("ui.screens-frame.domainpage-title-every-promise-test-named", {
                            title: c.title,
                          })}
                          size={8}
                        />
                        <span className="t-row t-meta" style={{ gap: 10 }}>
                          <span>
                            {plural("ui.screens-frame.domainpage-count-records", cf.length)}
                          </span>
                          <span>
                            {t("ui.screens-frame.domainpage-count-open", { count: cs - cp })}
                          </span>
                          {drift ? (
                            <span className="t-warn">
                              <Icon name="offsetBlocks" size={12} /> {nf(drift)}
                            </span>
                          ) : null}
                        </span>
                      </>
                    ) : (
                      <span className="t-meta">
                        {t("ui.screens-frame.domainpage-no-record-yet")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Section>

          {!empty ? (
            <Section
              title={t("ui.screens-frame.domainpage-dependencies")}
              meta={t("ui.screens-frame.domainpage-records-name-records-other-areas")}
            >
              <DependencyFlow domain={d} links={p.links} onOpenDomain={p.onOpenDomain} />
            </Section>
          ) : null}

          {!empty ? (
            <Section
              title={t("ui.screens-frame.domainpage-open-promises")}
              meta={t("ui.screens-frame.domainpage-count-scenarios-no-test-names", {
                count: scen - proven,
              })}
            >
              <OpenRecordList features={fs} limit={6} onOpenRecord={p.onOpenRecord} />
            </Section>
          ) : null}
        </div>

        <aside className="t-a-over__side" aria-label={t("ui.screens-frame.domainpage-area-glance")}>
          <section
            className="t-surface t-pad t-stack"
            style={{ gap: 8 }}
            aria-label={t("ui.screens-frame.domainpage-drift-area")}
          >
            <div className="t-a-panel-head">
              <span className="t-h3">{t("ui.screens-frame.domainpage-drift")}</span>
              <span className="t-meta">{nf(p.drift.length)}</span>
            </div>
            {p.drift.length ? (
              p.drift.slice(0, 8).map((x) => (
                <div key={x.path + x.record} className="t-a-drift">
                  <Icon name="file" size={14} />
                  <span className="t-stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="t-mono t-wrap">{x.path}</span>
                    <button
                      type="button"
                      className="t-a-link t-mono t-wrap"
                      onClick={() => p.onOpenRecord?.(x.record)}
                    >
                      {x.record.split("/").slice(1).join("/")}
                    </button>
                  </span>
                  <span className="t-meta">{x.changedAt.slice(5)}</span>
                </div>
              ))
            ) : (
              <p className="t-a-calm" data-testid="no-drift">
                <Icon name="check" size={16} className="t-ok" />{" "}
                {t("ui.screens-frame.domainpage-no-drift-area")}
              </p>
            )}
          </section>
          <section
            className="t-surface t-pad t-stack"
            style={{ gap: 4 }}
            aria-label={t("ui.screens-frame.domainpage-decisions")}
          >
            <div className="t-a-panel-head">
              <span className="t-h3">{t("ui.screens-frame.domainpage-decisions")}</span>
              <span className="t-meta">{nf(p.adrs.length)}</span>
            </div>
            {p.adrs.length ? (
              p.adrs.map((a) => (
                <ListRow
                  key={a.file}
                  lead={<Icon name="scales" size={14} />}
                  title={a.title}
                  sub={t("ui.screens-frame.domainpage-status-date-count-records-here", {
                    status: a.status,
                    date: a.date,
                    count: a.refs.filter((r) => r.startsWith(d.id + "/")).length,
                  })}
                  onClick={() => p.onNavigate?.(`adr/${a.file}`)}
                />
              ))
            ) : (
              <p className="t-muted">
                {t("ui.screens-frame.domainpage-no-decision-names-record-area")}
              </p>
            )}
          </section>
          <section
            className="t-surface t-pad t-stack"
            style={{ gap: 8 }}
            aria-label={t("ui.screens-frame.domainpage-recently-changed")}
          >
            <div className="t-a-panel-head">
              <span className="t-h3">{t("ui.screens-frame.domainpage-recently-changed")}</span>
            </div>
            <CommitList commits={p.recent} limit={5} onOpenRecord={p.onOpenRecord} />
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Incoming domains on the left, this domain in the middle, outgoing on the right; width = count. */
function DependencyFlow({
  domain,
  links,
  onOpenDomain,
}: {
  domain: DomainView;
  links: DomainPageProps["links"];
  onOpenDomain?: (id: string) => void;
}) {
  const { t } = useText();
  const W = 640;
  const rowH = 34;
  const n = Math.max(links.incoming.length, links.outgoing.length, 1);
  const H = n * rowH + 16;
  const max = Math.max(
    1,
    ...links.incoming.map((l) => l.count),
    ...links.outgoing.map((l) => l.count),
  );
  const cy = H / 2;
  const y = (i: number, len: number) => cy - ((len - 1) * rowH) / 2 + i * rowH;
  const stroke = (c: number) => 1.5 + (c / max) * 7;
  if (!links.incoming.length && !links.outgoing.length) {
    return (
      <p className="t-muted">
        {t("ui.screens-frame.domainpage-no-record-area-names-another-area")}
      </p>
    );
  }
  return (
    <div className="t-surface t-pad t-a-flow">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="t-a-flow__svg"
        role="img"
        aria-label={t("ui.screens-frame.domainpage-dependencies-title", { title: domain.title })}
      >
        {links.incoming.map((l, i) => (
          <path
            key={"i" + l.domain}
            d={`M150,${y(i, links.incoming.length)} C230,${y(i, links.incoming.length)} 230,${cy} 262,${cy}`}
            className="t-a-flow__edge t-a-flow__edge--in"
            style={{ strokeWidth: stroke(l.count) }}
          />
        ))}
        {links.outgoing.map((l, i) => (
          <path
            key={"o" + l.domain}
            d={`M378,${cy} C410,${cy} 410,${y(i, links.outgoing.length)} 490,${y(i, links.outgoing.length)}`}
            className="t-a-flow__edge"
            style={{ strokeWidth: stroke(l.count) }}
          />
        ))}
        <rect x="262" y={cy - 18} width="116" height="36" rx="10" className="t-a-flow__self" />
        <text x="320" y={cy + 5} textAnchor="middle" className="t-a-flow__self-label">
          {domain.title}
        </text>
        {links.incoming.map((l, i) => (
          <text
            key={"it" + l.domain}
            x="144"
            y={y(i, links.incoming.length) + 4}
            textAnchor="end"
            className="t-a-flow__label"
          >
            {l.title} · {l.count}
          </text>
        ))}
        {links.outgoing.map((l, i) => (
          <text
            key={"ot" + l.domain}
            x="496"
            y={y(i, links.outgoing.length) + 4}
            className="t-a-flow__label"
          >
            {l.title} · {l.count}
          </text>
        ))}
      </svg>
      <div className="t-a-flow__cols">
        <div className="t-stack" style={{ gap: 4 }}>
          <span className="t-label">
            {t("ui.screens-frame.domainpage-use-area-count", {
              count: links.incoming.reduce((a, l) => a + l.count, 0),
            })}
          </span>
          {links.incoming.map((l) => (
            <button
              key={l.domain}
              type="button"
              className="t-a-flow__row"
              onClick={() => onOpenDomain?.(l.domain)}
            >
              <Badge plain>{l.title}</Badge>
              <span className="t-meta t-ellipsis">{l.examples[0]}</span>
              <Meter
                value={l.count / max}
                thin
                tone="signal"
                label={t("ui.screens-frame.domainpage-title-incoming", { title: l.title })}
              />
            </button>
          ))}
        </div>
        <div className="t-stack" style={{ gap: 4 }}>
          <span className="t-label">
            {t("ui.screens-frame.domainpage-needs-count", {
              count: links.outgoing.reduce((a, l) => a + l.count, 0),
            })}
          </span>
          {links.outgoing.map((l) => (
            <button
              key={l.domain}
              type="button"
              className="t-a-flow__row"
              onClick={() => onOpenDomain?.(l.domain)}
            >
              <Badge plain>{l.title}</Badge>
              <span className="t-meta t-ellipsis">{l.examples[0]}</span>
              <Meter
                value={l.count / max}
                thin
                tone="signal"
                label={t("ui.screens-frame.domainpage-title-outgoing", { title: l.title })}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
