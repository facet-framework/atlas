import { germanLabel } from "@/i18n/testing-labels.spec-support";
/** The newcomer's Overview, the reviewer's bench, and the places the Overview
 * opens (the anchors table, the data shapes), on the real Atlas. The model
 * is TaskFlow parsed from its YAML texts; where a case needs what TaskFlow
 * lacks, the YAML is changed here and parsed again, and each case first checks
 * that its fixture carries what it is about. */

import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtlasModel, RepoScan, Taxonomy } from "@/model";
import { loadCorpus } from "@/model";
import { FACETRC, INDEX, RECORDS, SCAN, taskflowModel } from "@/model/fixtures";
import i18n from "@/i18n";
import { derive } from "@/derive";
import Atlas from "./Atlas";
import { domainViews, faqByChange, faqGaps, featureViews } from "./derive-reader";
import type { HostReaders } from "./host";
import { shapeRows } from "./pages/shapes";
import { rules } from "./derive-contents";
import { TEST_REPORT_INTERVAL_MS, useTestReport, type TestReport } from "./test-report";

const REPEAT = "docs/facets/features/tasks/recurring/repeat-rule.yaml";
const REPEAT_ID = "tasks/recurring/repeat-rule";

function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`fixture text not found: ${from.slice(0, 40)}`);
  return text.replace(from, to);
}

/** TaskFlow with some record texts replaced and extra records added. */
function model(
  replace: Record<string, (text: string) => string> = {},
  extra: Record<string, string> = {},
  scan: Partial<RepoScan> = {},
): AtlasModel {
  const records: Record<string, string> = { ...RECORDS };
  for (const [path, edit] of Object.entries(replace)) records[path] = edit(records[path]);
  Object.assign(records, extra);
  const index =
    INDEX +
    Object.keys(extra)
      .map((p) => `  - ${p}\n`)
      .join("");
  return loadCorpus({ facetrc: FACETRC, index, records, scan: { ...SCAN, ...scan } });
}

/** A record with the given number of scenarios, in the given capability. */
function extraRecord(id: string, scenarios: number, team = "extra"): string {
  const list = Array.from(
    { length: scenarios },
    (_, i) => `    - id: works-${i + 1}
      statement: |
        Given thing ${i + 1}
        When it is used
        Then it works ${i + 1}
`,
  ).join("");
  return `schema_version: "0.1"
id: ${id}
lifecycle: active
intent:
  summary: |
    Record ${id}.
${scenarios ? `contract:\n  scenarios:\n${list}` : ""}lineage:
  owner:
    team: ${team}
`;
}

async function asRole(name: RegExp, m: AtlasModel = taskflowModel(), readers?: HostReaders) {
  window.history.replaceState(null, "", "/");
  render(<Atlas model={m} readers={readers ?? null} />);
  await userEvent.click(screen.getByRole("button", { name: "Developer" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name }));
  expect(screen.getByTestId("overview")).toBeInTheDocument();
}

const where = () => window.location.pathname;
const realVisibility = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  if (realVisibility) Object.defineProperty(Document.prototype, "visibilityState", realVisibility);
});

describe("the newcomer's opening", () => {
  it("describes the registry in its own numbers: records, areas and categories", async () => {
    const m = taskflowModel();
    const records = featureViews(m, derive(m)).length;
    const domains = domainViews(m);
    const categories = domains.reduce((n, d) => n + d.capabilities.length, 0);
    await asRole(/New here/, m);
    const hero = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(hero).toHaveTextContent(`${records}Records describe what`);
    expect(hero).toHaveTextContent(
      `They sit in ${domains.length} areas with ${categories} capabilities.`,
    );
  });
});

