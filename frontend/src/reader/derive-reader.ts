/** The Atlas model in the shape the Atlas pages of groups A and B take. */

import type { AtlasModel, FacetRecord, YamlValue } from "@/model";
import type { frame, records } from "@/screens";
import { openKnowledge, short, type DerivedModel } from "@/derive";
import type { T } from "./text";
import { sharePercent } from "../share";

export type FeatureView = frame.FeatureView;
export type DomainView = frame.DomainView;

/** The Overview page's slot order, as record keys. */
export const OVERVIEW_SLOT_KEYS = [
  "prerequisite_knowledge",
  "not_for",
  "discoverability",
  "common_pitfalls",
  "success_signal",
];

/** `active | planned | deprecated` from whatever the record declares. */
export function lifecycleOf(rec: Pick<FacetRecord, "lifecycle" | "activeAnywhere">) {
  const l = rec.lifecycle;
  if (l === "active" || l === "planned" || l === "deprecated") return l;
  if (l === "retired" || l === "superseded" || l === "removed") return "deprecated" as const;
  return rec.activeAnywhere ? ("active" as const) : ("planned" as const);
}

/** The records the surface lists: features first, then assumptions. */
export function listedRecords(model: AtlasModel): FacetRecord[] {
  return [...model.features, ...model.assumptions];
}

export function featureView(
  model: AtlasModel,
  derived: DerivedModel,
  rec: FacetRecord,
): FeatureView {
  const f = derived.byId[rec.id];
  const open = openKnowledge(rec);
  const active = lifecycleOf(rec) === "active";
  const hasKnowledge = rec.doc.knowledge != null && typeof rec.doc.knowledge === "object";
  return {
    id: rec.id,
    slug: short(rec.id),
    domain: rec.domain,
    capability: rec.capability,
    summary: rec.summary,
    type: rec.kind === "assumption" ? "assumption" : "feature",
    lifecycle: lifecycleOf(rec),
    owner: rec.team || null,
    createdAt: rec.createdAt || null,
    // A feature's claims leave declared defects out (see `derive`).
    scenarios: f ? f.claims : rec.total,
    proven: f ? f.proven : rec.proven,
    anchors: rec.anchors.length,
    tests: rec.tests.length,
    drift: model.driftIds[rec.id]?.length ?? 0,
    knowledgeOpen: open.length,
    knowledgeMeasured: hasKnowledge,
    fixCount: rec.defects.present ? rec.defects.total : null,
    fixCommits: rec.defects.present
      ? rec.defects.fixes.map(({ commit, date }) => ({ commit, date }))
      : undefined,
    deviationCount: rec.scenarios.filter((scenario) => scenario.deviation).length,
    knowledgeSlots:
      active && hasKnowledge ? OVERVIEW_SLOT_KEYS.map((k) => !open.includes(k)) : undefined,
    mosaic: f
      ? f.scen.filter((s) => s.state !== "dev").map((s) => s.state === "ok")
      : rec.scenarios.map((s) => s.proven),
    // One window per scenario in the product city, in the record's order.
    scenarioStates: f
      ? f.scen
          .filter((s) => s.state !== "dev")
          .map((s) => (s.state === "ok" ? "proven" : s.state === "un" ? "unbacked" : "open"))
      : rec.scenarios.map((s) => (s.proven ? "proven" : "open")),
  };
}

export function featureViews(model: AtlasModel, derived: DerivedModel): FeatureView[] {
  return listedRecords(model).map((r) => featureView(model, derived, r));
}

/** Domains and capabilities: the declared taxonomy, plus whatever records use
 * beyond it. Each carries the taxonomy's classification, so the newcomer's
 * areas can name only the core capabilities. */

// @facet: registry/perspectives/core-categories
// @facet-role: primary
export function domainViews(model: AtlasModel): DomainView[] {
  const out: DomainView[] = (model.taxonomy?.domains ?? []).map((d) => ({
    id: d.name,
    title: d.title || d.name,
    purpose: d.purpose,
    cls: d.classification ?? "",
    team: d.ownerTeam,
    capabilities: d.capabilities.map((c) => ({
      id: c.name,
      title: c.title || c.name,
      purpose: c.purpose,
      cls: c.classification ?? "",
    })),
  }));
  for (const rec of listedRecords(model)) {
    if (!rec.domain) continue;
    let d = out.find((x) => x.id === rec.domain);
    if (!d) {
      d = { id: rec.domain, title: rec.domain, purpose: "", cls: "", team: "", capabilities: [] };
      out.push(d);
    }
    if (rec.capability && !d.capabilities.some((c) => c.id === rec.capability))
      d.capabilities.push({ id: rec.capability, title: rec.capability, purpose: "", cls: "" });
  }
  return out;
}

/** The drifted files, newest first. A stamp is cut to its own calendar day,
 * never converted; where the scan supplied none a dash stands, after every
 * dated entry. */

export function driftViews(model: AtlasModel): frame.DriftView[] {
  return (model.scan.drift ?? [])
    .map((d) => {
      const day = typeof d.changedAt === "string" ? d.changedAt.trim().slice(0, 10) : "";
      return { path: d.path, record: d.id, changedAt: day || "—" };
    })
    .sort((a, b) => {
      const ad = a.changedAt !== "—";
      const bd = b.changedAt !== "—";
      if (ad !== bd) return ad ? -1 : 1;
      return b.changedAt < a.changedAt ? -1 : b.changedAt > a.changedAt ? 1 : 0;
    });
}

