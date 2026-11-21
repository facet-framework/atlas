/** The translation between corpus and draft. */

import { buildModel, parseGlossary, type AtlasModel, type RawRecord, type RepoScan } from "@/model";
import {
  audienceFilters,
  scenarioFilters,
  audUnclassified,
  categoryOf,
  derive,
  gherkinParts,
  keepAud,
  scenarioState,
  share,
  driftOf,
  type DerivedGlossaryGroup,
} from "./derive";

/** A record whose only promise is **at once** proven and `unbacked`. */

const BOTH: RawRecord = {
  path: "docs/facets/a/b/both.yaml",
  raw: "id: a/b/both\n",
  doc: {
    id: "a/b/both",
    lifecycle: "active",
    intent: { summary: "Proven and without data." },
    contract: {
      scenarios: [
        {
          id: "proven-and-unbacked",
          statement: "Given a\nWhen b\nThen c",
          backing: { state: "unbacked", reason: "The store does not exist yet." },
        },
      ],
    },
    verification: { unit_tests: [{ id: "both.test.ts", proves: ["proven-and-unbacked"] }] },
    lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
  },
};

/** Two promises, one of them named by no test. */
const MIXED: RawRecord = {
  path: "docs/facets/a/b/mixed.yaml",
  raw: "id: a/b/mixed\n",
  doc: {
    id: "a/b/mixed",
    lifecycle: "active",
    intent: { summary: "One proven, one open." },
    contract: {
      scenarios: [
        { id: "kept", statement: "Given a\nWhen b\nThen c" },
        { id: "open", statement: "Given a\nWhen b\nThen c" },
      ],
    },
    verification: { unit_tests: [{ id: "mixed.test.ts", proves: ["kept"] }] },
    lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
  },
};

/** A record entirely without a promise — the case that has no share. */
const SILENT: RawRecord = {
  path: "docs/facets/a/b/silent.yaml",
  raw: "id: a/b/silent\n",
  doc: {
    id: "a/b/silent",
    lifecycle: "active",
    intent: { summary: "Promises nothing." },
    lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
  },
};

const DEVIANT: RawRecord = {
  path: "docs/facets/a/b/deviant.yaml",
  raw: "id: a/b/deviant\n",
  doc: {
    id: "a/b/deviant",
    lifecycle: "active",
    intent: { summary: "One promise, one declared defect." },
    contract: {
      scenarios: [
        { id: "kept", statement: "Given a\nWhen b\nThen c" },
        {
          id: "upload-drops-the-file-extension",
          statement:
            "Given a file report.txt\nWhen storage saves the name\nThen the stored file name has no extension",
          deviation: {
            reason: "The store saves report instead of report.txt.",
            confirmed_by: "test",
            tracked_as: "#42",
          },
        },
      ],
    },
    verification: {
      unit_tests: [{ id: "deviant.test.ts", proves: ["kept", "upload-drops-the-file-extension"] }],
    },
    lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
  },
};

const RAWS = [BOTH, MIXED, SILENT, DEVIANT];

const ANCHORS: RepoScan["anchors"] = {
  "a/b/mixed": [
    { path: "src/one.ts", line: 1, role: "primary" },
    { path: "src/two.ts", line: 9, role: "related" },
  ],
};

function modelWith(scan: RepoScan): AtlasModel {
  return buildModel(
    { name: "sample" },
    RAWS.map((r) => r.path),
    RAWS,
    scan,
  );
}

describe("scenarioState", () => {
  it("lets a test beat everything — even an explicit unbacked", () => {
    const v = derive(modelWith({ anchors: ANCHORS }));
    const scen = v.byId["a/b/both"].scen[0];

    // The promise carries both; only the ordering decides.
    expect(scen.raw.proven).toBe(true);
    expect(scen.raw.backing.state).toBe("unbacked");
    expect(scen.state).toBe("ok");
    expect(v.byId["a/b/both"].proven).toBe(1);
    expect(v.byId["a/b/both"].unbacked).toBe(0);
  });

  it("decides the same when asked directly on a single promise", () => {
    // Directly, not only through `derive`: the ordering of the three branches
    // is this function's statement, and a test that touches it only
    // indirectly would stay green if someone swapped them.
    const model = modelWith({ anchors: ANCHORS });
    const both = model.byId["a/b/both"].scenarios[0];
    const open = model.byId["a/b/mixed"].scenarios.find((s) => s.id === "open");

    expect(scenarioState(both)).toBe("ok");
    expect(open && scenarioState(open)).toBe("no");
  });

  it("calls a promise without a test unproven and not unbacked", () => {
    const v = derive(modelWith({ anchors: ANCHORS }));
    const f = v.byId["a/b/mixed"];
    expect(f.scen.map((s) => s.state).sort()).toEqual(["no", "ok"]);
    expect(f.open).toBe(1);
  });
});

