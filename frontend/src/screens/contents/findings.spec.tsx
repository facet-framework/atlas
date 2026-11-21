import { fireEvent, screen, within } from "@testing-library/react";
import { renderInEnglish as render } from "../testing";
import { CyclesPage, DecisionsPage, UnreadPage } from "./Findings";
import { ContentsHub } from "./Hub";
import { GlossaryPage } from "./Glossary";
import { AiSection, GitProviderSection, LanguageSection } from "./Settings";
import type { GlossaryGroup, GlossaryTerm } from "./model";

const term = (name: string, category = ""): GlossaryTerm => ({
  term: name,
  definition: `${name} explained`,
  category,
  aliases: [],
  records: 1,
  status: "settled",
});

describe("CyclesPage", () => {
  it("names each node of the host's remainder and an id without a record in the bad colour", () => {
    const opened: string[] = [];
    render(
      <CyclesPage
        nodes={[
          { id: "a/b/c", summary: "On the cycle" },
          { id: "a/b/ghost", summary: null },
        ]}
        onOpenRecord={(id) => opened.push(id)}
      />,
    );
    const rows = screen.getAllByTestId("cycle-node");
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId("cycle-ghost")).toHaveTextContent("a/b/ghost");
    expect(screen.getByTestId("cycle-ghost")).toHaveClass("t-bad");
    expect(within(rows[1]).queryByRole("button")).toBeNull();
    fireEvent.click(within(rows[0]).getByRole("button"));
    expect(opened).toEqual(["a/b/c"]);
  });

  it("shows a measured zero as 0 with the sentence that no node read on a cycle", () => {
    render(<CyclesPage nodes={[]} />);
    expect(screen.getByTestId("cycles-page")).toHaveTextContent("0");
    expect(screen.getAllByText("No node lies on a dependency cycle.")).toHaveLength(1);
    expect(screen.queryByTestId("cycle-node")).toBeNull();
  });
});

describe("UnreadPage", () => {
  it("names each file the run could not read, with its line where there is one", () => {
    render(
      <UnreadPage
        items={[
          { path: "docs/facets/x.yaml", message: "bad indentation", line: 7 },
          { path: "docs/facets/y.yaml", message: "file not in corpus" },
        ]}
      />,
    );
    const rows = screen.getAllByTestId("unread-file");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("x.yaml:7");
    expect(rows[0]).toHaveTextContent("bad indentation");
    expect(rows[1]).not.toHaveTextContent(":");
    expect(screen.getByTestId("unread-page")).toHaveTextContent(
      "2 files could not be read as records.",
    );
  });
});

describe("DecisionsPage", () => {
  it("lists the documents in the order given, with how many records name each", () => {
    const decisions: string[] = [];
    const records: string[] = [];
    render(
      <DecisionsPage
        items={[
          { target: "docs/adr/0002.md", count: 2, recordIds: ["a/b/one", "a/b/two"] },
          { target: "docs/adr/0001.md", count: 1, recordIds: ["a/b/three"] },
        ]}
        onOpenDecision={(t) => decisions.push(t)}
        onOpenRecord={(id) => records.push(id)}
      />,
    );
    const rows = screen.getAllByTestId("decision-target");
    expect(rows.map((r) => within(r).getAllByRole("button")[0].textContent)).toEqual([
      "docs/adr/0002.md",
      "docs/adr/0001.md",
    ]);
    expect(within(rows[0]).getByTestId("decision-count")).toHaveTextContent("2 records name it");
    expect(within(rows[1]).getByTestId("decision-count")).toHaveTextContent("1 record names it");
    fireEvent.click(within(rows[0]).getByText("docs/adr/0002.md"));
    fireEvent.click(within(rows[1]).getByTitle("a/b/three"));
    expect(decisions).toEqual(["docs/adr/0002.md"]);
    expect(records).toEqual(["a/b/three"]);
  });

  it("says no record names a decision when none does", () => {
    render(<DecisionsPage items={[]} />);
    expect(screen.queryByTestId("decision-target")).toBeNull();
    expect(screen.getAllByText("No record names a decision.").length).toBeGreaterThan(0);
  });
});

