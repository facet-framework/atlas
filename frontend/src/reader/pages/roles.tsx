/** The Overview's role sections Atlas draws itself, below the key figures:
 * what each role reads beyond the facet-ui role body. Every list is paged
 * with the one facet-ui pager, and every row opens what it names. */

import { Badge, Button, DataTable, ListRow, Pagination, Section, sortRows } from "@facet-tools/ui";

import { useSurfaceText as useText } from "@/screens/text";
import { short } from "@/derive";
import { records } from "@/screens";
import { sharePercent } from "@/share";
import type { PageContext } from "../context";
import {
  declaredDefects,
  driftComparison,
  firstKnowledgeGap,
  newestRecords,
  openingsOf,
  pillarsOf,
  recordStates,
  scanExcerpt,
  stampLabel,
  teamPortfolios,
  type DriftBaseline,
  type Pillar,
  type RecordState,
  type ReferenceChange,
} from "../derive-roles";
import { href } from "../route";
import { Bench } from "./bench";
import { AnchorCoverage } from "./coverage";

const OPENINGS_PAGE = 5;
const DEFECTS_PAGE = 5;
const NEWEST_PAGE = 5;
const LOST_PAGE = 6;
const TEAMS_PAGE = 4;
const TEAM_ROWS = 6;
const REGISTER_PAGE = 25;

type RoleState = {
  openings: number;
  defects: number;
  newest: number;
  lost: number;
  teams: number;
  /** Page of each team's own list, by team key; a tile pages only itself. */
  team: Record<string, number>;
  register: number;
  registerSort: { key: keyof RecordState; dir: "asc" | "desc" };
};

const INITIAL: RoleState = {
  openings: 1,
  defects: 1,
  newest: 1,
  lost: 1,
  teams: 1,
  team: {},
  register: 1,
  registerSort: { key: "id", dir: "asc" },
};

type Props = { ctx: PageContext; s: RoleState; set: (patch: Partial<RoleState>) => void };

const record = (id: string, section?: string) => href({ area: "record", id, section });

const slice = <R,>(rows: readonly R[], page: number, size: number) =>
  rows.slice((page - 1) * size, page * size);