describe("Deviation (the specification)", () => {
  const dev = () => derive(modelWith({ anchors: ANCHORS })).byId["a/b/deviant"];

  it("never reaches `ok`, even when a test names it", () => {
    const s = dev().scen.find((x) => x.id === "upload-drops-the-file-extension");

    // The evidence is there — and changes nothing about what the row shows.
    expect(s?.raw.proven).toBe(true);
    expect(s?.state).toBe("dev");
    expect(s?.state).not.toBe("ok");
  });

  it("decides the same when asked directly on a single promise", () => {
    // The deviation has to be the *first* branch. A test that touches it only
    // through `derive` would stay green if someone pushed it behind `proven`.
    const model = modelWith({ anchors: ANCHORS });
    const deviation = model.byId["a/b/deviant"].scenarios.find(
      (s) => s.id === "upload-drops-the-file-extension",
    );

    expect(deviation?.proven).toBe(true);
    expect(deviation && scenarioState(deviation)).toBe("dev");
  });

  it("keeps the proof state beside it readable", () => {
    // Variant C of the draft: a deviation *can* be proven, and how well it is
    // backed stays the second, independent question.
    const s = dev().scen.find((x) => x.id === "upload-drops-the-file-extension");
    expect(s?.evidence).toBe("ok");
    expect(s?.test).toBe("deviant.test.ts");
  });

  it("passes reason, confirmation and tracking on word for word", () => {
    const s = dev().scen.find((x) => x.id === "upload-drops-the-file-extension");
    expect(s?.deviation).toEqual({
      reason: "The store saves report instead of report.txt.",
      confirmedBy: "test",
      trackedAs: "#42",
    });
  });

  it("leaves an ordinary promise untouched — if the block is missing, nothing is declared", () => {
    const s = dev().scen.find((x) => x.id === "kept");
    expect(s?.state).toBe("ok");
    // No block means: nobody declared this behaviour a defect. Not that
    // someone checked and found it good.
    expect(s?.deviation).toBeNull();
  });

  it("stands in no ratio — neither in the numerator nor in the denominator", () => {
    const f = dev();

    expect(f.scen).toHaveLength(2);
    expect(f.claims).toBe(1);
    expect(f.devs).toBe(1);
    expect(f.proven).toBe(1);
    expect(f.open).toBe(0);
    expect(f.unbacked).toBe(0);
    // One of one promise is kept. Two of two would be a lie, one of two would
    // be an invented gap — the defect is neither of the two.
    expect(f.grade).toBe(100);
  });

  it("is counted separately in the total, not mixed in among the promises", () => {
    const v = derive(modelWith({ anchors: ANCHORS }));
    const all = v.M.reduce((n, f) => n + f.scen.length, 0);

    expect(v.TOT.devs).toBe(1);
    expect(v.TOT.claims).toBe(all - 1);
    expect(v.TOT.claims).toBe(v.TOT.proven + v.TOT.open + v.TOT.unbacked);
  });
});

describe("Lines of a feature", () => {
  it("counts them when the scan knows every anchored file", () => {
    const v = derive(
      modelWith({
        anchors: ANCHORS,
        anchoredFiles: [
          { path: "src/one.ts", loc: 120 },
          { path: "src/two.ts", loc: 30 },
        ],
      }),
    );
    expect(v.byId["a/b/mixed"].loc).toBe(150);
  });

  it("names none when the scan sent no file list at all", () => {
    const v = derive(modelWith({ anchors: ANCHORS }));
    expect(v.byId["a/b/mixed"].loc).toBeNull();
  });

  it("names none when even a single anchored file is missing from the list", () => {
    // A partial sum would look like a measurement and be too small — and
    // nobody could tell. Better a dash.
    const v = derive(
      modelWith({
        anchors: ANCHORS,
        anchoredFiles: [{ path: "src/one.ts", loc: 120 }],
      }),
    );
    expect(v.byId["a/b/mixed"].loc).toBeNull();
  });
});

describe("Proof ratio", () => {
  it("is null — not 0 % — for a record entirely without a promise", () => {
    const v = derive(modelWith({ anchors: ANCHORS }));
    expect(v.byId["a/b/silent"].claims).toBe(0);
    expect(v.byId["a/b/silent"].grade).toBeNull();
  });

  it("computes it as soon as there are promises", () => {
    const v = derive(modelWith({ anchors: ANCHORS }));
    expect(v.byId["a/b/mixed"].grade).toBe(50);
  });
});