describe("GlossaryPage grouped by category", () => {
  const groups: GlossaryGroup[] = [
    {
      id: "domain",
      title: "Domain",
      state: "ok",
      terms: [term("Record", "Domain")],
      total: 1,
    },
    { id: "tools", title: "Tools", state: "empty", terms: [], total: 0 },
    { id: "ghost", state: "undeclared", terms: [term("Anchor", "ghost")], total: 1 },
    { id: "", state: "none", terms: [term("Drift"), term("Lens")], total: 2 },
  ];
  const page = (over: Partial<Parameters<typeof GlossaryPage>[0]> = {}) => (
    <GlossaryPage
      state="ready"
      terms={groups.flatMap((g) => g.terms)}
      letters={[]}
      query=""
      page={1}
      pageSize={100}
      total={4}
      categories={[]}
      groups={groups}
      {...over}
    />
  );

  it("draws the headings in the order given: declared, empty, undeclared, uncategorised last", () => {
    render(page());
    const sections = screen.getAllByTestId("glossary-category");
    expect(sections.map((s) => s.getAttribute("data-state"))).toEqual([
      "ok",
      "empty",
      "undeclared",
      "none",
    ]);
    expect(within(sections[1]).getByTestId("glossary-category-empty")).toHaveTextContent(
      "Declared; no term names it.",
    );
    const ghost = within(sections[2]).getByTestId("glossary-category-name");
    expect(ghost).toHaveTextContent("ghost");
    expect(ghost).toHaveClass("t-mono", "t-bad");
    expect(within(sections[2]).getByTestId("glossary-category-undeclared")).toBeInTheDocument();
    expect(within(sections[3]).getByTestId("glossary-category-name")).toHaveTextContent(
      "No category · assigned by nobody",
    );
    expect(screen.queryByText(/Other/)).toBeNull();
  });

  it("collapses one group and opens it again while the others stay open and the count stays", () => {
    let collapsed: string[] = [];
    const { rerender } = render(
      page({ collapsed, onToggleGroup: (id) => (collapsed = [...collapsed, id]) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse Domain" }));
    rerender(page({ collapsed, onToggleGroup: () => undefined }));
    const [domain, , , none] = screen.getAllByTestId("glossary-category");
    expect(within(domain).queryByText("Record")).toBeNull();
    expect(within(domain).getByTestId("glossary-category-count")).toHaveTextContent("1");
    expect(within(none).getByText("Drift")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Domain" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    rerender(page({ collapsed: [], onToggleGroup: () => undefined }));
    expect(within(screen.getAllByTestId("glossary-category")[0]).getByText("Record")).toBeVisible();
  });

  it("opens a collapsed group holding a hit under a filter and drops the groups holding none", () => {
    render(
      page({
        query: "dri",
        collapsed: ["", "domain"],
        groups: groups.map((g) => ({ ...g, terms: g.terms.filter((x) => x.term === "Drift") })),
      }),
    );
    const sections = screen.getAllByTestId("glossary-category");
    expect(sections).toHaveLength(1);
    expect(within(sections[0]).getByText("Drift")).toBeInTheDocument();
    expect(within(sections[0]).queryByRole("button", { expanded: false })).toBeNull();
  });

  it("keeps A–Z without groups and names no category for a term that has none", () => {
    render(
      page({
        groups: null,
        mode: "term",
        detail: { ...term("Drift"), recordIds: [], occurrences: [], related: [], history: [] },
      }),
    );
    expect(screen.queryByTestId("glossary-category")).toBeNull();
    expect(screen.getByRole("region", { name: "Letter D" })).toBeInTheDocument();
    expect(screen.queryByTestId("term-category")).toBeNull();
  });

  it("hands a definition to renderProse when given", () => {
    render(
      page({
        mode: "term",
        detail: { ...term("Drift"), recordIds: [], occurrences: [], related: [], history: [] },
        renderProse: (text) => <mark data-testid="rendered">{text}</mark>,
      }),
    );
    expect(screen.getByTestId("term-definition")).toContainElement(screen.getByTestId("rendered"));
  });
});

describe("LanguageSection with a language file", () => {
  const value = { ui: "de", content: "record", dates: "absolute", week: "monday" } as const;
  const sample = { relative: "3 minutes ago", absolute: "1.1.2026", number: "1.234,5" };

  it("names every language in itself and offers an added one beside them", () => {
    render(
      <LanguageSection
        value={value}
        sample={sample}
        languages={[
          { value: "de", label: "German" },
          { value: "en", label: "English" },
          { value: "fr", label: "Français" },
        ]}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Interface language" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["German", "English", "Français"]);
    expect(screen.queryByTestId("language-add")).toBeNull();
  });

  it("opens the hidden picker from the add button and clears it after a pick", () => {
    const picked: File[] = [];
    render(<LanguageSection value={value} sample={sample} onAddFile={(f) => picked.push(f)} />);
    const input = screen.getByTestId<HTMLInputElement>("language-file");
    expect(input.hidden).toBe(true);
    let clicked = 0;
    input.addEventListener("click", () => clicked++);
    fireEvent.click(screen.getByTestId("language-add"));
    expect(clicked).toBe(1);
    const file = new File(["{}"], "fr.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(picked).toEqual([file]);
    expect(input.value).toBe("");
  });

  it("says which file was refused", () => {
    render(<LanguageSection value={value} sample={sample} onAddFile={() => {}} refused="x.json" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not a language file: x.json");
  });
});

describe("GitProviderSection without an answer", () => {
  it("claims nothing about the repository when no answer is in hand", () => {
    render(
      <GitProviderSection
        value={{
          state: "unanswered",
          remote: "",
          provider: "other",
          branch: "—",
          branchPrefix: "",
          prDraft: false,
          codeLinks: false,
          manualUrl: "",
        }}
      />,
    );
    expect(screen.getByTestId("git-provider-unanswered")).toHaveTextContent(
      "No answer from the host",
    );
    expect(screen.queryByTestId("git-provider-no-remote")).toBeNull();
    expect(screen.queryByText("Remote")).toBeNull();
  });
});

describe("GlossaryPage without a glossary", () => {
  it("says no glossary is declared instead of counting zero terms", () => {
    render(
      <GlossaryPage
        state="undeclared"
        terms={[]}
        letters={[]}
        query=""
        page={1}
        pageSize={60}
        total={0}
        categories={[]}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("No glossary declared");
    expect(screen.getByTestId("glossary-page")).not.toHaveTextContent("The glossary is empty.");
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
  });
});

describe("ContentsHub tile tone", () => {
  it("draws a bad tile's count in the bad colour and leaves the others alone", () => {
    render(
      <ContentsHub
        state="ready"
        kinds={[
          {
            key: "read-errors",
            label: "Not read",
            group: "Registry",
            icon: "error",
            desc: "",
            count: 2,
            unit: "Files",
            tone: "bad",
            views: [],
          },
          {
            key: "cycles",
            label: "Cycles",
            group: "Registry",
            icon: "network",
            desc: "",
            count: 0,
            unit: "nodes",
            tone: "ok",
            views: [],
          },
        ]}
      />,
    );
    const [bad, ok] = screen.getAllByTestId("tile-figure");
    expect(bad).toHaveClass("t-bad");
    expect(bad).toHaveTextContent("2");
    expect(ok).not.toHaveClass("t-bad");
    expect(ok).toHaveTextContent("0");
  });
});

describe("GlossaryPage term detail", () => {
  const detail = (over: Record<string, unknown>) =>
    render(
      <GlossaryPage
        state="ready"
        mode="term"
        terms={[term("Drift")]}
        letters={[]}
        query=""
        page={1}
        pageSize={60}
        total={1}
        categories={[]}
        detail={{
          ...term("Drift"),
          recordIds: [],
          occurrences: [],
          related: [],
          history: [],
          ...over,
        }}
      />,
    );

  it.each([
    [{ category: "Domain", categoryState: "declared" }, "Domain", "declared"],
    [
      { category: "ghost", categoryState: "undeclared" },
      "ghost · Category not declared",
      "undeclared",
    ],
    [
      { category: "", categoryState: "unassigned" },
      "No category · assigned by nobody",
      "unassigned",
    ],
  ])("draws the category as it stands: %j", (over, text, state) => {
    detail(over);
    const line = screen.getByTestId("term-category");
    expect(line).toHaveTextContent(text);
    expect(line).toHaveAttribute("data-state", state);
  });

  it("says no record uses a term nothing refers to", () => {
    detail({});
    expect(screen.getByTestId("term-unused")).toHaveTextContent("No record uses this term.");
  });
});

describe("AiSection without a way to act", () => {
  it("states the model as the host reports it and offers no control nothing carries out", () => {
    render(
      <AiSection
        value={{
          state: "ready",
          account: "a@b.c",
          model: "opus",
          models: ["opus", "sonnet"],
          mode: "read",
          tools: [{ name: "Bash", allowed: false, fixed: true }],
          lastCheck: "10:00",
        }}
      />,
    );
    expect(screen.getByTestId("ai-model")).toHaveTextContent("opus");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });
});