/** The share of records with drift (0–1) the FACET mark is offset by, or
 * `null` when the host sent no drift comparison — not measured, which the
 * mark draws in its resting colours and never as level blocks. */

export function driftShareOf(model: AtlasModel, records: number): number | null {
  if (model.scan.drift === undefined || records <= 0) return null;
  return Math.min(1, new Set(model.scan.drift.map((d) => d.id)).size / records);
}

export function calibrationViews(model: AtlasModel): frame.CalibrationView[] {
  return (model.calibration?.metrics ?? []).map((c) => ({
    key: c.name,
    // Atlas words the four metrics the registry defines; any other keeps its name.
    label: c.name,
    median: c.median,
    low: c.band.low,
    high: c.band.high,
    min: c.min,
    max: c.max,
    samples: c.samples,
    below: c.below,
    above: c.above,
  }));
}

/** Test kind as the pages group it; `null` for a kind none of the three bands names. */
export function testBand(kind: string): "unit" | "integration" | "e2e" | null {
  const k = kind.toLowerCase().replace(/[\s_-]/g, "");
  if (k === "unit") return "unit";
  if (k === "integration" || k === "contract") return "integration";
  if (k === "e2e" || k === "endtoend" || k === "browser" || k === "acceptance") return "e2e";
  return null;
}

/** Declared tests by band; `null` when no record is in scope (nothing to count). */
export function testMix(recs: FacetRecord[]): frame.TestMix | null {
  if (!recs.length) return null;
  const mix = { unit: 0, integration: 0, e2e: 0 };
  for (const r of recs)
    for (const t of r.tests) {
      const band = testBand(t.kind);
      if (band) mix[band] += 1;
    }
  return mix;
}

