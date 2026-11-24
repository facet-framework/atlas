import { germanLabel } from "@/i18n/testing-labels.spec-support";
import { act, screen, within, fireEvent } from "@testing-library/react";
import { renderInEnglish as render, renderInEnglish as renderEnglish } from "../testing";
import userEvent from "@testing-library/user-event";
import { HISTORY } from "../../fixtures/shell";
import { OVERVIEW_ROLE_KEYS, OverviewPage, type OverviewRole } from "./OverviewPage";
import { ProductPage, visibleAt } from "./ProductPage";
import { DomainPage } from "./DomainPage";
import { CapabilityPage, byColumn } from "./CapabilityPage";
import {
  ConnectionBanner,
  EmptyHistoryHint,
  NotFoundPage,
  PlacesOverlay,
  PlacesSheet,
  StaleFrame,
  StartPage,
} from "./StatusPages";
import { PathBar } from "./parts";
import { SUMMARY } from "../../fixtures/summary";
import { BandChart, Pyramid, Ring, TrendChart, pct, shareFill, shareTone } from "./charts";
import { clampView, layoutCity, panView, squarify, turnCity, wrapLabel, zoomView } from "./city";
import {
  CREATION_DATES,
  DOMAINS,
  FEATURES,
  TEAM_NAMES,
  allFilled,
  allProven,
  capabilityData,
  domainData,
  emptyRegistry,
  generatedFeatures,
  overviewModel,
  manyDrift,
  manyPlaces,
  noDrift,
  noTests,
  oneTeam,
} from "./data.spec-support";

const M = overviewModel();

