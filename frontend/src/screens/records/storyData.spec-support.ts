/** Maps the registry snapshot onto the view models of group B. Used by the
 * stories and the tests; the page components never import fixtures. */

import { registry } from "../../fixtures/registry";
import { makeFeatures, makeGlossary, type GeneratedFeature } from "../../fixtures/generate";
import type { FixtureFeature } from "../../fixtures/types";
import { type Facet } from "@facet-tools/ui";

import {
  TAG,
  parseSteps,
  share,
  type KnowledgeKey,
  type Lifecycle,
  type RecordKind,
  type RecordRow,
} from "./model";
import type { FieldGroup, MatrixRow, RecordsSummary } from "./RecordsPage";
import type { RecordScenario, RecordDetails, Sibling } from "./RecordDetailsPage";
import type { NetworkGraph } from "./DependencyNetwork";
import { ADMIN_RECORD_JSON, ADMIN_RECORD_YAML, TEST_COUNTS } from "./recordFacts.spec-support";

/** Moved files per record — the same source the top bar's Drift counts. */
const driftOf = (id: string) => registry.drift.filter((d) => d.id === id);

/** Order of the five Knowledge answers in the snapshot's `knowledge` array. */
const SNAPSHOT_SLOTS: KnowledgeKey[] = [
  "prerequisite_knowledge",
  "discoverability",
  "success_signal",
  "not_for",
  "common_pitfalls",
];

const lc = (s: string): Lifecycle => (s === "planned" || s === "deprecated" ? s : "active");

export function featureById(id: string): FixtureFeature {
  const f = registry.features.find((x) => x.id === id);
  if (!f) throw new Error(`no record ${id} in the snapshot`);
  return f;
}

export function toRow(f: FixtureFeature): RecordRow {
  return {
    id: f.id,
    slug: f.slug,
    domain: f.domain,
    capability: f.capability,
    kind: f.type === "assumption" ? "assumption" : "feature",
    lifecycle: lc(f.lifecycle),
    owner: f.owner,
    summary: f.summary,
    scenarios: f.scenarioCount,
    proven: f.provenCount,
    anchors: f.anchorCount,
    drift: driftOf(f.id).length,
    knowledgeOpen: f.knowledgeOpen,
    changedAt: f.log[0]?.date ?? f.createdAt,
  };
}

export function generatedRow(g: GeneratedFeature): RecordRow {
  return {
    id: g.id,
    slug: g.id.split("/")[2],
    domain: g.domain,
    capability: g.capability,
    kind: "feature",
    lifecycle: g.lifecycle,
    owner: g.owner,
    summary: "",
    scenarios: g.scenarios,
    proven: g.proven,
    anchors: g.anchors,
    drift: g.drift,
    knowledgeOpen: g.knowledgeOpen,
    changedAt: g.changedAt,
  };
}

export const REAL_ROWS: RecordRow[] = registry.features.map(toRow);
export const MANY_ROWS: RecordRow[] = makeFeatures(4812).map(generatedRow);

export function summaryOf(rows: RecordRow[]): RecordsSummary {
  const scenarios = rows.reduce((a, r) => a + r.scenarios, 0);
  const proven = rows.reduce((a, r) => a + r.proven, 0);
  return {
    total: rows.length,
    provenPct: share(proven, scenarios),
    drift: rows.filter((r) => r.drift > 0).length,
    knowledgeOpen: rows.some((r) => r.knowledgeOpen != null)
      ? rows.reduce((a, r) => a + (r.knowledgeOpen ?? 0), 0)
      : null,
    domains: new Set(rows.filter((r) => r.kind === "feature").map((r) => r.domain)).size,
    assumptions: rows.filter((r) => r.kind === "assumption").length,
  };
}

export function search(rows: RecordRow[], query: string): RecordRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.id.toLowerCase().includes(q) || (r.owner ?? "").includes(q));
}

export type Filters = {
  domain?: string;
  lifecycle?: Lifecycle;
  drift?: boolean;
  kind?: RecordKind;
};

export function applyFilters(rows: RecordRow[], f: Filters): RecordRow[] {
  return rows.filter(
    (r) =>
      (!f.domain || r.domain === f.domain) &&
      (!f.lifecycle || r.lifecycle === f.lifecycle) &&
      (!f.drift || r.drift > 0) &&
      (!f.kind || r.kind === f.kind),
  );
}

