/** Story view models of group C, derived from the registry snapshot and the
 * generators. Pages never import this; stories and specs do. */

import { registry } from "../../fixtures/registry";
import { createText, type FacetText } from "../text";
import { SUMMARY } from "../../fixtures/summary";
import { PEOPLE, rng } from "../../fixtures/generate";
import type { FixtureFeature } from "../../fixtures/types";
import type {
  AnchorDir,
  AnchorRole,
  AnchorRow,
  CalibrationMetric,
  ContentKind,
  DayCount,
  Deviation,
  FileNode,
  FixCommit,
  GlossaryTerm,
  GlossaryTermDetail,
  GrantItem,
  KnowledgeRow,
  OpsEntry,
  Outlier,
  PluginRow,
  PromiseItem,
  PromiseRecord,
  PromiseState,
  RuleItem,
  TaxDomain,
  TeamProvenance,
  TestFileRow,
  TestKind,
} from "./model";

const F: FixtureFeature[] = registry.features.filter((f) => f.type === "feature");
export const NOW = registry.origin.generatedAt;

/** Promises ------------------------------------------------------------------ */

/** The snapshot lists scenario texts for only part of each record, and its test
 * mapping is partial. The record's own counts are the truth: a record with
 * `scenarioCount - provenCount` open promises marks that many listed scenarios
 * open, unmapped ones first. */

function scenarioStates(f: FixtureFeature): Map<string, PromiseState> {
  const mapped = (id: string) => f.tests.some((t) => t.proves.includes(id));
  const order = [...f.scenarios].sort((a, b) => Number(mapped(a.id)) - Number(mapped(b.id)));
  const open = new Set(
    order.slice(0, Math.max(0, f.scenarioCount - f.provenCount)).map((s) => s.id),
  );
  return new Map(f.scenarios.map((s) => [s.id, open.has(s.id) ? "open" : "proven"]));
}

const STATES = new Map(F.map((f) => [f.id, scenarioStates(f)]));
const stateOf = (f: FixtureFeature, id: string): PromiseState =>
  STATES.get(f.id)?.get(id) ?? "proven";

export const promiseItems: PromiseItem[] = F.flatMap((f) =>
  f.scenarios.map((s) => ({
    key: `${f.id}#${s.id}`,
    recordId: f.id,
    scenarioId: s.id,
    text: s.text,
    state: stateOf(f, s.id),
    tests: f.tests
      .filter((t) => t.proves.includes(s.id))
      .map((t) => ({ name: t.name, kind: t.kind })),
  })),
);

export const promiseRecords: PromiseRecord[] = F.map((f) => ({
  id: f.id,
  domain: f.domain,
  cells: f.scenarios.map((s) => ({ scenarioId: s.id, state: stateOf(f, s.id) })),
}));

/** Headline figures come from SUMMARY; the list below them is the part with text. */
export const promiseTotals = {
  total: SUMMARY.scenarios,
  proven: SUMMARY.proven,
  open: SUMMARY.open,
  deviating: 0,
  records: SUMMARY.features,
  listed: promiseItems.length,
  listedOpen: promiseItems.filter((i) => i.state === "open").length,
  listedProven: promiseItems.filter((i) => i.state === "proven").length,
};

export const openPromises = promiseItems.filter((i) => i.state !== "proven");

/** Knowledge ------------------------------------------------------------------ */

export const KNOW_SLOTS = [
  "Prerequisite",
  "Not for",
  "Getting started",
  "Typical mistakes",
  "Success signal",
];

export const knowledgeRows: KnowledgeRow[] = F.map((f) => ({
  id: f.id,
  domain: f.domain,
  slots: f.knowledge.map((k) => (k ? k.slice(0, 80) : null)),
}));

export const knowledgeOpenPerSlot = KNOW_SLOTS.map(
  (_, i) => knowledgeRows.filter((r) => r.slots[i] == null).length,
);
export const knowledgeTotals = {
  records: knowledgeRows.length,
  open: knowledgeOpenPerSlot.reduce((a, b) => a + b, 0),
  filled: knowledgeRows.length * 5 - knowledgeOpenPerSlot.reduce((a, b) => a + b, 0),
};

/** Operations ----------------------------------------------------------------- */

