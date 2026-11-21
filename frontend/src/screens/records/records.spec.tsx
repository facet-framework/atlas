import { germanLabel } from "@/i18n/testing-labels.spec-support";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderInEnglish as render, renderInEnglish } from "../testing";
import { createText } from "../text";
import { RecordsPage, Hit, type RecordsPageProps } from "./RecordsPage";
import {
  RecordDetailsPage,
  type RecordDetails,
  type RecordDetailsPageProps,
} from "./RecordDetailsPage";
import { AnchorSheet, ConfigSheet, RuleSheet, TermSheet } from "./RecordSheets";
import { CodeView, CommitSpark, DependencyGraph, ProofBar, SectionRail } from "./parts";
import { TAG, dateText, parseSteps, pctText, roleLabel, share, words, type Text } from "./model";
import { SUMMARY } from "../../fixtures/summary";
import { DependencyNetwork } from "./DependencyNetwork";
import { ADMIN_RECORD_YAML, TEST_COUNTS } from "./recordFacts.spec-support";
import {
  ADMIN_CONFIG,
  ADMIN_EXCERPT,
  MANY_ROWS,
  REAL_ROWS,
  RULE_ANCHORED,
  anchorsIn,
  applyFilters,
  distributionsFor,
  recordOf,
  facetsFor,
  featureById,
  fieldGroups,
  filterChips,
  matrixRows,
  recordYaml,
  networkOf,
  ruleAppliesTo,
  search,
  siblingsOf,
  sortRows,
  summaryOf,
  termOf,
} from "./storyData.spec-support";

/** Model -------------------------------------------------------------------- */

describe("parseSteps", () => {
  it("reads one step per line and continues unkeyworded lines", () => {
    expect(parseSteps("Given a\nWhen b\nThen c\ncontinued\nAnd d\nBut e")).toEqual([
      { kw: "given", text: "a" },
      { kw: "when", text: "b" },
      { kw: "then", text: "c continued" },
      { kw: "and", text: "d" },
      { kw: "and", text: "e" },
    ]);
  });

  it("splits a one-sentence scenario at its keywords", () => {
    const steps = parseSteps(
      'Given the bundled "adr" manifest, when its "reads" list is\ninspected, then it names exactly "docs/adr".',
    );
    expect(steps.map((s) => s.kw)).toEqual(["given", "when", "then"]);
    expect(steps[1].text).toBe('its "reads" list is inspected');
  });

  it("treats a statement without keywords as its premise", () => {
    expect(parseSteps("plain words")).toEqual([{ kw: "given", text: "plain words" }]);
  });
});

/** The page texts in each language, for the pure helpers that take a `t`. */
const inGerman: Text = createText("en").t;
const inEnglish: Text = createText("en").t;

describe("model helpers", () => {
  it("never turns a missing share into zero", () => {
    expect(share(1, 0)).toBeNull();
    expect(pctText(null, inGerman)).toBe("—");
    expect(pctText(share(1, 4), inGerman)).toBe("25%");
    expect(pctText(share(1, 4), inEnglish)).toBe("25%");
    expect(dateText(null, inGerman)).toBe("—");
    expect(dateText("2026-11-06T18:18:28Z", inGerman)).toBe("2026-11-06");
    expect(dateText("2026-11-06T18:18:28Z", inEnglish)).toBe("2026-11-06");
    expect(words("adr-plugin")).toBe("adr plugin");
    expect(roleLabel("primary", inGerman)).toBe("carries");
    expect(roleLabel("primary", inEnglish)).toBe("carries");
    expect(roleLabel("custom", inGerman)).toBe("custom");
    expect(TAG).toBe("@" + "facet");
  });
});

/** Story data --------------------------------------------------------------- */

