/** The catalogue — what is counted, and above all what is not. */

import { buildModel, type AtlasModel, type RawRecord, type RepoScan } from "@/model";
import { derive } from "../derive";
import { GROUPS, CATALOGUE, catalogueFiles, catalogueTests } from "./catalogue";

/** A record with one proven and one open promise, two anchors. */
const MIXED: RawRecord = {
  path: "docs/facets/a/b/mixed.yaml",
  raw: "id: a/b/mixed\n",
  doc: {
    id: "a/b/mixed",
    lifecycle: "active",
    intent: {
      summary: "One proven, one open.",
      decision_records: ["docs/adr/0001-read.md", "docs/notes/decide.md"],
    },
    contract: {
      scenarios: [
        { id: "kept", statement: "Given a\nWhen b\nThen it holds" },
        { id: "open", statement: "Given a\nWhen b\nThen es open remains" },
      ],
    },
    verification: { unit_tests: [{ id: "mixed.test.ts", proves: ["kept"] }] },
    lineage: { owner: { team: "read" }, created_at: "2026-01-01" },
  },
};

/** A record with a declared defect — never in the ratio (the specification). */
const DEVIANT: RawRecord = {
  path: "docs/facets/a/c/deviant.yaml",
  raw: "id: a/c/deviant\n",
  doc: {
    id: "a/c/deviant",
    lifecycle: "active",
    intent: { summary: "A declared defect." },
    contract: {
      scenarios: [
        {
          id: "upload-drops-the-file-extension",
          statement:
            "Given a file report.txt\nWhen storage saves the name\nThen the saved filename lacks its extension",
          deviation: {
            reason: "Storage saves report instead of report.txt.",
            confirmed_by: "test",
            tracked_as: "#42",
          },
        },
      ],
    },
    lineage: { owner: { team: "write" }, created_at: "2026-02-02" },
  },
};

/** A promise that **two** test files name. */

const TWO_PROOFS: RawRecord = {
  path: "docs/facets/a/d/two-proofs.yaml",
  raw: "id: a/d/two-proofs\n",
  doc: {
    id: "a/d/two-proofs",
    lifecycle: "active",
    intent: {
      summary: "One promise, two proofs.",
      decision_records: ["docs/adr/0001-read.md"],
    },
    contract: {
      scenarios: [{ id: "proved-twice", statement: "Given a\nWhen b\nThen it is proven" }],
    },
    verification: {
      unit_tests: [
        { id: "first.test.ts", proves: ["proved-twice"] },
        { id: "second.test.ts", proves: ["proved-twice"] },
      ],
    },
    lineage: { owner: { team: "read" }, created_at: "2026-01-01" },
  },
};

const RAWS = [MIXED, DEVIANT, TWO_PROOFS];

const SCAN: RepoScan = {
  scannedAt: "2026-09-16T06:04:00Z",
  root: "/repo",
  files: 2,
  totalLoc: 300,
  anchors: {
    "a/b/mixed": [
      { path: "src/one.ts", line: 1, role: "primary", excerpt: "func one()" },
      { path: "src/two.ts", line: 9, role: "related", excerpt: "func two()" },
    ],
  },
  anchoredFiles: [
    { path: "src/one.ts", loc: 120 },
    { path: "src/two.ts", loc: 80 },
  ],
} as unknown as RepoScan;

function build(scan: RepoScan = SCAN): AtlasModel {
  return buildModel(
    { name: "sample" },
    RAWS.map((r) => r.path),
    RAWS,
    scan,
  );
}

const view = (scan?: RepoScan) => derive(build(scan));
/** A tile's source: corpus and notes. Without a notes it is `null`. */
const q = (scan?: RepoScan) => ({ v: view(scan) });

const withErrors = () => ({
  v: derive(
    buildModel(
      { name: "sample" },
      RAWS.map((r) => r.path),
      RAWS,
      SCAN,
      [
        { path: "docs/facets/a/e/gone.yaml", message: "File missing from corpus" },
        { path: "docs/facets/a/f/broken.yaml", message: "unexpected Characters", line: 12 },
      ],
    ),
  ),
});