/** Scenarios by the week their record was created, cumulative, with today's proof state. */
export function trendOf(features: FeatureView[]): frame.TrendPoint[] {
  const dated = features
    .filter((f) => f.createdAt && /^\d{4}-\d{2}-\d{2}/.test(f.createdAt))
    .sort((a, b) => a.createdAt!.localeCompare(b.createdAt!));
  const out: frame.TrendPoint[] = [];
  let s = 0;
  let p = 0;
  for (const f of dated) {
    const d = new Date(f.createdAt!.slice(0, 10) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const w = d.toISOString().slice(0, 10);
    s += f.scenarios;
    p += f.proven;
    if (out.length && out[out.length - 1].date === w)
      out[out.length - 1] = { date: w, scenarios: s, proven: p };
    else out.push({ date: w, scenarios: s, proven: p });
  }
  return out;
}

export function ownersOf(features: FeatureView[]): frame.OwnerView[] {
  const m = new Map<string, frame.OwnerView>();
  for (const f of features) {
    if (!f.owner) continue;
    const o = m.get(f.owner) ?? { team: f.owner, records: 0, scenarios: 0, proven: 0 };
    o.records += 1;
    o.scenarios += f.scenarios;
    o.proven += f.proven;
    m.set(f.owner, o);
  }
  return [...m.values()].sort((a, b) => b.records - a.records);
}

/** Decision records as the records name them. The model knows the target and
 * who names it; title is the file name, status and date are not read here. */

export function adrViews(model: AtlasModel, parsed?: frame.AdrView[]): frame.AdrView[] {
  if (parsed) return parsed;
  return model.decisionTargets.map((t) => ({
    file: t.target,
    title: t.target.split("/").pop() ?? t.target,
    status: "—",
    date: "—",
    refs: t.recordIds,
  }));
}

export type OverviewExtras = {
  project?: { name?: string; branch?: string; commit?: string };
  history?: { date: string; sha: string; subject: string; files?: string[] | null }[];
  historyWindow?: number;
  historyExhausted?: boolean;
  historyTruncated?: boolean;
  shallow?: boolean;
  decisions?: frame.AdrView[];
  /** The host's answer about the MCP server; `null` = not asked or not answered. */
  tools?: { available: boolean; reason?: string; tools: string[] } | null;
};

/** Distinct files that carry at least one anchor. */
export function anchoredPaths(model: AtlasModel): string[] {
  return [...new Set(model.anchorPairs.map((a) => a.path))];
}

export function commitViews(
  model: AtlasModel,
  history: NonNullable<OverviewExtras["history"]> | undefined,
): frame.CommitView[] | null {
  if (!history) return null;
  const records = listedRecords(model);
  const paths = new Map(
    records.map((rec) => [rec.id, new Set([rec.path, ...rec.anchors.map((a) => a.path)])]),
  );
  return history.flatMap((commit) =>
    records
      .filter((rec) => commit.files?.some((file) => paths.get(rec.id)?.has(file) ?? false))
      .map((record) => ({
        date: commit.date,
        sha: commit.sha.slice(0, 8),
        subject: commit.subject,
        record: record.id,
      })),
  );
}

/** File totals. The scan may not send them; then `files` and `loc` stay `null`
 * (not measured) instead of falling back to the anchored count or to 0. */

export function fileTotals(model: AtlasModel) {
  const anchored = model.scan.anchoredFiles?.length ?? anchoredPaths(model).length;
  const listed =
    model.scan.anchoredFiles && model.scan.unanchoredFiles
      ? model.scan.anchoredFiles.length + model.scan.unanchoredFiles.length
      : null;
  return {
    files: model.scan.files ?? listed,
    anchoredFiles: anchored,
    loc: model.scan.loc ?? null,
  };
}

export function overviewModel(
  model: AtlasModel,
  derived: DerivedModel,
  extras: OverviewExtras = {},
  features: FeatureView[] = featureViews(model, derived),
): frame.OverviewModel {
  const domains = domainViews(model);
  const drift = driftViews(model);
  const ft = fileTotals(model);
  const rcName = typeof model.rc.name === "string" ? model.rc.name : "";
  const version = typeof model.rc.schema_version === "string" ? model.rc.schema_version : "—";
  return {
    project: {
      name: extras.project?.name || rcName || derived.scan.registry || "—",
      branch: extras.project?.branch || "—",
      commit: extras.project?.commit ? extras.project.commit.slice(0, 8) : "—",
      generatedAt: model.scan.scannedAt || "—",
      version,
    },
    lint: {
      schema: null,
      anchors:
        model.scan.orphanAnchors === undefined ? null : model.scan.orphanAnchors.length === 0,
      proves: null,
      orphanAnchors: model.scan.orphanAnchors?.length ?? null,
    },
    totals: {
      records: features.length,
      features: features.filter((f) => f.type === "feature").length,
      assumptions: features.filter((f) => f.type === "assumption").length,
      domains: domains.length,
      capabilities: domains.reduce((a, d) => a + d.capabilities.length, 0),
      scenarios: features.reduce((a, f) => a + f.scenarios, 0),
      proven: features.reduce((a, f) => a + f.proven, 0),
      anchors: features.reduce((a, f) => a + f.anchors, 0),
      files: ft.files,
      anchoredFiles: ft.anchoredFiles,
      loc: ft.loc,
    },
    domains: domains.map((d) => {
      const fs = features.filter((f) => f.domain === d.id);
      return {
        ...d,
        features: fs.length,
        scenarios: fs.reduce((a, f) => a + f.scenarios, 0),
        proven: fs.reduce((a, f) => a + f.proven, 0),
        drift: drift.filter((x) => x.record.startsWith(d.id + "/")).length,
        knowledgeOpen: fs.reduce((a, f) => a + f.knowledgeOpen, 0),
      };
    }),
    features,
    drift,
    // The host sent no drift comparison: not measured, which is not "no drift".
    driftMeasured: model.scan.drift !== undefined,
    calibration: calibrationViews(model),
    tests: testMix(listedRecords(model)),
    trend: trendOf(features),
    // No commit history reaches the reader: not read, which is not "no commits".
    recent: commitViews(model, extras.history),
    adrs: adrViews(model, extras.decisions),
    owners: ownersOf(features),
    unowned: features.filter((f) => !f.owner).length,
    // Not listed is not an empty list: the page says "not measured" or the reason.
    tools: extras.tools?.available
      ? extras.tools.tools.map((name) => ({ name, purpose: "", calls: null }))
      : null,
    toolsReason: extras.tools && !extras.tools.available ? extras.tools.reason || "—" : null,
    ...roleSurfaces(derived, drift),
  };
}

/** What the role views show beyond the shared figures, read from the records:
 * the open promises of drifted records (developer), declared deviations
 * (test and review), fixes and reach (ownership), and the owners' answers
 * (new here). Every list comes from fields the records carry; none is
 * estimated. */

// @facet: registry/perspectives/role-views
// @facet-role: primary
export function roleSurfaces(
  derived: DerivedModel,
  drift: frame.DriftView[],
): Pick<
  frame.OverviewModel,
  "driftUnproven" | "deviations" | "fixes" | "reach" | "faq" | "faqGaps"
> {
  const drifted = new Set(drift.map((d) => d.record));
  return {
    // Only promises nobody named a test for: a proven one, a declared defect
    // and a deliberately unbacked one are no open item.
    driftUnproven: derived.M.filter((f) => drifted.has(f.id)).flatMap((f) =>
      f.scen
        .filter((s) => s.state === "no")
        .map((s) => ({ record: f.id, scenario: s.id, then: s.then })),
    ),
    deviations: derived.M.flatMap((f) =>
      f.scen
        .filter((s) => s.deviation)
        .map((s) => ({
          record: f.id,
          scenario: s.id,
          then: s.then,
          reason: s.deviation?.reason ?? "",
        })),
    ),
    fixes: derived.allFixes.map(({ f, x }) => ({
      record: f.id,
      subject: fixTitle(x.subject ?? ""),
      date: x.date,
      full: x.subject ?? "",
    })),
    reach: derived.M.map((f) => ({
      record: f.id,
      team: f.team || null,
      dependents: f.usedBy.length,
    }))
      .filter((r) => r.dependents > 0)
      .sort((a, b) => b.dependents - a.dependents || a.record.localeCompare(b.record)),
    faq: faqByChange(derived),
    faqGaps: faqGaps(derived),
  };
}

/** The longest fix title a row carries before it is cut at a word. */
export const FIX_TITLE_LIMIT = 96;

/** A commit subject as a row title: the `fix(…):` prefix off, the first line
 * only, and what is left cut at the last word boundary before the limit with
 * an ellipsis — hard only where no boundary exists. `""` where nothing is
 * left: the page says there is no subject instead of inventing one. */

export function fixTitle(subject: string): string {
  const line = subject
    .replace(/^\s*fix(\([^)]*\))?!?:\s*/i, "")
    .split("\n")[0]
    .trim();
  if (line.length <= FIX_TITLE_LIMIT) return line;
  const boundary = line.lastIndexOf(" ", FIX_TITLE_LIMIT);
  const cut = boundary > 0 ? line.slice(0, boundary) : line.slice(0, FIX_TITLE_LIMIT);
  return `${cut.trimEnd()}…`;
}

