/** The record page reads what a record declares beyond its promises —
 * an Outline's examples, business rules, decisions, a dependency cycle, the
 * author's prose markup — and looks up a term or a referenced record beside
 * the page. Mounted as the app with a TaskFlow corpus that declares them. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadCorpus, type AtlasModel } from "@/model";
import { FACETRC, INDEX, RECORDS, SCAN } from "@/model/fixtures";
import Atlas from "./Atlas";
import { businessRules, decisionsOf, exampleBlocks, lookupTarget } from "./record-extras";
import { derive } from "@/derive";

const ID = "tasks/create/quick-add";
const FILE = "docs/facets/features/tasks/create/quick-add.yaml";

const DECLARED = `    - id: priority-outline
      statement: |
        Given the input carries <marker> while \`queue\` is empty and the queue waits
        When the user presses Enter
        Then the task gets priority <priority> and <html> stays text
      examples:
        - name: markers
          columns: [marker, priority]
          rows:
            - ["!high", high]
            - ["!low", low]
        - name: unknown markers
          rows:
            - ["!x", none]
  business_rules:
    - id: priority-table
      kind: table
      model: docs/rules/priority.dmn
      element: Decision_priority
      states: which marker sets which priority
      completeness: claimed
      scenarios: [priority-outline, not-a-promise]
    - id: rounding
      kind: formula
      states: due times round to the next quarter hour
verification:`;

const GLOSSARY = `schema_version: "0.1"
terms:
  - term: queue
    definition: |
      The local list of changes that have not synced yet.
    renderings:
      en: queue
`;

function declaringModel(): AtlasModel {
  const records = Object.fromEntries(
    Object.entries(RECORDS).map(([path, text]) => [
      path,
      text.replaceAll("Warteschlange", "queue"),
    ]),
  );
  records[FILE] = records[FILE].replace(/^verification:$/m, DECLARED).replace(
    /(id: empty-title-rejected[\s\S]*?Then [^\n]+\n)/,
    "$1" +
      "      deviation:\n" +
      "        reason: the hint uses `alert()` and the **queue** stays\n" +
      "        confirmed_by: code-review\n",
  );
  const model = loadCorpus({
    facetrc: FACETRC,
    index: INDEX,
    records,
    scan: SCAN,
    glossary: GLOSSARY,
  });
  // Preconditions: every declaration reached the parsed record.
  const rec = model.byId[ID];
  expect(rec.scenarios.map((s) => s.id)).toContain("priority-outline");
  expect(rec.scenarios.find((s) => s.id === "empty-title-rejected")?.deviation?.reason).toContain(
    "alert()",
  );
  expect(model.glossary?.terms.map((t) => t.term)).toEqual(["queue"]);
  return model;
}

const MODEL = declaringModel();

function mount(path: string, model: AtlasModel = MODEL) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} />);
}

let scrolled: Element[];
beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

const where = () => window.location.pathname;

describe("a Scenario Outline on the record page", () => {
  const params = (card: HTMLElement) =>
    within(card)
      .getAllByTestId("step-param")
      .map((n) => n.textContent);

  it("fills each declared placeholder with the first case and leaves an undeclared one as text", () => {
    mount(`/record/${ID}`);
    const card = screen.getByTestId("scenario-priority-outline");
    expect(params(card)).toEqual(["!high", "high"]);
    expect(card).toHaveTextContent("<html> stays text");
    expect(card).not.toHaveTextContent("<marker>");
  });

  it("steps through every case, the second block under the first one's columns", () => {
    mount(`/record/${ID}`);
    const card = screen.getByTestId("scenario-priority-outline");
    const stepper = within(screen.getByTestId("examples-priority-outline"));
    const next = stepper.getByRole("button", { name: "Next example" });
    expect(stepper.getByTestId("example-position")).toHaveTextContent("Example 1 of 3");
    expect(stepper.getByTestId("example-block")).toHaveTextContent("markers");
    fireEvent.click(next);
    expect(params(card)).toEqual(["!low", "low"]);
    fireEvent.click(next);
    // The second block declares no columns: its row fills the first block's.
    expect(stepper.getByTestId("example-block")).toHaveTextContent("unknown markers");
    expect(params(card)).toEqual(["!x", "none"]);
    expect(
      within(card)
        .getAllByTestId("step-param")
        .map((n) => n.getAttribute("data-param")),
    ).toEqual(["marker", "priority"]);
    expect(next).toBeDisabled();
  });

  it("leaves a statement without examples exactly as written", () => {
    mount(`/record/${ID}`);
    const card = screen.getByTestId("scenario-task-added");
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();
    expect(within(card).queryByTestId("step-param")).not.toBeInTheDocument();
    expect(exampleBlocks(MODEL.byId[ID], "task-added")).toEqual([]);
  });
});

describe("a Scenario Outline in the records lens", () => {
  it("fills the steps with the first case, steps through the cases and opens their table", () => {
    mount("/records");
    // The precondition: the lens holds the record that declares the Outline.
    expect(screen.getByTestId("lens-focus-name")).toHaveTextContent("quick-add");
    fireEvent.click(screen.getByRole("button", { name: /priority-outline/ }));
    const stepper = within(screen.getByTestId("examples-priority-outline"));
    const panel = screen.getByRole("tabpanel");
    const params = () =>
      within(panel)
        .getAllByTestId("step-param")
        .map((n) => n.textContent);
    expect(params()).toEqual(["!high", "high"]);
    expect(stepper.getByTestId("example-position")).toHaveTextContent("Example 1 of 3");

    fireEvent.click(stepper.getByRole("button", { name: "Next example" }));
    expect(params()).toEqual(["!low", "low"]);

    fireEvent.click(stepper.getByRole("button", { name: "Show table of all examples" }));
    const tables = within(panel).getAllByRole("table");
    expect(tables.map((t) => t.getAttribute("aria-label"))).toEqual(["markers", "unknown markers"]);
    fireEvent.click(within(tables[1]).getByRole("button", { name: "Show example 3" }));
    expect(params()).toEqual(["!x", "none"]);
  });
});

describe("business rules on the record page", () => {
  it("lists each rule with its id, kind, what it fixes and its DMN model, in record order", () => {
    mount(`/record/${ID}`);
    const block = within(screen.getByTestId("section-rules")).getByTestId("business-rules");
    expect(within(block).getByTestId("brule-priority-table")).toHaveTextContent(
      "which marker sets which priority",
    );
    expect(within(block).getByTestId("brule-priority-table")).toHaveTextContent("Table");
    expect(within(block).getAllByTestId("brule-model")[0]).toHaveTextContent(
      "DMN docs/rules/priority.dmn # Decision_priority",
    );
    expect(businessRules(MODEL.byId[ID])?.map((r) => r.id)).toEqual(["priority-table", "rounding"]);
  });

  it("prints completeness as a claim on the table and nothing on the formula", () => {
    mount(`/record/${ID}`);
    expect(
      within(screen.getByTestId("brule-priority-table")).getByTestId("brule-completeness"),
    ).toHaveTextContent("completeness claimed");
    expect(
      within(screen.getByTestId("brule-rounding")).queryByTestId("brule-completeness"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("brule-rounding")).getByTestId("brule-no-case"),
    ).toHaveTextContent("No promise is named as a case of it.");
  });

  it("opens a declared case's promise and shows an undeclared one without a link", async () => {
    mount(`/record/${ID}`);
    const rule = screen.getByTestId("brule-priority-table");
    expect(within(rule).getByTestId("brule-case-undeclared")).toHaveTextContent("not-a-promise");
    expect(within(rule).queryByRole("button", { name: "not-a-promise" })).not.toBeInTheDocument();
    await userEvent.click(within(rule).getByRole("button", { name: "priority-outline" }));
    expect(scrolled.at(-1)).toBe(screen.getByTestId("scenario-priority-outline"));
    expect(where()).toBe(`/record/${ID}`);
  });

  it("names the rule a promise is a case of with what it fixes, and nothing on others", async () => {
    mount(`/record/${ID}`);
    const line = within(screen.getByTestId("scenario-priority-outline")).getByTestId(
      "case-of-priority-table",
    );
    expect(line).toHaveTextContent(/Case of\s*priority-table\s*which marker sets which priority/);
    expect(
      within(screen.getByTestId("scenario-task-added")).queryByTestId("case-of-priority-table"),
    ).not.toBeInTheDocument();
    await userEvent.click(within(line).getByRole("button", { name: "priority-table" }));
    expect(scrolled.at(-1)).toBe(screen.getByTestId("brule-priority-table"));
  });

  it("says a record without the field has none, apart from one that wrote it empty", () => {
    mount("/record/tasks/recurring/repeat-rule");
    expect(screen.getByTestId("business-rules-absent")).toHaveTextContent(
      "contract.business_rules · not set",
    );
    expect(businessRules({ doc: { contract: { business_rules: [] } }, scenarios: [] })).toEqual([]);
  });
});

describe("decisions a record rests on", () => {
  it("names them in record order and opens the chosen one in the decision reader", async () => {
    mount(`/record/${ID}`);
    const block = within(screen.getByTestId("section-relations")).getByTestId("record-decisions");
    expect(
      within(block)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["ADR-007", "ADR-019"]);
    await userEvent.click(within(block).getByRole("button", { name: "ADR-007" }));
    expect(where()).toBe("/p/adr/ADR-007");
  });

  it("tells an empty list from a missing field and counts only where the field is there", () => {
    expect(decisionsOf({ doc: { intent: { decision_records: [] } } })).toEqual([]);
    expect(decisionsOf({ doc: { intent: {} } })).toBeNull();
    const missing = Object.values(MODEL.byId).find(
      (r) => r.kind === "feature" && decisionsOf(r) === null,
    );
    // Precondition: the corpus has a feature without the field.
    expect(missing).toBeDefined();
    mount(`/record/${missing!.id}`);
    expect(screen.getByTestId("record-decisions-absent")).toBeVisible();
    expect(screen.queryByTestId("record-decisions-count")).not.toBeInTheDocument();
  });
});

describe("a dependency cycle on the record page", () => {
  it("warns exactly when the host reports this record's node", () => {
    // Precondition: the corpus is acyclic, so the warning cannot come from it.
    expect(MODEL.cyclic).toEqual([]);
    const { unmount } = mount(`/record/${ID}`);
    expect(screen.queryByTestId("record-cyclic")).not.toBeInTheDocument();
    unmount();
    const reported = { ...MODEL, cyclic: [ID, "ghost/never/read"] };
    const second = mount(`/record/${ID}`, reported);
    expect(screen.getByTestId("record-cyclic")).toHaveTextContent(
      "dependency cycle or downstream of one",
    );
    second.unmount();
    mount("/record/tasks/recurring/repeat-rule", reported);
    expect(screen.queryByTestId("record-cyclic")).not.toBeInTheDocument();
  });
});

describe("the record's prose and the lookup beside it", () => {
  it("draws an identifier in backticks as code and does not link a term inside it, while the same term beside it is one", () => {
    mount(`/record/${ID}`);
    const card = screen.getByTestId("scenario-priority-outline");
    const code = within(card).getByText("queue", { selector: "code" });
    expect(card).not.toHaveTextContent("`");
    const terms = within(card).getAllByTestId("prose-term");
    // Two occurrences of the term, one of them a lookup: the one outside the code span.
    expect(terms).toHaveLength(1);
    expect(terms[0]).toHaveTextContent("queue");
    expect(terms[0]).not.toContainElement(code);
    expect(code.closest('[data-testid="prose-term"]')).toBeNull();
  });

  it("reads a deviation's reason by the same rule, a bold term still a term", () => {
    mount(`/record/${ID}`);
    const reason = within(screen.getByTestId("scenario-empty-title-rejected")).getByTestId(
      "scenario-deviation",
    );
    expect(within(reason).getByText("alert()", { selector: "code" })).toBeInTheDocument();
    const bold = reason.querySelector("strong");
    expect(bold).not.toBeNull();
    expect(within(bold as HTMLElement).getByTestId("prose-term")).toHaveTextContent("queue");
  });

  it("opens a term from the record's prose beside the page, and the record stays", async () => {
    mount(`/record/${ID}`);
    const term = within(screen.getByTestId("scenario-offline-queue-handoff")).getByTestId(
      "prose-term",
    );
    await userEvent.click(term);
    const lookup = screen.getByRole("complementary", { name: "Lookup: queue" });
    expect(lookup).toHaveTextContent("The local list of changes");
    expect(within(lookup).getByTestId("lookup-renderings")).toHaveTextContent("en: queue");
    expect(within(lookup).getByRole("button", { name: ID })).toBeInTheDocument();
    expect(where()).toBe(`/record/${ID}`);
    expect(screen.getByTestId("record")).toBeInTheDocument();
    await userEvent.click(within(lookup).getByTestId("lookup-close"));
    expect(screen.queryByTestId("lookup")).not.toBeInTheDocument();
    expect(where()).toBe(`/record/${ID}`);
  });

  it("returns from a term's record reference to that record", async () => {
    mount("/record/sync/queue/offline-queue");
    const term = screen.getAllByTestId("prose-term")[0];
    await userEvent.click(term);
    const lookup = screen.getByTestId("lookup");
    await userEvent.click(within(lookup).getByRole("button", { name: ID }));
    expect(where()).toBe(`/record/${ID}`);
    expect(screen.queryByTestId("lookup")).not.toBeInTheDocument();
  });

  it("opens a related rule in the lookup and follows it to its record", async () => {
    mount(`/record/${ID}`);
    const rules = within(screen.getByTestId("section-rules"));
    fireEvent.click(rules.getByText("policy/data/local-first-storage"));
    const lookup = screen.getByTestId("lookup");
    expect(lookup).toHaveTextContent("policy/data/local-first-storage");
    const summary = MODEL.byId["policy/data/local-first-storage"].summary.trim();
    // Precondition: the policy writes a summary to show.
    expect(summary.length).toBeGreaterThan(10);
    expect(within(lookup).getByTestId("lookup-summary")).toHaveTextContent(summary.slice(0, 40));
    expect(within(lookup).getByRole("button", { name: ID })).toBeInTheDocument();
    expect(where()).toBe(`/record/${ID}`);
    await userEvent.click(within(lookup).getByRole("button", { name: "Open record" }));
    expect(where()).toBe("/record/policy/data/local-first-storage");
    expect(screen.queryByTestId("lookup")).not.toBeInTheDocument();
  });

  it("reports a target the loaded registry or glossary does not declare", () => {
    const derived = derive(MODEL);
    expect(lookupTarget(MODEL, derived, { kind: "record", id: "policy/none/here" })).toEqual({
      kind: "missing",
      what: "record",
      id: "policy/none/here",
    });
    expect(lookupTarget(MODEL, derived, { kind: "term", id: "Nowhere" })).toEqual({
      kind: "missing",
      what: "term",
      id: "Nowhere",
    });
  });
});

describe("reading a record", () => {
  it("shows the record's original file, comments included, and puts it away again", async () => {
    const records = { ...RECORDS };
    records[FILE] = records[FILE].replace("contract:\n", "# authored comment\ncontract:\n");
    const commented = loadCorpus({ facetrc: FACETRC, index: INDEX, records, scan: SCAN });
    // Precondition: the comment reached the record's text.
    expect(commented.byId[ID].raw).toContain("# authored comment");
    mount(`/record/${ID}`, commented);
    await userEvent.click(screen.getByRole("tab", { name: "Raw" }));
    expect(screen.getByTestId("record")).toHaveTextContent("# authored comment");
    await userEvent.click(screen.getByRole("tab", { name: "Record" }));
    expect(screen.getByTestId("record")).not.toHaveTextContent("# authored comment");
  });

  it("names every test that names a promise, as naming it, and says when none does", () => {
    mount(`/record/${ID}`);
    // Precondition: three tests name the promise.
    expect(MODEL.byId[ID].scenarios.find((x) => x.id === "task-added")?.tests).toHaveLength(3);
    const card = within(screen.getByTestId("scenario-task-added"));
    const list = card.getByRole("list", { name: "Tests naming this promise" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "Unitsrc/tasks/quick_add.test.ts",
      "Unitsrc/tasks/parse_input.test.ts",
      "E2Ee2e/quick-add.spec.ts",
    ]);
    expect(screen.queryByText(/Proving tests/)).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("scenario-priority-outline")).getByText(
        "No test names this promise.",
      ),
    ).toBeInTheDocument();
  });

  it("filters the promises to the chosen selection", async () => {
    mount(`/record/${ID}`);
    const promises = within(screen.getByTestId("section-promises"));
    // Precondition: the outline is the record's one promise no test names.
    expect(MODEL.byId[ID].scenarios.filter((x) => !x.proven).map((x) => x.id)).toEqual([
      "priority-outline",
    ]);
    await userEvent.click(promises.getByRole("radio", { name: /^open/ }));
    expect(promises.getAllByRole("article").map((n) => n.getAttribute("aria-label"))).toEqual([
      "priority-outline",
    ]);
    await userEvent.click(promises.getByRole("radio", { name: "test named" }));
    expect(promises.queryByTestId("scenario-priority-outline")).not.toBeInTheDocument();
    expect(promises.getAllByRole("article")).toHaveLength(3);
  });

  it("says an empty selection is the selection's, not the record's", async () => {
    const plain = loadCorpus({ facetrc: FACETRC, index: INDEX, records: RECORDS, scan: SCAN });
    // Precondition: every promise of the record is named by a test.
    expect(plain.byId[ID].scenarios.every((x) => x.proven)).toBe(true);
    mount(`/record/${ID}`, plain);
    const promises = within(screen.getByTestId("section-promises"));
    await userEvent.click(promises.getByRole("radio", { name: /^open/ }));
    expect(promises.queryAllByRole("article")).toHaveLength(0);
    expect(promises.getByText("No promise in this selection.")).toBeInTheDocument();
    expect(promises.queryByText("The record names no scenario yet.")).not.toBeInTheDocument();
  });

  it("opens a dependency that exists and offers no link for one the registry lacks", async () => {
    // Precondition: the corpus names a dependency it does not hold.
    expect(MODEL.ghosts).toContain("billing/quota/device-limit");
    mount("/record/sync/queue/offline-queue");
    const rel = within(screen.getByTestId("section-relations"));
    expect(rel.getByTestId("link-missing")).toHaveTextContent("billing/quota/device-limit");
    expect(
      rel.queryByRole("button", { name: "billing/quota/device-limit" }),
    ).not.toBeInTheDocument();
    const rec = MODEL.byId["sync/queue/offline-queue"];
    const there = [...rec.dependsOn, ...rec.dependedOnBy].find((d) => MODEL.byId[d])!;
    await userEvent.click(rel.getAllByRole("button", { name: there })[0]);
    expect(where()).toBe(`/record/${there}`);
  });

  it("leads from the record back to the product overview", async () => {
    mount(`/record/${ID}`);
    await userEvent.click(
      within(screen.getByTestId("record")).getAllByRole("button", { name: "Product" })[0],
    );
    expect(where()).toBe("/product");
  });
});