/** A record's name for readers without the schema: its slug in words. */
function featureName(id: string): string {
  const words = short(id).split("-").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Pager({
  ctx,
  page,
  size,
  total,
  onPage,
}: {
  ctx: PageContext;
  page: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= size) return null;
  return (
    <Pagination
      page={page}
      pageSize={size}
      total={total}
      pageSizes={[size]}
      compact={ctx.mobile}
      onPage={onPage}
    />
  );
}

/** The sections for `ctx.role`; nothing for a role without its own. `lead`
 * stands below the key figures, where a newcomer and a reviewer look for
 * where to start; `tail` stands below the role's own body. */

export function RoleSections({ ctx, place }: { ctx: PageContext; place: "lead" | "tail" }) {
  const [s, set] = ctx.slot<RoleState>("overview-roles", INITIAL);
  const p = { ctx, s, set };
  if (place === "lead")
    return ctx.role === "newcomer" ? (
      <>
        <PillarsSection ctx={ctx} />
        <Openings {...p} />
      </>
    ) : ctx.role === "review" ? (
      <Openings {...p} />
    ) : null;
  switch (ctx.role) {
    case "review":
      return <Bench ctx={ctx} />;
    case "leadership":
      return (
        <>
          <Defects {...p} />
          <Newest {...p} />
        </>
      );
    case "dev":
      return (
        <>
          <Comparison {...p} />
          <AnchorCoverage ctx={ctx} />
        </>
      );
    case "owner":
      return <Portfolio {...p} />;
    case "agent":
      return <Register {...p} />;
    case "author":
      return <Template ctx={ctx} />;
    default:
      return null;
  }
}

/** Pillars ------------------------------------------------------------------------------- */

/** What the product rests on, from the dependency graph, numbered by weight and
 * standing above the areas: the first thing to read. Each opens its capability.
 * Where nobody declared a dependency the section says it was not measured. */

// @facet: registry/coverage/core-capabilities
// @facet-role: primary
function PillarsSection({ ctx }: { ctx: PageContext }) {
  const { t } = ctx;
  const p = pillarsOf(ctx.derived.M);
  const title = t("ui.reader-pages.roles-what-product-rests");
  if (!p.measured)
    return (
      <Section title={title}>
        <p className="t-muted" data-testid="overview-pillars-unmeasured">
          {`— · ${t("ui.reader-pages.roles-not-measured-no-record-names-dependency")}`}
        </p>
      </Section>
    );
  const list: Pillar[] = p.pillars.length ? p.pillars : p.leaning;
  const capTitle = (id: string) => {
    const [d, c] = id.split("/");
    return ctx.domains.find((x) => x.id === d)?.capabilities.find((x) => x.id === c)?.title ?? id;
  };
  return (
    <Section
      title={title}
      meta={t("ui.reader-pages.roles-count-dependencies-between-capabilities", { count: p.edges })}
    >
      {p.pillars.length ? null : (
        <p className="t-muted" data-testid="overview-pillars-leaning">
          {t("ui.reader-pages.roles-no-capability-carries-tenth-dependencies-most")}
        </p>
      )}
      <ol className="t-surface t-a-list" aria-label={title} data-testid="overview-pillars">
        {list.map((x, i) => {
          const [domain, capability] = x.id.split("/");
          return (
            <li key={x.id}>
              <ListRow
                lead={<span className="t-mono t-meta">{i + 1}</span>}
                title={<span className="t-wrap">{capTitle(x.id)}</span>}
                sub={
                  <span className="t-wrap">
                    <span className="t-mono">{x.id}</span>
                    {" · "}
                    {t("ui.reader-pages.roles-count-dependencies-elsewhere-share", {
                      count: x.incoming,
                      share: sharePercent(x.incoming, p.edges) ?? 0,
                    })}
                    {" · "}
                    {t("ui.reader-pages.roles-count-records", { count: x.records })}
                  </span>
                }
                onClick={() => ctx.go(href({ area: "capability", domain, capability }))}
              />
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** First contributions ----------------------------------------------------------------- */

/** Promises whose record says what would prove them: the first thing somebody
 * new could do. The ones without a brief are counted, not listed. */

// @facet: registry/perspectives/contribution-list
// @facet-role: primary
function Openings({ ctx, s, set }: Props) {
  const { t } = ctx;
  const { openings, undescribed } = openingsOf(ctx.derived.M);
  if (!openings.length && !undescribed) return null;
  const page = slice(openings, s.openings, OPENINGS_PAGE);
  return (
    <Section
      title={t("ui.reader-pages.roles-first-contributions")}
      meta={t("ui.reader-pages.roles-count-described-undescribed-without-brief", {
        count: openings.length,
        undescribed,
      })}
    >
      {openings.length ? (
        <>
          <p className="t-muted">{t("ui.reader-pages.roles-test-names-one-these-promises-good")}</p>
          <ol
            className="t-surface t-a-list"
            aria-label={t("ui.reader-pages.roles-first-contributions")}
            data-testid="overview-openings"
          >
            {page.map((o) => (
              <li
                key={`${o.record}#${o.scenario}`}
                className="t-pad t-stack"
                style={{ gap: 6 }}
                data-testid="overview-opening"
              >
                <span className="t-meta t-mono t-wrap">{o.capability}</span>
                <span className="t-h3 t-wrap">{o.then || o.scenario}</span>
                <span className="t-wrap">
                  <span className="t-label">{t("ui.reader-pages.roles-missing")}</span> {o.brief}
                </span>
                <span className="t-row t-row--wrap" style={{ gap: 12 }}>
                  <Button
                    size="small"
                    iconAfter="forward"
                    onClick={() => ctx.go(record(o.record, o.scenario))}
                  >
                    {t("ui.reader-pages.roles-open-promise")}
                  </Button>
                  <button
                    type="button"
                    className="t-a-link t-mono t-wrap"
                    onClick={() => ctx.go(record(o.record))}
                  >
                    {o.record}
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <Pager
            ctx={ctx}
            page={s.openings}
            size={OPENINGS_PAGE}
            total={openings.length}
            onPage={(openings) => set({ openings })}
          />
        </>
      ) : (
        <p className="t-muted" data-testid="overview-openings-none">
          {t("ui.reader-pages.roles-no-open-promise-says-what-test")}
        </p>
      )}
    </Section>
  );
}

/** Leadership ---------------------------------------------------------------------------- */

/** The defects the records declare, in their own words, and the newest
 * features by creation date. No section where there is nothing to list. */

// @facet: registry/perspectives/leadership-overview
// @facet-role: primary
function Defects({ ctx, s, set }: Props) {
  const { t } = ctx;
  const defects = declaredDefects(ctx.derived.M);
  if (!defects.length) return null;
  return (
    <Section
      title={t("ui.reader-pages.roles-known-defects-product")}
      meta={t("ui.reader-pages.roles-count-entries", { count: defects.length })}
    >
      <div
        className="t-surface t-a-list"
        role="list"
        aria-label={t("ui.reader-pages.roles-known-defects-product")}
        data-testid="overview-leadership-defects"
      >
        {slice(defects, s.defects, DEFECTS_PAGE).map((d) => {
          // Each sentence only where the record says it; nothing is filled in.
          const words = [
            d.reason,
            d.confirmedBy ? t("ui.reader-pages.roles-confirmed-who", { who: d.confirmedBy }) : "",
            d.trackedAs ? t("ui.reader-pages.roles-tracked-ref", { ref: d.trackedAs }) : "",
          ].filter(Boolean);
          return (
            <div key={`${d.record}#${d.scenario}`} role="listitem">
              <ListRow
                title={
                  <span className="t-wrap">{`${featureName(d.record)}: ${d.then || d.scenario}`}</span>
                }
                sub={
                  <span className="t-wrap">
                    {words.length ? words.join(" ") : t("ui.reader-pages.roles-no-further-details")}
                  </span>
                }
                onClick={() => ctx.go(record(d.record, d.scenario))}
              />
            </div>
          );
        })}
      </div>
      <Pager
        ctx={ctx}
        page={s.defects}
        size={DEFECTS_PAGE}
        total={defects.length}
        onPage={(defects) => set({ defects })}
      />
    </Section>
  );
}

function Newest({ ctx, s, set }: Props) {
  const { t } = ctx;
  const newest = newestRecords(ctx.features);
  if (!newest.length) return null;
  return (
    <Section
      title={t("ui.reader-pages.roles-newly-created")}
      meta={t("ui.reader-pages.roles-count-features", { count: newest.length })}
    >
      <div
        className="t-surface t-a-list"
        role="list"
        aria-label={t("ui.reader-pages.roles-newly-created")}
        data-testid="overview-leadership-newest"
      >
        {slice(newest, s.newest, NEWEST_PAGE).map((f) => (
          <div key={f.id} role="listitem">
            <ListRow
              title={featureName(f.id)}
              sub={t("ui.reader-pages.roles-created-date", { date: f.created })}
              onClick={() => ctx.go(record(f.id))}
            />
          </div>
        ))}
      </div>
      <Pager
        ctx={ctx}
        page={s.newest}
        size={NEWEST_PAGE}
        total={newest.length}
        onPage={(newest) => set({ newest })}
      />
    </Section>
  );
}

/** Developer ----------------------------------------------------------------------------- */

function baselineLabel(b: DriftBaseline, t: PageContext["t"]): string {
  const commit = (b.commit ?? "").slice(0, 12);
  if (b.status && b.status !== "ok")
    return t("ui.reader-pages.roles-drift-could-not-determined-no-state");
  if (b.kind === "accepted")
    return t("ui.reader-pages.roles-compared-last-reviewed-state-commit-outcome", {
      commit,
      outcome: b.outcome || "—",
      at: stampLabel(b.acceptedAt),
    });
  if (b.kind === "explicit")
    return t("ui.reader-pages.roles-compared-ref-commit", { ref: b.ref || "—", commit });
  return t("ui.reader-pages.roles-compared-head-commit-no-review-recorded", {
    commit: commit || "—",
  });
}

function lostLabel(r: ReferenceChange, t: PageContext["t"]): string {
  const what =
    r.kind === "deleted"
      ? t("ui.reader-pages.roles-file-deleted")
      : t("ui.reader-pages.roles-anchor-removed");
  const own =
    r.evidence === "private-sidecar" ? ` · ${t("ui.reader-pages.roles-private-anchor")}` : "";
  return `${what}${own} · ${t("ui.reader-pages.roles-count-anchors-remain", { count: r.surviving })}`;
}

/** The commands that make the developer's comparison on the command line. */
const COMMANDS = [
  ["facet drift", "ui.reader-pages.roles-same-comparison"],
  ["facet lint", "ui.reader-pages.roles-schema-anchors-required-fields"],
  ["git commit", "ui.reader-pages.roles-update-record-same-commit"],
] as const;

/** What the drift list was compared against, the references lost since, and
 * the three commands that make the same comparison outside the reader. */

// @facet: registry/perspectives/developer-workbench
// @facet-role: primary
function Comparison({ ctx, s, set }: Props) {
  const { t } = ctx;
  const c = driftComparison(ctx.model);
  return (
    <Section title={t("ui.reader-pages.roles-comparison")}>
      {c.baselines.length ? (
        <div
          className="t-surface t-pad t-stack"
          style={{ gap: 6 }}
          data-testid="overview-dev-baseline"
        >
          {c.baselines.map((b) => (
            <span key={b.repository ?? ""} className="t-wrap">
              {b.repository ? <span className="t-mono">{b.repository} · </span> : null}
              {baselineLabel(b.baseline, t)}
            </span>
          ))}
        </div>
      ) : null}
      {c.lost.length ? (
        <>
          <div
            className="t-surface t-a-list"
            role="list"
            aria-label={t("ui.reader-pages.roles-lost-references")}
            data-testid="overview-dev-lost"
          >
            {slice(c.lost, s.lost, LOST_PAGE).map((r) => (
              <div key={`${r.id}:${r.path}:${r.kind}`} role="listitem">
                <ListRow
                  title={<span className="t-mono t-wrap">{r.path}</span>}
                  sub={<span className="t-wrap">{`${r.id} · ${lostLabel(r, t)}`}</span>}
                  onClick={() => ctx.go(record(r.id))}
                />
              </div>
            ))}
          </div>
          <Pager
            ctx={ctx}
            page={s.lost}
            size={LOST_PAGE}
            total={c.lost.length}
            onPage={(lost) => set({ lost })}
          />
        </>
      ) : null}
      <div className="t-stack" style={{ gap: 6 }}>
        <span className="t-label">{t("ui.reader-pages.roles-command-line")}</span>
        <dl
          className="t-surface t-pad t-stack"
          style={{ gap: 6, margin: 0 }}
          data-testid="overview-dev-commands"
        >
          {COMMANDS.map(([command, key]) => (
            <div key={command} className="t-row t-row--wrap" style={{ gap: 12 }}>
              <dt className="t-mono">{command}</dt>
              <dd className="t-muted" style={{ margin: 0 }}>
                {t(key)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

/** Ownership ----------------------------------------------------------------------------- */

/** Every feature in its team's group, the most depended-on first; drift is
 * marked where it is, the calm features carry no mark. */

// @facet: registry/perspectives/ownership-portfolio
// @facet-role: primary
function Portfolio({ ctx, s, set }: Props) {
  const { t } = ctx;
  const teams = teamPortfolios(ctx.derived.M);
  if (!teams.length) return null;
  // One sentence: features in teams, how many wait for their record, how many are only announced.
  const drifted = teams.reduce((n, x) => n + x.drifted, 0);
  const announced = ctx.derived.M.filter((f) => f.life === "planned").length;
  const sum = [
    t("ui.reader-pages.roles-features-features-teams-teams", {
      features: ctx.derived.M.length,
      teams: teams.filter((x) => x.team).length,
    }),
    ctx.model.scan.drift === undefined
      ? t("ui.reader-pages.roles-drift-not-measured")
      : drifted
        ? t("ui.reader-pages.roles-count-wait-their-record", { count: drifted })
        : t("ui.reader-pages.roles-none-waits-its-record"),
    announced ? t("ui.reader-pages.roles-count-announced-without-code", { count: announced }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Section
      title={t("ui.reader-pages.roles-portfolio-team")}
      meta={<span data-testid="overview-owner-portfolio-sum">{sum}</span>}
    >
      <div className="t-stack" style={{ gap: 12 }} data-testid="overview-owner-portfolio">
        {slice(teams, s.teams, TEAMS_PAGE).map((team) => {
          const key = team.team ?? "";
          const name = team.team ?? t("ui.reader-pages.roles-no-team");
          const page = s.team[key] ?? 1;
          return (
            <div
              key={key}
              role="group"
              aria-label={name}
              className="t-surface t-stack"
              data-testid="overview-owner-team"
            >
              <div className="t-pad t-row t-row--between t-row--wrap" style={{ gap: 8 }}>
                <span className="t-h3">{name}</span>
                <span className="t-meta">
                  {[
                    t("ui.reader-pages.roles-count-features-proven-claims-promises-test", {
                      count: team.features.length,
                      proven: team.proven,
                      claims: team.claims,
                    }),
                    team.asking
                      ? t("ui.reader-pages.roles-count-open-questions", { count: team.asking })
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <div className="t-a-list" role="list" aria-label={name}>
                {slice(team.features, page, TEAM_ROWS).map((f) => (
                  <div key={f.id} role="listitem">
                    <ListRow
                      title={<span className="t-mono t-wrap">{f.id}</span>}
                      sub={[
                        t("ui.reader-pages.roles-count-depend", { count: f.dependents }),
                        f.knowledgeOpen
                          ? t("ui.reader-pages.roles-count-open-questions-text", {
                              count: f.knowledgeOpen,
                            })
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      trail={
                        f.drift ? (
                          <Badge tone="warn">
                            {t("ui.reader-pages.roles-drift-count", { count: f.drift })}
                          </Badge>
                        ) : undefined
                      }
                      onClick={() => ctx.go(record(f.id))}
                    />
                  </div>
                ))}
              </div>
              <Pager
                ctx={ctx}
                page={page}
                size={TEAM_ROWS}
                total={team.features.length}
                onPage={(n) => set({ team: { ...s.team, [key]: n } })}
              />
            </div>
          );
        })}
      </div>
      <Pager
        ctx={ctx}
        page={s.teams}
        size={TEAMS_PAGE}
        total={teams.length}
        onPage={(n) => set({ teams: n })}
      />
    </Section>
  );
}

/** Agent --------------------------------------------------------------------------------- */

/** Every record's state as a sortable register, and the scan excerpt raw, to
 * copy rather than to read. */

// @facet: registry/perspectives/agent-raw-output
// @facet-role: primary
function Register({ ctx, s, set }: Props) {
  const { t } = ctx;
  const states = recordStates(ctx.derived.M);
  const sort = s.registerSort;
  const sorted = sortRows(states, (r) => r[sort.key], sort.dir);
  const json = JSON.stringify(scanExcerpt(ctx.derived), null, 2);
  return (
    <>
      <Section
        title={t("ui.reader-pages.roles-register")}
        meta={`${t("ui.reader-pages.roles-count-records", { count: states.length })} · ${t(
          "ui.reader-pages.roles-id-lifecycle-proves-anchors-drift",
        )}`}
      >
        <div data-testid="overview-agent-register">
          <DataTable<RecordState>
            label={t("ui.reader-pages.roles-register")}
            dense
            rows={slice(sorted, s.register, REGISTER_PAGE)}
            rowKey={(r) => r.id}
            sort={sort}
            onSort={(key) =>
              set({
                registerSort: {
                  key: key as keyof RecordState,
                  dir: sort.key === key && sort.dir === "asc" ? "desc" : "asc",
                },
                register: 1,
              })
            }
            onRowClick={(r) => ctx.go(record(r.id))}
            columns={[
              {
                key: "id",
                label: "id",
                sortable: true,
                render: (r) => <span className="t-mono t-wrap">{r.id}</span>,
              },
              {
                key: "lifecycle",
                label: "lifecycle",
                sortable: true,
                render: (r) => <span className="t-mono">{r.lifecycle}</span>,
              },
              {
                key: "proven",
                label: "proves",
                numeric: true,
                sortable: true,
                render: (r) => <span className="t-mono">{`${r.proven}/${r.claims}`}</span>,
              },
              {
                key: "anchors",
                label: "anchors",
                numeric: true,
                sortable: true,
                render: (r) => <span className="t-mono">{r.anchors}</span>,
              },
              {
                key: "drift",
                label: "drift",
                numeric: true,
                sortable: true,
                render: (r) => (
                  <span className={r.drift ? "t-mono t-warn" : "t-mono"}>{r.drift}</span>
                ),
              },
            ]}
          />
        </div>
        <Pager
          ctx={ctx}
          page={s.register}
          size={REGISTER_PAGE}
          total={states.length}
          onPage={(register) => set({ register })}
        />
      </Section>
      <Section
        title={t("ui.reader-pages.roles-scan-excerpt")}
        meta="GET /api/corpus · application/json"
        actions={
          <Button size="small" variant="quiet" icon="copy" onClick={() => ctx.copy(json)}>
            {t("ui.reader-pages.roles-copy")}
          </Button>
        }
      >
        <pre className="t-sunken t-a-json" data-testid="overview-agent-excerpt">
          {json}
        </pre>
      </Section>
    </>
  );
}

/** Author -------------------------------------------------------------------------------- */

/** The knowledge template, ready at the first record that needs it: only
 * that record's open slots, each with the question the slot asks. */

// @facet: registry/perspectives/author-workbench
// @facet-role: primary
function Template({ ctx }: { ctx: PageContext }) {
  const { t } = ctx;
  const ui = useText();
  const gap = firstKnowledgeGap(ctx.derived.M);
  if (!gap) return null;
  const yaml = [
    "knowledge:",
    ...gap.slots.flatMap((k) => [
      `  ${k}:`,
      `    question: ${JSON.stringify(ui.t(records.KNOWLEDGE_TEXT[k as records.KnowledgeKey].question))}`,
      '    answer: ""',
    ]),
  ].join("\n");
  return (
    <Section
      title={t("ui.reader-pages.roles-knowledge-template")}
      meta={
        <button
          type="button"
          className="t-a-link t-mono t-wrap"
          onClick={() => ctx.go(record(gap.record))}
        >
          {gap.record}
        </button>
      }
      actions={
        <Button size="small" variant="quiet" icon="copy" onClick={() => ctx.copy(yaml)}>
          {t("ui.reader-pages.roles-copy")}
        </Button>
      }
    >
      <pre className="t-sunken t-a-json" data-testid="overview-author-template">
        {yaml}
      </pre>
    </Section>
  );
}
