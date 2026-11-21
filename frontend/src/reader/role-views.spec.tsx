/** The role Overviews of the real Atlas, one case per promise the website
 * makes for a role. The model is TaskFlow, parsed from its YAML texts; where
 * TaskFlow lacks what a promise needs (a deviation, a fix, a record without an
 * owner, a record written this week, more records than one page), the YAML is
 * changed here and parsed again, and each case first checks that its fixture
 * really carries what it is about. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtlasModel } from "@/model";
import { loadCorpus } from "@/model";
import { FACETRC, INDEX, RECORDS, SCAN, taskflowModel } from "@/model/fixtures";
import { derive } from "@/derive";
import Atlas from "./Atlas";
import { driftViews, featureViews, roleSurfaces } from "./derive-reader";

const REPEAT = "docs/facets/features/tasks/recurring/repeat-rule.yaml";

function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`fixture text not found: ${from.slice(0, 40)}`);
  return text.replace(from, to);
}

/** Six extra records with intent only: no scenarios, no owner, no knowledge. */
const EXTRA = Array.from({ length: 6 }, (_, i) => ({
  path: `docs/facets/features/extra/bare/r${i + 1}.yaml`,
  text: `schema_version: "0.1"
id: extra/bare/r${i + 1}
lifecycle: active
intent:
  summary: |
    A bare record number ${i + 1}.
`,
}));

/** TaskFlow with: a declared deviation, a fix, no owner and a creation date in
 * the scan's week on `repeat-rule`, one knowledge answer emptied there, and
 * six bare records so the author's table needs a second page. */

function richModel(): AtlasModel {
  let text = RECORDS[REPEAT];
  text = swap(
    text,
    "        Then it keeps the local time of day, not the UTC offset\n",
    "        Then it keeps the local time of day, not the UTC offset\n" +
      "      deviation:\n" +
      "        reason: The instance shifts by one hour on the daylight-saving changeover day.\n" +
      "        confirmed_by: test\n",
  );
  text = swap(
    text,
    "    answer: The difference between due date and repetition — the two are shown separately.",
    '    answer: ""',
  );
  const owner =
    / {2}owner:\n {4}team: tasks\n {4}individual: [^\n]+\n {2}created_at: "2026-05-28"/.exec(
      text,
    )?.[0];
  if (!owner) throw new Error("fixture owner section is missing");
  text = swap(text, owner, '  created_at: "2026-07-27"');
  text = swap(
    text,
    "lineage:\n",
    "defects:\n" +
      "  fixes:\n" +
      "    - commit: a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1\n" +
      '      date: "2026-07-20"\n' +
      "      files: [packages/core/src/repeat/rule.ts]\n" +
      '      subject: "fix: the repeat rule keeps the local time"\n' +
      "      recorded_by: manual\n" +
      "lineage:\n",
  );
  const records: Record<string, string> = { ...RECORDS, [REPEAT]: text };
  for (const r of EXTRA) records[r.path] = r.text;
  const index = INDEX + EXTRA.map((r) => `  - ${r.path}\n`).join("");
  return loadCorpus({ facetrc: FACETRC, index, records, scan: SCAN });
}

/** TaskFlow with every `created_at` removed. */
function undatedModel(): AtlasModel {
  const records = Object.fromEntries(
    Object.entries(RECORDS).map(([p, t]) => [p, t.replace(/^ {2}created_at: .*\n/gm, "")]),
  );
  return loadCorpus({ facetrc: FACETRC, index: INDEX, records, scan: SCAN });
}

const realMatchMedia = window.matchMedia;

