import { useHeightVar, writeHeight, reducedMotion } from "@facet-tools/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Chip,
  IconButton,
  Segment,
  Tabs,
  Distribution,
  EmptyState,
  Breadcrumbs,
  type Crumb,
  Icon,
  type IconName,
} from "@facet-tools/ui";
import { Logo, type DriftTone } from "@/chrome";
import { useText, type FacetText } from "../text";
import {
  KNOWLEDGE_SLOTS,
  LIFECYCLE,
  TAG,
  dateText,
  pctText,
  roleLabel,
  share,
  type GwtStep,
  type KnowledgeKey,
  type Lifecycle,
  type RecordKind,
} from "./model";
import {
  CodeView,
  CommitSpark,
  DependencyGraph,
  Figure,
  KindBadge,
  LifecycleBadge,
  ProofMosaic,
  SectionChips,
  SectionRail,
  StepList,
  cx,
  type RailItem,
} from "./parts";
import { CodeZoom, SourceEditor, type SourceFile } from "./SourceEditor";
import {
  BusinessRuleList,
  CaseOfLines,
  DecisionList,
  ExampleTables,
  RecordLookup,
  type RecordBusinessRule,
  type RecordCaseOf,
  type RecordDecision,
  type RecordExamples,
  type LookupTarget,
} from "./RecordExtras";

const AUDIENCE_NAME: Record<string, string> = {
  engineering: "ui.screens-records.recorddetailspage-engineering",
  product: "ui.screens-records.recorddetailspage-product",
};

const STICK_WHAT: Record<string, string> = {
  id: "ui.screens-records.recorddetailspage-id",
  name: "ui.screens-records.recorddetailspage-name",
  path: "ui.screens-records.recorddetailspage-path",
  status: "ui.screens-records.recorddetailspage-status",
};

export type RecordTest = { kind: string; file: string; name: string | null };
/** Who a scenario's sentence is written for (`audience`). */
export type RecordAudience = "product" | "engineering";
export type RecordAudienceFilter = "all" | RecordAudience;
export type RecordScenario = {
  id: string;
  steps: GwtStep[];
  proven: boolean;
  /** `null`: nobody classified the sentence; absent: the host sends no readership. */
  audience?: RecordAudience | null;
  tests: RecordTest[];
  /** A Scenario Outline's `examples` blocks; absent or empty for a plain scenario. */
  examples?: RecordExamples[];
  /** Business rules that name this scenario as a case. */
  caseOf?: RecordCaseOf[];
  /** The reason of a declared deviation (the specification), when the record declares one. */
  deviation?: string | null;
};
export type RecordAnchor = { path: string; line: number; role: string };
export type RecordKnowledge = { key: KnowledgeKey; answer: string | null };
export type RecordCommit = { date: string; sha: string; subject: string };
export type RecordDrift = { path: string; changedAt: string | null };
/** `missing`: the registry holds no record with this id, so the link leads nowhere. */
export type RecordLink = { id: string; lifecycle?: Lifecycle; missing?: boolean };
/** `missing`: the record names an id the loaded registry does not hold. */
export type RecordRule = { id: string; title: string; states: string; missing?: boolean };

export type RecordDetails = {
  id: string;
  kind: RecordKind;
  domain: string;
  capability: string;
  slug: string;
  summary: string;
  lifecycle: Lifecycle;
  owner: string | null;
  createdAt: string | null;
  scenarioCount: number;
  provenCount: number;
  /** The scenarios shown; may be fewer than `scenarioCount`. */
  scenarios: RecordScenario[];
  testCount: number;
  /** Tests by kind (Unit, Integration, E2E). */
  testKinds: Record<string, number>;
  anchorCount: number;
  anchors: RecordAnchor[];
  /** The slots the record's `knowledge` block declares, in slot order. */
  knowledge: RecordKnowledge[];
  /** `false`: the record declares no `knowledge` block, so there is no count to
   * draw. Absent: the block is taken as declared. */

  knowledgeDeclared?: boolean;
  /** Commits on the record; `null` = history not read, which is not "no commits". */
  logCount: number | null;
  /** The commits shown; `null` = history not read. */
  log: RecordCommit[] | null;
  /** Number of repository commits inspected for this record. */
  logWindow?: number | null;
  /** The inspected history cannot establish absence. */
  logIncomplete?: boolean | null;
  dependsOn: RecordLink[];
  dependents: RecordLink[];
  variants: RecordLink[];
  drift: RecordDrift[];
  /** `false`: the host sent no drift comparison — not measured, which is not "no drift". */
  driftMeasured?: boolean;
  /** `null`: the record says nothing about observation. */
  observed: boolean | null;
  rules: RecordRule[];
  /** `lineage.related_assumptions`, in the record's order. Absent: not shown. */
  assumptions?: RecordRule[];
  /** `lineage.related_data_entities`, in the record's order. Absent: not shown. */
  dataShapes?: RecordRule[];
  /** `contract.business_rules`: `null` when the record does not carry the
   * field, an empty list when it carries it empty. Absent: not shown. */

  businessRules?: RecordBusinessRule[] | null;
  /** `intent.decision_records`: `null` when the record does not carry the
   * field, an empty list when it carries it empty. Absent: not shown. */

  decisions?: RecordDecision[] | null;
  /** The host reports this record on a dependency cycle or downstream of one. */
  cyclic?: boolean;
  tickets: string[];
  yaml: string;
  json: string;
};

export type RecordSectionKey =
  "promises" | "code" | "knowledge" | "drift" | "history" | "relations" | "operations" | "rules";

/** A neighbour on the path, with how much of it is proven. */
export type Sibling = { id: string; records: number; scenarios: number; proven: number };

export type CrumbLevel = "domain" | "capability" | "record";

/** The drift of one record as the FACET mark carries it: the share of its
 * anchored files that changed without the record (0–1), the tone of the
 * offset block, and the counts behind both. `null`: not measured. */

// @facet: registry/records/drift-mark
// @facet-role: primary
export function recordDrift(
  r: Pick<RecordDetails, "anchors" | "drift" | "driftMeasured">,
): { share: number; tone: DriftTone; drifted: number; files: number } | null {
  if (r.driftMeasured === false) return null;
  const drifted = new Set(r.drift.map((d) => d.path)).size;
  const anchored = new Set(r.anchors.map((a) => a.path));
  for (const d of r.drift) anchored.add(d.path);
  const files = anchored.size;
  const share = files ? Math.min(1, drifted / files) : 0;
  const tone: DriftTone = drifted === 0 ? "signal" : share < 0.5 ? "warn" : "bad";
  return { share, tone, drifted, files };
}

/** The record's own mark, top right of its page: offset and colour say how far it drifted. */
function RecordDriftMark({ r }: { r: RecordDetails }) {
  const { t } = useText();
  const d = recordDrift(r);
  const label =
    d == null
      ? t("ui.screens-records.recorddetailspage-drift-not-measured")
      : d.drifted === 0
        ? t("ui.screens-records.recorddetailspage-no-drift")
        : t("ui.screens-records.recorddetailspage-drift-drifted-files-anchored-files", {
            drifted: d.drifted,
            files: d.files,
          });
  return (
    <span className="t-b-record__mark" data-testid="record-drift-mark" title={label}>
      <Logo size={44} drift={d == null ? null : d.share} tone={d?.tone ?? "signal"} label={label} />
    </span>
  );
}

/** The head rows a reader can pin to the top of the page, in head order. */

