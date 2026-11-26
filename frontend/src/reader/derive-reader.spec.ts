import { germanLabel } from "@/i18n/testing-labels.spec-support";
import type { AtlasModel } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import { derive } from "@/derive";
import * as D from "./derive-reader";
import { atlasT } from "./testing";

const en = atlasT("en");
const de = atlasT("de");
const model = taskflowModel();
const derived = derive(model);
const features = D.featureViews(model, derived);
const domains = D.domainViews(model);

describe("feature views", () => {
  it("derives storey counts from the defect register and declared deviations", () => {
    const record = model.features.find((feature) => feature.scenarios.length > 0)!;
    const [scenario] = record.scenarios;
    const rec = {
      ...record,
      scenarios: [
        {
          ...scenario,
          deviation: { reason: "Unexpected result", confirmedBy: "", trackedAs: "" },
        },
      ],
    };
    const noRegister = { ...rec, defects: { ...rec.defects, present: false } };
    expect(D.featureView(model, derived, noRegister)).toMatchObject({
      fixCount: null,
      deviationCount: 1,
    });
    const empty = { ...rec.defects, present: true, total: 0, fixes: [] };
    expect(D.featureView(model, derived, { ...rec, defects: empty })).toMatchObject({
      fixCount: 0,
      fixCommits: [],
      deviationCount: 1,
    });
    const fixes = [
      {
        date: "2026-08-01",
        commit: "abc1234",
        files: [],
        subject: "",
        issue: "",
        recordedBy: "",
      },
    ];
    expect(
      D.featureView(model, derived, {
        ...rec,
        defects: { ...empty, total: 1, fixes },
      }),
    ).toMatchObject({
      fixCount: 1,
      fixCommits: [{ commit: "abc1234", date: "2026-08-01" }],
      deviationCount: 1,
    });
  });

  it("lists every feature and assumption with its measured counts", () => {
    expect(features).toHaveLength(model.features.length + model.assumptions.length);
    const qa = features.find((f) => f.id === "tasks/create/quick-add")!;
    expect(qa).toMatchObject({
      slug: "quick-add",
      domain: "tasks",
      capability: "create",
      type: "feature",
      lifecycle: "active",
      owner: "tasks",
      createdAt: "2026-05-12",
      scenarios: 3,
      proven: 3,
      anchors: 2,
      tests: 4,
      drift: 0,
    });
    expect(qa.mosaic).toEqual([true, true, true]);
    expect(features.find((f) => f.id === "sync/conflict/last-write-wins")!.drift).toBe(1);
    expect(features.filter((f) => f.type === "assumption").map((f) => f.id)).toEqual(
      model.assumptions.map((a) => a.id),
    );
  });

  it("maps lifecycles it does not know onto the three the pages draw", () => {
    expect(D.lifecycleOf({ lifecycle: "retired", activeAnywhere: false })).toBe("deprecated");
    expect(D.lifecycleOf({ lifecycle: "—", activeAnywhere: true })).toBe("active");
    expect(D.lifecycleOf({ lifecycle: "—", activeAnywhere: false })).toBe("planned");
    expect(D.lifecycleOf({ lifecycle: "planned", activeAnywhere: false })).toBe("planned");
  });

  it("knows the knowledge slots only for an active record with a knowledge block", () => {
    const planned = features.find((f) => f.id === "search/fulltext/task-search")!;
    expect(planned.knowledgeSlots).toBeUndefined();
    expect(planned.knowledgeOpen).toBe(0);
  });
});