export function facetsFor(rows: RecordRow[], f: Filters): Facet[] {
  const count = (pred: (r: RecordRow) => boolean) => rows.filter(pred).length;
  return [
    {
      key: "lc:planned",
      label: "planned",
      count: count((r) => r.lifecycle === "planned"),
      active: f.lifecycle === "planned",
    },
    {
      key: "lc:deprecated",
      label: "deprecated",
      count: count((r) => r.lifecycle === "deprecated"),
      active: f.lifecycle === "deprecated",
    },
    { key: "drift", label: "with drift", count: count((r) => r.drift > 0), active: !!f.drift },
    {
      key: "kind:assumption",
      label: "Assumption",
      count: count((r) => r.kind === "assumption"),
      active: f.kind === "assumption",
    },
    ...[...new Set(rows.filter((r) => r.kind === "feature").map((r) => r.domain))].map((d) => ({
      key: `domain:${d}`,
      label: d,
      count: count((r) => r.domain === d),
      active: f.domain === d,
    })),
  ];
}

export function filterChips(f: Filters): { key: string; label: string }[] {
  return [
    ...(f.domain ? [{ key: "domain", label: `Area: ${f.domain}` }] : []),
    ...(f.lifecycle
      ? [
          {
            key: "lifecycle",
            label: `Lifecycle: ${f.lifecycle === "planned" ? "planned" : f.lifecycle === "deprecated" ? "deprecated" : "active"}`,
          },
        ]
      : []),
    ...(f.drift ? [{ key: "drift", label: "with drift" }] : []),
    ...(f.kind === "assumption" ? [{ key: "kind", label: "Art: Assumption" }] : []),
  ];
}

export function fieldGroups(rows: RecordRow[], query: string): FieldGroup[] {
  const hit = new Set(search(rows, query).map((r) => r.id));
  const groups = new Map<string, FieldGroup>();
  for (const r of rows) {
    const key = `${r.kind}:${r.domain}/${r.capability}`;
    if (!groups.has(key))
      groups.set(key, { domain: r.domain, capability: r.capability, kind: r.kind, tiles: [] });
    groups.get(key)!.tiles.push({
      id: r.id,
      slug: r.slug,
      lifecycle: r.lifecycle,
      scenarios: r.scenarios,
      proven: r.proven,
      drift: r.drift,
      match: hit.has(r.id),
    });
  }
  return [...groups.values()];
}

export function matrixRows(rows: RecordRow[]): MatrixRow[] {
  const out = new Map<string, MatrixRow>();
  for (const r of rows.filter((x) => x.kind === "feature")) {
    const key = `${r.domain}/${r.capability}`;
    const m =
      out.get(key) ??
      ({
        domain: r.domain,
        capability: r.capability,
        active: 0,
        planned: 0,
        deprecated: 0,
        scenarios: 0,
        proven: 0,
        drift: 0,
      } as MatrixRow);
    m[r.lifecycle] += 1;
    m.scenarios += r.scenarios;
    m.proven += r.proven;
    m.drift += r.drift ? 1 : 0;
    out.set(key, m);
  }
  return [...out.values()];
}

export function distributionsFor(rows: RecordRow[]) {
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
  const lcLabel: Record<string, string> = {
    active: "active",
    planned: "planned",
    deprecated: "deprecated",
  };
  return [
    {
      label: "By area",
      parts: by((r) => (r.kind === "assumption" ? "Assumption" : r.domain)).map(([k, v]) => ({
        key: k,
        label: k,
        value: v,
      })),
    },
    {
      label: "By lifecycle",
      parts: by((r) => r.lifecycle).map(([k, v]) => ({
        key: k,
        label: lcLabel[k],
        value: v,
        tone: tone[k],
      })),
    },
  ];
}

export type SortKey = keyof RecordRow;

export function sortRows(rows: RecordRow[], key: SortKey, dir: "asc" | "desc"): RecordRow[] {
  const s = [...rows].sort((a, b) => {
    const x = a[key] ?? "";
    const y = b[key] ?? "";
    return typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y));
  });
  return dir === "asc" ? s : s.reverse();
}

/** Record ------------------------------------------------------------------ */

function yamlBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map((l) => indent + l)
    .join("\n");
}