export const RECORD_STICK_KEYS = ["path", "status", "name", "id"] as const;
export type RecordStickKey = (typeof RECORD_STICK_KEYS)[number];

export type RecordDetailsPageProps = {
  state: "ready" | "not-found";
  mobile?: boolean;
  record?: RecordDetails;
  /** Siblings each path segment's caret offers. */
  siblings?: { domains: Sibling[]; capabilities: Sibling[]; records: Sibling[] };
  siblingsOpen?: CrumbLevel | null;
  /** The open sibling list's search text, when the container holds it. */
  siblingsQuery?: string;
  onSiblingsQuery?: (query: string) => void;
  /** Esc or a press outside the open sibling list. */
  onCloseSiblings?: () => void;
  /** Head rows pinned to the top while the page scrolls. */
  stuck?: readonly RecordStickKey[];
  /** Pin (`true`) or unpin a head row; without it the rows carry no pin button. */
  onStick?: (key: RecordStickKey, on: boolean) => void;
  tab: "record" | "raw";
  rawFormat?: "yaml" | "json";
  section?: RecordSectionKey;
  /** Mobile: sections folded to their head. */
  collapsed?: RecordSectionKey[];
  scenarioFilter?: "all" | "open" | "proven";
  /** The readership selection; only drawn when a promise carries a readership. */
  audienceFilter?: RecordAudienceFilter;
  onAudienceFilter?: (f: RecordAudienceFilter) => void;
  /** Today, for the commit chart (`YYYY-MM`). */
  now?: string;
  /** Not found: the id that was asked for and the nearest existing ones. */
  missingId?: string;
  nearest?: string[];
  onTab?: (t: "record" | "raw") => void;
  onRawFormat?: (f: "yaml" | "json") => void;
  onSection?: (s: RecordSectionKey) => void;
  onToggleSection?: (s: RecordSectionKey) => void;
  onToggleSiblings?: (level: CrumbLevel) => void;
  onNavigate?: (to: { kind: "product" | "records" | CrumbLevel; id: string }) => void;
  onScenarioFilter?: (f: "all" | "open" | "proven") => void;
  onMore?: (what: "scenarios" | "anchors" | "log") => void;
  onOpenAnchor?: (a: RecordAnchor) => void;
  onOpenTest?: (t: RecordTest) => void;
  onOpenRule?: (id: string) => void;
  onOpenCommit?: (sha: string) => void;
  onOpenDrift?: (path: string) => void;
  onAnswer?: (slot: KnowledgeKey) => void;
  onCopy?: (what: "id" | "raw" | "anchor") => void;
  onAsk?: () => void;
  /** Code zoom in percent (raw view and source view); 100 when absent. */
  codeZoom?: number;
  onCodeZoom?: (zoom: number) => void;
  /** The source file open in the code section, if any. */
  openFile?: SourceFile | null;
  onCloseFile?: () => void;
  /** Draws the record's prose — summary, steps, answers, rules — with the
   * author's markup and the project's terms. Plain text without it. */

  renderProse?: (text: string) => ReactNode;
  /** Open a decision the record rests on. */
  onOpenDecision?: (target: string) => void;
  /** A term or record looked up beside the page; `null` or absent: none. */
  lookup?: LookupTarget | null;
  onCloseLookup?: () => void;
  /** Follow the looked-up record: the lookup closes and that record opens. */
  onFollowLookup?: (id: string) => void;
};

