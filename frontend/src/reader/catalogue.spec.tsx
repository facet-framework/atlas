/** The Contents catalogue shows: the host's
 * cycle remainder, the files a run could not read, the decisions records lean
 * on, a glossary grouped by the host's categories, and links that name their
 * whole destination. Each case mounts the whole surface over a TaskFlow
 * corpus and reads the rendered page. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadCorpus, type AtlasModel } from "@/model";
import { FACETRC, INDEX, RECORDS, SCAN, taskflowModel } from "@/model/fixtures";
import type { DerivedGlossaryGroup } from "@/derive";
import Atlas from "./Atlas";
import * as D from "./derive-contents";
import { derive } from "@/derive";

const where = () => window.location.pathname;

let mounted: ReturnType<typeof render> | null = null;

/** Mounts the app at `path`; a second mount in one case replaces the first. */
function mount(
  path: string,
  model: AtlasModel = taskflowModel(),
  glossaryGroups?: DerivedGlossaryGroup[],
) {
  mounted?.unmount();
  window.history.replaceState(null, "", path);
  mounted = render(<Atlas model={model} readers={null} glossaryGroups={glossaryGroups} />);
  return mounted;
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const tile = (key: string) => screen.getByTestId(`kind-${key}`);
const figure = (key: string) => within(tile(key)).getByTestId("tile-figure");

describe("the hub lists what the run read", () => {
  it("draws the four groups with a counter from this run, the evidence group named for what it holds", () => {
    const model = taskflowModel();
    mount("/contents", model);
    for (const g of ["Registry", "Evidence", "Code", "Context"])
      expect(screen.getByTestId(`hub-group-${g}`)).toBeInTheDocument();
    expect(within(screen.getByTestId("hub-group-Evidence")).getByRole("heading")).toHaveTextContent(
      "Tests and findings",
    );
    expect(figure("promises")).toHaveTextContent(String(model.allScn.length));
    expect(figure("anchor")).toHaveTextContent(String(model.anchorPairs.length));
    expect(figure("decisions")).toHaveTextContent(String(model.decisionTargets.length));
  });

  it("names a glossary the project does not declare instead of counting zero terms", () => {
    mount("/contents");
    expect(figure("glossary")).toHaveTextContent("—");
    expect(figure("glossary")).not.toHaveTextContent("0");
    expect(tile("glossary")).toHaveTextContent("not declared");
  });

  it("opens each tile's own page at its address", async () => {
    for (const key of ["cycles", "read-errors", "decisions", "rules"]) {
      mount("/contents");
      await userEvent.click(within(tile(key)).getAllByRole("button")[0]);
      expect(where()).toBe(`/contents/${key}`);
    }
  });

  it("keeps anchors and rules as tiles and not as doors in the header", () => {
    mount("/contents");
    const nav = screen.getByRole("navigation", { name: "Areas" });
    expect(within(nav).queryByText("Anchors")).toBeNull();
    expect(within(nav).queryByText("Rules")).toBeNull();
    expect(within(nav).queryByText(/Data|\.facetrc/)).toBeNull();
    expect(tile("anchor")).toBeInTheDocument();
    expect(tile("rules")).toBeInTheDocument();
  });

  it("stands in the frame: the header and the path stay above the contents page", () => {
    mount("/contents/cycles");
    expect(document.querySelector<HTMLElement>(".t-shell__head")!).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByTestId("cycles-page")).toBeInTheDocument();
  });
});

