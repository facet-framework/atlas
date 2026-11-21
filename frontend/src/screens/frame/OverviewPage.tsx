import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { TextKey } from "../text";
import { useText, type FacetText } from "../text";
import {
  Icon,
  type IconName,
  Badge,
  Button,
  Chip,
  Dot,
  SearchField,
  EmptyState,
  Finding,
  ListRow,
  Meter,
  Section,
  Skeleton,
  Stat,
  Pagination,
} from "@facet-tools/ui";
import { DriftMark } from "@/chrome";
import { runTime } from "@/time";
import { BandChart, Pyramid, Ring, StackBar, TrendChart, pct, pctText, shareTone } from "./charts";
import type { FaqView, FeatureView, OverviewModel } from "./model";
import { CommitList, OpenRecordList } from "./parts";

/** Roles ------------------------------------------------------------------------------ */

export type OverviewRole =
  "leadership" | "dev" | "review" | "author" | "owner" | "newcomer" | "agent";

/** The reader roles, in menu order. Names and purposes live under `shell.role.<key>.*`. */
export const OVERVIEW_ROLE_KEYS: readonly OverviewRole[] = [
  "leadership",
  "dev",
  "review",
  "author",
  "owner",
  "newcomer",
  "agent",
];

/** The record fields of the five Knowledge slots, in the order the matrix shows them. */
export const KNOWLEDGE_SLOTS = [
  "prerequisite_knowledge",
  "not_for",
  "discoverability",
  "common_pitfalls",
  "success_signal",
] as const;

type KnowledgeSlot = (typeof KNOWLEDGE_SLOTS)[number];

const SLOT_NAME: Record<KnowledgeSlot, string> = {
  prerequisite_knowledge: "ui.screens-frame.overviewpage-prerequisite",
  not_for: "ui.screens-frame.overviewpage-not",
  discoverability: "ui.screens-frame.overviewpage-where-find",
  common_pitfalls: "ui.screens-frame.overviewpage-pitfalls",
  success_signal: "ui.screens-frame.overviewpage-how-you-notice",
};

const ROLE_NAME: Record<OverviewRole, string> = {
  leadership: "ui.screens-frame.overviewpage-leadership",
  dev: "ui.screens-frame.overviewpage-developer",
  review: "ui.screens-frame.overviewpage-test-review",
  author: "ui.screens-frame.overviewpage-record-author",
  owner: "ui.screens-frame.overviewpage-ownership",
  newcomer: "ui.screens-frame.overviewpage-new-here",
  agent: "ui.screens-frame.overviewpage-agent",
};

/** The role name in the active language. */
function roleText(role: OverviewRole, t: FacetText["t"]): string {
  return t(ROLE_NAME[role]);
}

/** Findings, weighted per role ------------------------------------------------------------- */

type FindingKey =
  "proof" | "drift" | "open" | "untested" | "knowledge" | "outliers" | "unowned" | "planned";

type Weighted = {
  key: FindingKey;
  icon: IconName;
  count: number;
  step: string;
  target: string;
};

/** Higher weight comes first. A finding with count 0 never becomes a next step. */
const WEIGHTS: Record<OverviewRole, FindingKey[]> = {
  leadership: ["proof", "open", "drift", "unowned", "untested", "knowledge", "planned", "outliers"],
  dev: ["drift", "untested", "open", "planned", "proof", "outliers", "knowledge", "unowned"],
  review: ["open", "untested", "proof", "drift", "outliers", "planned", "knowledge", "unowned"],
  author: ["knowledge", "outliers", "planned", "open", "drift", "untested", "unowned", "proof"],
  owner: ["unowned", "drift", "open", "knowledge", "proof", "untested", "planned", "outliers"],
  newcomer: ["proof", "knowledge", "open", "drift", "untested", "planned", "outliers", "unowned"],
  agent: ["drift", "untested", "planned", "open", "knowledge", "outliers", "unowned", "proof"],
};

function findings(m: OverviewModel, { t, plural }: FacetText): Record<FindingKey, Weighted> {
  const open = m.totals.scenarios - m.totals.proven;
  const untested = m.features.filter((f) => f.lifecycle === "active" && f.tests === 0).length;
  const know = m.features.filter((f) => f.knowledgeOpen > 0).length;
  const scen = m.calibration.find((c) => c.key === "scenarios per record");
  const planned = m.features.filter((f) => f.lifecycle === "planned").length;
  return {
    proof: {
      key: "proof",
      icon: "shield",
      count: open,
      step: t("ui.screens-frame.overviewpage-view-open-promises-area"),
      target: "promises",
    },
    drift: {
      key: "drift",
      icon: "offsetBlocks",
      count: m.drift.length,
      step: plural("ui.screens-frame.overviewpage-check-count-files-drift", m.drift.length),
      target: "drift",
    },
    open: {
      key: "open",
      icon: "shield",
      count: m.features.filter((f) => f.proven < f.scenarios).length,
      step: plural("ui.screens-frame.overviewpage-add-tests-count-open-promises", open),
      target: "promises",
    },
    untested: {
      key: "untested",
      icon: "flask",
      count: untested,
      step: plural("ui.screens-frame.overviewpage-count-active-records-without-test", untested),
      target: "tests",
    },
    knowledge: {
      key: "knowledge",
      icon: "bulb",
      count: know,
      step: plural("ui.screens-frame.overviewpage-fill-knowledge-count-records", know),
      target: "knowledge",
    },
    outliers: {
      key: "outliers",
      icon: "barChart",
      count: scen ? scen.above + scen.below : 0,
      step: plural(
        "ui.screens-frame.overviewpage-count-records-outside-scenario-band",
        scen ? scen.above + scen.below : 0,
      ),
      target: "calibration",
    },
    unowned: {
      key: "unowned",
      icon: "team",
      count: m.unowned,
      step: plural("ui.screens-frame.overviewpage-assign-owners-count-records", m.unowned),
      target: "provenance",
    },
    planned: {
      key: "planned",
      icon: "anchor",
      count: planned,
      step: plural("ui.screens-frame.overviewpage-count-planned-records-without-anchors", planned),
      target: "records?lifecycle=planned",
    },
  };
}

/** Props ------------------------------------------------------------------------------------ */

export type OverviewPageProps = {
  /** The reader the page is weighted for. */
  reader: OverviewRole;
  model: OverviewModel;
  state?: "ready" | "loading";
  mobile?: boolean;
  /** Page of the drift list (1-based), 10 files per page. */
  driftPage?: number;
  teamNames?: Record<string, string>;
  onNavigate?: (target: string) => void;
  onOpenRecord?: (id: string) => void;
  onAsk?: (question: string) => void;
  onDriftPage?: (page: number) => void;
  onCopy?: (text: string) => void;
  /** The role's generative section, placed below the key figures; the app owns it. */
  generative?: ReactNode;
};

const DRIFT_PAGE = 10;

/** Findings the leadership report names: none of them needs a schema word. */
const LEITUNG_STEPS: readonly FindingKey[] = ["proof", "open", "unowned"];

/** The side column's widest track in `.t-a-lage__grid`; the table must fit beside it. */
const SIDE_MAX = 380;

/** Whether the side column (next steps, calibration) must go below the main
 * column, because a table marked `data-overview-fit` would not show its ids and
 * column names on one line beside it. The table is measured at its natural
 * width (`width: max-content`) and put back in the same frame, so the answer
 * does not depend on the layout it chooses. */

function useStackForTable(grid: RefObject<HTMLDivElement | null>, key: unknown): boolean {
  const [stack, setStack] = useState(false);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const table = el.querySelector<HTMLElement>("[data-overview-fit]");
      if (!table) return setStack(false);
      const width = table.style.width;
      table.style.width = "max-content";
      const needed = table.getBoundingClientRect().width;
      table.style.width = width;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      setStack(needed > el.clientWidth - gap - SIDE_MAX);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grid, key]);
  return stack;
}

export function OverviewPage(props: OverviewPageProps) {
  const { reader: role, model: m, state = "ready" } = props;
  const tx = useText();
  const { t, plural } = tx;
  const grid = useRef<HTMLDivElement>(null);
  const stack = useStackForTable(grid, `${role}:${tx.locale}:${m.features.length}`);
  const roleName = roleText(role, t);
  if (state === "loading") return <OverviewSkeleton roleName={roleName} />;
  if (m.totals.records === 0)
    return (
      <OverviewEmpty roleName={roleName} onNavigate={props.onNavigate} onCopy={props.onCopy} />
    );

  const f = findings(m, tx);
  const steps = WEIGHTS[role]
    .filter((k) => role !== "leadership" || LEITUNG_STEPS.includes(k))
    .map((k) =>
      role === "leadership" && k === "unowned"
        ? {
            ...f[k],
            step: plural("ui.screens-frame.overviewpage-name-owners-count-features", f[k].count),
          }
        : f[k],
    )
    .filter((w) => w.count > 0);
  const proven = pct(m.totals.proven, m.totals.scenarios);

  return (
    <div className="t-page t-a-overview" data-testid="overview" data-role={role}>
      <div className="t-a-overview__meta t-meta">
        <span className="t-eyebrow">
          {t("ui.screens-frame.overviewpage-overview-role", { role: roleName })}
        </span>
        <span>
          <Icon name="branch" size={12} /> {m.project.branch} · {m.project.commit}
        </span>
        <span>
          {t("ui.screens-frame.overviewpage-time", {
            time: runTime(m.project.generatedAt, tx.locale) ?? "—",
          })}
        </span>
        <span className="t-hide-mobile">
          {t("ui.screens-frame.overviewpage-schema-version", { version: m.project.version })}
        </span>
      </div>
      <div
        ref={grid}
        className="t-a-overview__grid"
        data-testid="overview-grid"
        data-stack={stack || undefined}
      >
        <div className="t-a-overview__main">
          <Hero {...props} proven={proven} />
          {role === "leadership" ? (
            <LeitungKpis m={m} proven={proven} />
          ) : (
            <Kpis m={m} proven={proven} />
          )}
          {props.generative}
          <RoleBody {...props} />
        </div>
        <aside
          className="t-a-overview__side"
          aria-label={t("ui.screens-frame.overviewpage-next-steps")}
        >
          <NextSteps steps={steps.slice(0, 6)} onNavigate={props.onNavigate} />
          <SidePanel {...props} />
        </aside>
      </div>
    </div>
  );
}

