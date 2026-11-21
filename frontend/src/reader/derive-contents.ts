/** The Atlas model in the shape the facet-ui contents pages (group C) take. */

import type { AtlasModel, FacetRecord } from "@/model";
import type { TextKey, FacetText } from "@/screens/text";
import { records, type contents } from "@/screens";
import { categoryOf, openKnowledge, short, type DerivedModel } from "@/derive";
import { RECORD_SLOTS, lifecycleOf, listedRecords, splitTest, testBand } from "./derive-reader";
import type { T } from "./text";
import { ratioPercent } from "../share";

type UiT = FacetText["t"];

export type PromiseItem = contents.PromiseItem;

/** Promises ------------------------------------------------------------------------------- */

const STATE_OF = { ok: "proven", un: "open", no: "open", dev: "deviation" } as const;

function scenarioText(s: FacetRecord["scenarios"][number]): string {
  const word: Record<string, string> = {
    GIVEN: "Given",
    WHEN: "When",
    THEN: "Then",
    AND: "And",
    BUT: "But",
  };
  return s.steps.map((st) => (st.keyword ? `${word[st.keyword]} ${st.text}` : st.text)).join("\n");
}

export function promiseItems(derived: DerivedModel): PromiseItem[] {
  return derived.M.flatMap((f) =>
    f.scen.map((s) => ({
      key: `${f.id}#${s.id}`,
      recordId: f.id,
      scenarioId: s.id,
      text: scenarioText(s.raw),
      state: STATE_OF[s.state],
      tests: s.raw.tests.map((t) => ({ name: t.id, kind: t.kind })),
    })),
  );
}

export function promiseRecords(derived: DerivedModel): contents.PromiseRecord[] {
  return derived.M.map((f) => ({
    id: f.id,
    domain: f.rec.domain,
    cells: f.scen.map((s) => ({ scenarioId: s.id, state: STATE_OF[s.state] })),
  }));
}

export function promiseTotals(items: PromiseItem[], records: number) {
  return {
    total: items.length,
    proven: items.filter((i) => i.state === "proven").length,
    open: items.filter((i) => i.state === "open").length,
    deviating: items.filter((i) => i.state === "deviation").length,
    records,
  };
}

export type PromiseFilter = { state?: contents.PromiseState; domain?: string };

export function filterPromises(items: PromiseItem[], q: string, f: PromiseFilter) {
  const query = q.trim().toLowerCase();
  return items.filter(
    (i) =>
      (!f.state || i.state === f.state) &&
      (!f.domain || i.recordId.startsWith(f.domain + "/")) &&
      (!query || i.recordId.toLowerCase().includes(query) || i.text.toLowerCase().includes(query)),
  );
}

export function promiseFacets(items: PromiseItem[], f: PromiseFilter, t: T) {
  const states: [contents.PromiseState, string][] = [
    ["open", t("ui.reader.derive-contents-open")],
    ["proven", t("ui.reader.derive-contents-test-named")],
    ["deviation", t("ui.reader.derive-contents-deviation")],
  ];
  const domains = [...new Set(items.map((i) => i.recordId.split("/")[0]))];
  return [
    ...states.map(([s, label]) => ({
      key: `state:${s}`,
      label,
      count: items.filter((i) => i.state === s).length,
      active: f.state === s,
    })),
    ...domains.map((d) => ({
      key: `domain:${d}`,
      label: d,
      count: items.filter((i) => i.recordId.startsWith(d + "/")).length,
      active: f.domain === d,
    })),
  ];
}

/** Knowledge ------------------------------------------------------------------------------- */

/** The five slot names in the order of `RECORD_SLOTS`, in the language of `tt`. */
export const knowledgeLabels = (tt: UiT): string[] =>
  RECORD_SLOTS.map((key) => tt(records.KNOWLEDGE_TEXT[key].label));

/** Knowledge per active feature with a `knowledge` block. A slot is open by the
 * same rule as the lint (`openKnowledge`): a derived or explicitly
 * inapplicable slot is not open, and shows as such instead of an answer. */

export function knowledgeRows(model: AtlasModel, t: T): contents.KnowledgeRow[] {
  return model.features
    .filter((r) => lifecycleOf(r) === "active" && r.present.knowledge)
    .map((r) => {
      const open = openKnowledge(r);
      const answers = RECORD_SLOTS.map((key) => {
        if (open.includes(key)) return null;
        const a = r.knowledge.find((k) => k.key === key)?.answer?.trim();
        return a || t("ui.reader.derive-contents-derived-not-applicable");
      });
      return {
        id: r.id,
        domain: r.domain,
        slots: answers.map((a) => (a == null ? null : a.slice(0, 80))),
        answers,
        // The row's count says what the record answered in words of what its
        // block declares: a derived or inapplicable slot is not open, and not
        // an answer either.
        answered: r.knowledge.filter((k) => !!k.answer?.trim()).length,
        declared: r.knowledge.length,
      };
    });
}

