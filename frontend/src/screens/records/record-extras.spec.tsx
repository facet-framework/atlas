/** The record page reads what a record declares beyond its promises: an
 * Outline's examples, business rules, decisions, a dependency cycle, the
 * author's prose markup, and a lookup beside the page. */

import { fireEvent, screen, within } from "@testing-library/react";
import { renderInEnglish as render } from "../testing";
import { RecordDetailsPage, type RecordDetailsPageProps } from "./RecordDetailsPage";
import { splitParams } from "./parts";
import { recordOf } from "./storyData.spec-support";

const base = recordOf("workspace/board/column");

const outline = {
  id: "a-discount-code-lowers-the-price",
  steps: [
    { kw: "given" as const, text: "a basket of <subtotal> and the code <code>" },
    { kw: "then" as const, text: "the price is <price> and <html> stays text" },
  ],
  proven: true,
  tests: [],
  examples: [
    {
      name: "valid codes",
      columns: ["subtotal", "code", "price"],
      rows: [
        ["100", "TEN", "90"],
        ["50", "TEN", "45"],
      ],
    },
    {
      name: "expired codes",
      columns: ["subtotal", "code", "price"],
      rows: [["100", "OLD", "100"]],
    },
  ],
  caseOf: [{ id: "discount-table", states: "which code lowers the price by how much" }],
};

const plain = {
  id: "a-plain-promise",
  steps: [{ kw: "given" as const, text: "a <b> in prose" }],
  proven: false,
  tests: [],
  deviation: "the `cache` is **stale** until restart",
};

const record = {
  ...base,
  scenarios: [outline, plain],
  scenarioCount: 2,
  provenCount: 1,
  businessRules: [
    {
      id: "discount-table",
      kind: "table" as const,
      states: "which code lowers the price by how much",
      model: "docs/rules/discount.dmn",
      element: "Decision_discount",
      completeness: "claimed" as const,
      cases: [
        { id: "a-discount-code-lowers-the-price", declared: true },
        { id: "a-promise-nobody-wrote", declared: false },
      ],
    },
    {
      id: "rounding",
      kind: "formula" as const,
      states: "prices round half up",
      model: "",
      element: "",
      completeness: null,
      cases: [],
    },
  ],
  decisions: [{ target: "docs/adr/0002-sync-conflicts.md" }, { target: "ADR-0007" }],
  cyclic: true,
};

function props(over: Partial<RecordDetailsPageProps> = {}): RecordDetailsPageProps {
  return { state: "ready", record, tab: "record", now: "2026-11", ...over };
}

