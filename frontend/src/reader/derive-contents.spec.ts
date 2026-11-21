import { germanLabel } from "@/i18n/testing-labels.spec-support";
import type { AtlasModel } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import { derive } from "@/derive";
import * as C from "./derive-contents";
import { domainViews } from "./derive-reader";
import { atlasT, uiT } from "./testing";

const model = taskflowModel();
const derived = derive(model);

describe("promises", () => {
  const items = C.promiseItems(derived);

  it("lists every feature scenario with its state and tests", () => {
    expect(items).toHaveLength(derived.M.reduce((a, f) => a + f.scen.length, 0));
    const t = C.promiseTotals(items, derived.M.length);
    expect(t.proven).toBe(derived.TOT.proven);
    expect(t.deviating).toBe(derived.TOT.devs);
    expect(t.proven + t.open + t.deviating).toBe(t.total);
    const first = items[0];
    expect(first.key).toBe(`${first.recordId}#${first.scenarioId}`);
    expect(first.text).toMatch(/^Given /);
    expect(C.promiseRecords(derived)[0].cells.length).toBe(derived.M[0].scen.length);
  });

  it("filters by state, domain and query, and counts facets", () => {
    const open = C.filterPromises(items, "", { state: "open" });
    expect(open.every((i) => i.state === "open")).toBe(true);
    expect(
      C.filterPromises(items, "", { domain: "sync" }).every((i) => i.recordId.startsWith("sync/")),
    ).toBe(true);
    expect(
      C.filterPromises(items, "quick-add", {}).every(
        (i) => i.recordId.includes("quick-add") || i.text.toLowerCase().includes("quick-add"),
      ),
    ).toBe(true);
    const f = C.promiseFacets(items, { state: "open" }, atlasT("en"));
    expect(f.find((x) => x.key === "state:open")).toMatchObject({
      count: open.length,
      active: true,
    });
  });
});

describe("knowledge, operations, provenance", () => {
  it("counts open slots by the lint's rule", () => {
    const rows = C.knowledgeRows(model, atlasT("en"));
    expect(rows.every((r) => r.slots.length === 5)).toBe(true);
    const { perSlot, totals } = C.knowledgeTotals(rows);
    expect(totals.open).toBe(perSlot.reduce((a, b) => a + b, 0));
    expect(totals.filled + totals.open).toBe(rows.length * 5);
  });

  it("lists every SLO, alarm and check with its record", () => {
    const ops = C.opsEntries(model);
    expect(ops.filter((o) => o.kind === "SLO")).toHaveLength(model.slos.length);
    expect(ops.filter((o) => o.kind === "Alert")).toHaveLength(model.alerts.length);
    expect(ops.filter((o) => o.kind === "ContinuousCheck")).toHaveLength(model.checks.length);
  });

  it("groups records by team and creation day", () => {
    const p = C.provenance(model, "en");
    expect(p.teams.reduce((a, t) => a + t.records, 0) + p.unowned).toBe(model.features.length);
    expect(p.days.reduce((a, d) => a + d.count, 0) + p.undated).toBe(model.features.length);
    expect(p.range.from <= p.range.to).toBe(true);
    expect(p.months[0].label).toMatch(/^\w{3} \d{4}$/);
  });
});

describe("structure", () => {
  const tax = C.taxonomyDomains(model, domainViews(model));

  it("counts records per capability", () => {
    expect(tax.flatMap((d) => d.capabilities).reduce((a, c) => a + c.records, 0)).toBe(
      model.features.length,
    );
    expect(tax.find((d) => d.id === "tasks")!.capabilities[0].id).toBe("tasks/create");
  });

  it("finds outliers against engine bands", () => {
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
            max: 3,
            samples: 10,
            below: 1,
            above: 0,
            band: { low: 2, high: 4 },
          },
        ],
      },
    } as AtlasModel;
    const c = C.calibration(withCal, tax, atlasT("en"));
    expect(c.metrics[0]).toMatchObject({ label: "Promises per record", unit: "Promises" });
    expect(c.metrics[0].values).toHaveLength(model.features.length);
    expect(c.outliers.every((o) => o.value < 2 && o.side === "below")).toBe(true);
    expect(c.outliers.length).toBeGreaterThan(0);
    expect(C.calibration(model, tax, atlasT("en")).metrics).toEqual([]);
  });
});

