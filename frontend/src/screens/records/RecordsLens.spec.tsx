import i18n from "@/i18n";
import { germanLabel } from "@/i18n/testing-labels.spec-support";
import { fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { renderInGerman, renderInEnglish } from "../testing";
import {
  RecordsPage,
  type FieldGroup,
  type RecordsPageProps,
  type RecordsView,
} from "./RecordsPage";
import type { RecordDetails } from "./RecordDetailsPage";
import type { LensTab } from "./RecordsLens";
import type { RecordRow } from "./model";

/** A small registry: two capabilities, one dependency between them. ------------------ */

const IDS = [
  "tasks/create/quick-add",
  "tasks/create/templates",
  "tasks/create/recurring",
  "tasks/search/full-text",
  "tasks/search/saved-filters",
];

const record = (id: string): RecordDetails => {
  const [domain, capability, slug] = id.split("/");
  return {
    id,
    kind: "feature",
    domain,
    capability,
    slug,
    summary: `Summary of ${slug}.`,
    lifecycle: "active",
    owner: "core",
    createdAt: null,
    scenarioCount: 2,
    provenCount: 1,
    scenarios: [
      {
        id: `${slug}-works`,
        steps: [
          { kw: "given", text: `a reader on ${slug}` },
          { kw: "then", text: "it works" },
        ],
        proven: true,
        tests: [{ kind: "Unit", file: `src/${slug}.spec.ts`, name: "it works" }],
      },
      {
        id: `${slug}-fails-well`,
        steps: [{ kw: "then", text: "it fails well" }],
        proven: false,
        tests: [],
      },
    ],
    testCount: 1,
    testKinds: { Unit: 1 },
    anchorCount: 1,
    anchors: [],
    knowledge: [
      { key: "prerequisite_knowledge", answer: `Know ${slug}.` },
      { key: "discoverability", answer: null },
      { key: "success_signal", answer: null },
      { key: "not_for", answer: null },
      { key: "common_pitfalls", answer: null },
    ],
    logCount: null,
    log: null,
    // quick-add needs full-text; templates needs quick-add.
    dependsOn: id === IDS[0] ? [{ id: IDS[3] }] : id === IDS[1] ? [{ id: IDS[0] }] : [],
    dependents: id === IDS[0] ? [{ id: IDS[1] }] : id === IDS[3] ? [{ id: IDS[0] }] : [],
    variants: [],
    drift: [],
    observed: null,
    rules: [],
    tickets: [],
    yaml: "",
    json: "",
  };
};

const row = (id: string): RecordRow => {
  const d = record(id);
  return {
    id,
    slug: d.slug,
    domain: d.domain,
    capability: d.capability,
    kind: "feature",
    lifecycle: "active",
    owner: "core",
    summary: d.summary,
    scenarios: 2,
    proven: id === IDS[2] ? 2 : 1,
    anchors: 1,
    drift: 0,
    knowledgeOpen: 4,
    changedAt: null,
  };
};

const groupsFor = (query: string): FieldGroup[] => {
  const by = new Map<string, FieldGroup>();
  for (const id of IDS) {
    const r = row(id);
    const key = `${r.domain}/${r.capability}`;
    if (!by.has(key)) by.set(key, { domain: r.domain, capability: r.capability, tiles: [] });
    by.get(key)!.tiles.push({
      id,
      slug: r.slug,
      lifecycle: r.lifecycle,
      scenarios: r.scenarios,
      proven: r.proven,
      drift: 0,
      match: !query || id.includes(query),
    });
  }
  return [...by.values()];
};

/** The page with its state held the way a container holds it. */
function Lens({ mobile, initialView = "lens" }: { mobile?: boolean; initialView?: RecordsView }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<RecordsView>(initialView);
  const [focus, setFocus] = useState(IDS[0]);
  const [tab, setTab] = useState<LensTab>("promises");
  const [open, setOpen] = useState(0);
  const rows = IDS.map(row).filter((r) => !query || r.id.includes(query));
  const props: RecordsPageProps = {
    state: "ready",
    mobile,
    summary: {
      total: IDS.length,
      provenPct: 60,
      drift: 0,
      knowledgeOpen: 20,
      domains: 1,
      assumptions: 0,
    },
    matched: rows.length,
    query,
    view,
    facets: [],
    rows,
    page: 1,
    pageSize: 25,
    distributions: [{ label: "By area", parts: [{ key: "tasks", label: "tasks", value: 5 }] }],
    field: groupsFor(query),
    lens: { focus: record(focus), hits: query ? rows : [], tab, open },
    onQuery: setQuery,
    onView: setView,
    onFocus: (id) => {
      setFocus(id);
      setOpen(0);
    },
    onLensTab: setTab,
    onLensUnfold: setOpen,
  };
  return <RecordsPage {...props} />;
}

const dot = (id: string) =>
  screen.getAllByTestId("lens-dot").find((d) => d.getAttribute("data-lens-id") === id)!;
const focusName = () => screen.getByTestId("lens-focus-name").textContent;

describe("RecordsLens", () => {
  it("draws every record as a dot in its capability, the focus sharp and its neighbours marked", () => {
    renderInEnglish(<Lens />);
    expect(screen.getAllByTestId("lens-dot")).toHaveLength(IDS.length);
    expect(screen.getByRole("group", { name: "tasks / create" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "tasks / search" })).toBeInTheDocument();
    expect(dot(IDS[0])).toHaveAttribute("data-state", "focus");
    expect(dot(IDS[0])).toHaveAttribute("aria-pressed", "true");
    // Both directions of the registry relation are neighbours; the rest is not.
    expect(dot(IDS[1])).toHaveAttribute("data-state", "neighbour");
    expect(dot(IDS[3])).toHaveAttribute("data-state", "neighbour");
    expect(dot(IDS[1])).toHaveAccessibleName("tasks/create/templates · 1/2 test named · neighbour");
    expect(dot(IDS[2])).toHaveAttribute("data-state", "plain");
    expect(focusName()).toBe("quick-add");
    // The whole field is one tab stop.
    expect(screen.getAllByTestId("lens-dot").filter((d) => d.tabIndex === 0)).toEqual([
      dot(IDS[0]),
    ]);
  });

  it("is the page's first view and leaves the distribution band to the others", () => {
    renderInEnglish(<Lens />);
    const views = screen.getAllByRole("radio");
    expect(views[0]).toHaveAccessibleName(/Lens/);
    expect(views[0]).toBeChecked();
    expect(screen.queryByText("By area")).not.toBeInTheDocument();
  });

  it("keeps the list one click away", () => {
    renderInEnglish(<Lens />);
    fireEvent.click(screen.getByRole("radio", { name: /List/ }));
    expect(screen.queryByTestId("records-lens")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Records" })).toBeInTheDocument();
  });

  it("puts a clicked dot into focus", () => {
    renderInEnglish(<Lens />);
    fireEvent.click(dot(IDS[4]));
    expect(focusName()).toBe("saved-filters");
    expect(dot(IDS[4])).toHaveAttribute("aria-pressed", "true");
    expect(dot(IDS[0])).toHaveAttribute("aria-pressed", "false");
  });

  it("walks the field with the arrow keys, Home, End and Page Down", () => {
    renderInEnglish(<Lens />);
    dot(IDS[0]).focus();
    fireEvent.keyDown(dot(IDS[0]), { key: "ArrowRight" });
    expect(focusName()).toBe("templates");
    expect(document.activeElement).toBe(dot(IDS[1]));
    expect(dot(IDS[1]).tabIndex).toBe(0);
    fireEvent.keyDown(dot(IDS[1]), { key: "PageDown" });
    expect(focusName()).toBe("full-text");
    expect(document.activeElement).toBe(dot(IDS[3]));
    fireEvent.keyDown(dot(IDS[3]), { key: "End" });
    expect(document.activeElement).toBe(dot(IDS[4]));
    fireEvent.keyDown(dot(IDS[4]), { key: "Home" });
    expect(focusName()).toBe("quick-add");
    fireEvent.keyDown(dot(IDS[0]), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(dot(IDS[0]));
  });

  it("returns from the sheet to the dot in focus on Escape", () => {
    renderInEnglish(<Lens />);
    const open = screen.getByRole("button", { name: "View record" });
    open.focus();
    fireEvent.keyDown(open, { key: "Escape" });
    expect(document.activeElement).toBe(dot(IDS[0]));
  });

  it("shows the promises of the record in focus, the first unfolded with its proof", () => {
    renderInEnglish(<Lens />);
    const panel = screen.getByRole("tabpanel");
    const rows = within(panel).getAllByRole("button");
    expect(rows[0]).toHaveAttribute("aria-expanded", "true");
    expect(within(panel).getByText("a reader on quick-add")).toBeInTheDocument();
    expect(within(panel).getByText(/src\/quick-add\.spec\.ts/)).toBeInTheDocument();
    fireEvent.click(rows[1]);
    expect(within(panel).getByText("it fails well")).toBeInTheDocument();
    expect(within(panel).getByText("No test names this promise.")).toBeInTheDocument();
  });

  it("switches sections with the arrow keys and walks to a neighbour", () => {
    renderInEnglish(<Lens />);
    const promises = screen.getByRole("tab", { name: /Promises/ });
    promises.focus();
    fireEvent.keyDown(promises, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Knowledge/ })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Knowledge/ }));
    expect(within(screen.getByRole("tabpanel")).getByText("Know quick-add.")).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getAllByText("open")).toHaveLength(4);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    const panel = screen.getByRole("tabpanel");
    fireEvent.click(within(panel).getByRole("button", { name: IDS[3] }));
    expect(focusName()).toBe("full-text");
    expect(dot(IDS[0])).toHaveAttribute("data-state", "neighbour");
  });

  it("brings the hits of a search into focus and pushes the rest into the depth", () => {
    renderInEnglish(<Lens />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "search" } });
    expect(screen.getByTestId("lens-status")).toHaveTextContent("2 sharp · 3 in depth");
    expect(dot(IDS[2])).toHaveAttribute("data-state", "deep");
    expect(dot(IDS[4])).toHaveAttribute("data-state", "hit");
    const hits = screen.getByRole("region", { name: "Hits" });
    fireEvent.click(within(hits).getByRole("button", { name: /saved-filters/ }));
    expect(focusName()).toBe("saved-filters");
    expect(within(hits).getByRole("button", { name: /saved-filters/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("stacks hits, sheet and field in reading order on a phone", () => {
    renderInEnglish(<Lens mobile />);
    const lens = screen.getByTestId("records-lens");
    const sheet = screen.getByTestId("lens-sheet");
    const field = screen.getByRole("region", { name: "All records" });
    expect(lens.firstElementChild).toBe(sheet);
    expect(sheet.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("speaks German", () => {
    renderInGerman(<Lens />);
    expect(screen.getAllByRole("radio")[0]).toHaveAccessibleName(germanLabel("Lens"));
    expect(
      screen.getByRole("tab", { name: new RegExp(germanLabel("Promises")) }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: germanLabel("All records") })).toBeInTheDocument();
    expect(dot(IDS[1])).toHaveAccessibleName(
      `tasks/create/templates · 1/2 ${germanLabel("test named")} · ${germanLabel("neighbour")}`,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "search" } });
    expect(screen.getByTestId("lens-status")).toHaveTextContent(
      i18n.getFixedT("de")("ui.screens-records.recordslens-sharp-sharp-deep-depth", {
        sharp: 2,
        deep: 3,
      }),
    );
  });
});