/** Hero ------------------------------------------------------------------------------------ */

function Hero({
  reader: role,
  model: m,
  proven,
  teamNames,
  onNavigate,
}: OverviewPageProps & { proven: number | null }) {
  const { t, plural, number: nf } = useText();
  const open = m.totals.scenarios - m.totals.proven;
  const activeKnowledge = m.features.filter((f) => f.lifecycle === "active");
  const measuredKnowledge = activeKnowledge.filter((f) => f.knowledgeMeasured);
  const slots = measuredKnowledge.reduce((a, f) => a + f.knowledgeOpen, 0);
  const untested = m.features.filter((f) => f.lifecycle === "active" && f.tests === 0).length;
  const go = (target: string, label: string) => (
    <Button variant="primary" iconAfter="forward" onClick={() => onNavigate?.(target)}>
      {label}
    </Button>
  );
  switch (role) {
    case "leadership":
      return open === 0 ? (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          figure={pctText(100, t)}
          tone="ok"
          sentence={t("ui.screens-frame.overviewpage-test-names-every-promise-product")}
          lead={t("ui.screens-frame.overviewpage-all-scenarios-promises-records-features-named", {
            scenarios: m.totals.scenarios,
            records: m.totals.records,
          })}
          aside={go("product", t("ui.screens-frame.overviewpage-open-product-map"))}
        />
      ) : (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          figure={pctText(proven, t)}
          tone={shareTone(proven)}
          sentence={plural("ui.screens-frame.overviewpage-count-promises-not-named-any-test", open)}
          lead={t("ui.screens-frame.overviewpage-proven-scenarios-promises-named-test-most", {
            proven: m.totals.proven,
            scenarios: m.totals.scenarios,
            weakest: weakest(m, t),
          })}
          aside={go("promises", t("ui.screens-frame.overviewpage-open-promises"))}
        />
      );
    case "dev":
      // The mark's offset is the share of records with drift; unmeasured is its own state.
      if (m.driftMeasured === false)
        return (
          <Finding
            eyebrow={t("ui.screens-frame.overviewpage-finding")}
            mark={<DriftMark share={null} />}
            figure="—"
            sentence={t("ui.screens-frame.overviewpage-drift-not-measured")}
            aside={go("anchor", t("ui.screens-frame.overviewpage-view-anchors"))}
          />
        );
      return m.drift.length === 0 ? (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          mark={<DriftMark share={0} />}
          figure="0"
          tone="ok"
          sentence={t("ui.screens-frame.overviewpage-no-code-has-moved-away-its")}
          lead={t("ui.screens-frame.overviewpage-count-anchored-files-all-unchanged-since", {
            count: m.totals.anchoredFiles,
          })}
          aside={go("anchor", t("ui.screens-frame.overviewpage-view-anchors"))}
        />
      ) : (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          mark={
            <DriftMark
              share={
                m.totals.records
                  ? new Set(m.drift.map((d) => d.record)).size / m.totals.records
                  : null
              }
            />
          }
          figure={nf(m.drift.length)}
          tone="warn"
          sentence={plural(
            "ui.screens-frame.overviewpage-count-files-have-moved-since-their",
            m.drift.length,
          )}
          lead={t("ui.screens-frame.overviewpage-records-records-affected-latest-change-date", {
            records: new Set(m.drift.map((d) => d.record)).size,
            date:
              m.drift
                .map((d) => d.changedAt)
                .filter(isDay)
                .sort()
                .reverse()[0] ?? "—",
          })}
          aside={go("drift", t("ui.screens-frame.overviewpage-open-drift"))}
        />
      );
    case "review":
      return m.totals.proven === 0 ? (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          figure="0"
          of={nf(m.totals.scenarios)}
          tone="bad"
          sentence={t("ui.screens-frame.overviewpage-no-scenario-carries-test")}
          lead={t("ui.screens-frame.overviewpage-no-test-names-scenario-proves-every")}
          aside={go("tests", t("ui.screens-frame.overviewpage-assign-first-test"))}
        />
      ) : (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          figure={nf(open)}
          of={nf(m.totals.scenarios)}
          tone={open ? "warn" : "ok"}
          sentence={plural("ui.screens-frame.overviewpage-count-promises-waiting-test", open)}
          lead={t("ui.screens-frame.overviewpage-untested-active-records-have-none-all", {
            untested,
          })}
          aside={go("promises", t("ui.screens-frame.overviewpage-open-first"))}
        />
      );
    case "author":
      return measuredKnowledge.length === 0 ? (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          figure="—"
          tone="plan"
          sentence={t("ui.screens-frame.overviewpage-knowledge-not-measured")}
          aside={go("calibration", t("ui.screens-frame.overviewpage-calibration"))}
        />
      ) : measuredKnowledge.length === activeKnowledge.length && slots === 0 ? (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          figure="0"
          tone="ok"
          sentence={t("ui.screens-frame.overviewpage-every-active-record-has-its-knowledge")}
          aside={go("knowledge", t("ui.screens-frame.overviewpage-slot-matrix"))}
        />
      ) : (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          figure={nf(slots)}
          tone="warn"
          sentence={t("ui.screens-frame.overviewpage-measured-total-active-records-measured-open", {
            measured: measuredKnowledge.length,
            total: activeKnowledge.length,
            open: plural("ui.screens-frame.overviewpage-count-open-slots", slots),
          })}
          lead={t("ui.screens-frame.overviewpage-empty-slot-open-question-owner-don")}
          aside={go("knowledge", t("ui.screens-frame.overviewpage-slot-matrix"))}
        />
      );
    case "owner":
      return m.owners.length === 1 && m.unowned === 0 ? (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          figure="1"
          tone="plan"
          sentence={t("ui.screens-frame.overviewpage-one-team-carries-all-records-records", {
            records: m.totals.records,
          })}
          lead={t("ui.screens-frame.overviewpage-team-owns-every-area-if-drops", {
            team: teamName(m.owners[0].team, teamNames),
          })}
          aside={go("provenance", t("ui.screens-frame.overviewpage-origin-team"))}
        />
      ) : (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-finding")}
          figure={nf(m.unowned)}
          tone={m.unowned ? "warn" : "ok"}
          sentence={
            m.unowned
              ? plural("ui.screens-frame.overviewpage-count-records-belong-no-one", m.unowned)
              : t("ui.screens-frame.overviewpage-every-record-has-owner")
          }
          lead={t("ui.screens-frame.overviewpage-teams-teams-share-records-records-domains", {
            teams: m.owners.length,
            records: m.totals.records,
            domains: m.totals.domains,
          })}
          aside={go("provenance", t("ui.screens-frame.overviewpage-origin-team"))}
        />
      );
    case "newcomer":
      return (
        <Finding
          eyebrow={t("ui.screens-frame.overviewpage-welcome")}
          figure={nf(m.totals.records)}
          sentence={t("ui.screens-frame.overviewpage-records-describe-what-project-can-do", {
            project: m.project.name,
          })}
          lead={t("ui.screens-frame.overviewpage-they-sit-domains-areas-categories-capabilities", {
            domains: m.totals.domains,
            categories: m.totals.capabilities,
          })}
          aside={go("product", t("ui.screens-frame.overviewpage-explore-product"))}
        />
      );
    case "agent": {
      const lint = m.lint ?? { schema: null, anchors: null, proves: null, orphanAnchors: null };
      const gate =
        [lint.schema, lint.anchors, lint.proves].every((v) => v === true) &&
        m.driftMeasured !== false;
      const failed = [lint.schema, lint.anchors, lint.proves].some((v) => v === false);
      return (
        <Finding
          eyebrow="registry.state"
          figure={
            <span data-testid="overview-agent-figure">
              {m.driftMeasured === false ? "—" : m.drift.length ? nf(m.drift.length) : "0"}
            </span>
          }
          tone={failed || m.drift.length ? "warn" : gate ? "ok" : "plan"}
          sentence={
            failed
              ? t("ui.screens-frame.overviewpage-registry-inconsistent-commit-gate-closed")
              : !gate
                ? t("ui.screens-frame.overviewpage-commit-gate-not-measured")
                : m.driftMeasured === false
                  ? t("ui.screens-frame.overviewpage-commit-gate-not-measured")
                  : m.drift.length
                    ? t("ui.screens-frame.overviewpage-drift-blocks-no-commit-asks-record")
                    : t("ui.screens-frame.overviewpage-registry-consistent-commit-gate-open")
          }
          lead={t("ui.screens-frame.overviewpage-records-records-anchors-anchors-scenarios", {
            records: m.totals.records,
            anchors: m.totals.anchors,
            scenarios: m.totals.scenarios,
            version: m.project.version,
          })}
        />
      );
    }
  }
}

/** Small helpers ------------------------------------------------------------------------------- */

function teamName(id: string, names?: Record<string, string>) {
  return names?.[id] ?? id;
}

function weakest(m: OverviewModel, t: FacetText["t"]) {
  const d = [...m.domains]
    .filter((x) => x.scenarios)
    .sort((a, b) => a.proven / a.scenarios - b.proven / b.scenarios)[0];
  return d
    ? t("ui.screens-frame.overviewpage-title-share", {
        title: d.title,
        share: pctText(pct(d.proven, d.scenarios), t),
      })
    : t("ui.screens-frame.overviewpage-no-area");
}