export function knowledgeTotals(rows: contents.KnowledgeRow[]) {
  const perSlot = RECORD_SLOTS.map((_, i) => rows.filter((r) => r.slots[i] == null).length);
  const open = perSlot.reduce((a, b) => a + b, 0);
  return {
    perSlot,
    measured: rows.length > 0,
    totals: { records: rows.length, open, filled: rows.length * 5 - open },
  };
}

/** Operations ------------------------------------------------------------------------------- */

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function opsEntries(model: AtlasModel): contents.OpsEntry[] {
  const out: contents.OpsEntry[] = [];
  model.slos.forEach((s, i) =>
    out.push({
      key: `slo-${i}`,
      recordId: s.rec.id,
      kind: "SLO",
      name: text(s.id) || "—",
      target: text(s.target) || "—",
      window: text(s.window) || undefined,
      source: text(s.query_source) || "—",
    }),
  );
  model.alerts.forEach((a, i) =>
    out.push({
      key: `alert-${i}`,
      recordId: a.rec.id,
      kind: "Alert",
      name: text(a.id) || "—",
      target: text(a.condition) || "—",
      source: text(a.severity) || "—",
    }),
  );
  model.checks.forEach((c, i) =>
    out.push({
      key: `check-${i}`,
      recordId: c.rec.id,
      kind: "ContinuousCheck",
      name: text(c.id) || "—",
      target: text(c.frequency) || "—",
      source: "—",
    }),
  );
  return out;
}

/** Provenance ------------------------------------------------------------------------------- */

/** `2026-03` as "Mar 2026" in `language`; an unknown tag reads as English. */
export function monthLabel(month: string, language: string): string {
  const at = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
  const options: Intl.DateTimeFormatOptions = { month: "short", year: "numeric", timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(language, options).format(at);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(at);
  }
}
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}/.test(d);

export function provenance(model: AtlasModel, language: string) {
  const recs = model.features;
  const fullyProven = (r: FacetRecord) => r.total > 0 && r.proven === r.total;
  const teams: contents.TeamProvenance[] = [...new Set(recs.map((r) => r.team).filter(Boolean))]
    .map((t) => {
      const list = recs.filter((r) => r.team === t);
      const doms = [...new Set(list.map((r) => r.domain))];
      return {
        id: t,
        name: t,
        records: list.length,
        proven: list.filter(fullyProven).length,
        domains: doms
          .map((d) => ({ id: d, records: list.filter((r) => r.domain === d).length }))
          .sort((a, b) => b.records - a.records),
        recent: list
          .filter((r) => isDate(r.createdAt))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 3)
          .map((r) => ({ id: r.id, date: r.createdAt.slice(0, 10) })),
      };
    })
    .sort((a, b) => b.records - a.records);
  const dated = recs.filter((r) => isDate(r.createdAt));
  const days: contents.DayCount[] = [...new Set(dated.map((r) => r.createdAt.slice(0, 10)))]
    .sort()
    .map((d) => {
      const ids = dated.filter((r) => r.createdAt.startsWith(d)).map((r) => r.id);
      return { date: d, count: ids.length, ids };
    });
  const months = [...new Set(days.map((d) => d.date.slice(0, 7)))].map((m) => ({
    key: m,
    label: monthLabel(m, language),
    count: days.filter((d) => d.date.startsWith(m)).reduce((a, d) => a + d.count, 0),
  }));
  return {
    teams,
    unowned: recs.filter((r) => !r.team).length,
    days,
    range: { from: days[0]?.date ?? "", to: days.at(-1)?.date ?? "" },
    months,
    undated: recs.length - dated.length,
  };
}

/** Taxonomy ---------------------------------------------------------------------------------- */

export function taxonomyDomains(
  model: AtlasModel,
  domains: {
    id: string;
    title: string;
    purpose: string;
    cls: string;
    team: string;
    capabilities: { id: string; title: string }[];
  }[],
): contents.TaxDomain[] {
  const recs = model.features;
  return domains.map((d) => ({
    id: d.id,
    title: d.title,
    purpose: d.purpose,
    klass: d.cls,
    team: d.team,
    capabilities: d.capabilities.map((c) => {
      const list = recs.filter((r) => r.domain === d.id && r.capability === c.id);
      return {
        id: `${d.id}/${c.id}`,
        title: c.title,
        records: list.length,
        proven: list.filter((r) => r.total > 0 && r.proven === r.total).length,
        scenarios: list.reduce((a, r) => a + r.total, 0),
      };
    }),
  }));
}