describe("Scan header line", () => {
  it("reads the line count from totalLoc, which the host really sends", () => {
    // `RepoScan.loc` stands in the type and is filled by nobody; whoever reads
    // it shows a dash on every real repository.
    const v = derive(modelWith({ anchors: ANCHORS, totalLoc: 867126, files: 5194 }));
    expect(v.scan.loc).toBe(867126);
    expect(v.scan.files).toBe(5194);
  });

  it("names no line count when the host sent none", () => {
    const v = derive(modelWith({ anchors: ANCHORS }));
    expect(v.scan.loc).toBeNull();
    expect(v.scan.anchoredLoc).toBeNull();
  });
});

describe("share", () => {
  it("gives null instead of a division by zero", () => {
    expect(share(0, 0)).toBeNull();
    expect(share(3, 0)).toBeNull();
  });

  it("floors incomplete shares to a whole percent", () => {
    expect(share(1, 3)).toBe(33);
    expect(share(2, 3)).toBe(66);
  });
});

describe("gherkinParts", () => {
  it("attaches AND and BUT to the sentence before instead of opening a fourth line", () => {
    const raw: RawRecord = {
      path: "docs/facets/a/b/steps.yaml",
      raw: "",
      doc: {
        id: "a/b/steps",
        lifecycle: "active",
        intent: { summary: "s" },
        contract: {
          scenarios: [
            {
              id: "mehrschrittig",
              statement: "Given one\nAnd two\nWhen three\nThen four\nBut five",
            },
          ],
        },
        lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
      },
    };
    const model = buildModel({ name: "x" }, [raw.path], [raw], {});
    const parts = gherkinParts(model.byId["a/b/steps"].scenarios[0]);
    expect(parts.given).toBe("one and two");
    expect(parts.when).toBe("three");
    expect(parts.then).toBe("four and five");
  });
});

describe("driftOf", () => {
  it("weighs a file that ran ahead heavier than an unchecked promise", () => {
    // The one is demonstrably outdated, the other was never checked.
    expect(driftOf(1, 0)).toBeGreaterThan(driftOf(0, 99));
  });
});

describe("Glossary", () => {
  const GLOSSARY = `schema_version: "0.1"
terms:
  - term: Consignee
    definition: |
      The party named in the transport document.
  - term: Carrier
    definition: |
      The party transporting the goods.
`;

  /** Two records whose prose each carries a different term. */
  const USER: RawRecord = {
    path: "docs/facets/a/b/user.yaml",
    raw: "id: a/b/user\n",
    doc: {
      id: "a/b/user",
      lifecycle: "active",
      intent: { summary: "The Consignee is notified." },
      contract: {
        scenarios: [{ id: "one", statement: "Given a\nWhen b\nThen the Carrier confirms" }],
      },
      lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
    },
  };

  function modelWithGlossary(text?: string): AtlasModel {
    const raws = [...RAWS, USER];
    return buildModel(
      { name: "sample" },
      raws.map((r) => r.path),
      raws,
      { anchors: ANCHORS },
      [],
      null,
      null,
      parseGlossary(text),
    );
  }

  // Without a glossary nothing changes. A project without the file has not
  // failed to define something — `null` and "empty" are opposite statements.
  it("is null when the project declares none", () => {
    expect(derive(modelWithGlossary()).glossary).toBeNull();
  });

  it("passes the terms on in search order", () => {
    const glossary = derive(modelWithGlossary(GLOSSARY)).glossary;
    expect(glossary?.terms.map((t) => t.term)).toEqual(["Consignee", "Carrier"]);
    // Longest first, so that a multi-word term beats a shorter one.
    expect(glossary?.index).toEqual(["Consignee", "Carrier"]);
  });

  // What is counted is what the reader also sees linked — summary, promises,
  // knowledge answers. A list of occurrences that means a different prose
  // than the one shown would be a number nobody can look up.
  it("names per term the records whose shown prose contains it", () => {
    const glossary = derive(modelWithGlossary(GLOSSARY)).glossary;
    expect(glossary?.usedBy["Consignee"]).toEqual(["a/b/user"]);
    expect(glossary?.usedBy["Carrier"]).toEqual(["a/b/user"]);
  });

  // A declared term nobody uses stands with an empty list — that is the
  // honest state and not a gap to be filled here.
  it("lists an unused term with an empty list instead of not at all", () => {
    const glossary = derive(
      modelWithGlossary(
        GLOSSARY +
          `  - term: Shipper
    definition: |
      The party handing over the goods.
`,
      ),
    ).glossary;
    expect(glossary?.usedBy["Shipper"]).toEqual([]);
  });

  // Whole word or not at all, in counting too: otherwise the sheet would
  // show a different number than the reader sees linked in the text.
  it("counts no occurrence inside a longer word", () => {
    const inside: RawRecord = {
      path: "docs/facets/a/b/inside.yaml",
      raw: "id: a/b/inside\n",
      doc: {
        id: "a/b/inside",
        lifecycle: "active",
        intent: { summary: "The Consigneelist is long." },
        lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
      },
    };
    const raws = [inside];
    const model = buildModel(
      { name: "sample" },
      raws.map((r) => r.path),
      raws,
      {},
      [],
      null,
      null,
      parseGlossary(GLOSSARY),
    );
    expect(derive(model).glossary?.usedBy["Consignee"]).toEqual([]);
  });

  it("counts no occurrence in a code span", () => {
    const imCode: RawRecord = {
      path: "docs/facets/a/b/in-code.yaml",
      raw: "id: a/b/in-code\n",
      doc: {
        id: "a/b/in-code",
        lifecycle: "active",
        intent: { summary: "Calling `Consignee` returns nothing." },
        contract: {
          scenarios: [{ id: "one", statement: "Given a\nWhen b\nThen the Carrier confirms" }],
        },
        lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
      },
    };
    const raws = [imCode];
    const model = buildModel(
      { name: "sample" },
      raws.map((r) => r.path),
      raws,
      {},
      [],
      null,
      null,
      parseGlossary(GLOSSARY),
    );
    const glossary = derive(model).glossary;

    expect(glossary?.usedBy["Consignee"]).toEqual([]);
    // The term in an ordinary sentence is still counted — otherwise the rule
    // would not have sharpened the counter but switched it off.
    expect(glossary?.usedBy["Carrier"]).toEqual(["a/b/in-code"]);
  });
});