function phone() {
  onPhone = true;
  window.matchMedia = ((query: string) => ({
    matches: query === "(max-width: 767px)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

let onPhone = false;

async function asRole(name: RegExp, model: AtlasModel = taskflowModel()) {
  window.history.replaceState(null, "", "/");
  render(<Atlas model={model} readers={null} />);
  if (onPhone) {
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    await userEvent.click(screen.getByRole("radio", { name }));
  } else {
    await userEvent.click(screen.getByRole("button", { name: "Developer" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name }));
  }
  expect(screen.getByTestId("overview")).toBeInTheDocument();
}

const surfaces = (model: AtlasModel) => roleSurfaces(derive(model), driftViews(model));

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(() => {
  onPhone = false;
  window.matchMedia = realMatchMedia;
});

const where = () => window.location.pathname;

describe("role views carry what the website names for each role", () => {
  it("reports to leadership without a schema word, with this week, risk, owners and open questions", async () => {
    const model = richModel();
    const unowned = featureViews(model, derive(model)).filter((f) => !f.owner);
    expect(unowned.map((f) => f.id)).toContain("tasks/recurring/repeat-rule");
    await asRole(/Leadership/, model);
    const report = screen.getByTestId("overview-grid");
    expect(report.textContent).not.toMatch(
      /Record|Anchor|anchor|Drift|drift|Szenari|scenario|proves/i,
    );
    expect(
      within(screen.getByTestId("overview-leadership-week")).getByRole("button", {
        name: "Repeat rule",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "At risk" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Who holds what" })).getAllByRole("listitem").length,
    ).toBeGreaterThan(0);
    const questions = screen.getByRole("region", { name: "Open questions" });
    expect(questions).toHaveTextContent(`${unowned.length} features without an owner`);
    await userEvent.click(within(questions).getByRole("button", { name: /Repeat rule/ }));
    expect(where()).toBe("/record/tasks/recurring/repeat-rule");
  });

  it("names this week on a phone as on the desktop", async () => {
    phone();
    await asRole(/Leadership/, richModel());
    expect(screen.getByTestId("overview-leadership-week")).toHaveTextContent(
      "feature written down.",
    );
  });

  it("says this week is not measured when no record names its creation date", async () => {
    const model = undatedModel();
    expect(featureViews(model, derive(model)).some((f) => f.createdAt)).toBe(false);
    await asRole(/Leadership/, model);
    expect(screen.getByTestId("overview-leadership-week-unmeasured")).toHaveTextContent(
      "— · not measured",
    );
  });

  it("omits the related-decisions card when the registry names no ADR", async () => {
    const model = taskflowModel();
    model.decisionTargets = [];
    await asRole(/Leadership/, model);
    expect(screen.queryByText("Related decisions")).not.toBeInTheDocument();
  });

  it("shows a developer the promises without a test in the drifted records and opens them", async () => {
    const open = surfaces(taskflowModel()).driftUnproven!;
    expect(open.length).toBeGreaterThan(0);
    await asRole(/Developer/);
    const rows = within(
      screen.getByRole("list", { name: "Promises without a test in drifted records" }),
    ).getAllByRole("listitem");
    expect(rows).toHaveLength(open.length);
    expect(rows[0]).toHaveTextContent(`${open[0].record} · ${open[0].scenario}`);
    await userEvent.click(within(rows[0]).getByRole("button"));
    expect(where()).toBe(`/record/${open[0].record}`);
  });

  it("shows a reviewer capability → feature → promise, the declared deviations and open knowledge", async () => {
    const model = richModel();
    expect(surfaces(model).deviations).toHaveLength(1);
    await asRole(/Test & review/, model);
    const caps = screen.getByRole("list", { name: "Capability → feature → promise" });
    await userEvent.click(within(caps).getAllByRole("button")[0]);
    expect(where()).toMatch(/^\/domain\/[^/]+\/[^/]+$/);
  });

  it("lists the declared deviation with its reason and the records with open knowledge", async () => {
    await asRole(/Test & review/, richModel());
    expect(screen.getByRole("list", { name: "Declared deviations" })).toHaveTextContent(
      "The instance shifts by one hour on the daylight-saving changeover day.",
    );
    expect(
      within(screen.getByTestId("overview-test-undocumented")).getByRole("button", {
        name: /tasks\/recurring\/repeat-rule/,
      }),
    ).toBeInTheDocument();
  });

  it("says no deviation is declared where none is", async () => {
    expect(surfaces(taskflowModel()).deviations).toHaveLength(0);
    await asRole(/Test & review/);
    expect(screen.getByRole("region", { name: "Declared deviations" })).toHaveTextContent(
      "No record declares a deviation.",
    );
  });

  it("shows ownership the reach the records declare and the history of fixes", async () => {
    const model = richModel();
    const s = surfaces(model);
    expect(s.reach!.length).toBeGreaterThan(0);
    expect(s.fixes).toHaveLength(1);
    await asRole(/Ownership/, model);
    const reach = within(screen.getByRole("list", { name: "Reach" })).getAllByRole("listitem");
    expect(reach[0]).toHaveTextContent(s.reach![0].record);
    const fixes = screen.getByRole("list", { name: "History of fixes" });
    expect(fixes).toHaveTextContent("the repeat rule keeps the local time");
    expect(fixes).not.toHaveTextContent("fix:");
  });

  it("says no record names a fix where the register is empty", async () => {
    expect(surfaces(taskflowModel()).fixes).toHaveLength(0);
    await asRole(/Ownership/);
    expect(screen.getByRole("region", { name: "History of fixes" })).toHaveTextContent(
      "No record names a fix.",
    );
  });

  it("shows a newcomer the answers the owners wrote and opens the glossary", async () => {
    const faq = surfaces(taskflowModel()).faq!;
    expect(faq.length).toBeGreaterThan(5);
    await asRole(/New here/);
    const list = screen.getByTestId("overview-new-faq");
    expect(list).toHaveTextContent(faq[0].answer);
    expect(screen.getByText(`1–5 of ${faq.length}`)).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("region", { name: "Four words first" })).getByRole("button", {
        name: "Glossary",
      }),
    );
    expect(where()).toBe("/glossary");
  });

  it("gives the agent the host's endpoints and null for what was not measured", async () => {
    await asRole(/Agent/);
    const endpoints = screen.getByRole("list", { name: "Endpoints" });
    for (const path of [
      "GET /api/corpus",
      "GET /api/rag",
      "GET /api/repo/state",
      "GET /api/plugins",
      "POST /api/plugin/call",
    ])
      expect(endpoints).toHaveTextContent(path);
    const json = JSON.parse(screen.getByTestId("agent-json").textContent!);
    expect(json.commit).toBeNull();
  });

  it("closes the agent gate for an orphan anchor", async () => {
    const model = taskflowModel();
    expect(model.scan.orphanAnchors?.length).toBeGreaterThan(0);
    await asRole(/Agent/, model);
    expect(screen.getByText("Registry inconsistent, commit gate closed.")).toBeInTheDocument();
    const checks = screen.getByRole("list", { name: "Checks" });
    expect(within(checks).getByText("Anchor").parentElement).toHaveTextContent(
      `${model.scan.orphanAnchors!.length} orphaned @facet: id`,
    );
  });

  it("leaves agent checks unmeasured when lint input is absent", async () => {
    const base = taskflowModel();
    const model = { ...base, scan: { ...base.scan, orphanAnchors: undefined } };
    await asRole(/Agent/, model);
    expect(screen.getByText("Commit gate not measured.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Checks" })).toHaveTextContent("not measured");
  });

  it("shows every unmeasured value as a dash and sends it to the agent as null", async () => {
    const model = undatedModel();
    // Precondition: the reading has no commit and no creation date.
    expect(featureViews(model, derive(model)).some((f) => f.createdAt)).toBe(false);
    await asRole(/Agent/, model);
    const json = JSON.parse(screen.getByTestId("agent-json").textContent!);
    expect(json.commit).toBeNull();
    expect(screen.getByTestId("overview-grid").textContent).not.toMatch(/"commit": "—"/);
    await userEvent.click(screen.getByRole("button", { name: "Agent" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Leadership/ }));
    expect(screen.getByTestId("overview-leadership-week-unmeasured")).toHaveTextContent(
      "— · not measured",
    );
  });

  it("lists every record for the author with its fields, emptiest first, across pages", async () => {
    const model = richModel();
    const total = featureViews(model, derive(model)).length;
    expect(total).toBeGreaterThan(12);
    await asRole(/Record author/, model);
    const table = screen.getByTestId("author-knowledge");
    const missing = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((r) => Number(within(r).getAllByRole("cell").at(-1)!.textContent));
    const first = missing();
    expect(first).toHaveLength(12);
    expect(first).toEqual([...first].sort((a, b) => b - a));
    expect(first[0]).toBeGreaterThan(0);
    expect(screen.getByText(`1–12 of ${total}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    const second = missing();
    expect(second).toHaveLength(total - 12);
    expect(Math.max(...second)).toBeLessThanOrEqual(Math.min(...first));
  });

  it("pages the author's table on a phone", async () => {
    phone();
    const model = richModel();
    const total = featureViews(model, derive(model)).length;
    await asRole(/Record author/, model);
    await userEvent.click(
      screen.getByRole("button", { name: `Load ${Math.min(12, total - 12)} more` }),
    );
    expect(screen.getByText(`13–${total} of ${total}`)).toBeInTheDocument();
  });
});
