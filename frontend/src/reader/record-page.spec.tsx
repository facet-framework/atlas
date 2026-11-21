import { germanLabel } from "@/i18n/testing-labels.spec-support";
/** What the record page says about a record's promises and knowledge, mounted
 * as the app over a TaskFlow corpus: a test that names a promise is called
 * that and never a proof, the readership selection keeps its whole
 * denominator, and a knowledge count only stands where the record declares a
 * knowledge block. */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadCorpus, type AtlasModel } from "@/model";
import { FACETRC, INDEX, RECORDS, SCAN } from "@/model/fixtures";
import { frame } from "@/screens";
import i18n from "@/i18n";
import Atlas from "./Atlas";
import { ROLE_STORAGE_KEY } from "./reader-role";

const ID = "tasks/create/quick-add";
const FILE = "docs/facets/features/tasks/create/quick-add.yaml";

/** The TaskFlow corpus with quick-add's YAML rewritten by `edit`. */
function modelWith(edit: (yaml: string) => string): AtlasModel {
  const records = { ...RECORDS, [FILE]: edit(RECORDS[FILE]) };
  return loadCorpus({ facetrc: FACETRC, index: INDEX, records, scan: SCAN });
}

/** quick-add's knowledge block replaced by `block` (empty: no block at all). */
const withKnowledge = (block: string) =>
  modelWith((yaml) => yaml.replace(/^knowledge:\n[\s\S]*?(?=^lineage:)/m, block));

const FIVE_THREE_ANSWERED = `knowledge:
  prerequisite_knowledge:
    question: q
    answer: Nothing.
  not_for:
    question: q
    answer: Not for subtasks.
  discoverability:
    question: q
  success_signal:
    question: q
    answer: The task is at the top.
  common_pitfalls:
    question: q
`;

const THREE_UNANSWERED = `knowledge:
  prerequisite_knowledge:
    question: q
  not_for:
    question: q
  common_pitfalls:
    question: q
`;