describe("what the product does, for a newcomer", () => {
  /** TaskFlow with a taxonomy of its own areas, `core` classified core; `null` classifies nothing. */
  function classified(core: string[] | null, purpose = ""): AtlasModel {
    const base = taskflowModel();
    const taxonomy: Taxonomy = {
      schemaVersion: "1",
      domains: domainViews(base).map((d) => ({
        name: d.id,
        title: d.title,
        purpose,
        classification: null,
        ownerTeam: "",
        capabilities: d.capabilities.map((c) => ({
          name: c.id,
          title: c.title,
          purpose: "",
          inherited: false,
          classification:
            core === null ? null : core.includes(`${d.id}/${c.id}`) ? "core" : "supporting",
        })),
      })),
    };
    return { ...base, taxonomy };
  }

  it("names in an unclassified taxonomy every category of each area, with the area's record count", async () => {
    const m = classified(null);
    const domains = domainViews(m);
    const features = featureViews(m, derive(m));
    await asRole(/New here/, m);
    const region = screen.getByRole("region", { name: "How the product is built" });
    const categories = domains.reduce((n, d) => n + d.capabilities.length, 0);
    expect(region).toHaveTextContent(`${domains.length} areas · ${categories} capabilities`);
    const cards = screen.getAllByTestId("overview-new-built-card");
    cards.forEach((card, i) => {
      const d = domains[i];
      expect(card).toHaveTextContent(d.title);
      const records = features.filter((f) => f.domain === d.id).length;
      expect(within(card).getByText(String(records))).toBeInTheDocument();
      for (const c of d.capabilities) expect(card).toHaveTextContent(c.title);
    });
  });

  it("names only the core category of an area, with its purpose, and none of its supporting ones", async () => {
    const domains = domainViews(taskflowModel());
    const d0 = domains.find((d) => d.capabilities.length > 1)!;
    // Precondition: the area holds more than the one core category.
    expect(d0).toBeDefined();
    const m = classified([`${d0.id}/${d0.capabilities[0].id}`], "What this area is for.");
    await asRole(/New here/, m);
    const [card] = screen.getAllByTestId("overview-new-built-card");
    expect(card).toHaveTextContent(d0.capabilities[0].title);
    expect(card).toHaveTextContent("What this area is for.");
    for (const c of d0.capabilities.slice(1)) expect(card).not.toHaveTextContent(c.title);
  });

  it("draws the capabilities a spread-out graph leans on, and says it leans", async () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < 12; i++)
      extra[`docs/facets/features/d${i}/c/r.yaml`] = `schema_version: "0.1"
id: d${i}/c/r
lifecycle: active
intent:
  summary: Record ${i}.
lineage:
  depends_on:
    - d${(i + 1) % 12}/c/r
`;
    const index = `records:\n${Object.keys(extra)
      .map((p) => `  - ${p}\n`)
      .join("")}`;
    const m = loadCorpus({ facetrc: FACETRC, index, records: extra, scan: { ...SCAN, drift: [] } });
    // Precondition: every edge was read.
    expect(derive(m).M.every((f) => f.deps.length === 1)).toBe(true);
    await asRole(/New here/, m);
    expect(screen.getByTestId("overview-pillars-leaning")).toBeInTheDocument();
    const rows = within(screen.getByTestId("overview-pillars")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("d0/c · 1 dependency from elsewhere (8%)");
  });
});