/** The knowledge kinds of the Overview no record answers, each with how many
 * records could close it — the active ones the lint would ask, a missing slot
 * counted as an empty one — and the teams holding them. A kind no record could
 * answer is no gap and stands nowhere. */

export function faqGaps(derived: DerivedModel): NonNullable<frame.OverviewModel["faqGaps"]> {
  return OVERVIEW_SLOT_KEYS.flatMap((slot) => {
    if (derived.M.some((f) => f.know.some((k) => k.key === slot && k.answer?.trim()))) return [];
    // A record could close it where the lint would warn about the slot once it is written
    // down empty: active, and not resolved by a derivation or a confirmed exemption.
    const open = derived.M.filter((f) => {
      const k = f.rec.doc.knowledge;
      const block: { [key: string]: YamlValue } =
        k && typeof k === "object" && !Array.isArray(k) ? k : {};
      const slots = { ...block, [slot]: block[slot] ?? { answer: "" } };
      return openKnowledge({ doc: { ...f.rec.doc, knowledge: slots } }).includes(slot);
    });
    if (!open.length) return [];
    const teams = [...new Set(open.map((f) => f.team).filter(Boolean))].sort();
    return [{ slot, records: open.length, teams }];
  });
}

/** The newest day among a feature's record file and its anchored files, from
 * the scan's `lastChanged`; `null` when the host sent no history. */

export function lastChangeOf(derived: DerivedModel, f: DerivedModel["M"][number]): string | null {
  const raw = derived.model.scan.lastChanged;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const days = raw as Record<string, unknown>;
  const day = (path: string) => (typeof days[path] === "string" ? (days[path] as string) : null);
  let newest = day(f.rec.path);
  for (const a of f.anchors) {
    const d = day(a.path);
    if (d && (!newest || d > newest)) newest = d;
  }
  return newest;
}

/** Every answered knowledge slot under its question and feature, the feature
 * changed last first, each with that day. Without a history the order falls
 * back on the id and no entry carries a day; an unmeasured change sorts after
 * every measured one. */

// @facet: registry/perspectives/knowledge-faq
// @facet-role: primary
export function faqByChange(derived: DerivedModel): NonNullable<frame.OverviewModel["faq"]> {
  return derived.M.map((f) => ({ f, changed: lastChangeOf(derived, f) }))
    .sort(
      (a, b) => (b.changed ?? "").localeCompare(a.changed ?? "") || a.f.id.localeCompare(b.f.id),
    )
    .flatMap(({ f, changed }) =>
      f.know
        .filter((k) => OVERVIEW_SLOT_KEYS.includes(k.key) && k.answer?.trim())
        .sort((a, b) => OVERVIEW_SLOT_KEYS.indexOf(a.key) - OVERVIEW_SLOT_KEYS.indexOf(b.key))
        .map((k) => ({
          record: f.id,
          slot: k.key,
          question: k.question?.trim() ?? "",
          answer: k.answer!.trim(),
          changed,
        })),
    );
}

/** Domain and capability overviews --------------------------------------------------- */

export function domainLinks(model: AtlasModel, domains: DomainView[], id: string) {
  const acc = new Map<string, frame.DomainLinkView & { from: string; to: string }>();
  const title = (d: string) => domains.find((x) => x.id === d)?.title ?? d;
  for (const e of model.edges) {
    const a = model.byId[e.from];
    const b = model.byId[e.to];
    if (!a || !b || a.domain === b.domain) continue;
    if (a.domain !== id && b.domain !== id) continue;
    const k = `${a.domain}>${b.domain}`;
    const other = a.domain === id ? b.domain : a.domain;
    const link = acc.get(k) ?? {
      from: a.domain,
      to: b.domain,
      domain: other,
      title: title(other),
      count: 0,
      examples: [],
    };
    link.count += 1;
    if (link.examples.length < 3) link.examples.push(`${e.from} → ${e.to}`);
    acc.set(k, link);
  }
  const all = [...acc.values()].sort((x, y) => y.count - x.count);
  const strip = ({ domain, title: t, count, examples }: frame.DomainLinkView) => ({
    domain,
    title: t,
    count,
    examples,
  });
  return {
    incoming: all.filter((l) => l.to === id).map(strip),
    outgoing: all.filter((l) => l.from === id).map(strip),
  };
}

export function teamName(domain: DomainView): string | undefined {
  return domain.team || undefined;
}

export function domainData(
  model: AtlasModel,
  features: FeatureView[],
  domains: DomainView[],
  id: string,
  history?: NonNullable<OverviewExtras["history"]>,
) {
  const domain = domains.find((d) => d.id === id);
  if (!domain) return null;
  const adrs = adrViews(model).filter((a) => a.refs.some((r) => r.startsWith(id + "/")));
  return {
    domain,
    domains,
    features: features.filter((f) => f.domain === id),
    links: domainLinks(model, domains, id),
    drift: driftViews(model).filter((d) => d.record.startsWith(id + "/")),
    adrs,
    recent:
      commitViews(model, history)?.filter((commit) => commit.record.startsWith(`${id}/`)) ?? null,
    teamName: teamName(domain),
  };
}

