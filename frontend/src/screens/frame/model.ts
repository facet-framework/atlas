/** View models of group A (frame, overview, product, overviews). Plain data:
 * the app derives them from the Atlas model, stories derive them from fixtures. */

export type Tone = "ok" | "warn" | "plan" | "bad";

/** What a scenario's evidence is: a test proves it, it is declared without
 * data (`unbacked`), or nothing proves it yet (`open`). */

export type ScenarioState = "proven" | "unbacked" | "open";

/** A feature as the overview pages see it. */
export type FeatureView = {
  id: string;
  slug: string;
  domain: string;
  capability: string;
  summary: string;
  type: "feature" | "assumption";
  lifecycle: "active" | "planned" | "deprecated";
  owner: string | null;
  createdAt: string | null;
  scenarios: number;
  proven: number;
  anchors: number;
  tests: number;
  drift: number;
  knowledgeOpen: number;
  /** Whether this record declares a Knowledge block. */
  knowledgeMeasured?: boolean;
  /** Filled flag per Knowledge slot, in slot order; absent when not known. */
  knowledgeSlots?: boolean[];
  /** Proven flag per scenario, in record order (for the proof mosaic). */
  mosaic?: boolean[];
  /** State per scenario, in record order; absent when only counts are known. */
  scenarioStates?: ScenarioState[];
  changedAt?: string;
};

export type CapabilityView = {
  id: string;
  title: string;
  purpose: string;
  cls: string;
};

export type DomainView = {
  id: string;
  title: string;
  purpose: string;
  cls: string;
  team: string;
  capabilities: CapabilityView[];
};

export type DriftView = { path: string; record: string; changedAt: string };

export type CalibrationView = {
  key: string;
  label: string;
  median: number;
  low: number;
  high: number;
  min: number;
  max: number;
  samples: number;
  below: number;
  above: number;
};

export type TestMix = { unit: number; integration: number; e2e: number };

export type TrendPoint = { date: string; scenarios: number; proven: number };

export type CommitView = { date: string; sha: string; subject: string; record: string };

export type AdrView = { file: string; title: string; status: string; date: string; refs: string[] };

export type OwnerView = { team: string; records: number; scenarios: number; proven: number };

export type ToolView = { name: string; purpose: string; calls: number | null };

/** A promise (scenario) without a test, in the record it belongs to. */
export type OpenScenarioView = { record: string; scenario: string; then: string };

/** A declared defect: a scenario the record marks as behaviour nobody wants. */
export type DeviationView = { record: string; scenario: string; then: string; reason: string };

/** A fix from a record's defect register. `subject` is the row's title, already
 * cut by the app; `""` when the commit carries no usable subject, which the
 * page says in words. `full` is the whole subject as recorded, for the row's
 * title attribute. */

export type FixView = { record: string; subject: string; date: string; full?: string };

/** How many other records depend on this one. */
export type ReachView = { record: string; team: string | null; dependents: number };

/** An answer an owner wrote into a record's knowledge block. */
export type FaqView = {
  record: string;
  slot: string;
  question: string;
  answer: string;
  /** `YYYY-MM-DD` of the feature's newest change (record or anchored code).
   * Absent or `null` when the host sent no history: no date is then shown,
   * because a date nobody measured is not written. */

  changed?: string | null;
};

/** A knowledge kind no record answers: open, with how many records could close
 * it and the teams that hold them. */

export type FaqGapView = { slot: string; records: number; teams: string[] };

/** An endpoint of the local host an agent can fetch more from. */
export type EndpointView = { method: string; path: string; purpose: string };

/** Everything the overview page (Overview) needs, for every role. */
export type OverviewModel = {
  project: { name: string; branch: string; commit: string; generatedAt: string; version: string };
  lint?: {
    schema: boolean | null;
    anchors: boolean | null;
    proves: boolean | null;
    orphanAnchors: number | null;
  };
  totals: {
    records: number;
    features: number;
    assumptions: number;
    domains: number;
    capabilities: number;
    scenarios: number;
    proven: number;
    anchors: number;
    /** Files in the scan; `null` = not measured, never zero. */
    files: number | null;
    anchoredFiles: number;
    /** Lines of code in the scan; `null` = not measured, never zero. */
    loc: number | null;
  };
  domains: (DomainView & {
    features: number;
    scenarios: number;
    proven: number;
    drift: number;
    knowledgeOpen: number;
  })[];
  features: FeatureView[];
  drift: DriftView[];
  /** `false` when the host reported no drift comparison: not measured, not zero. */
  driftMeasured?: boolean;
  calibration: CalibrationView[];
  /** `null` when no runner reported — not measured, never zero. */
  tests: TestMix | null;
  trend: TrendPoint[];
  /** `null` = history not read; `[]` = read, no commits. */
  recent: CommitView[] | null;
  adrs: AdrView[];
  owners: OwnerView[];
  unowned: number;
  /** The MCP server's own tool names. `null` = not listed: either not asked
   * (no reason) or the server could not answer (`toolsReason`) — never an
   * empty list, which would claim the server offers no tools. */

  tools: ToolView[] | null;
  toolsReason?: string | null;
  /** The role surfaces below are optional: a view model without one shows the
   * section as not measured, never as empty. */

  /** Open promises of the records whose files drifted. */
  driftUnproven?: OpenScenarioView[];
  /** Declared defects, in register order. */
  deviations?: DeviationView[];
  /** Fixes, newest first; `null` = no defect register was read. */
  fixes?: FixView[] | null;
  /** Records by how many others depend on them, most first. */
  reach?: ReachView[];
  /** Knowledge answers the owners wrote. */
  faq?: FaqView[];
  /** Knowledge kinds no record answers; absent = not measured. */
  faqGaps?: FaqGapView[];
  /** Endpoints of the local host. */
  endpoints?: EndpointView[];
};