describe("cycles", () => {
  function cyclic(): AtlasModel {
    const m = taskflowModel();
    m.cyclic = ["tasks/create/quick-add", "ghost/never/read"];
    // Precondition: one id has a read record, one does not.
    expect(m.byId["tasks/create/quick-add"]).toBeDefined();
    expect(m.byId["ghost/never/read"]).toBeUndefined();
    return m;
  }

  it("counts and lists the host's remainder, opens a read record and offers no link for an id without one", async () => {
    mount("/contents", cyclic());
    expect(figure("cycles")).toHaveTextContent("2");
    expect(figure("cycles")).toHaveClass("t-bad");
    mount("/contents/cycles", cyclic());
    const page = screen.getByTestId("cycles-page");
    expect(page).toHaveTextContent("on a dependency cycle or behind one");
    const rows = within(page).getAllByTestId("cycle-node");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByTestId("cycle-ghost")).toHaveTextContent("ghost/never/read");
    expect(within(rows[1]).queryByRole("button")).toBeNull();
    await userEvent.click(within(rows[0]).getByRole("button"));
    expect(where()).toBe("/record/tasks/create/quick-add");
  });

  it("shows a measured zero for an acyclic model, not a dash and not the warning colour", () => {
    // The host resolved every node: its remainder is empty. The TaskFlow
    // fixture declares a cycle, so the host's answer is set here.
    const m = taskflowModel();
    expect(m.cyclic.length).toBeGreaterThan(0);
    m.cyclic = [];
    mount("/contents", m);
    expect(figure("cycles")).toHaveTextContent("0");
    expect(figure("cycles")).not.toHaveTextContent("—");
    expect(figure("cycles")).not.toHaveClass("t-bad");
  });
});

describe("records that could not be read", () => {
  it("names each file with its line on a tile whose count stands in red", () => {
    const m = taskflowModel();
    m.corpusErrors = [
      { path: "docs/facets/features/a/b/broken.yaml", message: "bad indentation", line: 7 },
      { path: "docs/facets/features/a/b/missing.yaml", message: "named in the index, not read" },
    ];
    mount("/contents", m);
    expect(figure("read-errors")).toHaveTextContent("2");
    expect(figure("read-errors")).toHaveClass("t-bad");
    mount("/contents/read-errors", m);
    const rows = within(screen.getByTestId("unread-page")).getAllByTestId("unread-file");
    expect(rows[0]).toHaveTextContent("broken.yaml:7");
    expect(rows[0]).toHaveTextContent("bad indentation");
    expect(rows[1]).toHaveTextContent("missing.yaml");
    expect(rows[1]).toHaveTextContent("named in the index, not read");
  });
});

describe("decisions", () => {
  it("lists the documents most often named first, says how many records name each and opens one", async () => {
    const m = taskflowModel();
    m.decisionTargets = [
      {
        target: "docs/adr/0002-two.md",
        count: 2,
        recordIds: ["tasks/create/quick-add", "sync/queue/offline-queue"],
      },
      { target: "docs/adr/0001-one.md", count: 1, recordIds: ["sync/queue/offline-queue"] },
    ];
    mount("/contents/decisions", m);
    const rows = screen.getAllByTestId("decision-target");
    expect(rows.map((r) => within(r).getAllByRole("button")[0].textContent)).toEqual([
      "docs/adr/0002-two.md",
      "docs/adr/0001-one.md",
    ]);
    expect(within(rows[0]).getByTestId("decision-count")).toHaveTextContent("2 records name it");
    expect(within(rows[1]).getByTestId("decision-count")).toHaveTextContent("1 record names it");
    await userEvent.click(within(rows[1]).getByTitle("sync/queue/offline-queue"));
    expect(where()).toBe("/record/sync/queue/offline-queue");
    mount("/contents/decisions", m);
    await userEvent.click(screen.getByText("docs/adr/0002-two.md"));
    expect(where()).toBe("/p/adr/docs/adr/0002-two.md");
  });
});

describe("links on content pages name their whole destination", () => {
  it("opens the full record id from an operations entry", async () => {
    const m = taskflowModel();
    const id = D.opsEntries(m)[0].recordId;
    mount("/contents/operations", m);
    await userEvent.click(screen.getAllByTitle(id)[0]);
    expect(where()).toBe(`/record/${id}`);
  });

  it("opens an anchor's record and offers no link for an anchor whose record was not read", async () => {
    const m = taskflowModel();
    m.anchorPairs = [
      ...m.anchorPairs,
      { path: "src/ghost.ts", line: 3, role: "primary", id: "ghost/never/read" },
    ];
    mount("/contents", m);
    await userEvent.click(within(tile("anchor")).getByRole("button", { name: "Table" }));
    expect(where()).toBe("/contents/anchor");
    const orphan = screen
      .getAllByTestId("anchor-orphan")
      .find((o) => o.textContent?.includes("ghost/never/read"));
    expect(orphan).toBeDefined();
    expect(screen.queryByTitle("ghost/never/read")).toBeNull();
    const real = m.anchorPairs[0].id;
    await userEvent.click(screen.getAllByTitle(real)[0]);
    expect(where()).toBe(`/record/${real}`);
  });
});