const observed = F.find((f) => f.observed)?.id ?? F[0].id;
export const opsEntries: OpsEntry[] = [
  {
    key: "o1",
    recordId: observed,
    kind: "SLO",
    name: "Search answer",
    target: "p95 ≤ 400 ms",
    window: "28 Days",
    source: "observation.slo[0]",
  },
  {
    key: "o2",
    recordId: observed,
    kind: "SLO",
    name: "Index current",
    target: "≤ 1 Commit behind HEAD",
    window: "laufend",
    source: "observation.slo[1]",
  },
  {
    key: "o3",
    recordId: observed,
    kind: "Alert",
    name: "Embedding failed",
    target: "> 3 in 10 min",
    source: "observation.alerts[0]",
  },
  {
    key: "o4",
    recordId: observed,
    kind: "ContinuousCheck",
    name: "Model loading",
    target: "every 15 min",
    source: "observation.checks[0]",
  },
];

/** Provenance ------------------------------------------------------------------ */

export const provenanceTeams: TeamProvenance[] = [
  ...new Set(F.map((f) => f.owner).filter(Boolean)),
].map((o) => {
  const list = F.filter((f) => f.owner === o);
  const doms = [...new Set(list.map((f) => f.domain))];
  return {
    id: o as string,
    name: o === "core" ? "Core team" : o === "infra" ? "Infrastructure" : (o as string),
    purpose:
      o === "core" ? "Tasks, lists and their synchronisation." : "Builds, runners and delivery.",
    records: list.length,
    proven: list.filter((f) => f.scenarioCount > 0 && f.provenCount === f.scenarioCount).length,
    domains: doms
      .map((d) => ({ id: d, records: list.filter((f) => f.domain === d).length }))
      .sort((a, b) => b.records - a.records),
    recent: [...list]
      .filter((f) => f.createdAt)
      .sort((a, b) => (b.createdAt as string).localeCompare(a.createdAt as string))
      .slice(0, 3)
      .map((f) => ({ id: f.id, date: f.createdAt as string })),
  };
});
export const provenanceUnowned = F.filter((f) => !f.owner).length;

const dated = F.filter((f) => f.createdAt);
export const provenanceDays: DayCount[] = [...new Set(dated.map((f) => f.createdAt as string))]
  .sort()
  .map((d) => {
    const ids = dated.filter((f) => f.createdAt === d).map((f) => f.id);
    return { date: d, count: ids.length, ids };
  });
