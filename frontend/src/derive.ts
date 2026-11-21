import { tx } from "@/i18n";
/** Derive presentation data from the parsed corpus and host scan. */

import {
  formatNumber,
  glossaryTermList,
  linkTerms,
  type Anchor,
  type AtlasModel,
  type GlossaryTerm,
  type DefectFix,
  type DriftEntry,
  type FacetRecord,
  type KnowledgeSlot,
  type OrphanAnchor,
  type ScannedFile,
  type Scenario,
  type ScenarioAudience,
  type ScenarioDeviation,
} from "@/model";
import { searchableParts } from "./term/parts";
import type { AudFilter, ScenFilter } from "./state";
import { sharePercent } from "./share";

/** Evidence for a claim, in the draft's three states. */
export type DerivedEvidence = "ok" | "un" | "no";

/** What a row shows about a scenario — and so the field every view hangs its
 * colour, its filter and its count on. */

export type DerivedScenarioState = DerivedEvidence | "dev";

export type DerivedScenario = {
  id: string;
  state: DerivedScenarioState;
  /** The evidence on its own, without the question whether anything is claimed
   * here. For a deviation that is the state of its proof — a characterisation
   * test is the strongest a defect can have. */

  evidence: DerivedEvidence;
  /** The declared defect (the specification) — `null` when none is declared. */

  deviation: ScenarioDeviation | null;
  /** Who the sentence is written for (`audience`) — `null` when nobody has
   * classified it. */

  audience: ScenarioAudience | null;
  /** The first test that names the claim — `null` when none does. */

  test: string | null;
  /** All tests that name the claim by name. */

  tests: string[];
  given: string;
  when: string;
  then: string;
  raw: Scenario;
};

export type DerivedObs = {
  slos: [string, string][];
  alerts: [string, string][];
  checks: [string, string][];
};

export type DerivedFeature = {
  id: string;
  rec: FacetRecord;
  life: string;
  team: string;
  created: string;
  summary: string;
  /** Anchored lines of this feature; `null` when the scan sent no file list. */
  loc: number | null;
  anchorsN: number;
  anchors: Anchor[];
  drift: DriftEntry[];
  driftN: number;
  deps: string[];
  usedBy: string[];
  fixes: DefectFix[];
  scen: DerivedScenario[];
  /** The claims: all scenarios without the declared defects. */
  claims: number;
  /** The declared defects (the specification) — counted separately, never in the ratio. */
  devs: number;
  proven: number;
  unbacked: number;
  open: number;
  /** Share of proven claims; `null` for a record without any claim. */
  grade: number | null;
  driftStrength: number;
  /** Answered knowledge slots. Empty means: the block is there but unfilled. */
  know: KnowledgeSlot[];
  hasKnow: boolean;
  obs: DerivedObs | null;
  related: { pol: string[]; asm: string[]; ent: string[] };
};

export type DerivedScan = {
  registry: string;
  root: string;
  scannedAt: string;
  files: number | null;
  loc: number | null;
  anchoredLoc: number | null;
  records: number;
  anchors: number;
};

export type DerivedTotals = {
  claims: number;
  proven: number;
  open: number;
  unbacked: number;
  /** Declared defects in the product. Its own class, never part of `claims`. */
  devs: number;
  drift: number;
  driftFeatures: number;
};

export type DerivedGlossaryGroup = {
  /** The category's id, or `""` for the terms that name none. */

  id: string;
  /** The declared label, `undefined` for `declared: false` — for a category
   * the file does not declare there is none to show. */

  title?: string;
  purpose?: string;
  /** Whether the file declares this category. That is what keeps the two
   * title-less states apart: an undeclared id (`declared: false`, `id` set)
   * is the error case the linter reports; the nameless group
   * (`declared: false`, `id` empty) is the decision that was never made. */

  declared: boolean;
  /** The terms under this heading, in the file's order. Empty under a declared
   * category is the fourth drawn state: declared, and no term names it. */

  terms: string[];
};

/** The declared vocabulary, in the shape the surface needs. */

export type DerivedGlossary = {
  /** The entries in the file's order. */
  terms: GlossaryTerm[];
  /** The same terms in search order, as `linkTerms` expects them. */
  index: string[];
  /** The groups as the host computed them — `null` when nobody groups. */

  groups: DerivedGlossaryGroup[] | null;
  /** Per term the ids of the features whose **shown** prose contains it —
   * summary, claims, knowledge answers, i.e. exactly the text in which the
   * reader links it too. An empty list means „used nowhere" and is the honest
   * state of a freshly declared term. */

  usedBy: Record<string, string[]>;
};