describe("pure measurements behind the tiles", () => {
  it("lists every test file that names a promise and counts the promise in each", () => {
    const m = taskflowModel();
    const rec = m.recs.find((r) => r.tests.length && r.scenarios.length)!;
    const scenario = rec.scenarios[0].id;
    const base = rec.tests[0];
    rec.tests = [
      { ...base, kind: "unit", id: "web/a/one.spec.ts::names it", proves: [scenario] },
      { ...base, kind: "unit", id: "web/b/two.spec.ts::names it too", proves: [scenario] },
    ];
    const files = D.testFiles(m).filter((f) => f.records.includes(rec.id));
    expect(files.map((f) => f.path).sort()).toEqual(["web/a/one.spec.ts", "web/b/two.spec.ts"]);
    for (const f of files) expect(f.promises).toBe(1);
  });

  it("measures a tile's share in the unit of its numerator and shows none without a denominator", () => {
    const m = taskflowModel();
    const derived = derive(m);
    const facts = D.contentFacts(m, derived);
    const t = (k: string) => k;
    const kinds = D.contentKinds(facts, t, t as never);
    const files = kinds.find((k) => k.key === "files")!;
    // Files with an anchor of the files the scan counted: both are files.
    expect(files.share).toBe(facts.files ? facts.anchoredFiles / facts.files : null);
    const promises = kinds.find((k) => k.key === "promises")!;
    expect(promises.share).toBe(facts.pt.proven / facts.pt.total);
    const unscanned = D.contentKinds({ ...facts, files: null }, t, t as never);
    expect(unscanned.find((k) => k.key === "files")!.share).toBeNull();
    const none = D.contentKinds(
      { ...facts, pt: { ...facts.pt, total: 0, proven: 0 } },
      t,
      t as never,
    );
    expect(none.find((k) => k.key === "promises")!.share).toBeNull();
  });

  it("counts only the answered knowledge slots", () => {
    const rows = [
      { id: "a/b/c", domain: "a", slots: ["yes", null, null, null, null], answers: [] },
    ];
    expect(D.knowledgeTotals(rows as never).totals).toEqual({ records: 1, open: 4, filled: 1 });
  });
});

/** Glossary ---------------------------------------------------------------------- */

const GLOSSARY = `schema_version: "0.1"
terms:
  - term: Queue
    definition: |
      The local change list; every Queue has a Conflict.
    renderings:
      en: queue
  - term: Conflict
    definition: |
      Two changes to the same field.
  - term: Ghost
    definition: |
      A term under an undeclared category.
  - term: Rest
    definition: |
      A term without a category.
`;

function glossaryModel(): AtlasModel {
  const m = loadCorpus({
    facetrc: FACETRC,
    index: INDEX,
    records: RECORDS,
    scan: SCAN,
    glossary: GLOSSARY,
  });
  expect(m.glossary?.terms.map((t) => t.term)).toEqual(["Queue", "Conflict", "Ghost", "Rest"]);
  return m;
}

const GROUPS: DerivedGlossaryGroup[] = [
  { id: "sync", title: "Synchronisation", declared: true, terms: ["Queue", "Conflict"] },
  { id: "ui", title: "Interface", declared: true, terms: [] },
  { id: "spuk", declared: false, terms: ["Ghost"] },
  { id: "", declared: false, terms: ["Rest"] },
];

const sections = () => screen.getAllByTestId("glossary-category");