describe("the catalogue — the draft's shape", () => {
  it("carries every kind of content the draft names", () => {
    expect(Object.keys(CATALOGUE)).toHaveLength(23);
  });

  it("spreads them over the draft's four groups", () => {
    expect([...GROUPS]).toEqual(["Registry", "Evidence", "Code", "Context"]);
    const per = GROUPS.map((g) => Object.values(CATALOGUE).filter((d) => d.g === g).length);

    expect(per).toEqual([8, 4, 2, 9]);
  });

  it("uses the draft's word for the state of proof", () => {
    const tags = CATALOGUE.promises.items({ v: view() }).map((i) => i.tag);
    expect(tags).toContain("no linked test");
    expect(tags).not.toContain("open");
  });

  it("carries the draft's labels, not synonyms of its own", () => {
    expect(CATALOGUE.records.label).toBe("Records");
    expect(CATALOGUE.promises.label).toBe("Promises");
    expect(CATALOGUE.deviations.label).toBe("Deviations");
    expect(CATALOGUE.run.label).toBe("Run");
    expect(CATALOGUE.records.desc).toBe(
      "One feature, one file: intent, promises, test links, origin.",
    );
    expect(CATALOGUE.files.desc).toBe("What the scan read — with anchors and without.");
  });
});

describe("the counters come from the run", () => {
  it("counts records and promises out of the model", () => {
    const v = view();
    expect(CATALOGUE.records.count({ v })).toEqual({
      kind: "numericValue",
      n: 3,
      of: undefined,
    });
    // Three promises — the declared defect is not one.
    expect(CATALOGUE.promises.count({ v })).toEqual({
      kind: "numericValue",
      n: 3,
      of: undefined,
    });
  });

  it("counts the declared defect separately and never among the promises", () => {
    const v = view();
    expect(CATALOGUE.deviations.count({ v })).toEqual({
      kind: "numericValue",
      n: 1,
      of: undefined,
    });
    expect(CATALOGUE.deviations.bad?.({ v })).toBe(true);
    expect(CATALOGUE.promises.items({ v }).map((i) => i.t)).toEqual([
      "kept",
      "open",
      "proved-twice",
    ]);
  });

  it("shows the share for knowledge and operations, not only the number", () => {
    const v = view();
    // No record has knowledge or observation — but the denominator is
    // measured, so "0 of 2" is a measurement here and not an invention.
    expect(CATALOGUE.knowledge.count({ v })).toEqual({
      kind: "numericValue",
      n: 0,
      of: 3,
    });
    expect(CATALOGUE.operations.count({ v })).toEqual({
      kind: "numericValue",
      n: 0,
      of: 3,
    });
  });

  it("names the run's time of day", () => {
    expect(CATALOGUE.run.count(q())).toEqual({ kind: "word", text: "06:04" });
  });
});

describe("what this run does not know gets no zero", () => {
  it("says where no run time was reported that none was", () => {
    const v = view({ anchors: SCAN.anchors } as RepoScan);
    const c = CATALOGUE.run.count({ v });
    expect(c.kind).toBe("unknown");
    expect(c).toMatchObject({ why: "no time reported" });
  });

  it("says the glossary is not declared instead of showing zero terms", () => {
    const v = view();
    expect(v.glossary).toBeNull();
    const c = CATALOGUE.glossary.count({ v });
    // A zero would mean: the project has a glossary with no term in it.
    // That is the opposite of "it has none" (the specification).
    expect(c.kind).toBe("unknown");
    expect(c).toMatchObject({ why: "not declared" });
  });

  it("does not call a file with no measured lines a file of zero lines", () => {
    // A host without a file list: the files are known from the anchors,
    // nobody sent their length along.
    const v = view({ anchors: SCAN.anchors, scannedAt: SCAN.scannedAt } as RepoScan);
    const files = catalogueFiles(v);
    expect(files.every((f) => f.loc === null)).toBe(true);
    const lines = CATALOGUE.files.items({ v }).map((i) => i.s ?? "");
    expect(lines.some((s) => s.includes("0 Lines"))).toBe(false);
  });

  it("shows the lines as soon as the scan sends them", () => {
    const files = catalogueFiles(view());
    expect(files.find((f) => f.path === "src/one.ts")?.loc).toBe(120);
  });
});