describe("evidence and code", () => {
  it("groups declared tests by file", () => {
    const files = C.testFiles(model);
    const kinds = C.testKinds(files);
    expect(kinds.map((k) => k.kind)).toEqual(["Unit", "Integration", "E2E"]);
    expect(kinds.reduce((a, k) => a + k.files, 0)).toBe(files.length);
    expect(files.every((f) => f.records.length > 0)).toBe(true);
  });

  it("lists drift, deviations and fixes from the model", () => {
    expect(C.driftItems(model)).toEqual([
      {
        recordId: "sync/conflict/last-write-wins",
        path: "crates/sync/src/conflict.rs",
        changedAt: "2026-07-26T14:02:00Z",
      },
    ]);
    expect(C.deviations(model)).toEqual([]);
    expect(C.fixCommits(model)).toEqual([]);
  });

  it("derives anchors, directories and roles", () => {
    const rows = C.anchorRows(model);
    expect(rows).toHaveLength(model.anchorPairs.length);
    const dirs = C.anchorDirs(rows);
    expect(dirs.reduce((a, d) => a + d.anchors, 0)).toBe(rows.length);
    expect(C.anchorRoles(rows).reduce((a, r) => a + r.count, 0)).toBe(rows.length);
    expect(C.dirKey("a/b/c.ts")).toBe("a/b");
    expect(C.dirKey("a/c.ts")).toBe("a");
    expect(C.dirKey("c.ts")).toBe(".");
  });

  it("measures directory shares and the biggest unanchored files", () => {
    const shares = C.dirShares(model)!;
    expect(shares).not.toBeNull();
    const paths = [...new Set(model.anchorPairs.map((a) => a.path))];
    const tree = C.fileTree(paths, shares);
    expect(tree.reduce((a, n) => a + n.anchored, 0)).toBe(paths.length);
    const gaps = C.fileGaps(model, shares);
    expect(gaps).toHaveLength(model.scan.unanchoredFiles!.length);
    expect(gaps[0].loc!).toBeGreaterThanOrEqual(gaps[gaps.length - 1].loc!);
    expect(C.dirShares({ ...model, scan: {} } as AtlasModel)).toBeNull();
    expect(C.fileGaps({ ...model, scan: {} } as AtlasModel, null)).toEqual([]);
  });

  it("turns policies into rules", () => {
    const r = C.rules(model);
    expect(r.map((x) => x.id)).toEqual(model.policies.map((p) => p.id));
    expect(r[0].strength).toMatch(/must|should|may/);
  });
});

describe("glossary and hub", () => {
  it("is empty without a declared glossary", () => {
    expect(C.glossaryTerms(derived)).toEqual([]);
    expect(C.glossaryDetail(derived, "x")).toBeNull();
  });

  it("maps declared terms with categories and usage", () => {
    const withG = derive(
      {
        ...model,
        glossary: {
          schemaVersion: "1",
          terms: [
            { term: "Task", definition: "Something to do", renderings: { en: "task" } },
            { term: "List", definition: "Multiple Tasks", renderings: {} },
          ],
        },
      } as AtlasModel,
      [{ id: "core", title: "core", declared: true, terms: ["Task"] }],
    );
    const terms = C.glossaryTerms(withG);
    expect(terms[0]).toMatchObject({ term: "Task", category: "core", status: "settled" });
    expect(terms[1].category).toBe("");
    expect(C.lettersOf(terms)).toEqual([
      { letter: "L", count: 1 },
      { letter: "T", count: 1 },
    ]);
    expect(C.glossaryDetail(withG, "Task")).toMatchObject({
      translation: "en: task",
      occurrences: [],
    });
  });

  it("puts a measured number or null on every tile", () => {
    const facts = C.contentFacts(model, derived);
    const kinds = C.contentKinds(facts, atlasT("en"), uiT("en"));
    expect(kinds).toHaveLength(18);
    expect(kinds.find((k) => k.key === "data-shapes")!.count).toBe(model.entities.length);
    expect(kinds.find((k) => k.key === "glossary")!.count).toBeNull();
    expect(kinds.find((k) => k.key === "calibration")!.count).toBeNull();
    expect(kinds.find((k) => k.key === "taxonomy")!.count).toBeNull();
    expect(kinds.find((k) => k.key === "drift")!.count).toBe(1);
    expect(kinds.find((k) => k.key === "anchor")!.count).toBe(model.anchorPairs.length);
    expect(C.hubHeadline(model, facts, 17, uiT("en")).sentence).toBe(
      `17 kinds of content across ${model.features.length} records.`,
    );
  });
});

describe("derived words follow the language", () => {
  const facts = C.contentFacts(model, derived);

  it("words every hub tile, view and finding in the language it is asked for", () => {
    const en = C.contentKinds(facts, atlasT("en"), uiT("en"));
    const de = C.contentKinds(facts, atlasT("de"), uiT("de"));
    const tile = (list: typeof en, key: string) => list.find((k) => k.key === key)!;
    expect(tile(en, "drift").label).toBe("Drift");
    expect(tile(de, "drift").label).toBe(germanLabel("Drift"));
    expect(tile(en, "files").finding ?? "").not.toBe(tile(de, "files").finding ?? "");
    // The view id is what the page opens; only the label is a word.
    expect(tile(en, "promises").views.map((v) => v.id)).toEqual(["list", "mosaic", "open"]);
    expect(tile(en, "promises").views.map((v) => v.label)).toEqual([
      "List",
      "Mosaic",
      "Open first",
    ]);
    expect(tile(de, "promises").views.map((v) => v.label)).toEqual([
      germanLabel("List"),
      germanLabel("Mosaic"),
      germanLabel("Open first"),
    ]);
    // Untranslated German in the English tiles would be a leak.
    const words = en.flatMap((k) => [k.label, k.desc, k.unit, k.finding ?? ""]).join(" ");
    for (const word of ["Promises", "not measured", "Files"])
      expect(words).not.toContain(germanLabel(word));
  });

  it("names a month in the language of the reader", () => {
    expect(C.monthLabel("2026-03", "en")).toBe("Mar 2026");
    expect(C.monthLabel("2026-03", "de")).toBe(
      new Intl.DateTimeFormat("de", { month: "short", year: "numeric", timeZone: "UTC" }).format(
        new Date("2026-03-01"),
      ),
    );
    expect(C.monthLabel("2026-03", "not a tag")).toBe("Mar 2026");
  });

  it("names the five knowledge slots from Atlas's words", () => {
    expect(C.knowledgeLabels(uiT("en"))).toEqual([
      "Prerequisite",
      "Where to find it",
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
    expect(C.knowledgeLabels(uiT("de"))[0]).toBe(germanLabel("Prerequisite"));
  });
});