describe("the newcomer's answers", () => {
  const entries = () => screen.getAllByTestId("overview-new-faq-entry");
  const kinds = () => within(screen.getByRole("group", { name: "Kind of answer" }));

  it("puts each answer under the owner's own question, with its kind and its record, which opens", async () => {
    const m = taskflowModel();
    const notFor = faqByChange(derive(m)).filter((e) => e.slot === "not_for");
    // Precondition: the owners wrote their own question for this kind.
    expect(notFor.length).toBeGreaterThan(0);
    expect(notFor[0].question).toBeTruthy();
    await asRole(/New here/, m);
    await userEvent.click(kinds().getByRole("button", { name: /Not for/ }));
    const e = entries()[0];
    expect(within(e).getByRole("term")).toHaveTextContent(notFor[0].question);
    expect(within(e).getByRole("definition")).toHaveTextContent(notFor[0].answer);
    expect(within(e).getByTestId("overview-new-faq-kind")).toHaveTextContent("Not for");
    await userEvent.click(within(e).getByRole("button", { name: notFor[0].record }));
    expect(where()).toBe(`/record/${notFor[0].record}`);
  });

  it("names an answered prerequisite as its kind with the record that answered it", async () => {
    const m = taskflowModel();
    const pre = faqByChange(derive(m)).filter((e) => e.slot === "prerequisite_knowledge");
    expect(pre.length).toBeGreaterThan(0);
    await asRole(/New here/, m);
    await userEvent.click(kinds().getByRole("button", { name: /Prerequisite/ }));
    const shown = entries();
    expect(shown).toHaveLength(Math.min(5, pre.length));
    shown.forEach((e, i) => {
      expect(within(e).getByTestId("overview-new-faq-kind")).toHaveTextContent("Prerequisite");
      expect(within(e).getByRole("button", { name: pre[i].record })).toBeInTheDocument();
    });
  });

  it("dates an answer by its anchored file when the code changed after the record", async () => {
    const plain = taskflowModel();
    const v = derive(plain);
    const last = v.M.filter(
      (f) => f.know.some((k) => k.answer?.trim()) && f.rec.anchors.length > 0,
    ).at(-1)!;
    // Precondition: the feature has an anchored file to date it by.
    expect(last).toBeDefined();
    const m = model({}, {}, {
      lastChanged: {
        [last.rec.path]: "2026-07-01",
        [last.rec.anchors[0].path]: "2026-07-28",
      },
    } as Partial<RepoScan>);
    await asRole(/New here/, m);
    const first = entries()[0];
    expect(first).toHaveTextContent(last.id);
    expect(within(first).getByTestId("overview-new-faq-changed")).toHaveTextContent(
      "changed 2026-07-28",
    );
  });

  it("claims no day and keeps the id order where the host sent no history", async () => {
    const m = taskflowModel();
    expect(faqByChange(derive(m)).every((e) => e.changed === null)).toBe(true);
    await asRole(/New here/, m);
    expect(screen.queryAllByTestId("overview-new-faq-changed")).toHaveLength(0);
    const ids = entries().map((e) => within(e).getAllByRole("button").at(-1)!.textContent!);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids).toEqual([...ids].sort());
  });

  it("names a kind no record answers as an open gap, with how many records could and their teams", async () => {
    const m = taskflowModel();
    const gaps = faqGaps(derive(m));
    const pitfalls = gaps.find((g) => g.slot === "common_pitfalls")!;
    // Precondition: TaskFlow answers no pitfall, and active records could.
    expect(pitfalls).toBeDefined();
    expect(pitfalls.records).toBeGreaterThan(1);
    expect(gaps.some((g) => g.slot === "prerequisite_knowledge")).toBe(false);
    await asRole(/New here/, m);
    const rows = within(screen.getByTestId("overview-new-faq-gaps")).getAllByTestId(
      "overview-new-faq-gap",
    );
    expect(rows).toHaveLength(gaps.length);
    const row = rows.find((r) => r.textContent!.includes("Pitfalls"))!;
    expect(row).toHaveTextContent("open");
    expect(row).toHaveTextContent(`${pitfalls.records} records could answer it`);
    expect(row).toHaveTextContent(`held by ${pitfalls.teams.join(", ")}`);
  });
});

describe("the newcomer's glossary", () => {
  it("opens from the newcomer's page, lists each declared term with its definition, and a term opens", async () => {
    const glossary = `schema_version: "0.1"
terms:
  - term: Queue
    definition: |
      The local list of changes.
      A second line.
  - term: Conflict
    definition: |
      Two changes to the same field.
`;
    const m = loadCorpus({
      facetrc: FACETRC,
      index: INDEX,
      records: RECORDS,
      scan: SCAN,
      glossary,
    });
    expect(m.glossary?.terms.map((t) => t.term)).toEqual(["Queue", "Conflict"]);
    await asRole(/New here/, m);
    await userEvent.click(
      within(screen.getByRole("region", { name: "Four words first" })).getByRole("button", {
        name: "Glossary",
      }),
    );
    expect(where()).toBe("/glossary");
    const page = within(screen.getByTestId("glossary-page"));
    const queue = page.getByRole("button", { name: /^Queue/ });
    expect(queue).toHaveTextContent("The local list of changes.");
    expect(page.getByRole("button", { name: /^Conflict/ })).toHaveTextContent(
      "Two changes to the same field.",
    );
    await userEvent.click(queue);
    expect(where()).toBe("/glossary/Queue");
  });
});