describe("OverviewPage", () => {
  it("renders 1287 of 1293 as 99 percent in the leadership finding", () => {
    render(
      <OverviewPage
        reader="leadership"
        model={{ ...M, totals: { ...M.totals, proven: 1287, scenarios: 1293 } }}
      />,
    );
    const figure = screen.getByTestId("overview").querySelector(".t-hero-number");
    expect(figure).toHaveTextContent("99%");
    expect(figure).not.toHaveTextContent("100%");
  });
  it.each(OVERVIEW_ROLE_KEYS)("renders the %s role with its next steps", (role) => {
    render(<OverviewPage reader={role as OverviewRole} model={M} teamNames={TEAM_NAMES} />);
    expect(screen.getByTestId("overview")).toHaveAttribute("data-role", role);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(
      within(screen.getByRole("complementary", { name: "Next steps" })).getAllByRole("listitem")
        .length,
    ).toBeGreaterThan(0);
  });

  it("weights findings per role: drift leads for developers, knowledge for authors", () => {
    const { unmount } = render(<OverviewPage reader="dev" model={M} />);
    const first = () =>
      within(screen.getByRole("complementary", { name: "Next steps" })).getAllByRole("listitem")[0];
    expect(first()).toHaveTextContent("Check 18 files with drift");
    unmount();
    render(<OverviewPage reader="author" model={M} />);
    expect(first()).toHaveTextContent("Fill in knowledge in 122 records");
  });

  it("leads the management view with the proven share and fires navigation", async () => {
    const onNavigate = jest.fn();
    const onOpenRecord = jest.fn();
    render(
      <OverviewPage
        reader="leadership"
        model={M}
        onNavigate={onNavigate}
        onOpenRecord={onOpenRecord}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "83 promises are not named by any test yet.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Open promises" }));
    expect(onNavigate).toHaveBeenCalledWith("promises");
    await userEvent.click(
      within(screen.getByRole("group", { name: "Areas" })).getAllByRole("button")[0],
    );
    expect(onNavigate).toHaveBeenLastCalledWith(expect.stringMatching(/^domain\//));
    await userEvent.click(
      within(screen.getByRole("list", { name: "At risk" })).getAllByRole("button")[0],
    );
    expect(onOpenRecord).toHaveBeenCalled();
    await userEvent.click(
      within(screen.getByRole("complementary", { name: "Next steps" })).getAllByRole("button")[0],
    );
    expect(onNavigate).toHaveBeenCalledTimes(3);
  });

  it("reports to leadership without a schema word, no record, anchor, drift or scenario", () => {
    renderEnglish(<OverviewPage reader="leadership" model={M} teamNames={TEAM_NAMES} />);
    // The eyebrow line names the branch and the version; the report starts below it.
    const report = screen.getByTestId("overview-grid");
    expect(report.textContent).not.toMatch(/\brecords?\b|\banchor|\bdrift|\bscenarios?\b|proves/i);
    expect(screen.getByRole("region", { name: "This week" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "At risk" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Who holds what" })).getAllByRole("listitem"),
    ).toHaveLength(M.owners.length);
    expect(screen.getByRole("region", { name: "Open questions" })).toHaveTextContent(
      /\d+ features? without an owner.*\d+ questions? wait/,
    );
  });

  it("calls a named test an association, never a check or a proof, in either language", () => {
    const { unmount } = renderEnglish(<OverviewPage reader="leadership" model={M} />);
    const en = screen.getByTestId("overview-grid");
    expect(en.textContent).not.toMatch(/checked|proven|proof|executed|\brun\b|passed/i);
    expect(
      within(screen.getByTestId("overview-kpis")).getByText("Promises with a test named"),
    ).toBeInTheDocument();
    unmount();
    render(<OverviewPage reader="leadership" model={M} />);
    const de = screen.getByTestId("overview-grid");
    expect(de.textContent).not.toMatch(/checked|proven|Evidence|executed|passed/);
    expect(
      within(screen.getByTestId("overview-kpis")).getByText("Promises with a test named"),
    ).toBeInTheDocument();
  });

  it("says when this week cannot be measured, never that nothing changed", () => {
    const undated = { ...M, features: M.features.map((f) => ({ ...f, createdAt: null })) };
    renderEnglish(<OverviewPage reader="leadership" model={undated} />);
    expect(screen.getByTestId("overview-leadership-week-unmeasured")).toHaveTextContent(
      "— · not measured",
    );
  });

  it("names the features written down in the seven days before the scan", () => {
    const asOf = "2026-10-20 08:00";
    const features = M.features.map((f, i) => ({
      ...f,
      createdAt: i < 2 ? "2026-10-18" : "2026-09-01",
    }));
    renderEnglish(
      <OverviewPage
        reader="leadership"
        model={{ ...M, features, project: { ...M.project, generatedAt: asOf } }}
      />,
    );
    const week = screen.getByTestId("overview-leadership-week");
    expect(week).toHaveTextContent("2 features written down.");
    expect(within(week).getAllByRole("button")).toHaveLength(2);
  });

  it("shows the generative section the app passes below the key figures", () => {
    renderEnglish(
      <OverviewPage
        reader="leadership"
        model={M}
        generative={<div data-testid="gen-slot">tiles</div>}
      />,
    );
    const kpis = screen.getByTestId("overview-kpis");
    const gen = screen.getByTestId("gen-slot");
    expect(kpis.compareDocumentPosition(gen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says nothing is open when everything is proven", () => {
    render(<OverviewPage reader="leadership" model={allProven(M)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "A test names every promise in the product.",
    );
  });

  it("shows a skeleton with dashes while loading, never zeros", () => {
    render(<OverviewPage reader="leadership" model={M} state="loading" />);
    expect(screen.getByTestId("overview-loading")).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByText("—").length).toBeGreaterThan(3);
  });

  it("offers a first record on an empty register and marks unmeasured counts", async () => {
    const onNavigate = jest.fn();
    const onCopy = jest.fn();
    render(
      <OverviewPage
        reader="leadership"
        model={emptyRegistry(M)}
        onNavigate={onNavigate}
        onCopy={onCopy}
      />,
    );
    expect(screen.getByText("The register is empty")).toBeInTheDocument();
    expect(screen.getByText("Scenarios named by a test · not measured")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Write the first record/ }));
    await userEvent.click(screen.getByRole("button", { name: /Copy facet init/ }));
    expect(onNavigate).toHaveBeenCalledWith("records/new");
    expect(onCopy).toHaveBeenCalledWith("facet init");
  });

  it("pages through many drifted files and opens their records", async () => {
    const onDriftPage = jest.fn();
    const onOpenRecord = jest.fn();
    render(
      <OverviewPage
        reader="dev"
        model={manyDrift(M)}
        driftPage={2}
        onDriftPage={onDriftPage}
        onOpenRecord={onOpenRecord}
      />,
    );
    expect(screen.getByText("11–20 of 140")).toBeInTheDocument();
    expect(within(screen.getByTestId("drift-list")).getAllByRole("listitem")).toHaveLength(10);
    await userEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(onDriftPage).toHaveBeenCalledWith(3);
    await userEvent.click(within(screen.getByTestId("drift-list")).getAllByRole("button")[0]);
    expect(onOpenRecord).toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "Drift by day" })).toBeInTheDocument();
  });

  it("calms down without drift", () => {
    render(<OverviewPage reader="dev" model={noDrift(M)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "No code has moved away from its record.",
    );
    expect(screen.getByText("No drift")).toBeInTheDocument();
  });

  it("puts the drift mark beside the finding, offset by the share of records with drift", () => {
    const { rerender } = render(<OverviewPage reader="dev" model={manyDrift(M)} />);
    const records = new Set(manyDrift(M).drift.map((d) => d.record)).size;
    const share = Math.round((records / M.totals.records) * 100);
    const mark = screen.getByRole("img", {
      name: new RegExp(`^Drift: ${share}\\s*% of records$`),
    });
    expect(mark).toHaveAttribute("data-state", "drift");
    expect(Number(mark.getAttribute("data-offset"))).toBeGreaterThanOrEqual(6);

    rerender(<OverviewPage reader="dev" model={noDrift(M)} />);
    expect(screen.getByRole("img", { name: "No drift" })).toHaveAttribute("data-offset", "0");

    // Not measured is its own finding, never "0" and never level blocks.
    rerender(<OverviewPage reader="dev" model={{ ...noDrift(M), driftMeasured: false }} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Drift not measured.");
    expect(screen.getByRole("img", { name: "Drift not measured" })).toHaveAttribute(
      "data-state",
      "unmeasured",
    );
    expect(screen.queryByText("0")).toBeNull();
  });

  it("names the test gap and shows the pyramid", async () => {
    const onOpenRecord = jest.fn();
    render(<OverviewPage reader="review" model={M} onOpenRecord={onOpenRecord} />);
    expect(screen.getByRole("list", { name: "Tests by kind" })).toHaveTextContent("890");
    await userEvent.click(screen.getByRole("button", { name: "workspace/api/webhook" }));
    expect(onOpenRecord).toHaveBeenCalledWith("workspace/api/webhook");
  });

  it("says no scenario carries a test when none does", () => {
    render(<OverviewPage reader="review" model={noTests(M)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "No scenario carries a test.",
    );
    expect(screen.getByRole("region", { name: "Active records without a test" })).toHaveTextContent(
      /\+\d+/,
    );
  });

  it("shows the knowledge matrix to authors and a full state when everything is filled", async () => {
    const onOpenRecord = jest.fn();
    const { unmount } = render(
      <OverviewPage reader="author" model={M} onOpenRecord={onOpenRecord} />,
    );
    const table = screen.getByRole("table", { name: "Record fields, filled or missing" });
    expect(within(table).getAllByRole("row").length).toBe(13);
    await userEvent.click(within(table).getAllByRole("button")[0]);
    expect(onOpenRecord).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /calendar-group/ }));
    unmount();
    const filled = allFilled(M);
    render(
      <OverviewPage
        reader="author"
        model={{
          ...filled,
          features: filled.features.map((f) => ({
            ...f,
            knowledgeMeasured: true,
            owner: f.owner ?? "core",
            summary: f.summary || "x",
            scenarios: Math.max(1, f.scenarios),
          })),
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Every active record has its knowledge filled in.",
    );
    expect(screen.getByText("All slots filled")).toBeInTheDocument();
  });

  it("measures Knowledge only across active records and reports a partial reading", () => {
    const features = M.features.map((feature, index) =>
      index === 0
        ? { ...feature, lifecycle: "planned" as const, knowledgeMeasured: true, knowledgeOpen: 4 }
        : index === 1
          ? { ...feature, lifecycle: "active" as const, knowledgeMeasured: true, knowledgeOpen: 2 }
          : {
              ...feature,
              lifecycle: "active" as const,
              knowledgeMeasured: false,
              knowledgeOpen: 0,
            },
    );
    render(<OverviewPage reader="author" model={{ ...M, features }} />);
    const active = features.filter((feature) => feature.lifecycle === "active");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      `1 of ${active.length} active records measured · 2 open slots`,
    );
    expect(screen.queryByText("Every active record has its knowledge filled in.")).toBeNull();
  });

  it("names every knowledge column in full for authors", () => {
    render(<OverviewPage reader="author" model={M} />);
    const table = screen.getByTestId("author-knowledge");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual([
      "Record",
      "Intent",
      "Scenarios",
      "Owner",
      "Prerequisite",
      "Not for",
      "Where to find it",
      "Pitfalls",
      "How you notice it",
      "missing",
    ]);
  });

  it("lists every record for authors, emptiest first, across pages", async () => {
    renderEnglish(<OverviewPage reader="author" model={M} />);
    const table = screen.getByTestId("author-knowledge");
    const missing = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((r) => Number(within(r).getAllByRole("cell").at(-1)!.textContent));
    const first = missing();
    expect(first).toEqual([...first].sort((a, b) => b - a));
    expect(screen.getByText(`1–12 of ${M.features.length}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(Math.max(...missing())).toBeLessThanOrEqual(Math.min(...first));
  });

  it("moves the side column below until the author table fits beside it on one line", () => {
    // jsdom lays nothing out: the grid's width and the table's natural width
    // are given here, and the page decides from them as a browser would.
    const natural = 1000;
    let gridWidth = 1300;
    const rect = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const w = this.style.width === "max-content" ? natural : 0;
        return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0 } as DOMRect;
      });
    const client = jest
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(() => gridWidth);
    const observers: (() => void)[] = [];
    const saved = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    try {
      render(<OverviewPage reader="author" model={M} />);
      const grid = screen.getByTestId("overview-grid");
      expect(grid).toHaveAttribute("data-stack", "true");
      gridWidth = 1500;
      act(() => observers.forEach((cb) => cb()));
      expect(grid).not.toHaveAttribute("data-stack");
      expect(screen.getByTestId("author-knowledge").style.width).toBe("");
    } finally {
      globalThis.ResizeObserver = saved;
      rect.mockRestore();
      client.mockRestore();
    }
  });

  it("shows ownership by team and the single-team risk", async () => {
    const onNavigate = jest.fn();
    const { unmount } = render(
      <OverviewPage reader="owner" model={M} teamNames={TEAM_NAMES} onNavigate={onNavigate} />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "One record belongs to no one.",
    );
    expect(screen.getByRole("table", { name: "Area by team" })).toHaveTextContent("Core team");
    await userEvent.click(screen.getByRole("button", { name: /^Without an owner/ }));
    expect(onNavigate).toHaveBeenCalledWith("records?owner=none");
    unmount();
    render(<OverviewPage reader="owner" model={oneTeam(M)} teamNames={TEAM_NAMES} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "One team carries all 220 records.",
    );
  });

  it("asks Atlas a starter question for newcomers", async () => {
    const onAsk = jest.fn();
    render(<OverviewPage reader="newcomer" model={M} onAsk={onAsk} />);
    await userEvent.click(screen.getByRole("button", { name: /What is a promise/ }));
    expect(onAsk).toHaveBeenCalledWith("What is a promise, and which test names it?");
  });

  it("gives an agent the registry state as copyable JSON and unmeasured tool calls as dashes", async () => {
    const onCopy = jest.fn();
    render(<OverviewPage reader="agent" model={M} onCopy={onCopy} />);
    expect(JSON.parse(screen.getByTestId("agent-json").textContent!)).toMatchObject({
      records: 220,
      driftCount: 18,
    });
    expect(within(screen.getByRole("list", { name: "Tools" })).getAllByText("—")).toHaveLength(6);
    await userEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(onCopy).toHaveBeenCalledWith(expect.stringContaining('"driftCount": 18'));
  });

  it("sends unmeasured drift and Knowledge as null without failing the gate", () => {
    const model = {
      ...noDrift(M),
      driftMeasured: false,
      features: M.features.map((feature) => ({ ...feature, knowledgeMeasured: false })),
      lint: { schema: null, anchors: null, proves: null, orphanAnchors: null },
    };
    render(<OverviewPage reader="agent" model={model} />);
    expect(JSON.parse(screen.getByTestId("agent-json").textContent!)).toMatchObject({
      driftCount: null,
      knowledgeOpen: null,
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Commit gate not measured.",
    );
    expect(screen.queryByText("Registry inconsistent, commit gate closed.")).toBeNull();
    expect(screen.getByTestId("overview-agent-figure")).toHaveTextContent("—");
    const driftCheck = screen.getByTestId("overview-agent-check-2");
    expect(driftCheck).toHaveTextContent("Drift");
    expect(driftCheck).toHaveAttribute("data-state", "unmeasured");
  });

  it("marks measured drift as a failed check with its count", () => {
    render(<OverviewPage reader="agent" model={M} />);
    expect(M.drift.length).toBeGreaterThan(0);
    expect(screen.getByTestId("overview-agent-figure")).toHaveTextContent(String(M.drift.length));
    expect(screen.getByTestId("overview-agent-check-2")).toHaveAttribute("data-state", "failed");
  });

  it("never draws an empty tool list: unlisted tools are unmeasured or carry the server's reason", () => {
    const { unmount } = render(<OverviewPage reader="agent" model={{ ...M, tools: null }} />);
    expect(screen.getByTestId("overview-agent-tools-unmeasured")).toHaveTextContent(
      "— · not measured",
    );
    expect(screen.queryByRole("list", { name: "Tools" })).toBeNull();
    unmount();
    render(
      <OverviewPage reader="agent" model={{ ...M, tools: null, toolsReason: "mcp exited" }} />,
    );
    expect(screen.getByTestId("overview-agent-tools-unavailable")).toHaveTextContent(
      "not available: mcp exited",
    );
    expect(screen.queryByRole("list", { name: "Tools" })).toBeNull();
  });

  it("an agent without drift sees a free gate", () => {
    render(
      <OverviewPage
        reader="agent"
        model={{
          ...noDrift(M),
          lint: { schema: true, anchors: true, proves: true, orphanAnchors: 0 },
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Registry consistent, commit gate open.",
    );
  });
});

describe("OverviewPage role surfaces", () => {
  const bare = {
    ...M,
    driftUnproven: undefined,
    deviations: undefined,
    fixes: undefined,
    reach: undefined,
    faq: undefined,
    endpoints: undefined,
  };

  it("shows a developer the promises without a test in the drifted records", async () => {
    const onOpenRecord = jest.fn();
    renderEnglish(<OverviewPage reader="dev" model={M} onOpenRecord={onOpenRecord} />);
    const list = screen.getByRole("list", { name: "Promises without a test in drifted records" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.length).toBe(Math.min(10, M.driftUnproven!.length));
    expect(rows[0]).toHaveTextContent(M.driftUnproven![0].record);
    await userEvent.click(within(rows[0]).getByRole("button"));
    expect(onOpenRecord).toHaveBeenCalledWith(M.driftUnproven![0].record);
  });

  it("shows a reviewer capability → feature → promise, declared deviations and missing docs", async () => {
    const onNavigate = jest.fn();
    renderEnglish(<OverviewPage reader="review" model={M} onNavigate={onNavigate} />);
    const caps = screen.getByRole("list", { name: "Capability → feature → promise" });
    await userEvent.click(within(caps).getAllByRole("button")[0]);
    expect(onNavigate).toHaveBeenCalledWith(expect.stringMatching(/^domain\/[^/]+\/[^/]+$/));
    expect(screen.getByRole("list", { name: "Declared deviations" })).toHaveTextContent(
      "The cache is not populated on the first run.",
    );
    expect(screen.getByTestId("overview-test-undocumented")).toBeInTheDocument();
  });

  it("shows ownership the reach of a record and the history of fixes", () => {
    renderEnglish(<OverviewPage reader="owner" model={M} teamNames={TEAM_NAMES} />);
    const reach = within(screen.getByRole("list", { name: "Reach" })).getAllByRole("listitem");
    expect(reach[0]).toHaveTextContent("4 records depend on it");
    expect(
      within(screen.getByRole("list", { name: "History of fixes" })).getAllByRole("listitem"),
    ).toHaveLength(2);
  });

  it("says a fix without a subject has none, and keeps the whole subject in the row's title", () => {
    const fixes = [
      { record: "a/b/c", subject: "", date: "2026-07-20", full: "fix(core):" },
      {
        record: "a/b/d",
        subject: "keeps the time…",
        date: "2026-07-10",
        full: "fix: keeps the time of day",
      },
    ];
    renderEnglish(<OverviewPage reader="owner" model={{ ...M, fixes }} teamNames={TEAM_NAMES} />);
    const rows = within(screen.getByRole("list", { name: "History of fixes" })).getAllByRole(
      "listitem",
    );
    expect(rows[0]).toHaveTextContent("no subject");
    expect(rows[1]).toHaveTextContent("keeps the time…");
    expect(screen.getByTitle("fix: keeps the time of day")).toHaveTextContent("keeps the time…");
  });

  it("names a knowledge kind no record answers as open, with how many could and who holds them", () => {
    const faqGaps = [{ slot: "discoverability", records: 3, teams: ["tasks", "lists"] }];
    render(<OverviewPage reader="newcomer" model={{ ...M, faqGaps }} />);
    const gap = screen.getByTestId("overview-new-faq-gap");
    expect(gap).toHaveTextContent("open");
    expect(gap).toHaveTextContent("Where to find it");
    expect(
      within(screen.getByRole("region", { name: "Answers the owners wrote" })).getByTestId(
        "overview-new-faq-gaps",
      ),
    ).toBeInTheDocument();
  });

  it("shows a newcomer the answers the owners wrote and the way to the glossary", async () => {
    const onNavigate = jest.fn();
    renderEnglish(<OverviewPage reader="newcomer" model={M} onNavigate={onNavigate} />);
    expect(screen.getByTestId("overview-new-faq")).toHaveTextContent(M.faq![0].question);
    await userEvent.click(screen.getByRole("button", { name: /Glossary/ }));
    expect(onNavigate).toHaveBeenCalledWith("glossary");
  });

  it("gives an agent the endpoints and null wherever nothing was measured", () => {
    renderEnglish(
      <OverviewPage
        reader="agent"
        model={{
          ...M,
          tests: null,
          project: { ...M.project, commit: "—" },
          totals: { ...M.totals, files: null, loc: null },
        }}
      />,
    );
    const json = JSON.parse(screen.getByTestId("agent-json").textContent!);
    expect(json).toMatchObject({ commit: null, files: null, loc: null, tests: null });
    expect(screen.getByRole("list", { name: "Endpoints" })).toHaveTextContent("GET /api/corpus");
  });

  it("marks every role surface the model did not bring as not measured", () => {
    const cases = [
      ["dev", "overview-dev-unproven-unmeasured"],
      ["review", "overview-test-deviations-unmeasured"],
      ["owner", "overview-owner-reach-unmeasured"],
      ["owner", "overview-owner-fixes-unmeasured"],
      ["newcomer", "overview-new-faq-unmeasured"],
      ["agent", "overview-agent-endpoints-unmeasured"],
    ] as const;
    for (const [role, id] of cases) {
      const { unmount } = renderEnglish(<OverviewPage reader={role} model={bare} />);
      expect(screen.getByTestId(id)).toHaveTextContent("— · not measured");
      unmount();
    }
  });
});

describe("OverviewPage says what it could not measure and lets a newcomer search", () => {
  it("does not call an undetermined comparison calm anywhere on the page", () => {
    const unmeasured = { ...noDrift(M), driftMeasured: false };
    const { unmount } = render(<OverviewPage reader="dev" model={unmeasured} />);
    // Precondition: the same model, measured, says "No drift".
    expect(unmeasured.drift).toHaveLength(0);
    expect(screen.getByTestId("overview-dev-drift-unmeasured")).toHaveTextContent(
      "— · not measured",
    );
    expect(screen.queryByText("No drift")).toBeNull();
    unmount();
    render(<OverviewPage reader="leadership" model={unmeasured} />);
    expect(screen.getByRole("group", { name: "Areas" })).not.toHaveTextContent("calm");
  });

  const faq = [
    {
      record: "a/b/import",
      slot: "not_for",
      question: "What is it not for?",
      answer: "No lines.",
      changed: "2026-07-28",
    },
    {
      record: "a/b/import",
      slot: "prerequisite_knowledge",
      question: "Before?",
      answer: "Import the lines.",
      changed: "2026-07-28",
    },
    ...Array.from({ length: 6 }, (_, i) => ({
      record: `a/c/r${i}`,
      slot: "common_pitfalls",
      question: `Error ${i}?`,
      answer: `Answer ${i}.`,
      changed: null,
    })),
  ];

  it("finds an answer by every word of the query, and says so when nothing matches", async () => {
    render(<OverviewPage reader="newcomer" model={{ ...M, faq }} />);
    const search = screen.getByRole("searchbox", { name: "Search the answers" });
    await userEvent.type(search, "import lines");
    const entries = screen.getAllByTestId("overview-new-faq-entry");
    // Both entries of a/b/import hold both words (in the answer or the record id).
    expect(entries).toHaveLength(2);
    await userEvent.type(search, " nowhere");
    expect(screen.queryByTestId("overview-new-faq")).toBeNull();
    expect(screen.getByTestId("overview-new-faq-none")).toHaveTextContent("No answer matches.");
  });

  it("narrows to one kind and back, pages five and dates only what was measured", async () => {
    render(<OverviewPage reader="newcomer" model={{ ...M, faq }} />);
    expect(screen.getAllByTestId("overview-new-faq-entry")).toHaveLength(5);
    expect(screen.getByText("1–5 of 8")).toBeInTheDocument();
    const kinds = screen.getByRole("group", { name: "Kind of answer" });
    const notFor = within(kinds).getByRole("button", { name: /Not for/ });
    await userEvent.click(notFor);
    expect(notFor).toHaveAttribute("aria-pressed", "true");
    const one = screen.getAllByTestId("overview-new-faq-entry");
    expect(one).toHaveLength(1);
    expect(one[0]).toHaveTextContent("No lines.");
    expect(within(one[0]).getByTestId("overview-new-faq-changed")).toHaveTextContent(
      "changed 2026-07-28",
    );
    await userEvent.click(notFor);
    expect(screen.getAllByTestId("overview-new-faq-entry")).toHaveLength(5);
    await userEvent.click(within(kinds).getByRole("button", { name: /Pitfalls/ }));
    // No history for these: no entry names a day.
    expect(screen.queryAllByTestId("overview-new-faq-changed")).toHaveLength(0);
  });

  /** The fixture with only `core` capabilities classified core; every other one supporting. */
  function classified(core: string[]) {
    return {
      ...M,
      domains: M.domains.map((d) => ({
        ...d,
        capabilities: d.capabilities.map((c) => ({
          ...c,
          cls: core.includes(`${d.id}/${c.id}`) ? "core" : "supporting",
        })),
      })),
    };
  }

  it("lists only the core capabilities and counts the supporting ones in one line", () => {
    const d0 = M.domains.find((d) => d.capabilities.length > 1)!;
    const d1 = M.domains.find((d) => d !== d0);
    const core = [`${d0.id}/${d0.capabilities[0].id}`];
    const model = classified(core);
    const supporting = M.domains.reduce((n, d) => n + d.capabilities.length, 0) - 1;
    const records = M.features.filter((f) => `${f.domain}/${f.capability}` !== core[0]).length;
    // Precondition: a second capability in the area and a second area, both left out.
    expect(d0).toBeDefined();
    expect(d1).toBeDefined();
    render(<OverviewPage reader="newcomer" model={model} />);
    const cards = screen.getAllByTestId("overview-new-built-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent(d0.title);
    expect(cards[0]).toHaveTextContent(d0.capabilities[0].title);
    expect(cards[0]).not.toHaveTextContent(d0.capabilities[1].title);
    expect(screen.getByTestId("overview-new-built-rest")).toHaveTextContent(
      `${supporting} more capabilities support the product · ${records} records`,
    );
    expect(screen.queryByTestId("overview-new-built-unclassified")).toBeNull();
  });

  it("lists every area, paged six, and says none is classified when nothing is core", async () => {
    const base = classified([]);
    const model = {
      ...base,
      domains: [...base.domains, ...base.domains.map((d) => ({ ...d, id: `${d.id}-2` }))],
    };
    // Precondition: more areas than one page holds.
    expect(model.domains.length).toBeGreaterThan(6);
    render(<OverviewPage reader="newcomer" model={model} />);
    expect(screen.getAllByTestId("overview-new-built-card")).toHaveLength(6);
    expect(screen.getByTestId("overview-new-built-unclassified")).toHaveTextContent(
      "No capability is classified as core.",
    );
    expect(screen.queryByTestId("overview-new-built-rest")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(screen.getAllByTestId("overview-new-built-card")).toHaveLength(model.domains.length - 6);
  });
});

describe("ProductPage", () => {
  it("draws one tower per record of the taxonomy and selects on click", async () => {
    const onSelect = jest.fn();
    render(<ProductPage domains={DOMAINS} features={FEATURES} view="city" onSelect={onSelect} />);
    const city = screen.getByTestId("city");
    expect(within(city).getAllByRole("button").length).toBe(
      FEATURES.filter((f) => f.domain !== "assumption").length,
    );
    await userEvent.click(screen.getByTestId("tower-workspace/board/column"));
    expect(onSelect).toHaveBeenCalledWith("workspace/board/column");
    fireEvent.keyDown(screen.getByTestId("tower-workspace/board/card"), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("workspace/board/card");
    fireEvent.click(city);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("zooms, moves and turns the city from its buttons and keys", async () => {
    render(<ProductPage domains={DOMAINS} features={FEATURES} view="city" />);
    const city = screen.getByTestId("city");
    const box = () => city.getAttribute("viewBox")!.split(" ").map(Number);
    const whole = box();
    // The precondition: the city starts whole, unturned.
    expect(city).toHaveAttribute("data-zoom", "1.00");
    expect(city).toHaveAttribute("data-turn", "0");

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(city).toHaveAttribute("data-zoom", "1.40");
    expect(box()[2]).toBeCloseTo(whole[2] / 1.4, 0);
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(city).toHaveAttribute("data-zoom", "1.00");

    fireEvent.keyDown(city, { key: "+" });
    const zoomed = box();
    fireEvent.keyDown(city, { key: "ArrowRight" });
    expect(box()[0]).toBeGreaterThan(zoomed[0]);
    fireEvent.keyDown(city, { key: "ArrowDown" });
    expect(box()[1]).toBeGreaterThan(zoomed[1]);
    fireEvent.keyDown(city, { key: "0" });
    expect(box()).toEqual(whole);

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await userEvent.click(screen.getByRole("button", { name: "Show the whole city" }));
    expect(box()).toEqual(whole);

    const tower = screen.getByTestId("tower-workspace/board/column");
    const before = tower.querySelector("polygon")!.getAttribute("points");
    await userEvent.click(screen.getByRole("button", { name: "Turn right" }));
    expect(city).toHaveAttribute("data-turn", "1");
    expect(tower.querySelector("polygon")!.getAttribute("points")).not.toBe(before);
    await userEvent.click(screen.getByRole("button", { name: "Turn left" }));
    expect(city).toHaveAttribute("data-turn", "0");
    expect(tower.querySelector("polygon")!.getAttribute("points")).toBe(before);
  });

  it("zooms with the wheel instead of scrolling the page", () => {
    render(<ProductPage domains={DOMAINS} features={FEATURES} view="city" />);
    const city = screen.getByTestId("city");
    const wheel = new WheelEvent("wheel", { deltaY: -200, bubbles: true, cancelable: true });
    act(() => {
      city.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    expect(Number(city.getAttribute("data-zoom"))).toBeGreaterThan(1);
  });

  it("names every capability whole in the city and counts the strip in words", () => {
    const { container } = render(<ProductPage domains={DOMAINS} features={FEATURES} view="city" />);
    const caps = DOMAINS.flatMap((d) => d.capabilities.map((c) => [`${d.id}/${c.id}`, c.title]));
    // The precondition: some capability name is longer than its block is wide.
    expect(
      container.querySelectorAll("[data-testid^='city-cap-'] tspan + tspan").length,
    ).toBeGreaterThan(0);
    for (const [key, title] of caps) {
      const cap = screen.getByTestId(`city-cap-${key}`);
      expect(cap.textContent).not.toContain("…");
      const words = [...cap.querySelectorAll("tspan")].map((t) => t.textContent).join(" ");
      expect(words.replace(/\s+/g, "")).toBe(title.replace(/\s+/g, ""));
    }
  });

  it("counts records and capabilities in the strip in singular and plural", () => {
    // One district keeps a single record, so the singular is drawn at all.
    const first = DOMAINS[0].id;
    const one = FEATURES.find((f) => f.domain === first)!;
    const features = [one, ...FEATURES.filter((f) => f.domain !== first)];
    render(<ProductPage domains={DOMAINS} features={features} view="city" />);
    const rows = within(screen.getByRole("list", { name: /Areas/ })).getAllByRole("listitem");
    expect(rows).toHaveLength(DOMAINS.length);
    DOMAINS.forEach((d, i) => {
      const n = features.filter((f) => f.domain === d.id).length;
      const m = d.capabilities.length;
      expect(rows[i]).toHaveTextContent(
        `${n} ${n === 1 ? "record" : "records"} · ${m} ${m === 1 ? "capability" : "capabilities"}`,
      );
    });
    expect(rows[0]).toHaveTextContent("1 record ·");
  });

  it("opens a district from its label and the strip", async () => {
    const onOpenDomain = jest.fn();
    render(
      <ProductPage domains={DOMAINS} features={FEATURES} view="city" onOpenDomain={onOpenDomain} />,
    );
    await userEvent.click(screen.getByRole("link", { name: "Tasks" }));
    expect(onOpenDomain).toHaveBeenCalledWith("tasks");
    fireEvent.keyDown(screen.getByRole("link", { name: "Notifications" }), { key: " " });
    expect(onOpenDomain).toHaveBeenLastCalledWith("notifications");
  });

  it("shows the selection beside the city and opens its record", async () => {
    const onOpenRecord = jest.fn();
    const onOpenCapability = jest.fn();
    const onSelect = jest.fn();
    render(
      <ProductPage
        domains={DOMAINS}
        features={FEATURES}
        view="city"
        selected="workspace/board/column"
        onOpenRecord={onOpenRecord}
        onOpenCapability={onOpenCapability}
        onSelect={onSelect}
      />,
    );
    const sel = screen.getByTestId("selection");
    expect(sel).toHaveTextContent("19 / 19 scenarios test named");
    await userEvent.click(within(sel).getByRole("button", { name: /Open record/ }));
    expect(onOpenRecord).toHaveBeenCalledWith("workspace/board/column");
    await userEvent.click(within(sel).getByRole("button", { name: "workspace / board" }));
    expect(onOpenCapability).toHaveBeenCalledWith("workspace", "board");
    await userEvent.click(within(sel).getByRole("button", { name: "Clear selection" }));
    expect(onSelect).toHaveBeenCalledWith(null);
    await userEvent.click(screen.getByTestId("tower-workspace/board/column"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("puts the selection in a sheet on mobile", () => {
    render(
      <ProductPage
        domains={DOMAINS}
        features={FEATURES}
        view="city"
        selected="workspace/board/column"
        mobile
      />,
    );
    expect(screen.getByRole("dialog", { name: "column" })).toBeInTheDocument();
  });

  it("switches views and draws a treemap", async () => {
    const onView = jest.fn();
    const onSelect = jest.fn();
    render(
      <ProductPage
        domains={DOMAINS}
        features={FEATURES}
        view="treemap"
        selected="notifications/channels/badge"
        onView={onView}
        onSelect={onSelect}
      />,
    );
    const map = screen.getByTestId("treemap");
    expect(map).toHaveAttribute("data-dim", "true");
    await userEvent.click(within(map).getAllByRole("button")[0]);
    expect(onSelect).toHaveBeenCalled();
    fireEvent.keyDown(within(map).getAllByRole("button")[1], { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("radio", { name: /List/ }));
    expect(onView).toHaveBeenCalledWith("list");
  });

  it("names what a mark's size counts in the legend, not in a sentence under the title", () => {
    const { unmount } = render(<ProductPage domains={DOMAINS} features={FEATURES} view="city" />);
    const cityLead = screen.getByText(/^In \d+ areas\./);
    expect(cityLead).not.toHaveTextContent(/\b(shows|height|area|color)\b/);
    expect(screen.getByTestId("product-legend-size")).toHaveTextContent("Height = scenarios");
    unmount();

    render(<ProductPage domains={DOMAINS} features={FEATURES} view="treemap" />);
    const mapLead = screen.getByText(/^In \d+ areas\./);
    expect(mapLead).not.toHaveTextContent(/\b(shows|height|area|color)\b/);
    expect(screen.getByTestId("product-legend-size")).toHaveTextContent("Area = scenarios");
  });

  it("lists records by page and sorts by header", async () => {
    const onSort = jest.fn();
    const onPage = jest.fn();
    const onSelect = jest.fn();
    render(
      <ProductPage
        domains={DOMAINS}
        features={FEATURES}
        view="list"
        page={1}
        sort={{ key: "proven", dir: "asc" }}
        onSort={onSort}
        onPage={onPage}
        onSelect={onSelect}
      />,
    );
    const table = screen.getByRole("grid", { name: "Records in the product" });
    expect(within(table).getAllByRole("row")).toHaveLength(26);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("0%");
    expect(screen.getByRole("columnheader", { name: /Test named/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await userEvent.click(screen.getByRole("button", { name: /Scenarios/ }));
    expect(onSort).toHaveBeenCalledWith("scenarios");
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(onPage).toHaveBeenCalledWith(2);
    await userEvent.click(within(table).getAllByRole("row")[1]);
    expect(onSelect).toHaveBeenCalled();
  });

  it.each(
    ["scenarios", "proven", "anchors", "drift", "lifecycle", "id"].flatMap((key) =>
      (["asc", "desc"] as const).map((dir) => [key, dir] as const),
    ),
  )("orders the list by %s %s and marks that header", (key, dir) => {
    render(
      <ProductPage
        domains={DOMAINS}
        features={FEATURES}
        view="list"
        pageSize={300}
        sort={{ key, dir }}
      />,
    );
    const table = screen.getByRole("grid", { name: "Records in the product" });
    const rank = { active: 0, planned: 1, deprecated: 2 } as Record<string, number>;
    const figure = (f: (typeof FEATURES)[number]): number | string =>
      ({
        scenarios: f.scenarios,
        proven: f.scenarios ? f.proven / f.scenarios : -1,
        anchors: f.anchors,
        drift: f.drift,
        lifecycle: rank[f.lifecycle],
        id: f.id,
      })[key]!;
    const rows = within(table).getAllByRole("row").slice(1);
    const values = rows.map((r) => {
      const text = within(r).getAllByRole("cell")[0].textContent;
      return figure(FEATURES.find((f) => `${f.slug}${f.domain}/${f.capability}` === text)!);
    });
    expect(new Set(values).size).toBeGreaterThan(1);
    const monotonic = values
      .slice(1)
      .every((v, i) => (dir === "asc" ? v >= values[i] : v <= values[i]));
    expect(monotonic).toBe(true);
    const marked = within(table)
      .getAllByRole("columnheader")
      .filter((h) => (h.getAttribute("aria-sort") ?? "none") !== "none");
    expect(marked).toHaveLength(1);
  });

  it("names lifecycles in English and counts the headline like the summary", () => {
    render(<ProductPage domains={DOMAINS} features={FEATURES} view="list" pageSize={300} />);
    const table = screen.getByRole("grid", { name: "Records in the product" });
    expect(within(table).queryByText(germanLabel("active"))).not.toBeInTheDocument();
    expect(within(table).getAllByText("active").length).toBe(SUMMARY.activeFeatures);
    expect(within(table).getByText("planned")).toBeInTheDocument();
    expect(within(table).getByText("deprecated")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      `${SUMMARY.features} features + 1 assumption`,
    );
    expect(
      screen.getByText(
        new RegExp(`In ${SUMMARY.domains} areas. A test names ${SUMMARY.provenPct}%`),
      ),
    ).toBeInTheDocument();
  });

  it("steps back in time and returns to today", async () => {
    const onTime = jest.fn();
    const early = CREATION_DATES.findIndex((d) => d >= "2026-09-01");
    render(
      <ProductPage
        domains={DOMAINS}
        features={FEATURES}
        view="city"
        time={{ dates: CREATION_DATES, index: early }}
        onTime={onTime}
      />,
    );
    expect(screen.getByTestId("time")).toHaveTextContent(CREATION_DATES[early]);
    expect(screen.getByText(/as of 2026-09/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "3" } });
    expect(onTime).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole("button", { name: /Today/ }));
    expect(onTime).toHaveBeenLastCalledWith(CREATION_DATES.length - 1);
  });

  it("filters by creation date and keeps undated records only at the end", () => {
    const early = visibleAt(FEATURES, { dates: CREATION_DATES, index: 0 });
    expect(early.every((f) => f.createdAt === CREATION_DATES[0])).toBe(true);
    expect(
      visibleAt(FEATURES, { dates: CREATION_DATES, index: CREATION_DATES.length - 1 }),
    ).toHaveLength(FEATURES.length);
  });

  it("shows a city skeleton while loading", () => {
    render(<ProductPage domains={DOMAINS} features={FEATURES} view="city" state="loading" />);
    expect(screen.getByTestId("city-loading")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("— Records");
  });

  it("lays out thousands of generated records", () => {
    const many = generatedFeatures(1200);
    const city = layoutCity(DOMAINS, many);
    expect(city.buildings).toHaveLength(1200);
    expect(city.blocks).toHaveLength(15);
  });
});

describe("geometry", () => {
  it("squarifies values into the whole area", () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 60, h: 40 });
    const area = rects.reduce((a, r) => a + r.w * r.h, 0);
    expect(area).toBeCloseTo(2400, 3);
    expect(squarify([], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    expect(squarify([0, 0], { x: 0, y: 0, w: 10, h: 10 })[0].w).toBe(0);
  });

  it("an empty city still has bounds", () => {
    expect(layoutCity([], []).bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it("wraps a name into lines instead of cutting it", () => {
    expect(wrapLabel("Programmatic interfaces", 13)).toEqual(["Programmatic", "interfaces"]);
    expect(wrapLabel("Notes", 8)).toEqual(["Notes"]);
    // A word is never split: one longer than a line stands on its own line.
    expect(wrapLabel("archive", 5)).toEqual(["archive"]);
    expect(wrapLabel("Atlas Konfigurationsdateien", 8)).toEqual(["Atlas", "Konfigurationsdateien"]);
    expect(wrapLabel("Session surface checks", 10).join(" ")).toBe("Session surface checks");
    expect(wrapLabel("Session surface checks", 10)).toEqual(["Session", "surface", "checks"]);
  });

  it("turns the city a quarter at a time and back to where it started", () => {
    const city = layoutCity(DOMAINS, FEATURES);
    const ids = (c: typeof city) => c.buildings.map((b) => [b.feature.id, b.x, b.y]);
    const once = turnCity(city, 1);
    // The precondition: the city has buildings, so a turn has something to move.
    expect(city.buildings.length).toBeGreaterThan(1);
    expect(ids(once)).not.toEqual(ids(city));
    // Every footprint keeps its size; a block's sides swap.
    expect(once.blocks.map((b) => [b.w, b.d])).toEqual(city.blocks.map((b) => [b.d, b.w]));
    const sorted = (c: typeof city) =>
      ids(c).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(sorted(turnCity(city, 4))).toEqual(sorted(city));
    const round = turnCity(turnCity(turnCity(once, 1), 1), 1);
    for (const [a, b] of sorted(round).map((r, i) => [r, sorted(city)[i]])) {
      expect(a[0]).toBe(b[0]);
      expect(a[1]).toBeCloseTo(b[1] as number, 9);
      expect(a[2]).toBeCloseTo(b[2] as number, 9);
    }
    // Painter's order: each building is drawn after the ones behind it.
    for (let i = 1; i < once.buildings.length; i += 1) {
      const p = once.buildings[i - 1];
      const q = once.buildings[i];
      expect(p.x + p.y).toBeLessThanOrEqual(q.x + q.y);
    }
  });

  it("zooms towards a point, pans, and stays within the limits", () => {
    const base = { x: 0, y: 0, w: 1000, h: 500 };
    const closer = zoomView(base, 2, [250, 125], base);
    expect(closer.w).toBe(500);
    // The point under the cursor stays where it was on screen.
    expect((250 - closer.x) / closer.w).toBeCloseTo(250 / 1000, 9);
    let v = base;
    for (let i = 0; i < 40; i += 1) v = zoomView(v, 2, [500, 250], base);
    expect(base.w / v.w).toBeCloseTo(8, 6);
    for (let i = 0; i < 40; i += 1) v = zoomView(v, 0.5, [500, 250], base);
    expect(base.w / v.w).toBeCloseTo(1 / 1.5, 6);
    const moved = panView(closer, 100, 0, base);
    expect(moved.x).toBe(closer.x + 100);
    // The centre never leaves the city.
    const far = panView(closer, 1e6, 1e6, base);
    expect(far.x + far.w / 2).toBe(1000);
    expect(far.y + far.h / 2).toBe(500);
    expect(clampView(base, base)).toEqual(base);
  });
});

describe("charts", () => {
  it("keeps an incomplete share below 100 percent and out of the complete tone", () => {
    expect(pct(1287, 1293)).toBe(99);
    expect(shareTone(pct(1287, 1293))).toBe("warn");
    expect(pct(1293, 1293)).toBe(100);
    expect(shareTone(100)).toBe("ok");
  });

  it("never draws a zero for an unmeasured share", () => {
    render(<Ring value={null} label="Share" />);
    expect(screen.getByRole("img", { name: "Share: —" })).toBeInTheDocument();
    expect(pct(1, 0)).toBeNull();
    expect(shareFill(null)).toBe("var(--t-faint)");
  });

  it("a pyramid without runners says not measured", () => {
    render(<Pyramid mix={null} />);
    expect(screen.getAllByText("not measured")).toHaveLength(3);
  });

  it("a trend needs at least two weeks", () => {
    render(
      <TrendChart points={[{ date: "2026-11-01", scenarios: 3, proven: 1 }]} label="History" />,
    );
    expect(screen.getByTestId("trend-empty")).toBeInTheDocument();
  });

  it("a band names its outliers", () => {
    render(
      <BandChart
        m={{
          key: "k",
          label: "Scenarios per record",
          median: 9,
          low: 2,
          high: 9,
          min: 2,
          max: 33,
          samples: 219,
          below: 0,
          above: 85,
        }}
      />,
    );
    expect(screen.getByTestId("band-k")).toHaveTextContent("85 above");
  });
});

describe("DomainPage", () => {
  const data = domainData("lists");

  it("opens capabilities, neighbours and records", async () => {
    const onOpenCapability = jest.fn();
    const onOpenDomain = jest.fn();
    const onOpenRecord = jest.fn();
    const onNavigate = jest.fn();
    render(
      <DomainPage
        {...data}
        onOpenCapability={onOpenCapability}
        onOpenDomain={onOpenDomain}
        onOpenRecord={onOpenRecord}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lists");
    expect(screen.getByText("314 of 332 scenarios carry a test")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("cap-permissions"));
    expect(onOpenCapability).toHaveBeenCalledWith("permissions");
    await userEvent.click(screen.getAllByRole("button", { name: /Workspace/ })[0]);
    expect(onOpenDomain).toHaveBeenCalledWith("workspace");
    await userEvent.click(screen.getByRole("button", { name: "permissions/admin" }));
    expect(onOpenRecord).toHaveBeenCalledWith("lists/permissions/admin");
    await userEvent.click(screen.getByRole("button", { name: /ADR-0003/ }));
    expect(onNavigate).toHaveBeenCalledWith(expect.stringMatching(/^adr\//));
    await userEvent.click(screen.getByRole("button", { name: "Product" }));
    expect(onNavigate).toHaveBeenLastCalledWith("product");
    expect(screen.getByRole("img", { name: "Dependencies of Lists" })).toBeInTheDocument();
  });

  it("opens sibling domains from the path caret", async () => {
    const onToggleCrumb = jest.fn();
    const onOpenDomain = jest.fn();
    render(
      <DomainPage
        {...data}
        crumbOpen="lists"
        onToggleCrumb={onToggleCrumb}
        onOpenDomain={onOpenDomain}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Show siblings" }));
    expect(onToggleCrumb).toHaveBeenCalledWith("lists");
    await userEvent.click(
      within(screen.getByRole("menu", { name: "Siblings" })).getByRole("menuitem", {
        name: /Delivery/,
      }),
    );
    expect(onOpenDomain).toHaveBeenCalledWith("delivery");
  });

  it("is calm without drift", () => {
    render(<DomainPage {...domainData("notifications")} drift={[]} />);
    expect(screen.getByTestId("no-drift")).toHaveTextContent("No drift in this area.");
  });

  it("offers a first record for a taxonomy-only domain", async () => {
    const onNewRecord = jest.fn();
    render(
      <DomainPage
        {...domainData("delivery")}
        features={[]}
        drift={[]}
        adrs={[]}
        recent={[]}
        links={{ incoming: [], outgoing: [] }}
        onNewRecord={onNewRecord}
      />,
    );
    expect(screen.getByText("Delivery has no records yet")).toBeInTheDocument();
    expect(screen.getAllByText("no record yet")).toHaveLength(2);
    expect(screen.getByText("No decision names a record of this area.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Create the first record/ }));
    expect(onNewRecord).toHaveBeenCalled();
  });

  it("shows the path as one tappable line on mobile, without a back arrow", async () => {
    const onNavigate = jest.fn();
    render(<DomainPage {...data} mobile onNavigate={onNavigate} />);
    const path = screen.getByRole("navigation", { name: "Path" });
    expect(within(path).getAllByRole("button")).toHaveLength(1);
    const items = within(path).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[1]).getByText(/\w/)).toHaveAttribute("aria-current", "page");
    await userEvent.click(within(path).getByRole("button", { name: "Product" }));
    expect(onNavigate).toHaveBeenCalledWith("product");
  });
});

describe("CapabilityPage", () => {
  const data = capabilityData("workspace", "board");

  it("sharpens matching cards and pages the field", async () => {
    const onQuery = jest.fn();
    const onPage = jest.fn();
    const onOpenRecord = jest.fn();
    render(
      <CapabilityPage
        {...data}
        view="field"
        query="repeats"
        onQuery={onQuery}
        onPage={onPage}
        onOpenRecord={onOpenRecord}
      />,
    );
    expect(screen.getByText(/28 of 81 sharp/)).toBeInTheDocument();
    const field = screen.getByRole("list", { name: "Focus map" });
    const items = within(field).getAllByRole("listitem");
    expect(items).toHaveLength(24);
    expect(items[0]).toHaveAttribute("data-depth", "0");
    expect(items[23]).toHaveAttribute("data-depth", "0");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search the capability" }), "x");
    expect(onQuery).toHaveBeenCalledWith("repeatsx");
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(onPage).toHaveBeenCalledWith(2);
    await userEvent.click(screen.getByTestId("card-column"));
    expect(onOpenRecord).toHaveBeenCalledWith("workspace/board/column");
  });

  it("dims cards that do not match on later pages", () => {
    render(<CapabilityPage {...data} view="field" query="repeats" page={2} />);
    const items = within(screen.getByRole("list", { name: "Focus map" })).getAllByRole("listitem");
    expect(items[items.length - 1]).toHaveAttribute("data-depth", "2");
  });

  it("shows a sortable table and opens a sibling capability", async () => {
    const onSort = jest.fn();
    const onOpenCapability = jest.fn();
    const onView = jest.fn();
    render(
      <CapabilityPage
        {...data}
        view="table"
        sort={{ key: "proven", dir: "desc" }}
        crumbOpen="board"
        onSort={onSort}
        onOpenCapability={onOpenCapability}
        onView={onView}
      />,
    );
    expect(
      within(screen.getByRole("grid", { name: "Records of the capability" })).getAllByRole("row"),
    ).toHaveLength(82);
    await userEvent.click(screen.getByRole("button", { name: /Scenarios/ }));
    expect(onSort).toHaveBeenCalledWith("scenarios");
    await userEvent.click(
      within(screen.getByRole("menu", { name: "Siblings" })).getByRole("menuitem", {
        name: /Assistant/,
      }),
    );
    expect(onOpenCapability).toHaveBeenCalledWith("workspace", "assistant");
    await userEvent.click(screen.getByRole("radio", { name: /Focus map/ }));
    expect(onView).toHaveBeenCalledWith("field");
    expect(screen.getByRole("list", { name: "Tests by kind" })).toHaveTextContent("471");
  });

  it.each(
    ["slug", "scenarios", "proven", "tests", "anchors", "knowledge", "drift"].flatMap((key) =>
      (["asc", "desc"] as const).map((dir) => [key, dir] as const),
    ),
  )("orders the table rows by %s %s, as the header claims", (key, dir) => {
    // Every record of this capability is fully proven and few drift, so the
    // rows get varied figures; otherwise a proven sort would look alphabetical.
    const features = data.features.map((f, i) => ({
      ...f,
      proven: Math.max(0, f.scenarios - (i % 3)),
      drift: i % 4,
      tests: f.tests + (i % 5),
    }));
    render(<CapabilityPage {...data} features={features} view="table" sort={{ key, dir }} />);
    const table = screen.getByRole("grid", { name: "Records of the capability" });
    const shown = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].textContent);
    const expected = [...features].sort(byColumn(key, dir)).map((f) => f.slug);
    expect(shown).toEqual(expected);
    // Independent of byColumn: the shown column's figures are monotonic in the claimed direction.
    const figure = (f: (typeof features)[number]): number | string =>
      ({
        slug: f.slug,
        scenarios: f.scenarios,
        proven: f.scenarios ? f.proven / f.scenarios : -1,
        tests: f.tests,
        anchors: f.anchors,
        knowledge: 5 - f.knowledgeOpen,
        drift: f.drift,
      })[key]!;
    const values = shown.map((slug) => figure(features.find((f) => f.slug === slug)!));
    const monotonic = values
      .slice(1)
      .every((v, i) => (dir === "asc" ? v >= values[i] : v <= values[i]));
    expect(monotonic).toBe(true);
    // The precondition: this column actually reorders something in the fixture.
    const alphabetical = expected.join() === [...expected].sort().join();
    expect(key === "slug" || !alphabetical).toBe(true);
    const label = {
      slug: "Record",
      scenarios: "Scenarios",
      proven: "Test named",
      tests: "Tests",
      anchors: "Anchors",
      knowledge: "Knowledge",
      drift: "Drift",
    }[key]!;
    const sortedHeaders = within(table)
      .getAllByRole("columnheader")
      .filter((h) => (h.getAttribute("aria-sort") ?? "none") !== "none");
    expect(sortedHeaders).toHaveLength(1);
    expect(sortedHeaders[0]).toHaveTextContent(label);
    expect(sortedHeaders[0]).toHaveAttribute(
      "aria-sort",
      dir === "asc" ? "ascending" : "descending",
    );
  });

  it("opens records from the proof mosaic and reaches all anchor files", async () => {
    const onOpenRecord = jest.fn();
    const onNavigate = jest.fn();
    render(
      <CapabilityPage {...data} view="field" onOpenRecord={onOpenRecord} onNavigate={onNavigate} />,
    );
    await userEvent.click(
      within(screen.getByRole("group", { name: "Test mosaic" })).getAllByRole("button")[0],
    );
    expect(onOpenRecord).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /all 179 files/ }));
    expect(onNavigate).toHaveBeenCalledWith("anchor");
  });

  it("is empty with a way to the first record", async () => {
    const onNewRecord = jest.fn();
    const onOpenDomain = jest.fn();
    render(
      <CapabilityPage
        {...capabilityData("delivery", "ci")}
        features={[]}
        files={[]}
        drift={[]}
        tests={null}
        view="field"
        onNewRecord={onNewRecord}
        onOpenDomain={onOpenDomain}
      />,
    );
    expect(screen.getByText("Continuous integration has no record yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Create a record/ }));
    await userEvent.click(screen.getByRole("button", { name: /To the area/ }));
    expect(onNewRecord).toHaveBeenCalled();
    expect(onOpenDomain).toHaveBeenCalledWith("delivery");
  });
});

describe("frame and status pages", () => {
  it("boots over the frame and reports its phase", () => {
    render(
      <StartPage
        phase="enumerate"
        progress={null}
        counts={{ records: 220, files: null, anchors: null }}
      />,
    );
    expect(screen.getByTestId("start")).toHaveAttribute("data-phase", "enumerate");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "share not known yet",
    );
  });

  it("tells that the connection is lost and retries on demand", async () => {
    const onRetry = jest.fn();
    const onDismiss = jest.fn();
    render(
      <>
        <ConnectionBanner
          since="14:12"
          attempt={4}
          nextRetryIn={8}
          lastGood="14:11"
          endpoint="127.0.0.1:7878"
          onRetry={onRetry}
          onDismiss={onDismiss}
        />
        <StaleFrame>
          <p>alt</p>
        </StaleFrame>
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Connection to facet ui lost");
    expect(screen.getByText("new attempt in 8 s")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Connect now/ }));
    await userEvent.click(screen.getByRole("button", { name: "Hide notice" }));
    expect(onRetry).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("without a planned retry says so", () => {
    render(
      <ConnectionBanner
        since="14:12"
        attempt={9}
        nextRetryIn={null}
        lastGood="14:11"
        endpoint="x"
      />,
    );
    expect(screen.getByText("no new attempt planned")).toBeInTheDocument();
  });

  it("a missing place offers near matches and ways out", async () => {
    const onOpen = jest.fn();
    const onSearch = jest.fn();
    const onBack = jest.fn();
    const onHome = jest.fn();
    render(
      <NotFoundPage
        path="/record/x"
        kind="Record"
        suggestions={[
          { id: "a", label: "a", sub: "Record", distance: 1 },
          { id: "b", label: "b", sub: "Record", distance: 3 },
        ]}
        onOpen={onOpen}
        onSearch={onSearch}
        onBack={onBack}
        onHome={onHome}
      />,
    );
    expect(screen.getByText("404 · Record not found")).toBeInTheDocument();
    expect(screen.getByText("1 character")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^b/ }));
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    await userEvent.click(screen.getByRole("button", { name: /To the overview/ }));
    expect(onOpen).toHaveBeenCalledWith("b");
    expect([onSearch, onBack, onHome].every((f) => f.mock.calls.length === 1)).toBe(true);
  });

  it("filters many places in the overlay and in the mobile sheet", async () => {
    const places = manyPlaces(64);
    const onFilter = jest.fn();
    const onPick = jest.fn();
    const { unmount } = render(
      <PlacesOverlay entries={places} filter="board" onFilter={onFilter} />,
    );
    expect(screen.getByRole("menu", { name: "History" })).toHaveTextContent("History · 64");
    expect(screen.getByRole("searchbox", { name: "Filter places" })).toHaveValue("board");
    unmount();
    render(<PlacesSheet entries={places} filter="board" onFilter={onFilter} onPick={onPick} />);
    const list = within(screen.getByTestId("places-sheet")).getByRole("list", { name: "Places" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .every((li) => /board/.test(li.textContent!)),
    ).toBe(true);
    await userEvent.click(within(list).getAllByRole("button")[0]);
    expect(onPick).toHaveBeenCalled();
  });

  it("a short history has no filter field", () => {
    render(<PlacesSheet entries={HISTORY} filter="" />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByText("adr-plugin")).toBeInTheDocument();
  });

  it("explains disabled chevrons", () => {
    render(<EmptyHistoryHint />);
    expect(screen.getByRole("tooltip")).toHaveTextContent("No earlier place yet");
  });

  it("a single crumb stays a breadcrumb on mobile", () => {
    render(<PathBar mobile crumbs={[{ key: "p", label: "Product" }]} />);
    expect(screen.getByRole("navigation", { name: "Path" })).toHaveTextContent("Product");
  });
});

describe("English source text", () => {
  it("speaks English on the overview without a provider", () => {
    renderEnglish(<OverviewPage reader="dev" model={M} />);
    expect(screen.getByText("Overview · Developer")).toBeInTheDocument();
    const steps = screen.getByRole("complementary", { name: "Next steps" });
    expect(within(steps).getAllByRole("listitem")[0]).toHaveTextContent(
      "Check 18 files with drift",
    );
    expect(screen.getByRole("list", { name: "Files with drift" })).toBeInTheDocument();
    expect(screen.queryByText(germanLabel("Drift"))).not.toBeInTheDocument();
  });

  it("names the calibration metrics in the reader's language", () => {
    const { unmount } = renderEnglish(<OverviewPage reader="author" model={M} />);
    // Precondition: the model carries the metric under the registry's own name.
    expect(M.calibration.some((c) => c.key === "records per capability")).toBe(true);
    expect(screen.getAllByText("Records per capability").length).toBeGreaterThan(0);
    expect(screen.queryByText(germanLabel("Records per capability"))).not.toBeInTheDocument();
    unmount();
    render(<OverviewPage reader="author" model={M} />);
    expect(screen.getAllByText("Records per capability").length).toBeGreaterThan(0);
  });

  it("names lifecycles and counts the product headline in English", () => {
    renderEnglish(<ProductPage domains={DOMAINS} features={FEATURES} view="list" pageSize={300} />);
    const table = screen.getByRole("grid", { name: "Records in the product" });
    expect(within(table).getAllByText("active").length).toBe(SUMMARY.activeFeatures);
    expect(within(table).queryByText(germanLabel("active"))).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      `${SUMMARY.features} features + 1 assumption`,
    );
    expect(
      screen.getByText(
        new RegExp(`In ${SUMMARY.domains} areas. A test names ${SUMMARY.provenPct}%`),
      ),
    ).toBeInTheDocument();
  });

  it("says a missing place in English", () => {
    renderEnglish(<NotFoundPage path="x/y/z" kind="Record" suggestions={[]} />);
    expect(screen.getByText("404 · Record not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /To the overview/ })).toBeInTheDocument();
  });
});

describe("unmeasured scan figures and commit history", () => {
  const unmeasuredScan: typeof M = {
    ...M,
    totals: { ...M.totals, files: null, loc: null },
    recent: null,
  };

  it("shows an unmeasured file count and line count as dashes, never as zero", () => {
    renderEnglish(<OverviewPage reader="dev" model={unmeasuredScan} />);
    const kpis = screen.getByTestId("overview-kpis");
    const unmeasured = within(kpis)
      .getAllByTestId("metric-value")
      .filter((value) => value.textContent?.includes("not measured"));
    expect(unmeasured).toHaveLength(1);
    for (const value of unmeasured) expect(value).toHaveTextContent("—");
    expect(kpis).toHaveTextContent(`Files anchored · ${M.totals.anchoredFiles} / —`);
    expect(kpis).not.toHaveTextContent("0%");
    const loc = screen.getByTestId("overview-loc");
    expect(loc).toHaveTextContent("— lines");
    expect(loc).toHaveAttribute("title", "not measured");
    expect(
      screen.getByText(`${M.totals.anchoredFiles} anchored · — without an anchor`),
    ).toBeInTheDocument();
  });

  it("says the history was not read instead of showing no commits", () => {
    renderEnglish(<OverviewPage reader="dev" model={unmeasuredScan} />);
    for (const el of screen.getAllByTestId("commits-unmeasured"))
      expect(el).toHaveTextContent("— · not measured");
    expect(screen.queryByTestId("commits-none")).not.toBeInTheDocument();
  });

  it("says a read history without commits has none", () => {
    renderEnglish(<OverviewPage reader="dev" model={{ ...M, recent: [] }} />);
    for (const el of screen.getAllByTestId("commits-none"))
      expect(el).toHaveTextContent("No commits on records yet.");
    expect(screen.queryByTestId("commits-unmeasured")).not.toBeInTheDocument();
  });

  it("keeps the measured figures as before", () => {
    renderEnglish(<OverviewPage reader="dev" model={M} />);
    expect(screen.getByTestId("overview-loc")).not.toHaveAttribute("title");
    expect(screen.queryByTestId("commits-unmeasured")).not.toBeInTheDocument();
    expect(M.totals.files).not.toBeNull();
  });

  it("tells an unread domain history apart on the domain page", () => {
    render(<DomainPage {...domainData("notifications")} recent={null} />);
    expect(screen.getByTestId("commits-unmeasured")).toHaveTextContent("— · not measured");
  });
});