/** The audience — and the one distinction the whole field rests on. */

describe("Audience", () => {
  /** Three sentences: one for the product, one for engineering, one unclassified. */
  const MIXED_AUD: RawRecord = {
    path: "docs/facets/a/b/aud.yaml",
    raw: "id: a/b/aud\n",
    doc: {
      id: "a/b/aud",
      lifecycle: "active",
      intent: { summary: "Three statements, two classified." },
      contract: {
        scenarios: [
          { id: "for-product", statement: "Given a\nWhen b\nThen c", audience: "product" },
          { id: "for-engineering", statement: "Given a\nWhen b\nThen c", audience: "engineering" },
          { id: "nobody", statement: "Given a\nWhen b\nThen c" },
        ],
      },
      lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
    },
  };

  const v = derive(buildModel({ name: "sample" }, [MIXED_AUD.path], [MIXED_AUD], {}));
  const scen = v.byId["a/b/aud"].scen;
  const [product, technik, nobody] = scen;

  it("carries the classification into the row, and its absence as absence", () => {
    expect(product.audience).toBe("product");
    expect(technik.audience).toBe("engineering");
    // No `?? "product"`: that would be an audience nobody vouches for, at the
    // very place every surface asks about it afterwards.
    expect(nobody.audience).toBeNull();
  });

  it("puts the unclassified sentence into neither of the two audiences", () => {
    // The core of the ticket. Silently showing it along would claim both
    // audiences, silently leaving it out would suppress it — what stands here
    // is that it appears in no selection, so that the surface beside it has
    // to announce it separately.
    expect(keepAud("product", nobody)).toBe(false);
    expect(keepAud("engineering", nobody)).toBe(false);
  });

  it("lets every sentence through without a filter, the unclassified one too", () => {
    expect(scen.filter((s) => keepAud("all", s))).toHaveLength(3);
    expect(scen.filter((s) => keepAud("product", s))).toEqual([product]);
    expect(scen.filter((s) => keepAud("engineering", s))).toEqual([technik]);
  });

  it("counts the unclassified sentences instead of keeping quiet about them", () => {
    expect(audUnclassified(scen)).toBe(1);
    expect(audUnclassified([product, technik])).toBe(0);
  });

  it("stands across the proof bar instead of in it", () => {
    // Two questions, two rows: the proof list knows no "Product", and a reader
    // who looks for "unbacked" and "Product" at once should get both.
    expect(scenarioFilters().map(([value]) => value)).not.toContain("product");
    expect(audienceFilters().map(([value]) => value)).toEqual(["all", "product", "engineering"]);
  });
});