function Kpis({ m, proven }: { m: OverviewModel; proven: number | null }) {
  const { t, plural, number: nf } = useText();
  return (
    <div className="t-a-kpis t-stagger" data-testid="overview-kpis">
      <Stat
        value={nf(m.totals.records)}
        label={plural(
          "ui.screens-frame.overviewpage-records-count-assumptions",
          m.totals.assumptions,
        )}
      />
      <Stat
        value={pctText(proven, t)}
        tone={shareTone(proven) === "plan" ? undefined : shareTone(proven)}
        label={t("ui.screens-frame.overviewpage-scenarios-named-test")}
      />
      {m.driftMeasured === false ? (
        <Stat
          value={<span title={t("ui.screens-frame.overviewpage-not-measured")}>—</span>}
          label={t("ui.screens-frame.overviewpage-files-drift")}
        />
      ) : (
        <Stat
          value={nf(m.drift.length)}
          tone={m.drift.length ? "warn" : "ok"}
          label={t("ui.screens-frame.overviewpage-files-drift")}
        />
      )}
      <Stat
        value={
          m.totals.files == null ? (
            <span title={t("ui.screens-frame.overviewpage-not-measured")}>—</span>
          ) : (
            pctText(pct(m.totals.anchoredFiles, m.totals.files), t)
          )
        }
        label={t("ui.screens-frame.overviewpage-files-anchored-anchored-files", {
          anchored: m.totals.anchoredFiles,
          files: m.totals.files ?? "—",
        })}
      />
    </div>
  );
}

/** The leadership's figures: promises, areas and teams; no file, record or anchor count. */
function LeitungKpis({ m, proven }: { m: OverviewModel; proven: number | null }) {
  const { t, number: nf } = useText();
  const open = m.totals.scenarios - m.totals.proven;
  const rework = m.domains.filter((d) => d.drift > 0).length;
  return (
    <div className="t-a-kpis t-stagger" data-testid="overview-kpis">
      <Stat
        value={pctText(proven, t)}
        tone={shareTone(proven) === "plan" ? undefined : shareTone(proven)}
        label={t("ui.screens-frame.overviewpage-promises-test-named")}
      />
      <Stat
        value={nf(open)}
        tone={open ? "warn" : "ok"}
        label={t("ui.screens-frame.overviewpage-promises-open")}
      />
      <Stat
        value={nf(rework)}
        tone={rework ? "warn" : "ok"}
        label={t("ui.screens-frame.overviewpage-areas-rework-areas", {
          areas: m.domains.length,
        })}
      />
      <Stat
        value={nf(m.owners.length)}
        label={t("ui.screens-frame.overviewpage-teams-holding-features")}
      />
    </div>
  );
}

/** A record's name for readers without the schema: its slug in words. */
function featureName(f: Pick<FeatureView, "slug">): string {
  const words = f.slug.split("-").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The state of a surface the view model did not bring: a dash, never an empty list. */
function Unmeasured({ testid }: { testid: string }) {
  const { t } = useText();
  return (
    <p className="t-muted" data-testid={testid}>
      — · {t("ui.screens-frame.overviewpage-not-measured")}
    </p>
  );
}

/** Whether a drift stamp is a calendar day; a missing stamp arrives as a dash. */
function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}

/** Whole days between two `YYYY-MM-DD…` dates; `null` when either is no date. */
function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(from.slice(0, 10));
  const b = Date.parse(to.slice(0, 10));
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86_400_000);
}

function NextSteps({ steps, onNavigate }: { steps: Weighted[]; onNavigate?: (t: string) => void }) {
  const { t } = useText();
  return (
    <section
      className="t-surface t-a-steps"
      aria-label={t("ui.screens-frame.overviewpage-next-steps-list")}
    >
      <div className="t-a-panel-head">
        <span className="t-h3">{t("ui.screens-frame.overviewpage-next-steps")}</span>
        <span className="t-meta">
          {steps.length
            ? t("ui.screens-frame.overviewpage-count-open", { count: steps.length })
            : t("ui.screens-frame.overviewpage-nothing-open")}
        </span>
      </div>
      {steps.length ? (
        <ol className="t-list t-stagger">
          {steps.map((s, i) => (
            <li key={s.key}>
              <ListRow
                lead={<span className="t-a-step-num">{i + 1}</span>}
                title={s.step}
                sub={<Icon name={s.icon} size={12} />}
                trail={<Icon name="chevronRight" size={14} />}
                onClick={() => onNavigate?.(s.target)}
              />
            </li>
          ))}
        </ol>
      ) : (
        <div className="t-a-allclear" data-testid="all-clear">
          <Icon name="check" size={20} className="t-ok" />
          <span>{t("ui.screens-frame.overviewpage-nothing-open-nextsteps")}</span>
        </div>
      )}
    </section>
  );
}

/** Role bodies ------------------------------------------------------------------------------------ */

function RoleBody(p: OverviewPageProps) {
  switch (p.reader) {
    case "leadership":
      return <Leadership {...p} />;
    case "dev":
      return <Developer {...p} />;
    case "review":
      return <TestReview {...p} />;
    case "author":
      return <Author {...p} />;
    case "owner":
      return <Ownership {...p} />;
    case "newcomer":
      return <NewcomerHere {...p} />;
    case "agent":
      return <Agent {...p} />;
  }
}

function DomainRows({
  m,
  onNavigate,
  plain,
}: {
  m: OverviewModel;
  onNavigate?: (t: string) => void;
  /** Leadership words: features and promises, no records and no drift count. */
  plain?: boolean;
}) {
  const { t, plural, number: nf } = useText();
  return (
    <div className="t-a-domrows" role="group" aria-label={t("ui.screens-frame.overviewpage-areas")}>
      {[...m.domains]
        .sort(
          (a, b) =>
            (a.scenarios ? a.proven / a.scenarios : 2) - (b.scenarios ? b.proven / b.scenarios : 2),
        )
        .map((d) => {
          const p = pct(d.proven, d.scenarios);
          return (
            <button
              key={d.id}
              type="button"
              className="t-a-domrow"
              onClick={() => onNavigate?.(`domain/${d.id}`)}
            >
              <Ring value={p} size={44} label={d.title} />
              <span className="t-stack" style={{ gap: 2, minWidth: 0 }}>
                <span className="t-a-domrow__title">
                  {d.title}{" "}
                  <span className="t-meta">
                    {d.cls === "core"
                      ? t("ui.screens-frame.overviewpage-core")
                      : t("ui.screens-frame.overviewpage-supporting")}
                  </span>
                </span>
                <span className="t-meta t-wrap">
                  {plain
                    ? plural(
                        "ui.screens-frame.overviewpage-count-features-open-promises-open",
                        d.features,
                        {
                          open: d.scenarios - d.proven,
                        },
                      )
                    : t(
                        "ui.screens-frame.overviewpage-records-records-categories-capabilities-open-open",
                        {
                          records: d.features,
                          categories: d.capabilities.length,
                          open: d.scenarios - d.proven,
                        },
                      )}
                </span>
              </span>
              <span className="t-a-domrow__bar">
                <Meter
                  value={d.scenarios ? d.proven / d.scenarios : null}
                  tone={p != null && p >= 95 ? "ok" : "warn"}
                  thin
                  label={t("ui.screens-frame.overviewpage-title-test-named", { title: d.title })}
                />
              </span>
              <span className="t-a-domrow__drift">
                {d.drift && plain ? (
                  <Badge tone="warn">{t("ui.screens-frame.overviewpage-code-ahead")}</Badge>
                ) : d.drift ? (
                  <Badge tone="warn">
                    <Icon name="offsetBlocks" size={12} /> {nf(d.drift)}
                  </Badge>
                ) : m.driftMeasured === false ? (
                  <Badge plain>{t("ui.screens-frame.overviewpage-not-measured")}</Badge>
                ) : (
                  <Badge tone="ok" plain>
                    {t("ui.screens-frame.overviewpage-calm")}
                  </Badge>
                )}
              </span>
            </button>
          );
        })}
    </div>
  );
}

/** The leadership report: where the product stands, what changed this week,
 * what is at risk, who holds what and which questions wait for an owner. No
 * schema word: features and promises, never records, anchors or drift. */