let mounted: ReturnType<typeof render> | null = null;
function mount(path: string, model: AtlasModel) {
  mounted?.unmount();
  window.history.replaceState(null, "", path);
  mounted = render(<Atlas model={model} readers={null} />);
  return mounted;
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(async () => {
  mounted?.unmount();
  mounted = null;
  await act(() => i18n.changeLanguage("en"));
});

const knowledgeSection = () => screen.getByTestId("section-knowledge");
const railCount = (label: RegExp) =>
  within(screen.getByTestId("record")).getAllByRole("link", { name: label })[0];

describe("the knowledge count on a record page", () => {
  it("says answered of declared for a record that declares five slots and answers three", () => {
    const model = withKnowledge(FIVE_THREE_ANSWERED);
    // Precondition: the record declares five slots, three of them answered.
    expect(model.byId[ID].knowledge).toHaveLength(5);
    expect(model.byId[ID].knowledge.filter((k) => k.answer?.trim())).toHaveLength(3);
    mount(`/record/${ID}`, model);
    expect(within(knowledgeSection()).getByTestId("knowledge-count")).toHaveTextContent(
      /^3 of 5 answered$/,
    );
    expect(railCount(/^Knowledge/)).toHaveTextContent("3/5");
  });

  it("counts against what the block declares, not against the schema's five", () => {
    // quick-add as shipped: four slots declared, three answered in words.
    const model = modelWith((yaml) => yaml);
    expect(model.byId[ID].knowledge).toHaveLength(4);
    mount(`/record/${ID}`, model);
    expect(within(knowledgeSection()).getByTestId("knowledge-count")).toHaveTextContent(
      /^3 of 4 answered$/,
    );
    expect(within(knowledgeSection()).getAllByTestId(/^slot-/)).toHaveLength(4);
  });

  it("draws no count anywhere for a record without a knowledge block, and says it has none", () => {
    const model = withKnowledge("");
    // Precondition: the block is really gone from the parsed record.
    expect(model.byId[ID].present.knowledge).toBe(false);
    mount(`/record/${ID}`, model);
    const section = knowledgeSection();
    expect(within(section).queryByTestId("knowledge-count")).toBeNull();
    expect(within(section).getByTestId("knowledge-no-block")).toHaveTextContent(
      "This record declares no knowledge block.",
    );
    expect(within(section).queryAllByTestId(/^slot-/)).toHaveLength(0);
    expect(railCount(/^Knowledge/)).not.toHaveTextContent(/\d\/\d/);
    const figures = screen.getByRole("group", { name: "Key figures" });
    expect(figures).not.toHaveTextContent(/\/\s*5|of 5/);
  });

  it("says a declared block is unanswered in other words than a missing block, and counts it", () => {
    mount(`/record/${ID}`, withKnowledge(THREE_UNANSWERED));
    const section = knowledgeSection();
    expect(within(section).getByTestId("knowledge-count")).toHaveTextContent(/^0 of 3 answered$/);
    const unanswered = within(section).getByTestId("knowledge-unanswered");
    expect(unanswered).toHaveTextContent("3 slots declared, none answered yet.");
    expect(within(section).queryByTestId("knowledge-no-block")).toBeNull();
    expect(within(section).getAllByTestId(/^slot-/)).toHaveLength(3);
    mount(`/record/${ID}`, withKnowledge(""));
    expect(within(knowledgeSection()).getByTestId("knowledge-no-block").textContent).not.toBe(
      unanswered.textContent,
    );
  });
});

const PROOF_WORDS = /proven|unproven|Evidence|passed/i;

describe("a test that names a promise", () => {
  it.each(["de", "en"] as const)(
    "is called a test that names it without explanatory prose (%s)",
    async (language) => {
      await act(() => i18n.changeLanguage(language));
      mount(
        `/record/${ID}`,
        modelWith((yaml) => yaml),
      );
      const card = screen.getByTestId("scenario-task-added");
      expect(card).toHaveTextContent(language === "de" ? germanLabel("test named") : "test named");
      expect(screen.queryByTestId("record-test-association-note")).toBeNull();
      const promises = within(screen.getByTestId("section-promises"));
      expect(
        promises.getByRole("radio", {
          name: language === "de" ? germanLabel("test named") : "test named",
        }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("record").textContent).not.toMatch(PROOF_WORDS);
    },
  );

  it.each([
    ["de", "/record/tasks/create/quick-add"],
    ["en", "/record/tasks/create/quick-add"],
    ["de", "/contents/promises"],
    ["en", "/contents/promises"],
    ["de", "/contents/tests"],
    ["en", "/contents/tests"],
    ["de", "/records"],
    ["en", "/records"],
  ] as const)(
    "is worded as an examination nowhere on the page (%s, %s)",
    async (language, path) => {
      await act(() => i18n.changeLanguage(language));
      mount(
        path,
        modelWith((yaml) => yaml),
      );
      // Precondition: the page drew, with the shell around it.
      expect(document.querySelector<HTMLElement>(".t-shell__head")!).toBeInTheDocument();
      expect(document.body.textContent!.length).toBeGreaterThan(200);
      expect(document.body.textContent).not.toMatch(PROOF_WORDS);
    },
  );

  it.each(
    frame.OVERVIEW_ROLE_KEYS.flatMap((role) => [
      ["de", role],
      ["en", role],
    ]) as [string, string][],
  )("is worded as an examination nowhere on the Overview (%s, %s)", async (language, role) => {
    await act(() => i18n.changeLanguage(language));
    window.localStorage.setItem(ROLE_STORAGE_KEY, role);
    mount(
      "/",
      modelWith((yaml) => yaml),
    );
    expect(document.querySelector<HTMLElement>(".t-shell__head")!).toBeInTheDocument();
    // The agent's excerpt is the host's JSON handed over raw: its field names
    // are an interface, not words the reader is told.
    const page = document.body.cloneNode(true) as HTMLElement;
    page
      .querySelectorAll('[data-testid="overview-agent-excerpt"], [data-testid="agent-json"]')
      .forEach((n) => n.remove());
    expect(page.textContent!.length).toBeGreaterThan(200);
    expect(page.textContent).not.toMatch(PROOF_WORDS);
  });

  it("lists a single naming test as itself, with no count beside it", () => {
    const model = modelWith((yaml) => yaml);
    // Precondition: exactly one test names this promise.
    expect(
      model.byId[ID].scenarios.find((s) => s.id === "empty-title-rejected")!.tests,
    ).toHaveLength(1);
    mount(`/record/${ID}`, model);
    const card = screen.getByTestId("scenario-empty-title-rejected");
    const list = within(card).getByRole("list", { name: "Tests naming this promise" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Unitsrc/tasks/quick_add.test.ts"]);
    expect(card).not.toHaveTextContent(/\+\s*\d|more/);
  });
});

/** quick-add with one product, one engineering and one unclassified promise. */
const READERSHIP = () =>
  modelWith((yaml) =>
    yaml
      .replace("    - id: task-added\n", "    - id: task-added\n      audience: product\n")
      .replace(
        "    - id: offline-queue-handoff\n",
        "    - id: offline-queue-handoff\n      audience: engineering\n",
      ),
  );

describe("the readership selection on a record page", () => {
  it("shows only the chosen readership and keeps the unclassified count against every promise", async () => {
    const model = READERSHIP();
    // Precondition: two promises classified, one not.
    expect(model.byId[ID].scenarios.map((s) => s.audience)).toEqual([
      "product",
      null,
      "engineering",
    ]);
    mount(`/record/${ID}`, model);
    const promises = within(screen.getByTestId("section-promises"));
    const unclassified = () => screen.getByTestId("record-unclassified");
    expect(unclassified()).toHaveTextContent("1 of 3 promise without a readership");
    expect(
      within(screen.getByTestId("scenario-task-added")).getByTestId("scenario-audience"),
    ).toHaveTextContent("Product");

    const readership = promises.getByRole("radiogroup", { name: "Readership" });
    await userEvent.click(within(readership).getByRole("radio", { name: "Product" }));
    expect(promises.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual([
      "task-added",
    ]);
    expect(unclassified()).toHaveTextContent("1 of 3 promise without a readership");

    await userEvent.click(within(readership).getByRole("radio", { name: "Engineering" }));
    expect(promises.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual([
      "offline-queue-handoff",
    ]);
    expect(unclassified()).toHaveTextContent("1 of 3 promise without a readership");
  });

  it("names an empty readership selection as that selection", async () => {
    mount(`/record/${ID}`, READERSHIP());
    const promises = within(screen.getByTestId("section-promises"));
    await userEvent.click(promises.getByRole("radio", { name: /^open/ }));
    await userEvent.click(
      within(promises.getByRole("radiogroup", { name: "Readership" })).getByRole("radio", {
        name: "Product",
      }),
    );
    expect(promises.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByTestId("record-none-in-selection")).toHaveTextContent(
      "No promise for the readership Product.",
    );
  });

  it("offers no readership group where no promise is classified", () => {
    mount(
      `/record/${ID}`,
      modelWith((yaml) => yaml),
    );
    const promises = within(screen.getByTestId("section-promises"));
    expect(promises.queryByRole("radiogroup", { name: "Readership" })).toBeNull();
    expect(screen.queryByTestId("record-unclassified")).toBeNull();
  });
});

describe("a reference row on a record page", () => {
  it.each([
    ["tasks/create/quick-add", "policy/data/local-first-storage"],
    ["reminders/due/push-notification", "policy/notifications/quiet-hours"],
  ])("on %s opens %s in the lookup with its summary and keeps the record", async (from, to) => {
    const model = modelWith((yaml) => yaml);
    // Precondition: the record names the policy, and the policy writes a summary.
    expect(model.byId[from].relatedPolicies).toContain(to);
    const summary = model.byId[to].summary.trim();
    expect(summary.length).toBeGreaterThan(10);
    mount(`/record/${from}`, model);
    await userEvent.click(within(screen.getByTestId("section-rules")).getByText(to));
    const lookup = screen.getByTestId("lookup");
    expect(lookup).toHaveTextContent(to);
    expect(within(lookup).getByTestId("lookup-summary")).toHaveTextContent(summary.slice(0, 40));
    expect(window.location.pathname).toBe(`/record/${from}`);
  });
});

describe("the references of a record page", () => {
  const MODEL = () =>
    modelWith((yaml) =>
      yaml.replace(
        /^ {2}related_data_entities:\n {4}- data\/tasks\/task-item$/m,
        "  related_data_entities:\n    - data/tasks/task-item\n    - data/gone/shape",
      ),
    );

  it("lists the rule, the assumption and the data shapes the lineage names, and opens an assumption and a data shape in the lookup", async () => {
    const model = MODEL();
    const rec = model.byId[ID];
    // Precondition: the record names one of each kind, and one data shape the registry lacks.
    expect(rec.relatedPolicies).toEqual(["policy/data/local-first-storage"]);
    expect(rec.relatedAssumptions).toEqual(["assumption/sync/clock-skew-bounded"]);
    expect(rec.relatedEntities).toEqual(["data/tasks/task-item", "data/gone/shape"]);
    expect(model.byId["data/gone/shape"]).toBeUndefined();
    mount(`/record/${ID}`, model);
    const section = within(screen.getByTestId("section-rules"));
    expect(section.getByText("Rule records")).toBeInTheDocument();
    expect(section.getByText("Assumptions")).toBeInTheDocument();
    expect(section.getByText("Data shapes")).toBeInTheDocument();
    expect(within(section.getByTestId("references-rules")).getAllByRole("button")).toHaveLength(1);

    const assumption = model.byId["assumption/sync/clock-skew-bounded"];
    await userEvent.click(
      within(section.getByTestId("references-assumptions")).getByText(assumption.id),
    );
    const lookup = screen.getByTestId("lookup");
    expect(lookup).toHaveTextContent(assumption.id);
    expect(within(lookup).getByTestId("lookup-summary")).toHaveTextContent(
      assumption.summary.trim().slice(0, 30),
    );
    expect(window.location.pathname).toBe(`/record/${ID}`);

    const shapes = within(section.getByTestId("references-data-shapes"));
    await userEvent.click(shapes.getByText("data/tasks/task-item"));
    expect(screen.getByTestId("lookup")).toHaveTextContent("data/tasks/task-item");
    // The id the registry lacks is named with its reason and opens nothing.
    const rows = shapes.getAllByTestId("reference-row");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveAttribute("data-missing", "true");
    expect(rows[1]).toHaveTextContent("data/gone/shape");
    expect(rows[1]).toHaveTextContent("not in this registry");
    expect(within(rows[1]).queryByRole("button")).toBeNull();
  });
});

describe("a record's declarations reach every reader", () => {
  const DECLARING = () =>
    modelWith((yaml) =>
      yaml.replace(
        /^verification:$/m,
        `  business_rules:
    - id: priority-table
      kind: table
      states: which marker sets which priority
verification:`,
      ),
    );

  it.each(frame.OVERVIEW_ROLE_KEYS.map((role) => [role]))(
    "draws the business rules and the decisions for the role %s",
    (role) => {
      window.localStorage.setItem(ROLE_STORAGE_KEY, role);
      mount(`/record/${ID}`, DECLARING());
      const rules = within(screen.getByTestId("section-rules")).getByTestId("business-rules");
      expect(rules).toHaveTextContent("which marker sets which priority");
      const relations = within(screen.getByTestId("section-relations"));
      expect(
        relations
          .getAllByRole("button")
          .map((b) => b.textContent)
          .filter((x) => /^ADR-/.test(x ?? "")),
      ).toEqual(["ADR-007", "ADR-019"]);
    },
  );
});