describe("story data", () => {
  it("maps the snapshot onto rows and keeps the real counts", () => {
    const gate = REAL_ROWS.find((r) => r.id === "lists/permissions/admin")!;
    expect(gate).toMatchObject({ proven: 23, scenarios: 23, anchors: 5, kind: "feature" });
    expect(MANY_ROWS).toHaveLength(4812);
    expect(summaryOf(REAL_ROWS).total).toBe(REAL_ROWS.length);
    expect(summaryOf([]).provenPct).toBeNull();
    expect(() => featureById("no/such/record")).toThrow("no record");
  });

  it("agrees with the headline figures every screen shows", () => {
    const s = summaryOf(REAL_ROWS);
    expect(s).toMatchObject({
      total: SUMMARY.records,
      provenPct: SUMMARY.provenPct,
      drift: SUMMARY.driftRecords,
      domains: SUMMARY.domains,
      assumptions: SUMMARY.records - SUMMARY.features,
      knowledgeOpen: SUMMARY.knowledgeOpen,
    });
  });

  it("treats an assumption as a type, never as a domain", () => {
    const facets = facetsFor(REAL_ROWS, { kind: "assumption" });
    expect(facets.find((f) => f.key === "kind:assumption")).toMatchObject({
      label: "Assumption",
      count: 1,
      active: true,
    });
    expect(facets.some((f) => f.key === "domain:assumption")).toBe(false);
    expect(applyFilters(REAL_ROWS, { kind: "assumption" }).map((r) => r.id)).toEqual([
      "assumption/sync/push-optin-rate",
    ]);
    expect(filterChips({ kind: "assumption" })[0].label).toBe("Art: Assumption");
    expect(fieldGroups(REAL_ROWS, "").find((g) => g.kind === "assumption")?.capability).toBe(
      "sync",
    );
    expect(distributionsFor(REAL_ROWS)[0].parts.map((p) => p.key)).toContain("Assumption");
  });

  it("lays the dependency network out in layers below each need", () => {
    const g = networkOf(REAL_ROWS, "column");
    const depth = new Map(g.nodes.map((n) => [n.id, n.depth]));
    // Only edges inside a dependency cycle may point the other way.
    const backwards = g.edges.filter(([from, to]) => depth.get(from)! <= depth.get(to)!);
    expect(backwards.length / g.edges.length).toBeLessThan(0.05);
    expect(g.nodes.find((n) => n.id === "workspace/board/column")?.match).toBe(true);
  });

  it("takes test counts and the raw record from the record file", () => {
    const adr = recordOf("workspace/board/column");
    expect(adr.testKinds).toEqual({
      Unit: TEST_COUNTS["workspace/board/column"].Unit,
      Integration: 2,
    });
    expect(adr.testCount).toBe(TEST_COUNTS["workspace/board/column"].Unit + 2);
    expect(recordOf("lists/permissions/admin").yaml).toBe(ADMIN_RECORD_YAML);
    expect(recordOf("assumption/sync/push-optin-rate").testCount).toBe(0);
  });

  it("filters, searches, sorts and groups", () => {
    const nav = applyFilters(REAL_ROWS, { domain: "workspace", drift: true, lifecycle: "active" });
    expect(nav.every((r) => r.domain === "workspace" && r.drift > 0)).toBe(true);
    expect(search(REAL_ROWS, "admin").map((r) => r.slug)).toContain("admin");
    expect(search(REAL_ROWS, " ")).toHaveLength(REAL_ROWS.length);
    expect(sortRows(REAL_ROWS, "anchors", "desc")[0].anchors).toBeGreaterThanOrEqual(
      sortRows(REAL_ROWS, "anchors", "asc")[0].anchors,
    );
    expect(
      sortRows(REAL_ROWS, "slug", "asc")[0].slug <= sortRows(REAL_ROWS, "slug", "desc")[0].slug,
    ).toBe(true);
    expect(
      facetsFor(REAL_ROWS, { lifecycle: "planned" }).find((f) => f.key === "lc:planned")?.active,
    ).toBe(true);
    expect(
      filterChips({ domain: "notes", lifecycle: "deprecated", drift: true }).map((c) => c.label),
    ).toEqual(["Area: notes", "Lifecycle: deprecated", "with drift"]);
    expect(filterChips({ lifecycle: "planned" })[0].label).toBe("Lifecycle: planned");
    expect(filterChips({ lifecycle: "active" })[0].label).toBe("Lifecycle: active");
    const groups = fieldGroups(REAL_ROWS, "plugin");
    expect(groups.flatMap((g) => g.tiles).filter((t) => t.match).length).toBe(
      search(REAL_ROWS, "plugin").length,
    );
    const m = matrixRows(REAL_ROWS);
    expect(m.reduce((a, r) => a + r.active + r.planned + r.deprecated, 0)).toBe(SUMMARY.features);
    expect(m.some((r) => r.domain === "assumption")).toBe(false);
    expect(distributionsFor(REAL_ROWS).map((d) => d.label)).toEqual(["By area", "By lifecycle"]);
  });

  it("builds a record with dependents, drift dates and the yaml shape", () => {
    const d = recordOf("workspace/board/column");
    expect(d.dependents.map((x) => x.id)).toContain("workspace/board/card");
    expect(d.drift[0].path).toBe("packages/task/import.go");
    expect(d.log).toHaveLength(4);
    expect(recordOf("workspace/board/column", { allLog: true }).log?.length).toBe(
      featureById("workspace/board/column").log.length,
    );
    expect(d.yaml).toMatch(/^schema_version/);
    expect(JSON.parse(d.json).id).toBe(d.id);
    const ri = recordOf("delivery/ci/cache");
    expect(ri.scenarios.filter((s) => s.proven)).toHaveLength(2);
    const assumption = featureById("assumption/sync/push-optin-rate");
    expect(recordYaml(assumption)).toContain("# unanswered");
    expect(siblingsOf("workspace/board/column").capabilities.map((c) => c.id)).toContain(
      "assistant",
    );
    expect(anchorsIn("packages/board/store.go").map((a) => a.recordId)).toContain(
      "lists/permissions/admin",
    );
    expect(ruleAppliesTo("permissions").every((r) => r.holds)).toBe(true);
    expect(termOf("Drift").term).toBe("Drift");
    expect(termOf("unknown").term).toBeTruthy();
  });
});

/** Records page ------------------------------------------------------------- */

function recordsProps(over: Partial<RecordsPageProps> = {}): RecordsPageProps {
  const rows = REAL_ROWS;
  return {
    state: "ready",
    summary: summaryOf(rows),
    matched: rows.length,
    query: "",
    view: "list",
    facets: facetsFor(rows, {}),
    rows: rows.slice(0, 25),
    page: 1,
    pageSize: 25,
    sort: { key: "changedAt", dir: "desc" },
    field: fieldGroups(rows, ""),
    matrix: matrixRows(rows),
    ...over,
  };
}