function Leadership({ model: m, teamNames, onNavigate, onOpenRecord }: OverviewPageProps) {
  const { t, plural, number: nf } = useText();
  const asOf = m.project.generatedAt;
  const dated = m.features.filter((f) => f.createdAt);
  const thisWeek = dated
    .filter((f) => {
      const d = daysBetween(f.createdAt!, asOf);
      return d != null && d >= 0 && d < 7;
    })
    .sort((a, b) => b.createdAt!.localeCompare(a.createdAt!));
  const movedAreas = m.domains.filter((d) =>
    m.drift.some((x) => {
      const days = daysBetween(x.changedAt, asOf);
      return x.record.startsWith(d.id + "/") && days != null && days >= 0 && days < 7;
    }),
  );
  const weekMeasured = dated.length > 0 && daysBetween(asOf, asOf) != null;
  const risk = m.features
    .filter((f) => f.lifecycle !== "planned" && (f.proven < f.scenarios || f.drift > 0))
    .map((f) => ({
      f,
      weight: f.drift * 2 + (f.scenarios ? (f.scenarios - f.proven) / f.scenarios : 0) * 3,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
  const unowned = m.features.filter((f) => !f.owner);
  const questions = m.features.reduce((a, f) => a + f.knowledgeOpen, 0);
  return (
    <>
      <Section
        title={t("ui.screens-frame.overviewpage-areas")}
        meta={t("ui.screens-frame.overviewpage-count-share-named-test", {
          count: m.domains.length,
        })}
        actions={
          <Button
            size="small"
            variant="quiet"
            icon="buildings"
            onClick={() => onNavigate?.("product")}
          >
            {t("ui.screens-frame.overviewpage-map")}
          </Button>
        }
      >
        <DomainRows m={m} onNavigate={onNavigate} plain />
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-week")}
        meta={
          weekMeasured
            ? t("ui.screens-frame.overviewpage-seven-days-up-date", { date: asOf.slice(0, 10) })
            : undefined
        }
      >
        <div data-testid="overview-leadership-week">
          {!weekMeasured ? (
            <Unmeasured testid="overview-leadership-week-unmeasured" />
          ) : (
            <div className="t-surface t-pad t-stack" style={{ gap: 8 }}>
              <span>
                {plural(
                  "ui.screens-frame.overviewpage-count-features-written-down",
                  thisWeek.length,
                )}
              </span>
              {thisWeek.length ? (
                <div className="t-a-chips">
                  {thisWeek.slice(0, 12).map((f) => (
                    <Chip key={f.id} onClick={() => onOpenRecord?.(f.id)}>
                      {featureName(f)}
                    </Chip>
                  ))}
                  {thisWeek.length > 12 ? (
                    <span className="t-meta">+{nf(thisWeek.length - 12)}</span>
                  ) : null}
                </div>
              ) : null}
              <span>
                {movedAreas.length
                  ? t("ui.screens-frame.overviewpage-code-changed-ahead-its-description-areas", {
                      areas: movedAreas.map((d) => d.title).join(", "),
                    })
                  : t("ui.screens-frame.overviewpage-no-code-changed-ahead-its-description")}
              </span>
            </div>
          )}
        </div>
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-risk")}
        meta={t("ui.screens-frame.overviewpage-most-open-first")}
      >
        {risk.length ? (
          <div
            className="t-surface t-a-list"
            role="list"
            aria-label={t("ui.screens-frame.overviewpage-risk")}
            data-testid="overview-leadership-risk"
          >
            {risk.map(({ f }) => (
              <div key={f.id} role="listitem">
                <ListRow
                  title={<span className="t-wrap">{featureName(f)}</span>}
                  sub={[
                    t("ui.screens-frame.overviewpage-share-promises-test-named", {
                      share: pctText(pct(f.proven, f.scenarios), t),
                    }),
                    f.drift ? t("ui.screens-frame.overviewpage-code-changed-since") : null,
                    f.owner
                      ? t("ui.screens-frame.overviewpage-held-team", {
                          team: teamName(f.owner, teamNames),
                        })
                      : t("ui.screens-frame.overviewpage-no-owner"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  lead={<Dot tone="warn" />}
                  trail={<Icon name="chevronRight" size={14} />}
                  onClick={() => onOpenRecord?.(f.id)}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="t-muted">{t("ui.screens-frame.overviewpage-nothing-risk")}</p>
        )}
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-who-holds-what")}
        meta={t("ui.screens-frame.overviewpage-teams-teams", { teams: m.owners.length })}
      >
        <div
          className="t-surface t-a-list"
          role="list"
          aria-label={t("ui.screens-frame.overviewpage-who-holds-what")}
          data-testid="overview-leadership-owners"
        >
          {m.owners.map((o) => (
            <div key={o.team} role="listitem">
              <ListRow
                lead={
                  <Ring
                    value={pct(o.proven, o.scenarios)}
                    size={32}
                    label={teamName(o.team, teamNames)}
                  />
                }
                title={teamName(o.team, teamNames)}
                sub={t("ui.screens-frame.overviewpage-features-features-share-test-named", {
                  features: o.records,
                  share: pctText(pct(o.proven, o.scenarios), t),
                })}
              />
            </div>
          ))}
        </div>
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-open-questions")}
        meta={plural("ui.screens-frame.overviewpage-count-features-without-owner", unowned.length)}
      >
        <div
          className="t-surface t-pad t-stack"
          style={{ gap: 8 }}
          data-testid="overview-leadership-questions"
        >
          {unowned.length ? (
            <div className="t-a-chips">
              {unowned.slice(0, 12).map((f) => (
                <Chip key={f.id} icon="team" onClick={() => onOpenRecord?.(f.id)}>
                  {featureName(f)}
                </Chip>
              ))}
              {unowned.length > 12 ? (
                <span className="t-meta">+{nf(unowned.length - 12)}</span>
              ) : null}
            </div>
          ) : (
            <span>{t("ui.screens-frame.overviewpage-every-feature-has-owner")}</span>
          )}
          <span>
            {plural(
              "ui.screens-frame.overviewpage-count-questions-wait-their-owners-answers",
              questions,
            )}
          </span>
        </div>
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-promises-week-written")}
        meta={t("ui.screens-frame.overviewpage-cumulative-test-named-today")}
      >
        <div className="t-surface t-pad">
          <TrendChart
            points={m.trend}
            label={t("ui.screens-frame.overviewpage-promises-checked-promises-week-written")}
          />
          <div className="t-row t-meta" style={{ gap: 16 }}>
            <span className="t-row" style={{ gap: 6 }}>
              <span className="t-a-key t-a-key--ok" />{" "}
              {t("ui.screens-frame.overviewpage-test-named")}
            </span>
            <span className="t-row" style={{ gap: 6 }}>
              <span className="t-a-key" /> {t("ui.screens-frame.overviewpage-all-promises")}
            </span>
          </div>
        </div>
      </Section>
    </>
  );
}

/** Bars of drifted files per day, the last 14 days that saw drift. */
function DriftDays({ m }: { m: OverviewModel }) {
  const { t } = useText();
  const by = new Map<string, number>();
  for (const d of m.drift)
    if (isDay(d.changedAt)) by.set(d.changedAt, (by.get(d.changedAt) ?? 0) + 1);
  const days = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const max = Math.max(1, ...days.map((d) => d[1]));
  const W = 600;
  const slot = W / 14;
  return (
    <svg
      className="t-a-chart t-a-chart--bars"
      viewBox={`0 0 ${W} 80`}
      role="img"
      aria-label={t("ui.screens-frame.overviewpage-drift-day")}
    >
      {days.map(([day, n], i) => {
        const h = (n / max) * 52;
        return (
          <g key={day}>
            <rect
              x={i * slot + slot * 0.2}
              y={60 - h}
              width={slot * 0.6}
              height={h}
              rx="3"
              className="t-a-chart__bar"
            />
            <text
              x={i * slot + slot / 2}
              y={56 - h}
              textAnchor="middle"
              className="t-a-chart__tick"
            >
              {n}
            </text>
            <text x={i * slot + slot / 2} y="76" textAnchor="middle" className="t-a-chart__tick">
              {day.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Developer({
  model: m,
  mobile,
  driftPage = 1,
  onDriftPage,
  onOpenRecord,
  onNavigate,
}: OverviewPageProps) {
  const { t, plural } = useText();
  const pages = m.drift.slice((driftPage - 1) * DRIFT_PAGE, driftPage * DRIFT_PAGE);
  const [unprovenPage, setUnprovenPage] = useState(1);
  return (
    <>
      <Section
        title={t("ui.screens-frame.overviewpage-drift")}
        meta={
          m.drift.length
            ? t("ui.screens-frame.overviewpage-files-files-records-records", {
                files: m.drift.length,
                records: new Set(m.drift.map((d) => d.record)).size,
              })
            : m.driftMeasured === false
              ? t("ui.screens-frame.overviewpage-not-measured")
              : t("ui.screens-frame.overviewpage-none")
        }
        actions={
          m.drift.length ? (
            <Button
              size="small"
              variant="quiet"
              icon="timeline"
              onClick={() => onNavigate?.("drift")}
            >
              {t("ui.screens-frame.overviewpage-timeline")}
            </Button>
          ) : undefined
        }
      >
        {m.drift.length ? (
          <>
            <div className="t-surface t-pad">
              <DriftDays m={m} />
            </div>
            <div
              className="t-surface t-a-list"
              role="list"
              aria-label={t("ui.screens-frame.overviewpage-files-drift")}
              data-testid="drift-list"
            >
              {pages.map((d) => (
                <div key={d.path + d.record} role="listitem" className="t-a-drift">
                  <Icon name="file" size={14} />
                  <span className="t-stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="t-mono t-wrap">{d.path}</span>
                    <button
                      type="button"
                      className="t-a-link t-mono"
                      onClick={() => onOpenRecord?.(d.record)}
                    >
                      {d.record}
                    </button>
                  </span>
                  <span className="t-meta">{d.changedAt}</span>
                </div>
              ))}
            </div>
            {m.drift.length > DRIFT_PAGE ? (
              <Pagination
                page={driftPage}
                pageSize={DRIFT_PAGE}
                total={m.drift.length}
                pageSizes={[10, 25, 50]}
                compact={mobile}
                onPage={onDriftPage}
              />
            ) : null}
          </>
        ) : m.driftMeasured === false ? (
          // An empty list from a comparison that could not be made is not calm.
          <Unmeasured testid="overview-dev-drift-unmeasured" />
        ) : (
          <EmptyState
            plain
            icon="check"
            title={t("ui.screens-frame.overviewpage-no-drift")}
            body={t("ui.screens-frame.overviewpage-every-anchored-file-matches-its-record")}
          />
        )}
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-promises-without-test-drifted-records")}
        meta={
          m.driftUnproven
            ? t("ui.screens-frame.overviewpage-promises-promises-records-records", {
                promises: m.driftUnproven.length,
                records: new Set(m.driftUnproven.map((x) => x.record)).size,
              })
            : undefined
        }
      >
        {!m.driftUnproven ? (
          <Unmeasured testid="overview-dev-unproven-unmeasured" />
        ) : m.driftUnproven.length ? (
          <>
            <div
              className="t-surface t-a-list"
              role="list"
              aria-label={t("ui.screens-frame.overviewpage-promises-without-test-drifted-records")}
              data-testid="overview-dev-unproven"
            >
              {m.driftUnproven
                .slice((unprovenPage - 1) * DRIFT_PAGE, unprovenPage * DRIFT_PAGE)
                .map((x) => (
                  <div key={x.record + "#" + x.scenario} role="listitem">
                    <ListRow
                      lead={<Dot tone="warn" />}
                      title={<span className="t-wrap">{x.then || x.scenario}</span>}
                      sub={<span className="t-mono t-wrap">{`${x.record} · ${x.scenario}`}</span>}
                      onClick={() => onOpenRecord?.(x.record)}
                    />
                  </div>
                ))}
            </div>
            {m.driftUnproven.length > DRIFT_PAGE ? (
              <Pagination
                page={unprovenPage}
                pageSize={DRIFT_PAGE}
                total={m.driftUnproven.length}
                pageSizes={[DRIFT_PAGE]}
                compact={mobile}
                onPage={setUnprovenPage}
              />
            ) : null}
          </>
        ) : (
          <p className="t-muted">
            {t("ui.screens-frame.overviewpage-every-promise-these-records-has-test")}
          </p>
        )}
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-anchoring")}
        meta={plural(
          "ui.screens-frame.overviewpage-anchors-anchors-count-files",
          m.totals.anchoredFiles,
          {
            anchors: m.totals.anchors,
          },
        )}
      >
        <div className="t-surface t-pad t-stack" style={{ gap: 10 }}>
          <Meter
            value={m.totals.files ? m.totals.anchoredFiles / m.totals.files : null}
            tone="signal"
            label={t("ui.screens-frame.overviewpage-files-anchored")}
          />
          <div className="t-row t-row--between t-meta">
            <span>
              {t("ui.screens-frame.overviewpage-anchored-anchored-without-without-anchor", {
                anchored: m.totals.anchoredFiles,
                without: m.totals.files == null ? "—" : m.totals.files - m.totals.anchoredFiles,
              })}
            </span>
            <span
              data-testid="overview-loc"
              title={
                m.totals.loc == null ? t("ui.screens-frame.overviewpage-not-measured") : undefined
              }
            >
              {t("ui.screens-frame.overviewpage-count-lines", { count: m.totals.loc ?? "—" })}
            </span>
          </div>
        </div>
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-recently-changed")}
        meta={t("ui.screens-frame.overviewpage-commits-anchored-records")}
      >
        <CommitList commits={m.recent} limit={6} onOpenRecord={onOpenRecord} />
      </Section>
    </>
  );
}

function TestReview({ model: m, onOpenRecord, onNavigate }: OverviewPageProps) {
  const { t, number: nf } = useText();
  const untested = m.features.filter((f) => f.lifecycle === "active" && f.tests === 0);
  const undocumented = m.features
    .filter((f) => f.lifecycle === "active" && f.knowledgeOpen > 0)
    .sort((a, b) => b.knowledgeOpen - a.knowledgeOpen);
  const capabilities = m.domains
    .flatMap((d) =>
      d.capabilities.map((c) => {
        const fs = m.features.filter((f) => f.domain === d.id && f.capability === c.id);
        return {
          domain: d,
          capability: c,
          features: fs.length,
          scenarios: fs.reduce((a, f) => a + f.scenarios, 0),
          proven: fs.reduce((a, f) => a + f.proven, 0),
        };
      }),
    )
    .filter((c) => c.features > 0)
    .sort((a, b) => b.scenarios - b.proven - (a.scenarios - a.proven));
  return (
    <>
      <Section
        title={t("ui.screens-frame.overviewpage-capability-feature-promise")}
        meta={t("ui.screens-frame.overviewpage-most-open-first")}
      >
        <div
          className="t-surface t-a-list"
          role="list"
          aria-label={t("ui.screens-frame.overviewpage-capability-feature-promise")}
          data-testid="overview-test-capabilities"
        >
          {capabilities.map((c) => (
            <div key={c.domain.id + "/" + c.capability.id} role="listitem">
              <ListRow
                lead={
                  <Ring value={pct(c.proven, c.scenarios)} size={32} label={c.capability.title} />
                }
                title={
                  <span className="t-wrap">{`${c.domain.title} → ${c.capability.title}`}</span>
                }
                sub={t(
                  "ui.screens-frame.overviewpage-features-features-proven-scenarios-test-named",
                  {
                    features: c.features,
                    proven: c.proven,
                    scenarios: c.scenarios,
                  },
                )}
                trail={<Icon name="chevronRight" size={14} />}
                onClick={() => onNavigate?.(`domain/${c.domain.id}/${c.capability.id}`)}
              />
            </div>
          ))}
        </div>
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-declared-deviations")}
        meta={m.deviations ? nf(m.deviations.length) : undefined}
        actions={
          m.deviations?.length ? (
            <Button
              size="small"
              variant="quiet"
              icon="warning"
              onClick={() => onNavigate?.("deviations")}
            >
              {t("ui.screens-frame.overviewpage-all")}
            </Button>
          ) : undefined
        }
      >
        {!m.deviations ? (
          <Unmeasured testid="overview-test-deviations-unmeasured" />
        ) : m.deviations.length ? (
          <div
            className="t-surface t-a-list"
            role="list"
            aria-label={t("ui.screens-frame.overviewpage-declared-deviations")}
            data-testid="overview-test-deviations"
          >
            {m.deviations.slice(0, 6).map((d) => (
              <div key={d.record + "#" + d.scenario} role="listitem">
                <ListRow
                  lead={<Icon name="warning" size={14} className="t-warn" />}
                  title={<span className="t-wrap">{d.then || d.scenario}</span>}
                  sub={
                    <span className="t-wrap">
                      <span className="t-mono">{`${d.record} · ${d.scenario}`}</span>
                      {d.reason ? ` · ${d.reason}` : ""}
                    </span>
                  }
                  onClick={() => onOpenRecord?.(d.record)}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="t-muted">
            {t("ui.screens-frame.overviewpage-no-record-declares-deviation")}
          </p>
        )}
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-tests-kind")}
        meta={
          m.tests
            ? t("ui.screens-frame.overviewpage-count-tests-assigned", {
                count: m.tests.unit + m.tests.integration + m.tests.e2e,
              })
            : t("ui.screens-frame.overviewpage-not-measured")
        }
      >
        <div className="t-a-split">
          <div className="t-surface t-pad">
            <Pyramid mix={m.tests} />
          </div>
          <div className="t-surface t-pad t-stack" style={{ gap: 12 }}>
            <span className="t-label">{t("ui.screens-frame.overviewpage-test-named-area")}</span>
            {m.domains.map((d) => (
              <div key={d.id} className="t-stack" style={{ gap: 4 }}>
                <div className="t-row t-row--between">
                  <span>{d.title}</span>
                  <span className="t-meta">
                    {nf(d.proven)} / {nf(d.scenarios)}
                  </span>
                </div>
                <StackBar
                  label={d.title}
                  parts={[
                    {
                      key: "p",
                      label: t("ui.screens-frame.overviewpage-test-named"),
                      value: d.proven,
                      tone: "var(--t-ok)",
                    },
                    {
                      key: "o",
                      label: t("ui.screens-frame.overviewpage-open"),
                      value: d.scenarios - d.proven,
                      tone: "var(--t-warn-wash)",
                    },
                  ]}
                />
              </div>
            ))}
          </div>
        </div>
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-open-promises")}
        meta={t("ui.screens-frame.overviewpage-most-first")}
        actions={
          <Button
            size="small"
            variant="quiet"
            icon="shield"
            onClick={() => onNavigate?.("promises")}
          >
            {t("ui.screens-frame.overviewpage-all")}
          </Button>
        }
      >
        <OpenRecordList features={m.features} limit={6} onOpenRecord={onOpenRecord} />
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-active-records-without-test")}
        meta={nf(untested.length)}
      >
        {untested.length ? (
          <div className="t-a-chips">
            {untested.slice(0, 24).map((f) => (
              <Chip key={f.id} mono icon="flask" onClick={() => onOpenRecord?.(f.id)}>
                {f.id}
              </Chip>
            ))}
            {untested.length > 24 ? (
              <span className="t-meta">+{nf(untested.length - 24)}</span>
            ) : null}
          </div>
        ) : (
          <p className="t-muted">
            {t("ui.screens-frame.overviewpage-every-active-record-has-least-one")}
          </p>
        )}
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-active-records-open-knowledge")}
        meta={nf(undocumented.length)}
        actions={
          undocumented.length ? (
            <Button
              size="small"
              variant="quiet"
              icon="bulb"
              onClick={() => onNavigate?.("knowledge")}
            >
              {t("ui.screens-frame.overviewpage-all")}
            </Button>
          ) : undefined
        }
      >
        {undocumented.length ? (
          <div className="t-a-chips" data-testid="overview-test-undocumented">
            {undocumented.slice(0, 24).map((f) => (
              <Chip
                key={f.id}
                mono
                icon="bulb"
                count={f.knowledgeOpen}
                onClick={() => onOpenRecord?.(f.id)}
              >
                {f.id}
              </Chip>
            ))}
            {undocumented.length > 24 ? (
              <span className="t-meta">+{nf(undocumented.length - 24)}</span>
            ) : null}
          </div>
        ) : (
          <p className="t-muted">
            {t("ui.screens-frame.overviewpage-every-active-record-has-its-knowledge")}
          </p>
        )}
      </Section>
    </>
  );
}

/** Which of a record's fields are missing, in the order the field matrix shows them. */
function missingFields(f: FeatureView): boolean[] {
  const knowledge = KNOWLEDGE_SLOTS.map((_, i) =>
    f.knowledgeSlots ? !f.knowledgeSlots[i] : i >= 5 - f.knowledgeOpen,
  );
  return [!f.summary.trim(), f.scenarios === 0, !f.owner, ...knowledge];
}

const AUTHOR_PAGE = 12;

function Author({ model: m, mobile, onOpenRecord }: OverviewPageProps) {
  const { t } = useText();
  const [page, setPage] = useState(1);
  const slotNames = KNOWLEDGE_SLOTS.map((s) => t(SLOT_NAME[s]));
  const columns = [
    t("ui.screens-frame.overviewpage-intent"),
    t("ui.screens-frame.overviewpage-scenarios"),
    t("ui.screens-frame.overviewpage-owner"),
    ...slotNames,
  ];
  const all = m.features
    .map((f) => {
      const missing = missingFields(f);
      return { f, missing, count: missing.filter(Boolean).length };
    })
    .sort((a, b) => b.count - a.count || a.f.id.localeCompare(b.f.id));
  const incomplete = all.filter((r) => r.count > 0).length;
  const rows = all.slice((page - 1) * AUTHOR_PAGE, page * AUTHOR_PAGE);
  const scen = m.calibration.find((c) => c.key === "scenarios per record");
  const outliers = scen
    ? m.features
        .filter((f) => f.scenarios > scen.high || f.scenarios < scen.low)
        .sort((a, b) => b.scenarios - a.scenarios)
        .slice(0, 8)
    : [];
  return (
    <>
      <Section
        title={t("ui.screens-frame.overviewpage-fields-per-record")}
        meta={t("ui.screens-frame.overviewpage-emptiest-first-incomplete-records-incomplete", {
          incomplete,
          records: all.length,
        })}
      >
        {incomplete ? (
          <>
            <div
              className="t-surface t-a-know t-a-fields"
              role="table"
              aria-label={t("ui.screens-frame.overviewpage-record-fields-filled-missing")}
              data-overview-fit=""
              data-testid="author-knowledge"
            >
              <div role="row" className="t-a-know__row t-a-know__head">
                <span role="columnheader">{t("ui.screens-frame.overviewpage-record")}</span>
                {columns.map((s, i) => (
                  <span
                    role="columnheader"
                    key={s}
                    className={i >= 3 ? "t-hide-mobile" : undefined}
                  >
                    {s}
                  </span>
                ))}
                <span role="columnheader">{t("ui.screens-frame.overviewpage-missing")}</span>
              </div>
              {rows.map(({ f, missing, count }) => (
                <div role="row" key={f.id} className="t-a-know__row">
                  <span role="cell">
                    <button
                      type="button"
                      className="t-a-link t-mono t-a-know__id"
                      onClick={() => onOpenRecord?.(f.id)}
                    >
                      {f.id}
                    </button>
                  </span>
                  {columns.map((s, i) => (
                    <span role="cell" key={s} className={i >= 3 ? "t-hide-mobile" : undefined}>
                      <i
                        className="t-a-slot"
                        data-open={missing[i] || undefined}
                        aria-label={t(
                          missing[i]
                            ? "ui.screens-frame.overviewpage-slot-open"
                            : "ui.screens-frame.overviewpage-slot-filled",
                          { slot: s },
                        )}
                      />
                    </span>
                  ))}
                  <span role="cell" className={count ? "t-num t-warn" : "t-num"}>
                    {count}
                  </span>
                </div>
              ))}
            </div>
            {all.length > AUTHOR_PAGE ? (
              <Pagination
                page={page}
                pageSize={AUTHOR_PAGE}
                total={all.length}
                pageSizes={[AUTHOR_PAGE]}
                compact={mobile}
                onPage={setPage}
              />
            ) : null}
          </>
        ) : (
          <EmptyState
            plain
            icon="bulb"
            title={t("ui.screens-frame.overviewpage-all-slots-filled")}
            body={t("ui.screens-frame.overviewpage-count-records-carry-prior-knowledge-limits", {
              count: m.totals.records,
            })}
          />
        )}
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-outside-band")}
        meta={
          scen
            ? t("ui.screens-frame.overviewpage-scenarios-per-record-band-low-high", {
                low: scen.low,
                high: scen.high,
              })
            : undefined
        }
      >
        {scen ? <BandChart m={scen} /> : null}
        <div className="t-a-chips">
          {outliers.map((f) => (
            <Chip key={f.id} mono count={f.scenarios} onClick={() => onOpenRecord?.(f.id)}>
              {f.slug}
            </Chip>
          ))}
        </div>
      </Section>
    </>
  );
}

function Ownership({ model: m, teamNames, mobile, onNavigate, onOpenRecord }: OverviewPageProps) {
  const { t, plural, number: nf } = useText();
  const teams = m.owners.map((o) => o.team);
  const [fixPage, setFixPage] = useState(1);
  const reach = (m.reach ?? []).filter((r) => r.dependents > 0).slice(0, 6);
  const maxReach = Math.max(1, ...reach.map((r) => r.dependents));
  return (
    <>
      <Section
        title={t("ui.screens-frame.overviewpage-teams")}
        meta={t("ui.screens-frame.overviewpage-teams-unowned-without-owner", {
          teams: m.owners.length,
          unowned: m.unowned,
        })}
      >
        <div className="t-a-teams t-stagger">
          {m.owners.map((o) => {
            const p = pct(o.proven, o.scenarios);
            return (
              <div key={o.team} className="t-surface t-pad t-a-team">
                <Ring value={p} size={56} label={teamName(o.team, teamNames)} />
                <span className="t-stack" style={{ gap: 2 }}>
                  <span className="t-h3">{teamName(o.team, teamNames)}</span>
                  <span className="t-meta">
                    {t("ui.screens-frame.overviewpage-records-records-scenarios-scenarios", {
                      records: o.records,
                      scenarios: o.scenarios,
                    })}
                  </span>
                </span>
              </div>
            );
          })}
          {m.unowned ? (
            <button
              type="button"
              className="t-surface t-pad t-a-team t-a-team--none t-interactive"
              onClick={() => onNavigate?.("records?owner=none")}
            >
              <Icon name="warning" size={22} className="t-warn" />
              <span className="t-stack" style={{ gap: 2 }}>
                <span className="t-h3">{t("ui.screens-frame.overviewpage-without-owner")}</span>
                <span className="t-meta">
                  {plural("ui.screens-frame.overviewpage-count-records", m.unowned)}
                </span>
              </span>
            </button>
          ) : null}
        </div>
      </Section>
      <Section title={t("ui.screens-frame.overviewpage-area-team")} meta="Records">
        <div
          className="t-surface t-a-matrix"
          role="table"
          aria-label={t("ui.screens-frame.overviewpage-area-team-ownership")}
        >
          <div
            role="row"
            className="t-a-matrix__row"
            style={{ gridTemplateColumns: `minmax(120px,1fr) repeat(${teams.length + 1}, 104px)` }}
          >
            <span role="columnheader" />
            {teams.map((team) => (
              <span role="columnheader" key={team} className="t-meta">
                {teamName(team, teamNames)}
              </span>
            ))}
            <span role="columnheader" className="t-meta">
              {t("ui.screens-frame.overviewpage-none-ownership")}
            </span>
          </div>
          {m.domains.map((d) => (
            <div
              role="row"
              key={d.id}
              className="t-a-matrix__row"
              style={{
                gridTemplateColumns: `minmax(120px,1fr) repeat(${teams.length + 1}, 104px)`,
              }}
            >
              <span role="rowheader">{d.title}</span>
              {[...teams, null].map((team) => {
                const n = m.features.filter((f) => f.domain === d.id && f.owner === team).length;
                return (
                  <span
                    role="cell"
                    key={String(team)}
                    className="t-a-matrix__cell"
                    data-zero={n === 0 || undefined}
                    style={{ ["--t-a-heat" as string]: `${Math.min(80, n * 2)}%` }}
                  >
                    {n || "·"}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-reach")}
        meta={t("ui.screens-frame.overviewpage-what-depends")}
      >
        {!m.reach ? (
          <Unmeasured testid="overview-owner-reach-unmeasured" />
        ) : reach.length ? (
          <div
            className="t-surface t-a-list"
            role="list"
            aria-label={t("ui.screens-frame.overviewpage-reach")}
            data-testid="overview-owner-reach"
          >
            {reach.map((r) => (
              <div key={r.record} role="listitem">
                <ListRow
                  title={<span className="t-mono t-wrap">{r.record}</span>}
                  sub={
                    <span className="t-stack" style={{ gap: 4 }}>
                      <span>
                        {plural("ui.screens-frame.overviewpage-count-records-depend", r.dependents)}{" "}
                        ·{" "}
                        {r.team
                          ? teamName(r.team, teamNames)
                          : t("ui.screens-frame.overviewpage-without-owner")}
                      </span>
                      <Meter
                        value={r.dependents / maxReach}
                        tone="signal"
                        thin
                        label={plural(
                          "ui.screens-frame.overviewpage-count-records-depend",
                          r.dependents,
                        )}
                      />
                    </span>
                  }
                  onClick={() => onOpenRecord?.(r.record)}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="t-muted">{t("ui.screens-frame.overviewpage-no-record-depends-another")}</p>
        )}
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-history-fixes")}
        meta={m.fixes ? nf(m.fixes.length) : undefined}
      >
        {!m.fixes ? (
          <Unmeasured testid="overview-owner-fixes-unmeasured" />
        ) : m.fixes.length ? (
          <>
            <ol
              className="t-surface t-a-list"
              aria-label={t("ui.screens-frame.overviewpage-history-fixes")}
              data-testid="overview-owner-fixes"
            >
              {m.fixes.slice((fixPage - 1) * 6, fixPage * 6).map((x, i) => (
                <li key={x.record + x.date + i}>
                  <ListRow
                    lead={<Icon name="check" size={14} className="t-ok" />}
                    title={
                      <span className="t-wrap" title={x.full || undefined}>
                        {x.subject || t("ui.screens-frame.overviewpage-no-subject")}
                      </span>
                    }
                    sub={<span className="t-mono t-wrap">{`${x.date} · ${x.record}`}</span>}
                    onClick={() => onOpenRecord?.(x.record)}
                  />
                </li>
              ))}
            </ol>
            {m.fixes.length > 6 ? (
              <Pagination
                page={fixPage}
                pageSize={6}
                total={m.fixes.length}
                pageSizes={[6]}
                compact={mobile}
                onPage={setFixPage}
              />
            ) : null}
          </>
        ) : (
          <p className="t-muted">{t("ui.screens-frame.overviewpage-no-record-names-fix")}</p>
        )}
      </Section>
    </>
  );
}

const STARTER_QUESTIONS: TextKey[] = [
  "ui.screens-frame.overviewpage-what-happens-if-i-commit-record",
  "ui.screens-frame.overviewpage-which-areas-does-product-have-what",
  "ui.screens-frame.overviewpage-what-promise-which-test-names",
  "ui.screens-frame.overviewpage-where-do-i-start-if-i",
];

const TOUR_PAGE = 6;

/** What the product does: where the taxonomy classifies a capability as core,
 * only those stand on the cards and the rest is counted in one line; where
 * nothing is classified, every capability stands and one line says so. */

// @facet: registry/perspectives/core-categories
// @facet-role: related
function Built({
  m,
  mobile,
  onNavigate,
}: {
  m: OverviewModel;
  mobile?: boolean;
  onNavigate?: (target: string) => void;
}) {
  const { t, number: nf } = useText();
  const [page, setPage] = useState(1);
  const isCore = (d: string, c: string) =>
    m.domains.some((x) => x.id === d && x.capabilities.some((y) => y.id === c && y.cls === "core"));
  const classified = m.domains.some((d) => d.capabilities.some((c) => c.cls === "core"));
  const cards = classified
    ? m.domains
        .map((d) => ({
          ...d,
          capabilities: d.capabilities.filter((c) => c.cls === "core"),
          features: m.features.filter((f) => f.domain === d.id && isCore(d.id, f.capability))
            .length,
        }))
        .filter((d) => d.capabilities.length > 0)
    : m.domains;
  const rest = classified
    ? m.domains.reduce((n, d) => n + d.capabilities.filter((c) => c.cls !== "core").length, 0)
    : 0;
  const restRecords = classified
    ? m.features.filter((f) => !isCore(f.domain, f.capability)).length
    : 0;
  return (
    <Section
      title={t("ui.screens-frame.overviewpage-how-product-built")}
      meta={t("ui.screens-frame.overviewpage-domains-areas-categories-capabilities", {
        domains: m.totals.domains,
        categories: m.totals.capabilities,
      })}
    >
      <div className="t-a-tour t-stagger" data-testid="overview-new-built">
        {cards.slice((page - 1) * TOUR_PAGE, page * TOUR_PAGE).map((d) => (
          <button
            key={d.id}
            type="button"
            className="t-surface t-pad t-a-tour__card t-interactive"
            data-testid="overview-new-built-card"
            onClick={() => onNavigate?.(`domain/${d.id}`)}
          >
            <span className="t-row t-row--between">
              <span className="t-h3">{d.title}</span>
              <span className="t-meta">{nf(d.features)}</span>
            </span>
            <span className="t-muted t-clamp-2">{d.purpose}</span>
            <span className="t-row t-row--wrap" style={{ gap: 4 }}>
              {d.capabilities.map((c) => (
                <Badge key={c.id} plain>
                  {c.title}
                </Badge>
              ))}
            </span>
          </button>
        ))}
      </div>
      {cards.length > TOUR_PAGE ? (
        <Pagination
          page={page}
          pageSize={TOUR_PAGE}
          total={cards.length}
          pageSizes={[TOUR_PAGE]}
          compact={mobile}
          onPage={setPage}
        />
      ) : null}
      {classified ? (
        rest ? (
          <p className="t-meta" data-testid="overview-new-built-rest">
            {t("ui.screens-frame.overviewpage-count-more-capabilities-support-product", {
              count: rest,
              records: restRecords,
            })}
          </p>
        ) : null
      ) : (
        <p className="t-meta" data-testid="overview-new-built-unclassified">
          {t("ui.screens-frame.overviewpage-no-capability-classified-core")}
        </p>
      )}
    </Section>
  );
}

function NewcomerHere({ model: m, mobile, onNavigate, onAsk, onOpenRecord }: OverviewPageProps) {
  const { t } = useText();
  /** "Record" is the same word in every language; the other terms translate. */
  const terms: [string, string][] = [
    ["Record", t("ui.screens-frame.overviewpage-record-capability-purpose-promises-tests-files")],
    [
      t("ui.screens-frame.overviewpage-promise"),
      t("ui.screens-frame.overviewpage-scenario-given-when-then-test-meant"),
    ],
    [
      t("ui.screens-frame.overviewpage-anchor"),
      t("ui.screens-frame.overviewpage-facet-comment-code-points-its-record"),
    ],
    [
      t("ui.screens-frame.overviewpage-drift"),
      t("ui.screens-frame.overviewpage-code-has-moved-its-record-remains"),
    ],
  ];
  return (
    <>
      <Built m={m} mobile={mobile} onNavigate={onNavigate} />
      <Faq faq={m.faq} gaps={m.faqGaps} mobile={mobile} onOpenRecord={onOpenRecord} />
      <Section
        title={t("ui.screens-frame.overviewpage-four-words-first")}
        actions={
          <Button size="small" variant="quiet" icon="book" onClick={() => onNavigate?.("glossary")}>
            {t("ui.screens-frame.overviewpage-glossary")}
          </Button>
        }
      >
        <dl className="t-a-terms">
          {terms.map(([term, d]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-ask-atlas")}
        meta={t("ui.screens-frame.overviewpage-answered-records-code-sources")}
      >
        <div className="t-a-chips">
          {STARTER_QUESTIONS.map((key) => (
            <Chip key={key} icon="chat" onClick={() => onAsk?.(t(key))}>
              {t(key)}
            </Chip>
          ))}
        </div>
      </Section>
    </>
  );
}

const FAQ_PAGE = 5;

/** Every word of the query occurs in the question, the answer or the record id. */
export function faqMatches(q: FaqView, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${q.question} ${q.answer} ${q.record}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The owners' answers: searched by every word, narrowed to one kind, in the
 * order the app gives them (newest change first), paged. A day stands only
 * where the app measured one. */

function Faq({
  faq,
  gaps,
  mobile,
  onOpenRecord,
}: {
  faq: OverviewModel["faq"];
  gaps?: OverviewModel["faqGaps"];
  mobile?: boolean;
  onOpenRecord?: (id: string) => void;
}) {
  const { t, number: nf } = useText();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const all = faq ?? [];
  const kinds = KNOWLEDGE_SLOTS.filter((k) => all.some((q) => q.slot === k));
  const shown = all.filter((q) => (kind === null || q.slot === kind) && faqMatches(q, query));
  const at = Math.min(page, Math.max(1, Math.ceil(shown.length / FAQ_PAGE)));
  return (
    <Section
      title={t("ui.screens-frame.overviewpage-answers-owners-wrote")}
      meta={
        faq ? t("ui.screens-frame.overviewpage-count-answers", { count: faq.length }) : undefined
      }
    >
      {!faq ? (
        <Unmeasured testid="overview-new-faq-unmeasured" />
      ) : faq.length ? (
        <>
          <div
            className="t-row t-row--wrap"
            style={{ gap: 8 }}
            data-testid="overview-new-faq-tools"
          >
            <SearchField
              label={t("ui.screens-frame.overviewpage-search-answers")}
              placeholder={t("ui.screens-frame.overviewpage-search-answers")}
              value={query}
              onChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
            />
            {kinds.length > 1 ? (
              <span
                className="t-row t-row--wrap"
                style={{ gap: 4 }}
                role="group"
                aria-label={t("ui.screens-frame.overviewpage-kind-answer")}
              >
                {kinds.map((k) => (
                  <Chip
                    key={k}
                    pressed={kind === k}
                    count={nf(all.filter((q) => q.slot === k).length)}
                    onClick={() => {
                      setKind(kind === k ? null : k);
                      setPage(1);
                    }}
                  >
                    {t(SLOT_NAME[k as KnowledgeSlot])}
                  </Chip>
                ))}
              </span>
            ) : null}
          </div>
          {shown.length ? (
            <dl className="t-a-terms" data-testid="overview-new-faq">
              {shown.slice((at - 1) * FAQ_PAGE, at * FAQ_PAGE).map((q, i) => (
                <div key={q.record + q.slot + i} data-testid="overview-new-faq-entry">
                  <dt className="t-wrap">{q.question || t(SLOT_NAME[q.slot as KnowledgeSlot])}</dt>
                  <dd className="t-stack" style={{ gap: 4 }}>
                    <span>{q.answer}</span>
                    <span className="t-meta t-row t-row--wrap" style={{ gap: 8 }}>
                      <span data-testid="overview-new-faq-kind">
                        {t(SLOT_NAME[q.slot as KnowledgeSlot])}
                      </span>
                      <button
                        type="button"
                        className="t-a-link t-mono t-wrap"
                        onClick={() => onOpenRecord?.(q.record)}
                      >
                        {q.record}
                      </button>
                      {q.changed ? (
                        <span data-testid="overview-new-faq-changed">
                          {t("ui.screens-frame.overviewpage-changed-date", { date: q.changed })}
                        </span>
                      ) : null}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="t-muted" data-testid="overview-new-faq-none">
              {t("ui.screens-frame.overviewpage-no-answer-matches")}
            </p>
          )}
          {shown.length > FAQ_PAGE ? (
            <Pagination
              page={at}
              pageSize={FAQ_PAGE}
              total={shown.length}
              pageSizes={[FAQ_PAGE]}
              compact={mobile}
              onPage={setPage}
            />
          ) : null}
        </>
      ) : (
        <p className="t-muted">
          {t("ui.screens-frame.overviewpage-no-owner-has-written-answer-yet")}
        </p>
      )}
      {gaps?.length ? <FaqGaps gaps={gaps} /> : null}
    </Section>
  );
}

/** The knowledge kinds no record answers: each a gap, with who could close it. */
function FaqGaps({ gaps }: { gaps: NonNullable<OverviewModel["faqGaps"]> }) {
  const { t, plural } = useText();
  return (
    <div className="t-stack" style={{ gap: 6 }}>
      <span className="t-label">{t("ui.screens-frame.overviewpage-kinds-no-record-answers")}</span>
      <ul
        className="t-surface t-a-list"
        aria-label={t("ui.screens-frame.overviewpage-kinds-no-record-answers")}
        data-testid="overview-new-faq-gaps"
      >
        {gaps.map((g) => (
          <li
            key={g.slot}
            className="t-pad t-stack"
            style={{ gap: 2 }}
            data-testid="overview-new-faq-gap"
          >
            <span>
              <Badge tone="warn" plain>
                {t("ui.screens-frame.overviewpage-open")}
              </Badge>{" "}
              {t(SLOT_NAME[g.slot as KnowledgeSlot])}
            </span>
            <span className="t-meta t-wrap">
              {[
                plural("ui.screens-frame.overviewpage-count-records-could-answer", g.records),
                g.teams.length
                  ? t("ui.screens-frame.overviewpage-held-teams", { teams: g.teams.join(", ") })
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Agent({ model: m, onCopy }: OverviewPageProps) {
  const { t, number: nf } = useText();
  // Raw data as measured: whatever the view model marks unmeasured ("—" or
  // `null`) goes out as `null`, never as a dash or a zero.
  const measured = (v: string) => (v === "—" || v === "" ? null : v);
  const activeKnowledge = m.features.filter((f) => f.lifecycle === "active");
  const knowledgeMeasured = activeKnowledge.every((f) => f.knowledgeMeasured);
  const state = {
    branch: measured(m.project.branch),
    commit: measured(m.project.commit),
    records: m.totals.records,
    scenarios: { total: m.totals.scenarios, proven: m.totals.proven },
    drift: m.drift.slice(0, 3).map((d) => ({ record: d.record, path: d.path })),
    driftCount: m.driftMeasured === false ? null : m.drift.length,
    untested: m.features.filter((f) => f.lifecycle === "active" && f.tests === 0).length,
    anchors: m.totals.anchors,
    files: m.totals.files,
    loc: m.totals.loc,
    tests: m.tests,
    knowledgeOpen: knowledgeMeasured
      ? activeKnowledge.reduce((a, f) => a + f.knowledgeOpen, 0)
      : null,
    deviations: m.deviations ? m.deviations.length : null,
  };
  const json = JSON.stringify(state, null, 2);
  const lint = m.lint ?? { schema: null, anchors: null, proves: null, orphanAnchors: null };
  const checks: [string, boolean | null, string][] = [
    [
      "Schema",
      lint.schema,
      lint.schema == null
        ? t("ui.screens-frame.overviewpage-not-measured")
        : t("ui.screens-frame.overviewpage-facet-lint-all-records-valid"),
    ],
    [
      t("ui.screens-frame.overviewpage-anchor"),
      lint.anchors,
      lint.anchors == null
        ? t("ui.screens-frame.overviewpage-not-measured")
        : lint.anchors
          ? t("ui.screens-frame.overviewpage-no-orphaned-facet-ids")
          : t("ui.screens-frame.overviewpage-count-orphaned-facet-ids", {
              count: lint.orphanAnchors ?? 0,
            }),
    ],
    [
      t("ui.screens-frame.overviewpage-drift"),
      m.driftMeasured === false ? null : m.drift.length === 0,
      m.drift.length
        ? t("ui.screens-frame.overviewpage-count-files-update-record", {
            count: m.drift.length,
          })
        : m.driftMeasured === false
          ? t("ui.screens-frame.overviewpage-not-measured")
          : t("ui.screens-frame.overviewpage-none"),
    ],
    [
      "proves:",
      lint.proves,
      lint.proves == null
        ? t("ui.screens-frame.overviewpage-not-measured")
        : t("ui.screens-frame.overviewpage-scenario-ids-exist-test-body-not"),
    ],
  ];
  return (
    <>
      <Section title={t("ui.screens-frame.overviewpage-before-commit")} meta="commit-gate">
        <ul className="t-surface t-a-checks" aria-label={t("ui.screens-frame.overviewpage-checks")}>
          {checks.map(([k, ok, d], index) => (
            <li
              key={k}
              data-testid={`overview-agent-check-${index}`}
              data-state={ok === true ? "passed" : ok === false ? "failed" : "unmeasured"}
            >
              <Icon
                name={ok === true ? "check" : ok === false ? "warning" : "minus"}
                size={16}
                className={ok === true ? "t-ok" : ok === false ? "t-warn" : "t-muted"}
              />
              <span className="t-mono">{k}</span>
              <span className="t-muted">{d}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-tools")}
        meta={t("ui.screens-frame.overviewpage-facet-mcp-calls-session")}
      >
        {!m.tools ? (
          // Not listed is not "no tools": the reason stands where the server gave one.
          m.toolsReason ? (
            <p className="t-muted t-wrap" data-testid="overview-agent-tools-unavailable">
              — ·{" "}
              {t("ui.screens-frame.overviewpage-not-available-reason", { reason: m.toolsReason })}
            </p>
          ) : (
            <Unmeasured testid="overview-agent-tools-unmeasured" />
          )
        ) : (
          <div
            className="t-surface t-a-list"
            role="list"
            aria-label={t("ui.screens-frame.overviewpage-tools")}
            data-testid="overview-agent-tools"
          >
            {m.tools.map((tool) => (
              <div key={tool.name} role="listitem" className="t-a-tool">
                <Icon name="plug" size={14} />
                <span className="t-mono">{tool.name}</span>
                <span className="t-muted t-wrap">{tool.purpose}</span>
                <span
                  className="t-meta"
                  title={
                    tool.calls == null ? t("ui.screens-frame.overviewpage-not-measured") : undefined
                  }
                >
                  {tool.calls == null ? "—" : nf(tool.calls)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-endpoints")}
        meta={t("ui.screens-frame.overviewpage-local-host")}
      >
        {!m.endpoints ? (
          <Unmeasured testid="overview-agent-endpoints-unmeasured" />
        ) : (
          <div
            className="t-surface t-a-list"
            role="list"
            aria-label={t("ui.screens-frame.overviewpage-endpoints")}
            data-testid="overview-agent-endpoints"
          >
            {m.endpoints.map((e) => (
              <div key={e.method + e.path} role="listitem" className="t-a-tool">
                <Icon name="link" size={14} />
                <span className="t-mono t-wrap">{`${e.method} ${e.path}`}</span>
                <span className="t-muted t-wrap">{e.purpose}</span>
                <span />
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section
        title={t("ui.screens-frame.overviewpage-state")}
        meta="registry_validate · JSON"
        actions={
          <Button size="small" variant="quiet" icon="copy" onClick={() => onCopy?.(json)}>
            {t("ui.screens-frame.overviewpage-copy")}
          </Button>
        }
      >
        <pre className="t-sunken t-a-json" data-testid="agent-json">
          {json}
        </pre>
      </Section>
    </>
  );
}

/** Side panel per role ---------------------------------------------------------------------------- */

function SidePanel({ reader: role, model: m, onOpenRecord, onNavigate }: OverviewPageProps) {
  const { t, plural } = useText();
  let body: ReactNode;
  if (role === "leadership" || role === "newcomer") {
    body = m.adrs.length ? (
      <>
        <span className="t-label">{t("ui.screens-frame.overviewpage-related-decisions")}</span>
        {m.adrs.slice(0, 4).map((a) => (
          <ListRow
            key={a.file}
            lead={<Icon name="scales" size={14} />}
            title={a.title}
            sub={`${a.status} · ${a.date} · ${plural(
              role === "leadership"
                ? "ui.screens-frame.overviewpage-count-features"
                : "ui.screens-frame.overviewpage-count-records",
              a.refs.length,
            )}`}
            onClick={() => onNavigate?.(`adr/${a.file}`)}
          />
        ))}
      </>
    ) : null;
  } else if (role === "review" || role === "author") {
    body = (
      <>
        <span className="t-label">{t("ui.screens-frame.overviewpage-calibration")}</span>
        {m.calibration.slice(1, 3).map((c) => (
          <BandChart key={c.key} m={c} />
        ))}
      </>
    );
  } else {
    body = (
      <>
        <span className="t-label">{t("ui.screens-frame.overviewpage-recently-changed")}</span>
        <CommitList commits={m.recent} limit={4} onOpenRecord={onOpenRecord} />
      </>
    );
  }
  return body ? <div className="t-surface t-pad t-stack t-a-sidepanel">{body}</div> : null;
}

/** States ---------------------------------------------------------------------------------------- */

function OverviewSkeleton({ roleName }: { roleName: string }) {
  const { t } = useText();
  return (
    <div className="t-page t-a-overview" aria-busy="true" data-testid="overview-loading">
      <div className="t-a-overview__meta t-meta">
        <span className="t-eyebrow">
          {t("ui.screens-frame.overviewpage-overview-role", { role: roleName })}
        </span>
        <span>—</span>
      </div>
      <div className="t-a-overview__grid">
        <div className="t-a-overview__main t-stack" style={{ gap: 18 }}>
          <span className="t-hero-number t-muted">—</span>
          <Skeleton width="62%" height={36} />
          <Skeleton width="44%" height={16} />
          <div className="t-a-kpis">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="t-stack" style={{ gap: 6 }}>
                <span className="t-stat__value t-muted">—</span>
                <Skeleton width="70%" height={10} />
              </div>
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="t-row" style={{ gap: 14 }}>
              <Skeleton width={44} height={44} radius={22} />
              <div className="t-stack" style={{ gap: 6, flex: 1 }}>
                <Skeleton width={`${40 + i * 9}%`} height={12} />
                <Skeleton width="30%" height={10} />
              </div>
            </div>
          ))}
        </div>
        <div className="t-a-overview__side t-stack" style={{ gap: 10 }}>
          <Skeleton height={220} radius={12} />
          <Skeleton height={160} radius={12} />
        </div>
      </div>
    </div>
  );
}

function OverviewEmpty({
  roleName,
  onNavigate,
  onCopy,
}: {
  roleName: string;
  onNavigate?: (t: string) => void;
  onCopy?: (t: string) => void;
}) {
  const { t } = useText();
  const unmeasured = t("ui.screens-frame.overviewpage-not-measured");
  return (
    <div className="t-page t-a-overview" data-testid="overview-empty">
      <div className="t-a-overview__meta t-meta">
        <span className="t-eyebrow">
          {t("ui.screens-frame.overviewpage-overview-role", { role: roleName })}
        </span>
      </div>
      <EmptyState
        icon="document"
        title={t("ui.screens-frame.overviewpage-register-empty")}
        body={t("ui.screens-frame.overviewpage-no-record-lives-under-docs-facets")}
        action={
          <>
            <Button variant="primary" icon="plus" onClick={() => onNavigate?.("records/new")}>
              {t("ui.screens-frame.overviewpage-write-first-record")}
            </Button>
            <Button icon="copy" onClick={() => onCopy?.("facet init")}>
              {t("ui.screens-frame.overviewpage-copy-facet-init")}
            </Button>
          </>
        }
      />
      <div className="t-a-kpis t-a-kpis--empty">
        <Stat value="0" label="Records" />
        <Stat
          value="—"
          label={`${t("ui.screens-frame.overviewpage-scenarios-named-test")} · ${unmeasured}`}
        />
        <Stat
          value="—"
          label={`${t("ui.screens-frame.overviewpage-files-drift")} · ${unmeasured}`}
        />
        <Stat
          value="—"
          label={`${t("ui.screens-frame.overviewpage-files-anchored")} · ${unmeasured}`}
        />
      </div>
    </div>
  );
}