describe("domains", () => {
  it("builds domains from the records when no taxonomy is declared", () => {
    expect(model.taxonomy).toBeNull();
    expect(domains.map((d) => d.id)).toEqual([
      ...new Set(D.listedRecords(model).map((r) => r.domain)),
    ]);
    const tasks = domains.find((d) => d.id === "tasks")!;
    expect(tasks).toMatchObject({ title: "tasks", purpose: "", cls: "", team: "" });
    expect(tasks.capabilities.map((c) => c.id)).toEqual(["create", "recurring", "archive"]);
  });

  it("takes titles, purpose, class and team from a declared taxonomy", () => {
    const withTax = {
      ...model,
      taxonomy: {
        schemaVersion: "1",
        domains: [
          {
            name: "tasks",
            title: "Tasks",
            purpose: "What to do",
            classification: "core",
            ownerTeam: "tasks",
            capabilities: [
              {
                name: "create",
                title: "Create",
                purpose: "",
                classification: null,
                inherited: true,
              },
            ],
          },
        ],
      },
    } as AtlasModel;
    const ds = D.domainViews(withTax);
    expect(ds[0]).toMatchObject({ id: "tasks", title: "Tasks", cls: "core", team: "tasks" });
    expect(ds[0].capabilities.map((c) => c.id)).toEqual(["create", "recurring", "archive"]);
    expect(ds[0].capabilities[0].title).toBe("Create");
  });
});

describe("Overview model", () => {
  const overview = D.overviewModel(
    model,
    derived,
    { project: { branch: "main", commit: "abcdef1234" } },
    features,
  );

  it("totals what the records hold", () => {
    expect(overview.totals.records).toBe(features.length);
    expect(overview.totals.assumptions).toBe(2);
    expect(overview.totals.scenarios).toBe(features.reduce((a, f) => a + f.scenarios, 0));
    expect(overview.totals.anchoredFiles).toBe(13);
    // The scan sent both file lists but no total: their sum is the measured total.
    expect(overview.totals.files).toBe(22);
    expect(overview.project).toMatchObject({ branch: "main", commit: "abcdef12" });
  });

  it("writes no commit history and no tool calls it never measured", () => {
    // No history reaches the reader: not read (null), never an empty read history.
    expect(overview.recent).toBeNull();
    // Tools nobody listed are not an empty list: null, with the host's reason where it gave one.
    expect(overview.tools).toBeNull();
    expect(overview.toolsReason).toBeNull();
    expect(
      D.overviewModel(model, derived, { tools: { available: true, tools: ["feature_get"] } }).tools,
    ).toEqual([{ name: "feature_get", purpose: "", calls: null }]);
    const refused = D.overviewModel(model, derived, {
      tools: { available: false, reason: "mcp exited", tools: [] },
    });
    expect(refused.tools).toBeNull();
    expect(refused.toolsReason).toBe("mcp exited");
    expect(D.overviewModel(model, derived).project.branch).toBe("—");
  });

  it("ignores history entries without a measured file list", () => {
    expect(
      D.commitViews(model, [
        { date: "2026-11-21", sha: "abcdef1234", subject: "Merge branch", files: null },
      ]),
    ).toEqual([]);
  });

  it("attributes one commit to every record whose path it changed", () => {
    const [first, second] = D.listedRecords(model);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const history = D.commitViews(model, [
      {
        date: "2026-11-20",
        sha: "1234567890abcdef",
        subject: "change two records",
        files: [first.path, second.path],
      },
    ]);
    expect(history?.map((entry) => entry.record)).toEqual([first.id, second.id]);
  });

  it("does not attribute a nested file that only shares a record path's name", () => {
    const [first] = D.listedRecords(model);
    expect(first).toBeDefined();
    const exact = D.commitViews(model, [
      { date: "2026-11-20", sha: "1111111111111111", subject: "exact", files: [first.path] },
    ]);
    expect(exact?.map((entry) => entry.record)).toEqual([first.id]);
    const nested = D.commitViews(model, [
      {
        date: "2026-11-20",
        sha: "2222222222222222",
        subject: "nested",
        files: [`vendor/${first.path}`],
      },
    ]);
    expect(nested).toEqual([]);
  });

  it("carries the drift, ADR targets, tests and owners", () => {
    expect(overview.drift).toEqual([
      {
        path: "crates/sync/src/conflict.rs",
        record: "sync/conflict/last-write-wins",
        changedAt: "2026-07-26",
      },
    ]);
    expect(overview.adrs.map((a) => a.file)).toContain("ADR-004");
    expect(overview.adrs.find((a) => a.file === "ADR-007")).toMatchObject({
      status: "—",
      refs: ["tasks/create/quick-add"],
    });
    expect(overview.tests).toEqual({ unit: 10, integration: 6, e2e: 3 });
    expect(overview.owners[0].records).toBeGreaterThanOrEqual(overview.owners[1].records);
    expect(overview.calibration).toEqual([]);
    expect(overview.trend.at(-1)!.scenarios).toBe(
      features.filter((f) => f.createdAt).reduce((a, f) => a + f.scenarios, 0),
    );
  });

  it("passes engine calibration names through for facet-ui to word and sorts drift newest first", () => {
    const withCal = {
      ...model,
      calibration: {
        records: 1,
        scenarios: 1,
        anchoredFiles: 1,
        domains: 1,
        capabilities: 1,
        hasTaxonomy: false,
        readings: [],
        metrics: [
          {
            name: "scenarios per record",
            median: 3,
            min: 1,
            max: 9,
            samples: 12,
            below: 1,
            above: 2,
            band: { low: 2, high: 6 },
          },
        ],
      },
    } as AtlasModel;
    expect(D.calibrationViews(withCal)[0]).toMatchObject({
      label: "scenarios per record",
      low: 2,
      high: 6,
    });
  });

  it("returns null for test mix without records", () => {
    expect(D.testMix([])).toBeNull();
    expect(D.testBand("End-to-End")).toBe("e2e");
    expect(D.testBand("contract")).toBe("integration");
    expect(D.testBand("property")).toBeNull();
  });
});