describe("RecordsPage", () => {
  it("renders 1287 of 1293 as 99 percent in the Records header", () => {
    const boundaryRows = [{ ...REAL_ROWS[0], scenarios: 1293, proven: 1287 }];
    render(
      <RecordsPage
        {...recordsProps({
          rows: boundaryRows,
          summary: summaryOf(boundaryRows),
        })}
      />,
    );
    const header = screen.getByTestId("records-total").closest("header")!;
    expect(header).toHaveTextContent("99%");
    expect(header).not.toHaveTextContent("100%");
  });

  it("opens with the count and the proven share, and opens a record from the list", () => {
    const onOpen = jest.fn();
    render(<RecordsPage {...recordsProps({ onOpen })} />);
    expect(screen.getByTestId("records-total")).toHaveTextContent(String(REAL_ROWS.length));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "a test names 96% of their promises",
    );
    const list = screen.getByRole("list", { name: "Records" });
    const first = within(list).getAllByRole("listitem")[0];
    fireEvent.click(within(first).getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(REAL_ROWS[0].id);
    expect(screen.getByRole("navigation", { name: "Pages" })).toBeInTheDocument();
  });

  it("switches views, toggles facets and reports search input", () => {
    const onView = jest.fn();
    const onFacet = jest.fn();
    const onQuery = jest.fn();
    render(<RecordsPage {...recordsProps({ onView, onFacet, onQuery })} />);
    fireEvent.click(screen.getByRole("radio", { name: /Slot matrix/ }));
    expect(onView).toHaveBeenCalledWith("matrix");
    fireEvent.click(screen.getByRole("button", { name: /planned/ }));
    expect(onFacet).toHaveBeenCalledWith("lc:planned");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search records" }), {
      target: { value: "gate" },
    });
    expect(onQuery).toHaveBeenCalledWith("gate");
  });

  it("sharpens matching tiles in the field and orders hit groups first", () => {
    const onOpen = jest.fn();
    const onCell = jest.fn();
    render(
      <RecordsPage
        {...recordsProps({
          view: "field",
          query: "admin",
          field: fieldGroups(REAL_ROWS, "admin"),
          onOpen,
          onCell,
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/1 hits in 1 capabilities for “admin”/);
    const groups = screen.getAllByRole("region");
    expect(groups[0]).toHaveAccessibleName("lists / permissions");
    const tile = within(groups[0]).getByTitle(/lists\/permissions\/admin ·/);
    fireEvent.click(tile);
    expect(onOpen).toHaveBeenCalledWith("lists/permissions/admin");
    fireEvent.click(within(groups[0]).getByRole("button", { name: /permissions/ }));
    expect(onCell).toHaveBeenCalledWith("lists", "permissions");
  });

  it("renders the matrix with clickable cells, and a card form on a phone", () => {
    const onCell = jest.fn();
    const { rerender } = render(<RecordsPage {...recordsProps({ view: "matrix", onCell })} />);
    const table = screen.getByRole("table", { name: "Matrix capability × lifecycle" });
    fireEvent.click(within(table).getByRole("button", { name: /lists\/permissions: \d+ active/ }));
    expect(onCell).toHaveBeenCalledWith("lists", "permissions", "active");
    expect(
      within(table).getByRole("button", { name: "lists/permissions: 0 planned" }),
    ).toBeDisabled();
    rerender(<RecordsPage {...recordsProps({ view: "matrix", mobile: true, onCell })} />);
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /sharing/ }));
    expect(onCell).toHaveBeenLastCalledWith("lists", "sharing");
  });

  it("sorts the table by its header and pages", () => {
    const onSort = jest.fn();
    const onPage = jest.fn();
    const many = MANY_ROWS.slice(0, 500);
    render(
      <RecordsPage
        {...recordsProps({ view: "table", rows: many.slice(0, 25), matched: 500, onSort, onPage })}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Changed/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    fireEvent.click(screen.getByRole("button", { name: /Anchors/ }));
    expect(onSort).toHaveBeenCalledWith("anchors");
    fireEvent.click(screen.getByRole("button", { name: "Page 20" }));
    expect(onPage).toHaveBeenCalledWith(20);
    fireEvent.click(screen.getByRole("button", { name: /Sorted: Changed/ }));
    expect(onSort).toHaveBeenLastCalledWith("changedAt");
  });

  it("shows active filters as removable chips and a distribution band that filters", () => {
    const onRemoveFilter = jest.fn();
    const onDistribution = jest.fn();
    render(
      <RecordsPage
        {...recordsProps({
          filters: [{ key: "domain", label: "Area: workspace" }],
          distributions: distributionsFor(MANY_ROWS),
          onRemoveFilter,
          onDistribution,
        })}
      />,
    );
    const chips = screen.getByRole("group", { name: "Active filters" });
    fireEvent.click(within(chips).getByRole("button", { name: "Remove" }));
    expect(onRemoveFilter).toHaveBeenCalledWith("domain");
    fireEvent.click(screen.getByRole("button", { name: /^active: / }));
    expect(onDistribution).toHaveBeenCalledWith("By lifecycle", "active");
  });

  it("offers the nearest records when nothing matches", () => {
    const onReset = jest.fn();
    const onOpen = jest.fn();
    render(
      <RecordsPage
        {...recordsProps({
          state: "filtered-empty",
          query: "kommitt",
          matched: 0,
          suggestions: REAL_ROWS.slice(0, 2),
          onReset,
          onOpen,
        })}
      />,
    );
    expect(screen.getByText("No matches for “kommitt”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(onReset).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: REAL_ROWS[1].id }));
    expect(onOpen).toHaveBeenCalledWith(REAL_ROWS[1].id);
  });

  it("shows dashes, not zeros, while loading — in list and in field form", () => {
    const blank = {
      total: null,
      provenPct: null,
      drift: null,
      knowledgeOpen: null,
      domains: null,
      assumptions: null,
    };
    const { rerender } = render(
      <RecordsPage {...recordsProps({ state: "loading", summary: blank })} />,
    );
    expect(screen.getByTestId("records-total")).toHaveTextContent("—");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Reading records");
    rerender(
      <RecordsPage {...recordsProps({ state: "loading", summary: blank, view: "field" })} />,
    );
    expect(screen.getByTestId("records-page").querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("names the empty register and the error with a retry", () => {
    const onRetry = jest.fn();
    const { rerender } = render(
      <RecordsPage
        {...recordsProps({ state: "empty", summary: { ...summaryOf([]), total: 0 } })}
      />,
    );
    expect(screen.getByText("No record yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "No record in the registry yet.",
    );
    rerender(<RecordsPage {...recordsProps({ state: "error", onRetry })} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("names assumptions as such in the list and beside the matrix", () => {
    const { rerender } = render(
      <RecordsPage {...recordsProps({ rows: applyFilters(REAL_ROWS, { kind: "assumption" }) })} />,
    );
    expect(screen.getByRole("list", { name: "Records" })).toHaveTextContent("Assumption · sync");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("5 areas + 1 assumption");
    rerender(<RecordsPage {...recordsProps({ view: "matrix" })} />);
    expect(screen.getByTestId("matrix-assumptions")).toHaveTextContent(
      "+ 1 assumption outside the taxonomy",
    );
    rerender(<RecordsPage {...recordsProps({ view: "field" })} />);
    expect(screen.getByRole("region", { name: "Assumptions / sync" })).toBeInTheDocument();
  });

  it("draws the dependency network and opens a node", () => {
    const onOpen = jest.fn();
    render(
      <RecordsPage
        {...recordsProps({
          view: "network",
          query: "column",
          network: networkOf(REAL_ROWS, "column"),
          onOpen,
        })}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Dependency network of the records" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("column", { selector: "text" }).closest("a")!);
    expect(onOpen).toHaveBeenCalledWith("workspace/board/column");
  });

  it("lists the network as needs per record on a phone, filtered by the search", () => {
    const onOpen = jest.fn();
    const g = networkOf(REAL_ROWS, "column");
    render(<DependencyNetwork graph={g} query="column" mobile onOpen={onOpen} />);
    const list = screen.getByRole("list", { name: "Dependencies" });
    fireEvent.click(within(list).getAllByRole("button", { name: "workspace/board/column" })[0]);
    expect(onOpen).toHaveBeenCalledWith("workspace/board/column");
    fireEvent.click(
      within(list).getAllByRole("button", { name: "workspace/board/progress-group" })[0],
    );
    expect(onOpen).toHaveBeenLastCalledWith("workspace/board/progress-group");
    const { container } = render(<DependencyNetwork graph={{ nodes: [], edges: [] }} query="" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("marks the query inside text", () => {
    const { container } = render(<Hit text="plugin-host plugin" query="Plugin" />);
    expect(container.querySelectorAll("mark")).toHaveLength(2);
  });
});

/** Record ------------------------------------------------------------------ */

function recordProps(
  record: RecordDetails,
  over: Partial<RecordDetailsPageProps> = {},
): RecordDetailsPageProps {
  return {
    state: "ready",
    record,
    siblings: siblingsOf(record.id),
    tab: "record",
    now: "2026-11",
    ...over,
  };
}

describe("English source text", () => {
  it("renders the records page in English without a provider", () => {
    renderInEnglish(<RecordsPage {...recordsProps({})} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "a test names 96% of their promises",
    );
    expect(screen.getByRole("searchbox", { name: "Search records" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Focus map/ })).toBeInTheDocument();
    expect(screen.getByText("With drift")).toBeInTheDocument();
    expect(screen.queryByText(germanLabel("With drift"))).not.toBeInTheDocument();
  });

  it("renders the record page in English without a provider", () => {
    const adr = recordOf("workspace/board/column");
    renderInEnglish(<RecordDetailsPage {...recordProps(adr)} />);
    expect(screen.getByRole("heading", { level: 2, name: "Promises" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Drift" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Record" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("1 file changed");
    expect(screen.getAllByText("Given").length).toBeGreaterThan(0);
    expect(screen.queryByText(germanLabel("Given"))).not.toBeInTheDocument();
  });

  it("names rule severity and term status in English", () => {
    const { unmount } = renderInEnglish(
      <RuleSheet {...RULE_ANCHORED} appliesTo={[]} severity="warning" open />,
    );
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Every affected record holds the rule.")).toBeInTheDocument();
    unmount();
    renderInEnglish(<TermSheet {...termOf("")} records={[]} status="proposed" open />);
    expect(screen.getByText("proposed")).toBeInTheDocument();
    expect(screen.getByText("Related terms")).toBeInTheDocument();
  });
});

describe("RecordDetailsPage", () => {
  const adr = recordOf("workspace/board/column");

  it("shows the head, figures and every section of a record", () => {
    render(<RecordDetailsPage {...recordProps(adr)} />);
    expect(screen.getByRole("heading", { level: 1, name: "column" })).toBeInTheDocument();
    expect(screen.getByTestId("figure-shield")).toHaveTextContent("19 / 19");
    for (const s of [
      "promises",
      "code",
      "knowledge",
      "drift",
      "history",
      "relations",
      "operations",
      "rules",
    ]) {
      expect(screen.getByTestId(`section-${s}`)).toBeInTheDocument();
    }
    expect(
      within(
        screen.getByTestId("scenario-the-request-is-refused-with-a-clear-message"),
      ).getAllByRole("listitem"),
    ).toHaveLength(3);
    expect(screen.getByRole("note")).toHaveTextContent("1 file changed");
    expect(
      screen.getByRole("img", { name: "Dependencies of workspace/board/column" }),
    ).toBeInTheDocument();
  });

  it("makes every path segment a place and opens siblings", () => {
    const onNavigate = jest.fn();
    const onToggleSiblings = jest.fn();
    const { rerender } = render(
      <RecordDetailsPage {...recordProps(adr, { onNavigate, onToggleSiblings })} />,
    );
    const path = screen.getByRole("navigation", { name: "Path" });
    fireEvent.click(within(path).getByRole("button", { name: "Product" }));
    fireEvent.click(within(path).getByRole("button", { name: "workspace" }));
    fireEvent.click(within(path).getByRole("button", { name: "board" }));
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual([
      { kind: "product", id: "" },
      { kind: "domain", id: "workspace" },
      { kind: "capability", id: "workspace/board" },
    ]);
    fireEvent.click(within(path).getAllByRole("button", { name: "Show siblings" })[1]);
    expect(onToggleSiblings).toHaveBeenCalledWith("capability");
    rerender(
      <RecordDetailsPage {...recordProps(adr, { onNavigate, siblingsOpen: "capability" })} />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /^assistant/ }));
    expect(onNavigate).toHaveBeenLastCalledWith({ kind: "capability", id: "workspace/assistant" });
  });

  it("reports interactions on scenarios, anchors, knowledge, log and relations", () => {
    const h = {
      onOpenTest: jest.fn(),
      onOpenAnchor: jest.fn(),
      onMore: jest.fn(),
      onOpenCommit: jest.fn(),
      onNavigate: jest.fn(),
      onSection: jest.fn(),
      onScenarioFilter: jest.fn(),
      onCopy: jest.fn(),
      onTab: jest.fn(),
      onOpenDrift: jest.fn(),
      onAsk: jest.fn(),
    };
    render(<RecordDetailsPage {...recordProps(adr, h)} />);
    fireEvent.click(
      within(
        screen.getByTestId("scenario-the-request-is-refused-with-a-clear-message"),
      ).getAllByRole("button")[0],
    );
    expect(h.onOpenTest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "Unit",
        file: "plugins/InviteAnswer.spec.tsx",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /ActivityLayout\.tsx :14/ }));
    expect(h.onOpenAnchor).toHaveBeenCalledWith({
      path: "plugins/adr/src/ActivityLayout.tsx",
      line: 14,
      role: "primary",
    });
    fireEvent.click(screen.getByRole("button", { name: "Show all 19" }));
    fireEvent.click(screen.getByRole("button", { name: "Show all 22" }));
    fireEvent.click(screen.getByRole("button", { name: "Show the whole history" }));
    expect(h.onMore.mock.calls.map((c) => c[0])).toEqual(["scenarios", "anchors", "log"]);
    fireEvent.click(screen.getByRole("button", { name: "05cec40d" }));
    expect(h.onOpenCommit).toHaveBeenCalledWith("05cec40d");
    fireEvent.click(screen.getAllByRole("button", { name: "workspace/board/theme-check" })[0]);
    expect(h.onNavigate).toHaveBeenCalledWith({
      kind: "record",
      id: "workspace/board/theme-check",
    });
    fireEvent.click(screen.getByRole("link", { name: "workspace/board/progress-group" }));
    expect(h.onNavigate).toHaveBeenLastCalledWith({
      kind: "record",
      id: "workspace/board/progress-group",
    });
    fireEvent.click(screen.getByRole("link", { name: /Knowledge/ }));
    expect(h.onSection).toHaveBeenCalledWith("knowledge");
    fireEvent.click(screen.getByRole("button", { name: "Go to drift" }));
    expect(h.onSection).toHaveBeenLastCalledWith("drift");
    fireEvent.click(screen.getByRole("radio", { name: /open/ }));
    expect(h.onScenarioFilter).toHaveBeenCalledWith("open");
    fireEvent.click(screen.getByRole("button", { name: "Copy id" }));
    expect(h.onCopy).toHaveBeenCalledWith("id");
    fireEvent.click(screen.getByRole("button", { name: "View record" }));
    expect(h.onTab).toHaveBeenCalledWith("raw");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(h.onOpenDrift).toHaveBeenCalledWith("packages/task/import.go");
    fireEvent.click(screen.getByRole("button", { name: "Ask Atlas" }));
    expect(h.onAsk).toHaveBeenCalled();
  });

  it("marks an open scenario and filters to open and proven", () => {
    const ri = recordOf("delivery/ci/cache");
    const { rerender } = render(
      <RecordDetailsPage {...recordProps(ri, { scenarioFilter: "open" })} />,
    );
    expect(screen.getAllByText("No test names this promise.")).toHaveLength(4);
    expect(screen.queryByText("proven", { selector: ".t-badge" })).toBeNull();
    rerender(<RecordDetailsPage {...recordProps(ri, { scenarioFilter: "proven" })} />);
    expect(screen.queryByText("No test names this promise.")).toBeNull();
    rerender(
      <RecordDetailsPage
        {...recordProps(
          { ...ri, scenarios: ri.scenarios.filter((s) => !s.proven) },
          { scenarioFilter: "proven" },
        )}
      />,
    );
    expect(screen.getByText("No promise in this selection.")).toBeInTheDocument();
  });

  it("asks for open knowledge answers", () => {
    const onAnswer = jest.fn();
    render(<RecordDetailsPage {...recordProps(recordOf("workspace/board/card"), { onAnswer })} />);
    expect(screen.getByTestId("figure-bulb")).toHaveTextContent("0 / 5");
    fireEvent.click(
      within(screen.getByTestId("slot-not_for")).getByRole("button", {
        name: "Propose an answer",
      }),
    );
    expect(onAnswer).toHaveBeenCalledWith("not_for");
  });

  it("shows each sibling's proven share in the path menu", () => {
    render(<RecordDetailsPage {...recordProps(adr, { siblingsOpen: "record" })} />);
    const item = screen.getByRole("menuitem", { name: /^card(?!-)/ });
    expect(item).toHaveTextContent(/promises named by a test/);
    expect(item).toHaveTextContent(/%|—/);
  });

  it("puts an assumption under Assumptions, not under a domain", () => {
    const onNavigate = jest.fn();
    const a = recordOf("assumption/sync/push-optin-rate");
    render(<RecordDetailsPage {...recordProps(a, { onNavigate })} />);
    const path = screen.getByRole("navigation", { name: "Path" });
    expect(within(path).queryByText("assumption")).toBeNull();
    fireEvent.click(within(path).getByRole("button", { name: "Assumptions" }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "records", id: "kind:assumption" });
    fireEvent.click(within(path).getByRole("button", { name: "Records" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ kind: "records", id: "" });
  });

  it("explains a planned record without an anchor and offers the anchor to copy", () => {
    const onCopy = jest.fn();
    const planned = {
      ...recordOf("workspace/assistant/summary-restore"),
      anchors: [],
      anchorCount: 0,
    };
    render(<RecordDetailsPage {...recordProps(planned, { onCopy })} />);
    expect(screen.getByRole("note")).toHaveTextContent("No anchor in the code yet");
    expect(screen.getByRole("region", { name: "Anchor to insert" })).toHaveTextContent(
      `${TAG}: workspace/assistant/summary-restore`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy anchor" }));
    expect(onCopy).toHaveBeenCalledWith("anchor");
  });

  it("says a planned record already carries anchors when it does", () => {
    render(<RecordDetailsPage {...recordProps(recordOf("workspace/assistant/summary-restore"))} />);
    expect(screen.getByRole("note")).toHaveTextContent("Already carries anchors");
  });

  it("treats an assumption as a claim without proof, anchor or summary", () => {
    render(<RecordDetailsPage {...recordProps(recordOf("assumption/sync/push-optin-rate"))} />);
    expect(screen.getByRole("note")).toHaveTextContent("Assumption.");
    expect(screen.getByText("An assumption makes no promises.")).toBeInTheDocument();
    expect(screen.getByText("not expected for assumptions")).toBeInTheDocument();
    expect(screen.getByTestId("figure-shield")).toHaveTextContent("not measured");
    expect(screen.getByText("No summary in the record.")).toBeInTheDocument();
  });

  it("warns that a deprecated record is retired and points to its capability", () => {
    const onNavigate = jest.fn();
    render(
      <RecordDetailsPage
        {...recordProps(recordOf("delivery/releases/mirror-sort"), { onNavigate })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Find successor" }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "capability", id: "delivery/releases" });
  });

  it("names a record without tests and a scenario-less feature", () => {
    const sl = recordOf("lists/sharing/comment-archive");
    const { rerender } = render(<RecordDetailsPage {...recordProps(sl)} />);
    expect(screen.getByTestId("figure-flask")).toHaveTextContent("none linked");
    rerender(
      <RecordDetailsPage
        {...recordProps({ ...sl, scenarios: [], scenarioCount: 0, provenCount: 0 })}
      />,
    );
    expect(screen.getByText("The record names no scenario yet.")).toBeInTheDocument();
  });

  it("shows observation, rules and opens a rule", () => {
    const onOpenRule = jest.fn();
    const r = {
      ...recordOf("workspace/search/ranking"),
      rules: [{ id: RULE_ANCHORED.id, title: RULE_ANCHORED.title, states: "" }],
    };
    render(<RecordDetailsPage {...recordProps(r, { onOpenRule })} />);
    expect(screen.getByText("observed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(RULE_ANCHORED.title) }));
    expect(onOpenRule).toHaveBeenCalledWith(RULE_ANCHORED.id);
    expect(screen.getByText(/No drift/)).toBeInTheDocument();
  });

  it("lists the assumptions and data shapes beside the rules, each under its label, and names one the registry does not hold", () => {
    const onOpenRule = jest.fn();
    const r = {
      ...recordOf("workspace/search/ranking"),
      rules: [{ id: RULE_ANCHORED.id, title: RULE_ANCHORED.title, states: "" }],
      assumptions: [{ id: "assumption/sync/clock-skew", title: "Clock skew bounded", states: "" }],
      dataShapes: [
        { id: "data/tasks/task-item", title: "Task item", states: "" },
        { id: "data/gone/shape", title: "data/gone/shape", states: "", missing: true },
      ],
    };
    render(<RecordDetailsPage {...recordProps(r, { onOpenRule })} />);
    const section = screen.getByTestId("section-rules");
    // Three kinds stand side by side, so each is labelled with its count.
    expect(within(section).getByText("Rule records")).toBeInTheDocument();
    expect(within(section).getByText("Assumptions")).toBeInTheDocument();
    expect(within(section).getByText("Data shapes")).toBeInTheDocument();
    const assumptions = within(section).getByTestId("references-assumptions");
    fireEvent.click(within(assumptions).getByRole("button", { name: /Clock skew bounded/ }));
    expect(onOpenRule).toHaveBeenLastCalledWith("assumption/sync/clock-skew");
    const shapes = within(section).getByTestId("references-data-shapes");
    fireEvent.click(within(shapes).getByRole("button", { name: /Task item/ }));
    expect(onOpenRule).toHaveBeenLastCalledWith("data/tasks/task-item");
    // The id the registry does not hold is a row with its reason, never a button.
    const rows = within(shapes).getAllByTestId("reference-row");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveAttribute("data-missing", "true");
    expect(rows[1]).toHaveTextContent("data/gone/shape");
    expect(rows[1]).toHaveTextContent("not in this registry");
    expect(within(rows[1]).queryByRole("button")).toBeNull();
    // Every listed item counts in the section's figure.
    expect(within(section).getAllByText("4").length).toBeGreaterThan(0);
  });

  it("says the record names none of the three when it lists the kinds and they are empty", () => {
    const r = {
      ...recordOf("workspace/search/ranking"),
      rules: [],
      assumptions: [],
      dataShapes: [],
    };
    render(<RecordDetailsPage {...recordProps(r)} />);
    expect(
      within(screen.getByTestId("section-rules")).getByText(
        "This record names no rule, no assumption and no data shape.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("references-assumptions")).toBeNull();
  });

  it("shows the raw record as yaml or json and copies it", () => {
    const onRawFormat = jest.fn();
    const onCopy = jest.fn();
    const gate = recordOf("lists/permissions/admin");
    const { rerender } = render(
      <RecordDetailsPage {...recordProps(gate, { tab: "raw", onRawFormat, onCopy })} />,
    );
    expect(screen.getByRole("region", { name: "Record as YAML" })).toHaveTextContent(
      "id: lists/permissions/admin",
    );
    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));
    expect(onRawFormat).toHaveBeenCalledWith("json");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(onCopy).toHaveBeenCalledWith("raw");
    rerender(<RecordDetailsPage {...recordProps(gate, { tab: "raw", rawFormat: "json" })} />);
    expect(screen.getByRole("region", { name: "Record as JSON" })).toHaveTextContent(
      '"lifecycle": "active"',
    );
  });

  it("folds sections on a phone and indexes them as chips", () => {
    const onToggleSection = jest.fn();
    const onSection = jest.fn();
    render(
      <RecordDetailsPage
        {...recordProps(adr, {
          mobile: true,
          collapsed: ["code"],
          section: "knowledge",
          onToggleSection,
          onSection,
        })}
      />,
    );
    const code = screen.getByRole("button", { name: "Code" });
    expect(code).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(code);
    expect(onToggleSection).toHaveBeenCalledWith("code");
    const chips = screen.getByRole("navigation", { name: "Sections" });
    expect(within(chips).getByRole("button", { name: /Knowledge/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(chips).getByRole("button", { name: /History/ }));
    expect(onSection).toHaveBeenCalledWith("history");
    expect(screen.queryByRole("img", { name: /Dependencies/ })).toBeNull();
  });

  it("says when a record does not exist and offers near ids", () => {
    const onNavigate = jest.fn();
    render(
      <RecordDetailsPage
        state="not-found"
        tab="record"
        missingId="workspace/board/columns"
        nearest={["workspace/board/column"]}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId("record-not-found")).toHaveTextContent(
      "No record workspace/board/columns",
    );
    fireEvent.click(screen.getByRole("button", { name: "workspace/board/column" }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "record", id: "workspace/board/column" });
    fireEvent.click(screen.getByRole("button", { name: "Search in records" }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      kind: "records",
      id: "workspace/board/columns",
    });
  });
});

/** Sheets ------------------------------------------------------------------- */

describe("sheets", () => {
  it("shows the anchor's source with its line marked and the file's other anchors", () => {
    const onOpenRecord = jest.fn();
    const onClose = jest.fn();
    render(
      <AnchorSheet
        open
        recordId="lists/permissions/admin"
        path="packages/board/store.go"
        line={1170}
        anchorRole="primary"
        excerpt={{ ...ADMIN_EXCERPT, lang: "go" }}
        fileAnchors={anchorsIn("packages/board/store.go")}
        lastCommit={featureById("lists/permissions/admin").log[0]}
        onOpenRecord={onOpenRecord}
        onClose={onClose}
      />,
    );
    const sheet = screen.getByRole("dialog", { name: "store.go:1170" });
    expect(within(sheet).getByRole("region", { name: "Source at the anchor" })).toHaveTextContent(
      "func checkAdmin",
    );
    expect(within(sheet).getByText("in sync")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "lists/sharing/guest" }));
    expect(onOpenRecord).toHaveBeenCalledWith("lists/sharing/guest");
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("marks a drifted anchor and renders as a bottom sheet on a phone", () => {
    render(
      <AnchorSheet
        open
        mobile
        drifted
        recordId="x/y/z"
        path="a.go"
        line={1}
        anchorRole="config"
        excerpt={{ firstLine: 1, text: "package a", lang: "text" }}
        fileAnchors={[{ line: 1, role: "config", recordId: "x/y/z" }]}
      />,
    );
    expect(screen.getByText("Drift")).toBeInTheDocument();
    expect(screen.getByTestId("anchor-sheet").closest("section")?.className).toContain(
      "t-sheet--bottom",
    );
  });

  it("lists who breaks a rule and who holds it", () => {
    const onOpenRecord = jest.fn();
    const { rerender } = render(
      <RuleSheet
        open
        {...RULE_ANCHORED}
        appliesTo={[
          { id: "a/b/ok", holds: true },
          { id: "a/b/bad", holds: false },
        ]}
        onOpenRecord={onOpenRecord}
      />,
    );
    expect(screen.getByText("Violated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "a/b/bad" }));
    expect(onOpenRecord).toHaveBeenCalledWith("a/b/bad");
    rerender(
      <RuleSheet
        open
        {...RULE_ANCHORED}
        severity="warning"
        appliesTo={ruleAppliesTo("permissions")}
      />,
    );
    expect(screen.getByText("Every affected record holds the rule.")).toBeInTheDocument();
  });

  it("shows the effective value of a configuration key in all three states", () => {
    const { rerender } = render(
      <ConfigSheet
        open
        {...ADMIN_CONFIG}
        line={null}
        value={null}
        snippet={{ firstLine: 1, text: "permissions:\n  admin_override: off" }}
      />,
    );
    expect(screen.getByText("default, not set")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Entry to insert" })).toBeInTheDocument();
    rerender(
      <ConfigSheet
        open
        {...ADMIN_CONFIG}
        line={5}
        value="off"
        snippet={{ firstLine: 4, text: "permissions:\n  admin_override: off" }}
      />,
    );
    expect(screen.getByText("set in line 5")).toBeInTheDocument();
    rerender(
      <ConfigSheet open {...ADMIN_CONFIG} env={undefined} allowed={[]} line={5} value="of" />,
    );
    expect(screen.queryByText(/invalid/)).toBeNull();
    expect(screen.getByText("any path in the repository")).toBeInTheDocument();
    rerender(<ConfigSheet open mobile {...ADMIN_CONFIG} line={5} value="of" />);
    expect(screen.getByText(/invalid — allowed: on, off/)).toBeInTheDocument();
  });

  it("shows a term with its related terms and records", () => {
    const onTerm = jest.fn();
    const onPropose = jest.fn();
    const t = termOf("Drift");
    const { rerender } = render(
      <TermSheet
        open
        {...t}
        translation="drift"
        records={["a/b/c"]}
        onTerm={onTerm}
        onPropose={onPropose}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Drift" })).toHaveTextContent("EN: drift");
    fireEvent.click(screen.getByRole("button", { name: t.related[0] }));
    expect(onTerm).toHaveBeenCalledWith(t.related[0]);
    fireEvent.click(screen.getByRole("button", { name: "Propose a change" }));
    expect(onPropose).toHaveBeenCalled();
    rerender(
      <TermSheet open mobile {...t} status="proposed" aliases={[]} related={[]} records={[]} />,
    );
    expect(screen.getByText("no synonyms")).toBeInTheDocument();
    expect(screen.getByText("proposed")).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    const { container } = render(<TermSheet open={false} {...termOf("Anchor")} records={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/** Parts -------------------------------------------------------------------- */

describe("parts", () => {
  it("draws a dash for a bar without scenarios and partial proof as open", () => {
    const { container, rerender } = render(<ProofBar proven={0} total={0} />);
    expect(container).toHaveTextContent("—");
    rerender(<ProofBar proven={1} total={3} wide />);
    expect(container.firstElementChild).toHaveAttribute("title", "1 of 3 promises named by a test");
  });

  it("counts commits into months and ignores those outside the window", () => {
    render(
      <CommitSpark
        dates={["2026-11-02", "2026-11-01", "2025-01-01", "2027-01-01"]}
        months={3}
        now="2026-11"
      />,
    );
    expect(
      screen
        .getByRole("img", { name: "Commits per month, last 3 months" })
        .querySelectorAll("rect"),
    ).toHaveLength(3);
  });

  it("highlights yaml keys, json keys and comments", () => {
    const { container, rerender } = render(
      <CodeView label="c" lang="yaml" text={"# note\nkey: v\nplain"} />,
    );
    expect(container.querySelectorAll("code")).toHaveLength(3);
    rerender(<CodeView label="c" lang="json" text={'{\n  "id": 1\n}'} />);
    expect(screen.getByRole("region", { name: "c" })).toHaveTextContent('"id": 1');
    rerender(<CodeView label="c" lang="go" text={"// plain comment\nx := 1"} />);
    expect(screen.getByRole("region", { name: "c" })).toHaveTextContent("x := 1");
  });

  it("says when a record needs nothing and nobody needs it", () => {
    render(<DependencyGraph center="a" upstream={[]} downstream={[]} />);
    expect(screen.getByText("needs nothing")).toBeInTheDocument();
    expect(screen.getByText("nobody depends on it")).toBeInTheDocument();
  });

  it("marks the current rail entry", () => {
    render(
      <SectionRail
        items={[
          { key: "a", label: "A" },
          { key: "b", label: "B", count: 2, tone: "ok" },
        ]}
        current="b"
      />,
    );
    expect(screen.getByRole("link", { name: /B/ })).toHaveAttribute("aria-current", "location");
    fireEvent.click(screen.getByRole("link", { name: "A" }));
  });
});

describe("unread commit history on the record page", () => {
  const adr = recordOf("workspace/board/column");

  it("says the history was not read instead of counting zero commits", () => {
    renderInEnglish(<RecordDetailsPage {...recordProps({ ...adr, logCount: null, log: null })} />);
    expect(screen.getByTestId("record-history-unmeasured")).toHaveTextContent(
      "— · History not read · not measured",
    );
    expect(screen.getByTestId("record-log-unmeasured")).toHaveTextContent("— · History not read");
    expect(screen.queryByText("0 commits")).not.toBeInTheDocument();
    expect(screen.queryByTestId("record-log-empty")).not.toBeInTheDocument();
  });

  it("limits an empty result to the measured commit window", () => {
    renderInEnglish(
      <RecordDetailsPage
        {...recordProps({ ...adr, logCount: 0, log: [], logWindow: 50, logIncomplete: false })}
      />,
    );
    expect(screen.getByTestId("record-log-empty")).toHaveTextContent(
      "No commit touched this record in the last 50 commits.",
    );
    expect(screen.queryByTestId("record-log-unmeasured")).not.toBeInTheDocument();
    expect(screen.getAllByText(/0 commits/).length).toBeGreaterThan(0);
  });

  it("leaves absence unmeasured for an incomplete shallow history", () => {
    renderInEnglish(
      <RecordDetailsPage
        {...recordProps({ ...adr, logCount: 0, log: [], logWindow: 1, logIncomplete: true })}
      />,
    );
    expect(screen.getByTestId("record-log-incomplete")).toHaveTextContent(
      "— · History incomplete · not measured",
    );
    expect(screen.queryByTestId("record-log-empty")).toBeNull();
  });
});