describe("the calibration comes from the host", () => {
  /** A run with calibration — the bands are normative and are delivered. */
  const withBand = (above: number, high = 9) => ({
    v: {
      ...view(),
      model: {
        ...view().model,
        calibration: {
          records: 3,
          scenarios: 3,
          anchoredFiles: 2,
          domains: 2,
          capabilities: 3,
          hasTaxonomy: true,
          readings: [],
          metrics: [
            {
              name: "scenarios per record",
              median: 2,
              min: 1,
              max: 12,
              samples: 3,
              below: 0,
              above,
              band: { low: 2, high },
            },
          ],
        },
      },
    },
  });

  it("takes the number above the band from the calibration instead of recomputing it", () => {
    expect(CATALOGUE.calibration.count(withBand(4))).toEqual({
      kind: "numericValue",
      n: 4,
      of: undefined,
    });
    expect(CATALOGUE.calibration.bad?.(withBand(4))).toBe(true);
  });

  it("says it is inside the band where the host reports none above", () => {
    expect(CATALOGUE.calibration.count(withBand(0))).toEqual({
      kind: "word",
      text: "within the band",
    });
  });

  it("says it is not calibrated where this run sent no bands", () => {
    // Neither a zero nor "in range": both would claim an all-clear that
    // nobody measured.
    const c = CATALOGUE.calibration.count({ v: view() });
    expect(c.kind).toBe("unknown");
    expect(c).toMatchObject({ why: "not calibrated" });
  });
});

describe("the decisions the registry rests on", () => {
  it("names each document once, descending by how often it is cited", () => {
    const rows = CATALOGUE.decisions.items(q());

    expect(rows.map((r) => r.t)).toEqual(["docs/adr/0001-read.md", "docs/notes/decide.md"]);
    expect(rows.map((r) => r.tag)).toEqual(["2×", "1×"]);
  });

  it("gets the grammar right at exactly one citation", () => {
    // "1 records refer to it" is the kind of sentence a reader stops
    // at, and the fixture has a target with exactly one on purpose.
    const rows = CATALOGUE.decisions.items(q());

    expect(rows[0].s).toBe("2 records refer to it");
    expect(rows[1].s).toBe("1 record refers to it");
  });

  it("counts them", () => {
    expect(CATALOGUE.decisions.count(q())).toEqual({ kind: "numericValue", n: 2, of: undefined });
  });
});

describe("the records this run could not read", () => {
  it("names each one, with the line where there is one", () => {
    const rows = CATALOGUE.validation.items(withErrors());

    expect(rows.map((r) => r.t)).toEqual([
      "docs/facets/a/e/gone.yaml",
      "docs/facets/a/f/broken.yaml",
    ]);
    expect(rows.map((r) => r.s)).toEqual([
      "File missing from corpus",
      "Line 12: unexpected Characters",
    ]);
    expect(rows.every((r) => r.cls === "bad")).toBe(true);
  });

  it("counts them and stands in red while there is one", () => {
    expect(CATALOGUE.validation.count(withErrors())).toEqual({
      kind: "numericValue",
      n: 2,
      of: undefined,
    });
    expect(CATALOGUE.validation.bad?.(withErrors())).toBe(true);
  });

  it("shows a measured zero where every file was read", () => {
    // The one tile in this catalogue whose zero is the good answer — and it
    // is a measurement, not an absence: `loadCorpus` walked every path in the
    // index to arrive at it. So this is `numericValue`, not `unknown`.
    expect(CATALOGUE.validation.count(q())).toEqual({ kind: "numericValue", n: 0, of: undefined });
    expect(CATALOGUE.validation.bad?.(q())).toBe(false);
  });
});

describe("the derivations", () => {
  it("groups tests by file and counts what they name", () => {
    const tests = catalogueTests(view());
    const mixed = tests.find((t) => t.file === "mixed.test.ts");
    expect(mixed?.proves.map((p) => p.s.id)).toEqual(["kept"]);
  });

  it("lists every test file that names a promise, not only the first", () => {
    const testFiles = catalogueTests(view()).map((t) => t.file);
    expect(testFiles).toContain("first.test.ts");
    expect(testFiles).toContain("second.test.ts");
  });

  it("counts the promise against every file that names it", () => {
    const tests = catalogueTests(view());
    const both = tests.filter((t) => ["first.test.ts", "second.test.ts"].includes(t.file));
    expect(both).toHaveLength(2);
    both.forEach((t) => expect(t.proves.map((p) => p.s.id)).toEqual(["proved-twice"]));
  });

  it("lists anchors with records and orphans in one list", () => {
    const v = view();
    const anchorRows = CATALOGUE.anchor.items({ v });
    expect(anchorRows.map((i) => i.t)).toEqual(["src/one.ts:1", "src/two.ts:9"]);
    expect(anchorRows[0].tag).toBe("primary");
  });
});