export type DerivedModel = {
  model: AtlasModel;
  M: DerivedFeature[];
  byId: Record<string, DerivedFeature>;
  TOT: DerivedTotals;
  /** Largest claim count of any feature — the scale of the drift band. */
  maxClaims: number;
  scan: DerivedScan;
  orphans: OrphanAnchor[];
  unanchored: ScannedFile[];
  policies: FacetRecord[];
  assumptions: FacetRecord[];
  entities: FacetRecord[];
  /** Categories (`domain/capability`) with their features, in order found. */
  cats: [string, DerivedFeature[]][];
  teams: [string, DerivedFeature[]][];
  allFixes: { f: DerivedFeature; x: DefectFix }[];
  facetrc: string;
  /** The glossary (the specification), or `null` when the project has none. */
  glossary: DerivedGlossary | null;
};

/** Last segment of an id — `infra/cicd/facet-lsp` → `facet-lsp`. */
export function short(id: string): string {
  return id.split("/").pop() ?? id;
}

export const num = formatNumber;

/** The Gherkin steps condensed into the draft's three sentences. */

export function gherkinParts(scenario: Scenario): { given: string; when: string; then: string } {
  const bucket: Record<string, string[]> = { GIVEN: [], WHEN: [], THEN: [] };
  for (const step of scenario.steps) {
    const key = step.keyword === "AND" || step.keyword === "BUT" ? step.parent : step.keyword;
    if (key && bucket[key]) bucket[key].push(step.text);
  }
  return {
    given: bucket.GIVEN.join(` ${tx("ui.root.derive-and")} `),
    when: bucket.WHEN.join(` ${tx("ui.root.derive-and")} `),
    then: bucket.THEN.join(` ${tx("ui.root.derive-and")} `),
  };
}

/** The evidence for a claim. */

export function scenarioEvidence(scenario: Scenario): DerivedEvidence {
  if (scenario.proven) return "ok";
  if (scenario.backing.state === "unbacked") return "un";
  return "no";
}

/** What the row shows — and the place where a declared defect stops looking
 * like a fulfilled claim. */

export function scenarioState(scenario: Scenario): DerivedScenarioState {
  if (scenario.deviation) return "dev";
  return scenarioEvidence(scenario);
}

function toDerivedScenario(scenario: Scenario): DerivedScenario {
  const parts = gherkinParts(scenario);
  return {
    id: scenario.id,
    state: scenarioState(scenario),
    evidence: scenarioEvidence(scenario),
    deviation: scenario.deviation,
    audience: scenario.audience,
    test: scenario.tests[0]?.id ?? null,
    // Unique and in order found: a test that names a claim twice is one proof
    // and not two.
    tests: [...new Set(scenario.tests.map((t) => t.id))],
    ...parts,
    raw: scenario,
  };
}

function obsOf(rec: FacetRecord): DerivedObs | null {
  if (!rec.slos.length && !rec.alerts.length && !rec.checks.length) return null;
  return {
    slos: rec.slos.map((s) => [String(s.id ?? "SLO"), String(s.target ?? s.window ?? "—")]),
    alerts: rec.alerts.map((a) => [
      String(a.id ?? tx("ui.root.derive-alert")),
      String(a.condition ?? a.severity ?? "—"),
    ]),
    checks: rec.checks.map((c) => [String(c.id ?? "Check"), String(c.frequency ?? "—")]),
  };
}

/** Anchored lines per feature. */

function locIndex(model: AtlasModel): Record<string, number> | null {
  const files = model.scan.anchoredFiles;
  if (!files) return null;
  const index: Record<string, number> = {};
  for (const file of files) index[file.path] = file.loc;
  return index;
}

/** The drift measure: how far apart claim and proof lie. */

export function driftOf(driftN: number, open: number): number {
  return driftN * 100 + open;
}