describe("the reviewer's bench", () => {
  const bench = () => screen.getByTestId("bench-tree");
  const categories = () => within(bench()).getAllByTestId("bench-category");

  /** The category whose head names `name`, turning the top level's page if it is not on the first. */
  async function category(name: string): Promise<HTMLElement> {
    const find = () => categories().find((c) => c.textContent?.includes(name));
    if (!find())
      await userEvent.click(
        within(bench().nextElementSibling as HTMLElement).getByRole("button", { name: "Page 2" }),
      );
    const cat = find()!;
    if (!within(cat).queryAllByTestId("bench-feature").length)
      await userEvent.click(within(cat).getAllByRole("button")[0]);
    return cat;
  }

  it("counts a declared deviation among the category's scenarios and still reads the feature complete", async () => {
    const m = model({
      [REPEAT]: (t) =>
        swap(
          t,
          "        Then exactly one new instance is created with the next Monday as its due date\n",
          "        Then exactly one new instance is created with the next Monday as its due date\n" +
            "      deviation:\n        reason: Two instances are created at the end of the month.\n        confirmed_by: lena\n",
        ),
    });
    const f = derive(m).M.find((x) => x.id === REPEAT_ID)!;
    // Preconditions: the deviation is a scenario but no claim, and nothing else is open.
    expect(f.claims).toBe(f.scen.length - 1);
    expect(f.open).toBe(0);
    expect(f.proven).toBeGreaterThan(0);
    await asRole(/Test & review/, m);
    const cat = await category("tasks/recurring");
    expect(within(cat).getByTestId("bench-category-count")).toHaveTextContent(
      `${f.scen.length} scenarios`,
    );
    const feature = within(cat)
      .getAllByTestId("bench-feature")
      .find((x) => x.textContent!.includes("repeat-rule"))!;
    expect(within(feature).getByTestId("bench-feature-state")).toHaveTextContent("complete");
  });

  it("names the audience in the reader's word and a declared unbacked promise unbacked, in German and English", async () => {
    const m = model({
      [REPEAT]: (t) =>
        swap(
          swap(
            t,
            "        Then exactly one new instance is created with the next Monday as its due date\n",
            "        Then exactly one new instance is created with the next Monday as its due date\n" +
              "      audience: product\n",
          ),
          "      proves: [next-instance-on-complete, rule-edit-keeps-history]",
          "      proves: [next-instance-on-complete]",
        ).replace(
          "        Then they stay unchanged and only future ones follow the new rule\n",
          "        Then they stay unchanged and only future ones follow the new rule\n" +
            "      backing:\n        state: unbacked\n        reason: The history lives only in the app.\n",
        ),
    });
    const f = derive(m).M.find((x) => x.id === REPEAT_ID)!;
    expect(f.scen.find((s) => s.id === "rule-edit-keeps-history")!.state).toBe("un");
    expect(f.scen.find((s) => s.id === "next-instance-on-complete")!.audience).toBe("product");
    await asRole(/Test & review/, m);
    const promise = async (id: string) => {
      const cat = await category("tasks/recurring");
      const feature = within(cat)
        .getAllByTestId("bench-feature")
        .find((x) => x.textContent!.includes("repeat-rule"))!;
      if (!within(feature).queryAllByTestId("bench-promise").length)
        await userEvent.click(within(feature).getAllByRole("button")[0]);
      return within(feature)
        .getAllByTestId("bench-promise")
        .find((x) => x.textContent!.includes(id))!;
    };
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      const product = await promise("next-instance-on-complete");
      expect(within(product).getByTestId("bench-measure-audience")).toHaveTextContent(
        `${germanLabel("Readership")} ${germanLabel("Product")}`,
      );
      expect(within(product).getByTestId("bench-measure-audience")).not.toHaveTextContent(
        "product",
      );
      const unbacked = await promise("rule-edit-keeps-history");
      expect(within(unbacked).getByTestId("bench-measure-evidence")).toHaveTextContent(
        germanLabel("unbacked"),
      );
      expect(within(unbacked).getByTestId("bench-measure-evidence")).not.toHaveTextContent("open");
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      expect(
        within(await promise("next-instance-on-complete")).getByTestId("bench-measure-audience"),
      ).toHaveTextContent("Product");
      expect(
        within(await promise("rule-edit-keeps-history")).getByTestId("bench-measure-evidence"),
      ).toHaveTextContent("unbacked");
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("pages the features inside a category six at a time and the promises of a feature eight at a time", async () => {
    const extra: Record<string, string> = {};
    for (let i = 1; i <= 7; i++)
      extra[`docs/facets/features/extra/bare/r${i}.yaml`] = extraRecord(
        `extra/bare/r${i}`,
        i === 1 ? 9 : 1,
      );
    const m = model({}, extra);
    await asRole(/Test & review/, m);
    const cat = await category("extra/bare");
    const features = () => within(cat).getAllByTestId("bench-feature");
    const isBig = (x: HTMLElement) => x.textContent!.endsWith("0/9");
    expect(features()).toHaveLength(6);
    await userEvent.click(within(cat).getByRole("button", { name: "Page 2" }));
    expect(features()).toHaveLength(1);
    await userEvent.click(within(cat).getByRole("button", { name: "Page 1" }));
    const big = features().find(isBig)!;
    expect(big).toBeDefined();
    await userEvent.click(within(big).getAllByRole("button")[0]);
    expect(within(big).getAllByTestId("bench-promise")).toHaveLength(8);
    await userEvent.click(within(big).getByRole("button", { name: "Page 2" }));
    expect(within(big).getAllByTestId("bench-promise")).toHaveLength(1);
  });
});

describe("the bench's failing tests", () => {
  const readers = (testReport: () => Promise<TestReport>): HostReaders => ({
    repo: () => Promise.reject(new Error("no repo")),
    agent: () => Promise.resolve(null),
    tools: () => Promise.resolve({ available: false, tools: [] }),
    installed: () => Promise.resolve([]),
    testReport,
  });
  const figure = () => screen.getByTestId("bench-test-report-n");
  const note = () => screen.getByTestId("bench-test-report-note");

  it("draws a fresh report's nought as 0 with the commit it was measured on", async () => {
    await asRole(
      /Test & review/,
      taskflowModel(),
      readers(() =>
        Promise.resolve({
          state: "fresh",
          reportHead: "abcdef1234567890",
          head: "abcdef1234567890",
          passed: 41,
          failed: 0,
          unmeasured: 2,
        }),
      ),
    );
    await waitFor(() => expect(figure()).toHaveTextContent("0"));
    expect(figure()).not.toHaveTextContent("—");
    expect(note()).toHaveTextContent("41 passed, 2 unmeasured · commit abcdef1");
    expect(screen.getByTestId("bench-test-report")).toHaveTextContent("Failing tests");
  });

  it("draws a dash and the reason in words for every report that is not fresh, never a count or a path", async () => {
    const cases: [TestReport, string][] = [
      [{ state: "stale", reportHead: "1111111", head: "2222222" }, "report is out of date"],
      [{ state: "dirty" }, "report was measured on a modified working tree"],
      [{ state: "none" }, "no report (facet ui --test-report)"],
      [
        { state: "unreadable", reason: "permission" },
        "report unreadable: no permission to read it",
      ],
      [{ state: "unreadable", reason: "/etc/secret: EACCES" }, "report unreadable: read error"],
    ];
    for (const [report, words] of cases) {
      cleanup();
      window.localStorage.clear();
      await asRole(
        /Test & review/,
        taskflowModel(),
        readers(() => Promise.resolve({ ...report, failed: 3 })),
      );
      await waitFor(() =>
        expect(screen.getByTestId("bench-test-report")).toHaveAttribute(
          "data-test-report-state",
          report.state,
        ),
      );
      expect(figure()).toHaveTextContent("—");
      expect(figure()).toHaveAccessibleName("not measured");
      expect(note()).toHaveTextContent(words);
      expect(note()).not.toHaveTextContent(/\/|EACCES|3/);
    }
  });

  it("says not measured, not a read in progress, where the host is not asked", async () => {
    await asRole(/Test & review/);
    expect(screen.getByTestId("bench-test-report")).toHaveAttribute(
      "data-test-report-state",
      "unasked",
    );
    expect(figure()).toHaveTextContent("—");
    expect(note()).toHaveTextContent("not measured");
  });

  it("asks again when the window regains focus or comes back into view, and draws the newer answer", async () => {
    let failed = 0;
    let asked = 0;
    const reader = () => {
      asked += 1;
      return Promise.resolve({ state: "fresh", reportHead: "abcdef1", failed } as TestReport);
    };
    await asRole(/Test & review/, taskflowModel(), readers(reader));
    await waitFor(() => expect(figure()).toHaveTextContent("0"));
    failed = 2;
    const before = asked;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(figure()).toHaveTextContent("2"));
    expect(asked).toBe(before + 1);
    failed = 5;
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(figure()).toHaveTextContent("5"));
  });
});

