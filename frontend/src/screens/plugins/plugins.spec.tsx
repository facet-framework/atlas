import { germanLabel } from "@/i18n/testing-labels.spec-support";
import { screen, within, fireEvent } from "@testing-library/react";
import { renderInEnglish as render, renderInEnglish } from "../testing";
import userEvent from "@testing-library/user-event";
import {
  AdrCollection,
  AdrDirectorySetting,
  AdrEmpty,
  AdrNewForm,
  AdrReader,
  AdrStatusForm,
  BOARD_CAP,
} from "../../../../plugins/adr/src/views/Adr";
import {
  ProcessCanvas,
  ProcessCollection,
  ProcessUnreadable,
  ProcessWorkspace,
} from "../../../../plugins/bpmn/src/views/Processes";
import {
  ChatDock,
  ChatFull,
  ChatPill,
  ChatSignIn,
  ChatTurn,
  Composer,
  ReadingTrail,
  SourceCards,
  type ComposerProps,
} from "./Chat";
import { CommandPalette, Highlight } from "./Palette";
import { CountUp, CountUpBoard, FlightDemo, ReducedMotionDemo, StaggerDemo } from "./Motion";
import {
  Bars,
  Diff,
  Facts,
  Inline,
  KeyHints,
  Markdown,
  PluginHead,
  Steps,
  markdownHeadings,
  parseMarkdown,
  useLifecycleLabel,
} from "./shared";
import * as data from "./storyData.spec-support";

/** Numbers as the German screens print them. */
const nf = (n: number) => new Intl.NumberFormat("en").format(n);

function LifecycleProbe({ values }: { values: string[] }) {
  const label = useLifecycleLabel();
  return (
    <ul>
      {values.map((v) => (
        <li key={v} data-testid={`lc-${v}`}>
          {label(v)}
        </li>
      ))}
    </ul>
  );
}

const ANSWER_SAMPLE = [
  "A paragraph with [Target](atlas:record/x).",
  "",
  "1. one",
  "2. two",
  "",
  "| File | Purpose |",
  "| --- | --- |",
  "| `lint_anchors.go` | Anchors |",
  "",
  "```sh",
  "FACET_STRICT_DEPS=1 sh tools/facet-lint/run-all.sh",
  "```",
  "",
  "> A quote",
  "",
  "## Title",
  "",
  "- a",
  "- b",
  "",
  "---",
].join("\n");

const user = () => userEvent.setup();

/** shared ------------------------------------------------------------------------ */