export const provenanceRange = {
  from: provenanceDays[0]?.date ?? "",
  to: provenanceDays.at(-1)?.date ?? "",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const provenanceMonths = [...new Set(provenanceDays.map((d) => d.date.slice(0, 7)))].map(
  (m) => ({
    key: m,
    label: `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`,
    count: provenanceDays.filter((d) => d.date.startsWith(m)).reduce((a, d) => a + d.count, 0),
  }),
);
export const provenanceUndated = F.length - dated.length;

/** Taxonomy -------------------------------------------------------------------- */

export const taxonomy: TaxDomain[] = registry.domains.map((d) => ({
  id: d.id,
  title: d.title,
  purpose: d.purpose,
  klass: d.class,
  team: d.team,
  capabilities: d.capabilities.map((c) => {
    const list = F.filter((f) => f.domain === d.id && f.capability === c.id);
    return {
      id: `${d.id}/${c.id}`,
      title: c.title,
      records: list.length,
      proven: list.filter((f) => f.scenarioCount > 0 && f.provenCount === f.scenarioCount).length,
      scenarios: list.reduce((a, f) => a + f.scenarioCount, 0),
    };
  }),
}));

/** Calibration ------------------------------------------------------------------- */

const LABELS: Record<string, [string, string]> = {
  "scenarios per record": ["Promises per record", "Promises"],
  "records per capability": ["Records per capability", "Records"],
  "capabilities per domain": ["Capabilities per area", "Capabilities"],
  "records per anchored file": ["Records per anchored file", "Records"],
};
const capCounts = taxonomy.flatMap((d) => d.capabilities.map((c) => ({ id: c.id, v: c.records })));
const VALUES: Record<string, { id: string; v: number }[]> = {
  "scenarios per record": F.map((f) => ({ id: f.id, v: f.scenarioCount })),
  "records per capability": capCounts,
  "capabilities per domain": taxonomy.map((d) => ({ id: d.id, v: d.capabilities.length })),
};
export const calibration: CalibrationMetric[] = registry.calibration.map((m) => ({
  key: m.name,
  label: LABELS[m.name]?.[0] ?? m.name,
  unit: LABELS[m.name]?.[1] ?? "",
  median: m.median,
  min: m.min,
  max: m.max,
  samples: m.samples,
  below: m.below,
  above: m.above,
  band: m.band,
  values: VALUES[m.name]?.map((x) => x.v),
}));
export const outliers: Outlier[] = registry.calibration.flatMap((m) =>
  (VALUES[m.name] ?? [])
    .filter((x) => x.v > m.band.high || x.v < m.band.low)
    .sort((a, b) => b.v - a.v)
    .map((x) => ({
      metric: m.name,
      id: x.id,
      value: x.v,
      side: x.v > m.band.high ? ("above" as const) : ("below" as const),
      band: `${m.band.low}–${m.band.high}`,
    })),
);

/** Tests ---------------------------------------------------------------------------- */

const testMap = new Map<string, TestFileRow & { names: Set<string>; proves: Set<string> }>();
F.forEach((f) =>
  f.tests.forEach((t) => {
    const path = t.name.split("::")[0].split(" ")[0];
    const row = testMap.get(path) ?? {
      path,
      kind: t.kind as TestKind,
      tests: 0,
      promises: 0,
      records: [],
      names: new Set(),
      proves: new Set(),
    };
    row.names.add(t.name);
    t.proves.forEach((p) => row.proves.add(`${f.id}#${p}`));
    if (!row.records.includes(f.id)) row.records.push(f.id);
    testMap.set(path, row);
  }),
);
export const testFiles: TestFileRow[] = [...testMap.values()]
  .map(({ names, proves, ...r }) => ({ ...r, tests: names.size, promises: proves.size }))
  .sort((a, b) => b.promises - a.promises);
export const testKinds = (["Unit", "Integration", "E2E"] as TestKind[]).map((k) => {
  const files = testFiles.filter((f) => f.kind === k);
  return {
    kind: k,
    tests: files.reduce((a, f) => a + f.tests, 0),
    files: files.length,
    promises: files.reduce((a, f) => a + f.promises, 0),
  };
});
export const testRunners = registry.runners.map((r) => ({
  id: r.id,
  cwd: r.cwd,
  command: r.command,
  report: r.report,
}));

/** Deviations ------------------------------------------------------------------------ */

export const deviations: Deviation[] = promiseItems.slice(40, 44).map((p, i) => ({
  key: p.key,
  recordId: p.recordId,
  scenarioId: p.scenarioId,
  then: [
    "The index is rebuilt on every start, even if nothing changed.",
    "An empty area appears in navigation with count 0.",
    "Search returns deleted records until the next restart.",
    "The hook reports success when the binary is missing.",
  ][i],
  reason: [
    "The index needs a cache.",
    "The taxonomy counts empty capabilities too.",
    "The index is invalidated only on startup.",
    "The cloud counterpart does not check the binary.",
  ][i],
  confirmedBy: i === 2 ? null : PEOPLE[i].name,
  since: ["2026-09-14", "2026-10-02", "2026-10-21", "2026-11-04"][i],
}));

/** Fixed ------------------------------------------------------------------------------ */

const fixMap = new Map<string, FixCommit>();
F.forEach((f) =>
  f.log
    .filter((c) => /^fix/.test(c.subject))
    .forEach((c) => {
      const prev = fixMap.get(c.sha);
      if (prev) {
        if (!prev.records.includes(f.id)) prev.records.push(f.id);
        return;
      }
      const m = /^fix(?:\(([^)]+)\))?:\s*(?:(#\d+)\s*—\s*)?(.*)$/.exec(c.subject);
      fixMap.set(c.sha, {
        sha: c.sha,
        date: c.date,
        scope: m?.[1] ?? null,
        ticket: m?.[2] ?? null,
        subject: (m?.[3] ?? c.subject).replace(/\s*\(#\d+\)$/, ""),
        records: [f.id],
        domain: f.domain,
      });
    }),
);
export const fixes: FixCommit[] = [...fixMap.values()].sort((a, b) => b.date.localeCompare(a.date));

/** Anchors ------------------------------------------------------------------------------ */

export const anchorRows: AnchorRow[] = F.flatMap((f) =>
  f.anchors.map((a) => ({
    path: a.path,
    line: a.line,
    role: (a.role || "none") as AnchorRole,
    recordId: f.id,
  })),
).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

const dirKey = (p: string) => {
  const parts = p.split("/");
  return parts.length > 2 ? parts.slice(0, 2).join("/") : parts.length === 2 ? parts[0] : ".";
};
export const anchorDirs: AnchorDir[] = [...new Set(anchorRows.map((a) => dirKey(a.path)))]
  .map((d) => {
    const rows = anchorRows.filter((a) => dirKey(a.path) === d);
    return {
      path: d,
      anchors: rows.length,
      files: new Set(rows.map((r) => r.path)).size,
      records: new Set(rows.map((r) => r.recordId)).size,
    };
  })
  .sort((a, b) => b.anchors - a.anchors);
export const anchorRoles = (["primary", "related", "config", "data", "none"] as AnchorRole[]).map(
  (r) => ({
    role: r,
    count: anchorRows.filter((a) => a.role === r).length,
  }),
);

/** Files --------------------------------------------------------------------------------- */

const anchoredFiles = [...new Set(anchorRows.map((a) => a.path))];
const hotDirPct = new Map(registry.hotspots.map((h) => [h.dir, h.dirAnchoredPct]));
function buildTree(paths: string[], prefix: string, depth: number): FileNode[] {
  const heads = [...new Set(paths.map((p) => p.split("/")[0]))];
  return heads
    .map((h) => {
      const under = paths.filter((p) => p.split("/")[0] === h);
      const full = prefix ? `${prefix}/${h}` : h;
      const rest = under.map((p) => p.split("/").slice(1).join("/")).filter(Boolean);
      const isDir = rest.length > 0;
      const pctv = hotDirPct.get(full);
      return {
        path: full,
        name: h,
        anchored: isDir ? rest.length : 1,
        share: isDir ? (pctv != null ? pctv / 100 : null) : 1,
        children: isDir && depth < 3 ? buildTree(rest, full, depth + 1) : undefined,
      };
    })
    .sort((a, b) => b.anchored - a.anchored);
}
export const fileTree: FileNode[] = buildTree(anchoredFiles, "", 0);
export const fileScan = {
  files: registry.scan.files,
  anchored: registry.scan.anchored,
  unanchored: registry.scan.unanchored,
  loc: registry.scan.loc,
};
export const fileGaps = registry.hotspots.map((h) => ({
  path: h.path,
  loc: h.loc,
  dir: h.dir,
  dirAnchoredPct: h.dirAnchoredPct,
}));

/** Rules ------------------------------------------------------------------------------------- */

const ids = F.map((f) => f.id);
export const rules: RuleItem[] = [
  {
    id: "policy/registry/every-record-has-a-test",
    title: "Every active promise has a test",
    statement: "An active record names at least one proving test for every scenario.",
    strength: "must",
    appliesTo: ids.filter((i) => i.startsWith("registry/")),
    source: "docs/facets/policies/tests.yaml",
    violations: 3,
  },
  {
    id: "policy/authoring/hooks-have-twins",
    title: "A hook has a cloud counterpart",
    statement: "Every hook in hooks/hooks.json has an entry in .claude/settings.json.",
    strength: "must",
    appliesTo: ids.filter((i) => i.startsWith("authoring/")),
    source: "docs/facets/policies/hooks.yaml",
    violations: 0,
  },
  {
    id: "policy/navigation/testid-not-class",
    title: "Surface tests use data-testid",
    statement: "A surface test uses data-testid or an ARIA role to find elements.",
    strength: "should",
    appliesTo: ids.filter((i) => i.startsWith("navigation/")),
    source: "docs/facets/policies/ui-tests.yaml",
    violations: 7,
  },
  {
    id: "policy/delivery/pinned-checksums",
    title: "Versions require checksums",
    statement: "A pinned version is accompanied by its SHA-256 checksum.",
    strength: "must",
    appliesTo: ids.filter((i) => i.startsWith("delivery/")),
    source: "docs/facets/policies/supply.yaml",
    violations: 0,
  },
  {
    id: "policy/notes/no-net-fetch",
    title: "Plugins cannot use net.fetch",
    statement: "An outbound operation is a tool with its own name and record.",
    strength: "must",
    appliesTo: ids.filter((i) => i.startsWith("notes/")),
    source: "docs/facets/policies/plugins.yaml",
    violations: 0,
  },
];

/** Glossary ------------------------------------------------------------------------------------ */

export const glossaryCategories = ["Basic concept", "Verification", "Surface", "Auslieferung"];

/** Base vocabulary: [term, category, definition, synonym?]. Each has its own definition. */
const BASE_TERMS: [string, string, string, string?][] = [
  [
    "Deviation",
    "Verification",
    "Observed behavior recorded as a scenario deviation because it is unwanted.",
  ],
  [
    "Agent",
    "Basic concept",
    "A language model that reads and writes in the repository through FACET hooks.",
  ],
  [
    "Anchor",
    "Basic concept",
    "An `@facet:` comment that binds source code to its record.",
    "Marke",
  ],
  [
    "Ankerrolle",
    "Basic concept",
    "The `@facet-role:` attribute on an anchor: primary, related, config or data.",
  ],
  [
    "Assumption",
    "Basic concept",
    "An assumption record describes something the product relies on without checking it here.",
  ],
  [
    "Atlas",
    "Surface",
    "The browser reader shows the registry as overview, product, records and contents.",
  ],
  [
    "Area",
    "Basic concept",
    "The top taxonomy level: a product domain with its own team.",
    "Domain",
  ],
  [
    "Evidence",
    "Verification",
    "A test whose `proves:` names a scenario and which ran in the latest measurement.",
  ],
  [
    "Blueprint",
    "Auslieferung",
    "The RRE output: requirements, architecture and history generated from records.",
  ],
  [
    "Commit-Gate",
    "Verification",
    "The pre-commit hook runs lint and rejects the commit on failure.",
  ],
  [
    "ContinuousCheck",
    "Verification",
    "An ongoing check in the `observation:` block that measures an operational success signal.",
  ],
  [
    "Decision",
    "Basic concept",
    "An ADR under `docs/adr/` that records an architecture question with context and consequences.",
    "ADR",
  ],
  [
    "Success signal",
    "Basic concept",
    "The knowledge slot explaining how someone can recognize a successful feature.",
  ],
  ["Approval", "Surface", "Human approval for a plugin to call a particular tool."],
  [
    "Graveyard",
    "Basic concept",
    "Records for removed features, with their reasons and final state.",
  ],
  [
    "Capability",
    "Basic concept",
    "The second taxonomy level: related features within an area.",
    "Capability",
  ],
  [
    "Calibration",
    "Verification",
    "Bands of typical values, such as promises per record, make outliers visible.",
  ],
  [
    "Reader role",
    "Surface",
    "The perspective that weights an Atlas page, such as leadership or test and review.",
  ],
  [
    "Lint",
    "Verification",
    "The repository checks: schema, orphan anchors, active records without anchors.",
  ],
  [
    "Feature",
    "Basic concept",
    "A named product capability described by exactly one record.",
    "Feature",
  ],
  [
    "Plugin",
    "Auslieferung",
    "A module that extends Atlas and accesses external tools through `bus.call`.",
  ],
  [
    "Record",
    "Basic concept",
    "The machine-readable YAML description of a named product capability.",
    "entry",
  ],
  ["Registry", "Basic concept", "All repository records read by `facet`."],
  [
    "Richtlinie",
    "Verification",
    "A policy record defines a rule that applies to multiple features.",
    "Policy",
  ],
  ["Sidecar", "Auslieferung", "A plugin binary that runs a named tool outside the browser."],
  ["Scenario", "Basic concept", "A Given/When/Then promise that a test can prove."],
  ["Taxonomy", "Basic concept", "The areas and capabilities in `docs/facets/taxonomy.yaml`."],
  ["Drift", "Verification", "Code that changed without its record following.", "Drift"],
  [
    "Knowledge",
    "Basic concept",
    "Five slots covering what a person needs to know about a feature.",
  ],
  [
    "Promise",
    "Basic concept",
    "A feature promise, expressed as a scenario and supported by a test.",
    "Scenario",
  ],
];

/** Compound forms for the long list; each phrase reads as its own definition. */
const COMPOUNDS: [string, string, (b: string) => string][] = [
  [
    "check",
    "Verification",
    (b) => `The lint step that checks every “${b}” entry against the code.`,
  ],
  ["list", "Surface", (b) => `The sortable overview of all “${b}” entries in Atlas.`],
  ["counter", "Surface", (b) => `The page header count of measured “${b}” entries.`],
  ["schema", "Verification", (b) => `The JSON schema used by \`ajv\` to validate “${b}” fields.`],
  ["history", "Basic concept", (b) => `Commits that changed “${b}”, newest first.`],
  [
    "note",
    "Surface",
    (b) => `The end-of-turn message when “${b}” does not match the working tree.`,
  ],
  ["export", "Auslieferung", (b) => `JSON output of “${b}” for tools outside Atlas.`],
  [
    "template",
    "Auslieferung",
    (b) => `The scaffold created by \`facet init\` for “${b}” in a new project.`,
  ],
  ["rule", "Verification", (b) => `A condition every “${b}” entry must satisfy to pass lint.`],
  ["search", "Surface", (b) => `Full-text search over “${b}”, including synonyms and paths.`],
];

/** A glossary of `n` distinct terms with plausible, varied definitions and counts. */
export function makeTerms(n: number, seed = 23): GlossaryTerm[] {
  const r = rng(seed);
  const out: GlossaryTerm[] = [];
  for (let i = 0; i < n; i++) {
    const [b, cat, def, alias] = BASE_TERMS[i % BASE_TERMS.length];
    const round = Math.floor(i / BASE_TERMS.length);
    const compound = round > 0 ? COMPOUNDS[(round - 1 + i) % COMPOUNDS.length] : null;
    out.push({
      term: compound ? `${b}-${compound[0][0].toUpperCase()}${compound[0].slice(1)}` : b,
      definition: compound ? compound[2](b) : def,
      category: compound ? compound[1] : cat,
      aliases: !compound && alias ? [alias] : [],
      records: compound ? Math.floor(r() * 18) : 3 + Math.floor(r() * 60),
      status: r() < 0.9 ? "settled" : "proposed",
    });
  }
  return out.sort((a, b) => a.term.localeCompare(b.term, "de"));
}

export const glossary300: GlossaryTerm[] = makeTerms(300);
export const glossary40: GlossaryTerm[] = makeTerms(40);
export const lettersOf = (terms: GlossaryTerm[]) =>
  [...new Set(terms.map((t) => t.term[0].toUpperCase()))].map((l) => ({
    letter: l,
    count: terms.filter((t) => t.term[0].toUpperCase() === l).length,
  }));

export const termDetail: GlossaryTermDetail = {
  ...(glossary40.find((t) => t.term === "Drift") ?? glossary40[0]),
  term: "Drift",
  definition: "Code that changed without its record following.",
  status: "settled",
  aliases: ["Drift"],
  translation: "drift",
  recordIds: [...new Set(registry.drift.map((d) => d.id))].slice(0, 6),
  records: new Set(registry.drift.map((d) => d.id)).size,
  occurrences: registry.drift.slice(0, 3).map((d, i) => ({
    path: d.path,
    line: 12 + i * 31,
    excerpt: [
      "reports drift against the merge base",
      "Drift occurs when the anchor moves",
      "counts each file with drift once",
    ][i],
  })),
  related: ["Anchor", "Record", "Feature"],
  history: [
    { date: "2026-10-12", who: "Mira Albers", change: "Added synonym “Drift”" },
    { date: "2026-08-03", who: "Jonas Kettler", change: "settled" },
    { date: "2026-07-26", who: "Jonas Kettler", change: "proposed" },
  ],
};

/** Plugins ---------------------------------------------------------------------------------------- */

export const plugins: PluginRow[] = [
  {
    id: "adr",
    name: "Decisions",
    version: "1.4.2",
    source: "bundled",
    enabled: true,
    verification: "ok",
    open: 0,
    desc: "Read ADRs, propose statuses and create decisions.",
  },
  {
    id: "bpmn",
    name: "Processes",
    version: "0.8.1",
    source: "installed",
    enabled: true,
    verification: "ok",
    open: 2,
    desc: "BPMN diagrams with outline, playback and findings.",
  },
  {
    id: "jira-sync",
    name: "Jira-Comparison",
    version: "0.3.0",
    source: "development",
    enabled: false,
    verification: "missing",
    open: 3,
    desc: "Tickets beside records through a dedicated sidecar.",
  },
];

export const grantItems: GrantItem[] = [
  {
    key: "g1",
    group: "Tools",
    name: "repo.state",
    via: "Host",
    why: "branch and working tree show.",
    state: "granted",
    risk: "reads",
  },
  {
    key: "g2",
    group: "Tools",
    name: "repo.branch",
    via: "Host",
    why: "Create a branch for a proposal.",
    state: "granted",
    risk: "writes",
  },
  {
    key: "g3",
    group: "Tools",
    name: "repo.commit",
    via: "Host",
    why: "Commit changed .bpmn files.",
    state: "open",
    risk: "writes",
  },
  {
    key: "g4",
    group: "Tools",
    name: "bpmn.parse",
    via: "Sidecar bpmn (sha256 3f9c…)",
    why: "Read diagrams and report findings.",
    state: "granted",
    risk: "reads",
  },
  {
    key: "g5",
    group: "Environment",
    name: "BPMN_MAX_SHAPES",
    via: "Sidecar bpmn",
    why: "Upper limit for large diagrams.",
    state: "granted",
  },
  {
    key: "g6",
    group: "Agent tools",
    name: "bpmn.elements",
    via: "Sidecar bpmn",
    why: "Ask Atlas may look up process elements.",
    state: "open",
    risk: "reads",
  },
];

/** Hub ------------------------------------------------------------------------------------------------ */

const spark = (seed: number, n = 12) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => Math.round(r() * 10));
};

/** The hub tiles in the language of `t`: labels, descriptions, units, findings and view names. */
export const contentKindsFor = (t: FacetText["t"]): ContentKind[] => [
  {
    key: "promises",
    label: t("ui.screens-contents.data-spec-support-promises"),
    group: "Registry",
    icon: "shield",
    desc: t("ui.screens-contents.data-spec-support-given-when-then-every-promise-its"),
    count: promiseTotals.total,
    unit: t("ui.screens-contents.data-spec-support-promises-unit"),
    finding: t("ui.screens-contents.data-spec-support-count-open", { count: promiseTotals.open }),
    tone: "warn",
    share: promiseTotals.proven / promiseTotals.total,
    views: [
      { id: "list", label: t("ui.screens-contents.data-spec-support-list") },
      { id: "mosaic", label: t("ui.screens-contents.data-spec-support-mosaic") },
      { id: "openFirst", label: t("ui.screens-contents.data-spec-support-open-first") },
    ],
  },
  {
    key: "knowledge",
    label: t("ui.screens-contents.data-spec-support-knowledge"),
    group: "Registry",
    icon: "bulb",
    desc: t("ui.screens-contents.data-spec-support-five-knowledge-slots-per-record-where"),
    count: knowledgeTotals.open,
    unit: t("ui.screens-contents.data-spec-support-empty-slots"),
    finding: t("ui.screens-contents.data-spec-support-percent-filled", {
      percent: Math.round(
        (knowledgeTotals.filled / (knowledgeTotals.filled + knowledgeTotals.open)) * 100,
      ),
    }),
    tone: "warn",
    share: knowledgeTotals.filled / (knowledgeTotals.filled + knowledgeTotals.open),
    views: [
      { id: "matrix", label: t("ui.screens-contents.data-spec-support-slot-matrix") },
      { id: "openQuestions", label: t("ui.screens-contents.data-spec-support-open-questions") },
    ],
  },
  {
    key: "operations",
    label: t("ui.screens-contents.data-spec-support-operations"),
    group: "Registry",
    icon: "pulse",
    desc: t("ui.screens-contents.data-spec-support-slos-alarms-continuous-checks-observation"),
    count: F.filter((f) => f.observed).length,
    unit: t("ui.screens-contents.data-spec-support-records"),
    finding: t("ui.screens-contents.data-spec-support-rare"),
    views: [{ id: "list", label: t("ui.screens-contents.data-spec-support-list") }],
  },
  {
    key: "provenance",
    label: t("ui.screens-contents.data-spec-support-origin"),
    group: "Registry",
    icon: "team",
    desc: t("ui.screens-contents.data-spec-support-who-owns-records-when-they-came"),
    count: provenanceTeams.length,
    unit: t("ui.screens-contents.data-spec-support-teams"),
    finding: provenanceUnowned
      ? t("ui.screens-contents.data-spec-support-count-without-team", {
          count: provenanceUnowned,
        })
      : undefined,
    tone: provenanceUnowned ? "warn" : undefined,
    spark: provenanceMonths.map((m) => m.count),
    views: [
      { id: "team", label: t("ui.screens-contents.data-spec-support-team") },
      { id: "calendar", label: t("ui.screens-contents.data-spec-support-calendar") },
    ],
  },
  {
    key: "taxonomy",
    label: t("ui.screens-contents.data-spec-support-taxonomy"),
    group: "Registry",
    icon: "tree",
    desc: t("ui.screens-contents.data-spec-support-domains-capabilities-ids-drawn"),
    count: taxonomy.length,
    unit: t("ui.screens-contents.data-spec-support-areas-caps-capabilities", {
      caps: taxonomy.reduce((a, d) => a + d.capabilities.length, 0),
    }),
    views: [
      { id: "tree", label: t("ui.screens-contents.data-spec-support-tree") },
      { id: "sun", label: t("ui.screens-contents.data-spec-support-sunburst") },
    ],
  },
  {
    key: "calibration",
    label: t("ui.screens-contents.data-spec-support-calibration"),
    group: "Registry",
    icon: "barChart",
    desc: t("ui.screens-contents.data-spec-support-whether-registry-follows-its-calibration"),
    count: calibration.length,
    unit: t("ui.screens-contents.data-spec-support-measures"),
    finding: t("ui.screens-contents.data-spec-support-count-outliers", { count: outliers.length }),
    tone: "warn",
    views: [
      { id: "bands", label: t("ui.screens-contents.data-spec-support-bands") },
      { id: "outliers", label: t("ui.screens-contents.data-spec-support-outliers") },
    ],
  },
  {
    key: "tests",
    label: t("ui.screens-contents.data-spec-support-tests"),
    group: "Evidence",
    icon: "flask",
    desc: t("ui.screens-contents.data-spec-support-test-files-promises-they-name"),
    count: testKinds.reduce((a, k) => a + k.tests, 0),
    unit: t("ui.screens-contents.data-spec-support-tests-unit"),
    finding: t("ui.screens-contents.data-spec-support-count-files", { count: testFiles.length }),
    spark: spark(3),
    views: [
      { id: "pyramid", label: t("ui.screens-contents.data-spec-support-pyramid") },
      { id: "tree", label: t("ui.screens-contents.data-spec-support-tree") },
      { id: "table", label: t("ui.screens-contents.data-spec-support-table") },
    ],
  },
  {
    key: "deviations",
    label: t("ui.screens-contents.data-spec-support-deviations"),
    group: "Evidence",
    icon: "error",
    desc: t("ui.screens-contents.data-spec-support-behaviour-code-demonstrably-shows-nobody"),
    count: 0,
    unit: t("ui.screens-contents.data-spec-support-logged"),
    finding: t("ui.screens-contents.data-spec-support-none"),
    tone: "ok",
    views: [{ id: "list", label: t("ui.screens-contents.data-spec-support-list") }],
  },
  {
    key: "drift",
    label: t("ui.screens-contents.data-spec-support-drift"),
    group: "Evidence",
    icon: "offsetBlocks",
    desc: t("ui.screens-contents.data-spec-support-code-changed-without-its-record-following"),
    count: registry.drift.length,
    unit: t("ui.screens-contents.data-spec-support-files"),
    finding: t("ui.screens-contents.data-spec-support-count-records", {
      count: new Set(registry.drift.map((d) => d.id)).size,
    }),
    tone: "warn",
    views: [
      { id: "byRecord", label: t("ui.screens-contents.data-spec-support-record") },
      { id: "timeline", label: t("ui.screens-contents.data-spec-support-timeline") },
    ],
  },
  {
    key: "fixed",
    label: t("ui.screens-contents.data-spec-support-fixed"),
    group: "Evidence",
    icon: "checkUnderline",
    desc: t("ui.screens-contents.data-spec-support-bug-fix-commits-attributed-records-through"),
    count: fixes.length,
    unit: t("ui.screens-contents.data-spec-support-fixes"),
    spark: spark(9),
    views: [
      { id: "timeline", label: t("ui.screens-contents.data-spec-support-timeline-label") },
      { id: "area", label: t("ui.screens-contents.data-spec-support-area") },
    ],
  },
  {
    key: "anchor",
    label: t("ui.screens-contents.data-spec-support-anchors"),
    group: "Code",
    icon: "anchor",
    desc: t("ui.screens-contents.data-spec-support-every-facet-tag-source-line-points"),
    count: anchorRows.length,
    unit: t("ui.screens-contents.data-spec-support-anchors-unit"),
    finding: t("ui.screens-contents.data-spec-support-count-directories", {
      count: anchorDirs.length,
    }),
    views: [
      { id: "treemap", label: t("ui.screens-contents.data-spec-support-treemap") },
      { id: "table", label: t("ui.screens-contents.data-spec-support-table") },
    ],
  },
  {
    key: "files",
    label: t("ui.screens-contents.data-spec-support-files-label"),
    group: "Code",
    icon: "file",
    desc: t("ui.screens-contents.data-spec-support-what-scan-read-anchor-without"),
    count: fileScan.files,
    unit: t("ui.screens-contents.data-spec-support-files"),
    finding: t("ui.screens-contents.data-spec-support-percent-anchored", {
      percent: Math.round((fileScan.anchored / fileScan.files) * 100),
    }),
    tone: "warn",
    share: fileScan.anchored / fileScan.files,
    views: [
      { id: "tree", label: t("ui.screens-contents.data-spec-support-tree") },
      { id: "gaps", label: t("ui.screens-contents.data-spec-support-gaps") },
    ],
  },
  {
    key: "rules",
    label: t("ui.screens-contents.data-spec-support-rules"),
    group: "Context",
    icon: "checklist",
    desc: t("ui.screens-contents.data-spec-support-policies-apply-records"),
    count: 0,
    unit: t("ui.screens-contents.data-spec-support-policies"),
    finding: t("ui.screens-contents.data-spec-support-none"),
    views: [{ id: "list", label: t("ui.screens-contents.data-spec-support-list") }],
  },
  {
    key: "glossary",
    label: t("ui.screens-contents.data-spec-support-glossary"),
    group: "Context",
    icon: "book",
    desc: t("ui.screens-contents.data-spec-support-terms-explained-once-where-each-appears"),
    count: null,
    unit: t("ui.screens-contents.data-spec-support-terms"),
    finding: t("ui.screens-contents.data-spec-support-not-measured"),
    views: [{ id: "az", label: t("ui.screens-contents.data-spec-support-z") }],
  },
];

export const hubHeadlineFor = (t: FacetText["t"]) => ({
  records: F.length,
  open: promiseTotals.open + knowledgeTotals.open + registry.drift.length,
  sentence: t("ui.screens-contents.data-spec-support-kinds-kinds-content-across-records-records", {
    kinds: contentKindsFor(t).length,
    records: F.length,
  }),
});

/** The hub in German, for specs and fixtures that assert German texts. */
const german = createText("en").t;
export const contentKinds = contentKindsFor(german);
export const hubHeadline = hubHeadlineFor(german);