export function capabilityFiles(
  model: AtlasModel,
  domain: string,
  capability: string,
): frame.AnchorFile[] {
  const m = new Map<string, { anchors: number; records: Set<string>; roles: Set<string> }>();
  for (const a of model.anchorPairs) {
    const rec = model.byId[a.id];
    if (!rec || rec.domain !== domain || rec.capability !== capability) continue;
    const e = m.get(a.path) ?? { anchors: 0, records: new Set<string>(), roles: new Set<string>() };
    e.anchors += 1;
    e.records.add(a.id);
    e.roles.add(a.role);
    m.set(a.path, e);
  }
  return [...m.entries()]
    .map(([path, e]) => ({
      path,
      anchors: e.anchors,
      records: e.records.size,
      roles: [...e.roles],
    }))
    .sort((a, b) => b.records - a.records || a.path.localeCompare(b.path));
}

export function capabilityData(
  model: AtlasModel,
  features: FeatureView[],
  domains: DomainView[],
  domainId: string,
  capabilityId: string,
) {
  const domain = domains.find((d) => d.id === domainId);
  const capability = domain?.capabilities.find((c) => c.id === capabilityId);
  if (!domain || !capability) return null;
  const recs = listedRecords(model).filter(
    (r) => r.domain === domainId && r.capability === capabilityId,
  );
  return {
    domain,
    domains,
    capability,
    features: features.filter((f) => f.domain === domainId && f.capability === capabilityId),
    files: capabilityFiles(model, domainId, capabilityId),
    tests: testMix(recs),
    drift: driftViews(model).filter((d) => d.record.startsWith(`${domainId}/${capabilityId}/`)),
    teamName: teamName(domain),
  };
}

/** Distinct creation dates, ascending, for the time slider. */
export function creationDates(features: FeatureView[]): string[] {
  return [...new Set(features.map((f) => f.createdAt).filter((d): d is string => !!d))].sort();
}

/** Not found ------------------------------------------------------------------------------ */

/** Edit distance, for the nearest existing ids. */
export function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

export function nearestRecords(model: AtlasModel, wanted: string, n = 5) {
  const key = wanted.toLowerCase();
  return listedRecords(model)
    .map((r) => ({
      id: r.id,
      label: short(r.id),
      sub: `${r.domain}/${r.capability}`,
      distance: Math.min(
        distance(key, r.id.toLowerCase()),
        distance(key, short(r.id).toLowerCase()),
      ),
    }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, n);
}

/** Records collection --------------------------------------------------------------------- */

export type RecordRow = records.RecordRow;

export function recordRows(features: FeatureView[]): RecordRow[] {
  return features.map((f) => ({
    id: f.id,
    slug: f.slug,
    domain: f.domain,
    capability: f.capability,
    kind: f.type,
    lifecycle: f.lifecycle,
    owner: f.owner,
    summary: f.summary,
    scenarios: f.scenarios,
    proven: f.proven,
    anchors: f.anchors,
    drift: f.drift,
    knowledgeOpen: f.knowledgeMeasured ? f.knowledgeOpen : null,
    // The model carries no commit history; a change date would be invented.
    changedAt: null,
  }));
}

export type RecordFilters = {
  domain?: string;
  lifecycle?: records.Lifecycle;
  drift?: boolean;
  unowned?: boolean;
  kind?: records.RecordKind;
};

export type RecordsQuery = {
  query: string;
  filters: RecordFilters;
  view: records.RecordsView;
  sort: { key: keyof RecordRow; dir: "asc" | "desc" };
  page: number;
  pageSize: number;
  /** Lens: the record the reader put into focus; the first hit stands in when absent. */
  focus?: string;
  lensTab: records.LensTab;
  /** Lens: the unfolded promise of the record in focus; -1 folds all. */
  lensOpen: number;
};

export const RECORDS_DEFAULT: RecordsQuery = {
  query: "",
  filters: {},
  view: "lens",
  lensTab: "promises",
  lensOpen: 0,
  sort: { key: "id", dir: "asc" },
  page: 1,
  pageSize: 25,
};

/** Read filters from a Overview target such as `records?lifecycle=planned`. */
export function filtersFromSearch(search: string): RecordFilters {
  const p = new URLSearchParams(search);
  const out: RecordFilters = {};
  const lc = p.get("lifecycle");
  if (lc === "planned" || lc === "active" || lc === "deprecated") out.lifecycle = lc;
  if (p.get("owner") === "none") out.unowned = true;
  if (p.get("drift") === "1") out.drift = true;
  const d = p.get("domain");
  if (d) out.domain = d;
  return out;
}

export function searchRows(rows: RecordRow[], query: string): RecordRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.id.toLowerCase().includes(q) ||
      r.summary.toLowerCase().includes(q) ||
      (r.owner ?? "").toLowerCase().includes(q),
  );
}

export function applyFilters(rows: RecordRow[], f: RecordFilters): RecordRow[] {
  return rows.filter(
    (r) =>
      (!f.domain || r.domain === f.domain) &&
      (!f.lifecycle || r.lifecycle === f.lifecycle) &&
      (!f.drift || r.drift > 0) &&
      (!f.unowned || !r.owner) &&
      (!f.kind || r.kind === f.kind),
  );
}