describe("overviews", () => {
  it("derives a domain overview with its cross-domain links", () => {
    const d = D.domainData(model, features, domains, "sync")!;
    expect(d.features.every((f) => f.domain === "sync")).toBe(true);
    expect(d.drift).toHaveLength(1);
    expect(d.adrs.map((a) => a.file).sort()).toEqual(["ADR-011", "ADR-012"]);
    const links = [...d.links.incoming, ...d.links.outgoing];
    expect(links.every((l) => l.domain !== "sync" && l.count > 0)).toBe(true);
    expect(D.domainData(model, features, domains, "nowhere")).toBeNull();
  });

  it("derives a capability overview with anchor files and tests", () => {
    const c = D.capabilityData(model, features, domains, "tasks", "create")!;
    expect(c.features.map((f) => f.id)).toEqual(["tasks/create/quick-add"]);
    expect(c.files.reduce((a, f) => a + f.anchors, 0)).toBe(2);
    expect(c.tests).toEqual({
      unit: expect.any(Number),
      integration: expect.any(Number),
      e2e: expect.any(Number),
    });
    expect(D.capabilityData(model, features, domains, "tasks", "nope")).toBeNull();
  });

  it("finds the nearest records for a missing id", () => {
    expect(D.distance("kitten", "sitting")).toBe(3);
    expect(D.nearestRecords(model, "quick-ad")[0].id).toBe("tasks/create/quick-add");
    expect(D.creationDates(features)).toEqual(
      [...new Set(features.map((f) => f.createdAt).filter(Boolean))].sort(),
    );
  });
});