/** The glossary's groups — and the one rule that holds them together: they are
 * **not computed here**. */

describe("Glossary groups", () => {
  const GROUPS: DerivedGlossaryGroup[] = [
    {
      id: "parties",
      title: "Parties",
      purpose: "The parties involved.",
      declared: true,
      terms: ["Consignee"],
    },
    { id: "events", title: "Events", declared: true, terms: [] },
    { id: "documents", declared: false, terms: ["Bill of Lading"] },
    { id: "", declared: false, terms: ["Demurrage"] },
  ];

  const GLOSSARY = `schema_version: "0.1"
terms:
  - term: Consignee
    definition: |
      The party named in the transport document.
  - term: Bill of Lading
    definition: |
      The carrier document.
  - term: Demurrage
    definition: |
      The cost of waiting.
`;

  const model = (text?: string) =>
    buildModel({ name: "sample" }, [], [], {}, [], null, null, text ? parseGlossary(text) : null);

  it("passes the host's groups on unchanged, in its order", () => {
    const glossary = derive(model(GLOSSARY), GROUPS).glossary;
    // Neither sorted nor rearranged: "documents" stands behind "events",
    // although alphabetically it would come before, and the nameless group
    // stays last. Whoever sorted here would have overruled the host's rule.
    expect(glossary?.groups?.map((g) => g.id)).toEqual(["parties", "events", "documents", ""]);
    expect(glossary?.groups?.[0].title).toBe("Parties");
    expect(glossary?.groups?.[0].purpose).toBe("The parties involved.");
  });

  // The fourth state, and the only one that is not a group. `null` instead of
  // an empty list: a surface given a single nameless group would draw a
  // heading over a list that has none.
  it("is null when nobody grouped — not an empty grouping", () => {
    expect(derive(model(GLOSSARY)).glossary?.groups).toBeNull();
    expect(derive(model(GLOSSARY), undefined).glossary?.groups).toBeNull();
  });

  // An empty list from the host is the same absence, written differently.
  // Letting it through would mean showing "grouped, and the grouping is
  // empty" — a statement the host does not make.
  it("reads an empty group list as absence, not as an empty grouping", () => {
    expect(derive(model(GLOSSARY), []).glossary?.groups).toBeNull();
  });

  // Without a glossary there is nothing to group — not even when the host
  // (for whatever reason) sent groups along.
  it("stays out entirely without a declared glossary", () => {
    expect(derive(model(), GROUPS).glossary).toBeNull();
  });

  // The flat view stays standing beside it — both, not one instead of the
  // other: the groups draw the catalogue, the flat index links the prose,
  // and the sheet looks up through it.
  it("leaves the flat reading view untouched beside the groups", () => {
    const glossary = derive(model(GLOSSARY), GROUPS).glossary;
    expect(glossary?.terms.map((t) => t.term)).toEqual([
      "Consignee",
      "Bill of Lading",
      "Demurrage",
    ]);
    expect(glossary?.index).toContain("Consignee");
    expect(glossary?.usedBy["Consignee"]).toEqual([]);
  });
});

/** A term's category lives in the group list. The shared lookup keeps sheet,
 * popover and catalogue detail from deriving different categories for one term. */

describe("categoryOf", () => {
  const GROUPS: DerivedGlossaryGroup[] = [
    { id: "parties", title: "Parties", declared: true, terms: ["Consignee"] },
    { id: "documents", declared: false, terms: ["Bill of Lading"] },
    { id: "", declared: false, terms: ["Demurrage"] },
  ];

  it("names title and id of a declared capability", () => {
    expect(categoryOf(GROUPS, "Consignee")).toEqual({
      id: "parties",
      title: "Parties",
      declared: true,
    });
  });

  // The failure case keeps its own shape: an id without a title. Giving it
  // out as "assigned by nobody" would turn an error into an absence — and the
  // two have opposite remedies.
  it("keeps an undeclared capability apart from no assignment", () => {
    expect(categoryOf(GROUPS, "Bill of Lading")).toEqual({
      id: "documents",
      title: undefined,
      declared: false,
    });
  });

  // The nameless group is not a capability, and `null` here is the answer and
  // not a gap: nobody has classified this term.
  it("gives null for a term nobody has classified", () => {
    expect(categoryOf(GROUPS, "Demurrage")).toBeNull();
    expect(categoryOf(GROUPS, "Unknown")).toBeNull();
    expect(categoryOf(null, "Consignee")).toBeNull();
  });
});