/** The lifecycle word in the language of `t`. */
export function lifecycleLabel(l: records.Lifecycle, t: T): string {
  return l === "active"
    ? t("ui.reader.derive-reader-active")
    : l === "planned"
      ? t("ui.reader.derive-reader-planned")
      : t("ui.reader.derive-reader-deprecated");
}

export function facetsFor(rows: RecordRow[], f: RecordFilters, t: T) {
  const count = (pred: (r: RecordRow) => boolean) => rows.filter(pred).length;
  return [
    {
      key: "lc:planned",
      label: lifecycleLabel("planned", t),
      count: count((r) => r.lifecycle === "planned"),
      active: f.lifecycle === "planned",
    },
    {
      key: "lc:deprecated",
      label: lifecycleLabel("deprecated", t),
      count: count((r) => r.lifecycle === "deprecated"),
      active: f.lifecycle === "deprecated",
    },
    {
      key: "drift",
      label: t("ui.reader.derive-reader-drift"),
      count: count((r) => r.drift > 0),
      active: !!f.drift,
    },
    {
      key: "unowned",
      label: t("ui.reader.derive-reader-without-team"),
      count: count((r) => !r.owner),
      active: !!f.unowned,
    },
    {
      key: "kind:assumption",
      label: t("ui.reader.derive-reader-assumptions"),
      count: count((r) => r.kind === "assumption"),
      active: f.kind === "assumption",
    },
    ...[...new Set(rows.map((r) => r.domain))].map((d) => ({
      key: `domain:${d}`,
      label: d,
      count: count((r) => r.domain === d),
      active: f.domain === d,
    })),
  ];
}

/** Toggle one facet key on the filters. */
export function toggleFacet(f: RecordFilters, key: string): RecordFilters {
  const [k, v] = key.split(":");
  switch (k) {
    case "lc":
      return { ...f, lifecycle: f.lifecycle === v ? undefined : (v as records.Lifecycle) };
    case "drift":
      return { ...f, drift: !f.drift };
    case "unowned":
      return { ...f, unowned: !f.unowned };
    case "kind":
      return { ...f, kind: f.kind === v ? undefined : (v as records.RecordKind) };
    case "domain":
      return { ...f, domain: f.domain === v ? undefined : v };
    default:
      return f;
  }
}

export function removeFilter(f: RecordFilters, key: string): RecordFilters {
  const out = { ...f };
  delete out[key as keyof RecordFilters];
  return out;
}

export function filterChips(f: RecordFilters, t: T): { key: string; label: string }[] {
  return [
    ...(f.domain
      ? [{ key: "domain", label: t("ui.reader.derive-reader-area-value", { value: f.domain }) }]
      : []),
    ...(f.lifecycle
      ? [
          {
            key: "lifecycle",
            label: t("ui.reader.derive-reader-lifecycle-value", {
              value: lifecycleLabel(f.lifecycle, t),
            }),
          },
        ]
      : []),
    ...(f.drift ? [{ key: "drift", label: t("ui.reader.derive-reader-drift") }] : []),
    ...(f.unowned ? [{ key: "unowned", label: t("ui.reader.derive-reader-without-team") }] : []),
    ...(f.kind
      ? [
          {
            key: "kind",
            label:
              f.kind === "assumption"
                ? t("ui.reader.derive-reader-assumptions")
                : t("ui.reader.derive-reader-features"),
          },
        ]
      : []),
  ];
}

export function summaryOf(rows: RecordRow[]): records.RecordsSummary {
  const scenarios = rows.reduce((a, r) => a + r.scenarios, 0);
  const proven = rows.reduce((a, r) => a + r.proven, 0);
  const active = rows.filter((r) => r.lifecycle === "active");
  const measuredKnowledge = active.filter((r) => r.knowledgeOpen != null);
  return {
    total: rows.length,
    provenPct: sharePercent(proven, scenarios),
    drift: rows.filter((r) => r.drift > 0).length,
    knowledgeOpen:
      active.length > 0 && measuredKnowledge.length === active.length
        ? measuredKnowledge.reduce((a, r) => a + (r.knowledgeOpen ?? 0), 0)
        : null,
    domains: new Set(rows.filter((r) => r.kind !== "assumption").map((r) => r.domain)).size,
    assumptions: rows.filter((r) => r.kind === "assumption").length,
  };
}

export function sortRows(
  rows: RecordRow[],
  key: keyof RecordRow,
  dir: "asc" | "desc",
): RecordRow[] {
  const s = [...rows].sort((a, b) => {
    const x = a[key] ?? "";
    const y = b[key] ?? "";
    return typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y));
  });
  return dir === "asc" ? s : s.reverse();
}

export function fieldGroups(rows: RecordRow[], matched: Set<string>): records.FieldGroup[] {
  const groups = new Map<string, records.FieldGroup>();
  for (const r of rows) {
    const key = `${r.domain}/${r.capability}`;
    if (!groups.has(key))
      groups.set(key, { domain: r.domain, capability: r.capability, tiles: [] });
    groups.get(key)!.tiles.push({
      id: r.id,
      slug: r.slug,
      lifecycle: r.lifecycle,
      scenarios: r.scenarios,
      proven: r.proven,
      drift: r.drift,
      match: matched.has(r.id),
    });
  }
  return [...groups.values()];
}