/** Calibration ------------------------------------------------------------------------------- */

/** Label and unit of the four metrics the registry defines; any other metric keeps its name. */
function calLabels(name: string, t: T): [string, string] | undefined {
  switch (name) {
    case "scenarios per record":
      return [
        t("ui.reader.derive-contents-promises-per-record"),
        t("ui.reader.derive-contents-promises"),
      ];
    case "records per capability":
      return [
        t("ui.reader.derive-contents-records-per-capability"),
        t("ui.reader.derive-contents-records"),
      ];
    case "capabilities per domain":
      return [
        t("ui.reader.derive-contents-capabilities-per-area"),
        t("ui.reader.derive-contents-capabilities"),
      ];
    case "records per anchored file":
      return [
        t("ui.reader.derive-contents-records-per-anchored-file"),
        t("ui.reader.derive-contents-records"),
      ];
  }
}

export function calibration(model: AtlasModel, tax: contents.TaxDomain[], t: T) {
  const values: Record<string, { id: string; v: number }[]> = {
    "scenarios per record": model.features.map((r) => ({ id: r.id, v: r.total })),
    "records per capability": tax.flatMap((d) =>
      d.capabilities.filter((c) => c.records > 0).map((c) => ({ id: c.id, v: c.records })),
    ),
    "capabilities per domain": tax.map((d) => ({ id: d.id, v: d.capabilities.length })),
  };
  const metrics = model.calibration?.metrics ?? [];
  return {
    metrics: metrics.map((m) => ({
      key: m.name,
      label: calLabels(m.name, t)?.[0] ?? m.name,
      unit: calLabels(m.name, t)?.[1] ?? "",
      median: m.median,
      min: m.min,
      max: m.max,
      samples: m.samples,
      below: m.below,
      above: m.above,
      band: m.band,
      values: values[m.name]?.map((x) => x.v),
    })),
    outliers: metrics.flatMap((m) =>
      (values[m.name] ?? [])
        .filter((x) => x.v > m.band.high || x.v < m.band.low)
        .sort((a, b) => b.v - a.v)
        .map((x) => ({
          metric: m.name,
          id: x.id,
          value: x.v,
          side: x.v > m.band.high ? ("above" as const) : ("below" as const),
          band: `${m.band.low}–${m.band.high}`,
        })),
    ),
  };
}

/** Tests ------------------------------------------------------------------------------------- */

const KIND_OF = { unit: "Unit", integration: "Integration", e2e: "E2E" } as const;