/** The record re-serialised in the shape of its YAML file, from the snapshot fields. */
export function recordYaml(f: FixtureFeature): string {
  const out: string[] = ['schema_version: "0.1"', `id: ${f.id}`, `lifecycle: ${f.lifecycle}`];
  if (f.summary)
    out.push(
      "intent:",
      "  summary: |",
      yamlBlock(f.summary.replace(/(.{1,76})(\s|$)/g, "$1\n").trim(), "    "),
    );
  if (f.scenarios.length) {
    out.push("contract:", "  scenarios:");
    for (const s of f.scenarios)
      out.push(`    - id: ${s.id}`, "      statement: |", yamlBlock(s.text, "        "));
  }
  if (f.tests.length) {
    out.push("verification:", "  unit_tests:");
    for (const t of f.tests)
      out.push(`    - id: ${t.name.split("::")[0]}`, `      proves: [${t.proves.join(", ")}]`);
  }
  out.push("knowledge:");
  SNAPSHOT_SLOTS.forEach((k, i) => {
    out.push(`  ${k}:`);
    out.push(f.knowledge[i] ? `    answer: ${JSON.stringify(f.knowledge[i])}` : "    # unanswered");
  });
  out.push(
    "lineage:",
    "  owner:",
    `    team: ${f.owner ?? "null"}`,
    `  created_at: ${f.createdAt ? `"${f.createdAt}"` : "null"}`,
  );
  out.push(`  depends_on: [${f.dependsOn.join(", ")}]`);
  return out.join("\n");
}

function scenariosOf(f: FixtureFeature): RecordScenario[] {
  const all = f.provenCount >= f.scenarioCount && f.scenarioCount > 0;
  return f.scenarios.map((s) => {
    const tests = f.tests
      .filter((t) => t.proves.includes(s.id))
      .map((t) => {
        const [file, name] = t.name.split("::");
        return { kind: t.kind, file, name: name ?? null };
      });
    return { id: s.id, steps: parseSteps(s.text), proven: all || tests.length > 0, tests };
  });
}

/** Records whose file text is carried verbatim. */
const RAW: Record<string, { yaml: string; json: string }> = {
  "lists/permissions/admin": { yaml: ADMIN_RECORD_YAML, json: ADMIN_RECORD_JSON },
};

export function recordOf(id: string, opts: { allLog?: boolean } = {}): RecordDetails {
  const f = featureById(id);
  const link = (x: string) => {
    const t = registry.features.find((y) => y.id === x);
    return { id: x, lifecycle: t ? lc(t.lifecycle) : undefined };
  };
  const json = JSON.stringify(
    {
      id: f.id,
      type: f.type,
      lifecycle: f.lifecycle,
      intent: { summary: f.summary },
      contract: { scenarios: f.scenarios.map((s) => ({ id: s.id, statement: s.text })) },
      lineage: { owner: { team: f.owner }, created_at: f.createdAt, depends_on: f.dependsOn },
    },
    null,
    2,
  );
  const counted = TEST_COUNTS[f.id];
  /** Counts from the record file; kinds with no test are left out. */
  const tests: Record<string, number> = counted
    ? Object.fromEntries(Object.entries(counted).filter(([, n]) => n > 0))
    : f.tests.reduce<Record<string, number>>(
        (a, t) => ({ ...a, [t.kind]: (a[t.kind] ?? 0) + 1 }),
        {},
      );
  const raw = RAW[f.id];
  return {
    id: f.id,
    kind: f.type === "assumption" ? "assumption" : "feature",
    domain: f.domain,
    capability: f.capability,
    slug: f.slug,
    summary: f.summary,
    lifecycle: lc(f.lifecycle),
    owner: f.owner,
    createdAt: f.createdAt,
    scenarioCount: f.scenarioCount,
    provenCount: f.provenCount,
    scenarios: scenariosOf(f),
    testCount: Object.values(tests).reduce((a, n) => a + n, 0),
    testKinds: tests,
    anchorCount: f.anchorCount,
    anchors: f.anchors,
    knowledge: SNAPSHOT_SLOTS.map((key, i) => ({ key, answer: f.knowledge[i] || null })),
    logCount: f.logCount,
    log: opts.allLog ? f.log : f.log.slice(0, 4),
    dependsOn: f.dependsOn.map(link),
    dependents: registry.features.filter((x) => x.dependsOn.includes(f.id)).map((x) => link(x.id)),
    variants: f.variants.map(link),
    drift: driftOf(f.id).map((d) => ({ path: d.path, changedAt: d.changedAt })),
    observed: f.observed,
    rules: [],
    tickets: f.tickets,
    yaml: raw?.yaml ?? recordYaml(f),
    json: raw?.json ?? json,
  };
}

function siblingOf(id: string, records: FixtureFeature[]): Sibling {
  return {
    id,
    records: records.length,
    scenarios: records.reduce((a, f) => a + f.scenarioCount, 0),
    proven: records.reduce((a, f) => a + f.provenCount, 0),
  };
}

