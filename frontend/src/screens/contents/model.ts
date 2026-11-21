/** View models of group C (contents, glossary, settings). Plain data only:
 * the app derives these from the Atlas model, stories derive them from fixtures. */

import { type IconName } from "@facet-tools/ui";

export type Tone = "ok" | "warn" | "plan" | "bad" | "signal" | "neutral";

export type ViewDef<V extends string> = { value: V; label: string; icon: IconName };

/** Contents hub ------------------------------------------------------------ */

export type ContentKindKey =
  | "promises"
  | "knowledge"
  | "operations"
  | "provenance"
  | "taxonomy"
  | "calibration"
  | "tests"
  | "deviations"
  | "drift"
  | "fixed"
  | "anchor"
  | "files"
  | "rules"
  | "data-shapes"
  | "glossary"
  | "cycles"
  | "read-errors"
  | "decisions";

export type ContentGroup = "Registry" | "Evidence" | "Code" | "Context";

export type ContentKind = {
  key: ContentKindKey;
  label: string;
  group: ContentGroup;
  icon: IconName;
  desc: string;
  /** `null` = not measured; never rendered as 0. */
  count: number | null;
  unit: string;
  /** One short finding, e.g. "83 open". */
  finding?: string;
  tone?: Tone;
  /** Share between 0 and 1 drawn as a meter; `null` = not measured. */
  share?: number | null;
  /** A small series for the tile's sparkline. */
  spark?: number[];
  /** The views a tile opens; `id` is what `onOpen` reports, `label` is the visible name. */
  views: { id: string; label: string }[];
};

/** Promises ---------------------------------------------------------------- */

export type PromiseState = "proven" | "open" | "deviation";

export type PromiseItem = {
  key: string;
  recordId: string;
  scenarioId: string;
  text: string;
  state: PromiseState;
  tests: { name: string; kind: string }[];
};

export type PromiseRecord = {
  id: string;
  domain: string;
  cells: { scenarioId: string; state: PromiseState }[];
};

/** Knowledge --------------------------------------------------------------- */

export type KnowledgeRow = {
  id: string;
  domain: string;
  /** Five slots; `null` is an open slot. Strings are the first words of the answer. */
  slots: (string | null)[];
  /** The whole answer per slot, in slot order; absent means the card shows `slots`. */
  answers?: (string | null)[];
  /** Slots the record answers in words; a derived or inapplicable slot is not one. */
  answered?: number;
  /** Slots the record's `knowledge` block declares. */
  declared?: number;
};

/** Operations -------------------------------------------------------------- */

export type OpsEntry = {
  key: string;
  recordId: string;
  kind: "SLO" | "Alert" | "ContinuousCheck";
  name: string;
  target: string;
  window?: string;
  source: string;
};

/** Provenance -------------------------------------------------------------- */

export type TeamProvenance = {
  id: string;
  name: string;
  purpose?: string;
  records: number;
  proven: number;
  domains: { id: string; records: number }[];
  recent: { id: string; date: string }[];
};

export type DayCount = { date: string; count: number; ids?: string[] };

/** Taxonomy ---------------------------------------------------------------- */

export type TaxCapability = {
  id: string;
  title: string;
  records: number;
  proven: number;
  scenarios: number;
};
export type TaxDomain = {
  id: string;
  title: string;
  purpose: string;
  klass: string;
  team: string;
  capabilities: TaxCapability[];
};

/** Calibration ------------------------------------------------------------- */

export type CalibrationMetric = {
  key: string;
  label: string;
  unit: string;
  median: number;
  min: number;
  max: number;
  samples: number;
  below: number;
  above: number;
  band: { low: number; high: number };
  /** Individual values when measured, for the dot strip. */
  values?: number[];
};

export type Outlier = {
  metric: string;
  id: string;
  value: number;
  side: "above" | "below";
  band: string;
};

/** Tests ------------------------------------------------------------------- */

export type TestKind = "Unit" | "Integration" | "E2E";

export type TestFileRow = {
  path: string;
  kind: TestKind;
  tests: number;
  promises: number;
  records: string[];
};

export type TestRunner = { id: string; cwd: string; command: string; report: string };

/** Deviations, drift, fixed ----------------------------------------------- */

export type Deviation = {
  key: string;
  recordId: string;
  scenarioId: string;
  then: string;
  reason: string;
  confirmedBy: string | null;
  /** When the deviation was recorded; `null` = not known, shown as "—". */
  since: string | null;
};

export type DriftItem = { recordId: string; path: string; changedAt: string };