function facetrcText(model: AtlasModel): string {
  const lines: string[] = [];
  const walk = (value: unknown, indent: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${indent}- ${String(item)}`);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (inner && typeof inner === "object") {
          lines.push(`${indent}${key}:`);
          walk(inner, `${indent}  `);
        } else {
          lines.push(`${indent}${key}: ${String(inner)}`);
        }
      }
      return;
    }
    lines.push(`${indent}${String(value)}`);
  };
  walk(model.rc, "");
  return lines.length
    ? lines.join("\n")
    : tx("ui.root.derive-no-configuration-read-defaults-apply");
}

/** A feature's prose as the reader shows it — and so exactly the prose in which
 * it links terms. */

function shownProse(f: DerivedFeature): string[] {
  return [
    f.summary,
    ...f.scen.flatMap((s) => [s.given, s.when, s.then]),
    ...f.know.map((slot) => slot.answer ?? ""),
  ].filter(Boolean);
}

export function categoryOf(
  groups: DerivedGlossaryGroup[] | null | undefined,
  term: string,
): { id: string; title?: string; declared: boolean } | null {
  const group = groups?.find((g) => g.id !== "" && g.terms.includes(term));
  if (!group) return null;
  return { id: group.id, title: group.title, declared: group.declared };
}

/** Interleaves the declared terms with the prose that uses them. */
function glossaryOf(
  model: AtlasModel,
  features: DerivedFeature[],
  groups?: DerivedGlossaryGroup[],
): DerivedGlossary | null {
  const glossary = model.glossary;
  if (!glossary) return null;

  const index = glossaryTermList(glossary);
  const usedBy: Record<string, string[]> = {};
  // Every declared term gets its entry, the unused one too: „used nowhere" is
  // a measurement, a missing key would be a gap that does not show that
  // anybody looked.
  glossary.terms.forEach((entry) => (usedBy[entry.term] = []));

  features.forEach((f) => {
    const found = new Set<string>();
    shownProse(f).forEach((text) => {
      searchableParts(text).forEach((part) => {
        linkTerms(part, index).forEach((part) => {
          if (part.kind === "term") found.add(part.term);
        });
      });
    });
    found.forEach((term) => usedBy[term]?.push(f.id));
  });

  Object.values(usedBy).forEach((ids) => ids.sort());
  // An empty list is the same absence, written differently: the host omits the
  // key when nobody groups. Letting it through would show „grouped, and the
  // grouping is empty" — a statement it does not make.
  return { terms: glossary.terms, index, usedBy, groups: groups?.length ? groups : null };
}

type RawObject = Record<string, unknown>;

function isRawObject(value: unknown): value is RawObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The knowledge slots of a record that still wait for an owner. */

export function openKnowledge(rec: Pick<FacetRecord, "doc">): string[] {
  const variants = rec.doc.variants;
  const active =
    isRawObject(variants) && Object.keys(variants).length > 0
      ? Object.values(variants).some((v) => isRawObject(v) && v.lifecycle === "active")
      : rec.doc.lifecycle === "active";
  if (!active) return [];
  const knowledge = rec.doc.knowledge;
  if (!isRawObject(knowledge)) return [];
  const open: string[] = [];
  for (const [name, raw] of Object.entries(knowledge)) {
    if (!isRawObject(raw)) continue;
    if (typeof raw.answer === "string" && raw.answer !== "") continue;

    if (Array.isArray(raw.derive_from) && raw.derive_from.length > 0) continue;
    const na = raw.not_applicable;
    if (
      isRawObject(na) &&
      typeof na.reason === "string" &&
      na.reason.trim() !== "" &&
      typeof na.confirmed_by === "string" &&
      na.confirmed_by.trim() !== ""
    )
      continue;
    const byVariant = raw.by_variant;
    if (
      isRawObject(byVariant) &&
      Object.values(byVariant).some(
        (o) => isRawObject(o) && typeof o.answer === "string" && o.answer !== "",
      )
    )
      continue;
    open.push(name);
  }
  return open.sort();
}

export function derive(model: AtlasModel, glossaryGroups?: DerivedGlossaryGroup[]): DerivedModel {
  const locs = locIndex(model);

  const M: DerivedFeature[] = model.features.map((rec) => {
    const scen = rec.scenarios.map(toDerivedScenario);
    const devs = scen.filter((s) => s.state === "dev").length;
    const claims = scen.length - devs;
    const proven = scen.filter((s) => s.state === "ok").length;
    const unbacked = scen.filter((s) => s.state === "un").length;
    const open = scen.filter((s) => s.state === "no").length;
    const drift = model.driftIds[rec.id] ?? [];
    const know = rec.knowledge.filter((slot) => (slot.answer ?? "").trim().length > 0);
    // Report a line count only when every anchored file has a scanned count;
    // a partial sum would look complete while understating the measured code.
    const paths = [...new Set(rec.anchors.map((a) => a.path))];
    const loc =
      locs && paths.every((path) => locs[path] !== undefined)
        ? paths.reduce((sum, path) => sum + locs[path], 0)
        : null;

    return {
      id: rec.id,
      rec,
      life: rec.lifecycle,
      team: rec.team,
      created: rec.createdAt,
      summary: rec.summary,
      loc,
      anchorsN: rec.anchors.length,
      anchors: rec.anchors,
      drift,
      driftN: drift.length,
      deps: rec.dependsOn,
      usedBy: rec.dependedOnBy,
      fixes: rec.defects.fixes,
      scen,
      claims,
      devs,
      proven,
      unbacked,
      open,
      grade: sharePercent(proven, claims),
      driftStrength: driftOf(drift.length, open),
      know,
      hasKnow: know.length > 0,
      obs: obsOf(rec),
      related: {
        pol: rec.relatedPolicies,
        asm: rec.relatedAssumptions,
        ent: rec.relatedEntities,
      },
    };
  });

  const byId: Record<string, DerivedFeature> = {};
  for (const f of M) byId[f.id] = f;

  const TOT: DerivedTotals = {
    claims: M.reduce((a, f) => a + f.claims, 0),
    proven: M.reduce((a, f) => a + f.proven, 0),
    open: M.reduce((a, f) => a + f.open, 0),
    unbacked: M.reduce((a, f) => a + f.unbacked, 0),
    devs: M.reduce((a, f) => a + f.devs, 0),
    drift: M.reduce((a, f) => a + f.driftN, 0),
    driftFeatures: M.filter((f) => f.driftN > 0).length,
  };

  const anchoredFiles = model.scan.anchoredFiles;
  const anchoredLoc = anchoredFiles ? anchoredFiles.reduce((sum, file) => sum + file.loc, 0) : null;

  const root = typeof model.scan.root === "string" ? model.scan.root : "";
  const registry =
    (typeof model.rc.name === "string" && model.rc.name) ||
    root.split("/").filter(Boolean).pop() ||
    "—";

  const catMap = new Map<string, DerivedFeature[]>();
  for (const f of M) {
    const cat = f.id.split("/").slice(0, 2).join("/");
    const list = catMap.get(cat);
    if (list) list.push(f);
    else catMap.set(cat, [f]);
  }

  const teamMap = new Map<string, DerivedFeature[]>();
  for (const f of M) {
    const key = f.team || tx("ui.root.derive-no-team");
    const list = teamMap.get(key);
    if (list) list.push(f);
    else teamMap.set(key, [f]);
  }

  const allFixes = M.flatMap((f) => f.fixes.map((x) => ({ f, x }))).sort((a, b) =>
    b.x.date.localeCompare(a.x.date),
  );

  return {
    model,
    M,
    byId,
    TOT,
    maxClaims: Math.max(1, ...M.map((f) => f.claims)),
    scan: {
      registry,
      root,
      scannedAt: typeof model.scan.scannedAt === "string" ? model.scan.scannedAt : "",
      files: typeof model.scan.files === "number" ? model.scan.files : null,

      // `RepoScan.loc` is in the type but nobody fills it. Falling back to it
      // costs nothing and covers a host that does fill it after all.
      loc:
        typeof model.scan.totalLoc === "number"
          ? model.scan.totalLoc
          : typeof model.scan.loc === "number"
            ? model.scan.loc
            : null,
      anchoredLoc,
      records: model.recs.length,
      anchors: model.anchorPairs.length,
    },
    orphans: model.scan.orphanAnchors ?? [],
    unanchored: model.scan.unanchoredFiles ?? [],
    policies: model.policies,
    assumptions: model.assumptions,
    entities: model.entities,
    cats: [...catMap.entries()],
    teams: [...teamMap.entries()],
    allFixes,
    facetrc: facetrcText(model),
    glossary: glossaryOf(model, M, glossaryGroups),
  };
}

/** The word for the evidence. */

export const STATE_LABEL: Record<DerivedEvidence, string> = {
  get ok() {
    return tx("ui.root.derive-test-linked");
  },
  un: "unbacked",
  get no() {
    return tx("ui.root.derive-no-linked-test");
  },
};

/** The filter bar, word for word the same in the ledger and the review bench. */

export function scenarioFilters(): readonly [ScenFilter, string][] {
  return [
    ["all", tx("ui.root.derive-all")],
    ["open", tx("ui.root.derive-open")],
    ["unbacked", "unbacked"],
    ["proven", tx("ui.root.derive-test-linked")],
    ["dev", tx("ui.root.derive-deviations")],
  ];
}

const FILTER_STATE: Record<Exclude<ScenFilter, "all">, DerivedScenarioState> = {
  open: "no",
  unbacked: "un",
  proven: "ok",
  dev: "dev",
};

/** Whether a scenario is in this selection. */

export function keepScen(filter: ScenFilter, s: DerivedScenario): boolean {
  return filter === "all" || s.state === FILTER_STATE[filter];
}

/** The order in the Ledger: open first, proven after, the declared defects
 * last — they are no work on a claim. */

export const SCEN_ORDER: Record<DerivedScenarioState, number> = { no: 0, un: 1, ok: 2, dev: 3 };

/** Share as a whole number, or `null` when the denominator is missing. */
export function share(part: number, total: number): number | null {
  return sharePercent(part, total);
}

/** The second filter row: who the sentence is written for. */

export function audienceFilters(): readonly [AudFilter, string][] {
  return [
    ["all", tx("ui.root.derive-all")],
    ["product", tx("ui.root.derive-product")],
    ["engineering", tx("ui.root.derive-engineering")],
  ];
}

/** Whether a scenario is in this audience. */

export function keepAud(filter: AudFilter, s: DerivedScenario): boolean {
  return filter === "all" || s.audience === filter;
}

/** How many sentences of this list nobody has classified. */
export function audUnclassified(list: DerivedScenario[]): number {
  return list.filter((s) => s.audience === null).length;
}
