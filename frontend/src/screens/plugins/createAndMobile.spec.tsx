/* eslint jest/expect-expect: ["warn", { "assertFunctionNames": ["expect", "expectDisabledWithReason"] }] */
import { fireEvent, screen, within } from "@testing-library/react";
import { renderInEnglish as render } from "../testing";
import { AdrCollection, AdrEmpty } from "../../../../plugins/adr/src/views/Adr";
import { ProcessWorkspace } from "../../../../plugins/bpmn/src/views/Processes";
import { GlossaryPage } from "../contents/Glossary";
import * as D from "../contents/data.spec-support";
import * as data from "./storyData.spec-support";

const REASON = "Requires write access to the repository.";

/** The button is visible, announced as disabled, described by the reason, and does not act. */
function expectDisabledWithReason(name: string, onCreate: jest.Mock) {
  const button = screen.getByRole("button", { name });
  expect(button).toHaveAttribute("aria-disabled", "true");
  expect(button).toHaveAccessibleDescription(REASON);
  // The reason is on screen, not only in an attribute or a tooltip.
  expect(screen.getAllByText(REASON).length).toBeGreaterThan(0);
  fireEvent.click(button);
  expect(onCreate).not.toHaveBeenCalled();
}

describe("create actions", () => {
  const counts = data.adrCounts(data.adrs480);
  const adrBase = { total: 480, counts, page: 1, pageSize: 60, query: "", directory: "docs/adr" };

  it("AdrCollection uses an available create handler", () => {
    const onCreate = jest.fn();
    render(
      <AdrCollection
        state="ready"
        view="table"
        items={data.adrs480.slice(0, 5)}
        {...adrBase}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New decision" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("AdrCollection without a reason creates as before", () => {
    const onCreate = jest.fn();
    render(
      <AdrCollection
        state="ready"
        view="table"
        items={data.adrs480.slice(0, 5)}
        {...adrBase}
        onCreate={onCreate}
      />,
    );
    const button = screen.getByRole("button", { name: "New decision" });
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAccessibleDescription();
    fireEvent.click(button);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("AdrEmpty omits create controls without a handler", () => {
    render(<AdrEmpty directory="docs/adr" />);
    expect(screen.queryByRole("button", { name: "Create the first decision" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New decision" })).toBeNull();
  });

  it("GlossaryPage disables proposing with a reason, in the list and in the empty state", () => {
    const onPropose = jest.fn();
    const base = {
      terms: D.glossary40,
      letters: D.lettersOf(D.glossary40),
      query: "",
      page: 1,
      pageSize: 50,
      total: D.glossary40.length,
      categories: D.glossaryCategories,
      onPropose,
      proposeDisabledReason: REASON,
    };
    const { rerender } = render(<GlossaryPage {...base} state="ready" />);
    expectDisabledWithReason("Propose a term", onPropose);
    rerender(<GlossaryPage {...base} state="empty" terms={[]} total={0} />);
    expectDisabledWithReason("Propose the first term", onPropose);
  });
});

describe("mobile: every button has a name", () => {
  it("the mobile ADR collection has no unnamed button, and the directory button is named", () => {
    const onSettings = jest.fn();
    render(
      <AdrCollection
        state="ready"
        view="timeline"
        items={data.adrs480.slice(0, 20)}
        total={480}
        counts={data.adrCounts(data.adrs480)}
        page={1}
        pageSize={60}
        query=""
        directory="docs/adr"
        mobile
        onSettings={onSettings}
      />,
    );
    // Precondition: the page rendered its buttons at all.
    expect(screen.getAllByRole("button").length).toBeGreaterThan(5);
    expect(screen.queryAllByRole("button", { name: "" })).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Directory" }));
    expect(onSettings).toHaveBeenCalled();
  });
});

describe("mobile process workspace", () => {
  const props = {
    name: "data flow",
    file: "a.bpmn",
    diagram: data.diagram,
    metrics: { elements: 12, flows: 15, lanes: 3, paths: 2, longest: 6 },
    panel: "detail" as const,
    findings: [],
    outlineQuery: "",
    zoom: 80,
    linked: {},
    mobile: true,
  };

  it("keeps the zoom buttons reachable", () => {
    const onZoom = jest.fn();
    render(<ProcessWorkspace {...props} onZoom={onZoom} />);
    const bar = screen.getByRole("toolbar", { name: "Zoom" });
    expect(within(bar).getByTestId("zoom")).toHaveTextContent("80");
    fireEvent.click(within(bar).getByRole("button", { name: "Zoom in" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Zoom out" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Fit" }));
    expect(onZoom.mock.calls).toEqual([["in"], ["out"], ["fit"]]);
  });

  it("shows all five stats, paths and longest path included", () => {
    render(<ProcessWorkspace {...props} />);
    const stats = within(screen.getByTestId("process-mobile-stats")).getAllByRole("listitem");
    expect(stats.map((s) => s.textContent)).toEqual([
      "12 Elements",
      "15 Flows",
      "3 Lanes",
      "2 Paths start→end",
      "6 longest path",
    ]);
  });

  it("marks unmeasured path counts with a dash", () => {
    render(
      <ProcessWorkspace {...props} metrics={{ ...props.metrics, paths: null, longest: null }} />,
    );
    const stats = within(screen.getByTestId("process-mobile-stats")).getAllByRole("listitem");
    expect(stats[3]).toHaveTextContent("— Paths start→end");
    expect(stats[4]).toHaveTextContent("— longest path");
  });
});