describe("markdown", () => {
  it.each([" javascript:alert", "javascript:alert", "data:text/html,x", "JaVaScRiPt:x"])(
    "keeps an unsafe link target %p as text with its address, never as a link",
    (href) => {
      const onLink = jest.fn();
      render(<Inline text={`before [Target](${href}) after`} onLink={onLink} />);
      // The precondition: the text was drawn at all.
      expect(screen.getByTestId("md-unsafe-link")).toHaveTextContent(`Target (${href})`, {
        normalizeWhitespace: false,
      });
      expect(screen.queryByRole("link")).toBeNull();
      expect(document.querySelector("a[href]")).toBeNull();
    },
  );

  it("still draws a safe link target as a link that reports itself", () => {
    const onLink = jest.fn();
    render(<Inline text="before [Target](docs/adr/0002.md) after" onLink={onLink} />);
    fireEvent.click(screen.getByRole("link", { name: "Target" }));
    expect(onLink).toHaveBeenCalledWith("docs/adr/0002.md");
    expect(screen.queryByTestId("md-unsafe-link")).toBeNull();
  });

  it("parses every block kind the answers use", () => {
    const kinds = parseMarkdown(ANSWER_SAMPLE).map((b) => b.t);
    expect(kinds).toEqual(
      expect.arrayContaining(["p", "ol", "table", "code", "quote", "h", "ul", "hr"]),
    );
  });

  it("renders a table, a list and a code block with a working copy button", async () => {
    const onCopyCode = jest.fn();
    const onLink = jest.fn();
    render(
      <Markdown source={ANSWER_SAMPLE} onCopyCode={onCopyCode} onLink={onLink} copiedCode={0} />,
    );
    expect(screen.getByRole("table")).toHaveTextContent("lint_anchors.go");
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Copied" }));
    expect(onCopyCode).toHaveBeenCalledWith(expect.stringContaining("FACET_STRICT_DEPS=1"));
    await user().click(screen.getByRole("link", { name: "Target" }));
    expect(onLink).toHaveBeenCalledWith("atlas:record/x");
  });

  it("renders inline marks without callbacks", () => {
    render(
      <p>
        <Inline text="**bold** `code` _italic_ [l](u) rest" />
      </p>,
    );
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    fireEvent.click(screen.getByRole("link", { name: "l" }));
    render(<Markdown source={"```\nplain\n```\n\n[a](b)"} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(screen.getByRole("link", { name: "a" }));
  });

  it("draws the small pieces", () => {
    render(
      <>
        <PluginHead
          icon="file"
          title="Header"
          count="3"
          meta="m"
          sentence="Sentence"
          actions={<button>a</button>}
        />
        <Facts rows={[["k", "v"]]} />
        <Bars values={[1, 2, 0]} label="Balken" tone="warn" />
        <KeyHints hints={[["↵", "open"]]} />
        <Diff label="Diff" lines={data.SAMPLE_DIFF} />
        <Steps
          label="Ablauf"
          steps={[{ key: "upload", label: "Branch upload", state: "failed" }]}
        />
      </>,
    );
    expect(screen.getByRole("img", { name: "Balken" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Diff" })).toHaveTextContent("orphan anchor");
    expect(screen.getByRole("list", { name: "Ablauf" })).toHaveTextContent("Branch upload");
  });
});

/** ADR ------------------------------------------------------------------------- */

describe("Decisions", () => {
  const counts = data.adrCounts(data.adrs480);
  const base = { total: 480, counts, page: 2, pageSize: 60, query: "", directory: "docs/adr" };

  it("shows the table on page 2 of 8 and reacts to view, status and paging", async () => {
    const on = {
      onView: jest.fn(),
      onStatus: jest.fn(),
      onPage: jest.fn(),
      onOpen: jest.fn(),
      onCreate: jest.fn(),
      onSettings: jest.fn(),
      onQuery: jest.fn(),
    };
    render(
      <AdrCollection
        state="ready"
        view="table"
        items={data.adrs480.slice(60, 120)}
        {...base}
        {...on}
      />,
    );
    expect(screen.getByText("61–120 of 480")).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "Decisions" })).toBeInTheDocument();
    await user().click(screen.getAllByRole("row")[1]);
    expect(on.onOpen).toHaveBeenCalledWith(data.adrs480[60].number, data.adrs480[60].file);
    await user().click(screen.getByRole("button", { name: "Page 3" }));
    expect(on.onPage).toHaveBeenCalledWith(3);
    await user().click(screen.getByRole("radio", { name: /Board/ }));
    expect(on.onView).toHaveBeenCalledWith("board");
    await user().click(screen.getByRole("button", { name: `proposed: ${counts.proposed}` }));
    expect(on.onStatus).toHaveBeenCalledWith("proposed");
    await user().click(screen.getByRole("button", { name: "New decision" }));
    await user().click(screen.getByRole("button", { name: "Directory" }));
    expect(on.onSettings).toHaveBeenCalled();
  });

  it("keeps each year of the timeline to its own dates, in the chosen direction, whatever the rows are sorted by", () => {
    const rows = data.sortAdrs(data.adrs480, "title", "asc").slice(0, 60);
    const byNumber = new Map(rows.map((a) => [a.number, a]));
    const timeline = (dir: "asc" | "desc") => {
      const { unmount } = render(
        <AdrCollection
          state="ready"
          view="timeline"
          items={rows}
          {...base}
          page={1}
          sort={{ key: "title", dir }}
        />,
      );
      const axis = screen.getByLabelText("Timeline");
      const groups = within(axis)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => {
          const year = heading.textContent!.slice(0, 4);
          const dates = within(heading.closest("section")!)
            .getAllByRole("listitem")
            .map((item) => {
              const number = Number(
                /^(\d{4})/.exec(within(item).getByRole("button").textContent!)![1],
              );
              const adr = byNumber.get(number)!;
              expect(within(item).getByText(adr.date.slice(5))).toBeInTheDocument();
              return adr.date;
            });
          return { year, dates };
        });
      unmount();
      return groups;
    };
    for (const dir of ["desc", "asc"] as const) {
      const groups = timeline(dir);
      const years = groups.map((g) => g.year);
      expect(new Set(years).size).toBe(years.length);
      expect(groups.reduce((n, g) => n + g.dates.length, 0)).toBe(rows.length);
      const all = groups.flatMap((g) => {
        for (const date of g.dates) expect(date.slice(0, 4)).toBe(g.year);
        return g.dates;
      });
      const ordered = [...all].sort();
      expect(all).toEqual(dir === "asc" ? ordered : ordered.reverse());
    }
  });

  it("lists two decisions that share a number in every view, and opens each by its own file", async () => {
    const first = { ...data.adrs480[0], number: 7, file: "0007-reader-library.md" };
    const second = {
      ...data.adrs480[1],
      number: 7,
      date: first.date,
      title: "CLI product plugins",
      file: "0007-cli-product-plugins.md",
    };
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    const onOpen = jest.fn();
    for (const view of ["timeline", "board", "table"] as const) {
      onOpen.mockClear();
      const { unmount } = render(
        <AdrCollection
          state="ready"
          view={view}
          items={[first, second]}
          {...base}
          page={1}
          onOpen={onOpen}
        />,
      );
      const opener =
        view === "table"
          ? screen.getAllByRole("row").slice(1)
          : screen.getAllByRole("button", { name: /0007/ });
      expect(opener).toHaveLength(2);
      await user().click(opener[1]);
      expect(onOpen).toHaveBeenCalledWith(7, "0007-cli-product-plugins.md");
      unmount();
    }
    // A shared number as the key made React warn and could reuse one row for both.
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    errors.mockRestore();
  });

  it("numbers the story ADRs in the order of their dates", () => {
    const byNumber = [...data.adrs480].sort((a, b) => a.number - b.number);
    for (let i = 1; i < byNumber.length; i++)
      expect(byNumber[i].date >= byNumber[i - 1].date).toBe(true);
  });

  it("groups by year on the timeline and by status on the board", async () => {
    const onOpen = jest.fn();
    const { rerender } = render(
      <AdrCollection
        state="ready"
        view="timeline"
        items={data.adrs480.slice(0, 40)}
        {...base}
        page={1}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByLabelText("Timeline")).toHaveTextContent(data.adrs480[0].date.slice(0, 4));
    await user().click(within(screen.getByLabelText("Timeline")).getAllByRole("button")[0]);
    expect(onOpen).toHaveBeenCalledWith(data.adrs480[0].number, data.adrs480[0].file);
    rerender(
      <AdrCollection
        state="ready"
        view="board"
        items={data.adrs480}
        {...base}
        activeStatus="accepted"
        onOpen={onOpen}
      />,
    );
    const col = screen.getByRole("region", { name: "superseded" });
    expect(col).toHaveTextContent("more");
    await user().click(within(col).getAllByRole("button")[0]);
    rerender(
      <AdrCollection
        state="ready"
        view="table"
        items={data.adrs480.slice(0, 3)}
        {...base}
        mobile
        onOpen={onOpen}
      />,
    );
    expect(screen.queryByRole("grid", { name: "Decisions" })).not.toBeInTheDocument();
    await user().click(screen.getAllByRole("button", { name: /ADR 0/ })[0]);
    rerender(<AdrCollection state="loading" view="board" items={[]} {...base} />);
    expect(screen.getByText("Reading decisions …")).toBeInTheDocument();
    rerender(
      <AdrCollection state="filtered-empty" view="timeline" items={[]} {...base} query="zzz" />,
    );
    expect(screen.getByText(/No matches for/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  });

  it("has an empty state with the next step", async () => {
    const on = { onCreate: jest.fn(), onSettings: jest.fn() };
    render(<AdrEmpty directory="docs/adr" {...on} />);
    expect(screen.getByText("No decision yet")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Create the first decision" }));
    await user().click(screen.getByRole("button", { name: "Another directory" }));
    expect(on.onSettings).toHaveBeenCalled();
    render(<AdrEmpty directory="d" />);
  });

  it("reads a real ADR with its records and supersession", async () => {
    const d = data.adrDetail(1);
    const on = {
      onBack: jest.fn(),
      onOpenRecord: jest.fn(),
      onLink: jest.fn(),
      onCopyCode: jest.fn(),
    };
    const { rerender } = render(
      <AdrReader {...d} adr={{ ...d.adr, supersededBy: { number: 6, title: "x" } }} {...on} />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The newest edit wins a sync conflict",
    );
    expect(screen.getByRole("region", { name: "Linked records" })).toHaveTextContent(
      d.records[0].id,
    );
    await user().click(screen.getByRole("button", { name: /supersedes 0001/ }));
    await user().click(screen.getByRole("button", { name: /superseded by 0006/ }));
    expect(on.onLink).toHaveBeenCalledWith("adr:6");
    await user().click(screen.getByRole("link", { name: d.toc[0].label }));
    await user().click(screen.getByRole("button", { name: "Decisions" }));
    await user().click(
      within(screen.getByRole("region", { name: "Linked records" })).getAllByRole("button")[0],
    );
    expect(on.onOpenRecord).toHaveBeenCalledWith(d.records[0].id);
    rerender(
      <AdrReader
        {...d}
        adr={{ ...d.adr, status: "unknown", rawStatus: "fraglich" }}
        records={[{ id: "r", summary: "", lifecycle: "—" }]}
        readable={false}
        mobile
      />,
    );
    expect(screen.getByText("File not readable")).toBeInTheDocument();
    expect(screen.getByText("fraglich", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Contents" })).getAllByRole("button")[0],
    );
    fireEvent.click(screen.getByRole("button", { name: /supersedes 0001/ }));
    fireEvent.click(screen.getByRole("button", { name: "Decisions" }));
    fireEvent.click(screen.getByRole("button", { name: /^r/ }));
    expect(data.adrDetail(0).adr.supersedes).toBeUndefined();
    expect(data.normalizeStatus("accepted, 2026")).toBe("accepted");
  });

  it("proposes a status with reason validation and successor", async () => {
    const d = data.adrDetail(1);
    const on = { onNext: jest.fn(), onChange: jest.fn(), onSubmit: jest.fn(), onClose: jest.fn() };
    const p = {
      adr: d.adr,
      reason: "A sufficient reason to change.",
      successor: 6,
      successors: [{ number: 6, title: "Approval" }],
      branch: "adr/x",
      diff: "- a\n+ b",
    };
    const { rerender } = render(<AdrStatusForm {...p} next="superseded" {...on} />);
    expect(screen.getByRole("dialog", { name: "Propose status" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /accepted/ })).toBeDisabled();
    await user().click(screen.getByRole("radio", { name: /rejected/ }));
    expect(on.onNext).toHaveBeenCalledWith("rejected");
    await user().selectOptions(screen.getByLabelText("Superseded by"), "6");
    await user().type(screen.getByLabelText("Reason"), "x");
    expect(on.onChange).toHaveBeenCalledWith("reason", expect.any(String));
    await user().click(screen.getByRole("button", { name: "Propose as PR" }));
    expect(on.onSubmit).toHaveBeenCalled();
    rerender(
      <AdrStatusForm
        {...p}
        successor={null}
        next="rejected"
        reason=""
        reasonError="Too short"
        mobile
        {...on}
      />,
    );
    expect(screen.getByRole("button", { name: "Propose as PR" })).toBeDisabled();
    expect(screen.queryByLabelText("Superseded by")).not.toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Cancel" }));
    expect(on.onClose).toHaveBeenCalled();
    rerender(<AdrStatusForm {...p} next="superseded" />);
    fireEvent.click(screen.getByRole("radio", { name: /rejected/ }));
    fireEvent.change(screen.getByLabelText("Superseded by"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "q" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose as PR" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("writes a new decision from the template", async () => {
    const on = {
      onChange: jest.fn(),
      onRemoveRecord: jest.fn(),
      onAddRecord: jest.fn(),
      onSubmit: jest.fn(),
      onCancel: jest.fn(),
    };
    const p = {
      number: 481,
      title: "T",
      context: "",
      decision: "",
      consequences: "",
      records: ["r/1"],
      file: "docs/adr/0481-t.md",
    };
    const { rerender } = render(<AdrNewForm {...p} {...on} />);
    expect(screen.getByText("ADR 0481")).toBeInTheDocument();
    for (const l of ["Title", "Context", "Decision", "Consequences"])
      await user().type(screen.getByLabelText(l), "x");
    expect(on.onChange).toHaveBeenCalledWith("consequences", "x");
    await user().click(screen.getByRole("button", { name: "Remove" }));
    await user().click(screen.getByRole("button", { name: "Link record" }));
    await user().click(screen.getByRole("button", { name: "Cancel" }));
    await user().click(screen.getByRole("button", { name: "Propose draft" }));
    expect(on.onSubmit).toHaveBeenCalled();
    rerender(<AdrNewForm {...p} titleError="Pflicht" />);
    expect(screen.getByRole("button", { name: "Propose draft" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "q" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Link record" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.submit(screen.getByRole("form", { name: "New decision" }));
  });

  it("sets the directory with a preview of what it finds", async () => {
    const on = { onChange: jest.fn(), onSave: jest.fn(), onCancel: jest.fn() };
    const { rerender } = render(
      <AdrDirectorySetting
        directory="docs/adr"
        found={6}
        sample={["docs/adr/1.md"]}
        ignored={[{ file: "README.md", reason: "not an ADR header" }]}
        {...on}
      />,
    );
    expect(screen.getByTestId("adr-found")).toHaveTextContent("6 decisions found");
    expect(screen.getByLabelText(".facetrc.yaml")).toHaveTextContent("directory: docs/adr");
    await user().type(screen.getByLabelText("adr.directory"), "x");
    await user().click(screen.getByRole("button", { name: "Apply" }));
    await user().click(screen.getByRole("button", { name: "Cancel" }));
    expect(on.onSave).toHaveBeenCalled();
    rerender(
      <AdrDirectorySetting
        directory="/abs"
        error="relative path required"
        found={null}
        sample={[]}
        ignored={[]}
      />,
    );
    expect(screen.getByTestId("adr-found")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("adr.directory"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
});

/** Processes ------------------------------------------------------------------------ */

describe("Processes", () => {
  const d = data.diagram;
  const metrics = { elements: 12, flows: 15, lanes: 3, paths: 2, longest: 6 };

  it("maps the BPMN fixture to lanes and connected flows", () => {
    expect(d.shapes.filter((s) => s.kind === "participant")).toHaveLength(3);
    expect(d.shapes.find((s) => s.label === "File chosen")?.lane).toBe("el-1");
    const path = data.walkPath(d);
    expect(path.nodes.map((n) => d.shapes.find((s) => s.id === n)?.label)).toEqual([
      "File chosen",
      "Have the file read",
      "Hand the text to the sidecar",
      "drawn?",
      "Draw SVG, list warnings",
      "visible",
    ]);
    expect(data.walkPath(d, { "el-7": 1 }).nodes).toContain("el-9");
    expect(data.walkAt(d, 4, true).choices?.map((c) => c.label)).toEqual(["yes", "no"]);
    expect(data.walkAt(d, 3, true).choices).toBeUndefined();
  });

  it("shows the gallery and the table with thumbnails", async () => {
    const on = {
      onView: jest.fn(),
      onOpen: jest.fn(),
      onPage: jest.fn(),
      onQuery: jest.fn(),
      onReset: jest.fn(),
    };
    const p = { total: 36, page: 1, pageSize: 12, query: "", withWarnings: 15 };
    const { rerender } = render(
      <ProcessCollection
        state="ready"
        view="gallery"
        items={data.processes.slice(0, 12)}
        {...p}
        {...on}
      />,
    );
    expect(screen.getByText("15 of 36 files have parser findings.")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /Thumbnail/ })).toHaveLength(12);
    await user().click(screen.getByRole("button", { name: /BPMN plugin data flow/ }));
    expect(on.onOpen).toHaveBeenCalledWith(data.processes[0].file);
    await user().click(screen.getByRole("radio", { name: /Table/ }));
    expect(on.onView).toHaveBeenCalledWith("table");
    rerender(
      <ProcessCollection
        state="ready"
        view="table"
        items={data.processes.slice(0, 12)}
        {...p}
        {...on}
      />,
    );
    await user().click(screen.getAllByRole("row")[1]);
    expect(on.onOpen).toHaveBeenCalledTimes(2);
    rerender(
      <ProcessCollection state="empty" view="gallery" items={[]} {...p} total={0} {...on} />,
    );
    expect(screen.getByText("No process")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "View sample file" }));
    expect(on.onReset).toHaveBeenCalled();
    rerender(
      <ProcessCollection
        state="ready"
        view="table"
        items={data.processes.slice(0, 1)}
        {...p}
        mobile
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /data flow/ }));
  });

  it("selects an element and shows its flows, lane and records", async () => {
    const on = {
      onSelect: jest.fn(),
      onZoom: jest.fn(),
      onPanel: jest.fn(),
      onFindings: jest.fn(),
      onWalk: jest.fn(),
      onOpenRecord: jest.fn(),
      onBack: jest.fn(),
      onOutlineQuery: jest.fn(),
    };
    render(
      <ProcessWorkspace
        name="data flow"
        file="a.bpmn"
        diagram={d}
        metrics={metrics}
        selected="el-6"
        panel="detail"
        findings={data.processFindings}
        findingsOpen
        outlineQuery="File"
        zoom={100}
        viewport={{ x: 0, y: 0, w: 10, h: 10 }}
        linked={data.processLinks}
        docs={data.processDocs}
        {...on}
      />,
    );
    const detail = screen.getByTestId("process-detail");
    expect(detail).toHaveTextContent("Hand the text to the sidecar");
    expect(detail).toHaveTextContent("Atlas (Browser)");
    expect(detail).toHaveTextContent("Have the file read");
    expect(detail).toHaveTextContent("Atlas does not parse XML");
    expect(screen.getByTestId("shape-el-6").getAttribute("data-state")).toBe("focus");
    expect(screen.getByTestId("shape-el-12").getAttribute("data-state")).toBe("related");
    expect(screen.getByTestId("shape-el-14").getAttribute("data-state")).toBe("dim");
    await user().click(
      within(detail).getByRole("button", { name: /Sequence flow Have the file read/ }),
    );
    expect(on.onSelect).toHaveBeenCalledWith("el-5");
    await user().click(within(detail).getAllByRole("button", { name: /lists/ })[0]);
    expect(on.onOpenRecord).toHaveBeenCalled();
    await user().click(screen.getByTestId("shape-el-7"));
    expect(on.onSelect).toHaveBeenCalledWith("el-7");
    await user().click(screen.getByRole("button", { name: "Zoom in" }));
    await user().click(screen.getByRole("button", { name: "Zoom out" }));
    await user().click(screen.getByRole("button", { name: "Fit" }));
    expect(on.onZoom).toHaveBeenCalledWith("fit");
    expect(screen.getByRole("img", { name: "Minimap" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Parser findings" })).toHaveTextContent(
      "Gateway “drawn?” has no default flow",
    );
    await user().click(screen.getAllByRole("button", { name: "Show" })[0]);
    expect(on.onSelect).toHaveBeenCalledWith("el-13");
    await user().click(screen.getByRole("button", { name: /Parser findings/ }));
    expect(on.onFindings).toHaveBeenCalled();
    const outline = screen.getByRole("navigation", { name: "Outline" });
    expect(within(outline).queryByRole("button", { name: /drawn/ })).not.toBeInTheDocument();
    await user().click(within(outline).getByRole("button", { name: /File chosen/ }));
    await user().type(within(outline).getByRole("searchbox"), "x");
    expect(on.onOutlineQuery).toHaveBeenCalled();
    await user().click(screen.getByRole("tab", { name: /Walkthrough/ }));
    expect(on.onPanel).toHaveBeenCalledWith("walkthrough");
    await user().click(screen.getByRole("button", { name: "Walkthrough" }));
    expect(on.onWalk).toHaveBeenCalledWith("start");
    await user().click(screen.getByRole("button", { name: "All processes" }));
    expect(on.onBack).toHaveBeenCalled();
  });

  it("walks step by step and offers the branches at a gateway", async () => {
    const onWalk = jest.fn();
    const walk = data.walkAt(d, 4, true);
    const props = {
      name: "D",
      file: "f",
      diagram: d,
      metrics,
      findings: [],
      outlineQuery: "",
      zoom: 75,
      linked: {},
    };
    const { rerender } = render(
      <ProcessWorkspace {...props} walk={walk} panel="walkthrough" onWalk={onWalk} />,
    );
    const panel = screen.getByTestId("process-walk");
    expect(panel).toHaveTextContent("Step 4");
    expect(screen.getByTestId("shape-el-7").getAttribute("data-state")).toBe("current");
    expect(screen.getByTestId("shape-el-5").getAttribute("data-state")).toBe("visited");
    expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled();
    await user().click(screen.getByRole("button", { name: /yes → Draw SVG/ }));
    expect(onWalk).toHaveBeenCalledWith("choose", "fl-4");
    await user().click(screen.getByRole("button", { name: "Step back" }));
    await user().click(screen.getAllByRole("button", { name: "End walkthrough" })[0]);
    expect(onWalk).toHaveBeenCalledWith("stop");
    rerender(
      <ProcessWorkspace {...props} walk={data.walkAt(d, 2)} panel="walkthrough" onWalk={onWalk} />,
    );
    await user().click(screen.getByRole("button", { name: "Next step" }));
    expect(onWalk).toHaveBeenCalledWith("next");
    rerender(<ProcessWorkspace {...props} panel="walkthrough" onWalk={onWalk} />);
    await user().click(screen.getByRole("button", { name: "Begin at the start" }));
    expect(screen.getByRole("region", { name: "Parser findings" })).toHaveTextContent("0");
    rerender(<ProcessWorkspace {...props} panel="detail" />);
    expect(screen.getByText("No element selected")).toBeInTheDocument();
    for (const n of ["Walkthrough", "Zoom in", "Zoom out", "Fit", "All processes"])
      fireEvent.click(screen.getByRole("button", { name: n }));
    fireEvent.click(screen.getByRole("button", { name: /Parser findings/ }));
    fireEvent.click(screen.getByTestId("shape-el-6"));
    fireEvent.click(screen.getByRole("tab", { name: /Walkthrough/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "q" } });
  });

  it("puts outline and detail into sheets on mobile", async () => {
    const on = { onSelect: jest.fn(), onWalk: jest.fn(), onOutline: jest.fn() };
    const props = {
      name: "D",
      file: "f",
      diagram: d,
      metrics,
      findings: data.processFindings,
      outlineQuery: "",
      zoom: 100,
      linked: {},
      mobile: true,
    };
    const { rerender } = render(
      <ProcessWorkspace {...props} selected="el-15" panel="detail" outlineOpen {...on} />,
    );
    expect(screen.getByRole("dialog", { name: "Outline" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Element" })).toHaveTextContent(
      "No record names this element.",
    );
    await user().click(screen.getAllByRole("button", { name: "Outline" })[0]);
    expect(on.onOutline).toHaveBeenCalled();
    await user().click(
      within(screen.getByRole("complementary", { name: "Element" })).getByRole("button", {
        name: "Close",
      }),
    );
    expect(on.onSelect).toHaveBeenCalledWith(null);
    rerender(<ProcessWorkspace {...props} walk={data.walkAt(d, 6)} panel="walkthrough" {...on} />);
    await user().click(
      within(screen.getByRole("complementary", { name: "Walkthrough" })).getByRole("button", {
        name: "Close",
      }),
    );
    expect(on.onWalk).toHaveBeenCalledWith("stop");
    const start = d.shapes.find((s) => s.kind === "startEvent")!;
    rerender(<ProcessWorkspace {...props} selected={start.id} panel="detail" />);
    expect(screen.getByText("none — start point")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
  });

  it("draws a thumbnail without labels and reports an unreadable file", async () => {
    const { container } = render(<ProcessCanvas diagram={d} thumb label="Mini" />);
    expect(container.querySelectorAll("text")).toHaveLength(0);
    render(<ProcessCanvas diagram={d} label="Full" />);
    fireEvent.click(screen.getByTestId("shape-el-4"));
    const on = { onBack: jest.fn(), onRetry: jest.fn() };
    render(
      <ProcessUnreadable
        file="x.bpmn"
        error="XML kaputt"
        line={2}
        excerpt={[
          { n: 1, text: "<a>" },
          { n: 2, text: "</b>" },
        ]}
        {...on}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("XML kaputt · line 2");
    await user().click(screen.getByRole("button", { name: "Read again" }));
    await user().click(screen.getByRole("button", { name: "All processes" }));
    expect(on.onRetry).toHaveBeenCalled();
    render(<ProcessUnreadable file="y" error="e" line={1} excerpt={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Read again" })[1]);
    fireEvent.click(screen.getAllByRole("button", { name: "All processes" })[1]);
  });
});

/** Ask Atlas -------------------------------------------------------------------- */

function composer(over: Partial<ComposerProps> = {}): ComposerProps {
  return {
    value: "Question",
    mode: "Ask",
    model: "opus",
    context: [{ key: "a", label: "ADR 0001", icon: "scales" }],
    ...over,
  };
}

describe("Ask Atlas", () => {
  it("opens from the pill and pulses while an answer runs", async () => {
    const onOpen = jest.fn();
    const { rerender } = render(<ChatPill onOpen={onOpen} />);
    await user().click(screen.getByRole("button", { name: /Ask Atlas/ }));
    expect(onOpen).toHaveBeenCalled();
    rerender(<ChatPill running step="reads config.go" mobile />);
    expect(screen.getByRole("button")).toHaveTextContent("Atlas is answeringreads config.go");
    fireEvent.click(screen.getByRole("button"));
  });

  it("answers with markdown, a reading trail, sources and actions", async () => {
    const on = {
      onCopy: jest.fn(),
      onRetry: jest.fn(),
      onSource: jest.fn(),
      onToggleTrail: jest.fn(),
      onCopyCode: jest.fn(),
    };
    const [, rich] = [null, data.turns("rich")[0]];
    render(<ChatTurn turn={rich} trailOpen copied={{ what: "markdown" }} {...on} />);
    expect(screen.getByRole("table")).toHaveTextContent("orphaned records");
    expect(screen.getByRole("list", { name: "Reading trail" })).toHaveTextContent(
      "internal/facet/config.go",
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    await user().click(screen.getAllByRole("button", { name: "Copy" }).at(-1)!);
    expect(on.onCopy).toHaveBeenCalledWith("text");
    await user().click(screen.getByRole("button", { name: "Sources" }));
    await user().click(screen.getByRole("button", { name: "Ask again" }));
    await user().click(screen.getByRole("button", { name: /scripts\/commit-gate\.sh/ }));
    expect(on.onSource).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "scripts/commit-gate.sh" }),
    );
    await user().click(screen.getByRole("button", { name: /Reading trail · 5 steps/ }));
    expect(on.onToggleTrail).toHaveBeenCalled();
    expect(screen.getAllByText(/5 sources · 5 steps/).length).toBeGreaterThan(0);
  });

  it("shows the live trail, the cut answer with continue, stop and failure", async () => {
    const onContinue = jest.fn();
    const onRetry = jest.fn();
    const { rerender } = render(<ChatTurn turn={data.turns("streaming")[1]} />);
    expect(screen.getByRole("button", { name: /Read file …/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Sources")).not.toBeInTheDocument();
    rerender(<ChatTurn turn={data.turns("cut")[1]} onContinue={onContinue} />);
    expect(screen.getByRole("status")).toHaveTextContent("Interrupted · not finished");
    await user().click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalled();
    rerender(<ChatTurn turn={data.turns("stopped")[1]} onRetry={onRetry} />);
    expect(screen.getByRole("status")).toHaveTextContent("Stopped after 6 s.");
    await user().click(screen.getByRole("button", { name: "Ask again" }));
    rerender(<ChatTurn turn={data.turns("failed")[1]} onRetry={onRetry} compact />);
    expect(screen.getByRole("alert")).toHaveTextContent("host timeout");
    await user().click(screen.getByRole("button", { name: "Again" }));
    expect(onRetry).toHaveBeenCalledTimes(2);
    const t = data.turns("failed")[1];
    rerender(
      <ChatTurn
        turn={{
          ...t,
          answer: {
            ...t.answer!,
            error: undefined,
            steps: [],
            seconds: undefined,
            state: "stopped",
          },
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("—");
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    rerender(<ChatTurn turn={{ ...t, answer: { ...t.answer!, error: undefined } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The host closed the connection.");
    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    fireEvent.click(screen.getByRole("button", { name: /Reading trail/ }));
    const cut = data.turns("cut")[1];
    rerender(<ChatTurn turn={cut} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const a = data.turns("answer")[0];
    rerender(
      <ChatTurn turn={{ ...a, answer: { ...a.answer!, model: undefined, seconds: undefined } }} />,
    );
    for (const n of ["Copy", "Markdown", "Sources", "Ask again"])
      fireEvent.click(screen.getByRole("button", { name: n }));
    fireEvent.click(screen.getByRole("button", { name: /scripts/ }));
    rerender(<ChatTurn turn={{ id: "q", question: "question only", at: "1" }} />);
    expect(screen.getByRole("article", { name: "question only" })).toBeInTheDocument();
  });

  it("composes with modes, context chips, slash commands, send and stop", async () => {
    const on = {
      onChange: jest.fn(),
      onSend: jest.fn(),
      onStop: jest.fn(),
      onMode: jest.fn(),
      onModel: jest.fn(),
      onRemoveContext: jest.fn(),
      onSlash: jest.fn(),
    };
    const { rerender } = render(
      <Composer {...composer({ slash: { items: data.SLASH, active: 1 } })} {...on} />,
    );
    expect(screen.getByRole("menu", { name: "Commands" })).toHaveTextContent("/domain");
    await user().click(screen.getByRole("menuitem", { name: /\/new/ }));
    expect(on.onSlash).toHaveBeenCalledWith("/new");
    await user().type(screen.getByLabelText("Question to Atlas"), "?");
    expect(on.onChange).toHaveBeenCalledWith("Question?");
    await user().click(screen.getByRole("button", { name: "Model opus" }));
    await user().click(screen.getByRole("button", { name: "Remove" }));
    expect(on.onRemoveContext).toHaveBeenCalledWith("a");
    await user().click(screen.getByRole("button", { name: "Send" }));
    expect(on.onSend).toHaveBeenCalled();
    rerender(
      <Composer
        {...composer({ running: true, mode: "Ask", context: [], compact: true })}
        {...on}
      />,
    );
    await user().click(screen.getByRole("button", { name: "Stop" }));
    expect(on.onStop).toHaveBeenCalled();
    rerender(
      <Composer
        {...composer({ value: " ", slash: { items: data.SLASH.slice(0, 1), active: 0 } })}
      />,
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Question to Atlas"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("radio", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: "Model opus" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("menuitem"));
    rerender(<Composer {...composer({ running: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    rerender(<Composer {...composer()} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });

  it("sends on Enter, breaks the line on Shift+Enter and Alt+Enter, and waits for a composition", () => {
    const onSend = jest.fn();
    const onChange = jest.fn();
    const { rerender, container } = render(
      <Composer {...composer()} onSend={onSend} onChange={onChange} />,
    );
    const field = screen.getByLabelText("Question to Atlas");
    expect(fireEvent.keyDown(field, { key: "Enter", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(field, { key: "Enter", isComposing: true })).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    (field as HTMLTextAreaElement).setSelectionRange(2, 2);
    expect(fireEvent.keyDown(field, { key: "Enter", altKey: true })).toBe(false);
    expect(onChange).toHaveBeenCalledWith("Qu\nestion");
    expect(onSend).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(field, { key: "Enter" })).toBe(false);
    expect(onSend).toHaveBeenCalledTimes(1);
    // The hint beside the field says what Enter does.
    expect(container).toHaveTextContent("↵ send · ⇧↵ line");

    // While an answer runs, or with nothing typed, Enter sends nothing.
    rerender(<Composer {...composer({ running: true })} onSend={onSend} />);
    fireEvent.keyDown(screen.getByLabelText("Question to Atlas"), { key: "Enter" });
    rerender(<Composer {...composer({ value: "  " })} onSend={onSend} />);
    fireEvent.keyDown(screen.getByLabelText("Question to Atlas"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);

    // On a phone Enter is the line break, and no hint claims otherwise.
    rerender(<Composer {...composer()} enterSends={false} onSend={onSend} />);
    expect(fireEvent.keyDown(screen.getByLabelText("Question to Atlas"), { key: "Enter" })).toBe(
      true,
    );
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(container).not.toHaveTextContent("send");
  });

  it("stops with an icon button that sits in the bar beside the modes", () => {
    render(<Composer {...composer({ running: true, compact: true })} />);
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(stop).toHaveTextContent("");
    expect(stop.parentElement).toBe(screen.getByRole("radiogroup", { name: "Mode" }).parentElement);
  });

  it("walks the command list with the arrow keys, picks with Enter and closes with Esc", () => {
    const on = { onSlash: jest.fn(), onSlashActive: jest.fn(), onSlashClose: jest.fn() };
    const { rerender } = render(
      <Composer {...composer({ value: "/", slash: { items: data.SLASH, active: 0 } })} {...on} />,
    );
    const field = screen.getByLabelText("Question to Atlas");
    expect(screen.getByRole("menu", { name: "Commands" })).toBeInTheDocument();
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(on.onSlashActive).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(on.onSlashActive).toHaveBeenLastCalledWith(data.SLASH.length - 1);
    rerender(
      <Composer {...composer({ value: "/", slash: { items: data.SLASH, active: 1 } })} {...on} />,
    );
    expect(screen.getByRole("menuitem", { current: true })).toHaveTextContent(data.SLASH[1].cmd);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(on.onSlash).toHaveBeenCalledWith(data.SLASH[1].cmd);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(on.onSlashClose).toHaveBeenCalled();
    rerender(<Composer {...composer({ value: "/x", slash: { items: [], active: 0 } })} {...on} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the model menu and picks a model by its index", async () => {
    const on = { onModel: jest.fn(), onPickModel: jest.fn() };
    const { rerender } = render(
      <Composer {...composer({ models: ["Default", "Haiku", "Opus"] })} {...on} />,
    );
    expect(screen.getByRole("button", { name: "Model opus" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await user().click(screen.getByRole("button", { name: "Model opus" }));
    expect(on.onModel).toHaveBeenCalledTimes(1);
    rerender(
      <Composer
        {...composer({
          model: "Opus",
          models: ["Default", "Haiku", "Opus"],
          modelsOpen: true,
        })}
        {...on}
      />,
    );
    const menu = screen.getByRole("menu", { name: "Models" });
    expect(within(menu).getByRole("menuitem", { current: true })).toHaveTextContent("Opus");
    await user().click(within(menu).getByRole("menuitem", { name: "Haiku" }));
    expect(on.onPickModel).toHaveBeenCalledWith(1);
  });

  it("docks with suggestions, an answer, sign-in and host error", async () => {
    const on = {
      onClose: jest.fn(),
      onExpand: jest.fn(),
      onNew: jest.fn(),
      onSuggestion: jest.fn(),
      onToggleTrail: jest.fn(),
      onCopy: jest.fn(),
      onRetry: jest.fn(),
      onContinue: jest.fn(),
    };
    const { rerender } = render(
      <ChatDock
        title="New"
        turns={[]}
        composer={composer()}
        suggestions={data.SUGGESTIONS}
        roleName="Developer"
        {...on}
      />,
    );
    expect(screen.getByText("What do you want to know?")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: data.SUGGESTIONS[0] }));
    expect(on.onSuggestion).toHaveBeenCalledWith(data.SUGGESTIONS[0]);
    await user().click(screen.getByRole("button", { name: "New conversation" }));
    await user().click(screen.getByRole("button", { name: "Full screen" }));
    await user().click(screen.getByRole("button", { name: "Close" }));
    expect(on.onExpand).toHaveBeenCalled();
    rerender(
      <ChatDock
        title="T"
        continuation="open"
        turns={data.turns("cut")}
        composer={composer()}
        copied={{ turn: "t1", what: "text" }}
        trailOpen={{ t1: true }}
        mobile
        {...on}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Ask Atlas" })).toHaveTextContent("open");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Continue" }));
    expect(on.onContinue).toHaveBeenCalledWith("t2");
    await user().click(screen.getAllByRole("button", { name: /Reading trail/ })[0]);
    expect(on.onToggleTrail).toHaveBeenCalledWith("t1");
    await user().click(screen.getByRole("button", { name: "Markdown" }));
    expect(on.onCopy).toHaveBeenCalledWith("t1", "markdown");
    await user().click(screen.getByRole("button", { name: "Ask again" }));
    expect(on.onRetry).toHaveBeenCalledWith("t1");
    rerender(<ChatDock title="T" turns={[]} composer={composer()} signedIn={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Atlas is not signed in");
    expect(screen.queryByLabelText("Question to Atlas")).not.toBeInTheDocument();
    rerender(
      <ChatDock
        title="T"
        turns={[]}
        composer={composer()}
        signedIn={false}
        hostError="Install the Companion binary."
      />,
    );
    expect(screen.getByText("Install the Companion binary.")).toBeInTheDocument();
    rerender(
      <ChatDock
        title="T"
        turns={[]}
        composer={composer()}
        hostError="No Claude Code on this host."
        onRetry={on.onRetry}
      />,
    );
    await user().click(screen.getByRole("button", { name: "Reconnect" }));
    expect(on.onRetry).toHaveBeenCalledWith("");
    rerender(<ChatDock title="T" turns={data.turns("answer")} composer={composer()} />);
    for (const n of ["New conversation", "Full screen", "Close", "Copy", "Ask again"])
      fireEvent.click(screen.getByRole("button", { name: n }));
    fireEvent.click(screen.getByRole("button", { name: /Reading trail/ }));
    rerender(<ChatDock title="T" turns={data.turns("cut")} composer={composer()} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    rerender(<ChatDock title="T" turns={[]} composer={composer()} hostError="x" />);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    rerender(<ChatDock title="T" turns={[]} composer={composer()} />);
    expect(screen.queryByRole("button", { name: data.SUGGESTIONS[0] })).not.toBeInTheDocument();
  });

  it("signs in by command", async () => {
    const on = { onCheck: jest.fn(), onCopy: jest.fn() };
    render(<ChatSignIn {...on} />);
    expect(screen.getByText("$ claude login")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Copy command" }));
    await user().click(screen.getByRole("button", { name: "Check again" }));
    expect(on.onCheck).toHaveBeenCalled();
    render(<ChatSignIn command="x" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Copy command" })[1]);
    fireEvent.click(screen.getAllByRole("button", { name: "Check again" })[1]);
  });

  it("manages sessions in full screen: pick, pin, rename, delete, search", async () => {
    const sessions = data.sessionsVM();
    const on = {
      onQuery: jest.fn(),
      onPick: jest.fn(),
      onMenu: jest.fn(),
      onPin: jest.fn(),
      onRename: jest.fn(),
      onRenameValue: jest.fn(),
      onRenameSave: jest.fn(),
      onRenameCancel: jest.fn(),
      onDelete: jest.fn(),
      onShrink: jest.fn(),
      onClose: jest.fn(),
      onSource: jest.fn(),
      onNew: jest.fn(),
    };
    const p = {
      title: "T",
      continuation: "continued" as const,
      turns: data.turns("answer"),
      composer: composer(),
      sessions,
      currentId: sessions[1].id,
      query: "",
    };
    const { rerender } = render(<ChatFull {...p} menuFor={sessions[1].id} {...on} />);
    const nav = screen.getByRole("navigation", { name: "Sessions" });
    expect(within(nav).getByText(/Pinned · 1/)).toBeInTheDocument();
    await user().click(
      within(nav).getAllByRole("button", { name: new RegExp(sessions[2].title) })[0],
    );
    expect(on.onPick).toHaveBeenCalled();
    await user().click(screen.getByRole("menuitem", { name: /Unpin|Pin/ }));
    expect(on.onPin).toHaveBeenCalledWith(sessions[1].id);
    await user().click(screen.getByRole("menuitem", { name: "Rename" }));
    await user().click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(on.onDelete).toHaveBeenCalledWith(sessions[1].id);
    await user().click(
      screen.getAllByRole("button", { name: `Actions for ${sessions[1].title}` })[0],
    );
    expect(on.onMenu).toHaveBeenCalled();
    await user().click(
      screen.getAllByRole("button", { name: `Actions for ${sessions[0].title}` })[0],
    );
    expect(on.onMenu).toHaveBeenCalledWith(sessions[0].id);
    await user().type(screen.getByRole("searchbox", { name: "Search sessions" }), "a");
    await user().click(screen.getByRole("button", { name: "New conversation" }));
    await user().click(screen.getByRole("button", { name: "As dock" }));
    await user().click(screen.getByRole("button", { name: "Close" }));
    expect(on.onShrink).toHaveBeenCalled();
    const sources = screen.getByRole("complementary", { name: "Sources of this session" });
    await user().click(within(sources).getAllByRole("button")[0]);
    expect(on.onSource).toHaveBeenCalled();
    rerender(
      <ChatFull
        {...p}
        menuFor={sessions[2].id}
        renaming={{
          id: sessions[1].id,
          value: "",
          error: "A title needs at least one character.",
        }}
        {...on}
      />,
    );
    expect(screen.getByRole("menuitem", { name: /Unpin|Pin/ })).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Rename session" });
    expect(form).toHaveTextContent("A title needs at least one character.");
    expect(within(form).getByRole("button", { name: "Save" })).toBeDisabled();
    await user().type(within(form).getByLabelText("New title"), "x");
    expect(on.onRenameValue).toHaveBeenCalledWith("x");
    await user().click(within(form).getByRole("button", { name: "Cancel" }));
    expect(on.onRenameCancel).toHaveBeenCalled();
    rerender(<ChatFull {...p} renaming={{ id: sessions[1].id, value: "New" }} {...on} />);
    await user().click(screen.getByRole("button", { name: "Save" }));
    expect(on.onRenameSave).toHaveBeenCalled();
    rerender(
      <ChatFull
        {...p}
        sessions={[]}
        query="zz"
        turns={[]}
        continuation={undefined}
        mobile
        sessionsOpen
        onSessions={on.onQuery}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Sessions" })).toHaveTextContent(
      "No session matches “zz”.",
    );
    await user().click(screen.getAllByRole("button", { name: "Sessions" })[0]);
    rerender(<ChatFull {...p} signedIn={false} />);
    expect(screen.queryByLabelText("Question to Atlas")).not.toBeInTheDocument();
  });

  it("draws no leading separator when a session has no time and an answer no model", () => {
    const sessions = [{ ...data.sessionsVM()[0], when: "" }];
    const turns = data
      .turns("answer")
      .map((turn) =>
        turn.answer ? { ...turn, answer: { ...turn.answer, model: "", seconds: undefined } } : turn,
      );
    // Precondition: the story data really has an answer to strip the model from.
    expect(turns.some((turn) => turn.answer)).toBe(true);
    render(
      <ChatFull
        title="T"
        turns={turns}
        composer={composer()}
        sessions={sessions}
        currentId="x"
        query=""
      />,
    );
    const line = screen.getByText(/round/);
    expect(line.textContent).not.toMatch(/^\s*·/);
    const foot = screen.getByText(/sources? · \d+ step/);
    expect(foot.textContent).not.toMatch(/^\s*·/);
    expect(foot.textContent).not.toMatch(/·\s*$/);
  });

  it("shows a dash where nobody measured a process's records", () => {
    const items = data.processes.slice(0, 2).map((item) => ({ ...item, records: null }));
    render(
      <ProcessCollection
        state="ready"
        view="table"
        items={items}
        total={2}
        page={1}
        pageSize={12}
        query=""
        withWarnings={0}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("defaults every session callback to nothing", () => {
    const sessions = data.sessionsVM();
    const p = { title: "T", turns: [], composer: composer(), sessions, currentId: "x", query: "" };
    const { rerender } = render(<ChatFull {...p} menuFor={sessions[0].id} />);
    for (const n of ["Pin", "Rename", "Delete"])
      fireEvent.click(screen.getByRole("menuitem", { name: n }));
    fireEvent.click(screen.getAllByRole("button", { name: `Actions for ${sessions[0].title}` })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(sessions[3].title) })[0]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search sessions" }), {
      target: { value: "q" },
    });
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "As dock" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    rerender(
      <ChatFull
        {...p}
        turns={data.turns("answer")}
        renaming={{ id: sessions[0].id, value: "v" }}
      />,
    );
    fireEvent.change(screen.getByLabelText("New title"), { target: { value: "w" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.submit(screen.getByRole("form", { name: "Rename session" }));
    rerender(<ChatFull {...p} mobile />);
    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    rerender(<ChatFull {...p} turns={data.turns("answer")} />);
    fireEvent.click(
      within(screen.getByRole("complementary", { name: "Sources of this session" })).getAllByRole(
        "button",
      )[0],
    );
    expect(
      screen.getByRole("complementary", { name: "Sources of this session" }),
    ).toBeInTheDocument();
  });

  it("collapses and opens the reading trail on its own", () => {
    const onToggle = jest.fn();
    const { rerender } = render(
      <ReadingTrail steps={data.STEPS_DONE} open={false} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalled();
    rerender(<ReadingTrail steps={[{ label: "x", state: "running" }]} open live />);
    fireEvent.click(screen.getByRole("button"));
    render(<SourceCards sources={data.SOURCES} />);
    fireEvent.click(screen.getAllByRole("button", { name: /commit-gate/ })[0]);
  });
});

/** Palette --------------------------------------------------------------------- */

describe("Palette", () => {
  it("shows recent places with keyboard hints", async () => {
    const on = { onQuery: jest.fn(), onSelect: jest.fn(), onClose: jest.fn() };
    render(<CommandPalette query="" groups={data.PALETTE_RECENT} activeKey="h1" {...on} />);
    expect(screen.getByRole("dialog", { name: "Go to" })).toHaveTextContent("Recently visited");
    expect(screen.getByRole("option", { name: /workspace\/board\/column/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user().click(screen.getByRole("option", { name: /Overview/ }));
    expect(on.onSelect).toHaveBeenCalledWith("overview");
    await user().type(screen.getByRole("combobox"), "a");
    expect(on.onQuery).toHaveBeenCalledWith("a");
    expect(screen.getByText("commands")).toBeInTheDocument();
  });

  it("groups many hits, marks the match and shows all of a group", async () => {
    const onShowAll = jest.fn();
    const groups = data.paletteHits("a", 3);
    render(
      <CommandPalette
        query="a"
        groups={groups}
        total={2000}
        activeKey={null}
        onShowAll={onShowAll}
      />,
    );
    expect(screen.getByText("2,000 matches")).toBeInTheDocument();
    await user().click(
      screen.getByRole("button", {
        name: `show all ${groups[0].total!.toLocaleString("en-US")}`,
      }),
    );
    expect(onShowAll).toHaveBeenCalledWith("records");
    expect(document.querySelectorAll("mark").length).toBeGreaterThan(0);
  });

  it("starts each hit with its kind's mark, names the kind in its tooltip and as the row's description", () => {
    render(
      <CommandPalette
        query="page"
        groups={[
          {
            key: "anchors",
            label: "Anchor",
            kind: "Anchor",
            items: [{ key: "a", icon: "anchor", title: "src/a.ts:3" }],
          },
          {
            key: "plugin:notes",
            label: "Notes",
            kind: "Notes-Page",
            items: [{ key: "w", icon: "plug", glyph: "W", title: "Startseite" }],
          },
        ]}
      />,
    );
    const marks = screen.getAllByTestId("palette-kind-mark");
    expect(marks.map((m) => m.getAttribute("title"))).toEqual(["Anchor", "Notes-Page"]);
    // The kind is the row's description; its name stays the hit.
    expect(screen.getByRole("option", { name: /^src\/a\.ts:3/ })).toHaveAccessibleDescription(
      "Anchor",
    );
    expect(screen.getByRole("option", { name: /^Start/ })).toHaveAccessibleDescription(
      "Notes-Page",
    );
    // A plugin's kind draws the character it chose instead of an icon.
    expect(marks[1]).toHaveTextContent("W");
    expect(marks[1].querySelector("svg")).toBeNull();
  });

  it("gives the mouse a button beside the keyboard's Esc", async () => {
    const onClose = jest.fn();
    render(<CommandPalette query="" groups={data.PALETTE_RECENT} onClose={onClose} />);
    await user().click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Close" })).toHaveTextContent("Esc");
  });

  it("enters command mode with a slash", () => {
    render(<CommandPalette query="/" groups={data.PALETTE_COMMANDS} mobile />);
    expect(screen.getAllByText("commands").length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: /Decisions: New decision/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Theme switch/ }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "x" } });
  });

  it("offers to ask Atlas when nothing matches", async () => {
    const on = { onAsk: jest.fn(), onQuery: jest.fn() };
    const { rerender } = render(
      <CommandPalette query="?ankr" groups={[]} nearest={["anchor"]} {...on} />,
    );
    expect(screen.getByText("No matches for “ankr”")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "anchor" }));
    expect(on.onQuery).toHaveBeenCalledWith("anchor");
    await user().click(screen.getByRole("button", { name: /Ask Atlas: “ankr”/ }));
    expect(on.onAsk).toHaveBeenCalledWith("ankr");
    rerender(<CommandPalette query="#x" groups={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Ask Atlas/ }));
    expect(data.paletteHits("zzzzqq")).toEqual([]);
  });

  it("highlights only when the query occurs", () => {
    const { container, rerender } = render(<Highlight text="Commit-Gate" query="gate" />);
    expect(container.querySelector("mark")).toHaveTextContent("Gate");
    rerender(<Highlight text="Commit" query="zz" />);
    expect(container.querySelector("mark")).toBeNull();
  });
});

/** Motion ---------------------------------------------------------------------- */

describe("Motion", () => {
  it("flies a row into the record and back", async () => {
    const on = { onOpen: jest.fn(), onClose: jest.fn() };
    const { rerender } = render(<FlightDemo rows={data.motionRows} opened={null} {...on} />);
    await user().click(
      screen.getByRole("button", {
        name: new RegExp(`^${data.motionRows[2].id.split("/").pop()}`),
      }),
    );
    expect(on.onOpen).toHaveBeenCalledWith(2);
    rerender(<FlightDemo rows={data.motionRows} opened={2} {...on} />);
    const record = screen.getByRole("article", { name: `Record ${data.motionRows[2].id}` });
    expect(record).toHaveTextContent(data.motionRows[2].summary);
    await user().click(within(record).getByRole("button", { name: "Back" }));
    expect(on.onClose).toHaveBeenCalled();
    rerender(<FlightDemo rows={[{ ...data.motionRows[0], scenarios: 0, proven: 1 }]} opened={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getAllByRole("button")[0]);
  });

  it("staggers, counts up and has a reduced-motion form", () => {
    render(
      <StaggerDemo
        rows={[...data.motionRows, ...data.motionRows].map((r, i) => ({ ...r, id: r.id + i }))}
        run={0}
      />,
    );
    expect(screen.getByRole("list", { name: "Staggered list" }).children).toHaveLength(
      data.motionRows.length * 2,
    );
    render(
      <CountUpBoard run={0} figures={[{ value: 94, label: "proven", tone: "ok", suffix: " %" }]} />,
    );
    expect(screen.getByLabelText("proven: 94 %")).toBeInTheDocument();
    render(<CountUp value={3} label="Anchor" />);
    render(<ReducedMotionDemo rows={data.motionRows} opened={0} />);
    expect(screen.getByText("prefers-reduced-motion: reduce")).toBeInTheDocument();
  });
});

/** Review fixes ------------------------------------------------------------------ */

describe("review fixes", () => {
  it("renders single-star emphasis and English lifecycle labels", () => {
    render(<Markdown source={"What it knows is: *this plugin declares tools.*"} />);
    expect(screen.getByText("this plugin declares tools.").tagName).toBe("EM");
    expect(screen.queryByText(/\*/)).not.toBeInTheDocument();
    render(<LifecycleProbe values={["active", "planned", "custom"]} />);
    expect(screen.getByTestId("lc-active")).toHaveTextContent(/^active$/);
    expect(screen.getByTestId("lc-planned")).toHaveTextContent(/^planned$/);
    expect(screen.getByTestId("lc-custom")).toHaveTextContent(/^custom$/);
  });

  it("caps a board column and links to the rest", async () => {
    const onStatus = jest.fn();
    const counts = data.adrCounts(data.adrs480);
    render(
      <AdrCollection
        state="ready"
        view="board"
        items={data.adrs480}
        total={480}
        counts={counts}
        page={1}
        pageSize={60}
        query=""
        directory="docs/adr"
        onStatus={onStatus}
      />,
    );
    const col = screen.getByRole("region", { name: "accepted" });
    expect(within(col).getAllByRole("button", { name: /ADR/ })).toHaveLength(BOARD_CAP);
    await user().click(
      within(col).getByRole("button", { name: `${nf(counts.accepted - BOARD_CAP)} more` }),
    );
    expect(onStatus).toHaveBeenCalledWith("accepted");
  });

  it("sorts the table by any column and the header says how", async () => {
    const onSort = jest.fn();
    const rows = data.sortAdrs(data.adrs480, "area", "asc").slice(0, 5);
    render(
      <AdrCollection
        state="ready"
        view="table"
        items={rows}
        total={480}
        counts={data.adrCounts(data.adrs480)}
        page={1}
        pageSize={60}
        query=""
        directory="docs/adr"
        sort={{ key: "area", dir: "asc" }}
        onSort={onSort}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Area/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await user().click(
      within(screen.getByRole("columnheader", { name: /Authors/ })).getByRole("button"),
    );
    expect(onSort).toHaveBeenCalledWith("authors");
    const areas = rows.map((r) => r.area);
    expect([...areas].sort((a, b) => a.localeCompare(b, "de"))).toEqual(areas);
    expect(data.sortAdrs(data.adrs480, "number", "asc")[0].number).toBe(1);
    const refs = data.sortAdrs(data.adrs480, "refs", "desc");
    expect(refs[0].refs).toBeGreaterThanOrEqual(refs[refs.length - 1].refs);
    const sup = data.sortAdrs(data.adrs480, "sup", "desc");
    expect(sup[0].supersededBy).toBeDefined();
    const by = data
      .sortAdrs(data.adrs480, "authors", "asc")
      .map((a) => (a.authors ?? []).join(", "));
    expect(by[0].localeCompare(by[by.length - 1], "de")).toBeLessThanOrEqual(0);
  });

  it("shows no percentage for an empty ADR directory", () => {
    render(
      <AdrCollection
        state="empty"
        view="timeline"
        items={[]}
        total={0}
        counts={{ proposed: 0, accepted: 0, superseded: 0, rejected: 0, unknown: 0 }}
        page={1}
        pageSize={60}
        query=""
        directory="docs/adr"
      />,
    );
    expect(screen.getByText(/— accepted/)).toBeInTheDocument();
    expect(screen.queryByText(/0 %/)).not.toBeInTheDocument();
  });

  it("shows the supersession chain with the current ADR marked", async () => {
    const d = data.adrDetail(1);
    const chain = data.adrChain(3);
    const onLink = jest.fn();
    render(<AdrReader {...d} chain={chain} onLink={onLink} />);
    const nav = screen.getByRole("navigation", { name: "Supersession chain" });
    const items = within(nav).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    await user().click(within(items[2]).getByRole("button"));
    expect(onLink).toHaveBeenCalledWith(`adr:${chain[2].number}`);
  });

  it("makes a running answer unmistakable", () => {
    render(<ChatTurn turn={data.turns("streaming")[1]} />);
    const live = screen.getByTestId("answer-live");
    expect(live).toHaveTextContent("Atlas is answering");
    expect(live).toHaveTextContent("9 s");
    expect(live).toHaveTextContent("Read file internal/facet/config.go");
    expect(screen.queryByRole("toolbar", { name: "Answer" })).not.toBeInTheDocument();
  });

  it("hides the composer when the host has no AI", () => {
    render(
      <ChatDock title="T" turns={[]} composer={composer()} hostError="No `claude` in PATH." />,
    );
    expect(screen.getByText("claude").tagName).toBe("CODE");
    expect(screen.queryByLabelText("Question to Atlas")).not.toBeInTheDocument();
  });

  it("names the current session with the right round count", () => {
    const sessions = data.sessionsVM();
    const cur = sessions[data.CURRENT_SESSION];
    render(
      <ChatFull
        title={cur.title}
        continuation="continued"
        turns={data.turns("answer")}
        composer={composer()}
        sessions={sessions}
        currentId={cur.id}
        query=""
      />,
    );
    expect(cur.rounds).toBe(1);
    expect(screen.getByText(/continued · 1 round$/)).toBeInTheDocument();
    expect(new Set(sessions.map((s) => s.title)).size).toBe(sessions.length);
  });

  it("switches between the diagrams of one file", async () => {
    const onDiagram = jest.fn();
    const d = data.diagramById.d2;
    render(
      <ProcessWorkspace
        name="D"
        file="f"
        diagram={d}
        metrics={{ elements: 1, flows: 1, lanes: 1, paths: 1, longest: 1 }}
        panel="detail"
        findings={[]}
        outlineQuery=""
        zoom={100}
        linked={{}}
        diagrams={data.diagramTabs}
        activeDiagram="d2"
        onDiagram={onDiagram}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Diagrams in this file" });
    expect(within(nav).getByRole("button", { name: /Sidecar-Call/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user().click(within(nav).getByRole("button", { name: /Error path/ }));
    expect(onDiagram).toHaveBeenCalledWith("d3");
  });

  it("varies the gallery and keeps the findings count of the real file", () => {
    const sizes = new Set(data.processes.map((p) => p.shapes));
    expect(sizes.size).toBeGreaterThan(3);
    expect(data.processes[0].warnings).toBe(data.processFindings.length);
    expect(data.adrs480.some((a) => / version \d+$/.test(a.title))).toBe(false);
    expect(new Set(data.adrs480.map((a) => a.title)).size).toBe(480);
  });
});

/** English source text ---------------------------------------------------------- */

describe("English source text", () => {
  it("renders the decisions board in English without a provider", () => {
    const counts = data.adrCounts(data.adrs480);
    expect(counts.accepted).toBeGreaterThan(0);
    renderInEnglish(
      <AdrCollection
        state="ready"
        view="board"
        items={data.adrs480}
        total={480}
        counts={counts}
        page={1}
        pageSize={60}
        query=""
        directory="docs/adr"
      />,
    );
    expect(screen.getByRole("heading", { name: "Decisions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New decision" })).not.toBeInTheDocument();
    const col = screen.getByRole("region", { name: "accepted" });
    expect(
      within(col).getByRole("button", { name: `${counts.accepted - BOARD_CAP} more` }),
    ).toBeInTheDocument();
    expect(screen.queryByText(germanLabel("New decision"))).not.toBeInTheDocument();
  });

  it("renders the chat welcome and the empty palette in English", () => {
    renderInEnglish(
      <ChatDock
        title="New"
        turns={[]}
        composer={composer()}
        suggestions={data.SUGGESTIONS}
        roleName="Development"
      />,
    );
    expect(screen.getByText("What do you want to know?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New conversation" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Question to Atlas" })).toBeInTheDocument();
    renderInEnglish(<CommandPalette query="zzz" groups={[]} nearest={["zoo"]} />);
    expect(screen.getByText("No matches for “zzz”")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask Atlas: “zzz”" })).toBeInTheDocument();
    expect(screen.getByText("Did you mean")).toBeInTheDocument();
  });

  it("renders the process gallery in English", () => {
    renderInEnglish(
      <ProcessCollection
        state="ready"
        view="gallery"
        items={data.processes.slice(0, 2)}
        total={36}
        page={1}
        pageSize={12}
        query=""
        withWarnings={15}
      />,
    );
    expect(screen.getByText("15 of 36 files have parser findings.")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /^Thumbnail / })).toHaveLength(2);
  });
});

describe("unmeasured and unknown plugin facts", () => {
  it("tells unknown ADR authors apart from none", () => {
    const items = data.adrs480.slice(0, 2);
    renderInEnglish(
      <AdrCollection
        state="ready"
        view="table"
        items={[
          { ...items[0], authors: null },
          { ...items[1], authors: [] },
        ]}
        total={2}
        counts={data.adrCounts(items)}
        page={1}
        pageSize={60}
        query=""
        activeStatus={null}
        directory="docs/adr"
      />,
    );
    const unknown = screen.getByTestId("adr-authors-unknown");
    expect(unknown).toHaveTextContent("—");
    expect(unknown).toHaveAttribute("title", "authors unknown");
    expect(screen.getByTestId("adr-authors-none")).toHaveTextContent("no author named");
  });

  it("leaves an unknown session time and continuation out of the session line", () => {
    const sessions = data
      .sessionsVM()
      .map((s, i) => (i === 0 ? { ...s, when: undefined, continuation: undefined } : s));
    renderInEnglish(
      <ChatFull
        title="T"
        turns={data.turns("answer")}
        composer={composer()}
        sessions={sessions}
        currentId={sessions[1].id}
        query=""
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Sessions" });
    const row = within(nav).getAllByRole("button", { name: new RegExp(sessions[0].title) })[0];
    expect(row).toHaveTextContent(new RegExp(`${sessions[0].title}${sessions[0].rounds} rounds?$`));
  });
});

describe("process canvas draws the sidecar's vocabulary", () => {
  const g = data.shapeGallery;
  const shape = (id: string) => screen.getByTestId(`shape-${id}`);
  const symbol = (id: string) => screen.getByTestId(`symbol-${id}`).getAttribute("data-symbol");

  it("draws events by kind with their trigger symbol", () => {
    renderInEnglish(<ProcessCanvas diagram={g} label="All shapes" />);
    expect(shape("S1")).toHaveAttribute("data-form", "circle");
    expect(symbol("S1")).toBe("message");
    expect(screen.getByRole("button", { name: "Intermediate event (catching): Payment in" })).toBe(
      shape("IC"),
    );
    expect(within(shape("IC")).getByTestId("symbol-IC")).toHaveAttribute("data-symbol", "message");
    expect(shape("IC").querySelectorAll("circle").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("symbol-IT")).toHaveAttribute("data-filled", "true");
    expect(symbol("IT")).toBe("signal");
    expect(symbol("E1")).toBe("terminate");
    expect(screen.getByRole("button", { name: "Boundary event: Late" })).toBe(shape("B1"));
    expect(symbol("B1")).toBe("timer");
    expect(
      within(shape("B1")).getByText((_, el) => el?.getAttribute("data-border") === "double"),
    ).toBeInTheDocument();
    expect(shape("B1").querySelector("[data-dashed]")).not.toBeNull();
  });

  it("draws gateways by kind", () => {
    renderInEnglish(<ProcessCanvas diagram={g} label="All shapes" />);
    expect(screen.getByRole("button", { name: "Parallel gateway: unnamed" })).toBe(shape("G1"));
    expect(symbol("G1")).toBe("parallel");
    expect(symbol("EG")).toBe("event-based");
    expect(symbol("XG")).toBe("exclusive");
    expect(symbol("IG")).toBe("inclusive");
    for (const id of ["G1", "EG", "XG", "IG"])
      expect(shape(id)).toHaveAttribute("data-form", "diamond");
  });

  it("gives each outline row the glyph of its kind and names an unnamed element by its kind", async () => {
    const at = (id: string, kind: string, label: string, x: number) => ({
      id,
      kind,
      label,
      x,
      y: 40,
      w: kind.endsWith("Gateway") ? 50 : kind.endsWith("Event") ? 36 : 100,
      h: kind.endsWith("Gateway") ? 50 : kind.endsWith("Event") ? 36 : 80,
      lane: "P",
    });
    const diagram = {
      box: { x: 0, y: 0, w: 900, h: 200 },
      edges: [],
      shapes: [
        { id: "P", kind: "participant", label: "Order", x: 0, y: 0, w: 900, h: 200 },
        at("S", "startEvent", "Order in", 20),
        at("T", "userTask", "Check order", 100),
        at("X", "exclusiveGateway", "", 260),
        at("PG", "parallelGateway", "", 360),
        at("E", "endEvent", "", 460),
      ],
    };
    const props = {
      name: "D",
      file: "f.bpmn",
      diagram,
      metrics: { elements: 5, flows: 0, lanes: 1, paths: 1, longest: 1 },
      panel: "detail" as const,
      findings: [],
      zoom: 100,
      linked: {},
    };
    const { rerender } = render(<ProcessWorkspace {...props} outlineQuery="" />);
    const outline = screen.getByRole("navigation", { name: "Outline" });
    const row = (name: string) => within(outline).getByRole("button", { name });
    const glyph = (name: string) => row(name).querySelector("svg[data-kind]");
    expect(row("Exclusive gateway")).toBeInTheDocument();
    expect(row("Parallel gateway")).toBeInTheDocument();
    expect(row("End")).toBeInTheDocument();
    expect(within(outline).queryByText("unnamed")).not.toBeInTheDocument();
    expect(glyph("Exclusive gateway")).toHaveAttribute("data-form", "diamond");
    expect(glyph("Parallel gateway")).toHaveAttribute("data-form", "diamond");
    expect(glyph("Check order")).toHaveAttribute("data-form", "roundrect");
    expect(glyph("Order in")).toHaveAttribute("data-form", "circle");
    expect(glyph("End")).toHaveAttribute("data-form", "circle");
    expect(glyph("Exclusive gateway")?.querySelector("path")).not.toBeNull();
    rerender(<ProcessWorkspace {...props} outlineQuery="parallel" />);
    const filtered = screen.getByRole("navigation", { name: "Outline" });
    expect(within(filtered).getByRole("button", { name: "Parallel gateway" })).toBeInTheDocument();
    expect(
      within(filtered).queryByRole("button", { name: "Exclusive gateway" }),
    ).not.toBeInTheDocument();
    rerender(<ProcessWorkspace {...props} outlineQuery="" />);
    const english = screen.getByRole("navigation", { name: "Outline" });
    expect(within(english).getByRole("button", { name: "Exclusive gateway" })).toBeInTheDocument();
  });

  it("draws tasks with their type and markers, and subprocesses open or closed", () => {
    renderInEnglish(<ProcessCanvas diagram={g} label="All shapes" />);
    expect(symbol("T1")).toBe("user");
    expect(symbol("MT")).toBe("manual");
    expect(symbol("BR")).toBe("business-rule");
    expect(symbol("ST")).toBe("send");
    expect(symbol("RT")).toBe("receive");
    expect(symbol("SC")).toBe("script");
    for (const [id, m] of [
      ["T1", "loop"],
      ["T2", "parallel"],
      ["ST", "sequential"],
      ["RT", "compensation"],
      ["AH", "adhoc"],
      ["AH", "collapsed"],
      ["C1", "collapsed"],
      ["CA", "collapsed"],
      ["TX", "collapsed"],
    ])
      expect(within(shape(id)).getByTestId(`marker-${id}-${m}`)).toBeInTheDocument();
    // An open subprocess is a container: drawn before what it holds, which stays on top.
    expect(screen.getByRole("button", { name: "Subprocess: Pack" })).toBe(shape("SP1"));
    expect(shape("SP1").querySelector("[data-expanded]")).not.toBeNull();
    expect(shape("C1").querySelector("[data-expanded]")).toBeNull();
    expect(screen.queryByTestId("marker-SP1-collapsed")).not.toBeInTheDocument();
    const order = (a: string, b: string) =>
      shape(a).compareDocumentPosition(shape(b)) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order("SP1", "T2")).toBeTruthy();
    expect(order("SP1", "B1")).toBeTruthy();
    expect(order("C1", "B1")).toBeTruthy();
    expect(shape("CA").querySelector("[data-thick]")).not.toBeNull();
    expect(shape("TX").querySelectorAll("rect").length).toBeGreaterThanOrEqual(2);
  });

  it("draws pools and lanes as labelled containers, data, a group and an annotation", () => {
    renderInEnglish(<ProcessCanvas diagram={g} label="All shapes" />);
    const pool = screen.getByRole("group", { name: "Participant: Shop" });
    expect(within(pool).getByText("Shop")).toBeInTheDocument();
    const lane = screen.getByRole("group", { name: "Lane: Sales" });
    expect(lane).toHaveAttribute("data-form", "lane");
    expect(within(lane).getByText("Sales")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Participant: Carrier" })).getByTestId(
        "marker-P2-parallel",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Group: Fulfilment" })).toHaveAttribute(
      "data-form",
      "group",
    );
    expect(shape("DO")).toHaveAttribute("data-form", "document");
    expect(within(shape("DO")).getByTestId("marker-DO-collection")).toBeInTheDocument();
    expect(shape("DS")).toHaveAttribute("data-form", "datastore");
    expect(within(shape("TA")).getByText("Signed by the customer")).toBeInTheDocument();
  });

  it("draws message flows dashed with their own ends, and associations without an arrow", () => {
    renderInEnglish(<ProcessCanvas diagram={g} label="All shapes" />);
    const msg = screen.getByTestId("edge-M1");
    expect(msg).toHaveAttribute("data-stroke", "dashed");
    const line = msg.querySelector("polyline")!;
    expect(line).toHaveAttribute("marker-start", "url(#t-d-dot)");
    expect(line).toHaveAttribute("marker-end", "url(#t-d-open)");
    expect(within(msg).getByText("pickup order")).toBeInTheDocument();
    const assoc = screen.getByTestId("edge-A1");
    expect(assoc).toHaveAttribute("data-stroke", "dotted");
    expect(assoc.querySelector("polyline")).not.toHaveAttribute("marker-end");
    expect(screen.getByTestId("edge-F13")).toHaveAttribute("data-start", "slash");
    expect(screen.getByTestId("edge-F16")).toHaveAttribute("data-start", "diamond");
    expect(screen.getByTestId("edge-F1").querySelector("polyline")).toHaveAttribute(
      "marker-end",
      "url(#t-d-arrow)",
    );
  });

  it("keeps containers sharp while a selection dims the rest", () => {
    renderInEnglish(<ProcessCanvas diagram={g} label="All shapes" selected="T1" />);
    expect(shape("T1")).toHaveAttribute("data-state", "focus");
    expect(shape("G1")).toHaveAttribute("data-state", "related");
    expect(shape("RT")).toHaveAttribute("data-state", "dim");
    expect(shape("L1")).not.toHaveAttribute("data-state");
    expect(shape("SP1")).not.toHaveAttribute("data-state");
  });

  it("derives the look from the kind when a diagram has no sidecar vocabulary", () => {
    const diagram: typeof g = {
      box: { x: 0, y: 0, w: 400, h: 100 },
      shapes: [
        { id: "a", kind: "exclusiveGateway", label: "?", x: 0, y: 0, w: 50, h: 50 },
        { id: "b", kind: "serviceTask", label: "Do", x: 100, y: 0, w: 100, h: 60 },
        { id: "c", kind: "intermediateThrowEvent", label: "", x: 250, y: 0, w: 36, h: 36 },
        { id: "d", kind: "subProcess", label: "Sub", x: 300, y: 0, w: 100, h: 60 },
      ],
      edges: [
        {
          id: "x",
          kind: "association",
          label: "",
          points: [
            [0, 0],
            [10, 10],
          ],
        },
        {
          id: "y",
          kind: "messageFlow",
          label: "",
          points: [
            [0, 0],
            [10, 10],
          ],
        },
      ],
    };
    renderInEnglish(<ProcessCanvas diagram={diagram} label="Kinds" />);
    expect(symbol("a")).toBe("exclusive");
    expect(symbol("b")).toBe("service");
    expect(shape("c").querySelectorAll("circle")).toHaveLength(2);
    expect(shape("d").querySelector("[data-expanded]")).toBeNull();
    expect(screen.getByTestId("edge-x").querySelector("polyline")).not.toHaveAttribute(
      "marker-end",
    );
    expect(screen.getByTestId("edge-y")).toHaveAttribute("data-stroke", "dashed");
    expect(screen.getByTestId("edge-y").querySelector("polyline")).toHaveAttribute(
      "marker-end",
      "url(#t-d-arrow)",
    );
  });

  it("draws every trigger, task type and data symbol it knows, and a plain box for an unknown outline", () => {
    const triggers = [
      "message",
      "timer",
      "error",
      "escalation",
      "cancel",
      "compensation",
      "conditional",
      "link",
      "signal",
      "terminate",
      "multiple",
      "parallel-multiple",
    ];
    const events = triggers.flatMap((sym, i) => [
      {
        id: `c-${sym}`,
        kind: "intermediateCatchEvent",
        label: "",
        x: i * 50,
        y: 0,
        w: 36,
        h: 36,
        form: "circle",
        border: "double",
        symbol: sym,
      },
      {
        id: `t-${sym}`,
        kind: "intermediateThrowEvent",
        label: "",
        x: i * 50,
        y: 50,
        w: 36,
        h: 36,
        form: "circle",
        border: "double",
        symbol: sym,
        filled: true,
      },
    ]);
    const others = [
      {
        id: "gc",
        kind: "complexGateway",
        label: "",
        x: 0,
        y: 100,
        w: 50,
        h: 50,
        form: "diamond",
        symbol: "complex",
      },
      {
        id: "gs",
        kind: "eventBasedGateway",
        label: "",
        x: 60,
        y: 100,
        w: 50,
        h: 50,
        form: "diamond",
        symbol: "event-based-start",
      },
      {
        id: "gp",
        kind: "eventBasedGateway",
        label: "",
        x: 120,
        y: 100,
        w: 50,
        h: 50,
        form: "diamond",
        symbol: "parallel-event-based-start",
      },
      {
        id: "ri",
        kind: "receiveTask",
        label: "Start on mail",
        x: 180,
        y: 100,
        w: 100,
        h: 60,
        form: "roundrect",
        symbol: "receive-instantiate",
      },
      {
        id: "di",
        kind: "dataInput",
        label: "In",
        x: 300,
        y: 100,
        w: 36,
        h: 50,
        form: "document",
        symbol: "input",
      },
      {
        id: "do",
        kind: "dataOutput",
        label: "Out",
        x: 350,
        y: 100,
        w: 36,
        h: 50,
        form: "document",
        symbol: "output",
      },
      {
        id: "ev",
        kind: "subProcess",
        label: "On error",
        x: 400,
        y: 100,
        w: 200,
        h: 100,
        form: "roundrect",
        border: "dotted",
      },
      {
        id: "xx",
        kind: "choreographyTask",
        label: "Unknown",
        x: 620,
        y: 100,
        w: 100,
        h: 60,
        form: "rect",
      },
    ];
    renderInEnglish(
      <ProcessCanvas
        diagram={{ box: { x: 0, y: 0, w: 720, h: 200 }, shapes: [...events, ...others], edges: [] }}
        label="Symbols"
      />,
    );
    for (const sym of triggers) {
      expect(symbol(`c-${sym}`)).toBe(sym);
      expect(screen.getByTestId(`symbol-t-${sym}`)).toHaveAttribute("data-filled", "true");
    }
    expect(symbol("gc")).toBe("complex");
    expect(symbol("gs")).toBe("event-based-start");
    expect(symbol("gp")).toBe("parallel-event-based-start");
    expect(symbol("ri")).toBe("receive-instantiate");
    expect(symbol("di")).toBe("input");
    expect(symbol("do")).toBe("output");
    expect(shape("ev").querySelector("[data-dotted]")).not.toBeNull();
    expect(within(shape("ev")).getByText("On error")).toBeInTheDocument();
    expect(shape("xx")).toHaveAttribute("data-form", "rect");
    expect(screen.getByRole("button", { name: "choreographyTask: Unknown" })).toBe(shape("xx"));
  });

  it("names the new kinds in German", () => {
    render(<ProcessCanvas diagram={g} label="All shapes" />);
    expect(screen.getByRole("button", { name: "Boundary event: Late" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Lane: Sales" })).toBeInTheDocument();
  });
});

describe("long ADRs fold, the header reads as facts and the status is a label", () => {
  const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");
  const long = [
    "Vorspann " + words(10),
    "## 1. Decision",
    words(200),
    "## 2. The question",
    words(200),
    "### 2.1 Unterpunkt",
    words(50),
    "## 3. Consequences",
    words(100),
  ].join("\n\n");
  const adr = {
    number: 2,
    title: "The newest edit wins a sync conflict",
    status: "proposed" as const,
    rawStatus: "proposed",
    date: "2026-09-20",
    file: "docs/adr/0002-sync-conflicts.md",
    authors: null,
  };

  it("folds H2 sections above 500 words: the first opens, the rest stay closed", () => {
    render(<AdrReader adr={adr} markdown={long} toc={[]} records={[]} />);
    const folds = screen.getAllByTestId("md-fold") as HTMLDetailsElement[];
    expect(folds).toHaveLength(3);
    expect(folds.map((f) => f.open)).toEqual([true, false, false]);
    // H3 stays inside its H2 section.
    expect(within(folds[1]).getByRole("heading", { name: "2.1 Unterpunkt" })).toBeInTheDocument();
    // The heading is the switch and carries the id an address names.
    const summary = folds[1].querySelector("summary") as HTMLElement;
    expect(within(summary).getByRole("heading", { name: "2. The question" })).toHaveAttribute(
      "id",
      "2-the-question",
    );
    // Text before the first heading is not folded away.
    expect(screen.getByText(/^Vorspann/).closest("details")).toBeNull();
  });

  it("opens the section an address names, also around a nested heading", () => {
    const { rerender } = render(
      <AdrReader adr={adr} markdown={long} toc={[]} records={[]} anchor="3-consequences" />,
    );
    let folds = screen.getAllByTestId("md-fold") as HTMLDetailsElement[];
    expect(folds.map((f) => f.open)).toEqual([true, false, true]);
    rerender(<AdrReader adr={adr} markdown={long} toc={[]} records={[]} anchor="2-1-unterpunkt" />);
    folds = screen.getAllByTestId("md-fold") as HTMLDetailsElement[];
    expect(folds[1].open).toBe(true);
  });

  it("stays open below the threshold", () => {
    render(
      <AdrReader adr={adr} markdown={"## One\n\nkurz\n\n## Two\n\nkurz"} toc={[]} records={[]} />,
    );
    expect(screen.queryAllByTestId("md-fold")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Two" })).toHaveAttribute("id", "two");
  });

  it("names headings with the ids the reader gives them", () => {
    expect(markdownHeadings("# A\n\n## B `c`\n\n## B `c`\n\ntext")).toEqual([
      { id: "a", label: "A", level: 1 },
      { id: "b-c", label: "B c", level: 2 },
      { id: "b-c-2", label: "B c", level: 2 },
    ]);
    render(<Markdown source={"## B `c`\n\n## B `c`"} anchors />);
    expect(screen.getAllByRole("heading").map((h) => h.id)).toEqual(["b-c", "b-c-2"]);
  });

  it("shows header lines as key and value, and the status as a label with nothing to press", () => {
    render(
      <AdrReader
        adr={adr}
        markdown="## One"
        facts={[
          ["Concerns", "Milestone planning"],
          ["Sources", "`cmd/facet/lsp.go`, `bin/facet`"],
        ]}
        toc={[]}
        records={[]}
      />,
    );
    const front = screen.getByTestId("adr-front");
    const terms = within(front)
      .getAllByRole("term")
      .map((t) => t.textContent);
    expect(terms).toEqual(["Concerns", "Sources"]);
    expect(within(front).getByText("cmd/facet/lsp.go").tagName).toBe("CODE");
    const status = screen.getByTestId("adr-status");
    expect(status).toHaveTextContent("Status:proposed");
    expect(within(status).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /status/ })).not.toBeInTheDocument();
  });
});

describe("plugin page heads keep their distance to what follows", () => {});