export function testFiles(model: AtlasModel): contents.TestFileRow[] {
  const m = new Map<
    string,
    { kind: contents.TestKind; names: Set<string>; proves: Set<string>; records: Set<string> }
  >();
  for (const r of listedRecords(model))
    for (const t of r.tests) {
      const band = testBand(t.kind);
      if (!band) continue;
      const { file, name } = splitTest(t.id);
      const e = m.get(file) ?? {
        kind: KIND_OF[band],
        names: new Set<string>(),
        proves: new Set<string>(),
        records: new Set<string>(),
      };
      e.names.add(name ?? t.id);
      t.proves.forEach((p) => e.proves.add(`${r.id}#${p}`));
      e.records.add(r.id);
      m.set(file, e);
    }
  return [...m.entries()]
    .map(([path, e]) => ({
      path,
      kind: e.kind,
      tests: e.names.size,
      promises: e.proves.size,
      records: [...e.records],
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function testKinds(files: contents.TestFileRow[]) {
  return (["Unit", "Integration", "E2E"] as contents.TestKind[]).map((kind) => {
    const list = files.filter((f) => f.kind === kind);
    return {
      kind,
      tests: list.reduce((a, f) => a + f.tests, 0),
      files: list.length,
      promises: list.reduce((a, f) => a + f.promises, 0),
    };
  });
}

/** Deviations, drift, fixes ------------------------------------------------------------------ */

export function deviations(model: AtlasModel): contents.Deviation[] {
  return model.allScn
    .filter((s) => s.deviation)
    .map((s) => ({
      key: `${s.rec.id}#${s.id}`,
      recordId: s.rec.id,
      scenarioId: s.id,
      then: s.steps
        .filter((st) => st.keyword === "THEN")
        .map((st) => st.text)
        .join(" "),
      reason: s.deviation!.reason,
      confirmedBy: s.deviation!.confirmedBy || null,
      // The record carries no date for a deviation: not known, rendered as "—".
      since: null,
    }));
}

export function driftItems(model: AtlasModel): contents.DriftItem[] {
  return (model.scan.drift ?? [])
    .map((d) => ({ recordId: d.id, path: d.path, changedAt: d.changedAt }))
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
}

export function fixCommits(model: AtlasModel): contents.FixCommit[] {
  const m = new Map<string, contents.FixCommit>();
  for (const r of model.recs)
    for (const x of r.defects.fixes) {
      const e = m.get(x.commit) ?? {
        sha: x.commit,
        date: x.date,
        subject: x.subject,
        scope: /^\w+\(([^)]+)\)/.exec(x.subject)?.[1] ?? null,
        ticket: x.issue || null,
        records: [],
        domain: r.domain,
        files: null,
        recordedBy: x.recordedBy || null,
      };
      if (!e.records.includes(r.id)) e.records.push(r.id);
      // Files are reported per record; the commit touched all of them. None reported stays null.
      if (x.files?.length) e.files = [...new Set([...(e.files ?? []), ...x.files])];
      m.set(x.commit, e);
    }
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Anchors and files ------------------------------------------------------------------------- */

const ROLES: contents.AnchorRole[] = ["primary", "related", "config", "data"];

export function anchorRows(model: AtlasModel): contents.AnchorRow[] {
  return model.anchorPairs.map((a) => ({
    path: a.path,
    line: a.line,
    role: (ROLES as string[]).includes(a.role) ? (a.role as contents.AnchorRole) : "none",
    recordId: a.id,
    // An anchor naming an id no record carries leads nowhere: it is shown, not linked.
    ...(model.byId[a.id] ? {} : { orphan: true }),
  }));
}

/** The anchors the scan found naming an id no record of this registry carries,
 * as table rows marked orphan. They are kept apart from `anchorRows`, which
 * counts the anchors that reach a record. */

export function orphanRows(model: AtlasModel): contents.AnchorRow[] {
  return (model.scan.orphanAnchors ?? []).map((o) => ({
    path: o.path,
    line: o.line,
    role: "none",
    recordId: o.id,
    orphan: true,
  }));
}

export const dirKey = (p: string) => {
  const parts = p.split("/");
  return parts.length > 2 ? parts.slice(0, 2).join("/") : parts.length === 2 ? parts[0] : ".";
};

export function anchorDirs(rows: contents.AnchorRow[]): contents.AnchorDir[] {
  return [...new Set(rows.map((a) => dirKey(a.path)))]
    .map((d) => {
      const list = rows.filter((a) => dirKey(a.path) === d);
      return {
        path: d,
        anchors: list.length,
        files: new Set(list.map((r) => r.path)).size,
        records: new Set(list.map((r) => r.recordId)).size,
      };
    })
    .sort((a, b) => b.anchors - a.anchors);
}

export function anchorRoles(rows: contents.AnchorRow[]) {
  return ([...ROLES, "none"] as contents.AnchorRole[]).map((role) => ({
    role,
    count: rows.filter((a) => a.role === role).length,
  }));
}

/** Directory share of anchored files; `null` when the scan sent no file lists. */
export function dirShares(model: AtlasModel): Map<string, number> | null {
  const { anchoredFiles: a, unanchoredFiles: u } = model.scan;
  if (!a || !u) return null;
  const count = new Map<string, { a: number; all: number }>();
  const add = (path: string, anchored: boolean) => {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const e = count.get(dir) ?? { a: 0, all: 0 };
      e.all += 1;
      if (anchored) e.a += 1;
      count.set(dir, e);
    }
  };
  a.forEach((f) => add(f.path, true));
  u.forEach((f) => add(f.path, false));
  return new Map([...count.entries()].map(([d, e]) => [d, e.a / e.all]));
}

export function fileTree(
  paths: string[],
  shares: Map<string, number> | null,
  prefix = "",
  depth = 0,
): contents.FileNode[] {
  const heads = [...new Set(paths.map((p) => p.split("/")[0]))];
  return heads
    .map((h) => {
      const under = paths.filter((p) => p.split("/")[0] === h);
      const full = prefix ? `${prefix}/${h}` : h;
      const rest = under.map((p) => p.split("/").slice(1).join("/")).filter(Boolean);
      const isDir = rest.length > 0;
      return {
        path: full,
        name: h,
        anchored: isDir ? rest.length : 1,
        share: isDir ? (shares?.get(full) ?? null) : 1,
        children: isDir && depth < 3 ? fileTree(rest, shares, full, depth + 1) : undefined,
      };
    })
    .sort((a, b) => b.anchored - a.anchored);
}

export function fileGaps(model: AtlasModel, shares: Map<string, number> | null, n = 40) {
  const u = model.scan.unanchoredFiles;
  if (!u || !shares) return [];
  // A host that ships no line count for a file leaves it unmeasured: it ranks
  // last and reads as not measured, never as a file of zero lines.
  const lines = (f: { loc?: unknown }) =>
    typeof f.loc === "number" && Number.isFinite(f.loc) ? f.loc : null;
  return [...u]
    .sort((a, b) => (lines(b) ?? -1) - (lines(a) ?? -1))
    .slice(0, n)
    .map((f) => {
      const dir = f.path.split("/").slice(0, -1).join("/") || ".";
      return {
        path: f.path,
        loc: lines(f),
        dir,
        dirAnchoredPct: ratioPercent(shares.get(dir) ?? 0),
      };
    });
}

/** Rules ------------------------------------------------------------------------------------ */

export function rules(model: AtlasModel): contents.RuleItem[] {
  return model.policies.map((p) => {
    const statements = p.clauses.map((c) => text(c.text)).filter(Boolean);
    const req = p.clauses.map((c) => text(c.requirement).toLowerCase());
    const strength: contents.RuleItem["strength"] = req.some((r) => r.startsWith("must"))
      ? "must"
      : req.some((r) => r.startsWith("should"))
        ? "should"
        : "may";
    return {
      id: p.id,
      title: p.label || short(p.id),
      statement: statements[0] || p.summary,
      strength,
      appliesTo: p.referencedBy,
      source: p.path,
      // Nothing in the reader checks a rule against its records: not checked, never "kept".
      violations: null,
    };
  });
}

/** Glossary --------------------------------------------------------------------------------- */

export function glossaryTerms(derived: DerivedModel): contents.GlossaryTerm[] {
  const g = derived.glossary;
  if (!g) return [];
  const category = new Map<string, string>();
  for (const grp of g.groups ?? []) for (const t of grp.terms) category.set(t, grp.title ?? grp.id);
  return g.terms.map((t) => ({
    term: t.term,
    definition: t.definition,
    category: category.get(t.term) ?? "",
    aliases: [],
    records: g.usedBy[t.term]?.length ?? 0,
    status: "settled" as const,
  }));
}

export function glossaryDetail(
  derived: DerivedModel,
  term: string,
): contents.GlossaryTermDetail | null {
  const g = derived.glossary;
  const t = g?.terms.find((x) => x.term === term);
  if (!g || !t) return null;
  const base = glossaryTerms(derived).find((x) => x.term === term)!;
  const ids = g.usedBy[term] ?? [];
  const related = g.terms
    .filter((x) => x.term !== term && (g.usedBy[x.term] ?? []).some((id) => ids.includes(id)))
    .slice(0, 6)
    .map((x) => x.term);
  const translation = Object.entries(t.renderings)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  // Where the glossary groups, the term's category stands as declared, as an
  // undeclared id, or as assigned by nobody; where it does not, no line at all.
  const cat = g.groups ? categoryOf(g.groups, term) : undefined;
  return {
    ...base,
    recordIds: ids,
    occurrences: [],
    related,
    history: [],
    translation: translation || undefined,
    ...(cat === undefined
      ? {}
      : { categoryState: !cat ? "unassigned" : cat.declared ? "declared" : "undeclared" }),
  };
}

/** The glossary's categories in the order the host computed them, each with the
 * terms of `shown` under it. `null` when nobody groups: the list stays flat.
 * Nothing here sorts; the host's order is the one order. */

export function glossaryGroups(
  derived: DerivedModel,
  shown: contents.GlossaryTerm[],
): contents.GlossaryGroup[] | null {
  const groups = derived.glossary?.groups;
  if (!groups) return null;
  const byName = new Map(shown.map((t) => [t.term, t]));
  return groups.map((g) => ({
    id: g.id,
    title: g.declared ? g.title : undefined,
    purpose: g.purpose,
    state: g.id === "" ? "none" : !g.declared ? "undeclared" : g.terms.length ? "ok" : "empty",
    terms: g.terms.flatMap((name) => byName.get(name) ?? []),
    total: g.terms.length,
  }));
}

export const lettersOf = (terms: contents.GlossaryTerm[]) =>
  [...new Set(terms.map((t) => t.term.charAt(0).toUpperCase()))].sort().map((letter) => ({
    letter,
    count: terms.filter((t) => t.term.charAt(0).toUpperCase() === letter).length,
  }));

/** Hub -------------------------------------------------------------------------------------- */

export type Facts = ReturnType<typeof contentFacts>;

// @facet: registry/records/unmeasured
// @facet-role: primary
/** Every number the hub tiles show, computed once. It holds no words, so it does not depend on the language. */
export function contentFacts(model: AtlasModel, derived: DerivedModel) {
  const items = promiseItems(derived);
  const pt = promiseTotals(items, derived.M.length);
  const kn = knowledgeTotals(knowledgeRows(model, () => ""));
  const ops = opsEntries(model);
  const files = testFiles(model);
  const anchors = anchorRows(model);
  return {
    pt,
    kn,
    ops: ops.length,
    observed: new Set(ops.map((o) => o.recordId)).size,
    teams: new Set(model.features.map((r) => r.team).filter(Boolean)).size,
    domains: model.taxonomy?.domains.length ?? null,
    capabilities: model.taxonomy?.domains.reduce((n, d) => n + d.capabilities.length, 0) ?? null,
    calibration: model.calibration ? model.calibration.metrics.length : null,
    tests: files.reduce((a, f) => a + f.tests, 0),
    testFiles: files.length,
    deviations: deviations(model).length,
    drift: (model.scan.drift ?? []).length,
    fixes: fixCommits(model).length,
    anchors: anchors.length,
    files: model.scan.files ?? null,
    anchoredFiles: new Set(anchors.map((a) => a.path)).size,
    rules: model.policies.length,
    shapes: model.entities.length,
    terms: derived.glossary ? derived.glossary.terms.length : null,
    // The host's own remainder and lists: a zero is its measurement, not a default.
    cyclic: model.cyclic.length,
    unread: model.corpusErrors.length,
    decisions: model.decisionTargets.length,
  };
}

/** Cycles, unread records, decisions ------------------------------------------------------ */

/** The host's remainder after its topological pass, as sent: nodes on a cycle
 * or downstream, ids without a read record included. Nothing recomputes it. */

// @facet: registry/records/cyclic-diagnostics
// @facet-role: primary
export function cycleNodes(model: AtlasModel): contents.CycleNode[] {
  return model.cyclic.map((id) => ({ id, summary: model.byId[id]?.summary ?? null }));
}

/** Files the run could not read as records, with the line where the reader names one. */
export function unreadRecords(model: AtlasModel): contents.UnreadRecord[] {
  return model.corpusErrors.map((e) => ({
    path: e.path,
    message: e.message,
    ...(e.line ? { line: e.line } : {}),
  }));
}

/** The decision documents records name, most often named first, as the host counted them. */
export function decisionTargets(model: AtlasModel): contents.DecisionTarget[] {
  return model.decisionTargets.map((d) => ({
    target: d.target,
    count: d.count,
    recordIds: [...d.recordIds],
  }));
}

/** One view of a hub tile: `id` is the page view it opens, `key` the facet-ui key of its name. */
const view = (tt: UiT, id: string, key: TextKey) => ({ id, label: tt(key) });

/** The hub tiles in the language of `tt` (facet-ui's own hub words) and `t`
 * (the findings only Atlas knows). `views[].id` is the view key of the kind's page. */

export function contentKinds(f: Facts, t: T, tt: UiT): contents.ContentKind[] {
  const share = (a: number, b: number) => (b > 0 ? a / b : null);
  return [
    {
      key: "promises",
      label: tt("ui.reader.derive-contents-promises"),
      group: "Registry",
      icon: "shield",
      desc: tt("ui.reader.derive-contents-given-when-then-every-promise-its"),
      count: f.pt.total,
      unit: tt("ui.reader.derive-contents-promises-unit"),
      finding: tt("ui.reader.derive-contents-count-open", { count: f.pt.open }),
      tone: f.pt.open ? "warn" : "ok",
      share: share(f.pt.proven, f.pt.total),
      views: [
        view(tt, "list", "ui.reader.derive-contents-list"),
        view(tt, "mosaic", "ui.reader.derive-contents-mosaic"),
        view(tt, "open", "ui.reader.derive-contents-open-first"),
      ],
    },
    {
      key: "knowledge",
      label: tt("ui.reader.derive-contents-knowledge"),
      group: "Registry",
      icon: "bulb",
      desc: tt("ui.reader.derive-contents-five-knowledge-slots-per-record-where"),
      count: f.kn.measured ? f.kn.totals.open : null,
      unit: tt("ui.reader.derive-contents-empty-slots"),
      finding: f.kn.measured ? undefined : t("ui.reader.derive-contents-not-measured"),
      tone: f.kn.measured ? (f.kn.totals.open ? "warn" : "ok") : undefined,
      share: f.kn.measured
        ? share(f.kn.totals.filled, f.kn.totals.filled + f.kn.totals.open)
        : null,
      views: [
        view(tt, "matrix", "ui.reader.derive-contents-slot-matrix"),
        view(tt, "open", "ui.reader.derive-contents-open-questions"),
      ],
    },
    {
      key: "operations",
      label: tt("ui.reader.derive-contents-operations"),
      group: "Registry",
      icon: "pulse",
      desc: tt("ui.reader.derive-contents-slos-alarms-continuous-checks-observation-block"),
      count: f.observed,
      unit: tt("ui.reader.derive-contents-records-unit"),
      finding: t("ui.reader.derive-contents-count-entries", { count: f.ops }),
      views: [view(tt, "list", "ui.reader.derive-contents-list")],
    },
    {
      key: "provenance",
      label: tt("ui.reader.derive-contents-origin"),
      group: "Registry",
      icon: "team",
      desc: tt("ui.reader.derive-contents-who-owns-records-when-they-came"),
      count: f.teams,
      unit: tt("ui.reader.derive-contents-teams"),
      views: [
        view(tt, "team", "ui.reader.derive-contents-team"),
        view(tt, "calendar", "ui.reader.derive-contents-calendar"),
      ],
    },
    {
      key: "taxonomy",
      label: tt("ui.reader.derive-contents-taxonomy"),
      group: "Registry",
      icon: "tree",
      desc: tt("ui.reader.derive-contents-domains-capabilities-ids-drawn"),
      count: f.domains,
      // Without a taxonomy nothing was counted, so no capability count is worded.
      unit:
        f.capabilities == null
          ? t("ui.reader.derive-contents-areas")
          : tt("ui.reader.derive-contents-areas-caps-capabilities", { caps: f.capabilities }),
      finding: f.domains == null ? t("ui.reader.derive-contents-no-taxonomy") : undefined,
      views: [
        view(tt, "tree", "ui.reader.derive-contents-tree"),
        view(tt, "sun", "ui.reader.derive-contents-sunburst"),
      ],
    },
    {
      key: "calibration",
      label: tt("ui.reader.derive-contents-calibration"),
      group: "Registry",
      icon: "barChart",
      desc: tt("ui.reader.derive-contents-whether-registry-follows-its-calibration-bands"),
      count: f.calibration,
      unit: tt("ui.reader.derive-contents-measures"),
      finding: f.calibration == null ? t("ui.reader.derive-contents-not-measured") : undefined,
      views: [
        view(tt, "bands", "ui.reader.derive-contents-bands"),
        view(tt, "outliers", "ui.reader.derive-contents-outliers"),
      ],
    },
    {
      key: "tests",
      label: tt("ui.reader.derive-contents-tests"),
      group: "Evidence",
      icon: "flask",
      desc: tt("ui.reader.derive-contents-test-files-promises-they-name"),
      count: f.tests,
      unit: tt("ui.reader.derive-contents-tests-unit"),
      finding: tt("ui.reader.derive-contents-count-files", { count: f.testFiles }),
      views: [
        view(tt, "pyramid", "ui.reader.derive-contents-pyramid"),
        view(tt, "file-tree", "ui.reader.derive-contents-file-tree"),
        view(tt, "table", "ui.reader.derive-contents-table"),
      ],
    },
    {
      key: "deviations",
      label: tt("ui.reader.derive-contents-deviations"),
      group: "Evidence",
      icon: "error",
      desc: tt("ui.reader.derive-contents-behaviour-code-demonstrably-shows-nobody-wants"),
      count: f.deviations,
      unit: tt("ui.reader.derive-contents-logged"),
      tone: f.deviations ? "bad" : "ok",
      views: [view(tt, "list", "ui.reader.derive-contents-list")],
    },
    {
      key: "drift",
      label: tt("ui.reader.derive-contents-drift"),
      group: "Evidence",
      icon: "offsetBlocks",
      desc: tt("ui.reader.derive-contents-code-changed-without-its-record-following"),
      count: f.drift,
      unit: tt("ui.reader.derive-contents-files"),
      tone: f.drift ? "warn" : "ok",
      views: [
        view(tt, "record", "ui.reader.derive-contents-record"),
        view(tt, "timeline", "ui.reader.derive-contents-timeline"),
      ],
    },
    {
      key: "fixed",
      label: tt("ui.reader.derive-contents-fixed"),
      group: "Evidence",
      icon: "checkUnderline",
      desc: tt("ui.reader.derive-contents-bug-fix-commits-attributed-records-through"),
      count: f.fixes,
      unit: tt("ui.reader.derive-contents-fixes"),
      views: [
        view(tt, "timeline", "ui.reader.derive-contents-timeline-views"),
        view(tt, "domain", "ui.reader.derive-contents-area"),
      ],
    },
    {
      key: "anchor",
      label: tt("ui.reader.derive-contents-anchors"),
      group: "Code",
      icon: "anchor",
      desc: tt("ui.reader.derive-contents-every-facet-tag-source-line-points"),
      count: f.anchors,
      unit: tt("ui.reader.derive-contents-anchors-unit"),
      finding: t("ui.reader.derive-contents-count-files", { count: f.anchoredFiles }),
      views: [
        view(tt, "treemap", "ui.reader.derive-contents-treemap"),
        view(tt, "table", "ui.reader.derive-contents-table"),
      ],
    },
    {
      key: "files",
      label: tt("ui.reader.derive-contents-files-label"),
      group: "Code",
      icon: "file",
      desc: tt("ui.reader.derive-contents-what-scan-read-anchor-without"),
      count: f.files,
      unit: tt("ui.reader.derive-contents-files"),
      finding: f.files == null ? t("ui.reader.derive-contents-not-measured") : undefined,
      share: f.files == null ? null : share(f.anchoredFiles, f.files),
      views: [
        view(tt, "tree", "ui.reader.derive-contents-tree"),
        view(tt, "gaps", "ui.reader.derive-contents-gaps"),
      ],
    },
    {
      key: "rules",
      label: tt("ui.reader.derive-contents-rules"),
      group: "Context",
      icon: "checklist",
      desc: tt("ui.reader.derive-contents-policies-apply-records"),
      count: f.rules,
      unit: tt("ui.reader.derive-contents-policies"),
      views: [view(tt, "list", "ui.reader.derive-contents-list")],
    },
    {
      key: "data-shapes",
      label: t("ui.reader.derive-contents-data-shapes"),
      group: "Context",
      icon: "table",
      desc: t("ui.reader.derive-contents-data-objects-their-fields-who-reads"),
      count: f.shapes,
      unit: t("ui.reader.derive-contents-data-shapes-unit"),
      views: [{ id: "list", label: t("ui.reader.derive-contents-list") }],
    },
    {
      key: "glossary",
      label: tt("ui.reader.derive-contents-glossary"),
      group: "Context",
      icon: "book",
      desc: tt("ui.reader.derive-contents-terms-explained-once-where-each-appears"),
      count: f.terms,
      unit: tt("ui.reader.derive-contents-terms"),
      finding: f.terms == null ? t("ui.reader.derive-contents-not-declared") : undefined,
      views: [view(tt, "az", "ui.reader.derive-contents-z")],
    },
    {
      key: "cycles",
      label: tt("ui.reader.derive-contents-cycles"),
      group: "Registry",
      icon: "network",
      desc: tt("ui.reader.derive-contents-records-dependency-cycle-behind-one"),
      count: f.cyclic,
      unit: tt("ui.reader.derive-contents-nodes"),
      tone: f.cyclic ? "bad" : "ok",
      views: [view(tt, "list", "ui.reader.derive-contents-list")],
    },
    {
      key: "read-errors",
      label: tt("ui.reader.derive-contents-not-read"),
      group: "Registry",
      icon: "error",
      desc: tt("ui.reader.derive-contents-files-run-could-not-read-records"),
      count: f.unread,
      unit: tt("ui.reader.derive-contents-files"),
      // A file that could not be read is a fault in the registry: its count stands in red.
      tone: f.unread ? "bad" : "ok",
      views: [view(tt, "list", "ui.reader.derive-contents-list")],
    },
    {
      key: "decisions",
      label: tt("ui.reader.derive-contents-decisions"),
      group: "Context",
      icon: "scales",
      desc: tt("ui.reader.derive-contents-documents-records-lean"),
      count: f.decisions,
      unit: tt("ui.reader.derive-contents-documents"),
      views: [view(tt, "list", "ui.reader.derive-contents-list")],
    },
  ];
}

export function hubHeadline(model: AtlasModel, f: Facts, kinds: number, tt: UiT) {
  return {
    records: model.features.length,
    open: f.pt.open + f.kn.totals.open + f.drift,
    sentence: tt("ui.reader.derive-contents-kinds-kinds-content-across-records-records", {
      kinds,
      records: model.features.length,
    }),
  };
}