export function matrixRows(rows: RecordRow[]): records.MatrixRow[] {
  const out = new Map<string, records.MatrixRow>();
  for (const r of rows) {
    const key = `${r.domain}/${r.capability}`;
    const m = out.get(key) ?? {
      domain: r.domain,
      capability: r.capability,
      active: 0,
      planned: 0,
      deprecated: 0,
      scenarios: 0,
      proven: 0,
      drift: 0,
    };
    m[r.lifecycle] += 1;
    m.scenarios += r.scenarios;
    m.proven += r.proven;
    m.drift += r.drift ? 1 : 0;
    out.set(key, m);
  }
  return [...out.values()];
}

/** The label of the by-area distribution band; the page reports it back when a part is picked. */
export const byAreaLabel = (t: T) => t("ui.reader.derive-reader-area");

export function distributionsFor(rows: RecordRow[], f: RecordFilters, t: T) {
  const by = (key: (r: RecordRow) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const tone: Record<string, string> = {
    active: "var(--t-ok)",
    planned: "var(--t-plan)",
    deprecated: "var(--t-warn)",
  };
  return [
    {
      label: byAreaLabel(t),
      parts: by((r) => r.domain).map(([k, v]) => ({
        key: k,
        label: k,
        value: v,
        active: f.domain === k,
      })),
    },
    {
      label: t("ui.reader.derive-reader-lifecycle"),
      parts: by((r) => r.lifecycle).map(([k, v]) => ({
        key: k,
        label: lifecycleLabel(k as records.Lifecycle, t),
        value: v,
        tone: tone[k],
        active: f.lifecycle === k,
      })),
    },
  ];
}

/** The lens's hits, best first: a match in the record's own name before one in
 * its id, an id before a summary or team, then by id. */

export function lensHits(hits: RecordRow[], query: string, limit = 5): RecordRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (r: RecordRow) =>
    r.slug.toLowerCase().includes(q) ? 0 : r.id.toLowerCase().includes(q) ? 1 : 2;
  return [...hits].sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id)).slice(0, limit);
}

/** The record the lens holds in focus: the reader's choice while it is still among
 * the matches, else the best hit of a search, else the match with the most
 * neighbours (`weight`), so the lens opens on a record whose neighbours show. */

export function lensFocusId(
  hits: RecordRow[],
  query: string,
  chosen?: string,
  weight: (id: string) => number = () => 0,
): string | null {
  if (chosen && hits.some((r) => r.id === chosen)) return chosen;
  const best = lensHits(hits, query, 1)[0];
  if (best) return best.id;
  let top: RecordRow | null = null;
  for (const r of hits) if (!top || weight(r.id) > weight(top.id)) top = r;
  return top?.id ?? null;
}