describe("the test report's reader", () => {
  it("asks again on its interval while the bench is open, and stops once it closes", async () => {
    jest.useFakeTimers();
    const reader = jest.fn(() => Promise.resolve({ state: "none" } as TestReport));
    const { unmount } = renderHook(() => useTestReport(reader));
    expect(reader).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(TEST_REPORT_INTERVAL_MS);
    });
    expect(reader).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      jest.advanceTimersByTime(TEST_REPORT_INTERVAL_MS * 3);
    });
    expect(reader).toHaveBeenCalledTimes(2);
  });
});

describe("the places the Overview opens", () => {
  it("opens the anchors table narrowed to an orphaned anchor's file", async () => {
    const orphan = SCAN.orphanAnchors![0];
    await asRole(/Developer/);
    const list = within(screen.getByTestId("coverage-orphans")).getByRole("list", {
      name: "Anchors without a record",
    });
    const row = within(list).getAllByRole("listitem")[0];
    expect(row).toHaveTextContent(`${orphan.path}:${orphan.line}`);
    await userEvent.click(within(row).getByRole("button"));
    expect(where()).toBe("/contents/anchor");
    expect(screen.getByRole("searchbox")).toHaveValue(orphan.path);
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent(orphan.path);
    expect(within(table).getByTestId("anchor-orphan")).toHaveTextContent(orphan.id);
  });

  it("lists the data shapes under Contents, and a row opens the entity's record", async () => {
    const m = taskflowModel();
    const rows = shapeRows(m);
    // Precondition: TaskFlow declares entities.
    expect(rows.length).toBeGreaterThan(0);
    window.history.replaceState(null, "", "/contents/data-shapes");
    render(<Atlas model={m} readers={null} />);
    const shown = within(screen.getByTestId("shapes-page")).getAllByTestId("shapes-row");
    expect(shown).toHaveLength(Math.min(12, rows.length));
    expect(shown[0]).toHaveTextContent(rows[0].title);
    expect(shown[0]).toHaveTextContent(rows[0].id);
    await userEvent.click(within(shown[0]).getByRole("button"));
    expect(where()).toBe(`/record/${rows[0].id}`);
    expect(screen.queryByText(/not found|does not exist/i)).toBeNull();
  });

  it("lists the rules under Contents by name, and a rule's record opens from it", async () => {
    // TaskFlow's rules name no record; this one is given the record it binds.
    const m = model({
      "docs/facets/policies/data/local-first-storage.yaml": (t) =>
        swap(t, "lifecycle: active\n", `lifecycle: active\nreferenced_by:\n  - ${REPEAT_ID}\n`),
    });
    const list = rules(m);
    const rule = list.find((r) => r.appliesTo.length > 0)!;
    // Precondition: the rule names its record.
    expect(rule.appliesTo).toEqual([REPEAT_ID]);
    window.history.replaceState(null, "", "/contents/rules");
    render(<Atlas model={m} readers={null} />);
    const page = within(screen.getByRole("list", { name: "Rules" }));
    for (const r of list) expect(page.getByRole("button", { name: r.title })).toBeInTheDocument();
    const item = page
      .getAllByRole("listitem")
      .find((li) => within(li).queryByRole("button", { name: rule.title }))!;
    await userEvent.click(within(item).getByRole("button", { name: rule.title }));
    const target = rule.appliesTo[0];
    await userEvent.click(within(item).getByRole("button", { name: target.split("/").pop()! }));
    expect(where()).toBe(`/record/${target}`);
  });
});