describe("Records collection", () => {
  const rows = D.recordRows(features);

  it("filters, searches, sorts and pages", () => {
    const p = D.recordsProps(rows, { ...D.RECORDS_DEFAULT, pageSize: 5 }, en);
    expect(p.state).toBe("ready");
    expect(p.rows).toHaveLength(5);
    expect(p.matched).toBe(rows.length);
    expect(p.rows.map((r) => r.id)).toEqual(
      [...rows]
        .map((r) => r.id)
        .sort()
        .slice(0, 5),
    );
    const page3 = D.recordsProps(rows, { ...D.RECORDS_DEFAULT, pageSize: 5, page: 99 }, en);
    expect(page3.page).toBe(Math.ceil(rows.length / 5));

    const planned = D.recordsProps(
      rows,
      { ...D.RECORDS_DEFAULT, filters: { lifecycle: "planned" } },
      en,
    );
    expect(planned.rows.map((r) => r.id)).toEqual(["search/fulltext/task-search"]);
    expect(planned.filters).toEqual([{ key: "lifecycle", label: "Lifecycle: planned" }]);

    const none = D.recordsProps(rows, { ...D.RECORDS_DEFAULT, query: "quick-adx" }, en);
    expect(none.state).toBe("filtered-empty");
    expect(none.suggestions![0].id).toBe("tasks/create/quick-add");

    const sorted = D.recordsProps(
      rows,
      { ...D.RECORDS_DEFAULT, sort: { key: "scenarios", dir: "desc" } },
      en,
    );
    expect(sorted.rows[0].scenarios).toBe(Math.max(...rows.map((r) => r.scenarios)));
    expect(D.recordsProps([], D.RECORDS_DEFAULT, en).state).toBe("empty");
  });

  it("never claims a change date the model does not carry", () => {
    expect(rows.every((r) => r.changedAt === null)).toBe(true);
  });

  it("toggles facets and removes filters", () => {
    let f = D.toggleFacet({}, "domain:sync");
    expect(f.domain).toBe("sync");
    f = D.toggleFacet(f, "lc:planned");
    f = D.toggleFacet(f, "drift");
    f = D.toggleFacet(f, "unowned");
    f = D.toggleFacet(f, "kind:assumption");
    expect(f).toEqual({
      domain: "sync",
      lifecycle: "planned",
      drift: true,
      unowned: true,
      kind: "assumption",
    });
    expect(D.filterChips(f, en).map((c) => c.key)).toEqual([
      "domain",
      "lifecycle",
      "drift",
      "unowned",
      "kind",
    ]);
    expect(D.toggleFacet(f, "domain:sync").domain).toBeUndefined();
    expect(D.toggleFacet(f, "bogus")).toBe(f);
    expect(D.removeFilter(f, "drift").drift).toBeUndefined();
    const facets = D.facetsFor(rows, { drift: true }, en);
    expect(facets.find((x) => x.key === "drift")).toMatchObject({ count: 1, active: true });
  });

  it("reads Overview targets into filters", () => {
    expect(D.filtersFromSearch("lifecycle=planned&owner=none&drift=1&domain=sync")).toEqual({
      lifecycle: "planned",
      unowned: true,
      drift: true,
      domain: "sync",
    });
    expect(D.filtersFromSearch("lifecycle=bogus")).toEqual({});
  });

  it("groups rows for the field and matrix views", () => {
    const g = D.fieldGroups(rows, new Set(["tasks/create/quick-add"]));
    const tasksCreate = g.find((x) => x.domain === "tasks" && x.capability === "create")!;
    expect(tasksCreate.tiles[0].match).toBe(true);
    const m = D.matrixRows(rows).find((x) => x.domain === "search")!;
    expect(m).toMatchObject({ planned: 1, active: 0 });
    const dist = D.distributionsFor(rows, { domain: "sync" }, en);
    expect(dist[0].parts.find((p) => p.key === "sync")!.active).toBe(true);
    expect(D.summaryOf(rows).drift).toBe(1);
    const assumed = rows.filter((r) => r.kind === "assumption").length;
    expect(D.summaryOf(rows).assumptions).toBe(assumed);
  });

  it("reports Knowledge only when every active record was measured", () => {
    const active = rows.find((row) => row.lifecycle === "active")!;
    const planned = rows.find((row) => row.lifecycle === "planned")!;
    expect(active).toBeDefined();
    expect(planned).toBeDefined();
    expect(
      D.summaryOf([
        { ...active, knowledgeOpen: 2 },
        { ...planned, knowledgeOpen: 4 },
      ]).knowledgeOpen,
    ).toBe(2);
    expect(
      D.summaryOf([
        { ...active, knowledgeOpen: null },
        { ...planned, knowledgeOpen: 4 },
      ]).knowledgeOpen,
    ).toBeNull();
  });
});