/** Everything the Records page needs for one query state. */
export function recordsProps(
  all: RecordRow[],
  q: RecordsQuery,
  t: T,
  neighbours?: (id: string) => number,
) {
  const filtered = applyFilters(all, q.filters);
  const hits = searchRows(filtered, q.query);
  const sorted = sortRows(hits, q.sort.key, q.sort.dir);
  const pages = Math.max(1, Math.ceil(sorted.length / q.pageSize));
  const page = Math.min(Math.max(1, q.page), pages);
  const state: records.RecordsPageProps["state"] = !all.length
    ? "empty"
    : !hits.length
      ? "filtered-empty"
      : "ready";
  return {
    state,
    summary: summaryOf(all),
    matched: hits.length,
    query: q.query,
    view: q.view,
    facets: facetsFor(all, q.filters, t),
    filters: filterChips(q.filters, t),
    rows: sorted.slice((page - 1) * q.pageSize, page * q.pageSize),
    page,
    pageSize: q.pageSize,
    sort: q.sort as { key: string; dir: "asc" | "desc" },
    distributions: distributionsFor(filtered, q.filters, t),
    field: fieldGroups(filtered, new Set(hits.map((r) => r.id))),
    matrix: matrixRows(hits),
    lensHits: lensHits(hits, q.query),
    focusId: lensFocusId(sorted, q.query, q.focus, neighbours),
    suggestions: hits.length
      ? undefined
      : all
          .map((r) => ({ r, d: distance(q.query.toLowerCase(), r.slug.toLowerCase()) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 5)
          .map((x) => x.r),
  };
}

/** Record ------------------------------------------------------------------------------- */

export const RECORD_SLOTS: records.KnowledgeKey[] = [
  "prerequisite_knowledge",
  "discoverability",
  "success_signal",
  "not_for",
  "common_pitfalls",
];

const TEST_KIND_LABEL: Record<string, string> = {
  unit: "Unit",
  integration: "Integration",
  e2e: "E2E",
};

export function testKindLabel(kind: string): string {
  const band = testBand(kind);
  return band ? TEST_KIND_LABEL[band] : kind;
}

/** `path::name` or `path` of a declared test. */
export function splitTest(id: string): { file: string; name: string | null } {
  const i = id.indexOf("::");
  return i < 0 ? { file: id, name: null } : { file: id.slice(0, i), name: id.slice(i + 2) };
}

function stepsOf(s: FacetRecord["scenarios"][number]): records.GwtStep[] {
  let last: records.StepKeyword = "given";
  return s.steps
    .filter((st) => st.text)
    .map((st) => {
      const kw = st.keyword;
      if (kw === "GIVEN" || kw === "WHEN" || kw === "THEN") {
        last = kw.toLowerCase() as records.StepKeyword;
        return { kw: last, text: st.text };
      }
      return { kw: kw === "AND" || kw === "BUT" ? ("and" as const) : last, text: st.text };
    });
}

export function recordOf(
  model: AtlasModel,
  id: string,
  history?: NonNullable<OverviewExtras["history"]>,
  historyState?: Pick<
    OverviewExtras,
    "historyWindow" | "historyExhausted" | "historyTruncated" | "shallow"
  >,
): records.RecordDetails | null {
  const rec = model.byId[id];
  if (!rec) return null;
  const link = (x: string) => {
    const t = model.byId[x];
    return t ? { id: x, lifecycle: lifecycleOf(t) } : { id: x, missing: true };
  };
  // Only the slots the record's block declares: a count over the schema's five
  // would be a statement about FACET, not about this record.
  const knowledge = RECORD_SLOTS.flatMap((key) => {
    const slot = rec.knowledge.find((k) => k.key === key);
    if (!slot) return [];
    const answer = slot.answer?.trim();
    return [{ key, answer: answer || null }];
  });
  const testKinds: Record<string, number> = {};
  for (const t of rec.tests) {
    const k = testKindLabel(t.kind);
    testKinds[k] = (testKinds[k] ?? 0) + 1;
  }
  const obs = rec.slos.length + rec.alerts.length + rec.checks.length + rec.dashboards.length;
  const observed = obs > 0 ? true : rec.present.observation ? false : null;
  const log = commitViews(model, history)?.filter((commit) => commit.record === rec.id) ?? null;
  return {
    id: rec.id,
    kind: rec.kind === "assumption" ? "assumption" : "feature",
    domain: rec.domain,
    capability: rec.capability,
    slug: short(rec.id),
    summary: rec.summary,
    lifecycle: lifecycleOf(rec),
    owner: rec.team || null,
    createdAt: rec.createdAt || null,
    scenarioCount: rec.total,
    provenCount: rec.proven,
    scenarios: rec.scenarios.map((s) => ({
      id: s.id,
      steps: stepsOf(s),
      proven: s.proven,
      audience: s.audience,
      tests: s.tests.map((t) => ({ kind: testKindLabel(t.kind), ...splitTest(t.id) })),
    })),
    testCount: rec.tests.length,
    testKinds,
    anchorCount: rec.anchors.length,
    anchors: rec.anchors.map((a) => ({ path: a.path, line: a.line, role: a.role })),
    knowledge,
    knowledgeDeclared: rec.present.knowledge,
    logCount: log?.length ?? null,
    log: log?.map(({ date, sha, subject }) => ({ date, sha, subject })) ?? null,
    logWindow:
      history == null
        ? null
        : historyState?.historyExhausted
          ? (historyState.historyWindow ?? history.length)
          : history.length,
    logIncomplete:
      history == null
        ? null
        : historyState?.shallow === true || historyState?.historyTruncated === true,
    dependsOn: rec.dependsOn.map(link),
    dependents: rec.dependedOnBy.map(link),
    variants: [],
    drift: (model.driftIds[rec.id] ?? []).map((d) => ({ path: d.path, changedAt: d.changedAt })),
    // The host sent no drift comparison: the record's mark shows "not measured".
    driftMeasured: model.scan.drift !== undefined,
    observed,
    rules: referencesOf(model, rec.relatedPolicies),
    assumptions: referencesOf(model, rec.relatedAssumptions),
    dataShapes: referencesOf(model, rec.relatedEntities),
    tickets: [],
    yaml: rec.raw,
    json: JSON.stringify(rec.doc, null, 2),
  };
}

/** The records a record's lineage names (`related_policies`,
 * `related_assumptions`, `related_data_entities`), in the record's order. An
 * id the loaded registry does not hold stays in the list, marked missing: the
 * record names it, and dropping it would hide that. */

export function referencesOf(model: AtlasModel, ids: readonly string[]): records.RecordRule[] {
  return ids.map((id) => {
    const r = model.byId[id];
    return r
      ? { id: r.id, title: r.label || short(r.id), states: r.summary }
      : { id, title: id, states: "", missing: true };
  });
}

type Sibling = NonNullable<records.RecordDetailsPageProps["siblings"]>["domains"][number];

/** One caret entry: a sibling with the scenario counts of everything under it. */
function sibling(id: string, rows: FeatureView[]): Sibling {
  return {
    id,
    records: rows.length,
    scenarios: rows.reduce((a, f) => a + f.scenarios, 0),
    proven: rows.reduce((a, f) => a + f.proven, 0),
  };
}

export function siblingsOf(
  model: AtlasModel,
  domains: DomainView[],
  features: FeatureView[],
  id: string,
) {
  const rec = model.byId[id];
  if (!rec) return undefined;
  const dom = domains.find((d) => d.id === rec.domain);
  const capIds = dom ? dom.capabilities.map((c) => c.id) : [rec.capability];
  return {
    domains: domains.map((d) =>
      sibling(
        d.id,
        features.filter((f) => f.domain === d.id),
      ),
    ),
    capabilities: capIds.map((c) =>
      sibling(
        c,
        features.filter((f) => f.domain === rec.domain && f.capability === c),
      ),
    ),
    records: features
      .filter((f) => f.domain === rec.domain && f.capability === rec.capability)
      .map((f) => sibling(f.slug, [f])),
  };
}