describe("the glossary grouped by the host's categories", () => {
  it("keeps the host's order: declared, declared and empty, undeclared as an error, the uncategorised last", () => {
    mount("/glossary", glossaryModel(), GROUPS);
    expect(sections().map((s) => s.getAttribute("data-state"))).toEqual([
      "ok",
      "empty",
      "undeclared",
      "none",
    ]);
    expect(within(sections()[0]).getByTestId("glossary-category-name")).toHaveTextContent(
      "Synchronisation",
    );
    expect(within(sections()[1]).getByTestId("glossary-category-empty")).toBeInTheDocument();
    const ghost = within(sections()[2]).getByTestId("glossary-category-name");
    expect(ghost).toHaveTextContent("spuk");
    expect(ghost).toHaveClass("t-mono", "t-bad");
    expect(within(sections()[2]).getByTestId("glossary-category-undeclared")).toBeInTheDocument();
    expect(within(sections()[3]).getByTestId("glossary-category-name")).toHaveTextContent(
      "No category · assigned by nobody",
    );
    expect(within(sections()[3]).getByText("Rest")).toBeInTheDocument();
    expect(screen.queryByText(/Other/)).toBeNull();
  });

  it("stays one flat list with no category heading when nobody groups", () => {
    mount("/glossary", glossaryModel());
    expect(screen.queryByTestId("glossary-category")).toBeNull();
    expect(screen.queryByRole("button", { expanded: true })).toBeNull();
    expect(screen.getByText("Queue")).toBeInTheDocument();
  });

  it("collapses one group and opens it again while the others stay open and its count stays", async () => {
    mount("/glossary", glossaryModel(), GROUPS);
    await userEvent.click(screen.getByRole("button", { name: "Collapse Synchronisation" }));
    expect(within(sections()[0]).queryByText("Conflict")).toBeNull();
    expect(within(sections()[0]).getByTestId("glossary-category-count")).toHaveTextContent("2");
    expect(within(sections()[3]).getByText("Rest")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Expand Synchronisation" }));
    expect(within(sections()[0]).getByText("Conflict")).toBeInTheDocument();
  });

  it("opens a collapsed group holding a hit under a filter and drops the groups holding none", async () => {
    mount("/glossary", glossaryModel(), GROUPS);
    await userEvent.click(screen.getByRole("button", { name: "Collapse Synchronisation" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Confl" } });
    expect(sections()).toHaveLength(1);
    expect(within(sections()[0]).getByText("Conflict")).toBeInTheDocument();
  });

  it("names the category of a term as it stands, and none where nobody groups", () => {
    mount("/glossary/Ghost", glossaryModel(), GROUPS);
    expect(screen.getByTestId("term-category")).toHaveAttribute("data-state", "undeclared");
    mount("/glossary/Rest", glossaryModel(), GROUPS);
    expect(screen.getByTestId("term-category")).toHaveAttribute("data-state", "unassigned");
    mount("/glossary/Conflict", glossaryModel(), GROUPS);
    expect(screen.getByTestId("term-category")).toHaveTextContent("Synchronisation");
    mount("/glossary/Queue", glossaryModel(), GROUPS);
    expect(screen.getByTestId("term-detail")).toHaveTextContent("en: queue");
  });

  it("names no category in a term's detail when the glossary declares none", () => {
    mount("/glossary/Rest", glossaryModel());
    expect(screen.getByTestId("term-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("term-category")).toBeNull();
  });

  it("links every other declared term in a definition, never the term itself", async () => {
    mount("/glossary/Queue", glossaryModel(), GROUPS);
    const def = screen.getByTestId("term-definition");
    const links = within(def).getAllByTestId("prose-term");
    expect(links.map((l) => l.textContent)).toEqual(["Conflict"]);
    expect(def).toHaveTextContent("every Queue has");
    await userEvent.click(links[0]);
    expect(where()).toBe("/glossary/Conflict");
  });

  it("says no record uses a term nothing refers to", () => {
    mount("/glossary/Rest", glossaryModel(), GROUPS);
    expect(screen.getByTestId("term-unused")).toBeInTheDocument();
  });

  it("omits glossary proposal controls and explains an undeclared glossary", () => {
    const declared = glossaryModel();
    expect(declared.glossary?.terms.length).toBeGreaterThan(0);
    mount("/glossary", declared, GROUPS);
    expect(screen.getByText("Queue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Propose/ })).toBeNull();
    mount("/glossary");
    expect(screen.getByText("No glossary declared")).toBeInTheDocument();
    expect(screen.getAllByText("No glossary declared")).toHaveLength(1);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