describe("an Outline reads as one", () => {
  const params = (card: HTMLElement) =>
    within(card)
      .getAllByTestId("step-param")
      .map((p) => p.textContent);

  it("fills each declared placeholder with the first case and leaves an undeclared one as text", () => {
    render(<RecordDetailsPage {...props()} />);
    const card = screen.getByTestId(`scenario-${outline.id}`);
    expect(params(card)).toEqual(["100", "TEN", "90"]);
    expect(
      within(card)
        .getAllByTestId("step-param")
        .map((p) => p.getAttribute("title")),
    ).toEqual(["Column subtotal", "Column code", "Column price"]);
    expect(card).toHaveTextContent("<html> stays text");
    expect(card).not.toHaveTextContent("<price>");
    // The cases are stepped through, not listed below the promise.
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();
  });

  it("steps through every case of every block, in record order, and stops at both ends", () => {
    render(<RecordDetailsPage {...props()} />);
    const card = screen.getByTestId(`scenario-${outline.id}`);
    const stepper = within(screen.getByTestId(`examples-${outline.id}`));
    const position = () => stepper.getByTestId("example-position").textContent;
    const block = () => stepper.getByTestId("example-block").textContent;
    const previous = stepper.getByRole("button", { name: "Previous example" });
    const next = stepper.getByRole("button", { name: "Next example" });
    expect(position()).toBe("Example 1 of 3");
    expect(block()).toBe("valid codes");
    expect(previous).toBeDisabled();

    fireEvent.click(next);
    expect(position()).toBe("Example 2 of 3");
    expect(params(card)).toEqual(["50", "TEN", "45"]);

    fireEvent.click(next);
    expect(position()).toBe("Example 3 of 3");
    expect(block()).toBe("expired codes");
    expect(params(card)).toEqual(["100", "OLD", "100"]);
    expect(next).toBeDisabled();

    fireEvent.click(previous);
    expect(params(card)).toEqual(["50", "TEN", "45"]);
  });

  it("opens the table of every case, marks the case the steps show, and shows a case chosen from it", () => {
    render(<RecordDetailsPage {...props()} />);
    const card = screen.getByTestId(`scenario-${outline.id}`);
    const stepper = within(screen.getByTestId(`examples-${outline.id}`));
    const toggle = stepper.getByRole("button", { name: "Show table of all examples" });
    // The precondition: closed, the cases are stepped through, not listed.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(stepper.getByRole("button", { name: "Hide table of all examples" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const tables = within(card).getAllByRole("table");
    expect(tables.map((t) => t.getAttribute("aria-label"))).toEqual([
      "valid codes",
      "expired codes",
    ]);
    // Every heading is wrapped, so it takes the table's own heading padding.
    for (const th of within(tables[0]).getAllByRole("columnheader")) {
      expect(th.firstElementChild?.tagName).toBe("SPAN");
    }
    expect(
      within(tables[0])
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["#", "subtotal", "code", "price"]);
    const rows = [
      ...tables[0].querySelectorAll("tbody tr"),
      ...tables[1].querySelectorAll("tbody tr"),
    ];
    expect(rows.map((r) => r.textContent)).toEqual(["1100TEN90", "250TEN45", "3100OLD100"]);
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual(["true", null, null]);

    fireEvent.click(within(tables[1]).getByRole("button", { name: "Show example 3" }));
    expect(stepper.getByTestId("example-position")).toHaveTextContent("Example 3 of 3");
    expect(params(card)).toEqual(["100", "OLD", "100"]);
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual([null, null, "true"]);

    fireEvent.click(rows[1]);
    expect(params(card)).toEqual(["50", "TEN", "45"]);

    fireEvent.click(stepper.getByRole("button", { name: "Hide table of all examples" }));
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();
  });

  it("names the value of a column no step shows beside the case", () => {
    const extra = {
      ...outline,
      examples: [
        {
          name: "",
          columns: ["subtotal", "code", "price", "channel"],
          rows: [["100", "TEN", "90", "web"]],
        },
      ],
    };
    render(<RecordDetailsPage {...props({ record: { ...record, scenarios: [extra, plain] } })} />);
    const stepper = within(screen.getByTestId(`examples-${outline.id}`));
    expect(stepper.getAllByTestId("example-value").map((v) => v.textContent)).toEqual([
      "channel web",
    ]);
    expect(stepper.queryByTestId("example-block")).not.toBeInTheDocument();
  });

  it("leaves a scenario without examples as written: no stepper and no marked step", () => {
    render(<RecordDetailsPage {...props()} />);
    const card = screen.getByTestId(`scenario-${plain.id}`);
    expect(within(card).queryByTestId(`examples-${plain.id}`)).not.toBeInTheDocument();
    expect(within(card).queryByTestId("step-param")).not.toBeInTheDocument();
    expect(card).toHaveTextContent("a <b> in prose");
  });

  it("cuts only placeholders that name a declared column", () => {
    expect(splitParams("<a> and <z>", new Set(["a"]))).toEqual([
      { kind: "param", name: "a" },
      { kind: "text", text: " and <z>" },
    ]);
    expect(splitParams("<a>", new Set())).toEqual([{ kind: "text", text: "<a>" }]);
  });
});