/** Neighbours on each level of a record's path, with their proven share. */
export function siblingsOf(id: string) {
  const f = featureById(id);
  const dom = registry.domains.find((d) => d.id === f.domain);
  const all = registry.features;
  return {
    domains: registry.domains.map((d) =>
      siblingOf(
        d.id,
        all.filter((x) => x.domain === d.id),
      ),
    ),
    capabilities: (dom ? dom.capabilities.map((c) => c.id) : [f.capability]).map((c) =>
      siblingOf(
        c,
        all.filter((x) => x.domain === f.domain && x.capability === c),
      ),
    ),
    records: all
      .filter((x) => x.domain === f.domain && x.capability === f.capability)
      .map((x) => siblingOf(x.slug, [x])),
  };
}

/** Every record that needs or is needed by another, in layers by depth of need. */
export function networkOf(rows: RecordRow[], query: string): NetworkGraph {
  const known = new Map(registry.features.map((f) => [f.id, f]));
  const edges: [string, string][] = registry.features.flatMap((f) =>
    f.dependsOn.filter((d) => known.has(d)).map((d): [string, string] => [f.id, d]),
  );
  const ids = [...new Set(edges.flat())];
  const depth = new Map<string, number>();
  const visit = (id: string, trail: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (trail.has(id)) return 0;
    trail.add(id);
    const needs = known.get(id)!.dependsOn.filter((d) => known.has(d));
    const d = needs.length ? 1 + Math.max(...needs.map((n) => visit(n, trail))) : 0;
    trail.delete(id);
    depth.set(id, d);
    return d;
  };
  const hit = new Set(search(rows, query).map((r) => r.id));
  return {
    nodes: ids.map((id) => {
      const f = known.get(id)!;
      return {
        id,
        slug: f.slug,
        domain: f.domain,
        lifecycle: lc(f.lifecycle),
        depth: visit(id, new Set()),
        match: hit.has(id),
      };
    }),
    edges,
  };
}

/** Sheets ------------------------------------------------------------------- */

/** Rule that binds every active record: lint rejects one without an anchor. */
export const RULE_ANCHORED = {
  id: "registry/integrity/active-records-are-anchored",
  title: "An active record carries at least one anchor",
  states: `An active record whose id has no ${TAG}: anchor in source fails lint. An anchor without a record also fails.`,
  severity: "error" as const,
  checkedBy: "tools/facet-lint/run-all.sh · verwaiste activee Records",
  since: "2026-07-26",
};

export function ruleAppliesTo(capability: string) {
  return registry.features
    .filter((f) => f.capability === capability && f.lifecycle === "active" && f.type === "feature")
    .map((f) => ({ id: f.id, holds: f.anchorCount > 0 }));
}

/** Every anchor the snapshot knows in one file, sorted by line. */
export function anchorsIn(path: string) {
  return registry.features
    .flatMap((f) =>
      f.anchors
        .filter((a) => a.path === path)
        .map((a) => ({ line: a.line, role: a.role, recordId: f.id })),
    )
    .sort((a, b) => a.line - b.line);
}

/** Source around the admin role's primary anchor (packages/board/store.go). */
export const ADMIN_EXCERPT = {
  firstLine: 1169,
  text: [
    "// checkAdmin refuses a change that only a list admin may make.",
    `// ${TAG}: lists/permissions/admin`,
    `// ${TAG}-role: primary`,
    "func checkAdmin(ctx context.Context, m Member, c Change) error {",
    "\tif c.Kind == KindRead {",
    "\t\treturn nil",
    "\t}",
    '\tif os.Getenv("TASKFLOW_ADMIN_OVERRIDE") == "0" {',
    "\t\treturn nil",
    "\t}",
    "\tif !m.IsAdmin(c.List) {",
    "\t\treturn ErrNotAdmin",
    "\t}",
  ].join("\n"),
};

export const ADMIN_CONFIG = {
  configKey: "permissions.admin_override",
  file: ".taskflow.yaml",
  defaultValue: "on",
  allowed: ["on", "off"],
  description:
    "Disables the admin check for this workspace. Read only at server start; changing the switch requires an admin.",
  env: {
    name: "TASKFLOW_ADMIN_OVERRIDE=0",
    effect: "disables the check for one process and takes precedence over the file",
  },
  readBy: [
    { path: "packages/task/import.go", line: 153 },
    { path: "packages/board/store.go", line: 1170 },
  ],
  records: ["lists/permissions/admin", "lists/permissions/lock-notify"],
};

const GLOSSARY = makeGlossary(12);

export function termOf(name: string) {
  const t = GLOSSARY.find((g) => g.term === name) ?? GLOSSARY[0];
  return {
    term: t.term,
    definition: t.definition,
    category: t.category,
    status: t.status,
    aliases: t.aliases,
    recordCount: Math.max(t.records, 6),
    related: GLOSSARY.filter((g) => g.term !== t.term)
      .slice(0, 4)
      .map((g) => g.term),
  };
}