export type FixCommit = {
  sha: string;
  date: string;
  subject: string;
  scope: string | null;
  ticket: string | null;
  records: string[];
  domain: string;
  /** Files the fix touched; `null` when the host did not report them ("not measured"). */
  files?: string[] | null;
  /** Who recorded the fix; `null` when the host did not report it. */
  recordedBy?: string | null;
};

/** Anchors and files ------------------------------------------------------- */

export type AnchorRole = "primary" | "related" | "config" | "data" | "none";

export type AnchorDir = { path: string; anchors: number; files: number; records: number };

/** `orphan`: no record carries this id, so the id is shown but leads nowhere. */
export type AnchorRow = {
  path: string;
  line: number;
  role: AnchorRole;
  recordId: string;
  orphan?: boolean;
};

export type FileNode = {
  path: string;
  name: string;
  /** Files carrying at least one anchor (measured from the anchors). */
  anchored: number;
  /** Share of anchored files in the directory; `null` = not measured. */
  share: number | null;
  children?: FileNode[];
};

export type FileGap = {
  path: string;
  /** Lines of code; `null` or absent when the scan did not measure them. */
  loc?: number | null;
  dir: string;
  dirAnchoredPct: number;
};

/** Rules ------------------------------------------------------------------- */

export type RuleItem = {
  id: string;
  title: string;
  statement: string;
  strength: "must" | "should" | "may";
  appliesTo: string[];
  source: string;
  /** `null` = not checked; never shown as "kept". */
  violations: number | null;
};

/** Cycles, unread records, decisions ------------------------------------------- */

/** A node the host reports on a dependency cycle or downstream of one. */
export type CycleNode = {
  id: string;
  /** The record's summary; `null` when no record was read for this id. */
  summary: string | null;
};

/** A file the run could not read as a record. */
export type UnreadRecord = { path: string; message: string; line?: number };

/** A decision document records name in `intent.decision_records`. */
export type DecisionTarget = { target: string; count: number; recordIds: string[] };

/** Glossary ---------------------------------------------------------------- */

export type GlossaryTerm = {
  term: string;
  definition: string;
  category: string;
  aliases: string[];
  records: number;
  status: "settled" | "proposed";
};

/** A glossary category as the host computed it, in the host's order. */

export type GlossaryGroup = {
  id: string;
  title?: string;
  purpose?: string;
  state: "ok" | "empty" | "undeclared" | "none";
  /** The terms shown under the heading, after any filter. */
  terms: GlossaryTerm[];
  /** Every term under the heading, filter or not. */
  total: number;
};

export type GlossaryTermDetail = GlossaryTerm & {
  recordIds: string[];
  occurrences: { path: string; line: number; excerpt: string }[];
  related: string[];
  history: { date: string; who: string; change: string }[];
  translation?: string;
  /** How the term's category stands, where the glossary groups at all:
   * `declared` names the declared title, `undeclared` an id the glossary does
   * not declare, `unassigned` a term that names none. Absent: no category line. */

  categoryState?: "declared" | "undeclared" | "unassigned";
};

export type TermProposal = {
  term: string;
  definition: string;
  category: string;
  aliases: string;
  records: string[];
};

export type TermProposalErrors = Partial<Record<keyof TermProposal, string>>;

/** Settings ---------------------------------------------------------------- */

export type SettingsSectionKey =
  "appearance" | "language" | "history" | "ai" | "git-provider" | "plugins" | "genui";

export type PluginRow = {
  id: string;
  name: string;
  version: string;
  source: "bundled" | "installed" | "development";
  enabled: boolean;
  verification: "ok" | "mismatch" | "missing";
  open: number;
  desc: string;
  /** Whether the reader can switch it here. A plugin that was never loaded
   * (refused, unverified, failed to import) has nothing to switch; left out,
   * the row is switchable. */

  switchable?: boolean;
  /** Why the plugin did not load, as the host measured it; drawn as its own line. */
  reason?: string;
  /** It ran in this document and is switched off since: what its entry started
   * runs until the page loads again, so the row offers that reload. */

  reload?: boolean;
  /** Themes the host refused from this plugin, each with the host's reason. */
  themeRefusals?: readonly ThemeRefusal[];
};

/** A plugin theme the host refused: the theme's name and why. */
export type ThemeRefusal = { name: string; reason: string };

export type GrantItem = {
  key: string;
  group: "Tools" | "Environment" | "Agent tools";
  name: string;
  /** Who executes it: the host or a sidecar binary. */
  via: string;
  why: string;
  state: "granted" | "open" | "refuses";
  risk?: "writes" | "reads" | "network";
};