describe("business rules on the record page", () => {
  it("lists each rule with its id, kind, what it fixes and its model, in record order", () => {
    render(<RecordDetailsPage {...props()} />);
    const list = screen.getByTestId("business-rules");
    const rules = within(list)
      .getAllByRole("listitem")
      .filter((li) => li.id.startsWith("brule-"));
    expect(rules.map((r) => r.id)).toEqual(["brule-discount-table", "brule-rounding"]);
    const table = screen.getByTestId("brule-discount-table");
    expect(table).toHaveTextContent("Table");
    expect(table).toHaveTextContent("which code lowers the price by how much");
    expect(within(table).getByTestId("brule-model")).toHaveTextContent(
      "DMN docs/rules/discount.dmn # Decision_discount",
    );
    expect(screen.getByTestId("brule-rounding")).toHaveTextContent("Formula");
  });

  it("prints completeness as a claim on a table and nothing on a formula", () => {
    render(<RecordDetailsPage {...props()} />);
    expect(
      within(screen.getByTestId("brule-discount-table")).getByTestId("brule-completeness"),
    ).toHaveTextContent("completeness claimed");
    expect(
      within(screen.getByTestId("brule-rounding")).queryByTestId("brule-completeness"),
    ).not.toBeInTheDocument();
  });

  it("links a declared case to its promise and shows an undeclared one without a link", () => {
    const onScenarioFilter = jest.fn();
    render(<RecordDetailsPage {...props({ scenarioFilter: "open", onScenarioFilter })} />);
    const rule = screen.getByTestId("brule-discount-table");
    expect(within(rule).getByTestId("brule-case-undeclared").tagName).toBe("SPAN");
    fireEvent.click(within(rule).getByRole("button", { name: outline.id }));
    // The promise filter hid the case; following it lets it through.
    expect(onScenarioFilter).toHaveBeenCalledWith("all");
  });

  it("says when no promise is named as a case of a rule", () => {
    render(<RecordDetailsPage {...props()} />);
    expect(
      within(screen.getByTestId("brule-rounding")).getByTestId("brule-no-case"),
    ).toHaveTextContent("No promise is named as a case of it.");
  });

  it("says an empty list and a missing field differently", () => {
    const { unmount } = render(
      <RecordDetailsPage {...props({ record: { ...record, businessRules: [] } })} />,
    );
    expect(screen.getByTestId("business-rules-empty")).toHaveTextContent("set, empty");
    unmount();
    render(<RecordDetailsPage {...props({ record: { ...record, businessRules: null } })} />);
    expect(screen.getByTestId("business-rules-absent")).toHaveTextContent("not set");
    expect(screen.queryByTestId("business-rules-empty")).not.toBeInTheDocument();
  });

  it("names the rule a promise is a case of, with what it fixes, and nothing on others", () => {
    render(<RecordDetailsPage {...props()} />);
    const line = within(screen.getByTestId(`scenario-${outline.id}`)).getByTestId(
      "case-of-discount-table",
    );
    expect(within(line).getByRole("button", { name: "discount-table" })).toBeInTheDocument();
    expect(line).toHaveTextContent(
      /^Case of\s*discount-table\s*which code lowers the price by how much$/,
    );
    expect(
      within(screen.getByTestId(`scenario-${plain.id}`)).queryByText("Case of"),
    ).not.toBeInTheDocument();
  });
});

describe("decisions and cycles in the relations", () => {
  it("names the decisions in record order and opens the one chosen", () => {
    const onOpenDecision = jest.fn();
    render(<RecordDetailsPage {...props({ onOpenDecision })} />);
    const block = screen.getByTestId("record-decisions");
    expect(
      within(block)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["docs/adr/0002-sync-conflicts.md", "ADR-0007"]);
    fireEvent.click(within(block).getByRole("button", { name: "ADR-0007" }));
    expect(onOpenDecision).toHaveBeenCalledWith("ADR-0007");
    expect(screen.getByTestId("record-decisions-count")).toHaveTextContent("2");
  });

  it("tells an empty list from a field nobody wrote, and counts only the first", () => {
    const { unmount } = render(
      <RecordDetailsPage {...props({ record: { ...record, decisions: [] } })} />,
    );
    expect(screen.getByTestId("record-decisions-empty")).toHaveTextContent(
      "The record names no decision.",
    );
    expect(screen.getByTestId("record-decisions-count")).toHaveTextContent("0");
    unmount();
    render(<RecordDetailsPage {...props({ record: { ...record, decisions: null } })} />);
    expect(screen.getByTestId("record-decisions-absent")).toHaveTextContent("not set");
    expect(screen.queryByTestId("record-decisions-count")).not.toBeInTheDocument();
  });

  it("warns for its own node only", () => {
    const { unmount } = render(<RecordDetailsPage {...props()} />);
    expect(screen.getByTestId("record-cyclic")).toHaveTextContent("dependency cycle or downstream");
    unmount();
    render(<RecordDetailsPage {...props({ record: { ...record, cyclic: false } })} />);
    expect(screen.queryByTestId("record-cyclic")).not.toBeInTheDocument();
  });
});