function scrollSection(main: HTMLElement | null, k: RecordSectionKey) {
  const el = main?.querySelector<HTMLElement>(`[data-testid="section-${k}"]`);
  el?.scrollIntoView?.({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
}

function crumbsFor(p: RecordDetailsPageProps, r: RecordDetails, { t, plural }: FacetText): Crumb[] {
  const sib = p.siblings;
  const go = p.onNavigate;
  const menu = (level: CrumbLevel, items: Sibling[] | undefined, current: string, prefix: string) =>
    items?.map((s) => ({
      key: s.id,
      label: s.id,
      current: s.id === current,
      sub:
        level === "record"
          ? t("ui.screens-records.recorddetailspage-proven-total-promises-named-test", {
              proven: s.proven,
              total: s.scenarios,
            })
          : plural("ui.screens-records.recorddetailspage-count-records", s.records),
      meta: pctText(share(s.proven, s.scenarios), t),
      onSelect: () => go?.({ kind: level, id: prefix + s.id }),
    }));
  if (r.kind === "assumption") {
    return [
      { key: "records", label: "Records", onClick: () => go?.({ kind: "records", id: "" }) },
      {
        key: "kind",
        label: t("ui.screens-records.recorddetailspage-assumptions"),
        onClick: () => go?.({ kind: "records", id: "kind:assumption" }),
      },
      { key: "record", label: r.slug, mono: true },
    ];
  }
  return [
    {
      key: "product",
      label: t("ui.screens-records.recorddetailspage-product"),
      onClick: () => go?.({ kind: "product", id: "" }),
    },
    {
      key: "domain",
      label: r.domain,
      mono: true,
      onClick: () => go?.({ kind: "domain", id: r.domain }),
      siblings: menu("domain", sib?.domains, r.domain, ""),
    },
    {
      key: "capability",
      label: r.capability,
      mono: true,
      onClick: () => go?.({ kind: "capability", id: `${r.domain}/${r.capability}` }),
      siblings: menu("capability", sib?.capabilities, r.capability, `${r.domain}/`),
    },
    {
      key: "record",
      label: r.slug,
      mono: true,
      siblings: menu("record", sib?.records, r.slug, `${r.domain}/${r.capability}/`),
    },
  ];
}

function RecordSection({
  id,
  title,
  meta,
  actions,
  children,
  collapsible,
  collapsed,
  onToggle,
}: {
  id: RecordSectionKey;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <section
      className="t-b-sec t-anim-rise"
      id={id}
      aria-labelledby={`${id}-h`}
      data-testid={`section-${id}`}
    >
      <div className="t-b-sec__head">
        {collapsible ? (
          <button
            type="button"
            className="t-b-sec__toggle"
            aria-expanded={!collapsed}
            aria-controls={`${id}-body`}
            onClick={onToggle}
          >
            <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={14} />
            <h2 className="t-h2" id={`${id}-h`}>
              {title}
            </h2>
          </button>
        ) : (
          <h2 className="t-h2" id={`${id}-h`}>
            {title}
          </h2>
        )}
        {meta ? <span className="t-meta">{meta}</span> : null}
        {actions && !collapsed ? (
          <>
            <span className="t-spacer" />
            <div className="t-row t-row--wrap">{actions}</div>
          </>
        ) : null}
      </div>
      {collapsed ? null : (
        <div className="t-b-sec__body" id={`${id}-body`}>
          {children}
        </div>
      )}
    </section>
  );
}

function Banner({
  tone,
  icon,
  children,
  action,
}: {
  tone: "warn" | "plan" | "signal" | "bad";
  icon: Parameters<typeof Icon>[0]["name"];
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cx("t-b-banner", `t-b-banner--${tone}`)} role="note">
      <Icon name={icon} size={16} />
      <div className="t-b-banner__text">{children}</div>
      {action}
    </div>
  );
}

function ScenarioCard({
  s,
  onOpenTest,
  render,
  onOpenRule,
}: {
  s: RecordScenario;
  onOpenTest?: (t: RecordTest) => void;
  render: (text: string) => ReactNode;
  onOpenRule?: (id: string) => void;
}) {
  const { t } = useText();
  const outline = !!s.examples?.length;
  const params = outline ? new Set(s.examples!.flatMap((b) => b.columns)) : undefined;
  return (
    <article
      className={cx("t-b-scn", !s.proven && "t-b-scn--open")}
      aria-label={s.id}
      data-testid={`scenario-${s.id}`}
    >
      <header className="t-b-scn__head">
        <span className="t-mono t-b-scn__id">{s.id}</span>
        <span className="t-spacer" />
        {outline ? (
          <Badge plain tone="plan">
            {t("ui.screens-records.recorddetailspage-outline")}
          </Badge>
        ) : null}
        {s.audience ? (
          <Badge plain tone="neutral">
            <span data-testid="scenario-audience">{t(AUDIENCE_NAME[s.audience])}</span>
          </Badge>
        ) : null}
        {s.proven ? (
          <Badge tone="ok">{t("ui.screens-records.recorddetailspage-test-named")}</Badge>
        ) : (
          <Badge tone="warn">{t("ui.screens-records.recorddetailspage-open")}</Badge>
        )}
      </header>
      <StepList steps={s.steps} params={params} render={render} />
      {s.deviation ? (
        <p className="t-b-scn__deviation" data-testid="scenario-deviation">
          <span className="t-label">
            {t("ui.screens-records.recorddetailspage-declared-deviation")}
          </span>{" "}
          {render(s.deviation)}
        </p>
      ) : null}
      {outline ? <ExampleTables blocks={s.examples!} scenarioId={s.id} /> : null}
      {s.caseOf?.length ? (
        <CaseOfLines cases={s.caseOf} render={render} onOpen={onOpenRule} />
      ) : null}
      {s.tests.length ? (
        <ul
          className="t-b-scn__tests"
          aria-label={t("ui.screens-records.recorddetailspage-tests-naming-promise")}
        >
          {s.tests.map((test, i) => (
            <li key={i}>
              <button type="button" className="t-b-test" onClick={() => onOpenTest?.(test)}>
                <Badge
                  plain
                  tone={
                    test.kind === "E2E"
                      ? "signal"
                      : test.kind === "Integration"
                        ? "plan"
                        : "neutral"
                  }
                >
                  {test.kind}
                </Badge>
                <Icon name="flask" size={12} />
                <span className="t-mono t-wrap">{test.file}</span>
                {test.name ? (
                  <span className="t-b-test__name t-wrap" data-testid="test-name">
                    {test.name}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : s.proven ? null : (
        <p className="t-b-scn__none">
          <Icon name="warning" size={12} />{" "}
          {t("ui.screens-records.recorddetailspage-no-test-names-promise")}
        </p>
      )}
    </article>
  );
}

function rail(r: RecordDetails, { t, number }: FacetText): RailItem[] {
  const open = r.knowledge.filter((k) => !k.answer).length;
  const declared = r.knowledgeDeclared !== false ? r.knowledge.length : 0;
  return [
    {
      key: "promises",
      label: t("ui.screens-records.recorddetailspage-promises"),
      count: `${r.provenCount}/${r.scenarioCount}`,
      tone: r.scenarioCount === 0 ? undefined : r.provenCount === r.scenarioCount ? "ok" : "warn",
    },
    {
      key: "code",
      label: "Code",
      count: number(r.anchorCount),
      tone: r.anchorCount || r.kind === "assumption" ? undefined : "plan",
    },
    {
      key: "knowledge",
      label: t("ui.screens-records.recorddetailspage-knowledge"),
      // A record without a knowledge block gets no count: the schema's five
      // would be a statement about FACET, not about this record.
      count: declared ? `${declared - open}/${declared}` : undefined,
      tone: declared ? (open ? "warn" : "ok") : undefined,
    },
    {
      key: "drift",
      label: t("ui.screens-records.recorddetailspage-drift"),
      count: r.drift.length,
      tone: r.drift.length ? "warn" : undefined,
    },
    {
      key: "history",
      label: t("ui.screens-records.recorddetailspage-history"),
      count: r.logCount ?? "—",
    },
    {
      key: "relations",
      label: t("ui.screens-records.recorddetailspage-relations"),
      count: r.dependsOn.length + r.dependents.length + r.variants.length,
    },
    { key: "operations", label: t("ui.screens-records.recorddetailspage-operations") },
    {
      key: "rules",
      label: t("ui.screens-records.recorddetailspage-rules-data"),
      count: referenceCount(r),
    },
  ];
}

/** Business rules, rule records, assumptions and data shapes: what the rules section lists. */
function referenceCount(r: RecordDetails): number {
  return (
    r.rules.length +
    (r.businessRules?.length ?? 0) +
    (r.assumptions?.length ?? 0) +
    (r.dataShapes?.length ?? 0)
  );
}

/** One list of records the record names: a row opens it, a missing one says so. */
function ReferenceList({
  items,
  icon,
  testId,
  onOpen,
}: {
  items: RecordRule[];
  icon: IconName;
  testId: string;
  onOpen?: (id: string) => void;
}) {
  const { t } = useText();
  return (
    <ul className="t-b-rules" data-testid={testId}>
      {items.map((x) => (
        <li key={x.id} data-testid="reference-row" data-missing={x.missing ? "true" : undefined}>
          {x.missing ? (
            <span className="t-b-rule t-b-rule--missing">
              <Icon name={icon} size={14} />
              <span className="t-stack" style={{ gap: 2 }}>
                <span className="t-mono">{x.id}</span>
                <span className="t-meta">
                  {t("ui.screens-records.recorddetailspage-not-registry")}
                </span>
              </span>
            </span>
          ) : (
            <button type="button" className="t-b-rule" onClick={() => onOpen?.(x.id)}>
              <Icon name={icon} size={14} />
              <span className="t-stack" style={{ gap: 2 }}>
                <span>{x.title}</span>
                <span className="t-meta t-mono">{x.id}</span>
              </span>
              <Icon name="chevronRight" size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function NotFound({ p }: { p: RecordDetailsPageProps }) {
  const { t } = useText();
  return (
    <div className="t-page t-b-record" data-testid="record-not-found">
      <EmptyState
        icon="document"
        title={
          <>
            {t("ui.screens-records.recorddetailspage-no-record")}{" "}
            <span className="t-mono">{p.missingId}</span>
          </>
        }
        body={t("ui.screens-records.recorddetailspage-id-no-registry-repository-not-even")}
        action={
          <>
            <Button
              icon="document"
              onClick={() => p.onNavigate?.({ kind: "records", id: p.missingId ?? "" })}
            >
              {t("ui.screens-records.recorddetailspage-search-records")}
            </Button>
            <Button icon="chat" variant="quiet" onClick={p.onAsk}>
              {t("ui.screens-records.recorddetailspage-ask-atlas")}
            </Button>
          </>
        }
      />
      {p.nearest?.length ? (
        <div className="t-b-nearest t-surface t-pad">
          <span className="t-label">{t("ui.screens-records.recorddetailspage-similar-ids")}</span>
          <ul className="t-list">
            {p.nearest.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="t-b-link t-mono"
                  onClick={() => p.onNavigate?.({ kind: "record", id })}
                >
                  {id}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The record record: the most-read page of Atlas. */
export function RecordDetailsPage(p: RecordDetailsPageProps) {
  const text = useText();
  if (p.state === "not-found" || !p.record) return <NotFound p={p} />;
  return <Record p={p} r={p.record} text={text} />;
}

function Record({ p, r, text }: { p: RecordDetailsPageProps; r: RecordDetails; text: FacetText }) {
  const { t, plural } = text;
  const mobile = !!p.mobile;
  const items = rail(r, text);
  const collapsed = (k: RecordSectionKey) => mobile && !!p.collapsed?.includes(k);
  const sec = (k: RecordSectionKey) => ({
    id: k,
    collapsible: mobile,
    collapsed: collapsed(k),
    onToggle: () => p.onToggleSection?.(k),
  });
  const filter = p.scenarioFilter ?? "all";
  const audience = p.audienceFilter ?? "all";
  // A readership group is drawn once any promise is classified; an unclassified
  // promise belongs to neither readership and is counted against all promises.
  const classified = r.scenarios.some((s) => s.audience);
  const unclassified = r.scenarios.filter((s) => !s.audience).length;
  const scenarios = r.scenarios.filter(
    (s) =>
      (filter === "all" ? true : filter === "open" ? !s.proven : s.proven) &&
      (audience === "all" || s.audience === audience),
  );
  const openKnowledge = r.knowledge.filter((k) => !k.answer).length;
  const knowledgeDeclared = r.knowledgeDeclared !== false;
  const declaredSlots = knowledgeDeclared ? r.knowledge.length : 0;
  const provenPct = share(r.provenCount, r.scenarioCount);
  const files = new Set(r.anchors.map((a) => a.path)).size;
  const kinds = r.testKinds;
  const assumption = r.kind === "assumption";
  const roles = r.anchors.reduce<Record<string, number>>(
    (a, x) => ({ ...a, [x.role]: (a[x.role] ?? 0) + 1 }),
    {},
  );
  const lastChange = r.log?.[0]?.date ?? null;

  const mainRef = useRef<HTMLDivElement>(null);
  const prose = p.renderProse ?? ((text: string) => text);

  // A rule's case or a scenario's rule brings the other into view: its
  // section opens if it is folded and the promise filter lets it through.
  const [reveal, setReveal] = useState<{ testid: string; n: number } | null>(null);
  const revealIn = (k: RecordSectionKey, testid: string) => {
    if (collapsed(k)) p.onToggleSection?.(k);
    setReveal((x) => ({ testid, n: (x?.n ?? 0) + 1 }));
  };
  useLayoutEffect(() => {
    if (!reveal) return;
    const el = mainRef.current?.querySelector<HTMLElement>(`[data-testid="${reveal.testid}"]`);
    if (!el) return;
    el.scrollIntoView?.({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
  }, [reveal]);
  const openScenario = (id: string) => {
    if (filter !== "all") p.onScenarioFilter?.("all");
    revealIn("promises", `scenario-${id}`);
  };
  const openBusinessRule = (id: string) => revealIn("rules", `brule-${id}`);
  const section = p.section;
  const tab = p.tab;
  const collapsedNow = collapsed(section ?? "promises");

  // Closing the file hands focus back to the anchor it was opened from.
  const closeFile = () => {
    const f = p.openFile;
    p.onCloseFile?.();
    if (f)
      mainRef.current
        ?.querySelector<HTMLElement>(`[data-testid="anchor-${f.path}:${f.line}"]`)
        ?.focus();
  };

  // Pinned head rows: once a row has scrolled up under the top bars, its copy
  // shows in the strip that sticks there. Without layout (no rectangles) every
  // pinned row counts as scrolled away, so the strip shows them all.
  const stuck = p.stuck ?? [];
  const stripRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Partial<Record<RecordStickKey, HTMLElement | null>>>({});
  const [gone, setGone] = useState<RecordStickKey[]>([]);
  const stuckKey = stuck.join(" ");

  // Which pinned rows have scrolled up under the top bars, read from layout.
  const measureGone = useCallback(() => {
    const keys = (stuckKey ? stuckKey.split(" ") : []) as RecordStickKey[];
    const line = stripRef.current?.getBoundingClientRect().top ?? 0;
    const next = keys.filter(
      (k) => (rowRefs.current[k]?.getBoundingClientRect().bottom ?? 0) <= line,
    );
    setGone((prev) => (prev.join(" ") === next.join(" ") ? prev : next));
  }, [stuckKey]);
  useEffect(() => {
    if (!stuckKey) return;
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measureGone();
        });
    };
    measureGone();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [stuckKey, measureGone]);

  // The strip and, on a phone, the section chips cover the top of the window
  // under the shell's bars; their measured heights keep the rail and the
  // sections clear of them.
  const pageRef = useRef<HTMLDivElement>(null);
  const stripInner = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLElement>(null);

  const [jump, setJump] = useState<{ to: RecordSectionKey; n: number } | null>(null);
  const jumpTo = (to: RecordSectionKey) => {
    setJump((j) => ({ to, n: (j?.n ?? 0) + 1 }));
    if (stuckKey) setGone([...stuck]);
  };
  const address = section && tab === "record" ? `${section} ${collapsedNow}` : "";
  const [seenAddress, setSeenAddress] = useState("");
  if (address !== seenAddress) {
    setSeenAddress(address);
    if (section && address) jumpTo(section);
  }
  useLayoutEffect(() => {
    if (!jump) return;
    writeHeight("--t-b-stuck-h", stripInner.current, pageRef.current);
    writeHeight("--t-b-chips-h", chipsRef.current, pageRef.current);
    scrollSection(mainRef.current, jump.to);
  }, [jump]);

  const pinButton = (key: RecordStickKey) => {
    if (!p.onStick) return null;
    const on = stuck.includes(key);
    const what = t(STICK_WHAT[key]);
    return (
      <IconButton
        icon="pin"
        size="small"
        className="t-b-stick__pin"
        label={t(
          on
            ? "ui.screens-records.recorddetailspage-unpin-what"
            : "ui.screens-records.recorddetailspage-pin-what-top",
          { what },
        )}
        pressed={on}
        data-testid={`stick-${key}`}
        onClick={() => p.onStick?.(key, !on)}
      />
    );
  };
  const path = (inStrip: boolean) => (
    <Breadcrumbs
      // The strip's copy is a way back up, not a second sibling menu.
      crumbs={
        inStrip
          ? crumbsFor(p, r, text).map((c) => ({ ...c, siblings: undefined }))
          : crumbsFor(p, r, text)
      }
      openKey={inStrip ? null : p.siblingsOpen}
      onToggleSiblings={(k) => p.onToggleSiblings?.(k as CrumbLevel)}
      query={p.siblingsQuery}
      onQuery={p.onSiblingsQuery}
      onClose={p.onCloseSiblings}
    />
  );
  const status = (
    <div className="t-row t-row--wrap" style={{ gap: 8 }}>
      <KindBadge kind={r.kind} />
      <LifecycleBadge lifecycle={r.lifecycle} />
      {r.drift.length ? (
        <Badge tone="warn">{t("ui.screens-records.recorddetailspage-drift")}</Badge>
      ) : null}
      {r.tickets.map((ticket) => (
        <Badge key={ticket} plain>
          {ticket}
        </Badge>
      ))}
    </div>
  );
  const idRow = (
    <div className="t-row t-row--wrap t-b-record__id">
      <span className="t-mono t-wrap">{r.id}</span>
      <Button
        size="small"
        variant="quiet"
        icon="copy"
        aria-label={t("ui.screens-records.recorddetailspage-copy-id")}
        onClick={() => p.onCopy?.("id")}
      />
    </div>
  );
  // A row with a pin: the button shows on hover or focus, and stays while pinned.
  // The row takes focus on a tap (tabIndex -1), so a phone reveals it too.
  const stickRow = (key: RecordStickKey, children: ReactNode) =>
    p.onStick ? (
      <div
        className="t-b-stick"
        tabIndex={-1}
        data-stuck={stuck.includes(key) || undefined}
        data-testid={`head-${key}`}
        ref={(el) => {
          rowRefs.current[key] = el;
        }}
      >
        <div className="t-b-stick__body">{children}</div>
        {pinButton(key)}
      </div>
    ) : (
      children
    );
  // Only rows still pinned: a row unpinned since the last measure leaves at once.
  const shown = gone.filter((k) => stuck.includes(k));
  useHeightVar("--t-b-stuck-h", stripInner, pageRef, shown.length > 0);
  useHeightVar("--t-b-chips-h", chipsRef, pageRef, mobile && tab !== "raw");
  const strip = p.onStick ? (
    <div className="t-b-stuck" ref={stripRef}>
      {shown.length ? (
        <div
          ref={stripInner}
          className="t-b-stuck__inner t-float"
          role="region"
          aria-label={t("ui.screens-records.recorddetailspage-pinned-top")}
          data-testid="record-stuck"
        >
          {RECORD_STICK_KEYS.filter((k) => shown.includes(k)).map((k) => (
            <div key={k} className="t-b-stick t-b-stuck__row" data-stuck data-testid={`stuck-${k}`}>
              <div className="t-b-stick__body">
                {k === "path" ? (
                  path(true)
                ) : k === "status" ? (
                  status
                ) : k === "name" ? (
                  <span className="t-b-stuck__name t-wrap">{r.slug}</span>
                ) : (
                  idRow
                )}
              </div>
              {pinButton(k)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  const head = (
    <header className="t-b-record__head t-stagger">
      {stickRow("path", path(false))}
      {stickRow("status", status)}
      {stickRow("name", <h1 className="t-b-record__title">{r.slug}</h1>)}
      {stickRow("id", idRow)}
      {r.summary ? (
        <p className="t-b-record__summary t-clamp-3">{prose(r.summary)}</p>
      ) : (
        <p className="t-b-record__summary t-muted">
          {t("ui.screens-records.recorddetailspage-no-summary-record")}
        </p>
      )}
      <div className="t-b-record__meta t-meta">
        <span>
          <Icon name="team" size={12} />{" "}
          {r.owner ?? t("ui.screens-records.recorddetailspage-no-team")}
        </span>
        <span>
          {t("ui.screens-records.recorddetailspage-created-date", {
            date: dateText(r.createdAt, t),
          })}
        </span>
        {r.logCount == null || r.logIncomplete ? (
          <span
            data-testid="record-history-unmeasured"
            title={t("ui.screens-records.recorddetailspage-not-measured")}
          >
            — · {t("ui.screens-records.recorddetailspage-history-not-read-not-measured")}
          </span>
        ) : (
          <span>
            {plural("ui.screens-records.recorddetailspage-count-commits", r.logCount)} ·{" "}
            {t("ui.screens-records.recorddetailspage-last-date", { date: dateText(lastChange, t) })}
          </span>
        )}
      </div>
      <div className="t-row t-row--wrap t-b-record__actions">
        <Button icon="chat" variant="primary" onClick={p.onAsk}>
          {t("ui.screens-records.recorddetailspage-ask-atlas")}
        </Button>
        <Button
          icon="eye"
          pressed={p.tab === "raw"}
          onClick={() => p.onTab?.(p.tab === "raw" ? "record" : "raw")}
        >
          {t("ui.screens-records.recorddetailspage-view-record")}
        </Button>
      </div>
      <RecordDriftMark r={r} />
    </header>
  );

  const figures = (
    <div
      className="t-b-figures"
      role="group"
      aria-label={t("ui.screens-records.recorddetailspage-key-figures")}
    >
      <Figure
        icon="shield"
        label={t("ui.screens-records.recorddetailspage-promises-test-names")}
        value={r.scenarioCount ? r.provenCount : null}
        of={r.scenarioCount || undefined}
        tone={r.scenarioCount && r.provenCount === r.scenarioCount ? "ok" : "warn"}
        foot={
          <ProofMosaic
            label={t("ui.screens-records.recorddetailspage-proven-total-promises-named-test", {
              proven: r.provenCount,
              total: r.scenarioCount,
            })}
            cells={Array.from({ length: r.scenarioCount }, (_, i) => ({
              id: `z${i}`,
              proven: i < r.provenCount,
            }))}
            size={mobile ? 8 : 10}
          />
        }
      />
      <Figure
        icon="anchor"
        label={t("ui.screens-records.recorddetailspage-anchors")}
        value={r.anchorCount}
        tone={r.anchorCount || assumption ? undefined : "plan"}
        foot={
          <span className="t-meta">
            {r.anchorCount
              ? `${plural("ui.screens-records.recorddetailspage-count-files", files)}${
                  r.anchors.length < r.anchorCount ? "+" : ""
                }`
              : assumption
                ? t("ui.screens-records.recorddetailspage-not-expected-assumptions")
                : t("ui.screens-records.recorddetailspage-none-code-yet")}
          </span>
        }
      />
      <Figure
        icon="flask"
        label="Tests"
        value={r.testCount}
        tone={r.testCount || assumption ? undefined : "warn"}
        foot={
          <span className="t-meta">
            {Object.entries(kinds)
              .map(([k, n]) => `${n} ${k}`)
              .join(" · ") || t("ui.screens-records.recorddetailspage-none-linked")}
          </span>
        }
      />
      <Figure
        icon="bulb"
        label={t("ui.screens-records.recorddetailspage-knowledge-answered")}
        value={declaredSlots ? declaredSlots - openKnowledge : null}
        of={declaredSlots || undefined}
        tone={declaredSlots ? (openKnowledge ? "warn" : "ok") : undefined}
        foot={
          <span className="t-meta">
            {!declaredSlots
              ? t("ui.screens-records.recorddetailspage-record-declares-no-knowledge-block")
              : openKnowledge
                ? t("ui.screens-records.recorddetailspage-count-open", { count: openKnowledge })
                : t("ui.screens-records.recorddetailspage-complete")}
          </span>
        }
      />
    </div>
  );

  const banners = (
    <>
      {r.kind === "assumption" ? (
        <Banner tone="signal" icon="info">
          <strong>{t("ui.screens-records.recorddetailspage-assumption")}</strong>{" "}
          {t("ui.screens-records.recorddetailspage-something-product-relies-without-checking")}
        </Banner>
      ) : null}
      {r.lifecycle === "deprecated" ? (
        <Banner
          tone="warn"
          icon="warning"
          action={
            <Button
              size="small"
              icon="search"
              onClick={() =>
                p.onNavigate?.({ kind: "capability", id: `${r.domain}/${r.capability}` })
              }
            >
              {t("ui.screens-records.recorddetailspage-find-successor")}
            </Button>
          }
        >
          <strong>{t("ui.screens-records.recorddetailspage-deprecated")}</strong>{" "}
          {t("ui.screens-records.recorddetailspage-being-removed-new-work-does-not")}
        </Banner>
      ) : null}
      {r.lifecycle === "planned" ? (
        <Banner
          tone="plan"
          icon="pin"
          action={
            r.anchorCount === 0 ? (
              <Button size="small" icon="copy" onClick={() => p.onCopy?.("anchor")}>
                {t("ui.screens-records.recorddetailspage-copy-anchor")}
              </Button>
            ) : undefined
          }
        >
          <strong>{t("ui.screens-records.recorddetailspage-planned")}</strong>{" "}
          {r.anchorCount === 0 ? (
            <>
              {t("ui.screens-records.recorddetailspage-no-anchor-code-yet-becomes-active")}{" "}
              <code className="t-mono">{`${TAG}: ${r.id}`}</code>
              {t("ui.screens-records.recorddetailspage-label")}
            </>
          ) : (
            <>
              {t(
                "ui.screens-records.recorddetailspage-already-carries-anchors-becomes-active-soon",
              )}
            </>
          )}
        </Banner>
      ) : null}
      {r.drift.length ? (
        <Banner
          tone="warn"
          icon="offsetBlocks"
          action={
            <Button size="small" onClick={() => p.onSection?.("drift")}>
              {t("ui.screens-records.recorddetailspage-go-drift")}
            </Button>
          }
        >
          <strong>
            {plural("ui.screens-records.recorddetailspage-count-files-changed", r.drift.length)}
          </strong>{" "}
          {t("ui.screens-records.recorddetailspage-without-record-following")}
        </Banner>
      ) : null}
    </>
  );

  const promises = (
    <RecordSection
      {...sec("promises")}
      title={t("ui.screens-records.recorddetailspage-promises")}
      meta={
        r.scenarioCount
          ? t("ui.screens-records.recorddetailspage-proven-total-test-named-percent", {
              proven: r.provenCount,
              total: r.scenarioCount,
              percent: pctText(provenPct, t),
            })
          : t("ui.screens-records.recorddetailspage-none")
      }
      actions={
        r.scenarios.length ? (
          <>
            <Segment
              label={t("ui.screens-records.recorddetailspage-filter-promises")}
              value={filter}
              options={[
                { value: "all", label: t("ui.screens-records.recorddetailspage-all") },
                {
                  value: "open",
                  label: t("ui.screens-records.recorddetailspage-open-count", {
                    count: r.scenarioCount - r.provenCount,
                  }),
                },
                {
                  value: "proven",
                  label: t("ui.screens-records.recorddetailspage-test-named"),
                },
              ]}
              onChange={p.onScenarioFilter}
            />
            {classified ? (
              <Segment
                label={t("ui.screens-records.recorddetailspage-readership")}
                value={audience}
                options={[
                  { value: "all", label: t("ui.screens-records.recorddetailspage-all") },
                  { value: "product", label: t("ui.screens-records.recorddetailspage-product") },
                  {
                    value: "engineering",
                    label: t("ui.screens-records.recorddetailspage-engineering"),
                  },
                ]}
                onChange={(v) => p.onAudienceFilter?.(v as RecordAudienceFilter)}
              />
            ) : null}
          </>
        ) : undefined
      }
    >
      {classified && unclassified ? (
        <p className="t-meta" data-testid="record-unclassified">
          {t("ui.screens-records.recorddetailspage-count-total-promises-without", {
            count: unclassified,
            total: r.scenarioCount,
          })}
        </p>
      ) : null}
      {r.scenarios.length === 0 ? (
        <p className="t-muted">
          {r.kind === "assumption"
            ? t("ui.screens-records.recorddetailspage-assumption-makes-no-promises")
            : t("ui.screens-records.recorddetailspage-record-names-no-scenario-yet")}
        </p>
      ) : scenarios.length === 0 ? (
        <p className="t-muted" data-testid="record-none-in-selection">
          {audience !== "all"
            ? t("ui.screens-records.recorddetailspage-no-promise-readership-audience", {
                audience: t(AUDIENCE_NAME[audience]),
              })
            : t("ui.screens-records.recorddetailspage-no-promise-selection")}
        </p>
      ) : (
        <div className="t-b-scns t-stagger">
          {scenarios.map((s) => (
            <ScenarioCard
              key={s.id}
              s={s}
              onOpenTest={p.onOpenTest}
              render={prose}
              onOpenRule={openBusinessRule}
            />
          ))}
        </div>
      )}
      {r.scenarios.length < r.scenarioCount ? (
        <div className="t-b-more">
          <span className="t-meta">
            {t("ui.screens-records.recorddetailspage-shown-total-shown", {
              shown: r.scenarios.length,
              total: r.scenarioCount,
            })}
          </span>
          <Button
            size="small"
            variant="quiet"
            iconAfter="chevronDown"
            onClick={() => p.onMore?.("scenarios")}
          >
            {t("ui.screens-records.recorddetailspage-show-all-count", { count: r.scenarioCount })}
          </Button>
        </div>
      ) : null}
    </RecordSection>
  );

  const code = (
    <RecordSection
      {...sec("code")}
      title={t("ui.screens-records.recorddetailspage-code")}
      meta={plural("ui.screens-records.recorddetailspage-count-anchors", r.anchorCount)}
    >
      {r.anchors.length === 0 && assumption ? (
        <p className="t-muted">
          {t("ui.screens-records.recorddetailspage-assumption-carries-no-anchor")}
        </p>
      ) : r.anchors.length === 0 ? (
        <div className="t-b-noanchor">
          <p className="t-muted">
            {t("ui.screens-records.recorddetailspage-no-source-carries-record")}
          </p>
          <CodeView
            label={t("ui.screens-records.recorddetailspage-anchor-insert")}
            lang="go"
            text={`// ${TAG}: ${r.id}\n// ${TAG}-role: primary`}
          />
        </div>
      ) : (
        <>
          <Distribution
            label={t("ui.screens-records.recorddetailspage-anchors-role")}
            parts={Object.entries(roles).map(([k, n]) => ({
              key: k || "none",
              label: roleLabel(k, t),
              value: n,
              tone:
                k === "primary"
                  ? "var(--t-signal)"
                  : k === "config"
                    ? "var(--t-plan)"
                    : k === "data"
                      ? "var(--t-ok)"
                      : "var(--t-line-strong)",
            }))}
          />
          <ul
            className="t-b-anchors"
            aria-label={t("ui.screens-records.recorddetailspage-anchors")}
          >
            {r.anchors.map((a) => (
              <li key={`${a.path}:${a.line}`}>
                <button
                  type="button"
                  className="t-b-anchor"
                  aria-current={
                    p.openFile && p.openFile.path === a.path && p.openFile.line === a.line
                      ? "true"
                      : undefined
                  }
                  data-testid={`anchor-${a.path}:${a.line}`}
                  onClick={() => p.onOpenAnchor?.(a)}
                >
                  <Icon name={a.role === "config" ? "settings" : "code"} size={14} />
                  <span className="t-mono t-b-anchor__path">
                    <span className="t-muted">{a.path.slice(0, a.path.lastIndexOf("/") + 1)}</span>
                    {a.path.slice(a.path.lastIndexOf("/") + 1)}
                    <span className="t-b-anchor__line">:{a.line}</span>
                  </span>
                  <Badge
                    plain
                    tone={
                      a.role === "primary" ? "signal" : a.role === "config" ? "plan" : "neutral"
                    }
                  >
                    {roleLabel(a.role, t)}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
          {r.anchors.length < r.anchorCount ? (
            <div className="t-b-more">
              <span className="t-meta">
                {t("ui.screens-records.recorddetailspage-shown-total-shown", {
                  shown: r.anchors.length,
                  total: r.anchorCount,
                })}
              </span>
              <Button
                size="small"
                variant="quiet"
                iconAfter="chevronDown"
                onClick={() => p.onMore?.("anchors")}
              >
                {t("ui.screens-records.recorddetailspage-show-all-count", { count: r.anchorCount })}
              </Button>
            </div>
          ) : null}
          {p.openFile ? (
            <SourceEditor
              file={p.openFile}
              recordId={r.id}
              zoom={p.codeZoom}
              onZoom={p.onCodeZoom}
              onClose={closeFile}
            />
          ) : null}
        </>
      )}
    </RecordSection>
  );

  const knowledge = (
    <RecordSection
      {...sec("knowledge")}
      title={t("ui.screens-records.recorddetailspage-knowledge")}
      meta={
        declaredSlots ? (
          <span data-testid="knowledge-count">
            {t("ui.screens-records.recorddetailspage-answered-declared-answered", {
              answered: declaredSlots - openKnowledge,
              declared: declaredSlots,
            })}
          </span>
        ) : undefined
      }
    >
      {!knowledgeDeclared ? (
        <p className="t-muted" data-testid="knowledge-no-block">
          {t("ui.screens-records.recorddetailspage-record-declares-no-knowledge-block")}
        </p>
      ) : declaredSlots && openKnowledge === declaredSlots ? (
        <p className="t-muted" data-testid="knowledge-unanswered">
          {plural(
            "ui.screens-records.recorddetailspage-count-slots-declared-none-answered",
            declaredSlots,
          )}
        </p>
      ) : null}
      <div className="t-b-know">
        {KNOWLEDGE_SLOTS.filter(
          (slot) => knowledgeDeclared && r.knowledge.some((k) => k.key === slot.key),
        ).map((slot) => {
          const answer = r.knowledge.find((k) => k.key === slot.key)?.answer ?? null;
          return (
            <article
              key={slot.key}
              className={cx("t-b-slot", !answer && "t-b-slot--open")}
              data-testid={`slot-${slot.key}`}
            >
              <header className="t-row">
                <span className="t-h3">{t(slot.label)}</span>
                <span className="t-spacer" />
                {answer ? null : (
                  <Badge tone="warn">{t("ui.screens-records.recorddetailspage-open")}</Badge>
                )}
              </header>
              <p className="t-b-slot__q">{t(slot.question)}</p>
              {answer ? (
                <p className="t-b-slot__a">{prose(answer)}</p>
              ) : (
                <Button size="small" icon="edit" onClick={() => p.onAnswer?.(slot.key)}>
                  {t("ui.screens-records.recorddetailspage-propose-answer")}
                </Button>
              )}
            </article>
          );
        })}
      </div>
    </RecordSection>
  );

  const driftStrength = (
    <RecordSection
      {...sec("drift")}
      title={t("ui.screens-records.recorddetailspage-drift")}
      meta={
        r.drift.length
          ? plural("ui.screens-records.recorddetailspage-count-files-text", r.drift.length)
          : undefined
      }
    >
      {r.drift.length === 0 ? (
        <p className="t-b-calm">
          <Icon name="check" size={14} className="t-ok" />{" "}
          {t("ui.screens-records.recorddetailspage-no-drift-no-anchored-file-moved")}
        </p>
      ) : (
        <ul className="t-b-drift">
          {r.drift.map((d) => (
            <li key={d.path}>
              <Icon name="file" size={14} />
              <span className="t-mono t-wrap">{d.path}</span>
              <span className="t-meta">
                {t("ui.screens-records.recorddetailspage-changed-date", {
                  date: dateText(d.changedAt, t),
                })}
              </span>
              <span className="t-spacer" />
              <Button
                size="small"
                variant="quiet"
                icon="eye"
                onClick={() => p.onOpenDrift?.(d.path)}
              >
                {t("ui.screens-records.recorddetailspage-change")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </RecordSection>
  );

  const history = (
    <RecordSection
      {...sec("history")}
      title={t("ui.screens-records.recorddetailspage-history")}
      meta={
        r.logCount == null || r.logIncomplete
          ? "—"
          : plural("ui.screens-records.recorddetailspage-count-commits", r.logCount)
      }
      actions={
        r.log?.length ? (
          <CommitSpark dates={r.log.map((c) => c.date)} now={p.now ?? "2026-11"} />
        ) : undefined
      }
    >
      {r.log == null || r.logCount == null ? (
        <p
          className="t-muted"
          data-testid="record-log-unmeasured"
          title={t("ui.screens-records.recorddetailspage-not-measured")}
        >
          — · {t("ui.screens-records.recorddetailspage-history-not-read-not-measured")}
        </p>
      ) : r.logIncomplete ? (
        <p className="t-muted" data-testid="record-log-incomplete">
          — · {t("ui.screens-records.recorddetailspage-history-incomplete-not-measured")}
        </p>
      ) : !r.log.length ? (
        <p className="t-muted" data-testid="record-log-empty">
          {t("ui.screens-records.recorddetailspage-no-commit-touched-record-last-count", {
            count: r.logWindow ?? 0,
          })}
        </p>
      ) : (
        <ol className="t-b-log">
          {r.log.map((c) => (
            <li key={c.sha}>
              <span className="t-b-log__dot" aria-hidden="true" />
              <span className="t-mono t-meta">{dateText(c.date, t)}</span>
              <button
                type="button"
                className="t-b-link t-mono"
                onClick={() => p.onOpenCommit?.(c.sha)}
              >
                {c.sha}
              </button>
              <span className="t-b-log__subject">{c.subject}</span>
            </li>
          ))}
        </ol>
      )}
      {r.log && r.logCount != null && r.log.length < r.logCount ? (
        <div className="t-b-more">
          <span className="t-meta">
            {t("ui.screens-records.recorddetailspage-shown-total-shown", {
              shown: r.log.length,
              total: r.logCount,
            })}
          </span>
          <Button
            size="small"
            variant="quiet"
            iconAfter="chevronDown"
            onClick={() => p.onMore?.("log")}
          >
            {t("ui.screens-records.recorddetailspage-show-whole-history")}
          </Button>
        </div>
      ) : null}
    </RecordSection>
  );

  const linkList = (title: string, links: RecordLink[], empty: string) => (
    <div className="t-stack" style={{ gap: 6 }}>
      <span className="t-label">
        {title} <span className="t-meta">{links.length}</span>
      </span>
      {links.length ? (
        <div className="t-row t-row--wrap" style={{ gap: 6 }}>
          {links.map((l) =>
            l.missing ? (
              <span
                key={l.id}
                className="t-mono t-meta t-b-brule__ghost"
                data-testid="link-missing"
                title={t("ui.screens-records.recorddetailspage-registry-declares-no-such-record")}
              >
                {l.id}
              </span>
            ) : (
              <Chip key={l.id} mono onClick={() => p.onNavigate?.({ kind: "record", id: l.id })}>
                {l.id}
              </Chip>
            ),
          )}
        </div>
      ) : (
        <span className="t-muted">{empty}</span>
      )}
    </div>
  );

  const relations = (
    <RecordSection
      {...sec("relations")}
      title={t("ui.screens-records.recorddetailspage-dependencies-variants")}
    >
      {r.cyclic ? (
        <div data-testid="record-cyclic">
          <Banner tone="warn" icon="warning">
            {t("ui.screens-records.recorddetailspage-record-dependency-cycle-downstream-one")}
          </Banner>
        </div>
      ) : null}
      {!mobile && (r.dependsOn.length || r.dependents.length) ? (
        <DependencyGraph
          center={r.id}
          upstream={r.dependsOn.map((d) => d.id)}
          downstream={r.dependents.map((d) => d.id)}
          onOpen={(id) => {
            const all = [...r.dependsOn, ...r.dependents];
            if (!all.some((l) => l.id === id && l.missing)) p.onNavigate?.({ kind: "record", id });
          }}
        />
      ) : null}
      <div className="t-b-rel">
        {linkList(
          t("ui.screens-records.recorddetailspage-needs"),
          r.dependsOn,
          t("ui.screens-records.recorddetailspage-nothing"),
        )}
        {linkList(
          t("ui.screens-records.recorddetailspage-needed"),
          r.dependents,
          t("ui.screens-records.recorddetailspage-nobody"),
        )}
        {linkList(
          t("ui.screens-records.recorddetailspage-variants"),
          r.variants,
          t("ui.screens-records.recorddetailspage-none"),
        )}
      </div>
      {r.decisions !== undefined ? (
        <DecisionList decisions={r.decisions} onOpen={p.onOpenDecision} />
      ) : null}
    </RecordSection>
  );

  const operations = (
    <RecordSection
      {...sec("operations")}
      title={t("ui.screens-records.recorddetailspage-operations")}
    >
      {r.observed ? (
        <p className="t-b-calm">
          <Badge tone="ok">{t("ui.screens-records.recorddetailspage-observed")}</Badge>{" "}
          {t("ui.screens-records.recorddetailspage-record-names-signals-operations-values-not")}
        </p>
      ) : (
        <p className="t-b-calm t-muted">
          <span className="t-mono">—</span>{" "}
          {t("ui.screens-records.recorddetailspage-not-measured-record-describes-no")}
        </p>
      )}
    </RecordSection>
  );

  // The record's references beside its business rules: the rule records, the
  // assumptions and the data shapes its lineage names. Each kind is labelled
  // once a second kind stands beside it.
  const refGroups = [
    {
      key: "rules",
      label: t("ui.screens-records.recorddetailspage-rule-records"),
      icon: "checklist" as const,
      items: r.rules,
    },
    {
      key: "assumptions",
      label: t("ui.screens-records.recorddetailspage-assumptions"),
      icon: "beaker" as const,
      items: r.assumptions ?? [],
    },
    {
      key: "data-shapes",
      label: t("ui.screens-records.recorddetailspage-data-shapes"),
      icon: "table" as const,
      items: r.dataShapes ?? [],
    },
  ].filter((g) => g.items.length);
  const labelled = r.businessRules !== undefined || refGroups.length > 1;
  const total = referenceCount(r);
  const rules = (
    <RecordSection
      {...sec("rules")}
      title={t("ui.screens-records.recorddetailspage-rules-assumptions-data-shapes")}
      meta={total ? `${total}` : undefined}
    >
      {r.businessRules !== undefined ? (
        <div className="t-stack" style={{ gap: 8 }} data-testid="business-rules">
          <span className="t-label">
            {t("ui.screens-records.recorddetailspage-business-rules")}{" "}
            {r.businessRules ? <span className="t-meta">{r.businessRules.length}</span> : null}
          </span>
          <BusinessRuleList rules={r.businessRules} render={prose} onOpenScenario={openScenario} />
        </div>
      ) : null}
      {refGroups.map((g) => (
        <div key={g.key} className="t-stack" style={{ gap: 4 }}>
          {labelled ? (
            <span className="t-label">
              {g.label} <span className="t-meta">{g.items.length}</span>
            </span>
          ) : null}
          <ReferenceList
            items={g.items}
            icon={g.icon}
            testId={`references-${g.key}`}
            onOpen={p.onOpenRule}
          />
        </div>
      ))}
      {refGroups.length || r.businessRules?.length ? null : (
        <p className="t-muted">
          {r.assumptions !== undefined || r.dataShapes !== undefined
            ? t("ui.screens-records.recorddetailspage-record-names-no-rule-no-assumption")
            : t("ui.screens-records.recorddetailspage-no-rule-names-record")}
        </p>
      )}
    </RecordSection>
  );

  const raw = (
    <div className="t-b-raw t-anim-rise">
      <div className="t-row t-row--wrap" style={{ gap: 10 }}>
        <Segment
          label="Format"
          value={p.rawFormat ?? "yaml"}
          options={[
            { value: "yaml", label: "YAML" },
            { value: "json", label: "JSON" },
          ]}
          onChange={p.onRawFormat}
        />
        <span className="t-meta t-wrap">
          {t("ui.screens-records.recorddetailspage-docs-facets-features-id-yaml", { id: r.id })}
        </span>
        <span className="t-spacer" />
        <CodeZoom value={p.codeZoom} onChange={p.onCodeZoom} />
        <Button size="small" icon="copy" onClick={() => p.onCopy?.("raw")}>
          {t("ui.screens-records.recorddetailspage-copy")}
        </Button>
      </div>
      <CodeView
        label={t("ui.screens-records.recorddetailspage-record-format", {
          format: p.rawFormat === "json" ? "JSON" : "YAML",
        })}
        lang={p.rawFormat === "json" ? "json" : "yaml"}
        text={p.rawFormat === "json" ? r.json : r.yaml}
        zoom={p.codeZoom}
      />
    </div>
  );

  const current = p.section ?? "promises";
  const pick = (k: string) => {
    p.onSection?.(k as RecordSectionKey);
    jumpTo(k as RecordSectionKey);
  };
  return (
    <div
      ref={pageRef}
      className={cx(
        "t-page t-b-record t-anim-focus",
        mobile && "t-b-record--mobile",
        p.lookup && !mobile && p.tab !== "raw" && "t-b-record--lookup",
      )}
      data-testid="record"
    >
      {strip}
      {/** i18n-spacing: joined */}
      {head}
      {/** i18n-spacing: joined */}
      {figures}
      {/** i18n-spacing: joined */}
      {banners}
      <Tabs
        label={t("ui.screens-records.recorddetailspage-view")}
        value={p.tab}
        items={[
          { value: "record", label: t("ui.screens-records.recorddetailspage-record") },
          { value: "raw", label: t("ui.screens-records.recorddetailspage-raw") },
        ]}
        onChange={p.onTab}
      />
      {p.tab === "raw" ? (
        raw
      ) : (
        <div className="t-b-record__body">
          {mobile ? (
            <SectionChips items={items} current={current} onPick={pick} navRef={chipsRef} />
          ) : (
            <aside className="t-b-record__rail">
              <SectionRail items={items} current={current} onPick={pick} />
              <div className="t-b-record__railfoot t-meta">
                {t(LIFECYCLE[r.lifecycle].label)} ·{" "}
                {r.owner ?? t("ui.screens-records.recorddetailspage-no-team")}
              </div>
            </aside>
          )}
          <div className="t-b-record__main" ref={mainRef}>
            {promises}
            {/** i18n-spacing: joined */}
            {code}
            {/** i18n-spacing: joined */}
            {knowledge}
            {/** i18n-spacing: joined */}
            {driftStrength}
            {/** i18n-spacing: joined */}
            {history}
            {/** i18n-spacing: joined */}
            {relations}
            {/** i18n-spacing: joined */}
            {operations}
            {/** i18n-spacing: joined */}
            {rules}
          </div>
          {p.lookup ? (
            <RecordLookup
              target={p.lookup}
              mobile={mobile}
              render={prose}
              onClose={p.onCloseLookup}
              onFollow={p.onFollowLookup}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