describe("record", () => {
  it("derives the record from the record", () => {
    const d = D.recordOf(model, "tasks/create/quick-add")!;
    const rec = model.byId["tasks/create/quick-add"];
    expect(d).toMatchObject({
      slug: "quick-add",
      scenarioCount: rec.total,
      provenCount: rec.proven,
      testCount: 4,
      anchorCount: 2,
      logCount: null,
      log: null,
      yaml: rec.raw,
    });
    expect(d.scenarios[0].steps[0].kw).toBe("given");
    // Only the slots the record's block declares, in slot order.
    expect(d.knowledge.map((k) => k.key)).toEqual(
      D.RECORD_SLOTS.filter((key) => rec.knowledge.some((k) => k.key === key)),
    );
    expect(d.knowledge.length).toBeGreaterThan(0);
    expect(d.knowledgeDeclared).toBe(true);
    expect(Object.values(d.testKinds).reduce((a, b) => a + b, 0)).toBe(4);
    expect(JSON.parse(d.json).id).toBe("tasks/create/quick-add");
    expect(D.recordOf(model, "nope")).toBeNull();
  });

  it("says nothing about observation when the record has no block", () => {
    const withObs = D.recordOf(model, model.slos[0].rec.id)!;
    expect(withObs.observed).toBe(true);
  });

  it("names the siblings of each path segment", () => {
    const s = D.siblingsOf(model, domains, features, "tasks/create/quick-add")!;
    expect(s.domains.map((x) => x.id)).toEqual(domains.map((d) => d.id));
    expect(s.capabilities.map((x) => x.id)).toEqual(["create", "recurring", "archive"]);
    expect(s.records.map((x) => x.id)).toEqual(["quick-add"]);
    const own = features.find((f) => f.id === "tasks/create/quick-add")!;
    expect(s.records[0]).toEqual({
      id: "quick-add",
      records: 1,
      scenarios: own.scenarios,
      proven: own.proven,
    });
    const tasks = features.filter((f) => f.domain === "tasks");
    expect(s.domains.find((x) => x.id === "tasks")!.records).toBe(tasks.length);
    expect(D.siblingsOf(model, domains, features, "nope")).toBeUndefined();
  });

  it("splits a declared test into file and name", () => {
    expect(D.splitTest("a/b.go::TestX")).toEqual({ file: "a/b.go", name: "TestX" });
    expect(D.splitTest("a/b.go")).toEqual({ file: "a/b.go", name: null });
    expect(D.testKindLabel("unit")).toBe("Unit");
    expect(D.testKindLabel("fuzz")).toBe("fuzz");
  });
});

describe("derived words follow the language", () => {
  const rows = D.recordRows(features);

  it("words filter chips, facets and bands in the language asked for", () => {
    const f: D.RecordFilters = {
      lifecycle: "planned",
      drift: true,
      unowned: true,
      kind: "assumption",
    };
    expect(D.filterChips(f, en).map((c) => c.label)).toEqual([
      "Lifecycle: planned",
      "with drift",
      "without a team",
      "Assumptions",
    ]);
    expect(D.filterChips(f, de).map((c) => c.label)).toEqual([
      germanLabel("Lifecycle: {{value}}").replace("{{value}}", germanLabel("planned")),
      germanLabel("with drift"),
      germanLabel("without a team"),
      germanLabel("Assumptions"),
    ]);
    expect(D.facetsFor(rows, {}, de).map((x) => x.label)).toContain(germanLabel("with drift"));
    expect(D.distributionsFor(rows, {}, en).map((d) => d.label)).toEqual([
      "By area",
      "By lifecycle",
    ]);
    expect(D.distributionsFor(rows, {}, de)[0].label).toBe(D.byAreaLabel(de));
  });
});