describe("prose and lookup", () => {
  it("draws summary, steps and a deviation's reason through the host's prose", () => {
    const renderProse = (text: string) => <em data-testid="prose">{text}</em>;
    render(<RecordDetailsPage {...props({ renderProse })} />);
    const card = screen.getByTestId(`scenario-${plain.id}`);
    expect(within(card).getByTestId("scenario-deviation")).toContainElement(
      within(card)
        .getAllByTestId("prose")
        .find((n) => n.textContent === plain.deviation)!,
    );
    expect(within(card).getAllByTestId("prose")[0]).toHaveTextContent("a <b> in prose");
  });

  it("names the tests of a promise as naming it, not as proving it", () => {
    render(
      <RecordDetailsPage
        {...props({
          record: {
            ...record,
            scenarios: [
              { ...plain, proven: true, tests: [{ kind: "Unit", file: "a.spec.ts", name: "x" }] },
            ],
          },
        })}
      />,
    );
    expect(screen.getByRole("list", { name: "Tests naming this promise" })).toBeInTheDocument();
    expect(screen.queryByText("Beweisende Tests")).not.toBeInTheDocument();
  });

  it("shows a looked-up record beside the page and follows or closes it", () => {
    const onFollowLookup = jest.fn();
    const onCloseLookup = jest.fn();
    render(
      <RecordDetailsPage
        {...props({
          lookup: {
            kind: "record",
            id: "policy/demo/rule",
            recordKind: "policy",
            summary: "every rule holds",
            referredBy: [],
          },
          onFollowLookup,
          onCloseLookup,
        })}
      />,
    );
    const lookup = screen.getByRole("complementary", { name: "Lookup: policy/demo/rule" });
    expect(screen.getByTestId("record")).toContainElement(lookup);
    expect(within(lookup).getByTestId("lookup-summary")).toHaveTextContent("every rule holds");
    expect(within(lookup).getByTestId("lookup-unused")).toHaveTextContent(
      "No feature refers to it.",
    );
    fireEvent.click(within(lookup).getByRole("button", { name: "Open record" }));
    expect(onFollowLookup).toHaveBeenCalledWith("policy/demo/rule");
    fireEvent.click(within(lookup).getByTestId("lookup-close"));
    expect(onCloseLookup).toHaveBeenCalled();
  });

  it("reports a target the registry or glossary does not declare", () => {
    render(
      <RecordDetailsPage {...props({ lookup: { kind: "missing", what: "term", id: "Foo" } })} />,
    );
    expect(screen.getByTestId("lookup-missing")).toHaveTextContent(
      "The glossary declares no such term.",
    );
  });

  it("draws a term's category as declared, undeclared or unassigned", () => {
    const term = {
      kind: "term" as const,
      term: "Promise",
      definition: "a promise",
      renderings: ["en: promise"],
      records: ["a/b/c"],
    };
    const { rerender } = render(
      <RecordDetailsPage
        {...props({ lookup: { ...term, category: { label: "core", declared: true } } })}
      />,
    );
    expect(screen.getByTestId("lookup-category")).toHaveTextContent("core");
    expect(screen.getByTestId("lookup-renderings")).toHaveTextContent("en: promise");
    rerender(
      <RecordDetailsPage
        {...props({ lookup: { ...term, category: { label: "tenancy", declared: false } } })}
      />,
    );
    expect(screen.getByTestId("lookup-category")).toHaveTextContent(
      "tenancy · category not declared",
    );
    rerender(<RecordDetailsPage {...props({ lookup: { ...term, category: "unassigned" } })} />);
    expect(screen.getByTestId("lookup-category")).toHaveTextContent("assigned by nobody");
    rerender(<RecordDetailsPage {...props({ lookup: { ...term, category: null } })} />);
    expect(screen.queryByTestId("lookup-category")).not.toBeInTheDocument();
  });

  it("opens the lookup as a bottom sheet on a phone", () => {
    render(
      <RecordDetailsPage
        {...props({
          mobile: true,
          lookup: { kind: "missing", what: "record", id: "x/y/z" },
        })}
      />,
    );
    expect(screen.getByRole("dialog", { name: "x/y/z" })).toContainElement(
      screen.getByTestId("lookup"),
    );
  });
});

describe("dependencies on the record page", () => {
  it("opens a dependency that exists and offers no link for one the registry lacks", () => {
    const onNavigate = jest.fn();
    render(
      <RecordDetailsPage
        {...props({
          mobile: true,
          onNavigate,
          record: {
            ...record,
            dependsOn: [
              { id: "a/b/there", lifecycle: "active" },
              { id: "a/b/gone", missing: true },
            ],
          },
        })}
      />,
    );
    const rel = screen.getByTestId("section-relations");
    expect(within(rel).getByTestId("link-missing")).toHaveTextContent("a/b/gone");
    expect(within(rel).queryByRole("button", { name: "a/b/gone" })).not.toBeInTheDocument();
    fireEvent.click(within(rel).getByRole("button", { name: "a/b/there" }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "record", id: "a/b/there" });
  });
});
