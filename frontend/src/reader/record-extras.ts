/** What the record page reads from a record beyond the record's base fields:
 * an Outline's examples, `contract.business_rules`, `intent.decision_records`,
 * a deviation's reason and the host's cycle report — and the targets the
 * lookup beside the page shows. */

import type { AtlasModel, FacetRecord } from "@/model";
import type { records } from "@/screens";
import type { DerivedModel } from "@/derive";
import { lifecycleOf } from "./derive-reader";

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const cell = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : String(v));
const strings = (v: unknown): string[] | null => (Array.isArray(v) ? v.map(cell) : null);

function rawScenario(rec: Pick<FacetRecord, "doc">, id: string): Raw | null {
  const contract = rec.doc.contract;
  if (!isObject(contract) || !Array.isArray(contract.scenarios)) return null;
  const s = (contract.scenarios as unknown[]).find((x) => isObject(x) && x.id === id);
  return isObject(s) ? s : null;
}

/** A scenario's `examples` blocks, in record order. A block that declares no
 * columns stands under the columns of the first block that does. */

// @facet: registry/records/scenario-outline-reading
// @facet-role: primary
export function exampleBlocks(
  rec: Pick<FacetRecord, "doc">,
  scenarioId: string,
): records.RecordExamples[] {
  const s = rawScenario(rec, scenarioId);
  if (!s || !Array.isArray(s.examples)) return [];
  const blocks = (s.examples as unknown[]).filter(isObject);
  const inherited = blocks.map((b) => strings(b.columns)).find((c) => c && c.length) ?? [];
  return blocks.map((b) => {
    const own = strings(b.columns);
    return {
      name: cell(b.name),
      columns: own && own.length ? own : inherited,
      rows: Array.isArray(b.rows) ? b.rows.map((r) => strings(r) ?? [cell(r)]) : [],
    };
  });
}

/** `contract.business_rules` in record order; `null` when the record does not
 * carry the field. Entries without an id or a known kind are skipped, and
 * completeness is read only on a table. */

// @facet: registry/records/business-rules
// @facet-role: primary
export function businessRules(
  rec: Pick<FacetRecord, "doc" | "scenarios">,
): records.RecordBusinessRule[] | null {
  const contract = rec.doc.contract;
  if (!isObject(contract) || !("business_rules" in contract)) return null;
  const list = contract.business_rules;
  if (!Array.isArray(list)) return [];
  const declared = new Set(rec.scenarios.map((s) => s.id));
  const out: records.RecordBusinessRule[] = [];
  for (const entry of list as unknown[]) {
    if (!isObject(entry)) continue;
    const id = str(entry.id);
    const kind = entry.kind;
    if (!id || (kind !== "table" && kind !== "formula")) continue;
    const c = entry.completeness;
    out.push({
      id,
      kind,
      states: str(entry.states),
      model: str(entry.model),
      element: str(entry.element),
      completeness: kind === "table" && (c === "claimed" || c === "not-claimed") ? c : null,
      cases: (Array.isArray(entry.scenarios) ? (entry.scenarios as unknown[]) : [])
        .filter((x): x is string => typeof x === "string")
        .map((sid) => ({ id: sid, declared: declared.has(sid) })),
    });
  }
  return out;
}

/** `intent.decision_records` in record order; `null` when the record does not
 * carry the field, which is not the same as an empty list. */

// @facet: registry/records/decision-records
// @facet-role: primary
export function decisionsOf(rec: Pick<FacetRecord, "doc">): records.RecordDecision[] | null {
  const intent = rec.doc.intent;
  if (!isObject(intent) || !("decision_records" in intent)) return null;
  const list = intent.decision_records;
  if (!Array.isArray(list)) return [];
  return (list as unknown[])
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map((target) => ({ target }));
}

/** The record with everything this file reads added: examples, rule cases
 * and deviation reasons on the scenarios, the rules, decisions and cycle flag
 * on the record. */

export function withDeclarations(
  model: AtlasModel,
  record: records.RecordDetails,
): records.RecordDetails {
  const rec = model.byId[record.id];
  if (!rec) return record;
  const rules = businessRules(rec);
  return {
    ...record,
    scenarios: record.scenarios.map((s) => {
      const source = rec.scenarios.find((x) => x.id === s.id);
      return {
        ...s,
        examples: exampleBlocks(rec, s.id),
        caseOf: (rules ?? [])
          .filter((r) => r.cases.some((c) => c.id === s.id))
          .map((r) => ({ id: r.id, states: r.states })),
        deviation: source?.deviation?.reason || null,
      };
    }),
    businessRules: rules,
    decisions: decisionsOf(rec),
    cyclic: model.cyclic.includes(rec.id),
  };
}

/** What the lookup beside the record shows. */
export type LookupRequest = { kind: "term" | "record"; id: string };

/** The lookup's target: a glossary term with its category and the records
 * using it, or a referenced record with the features that refer to it. */

// @facet: registry/catalogue/reference-lookup
// @facet-role: related
export function lookupTarget(
  model: AtlasModel,
  derived: DerivedModel,
  req: LookupRequest,
): records.LookupTarget {
  if (req.kind === "term") {
    const g = derived.glossary;
    const entry = g?.terms.find((x) => x.term === req.id);
    if (!g || !entry) return { kind: "missing", what: "term", id: req.id };
    const group = g.groups?.find((x) => x.terms.includes(entry.term));
    return {
      kind: "term",
      term: entry.term,
      definition: entry.definition,
      category: !g.groups
        ? null
        : group
          ? {
              label: group.declared ? (group.title ?? group.id) : group.id,
              declared: group.declared,
            }
          : "unassigned",
      renderings: Object.entries(entry.renderings).map(([k, v]) => `${k}: ${v}`),
      records: g.usedBy[entry.term] ?? [],
    };
  }
  const rec = model.byId[req.id];
  if (!rec) return { kind: "missing", what: "record", id: req.id };
  const referredBy = model.features
    .filter(
      (f) =>
        f.relatedPolicies.includes(rec.id) ||
        f.relatedAssumptions.includes(rec.id) ||
        f.relatedEntities.includes(rec.id) ||
        f.dependsOn.includes(rec.id),
    )
    .map((f) => f.id)
    .sort();
  return {
    kind: "record",
    id: rec.id,
    recordKind: rec.kind,
    lifecycle: lifecycleOf(rec),
    summary: rec.summary,
    referredBy,
  };
}
