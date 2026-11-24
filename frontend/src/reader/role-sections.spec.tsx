/** The role sections Atlas draws on the Overview, on the real Atlas. The
 * model is TaskFlow parsed from its YAML texts; where TaskFlow lacks what a
 * case needs (a brief, a declared defect, a baseline, a lost reference, a
 * history), the text or the scan is changed here, and each case first checks
 * that its fixture carries what it is about. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtlasModel, RepoScan, Taxonomy } from "@/model";
import { loadCorpus } from "@/model";
import { FACETRC, INDEX, RECORDS, SCAN, taskflowModel } from "@/model/fixtures";
import { derive } from "@/derive";
import Atlas from "./Atlas";
import {
  declaredDefects,
  driftComparison,
  firstKnowledgeGap,
  newestRecords,
  openingsOf,
  pillarsOf,
  recordStates,
  scanExcerpt,
  teamPortfolios,
} from "./derive-roles";
import { domainViews, faqByChange, featureViews } from "./derive-reader";

const REPEAT = "docs/facets/features/tasks/recurring/repeat-rule.yaml";
const REPEAT_ID = "tasks/recurring/repeat-rule";
const BRIEF = "A test that changes a rule and compares the completed instances.";

function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`fixture text not found: ${from.slice(0, 40)}`);
  return text.replace(from, to);
}

/** Seven extra records, each with one unbacked promise and a brief, in capability `extra/bare`. */
const EXTRA = Array.from({ length: 7 }, (_, i) => ({
  path: `docs/facets/features/extra/bare/r${i + 1}.yaml`,
  text: `schema_version: "0.1"
id: extra/bare/r${i + 1}
lifecycle: active
intent:
  summary: |
    A bare record number ${i + 1}.
contract:
  scenarios:
    - id: works-${i + 1}
      statement: |
        Given a bare thing ${i + 1}
        When it is used
        Then it works ${i + 1}
      backing:
        state: unbacked
        reason: nobody wrote it yet
        unblocked_by: A test that uses bare thing ${i + 1}.
lineage:
  owner:
    team: extra
  created_at: "${i === 0 ? "9.10.2026" : `2026-07-0${i}`}"
`,
}));

/** TaskFlow with, on `repeat-rule`: one unbacked promise with a brief, one
 * unbacked without, a declared defect in the record's words, one emptied
 * knowledge answer; seven extra
 * records with briefs; and a scan that names a baseline, a lost reference and
 * the last change of each file. */

function richCorpus(): { records: Record<string, string>; index: string } {
  let text = RECORDS[REPEAT];
  text = swap(
    text,
    "        Then they stay unchanged and only future ones follow the new rule\n",
    "        Then they stay unchanged and only future ones follow the new rule\n" +
      "      backing:\n" +
      "        state: unbacked\n" +
      "        reason: The history lives only in the app.\n" +
      `        unblocked_by: ${BRIEF}\n`,
  );
  text = swap(
    text,
    "        Then it keeps the local time of day, not the UTC offset\n",
    "        Then it keeps the local time of day, not the UTC offset\n" +
      "      backing:\n" +
      "        state: unbacked\n" +
      "        reason: No clock in the test.\n",
  );
  text = swap(
    text,
    "        Then exactly one new instance is created with the next Monday as its due date\n",
    "        Then exactly one new instance is created with the next Monday as its due date\n" +
      "      deviation:\n" +
      "        reason: Two instances are created at the end of the month.\n" +
      "        confirmed_by: lena\n",
  );
  text = swap(
    text,
    "    answer: The difference between due date and repetition — the two are shown separately.",
    '    answer: ""',
  );
  text = swap(
    text,
    "      proves: [next-instance-on-complete, rule-edit-keeps-history]",
    "      proves: [next-instance-on-complete]",
  );
  text = swap(
    text,
    "  integration_tests:\n    - id: test/integration/repeat_dst.test.ts\n      proves: [dst-shift-preserves-local-time]\n",
    "",
  );
  const records: Record<string, string> = { ...RECORDS, [REPEAT]: text };
  for (const r of EXTRA) records[r.path] = r.text;
  const index = INDEX + EXTRA.map((r) => `  - ${r.path}\n`).join("");
  return { records, index };
}

function richModel(scan: Partial<RepoScan> = {}): AtlasModel {
  const { records, index } = richCorpus();
  return loadCorpus({ facetrc: FACETRC, index, records, scan: { ...SCAN, ...scan } });
}

let onPhone = false;
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

const where = () => window.location.pathname;

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(() => {
  onPhone = false;
  window.matchMedia = realMatchMedia;
});

describe("first contributions on the newcomer's overview", () => {
  it("lists a brief in its owner's words, counts the undescribed and leaves proven promises out", () => {
    const { openings, undescribed } = openingsOf(derive(richModel()).M);
    const repeat = openings.filter((o) => o.record === REPEAT_ID);
    expect(repeat).toEqual([
      {
        record: REPEAT_ID,
        scenario: "rule-edit-keeps-history",
        capability: "tasks/recurring",
        then: "they stay unchanged and only future ones follow the new rule",
        brief: BRIEF,
        reason: "The history lives only in the app.",
      },
    ]);
    // dst-shift is unbacked without a brief: counted, not listed.
    expect(undescribed).toBeGreaterThanOrEqual(1);
    expect(openings.some((o) => o.scenario === "dst-shift-preserves-local-time")).toBe(false);
    // next-instance-on-complete is proven: no work, whatever it carries.
    expect(openings.some((o) => o.scenario === "next-instance-on-complete")).toBe(false);
  });

  it("orders capabilities the same whatever order the records come in", () => {
    const v = derive(richModel());
    const caps = (fs: typeof v.M) => [...new Set(openingsOf(fs).openings.map((o) => o.capability))];
    expect(caps(v.M)).toEqual(caps([...v.M].reverse()));
    expect(caps(v.M)).toEqual(["extra/bare", "tasks/recurring"]);
  });

  it("answers for one feature what the corpus-wide reading says for it", () => {
    const v = derive(richModel());
    const one = openingsOf([v.byId[REPEAT_ID]]).openings;
    expect(one).toEqual(openingsOf(v.M).openings.filter((o) => o.record === REPEAT_ID));
  });

  it("draws the brief with its capability, opens the promise and the record, five per page", async () => {
    const model = richModel();
    const all = openingsOf(derive(model).M).openings;
    expect(all.length).toBe(8);
    await asRole(/New here/, model);
    const list = screen.getByTestId("overview-openings");
    expect(within(list).getAllByTestId("overview-opening")).toHaveLength(5);
    expect(screen.getByRole("region", { name: "First contributions" })).toHaveTextContent(
      "8 described · 1 without a brief",
    );
    await userEvent.click(
      within(screen.getByRole("region", { name: "First contributions" })).getByRole("button", {
        name: "Page 2",
      }),
    );
    const card = within(screen.getByTestId("overview-openings"))
      .getAllByTestId("overview-opening")
      .find((c) => c.textContent?.includes(BRIEF))!;
    expect(card).toHaveTextContent("tasks/recurring");
    expect(card).toHaveTextContent("they stay unchanged");
    await userEvent.click(within(card).getByRole("button", { name: "Open promise" }));
    expect(where()).toBe(`/record/${REPEAT_ID}/-/rule-edit-keeps-history`);
  });

  it("opens the record from the brief's record id, on the reviewer's overview too", async () => {
    await asRole(/Test & review/, richModel());
    const first = within(screen.getByTestId("overview-openings")).getAllByTestId(
      "overview-opening",
    )[0];
    await userEvent.click(within(first).getByRole("button", { name: "extra/bare/r1" }));
    expect(where()).toBe("/record/extra/bare/r1");
  });

  it("draws no section where no promise is unbacked", async () => {
    expect(openingsOf(derive(taskflowModel()).M)).toEqual({ openings: [], undescribed: 0 });
    await asRole(/New here/);
    expect(screen.queryByRole("region", { name: "First contributions" })).not.toBeInTheDocument();
  });
});

describe("the leadership report names defects and new features", () => {
  it("quotes a declared defect in the record's words and opens its promise", async () => {
    const model = richModel();
    expect(declaredDefects(derive(model).M)).toHaveLength(1);
    await asRole(/Leadership/, model);
    const defects = screen.getByRole("list", { name: "Known defects in the product" });
    expect(defects).toHaveTextContent(
      "Two instances are created at the end of the month. Confirmed by lena.",
    );
    expect(defects).not.toHaveTextContent("Tracked as");
    // The report keeps its plain words with the new sections in it.
    for (const id of ["overview-grid", "overview-role-tail"])
      expect(screen.getByTestId(id).textContent).not.toMatch(
        /Record|Anchor|anchor|Drift|drift|scenario|proves|deviation/i,
      );
    // The defects follow the report's own body.
    expect(
      screen
        .getByTestId("overview-grid")
        .compareDocumentPosition(screen.getByTestId("overview-role-tail")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await userEvent.click(within(defects).getByRole("button"));
    expect(where()).toBe(`/record/${REPEAT_ID}/-/next-instance-on-complete`);
  });

  it("writes no defect section where none is declared", async () => {
    expect(declaredDefects(derive(taskflowModel()).M)).toHaveLength(0);
    await asRole(/Leadership/);
    expect(screen.queryByTestId("overview-leadership-defects")).not.toBeInTheDocument();
  });

  it("lists new features by creation date, leaves an unreadable date out and pages them", async () => {
    const model = richModel();
    const newest = newestRecords(featureViews(model, derive(model)));
    // Precondition: r1 carries "9.10.2026", which would sort first as a string.
    expect(newest.some((f) => f.id === "extra/bare/r1")).toBe(false);
    expect(newest.length).toBeGreaterThan(5);
    await asRole(/Leadership/, model);
    const list = screen.getByRole("list", { name: "Newly created" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(`created on ${newest[0].created}`);
    await userEvent.click(within(rows[0]).getByRole("button"));
    expect(where()).toBe(`/record/${newest[0].id}`);
  });

  it("leaves out every creation date that is no real calendar date", () => {
    const dates = ["9.10.2026", "2026-13-45", "2026-02-30", "2026-10-21junk", "soon"];
    expect(newestRecords(dates.map((createdAt, i) => ({ id: `r${i}`, createdAt })))).toEqual([]);
    expect(
      newestRecords([
        { id: "a", createdAt: "2026-10-21T08:00:00Z" },
        { id: "b", createdAt: "2026-10-22" },
      ]),
    ).toEqual([
      { id: "b", created: "2026-10-22" },
      { id: "a", created: "2026-10-21" },
    ]);
  });

  /** The leadership overview of TaskFlow with each `created_at` line replaced by `line`. */
  async function leadershipWithDates(line: string) {
    const records = Object.fromEntries(
      Object.entries(RECORDS).map(([p, t]) => [p, t.replace(/^ {2}created_at: .*\n/gm, line)]),
    );
    const model = loadCorpus({ facetrc: FACETRC, index: INDEX, records, scan: SCAN });
    const features = featureViews(model, derive(model));
    await asRole(/Leadership/, model);
    return { features, grid: screen.getByTestId("overview-grid") };
  }

  it("writes no new-feature section when no record names a creation date", async () => {
    const { features, grid } = await leadershipWithDates("");
    // Precondition: no feature names a creation date.
    expect(features.some((f) => f.createdAt)).toBe(false);
    expect(grid).toBeInTheDocument();
    expect(screen.queryByTestId("overview-leadership-newest")).not.toBeInTheDocument();
  });

  it("writes no new-feature section when every creation date is unreadable", async () => {
    const { features, grid } = await leadershipWithDates('  created_at: "9.10.2026"\n');
    // Precondition: the dates are there, and none is readable.
    expect(features.some((f) => f.createdAt)).toBe(true);
    expect(newestRecords(features)).toEqual([]);
    expect(grid).toBeInTheDocument();
    expect(screen.queryByTestId("overview-leadership-newest")).not.toBeInTheDocument();
  });
});

describe("the developer's comparison", () => {
  it("names the baseline the drift list was compared against", async () => {
    const model = richModel({
      driftBaseline: {
        kind: "accepted",
        commit: "abcdef1234567890",
        outcome: "accepted",
        acceptedAt: "2026-07-20T09:30:00Z",
      },
    });
    await asRole(/Developer/, model);
    expect(screen.getByTestId("overview-dev-baseline")).toHaveTextContent(
      "Compared with the last reviewed state abcdef123456 · accepted · 2026-07-20 09:30",
    );
  });

  it("names each source repository's baseline", () => {
    const c = driftComparison(
      richModel({
        driftRepositories: [
          { path: "app", baseline: { kind: "head", commit: "1111111" } },
          { path: "lib", baseline: { status: "unavailable" } },
        ],
      }),
    );
    expect(c.baselines.map((b) => b.repository)).toEqual(["app", "lib"]);
    expect(c.determined).toBe(false);
  });

  it("does not call an undetermined comparison quiet in the finding", async () => {
    const model = richModel({ drift: [], driftBaseline: { status: "no-baseline" } });
    await asRole(/Developer/, model);
    expect(screen.getByTestId("overview-dev-baseline")).toHaveTextContent(
      "Drift could not be determined — no state to compare with.",
    );
    // The finding and the drift figure say "not measured", not 0.
    const unmeasured = within(screen.getByTestId("overview-kpis")).getByText("not measured");
    expect(unmeasured.closest('[data-testid="metric-value"]')).toHaveTextContent("—");
  });

  it("lists lost references, deleted files included, and opens their record", async () => {
    const model = richModel({
      referenceChanges: [
        {
          kind: "deleted",
          id: REPEAT_ID,
          path: "packages/core/src/repeat/old.ts",
          evidence: "baseline",
          surviving: 1,
        },
        { kind: "renamed", id: REPEAT_ID, path: "a.ts", evidence: "baseline", surviving: 1 },
        {
          kind: "anchor-removed",
          id: REPEAT_ID,
          path: "b.ts",
          evidence: "private-sidecar",
          surviving: 0,
        },
      ],
    });
    await asRole(/Developer/, model);
    const lost = within(screen.getByRole("list", { name: "Lost references" })).getAllByRole(
      "listitem",
    );
    expect(lost).toHaveLength(2);
    expect(lost[0]).toHaveTextContent("packages/core/src/repeat/old.ts");
    expect(lost[0]).toHaveTextContent(`${REPEAT_ID} · file deleted · 1 anchor remains`);
    expect(lost[1]).toHaveTextContent(
      `${REPEAT_ID} · anchor removed · private anchor · 0 anchors remain`,
    );
    await userEvent.click(within(lost[0]).getByRole("button"));
    expect(where()).toBe(`/record/${REPEAT_ID}`);
  });
});

describe("the ownership portfolio by team", () => {
  it("puts every feature in its team's group, marks drift and counts open questions", async () => {
    const model = taskflowModel();
    const v = derive(model);
    const teams = teamPortfolios(v.M);
    expect(teams.reduce((n, t) => n + t.features.length, 0)).toBe(v.M.length);
    const drifted = teams.flatMap((t) => t.features).find((f) => f.drift > 0)!;
    expect(drifted).toBeDefined();
    await asRole(/Ownership/, model);
    const groups = within(screen.getByTestId("overview-owner-portfolio")).getAllByTestId(
      "overview-owner-team",
    );
    expect(groups.length).toBe(Math.min(4, teams.length));
    const first = teams[0];
    expect(groups[0]).toHaveTextContent(first.team ?? "No team");
    const row = screen
      .getAllByRole("listitem")
      .find((li) => li.textContent?.startsWith(drifted.id))!;
    expect(row).toHaveTextContent(`drift ${drifted.drift}`);
    await userEvent.click(within(row).getByRole("button"));
    expect(where()).toBe(`/record/${drifted.id}`);
  });

  it("pages a team's list by itself and leaves the others where they were", async () => {
    const model = richModel();
    const extra = teamPortfolios(derive(model).M).find((t) => t.team === "extra")!;
    expect(extra.features.length).toBe(7);
    expect(teamPortfolios(derive(model).M).some((t) => t.features.length > 6)).toBe(true);
    await asRole(/Ownership/, model);
    const big = within(screen.getByTestId("overview-owner-portfolio"))
      .getAllByTestId("overview-owner-team")
      .find((g) => within(g).queryByRole("button", { name: "Page 2" }))!;
    const other = within(screen.getByTestId("overview-owner-portfolio"))
      .getAllByTestId("overview-owner-team")
      .find((g) => g !== big)!;
    const before = other.textContent;
    await userEvent.click(within(big).getByRole("button", { name: "Page 2" }));
    expect(within(big).getByText(/^7–/)).toBeInTheDocument();
    expect(other.textContent).toBe(before);
  });
});

describe("the agent's register and excerpt", () => {
  it("gives every record its state in a register sorted by clicking a header", async () => {
    const model = taskflowModel();
    const states = recordStates(derive(model).M);
    await asRole(/Agent/, model);
    const table = within(screen.getByTestId("overview-agent-register")).getByRole("grid");
    const firstCell = () => within(table).getAllByRole("row")[1].querySelector("td")!.textContent;
    expect(firstCell()).toBe(states[0].id);
    const drift = within(table).getByRole("columnheader", { name: /drift/ });
    await userEvent.click(within(drift).getByRole("button"));
    expect(drift).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(within(drift).getByRole("button"));
    expect(drift).toHaveAttribute("aria-sort", "descending");
    const most = [...states].sort((a, b) => b.drift - a.drift)[0];
    expect(firstCell()).toBe(most.id);
  });

  it("hands the scan over raw, with null for what was not counted and its own shapes", async () => {
    const model = taskflowModel();
    const excerpt = scanExcerpt(derive(model)) as {
      promises: { total: number; named: number; unclaimed: number; unbacked: number };
      anchors: { total: number; orphans: number };
      tests: { measured: null };
      totalLoc: number | null;
      anchoredLoc: number | null;
      files: number | null;
    };
    expect(excerpt.tests).toEqual({ measured: null });
    // TaskFlow's scan sends no file count: null, never 0.
    expect(derive(model).scan.files).toBeNull();
    expect(excerpt.files).toBeNull();
    expect(Object.keys(excerpt)).toEqual(expect.arrayContaining(["drift", "orphanAnchors"]));
    expect(Object.keys(excerpt.anchors)).toEqual(["total", "orphans"]);
    expect(excerpt.promises.unclaimed).toBe(excerpt.promises.total - excerpt.promises.named);
    await asRole(/Agent/, model);
    const raw = screen.getByTestId("overview-agent-excerpt");
    expect(raw.tagName).toBe("PRE");
    expect(JSON.parse(raw.textContent!)).toEqual(excerpt);
  });
});

describe("the author's template", () => {
  it("stands ready at the first record that needs knowledge, with only its open slots", async () => {
    const model = richModel();
    const gap = firstKnowledgeGap(derive(model).M)!;
    expect(gap.slots.length).toBeGreaterThan(0);
    await asRole(/Record author/, model);
    const region = screen.getByRole("region", { name: "Knowledge template" });
    const yaml = within(region).getByTestId("overview-author-template").textContent!;
    for (const slot of gap.slots) expect(yaml).toContain(`  ${slot}:`);
    expect(yaml.match(/^ {2}\w+:$/gm)).toHaveLength(gap.slots.length);
    await userEvent.click(within(region).getByRole("button", { name: gap.record }));
    expect(where()).toBe(`/record/${gap.record}`);
  });
});

describe("the newcomer's questions", () => {
  it("orders the answers by the newest change of record or code, and by id without history", () => {
    const model = richModel();
    const v = derive(model);
    const withAnswers = v.M.filter((f) => f.know.some((k) => k.answer?.trim()));
    expect(withAnswers.length).toBeGreaterThan(1);
    const last = withAnswers.at(-1)!;
    const dated = derive(
      richModel({ lastChanged: { [last.rec.path]: "2026-07-28" } as Record<string, string> }),
    );
    expect(faqByChange(dated)[0].record).toBe(last.id);
    const undated = faqByChange(v).map((e) => e.record);
    expect(undated).toEqual([...undated].sort());
  });

  it("pages the newcomer's lists on a phone", async () => {
    phone();
    await asRole(/New here/, richModel());
    await userEvent.click(
      within(screen.getByRole("region", { name: "First contributions" })).getByRole("button", {
        name: "Load 3 more",
      }),
    );
    expect(screen.getByText("6–8 of 8")).toBeInTheDocument();
    expect(screen.getAllByTestId("overview-opening")).toHaveLength(3);
  });
});

describe("the developer's drift without a comparison", () => {
  it("never reads calm on the page when the comparison could not be made", async () => {
    const model = richModel({ drift: [], driftBaseline: { status: "no-baseline" } });
    // Precondition: no drift entry and no comparison.
    expect(driftComparison(model).determined).toBe(false);
    await asRole(/Developer/, model);
    expect(screen.getByTestId("overview-dev-drift-unmeasured")).toHaveTextContent(
      "— · not measured",
    );
    expect(screen.getByTestId("overview")).not.toHaveTextContent("No drift");
  });
});

describe("the ownership portfolio pages its teams", () => {
  it("shows four teams per page and counts every team", async () => {
    const model = richModel();
    const teams = teamPortfolios(derive(model).M);
    // Precondition: more teams than one page holds.
    expect(teams.length).toBe(5);
    await asRole(/Ownership/, model);
    const portfolio = screen.getByTestId("overview-owner-portfolio");
    expect(within(portfolio).getAllByTestId("overview-owner-team")).toHaveLength(4);
    const region = screen.getByRole("region", { name: "Portfolio by team" });
    expect(within(region).getByText("1–4 of 5")).toBeInTheDocument();
  });
});

describe("the newcomer's answers", () => {
  it("names the day of the feature's newest change, and no day without history", async () => {
    const plain = richModel();
    const v = derive(plain);
    const last = v.M.filter((f) => f.know.some((k) => k.answer?.trim())).at(-1)!;
    const dated = richModel({
      lastChanged: { [last.rec.path]: "2026-07-28" } as Record<string, string>,
    });
    // Precondition: the dated feature is the one the order puts first.
    expect(faqByChange(derive(dated))[0]).toMatchObject({ record: last.id, changed: "2026-07-28" });
    await asRole(/New here/, dated);
    const first = screen.getAllByTestId("overview-new-faq-entry")[0];
    expect(first).toHaveTextContent(last.id);
    expect(within(first).getByTestId("overview-new-faq-changed")).toHaveTextContent(
      "changed 2026-07-28",
    );
    expect(screen.getAllByTestId("overview-new-faq-changed")).toHaveLength(
      faqByChange(derive(dated))
        .filter((e) => e.changed)
        .slice(0, 5).length,
    );
  });

  it("claims no day where the host sent no history", async () => {
    const model = richModel();
    const faq = faqByChange(derive(model));
    // Precondition: no history, and more answers than one page holds.
    expect(faq.every((e) => e.changed === null)).toBe(true);
    expect(faq.length).toBeGreaterThan(5);
    await asRole(/New here/, model);
    expect(screen.getAllByTestId("overview-new-faq-entry")).toHaveLength(5);
    expect(screen.getByText(`1–5 of ${faq.length}`)).toBeInTheDocument();
    expect(screen.queryAllByTestId("overview-new-faq-changed")).toHaveLength(0);
  });

  it("finds answers by every word and narrows them to one kind", async () => {
    const model = richModel();
    const faq = faqByChange(derive(model));
    const target = faq[0];
    const word = target.answer
      .split(/\s+/)
      .find((w) => w.length > 5)!
      .replace(/[^\p{L}]/gu, "");
    const expected = faq.filter(
      (e) =>
        `${e.question} ${e.answer} ${e.record}`.toLowerCase().includes(word.toLowerCase()) &&
        `${e.question} ${e.answer} ${e.record}`.toLowerCase().includes(target.record.toLowerCase()),
    );
    // Precondition: the two words together narrow the list.
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(faq.length);
    await asRole(/New here/, model);
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search the answers" }),
      `${word} ${target.record}`,
    );
    expect(screen.getAllByTestId("overview-new-faq-entry")).toHaveLength(
      Math.min(5, expected.length),
    );
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search the answers" }),
      " nirgendwo",
    );
    expect(screen.queryAllByTestId("overview-new-faq-entry")).toHaveLength(0);
    expect(screen.getByTestId("overview-new-faq-none")).toHaveTextContent("No answer matches.");
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search the answers" }));
    const kinds = screen.getByRole("group", { name: "Kind of answer" });
    const notFor = within(kinds).getByRole("button", { name: /Not for/ });
    await userEvent.click(notFor);
    const shown = screen.getAllByTestId("overview-new-faq-entry");
    expect(shown).toHaveLength(Math.min(5, faq.filter((e) => e.slot === "not_for").length));
    for (const e of shown)
      expect(within(e).getByTestId("overview-new-faq-kind")).toHaveTextContent("Not for");
    await userEvent.click(notFor);
    expect(notFor).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByTestId("overview-new-faq-entry")).toHaveLength(Math.min(5, faq.length));
    expect(screen.getByText(`1–5 of ${faq.length}`)).toBeInTheDocument();
  });
});

describe("what the product rests on", () => {
  it("names the most drawn-on capabilities, numbered, above the areas, and opens one", async () => {
    const model = taskflowModel();
    const p = pillarsOf(derive(model).M);
    // Precondition: TaskFlow declares dependencies, and lists/core carries the most.
    expect(p.measured && p.pillars[0]).toMatchObject({ id: "lists/core", incoming: 4 });
    await asRole(/New here/, model);
    const list = screen.getByTestId("overview-pillars");
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("1");
    expect(rows[0]).toHaveTextContent(
      "lists/core · 4 dependencies from elsewhere (36%) · 1 record",
    );
    expect(list.compareDocumentPosition(screen.getByTestId("overview-new-built"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await userEvent.click(within(rows[0]).getByRole("button"));
    expect(where()).toBe("/domain/lists/core");
  });

  it("says the graph is unmeasured where no record declares a dependency", async () => {
    const records = Object.fromEntries(
      Object.entries(RECORDS).map(([p, t]) => [
        p,
        t.replace(/^ {2}depends_on:\n(?: {4}- .*\n)+/gm, ""),
      ]),
    );
    const model = loadCorpus({ facetrc: FACETRC, index: INDEX, records, scan: SCAN });
    expect(pillarsOf(derive(model).M)).toEqual({ measured: false });
    await asRole(/New here/, model);
    expect(screen.getByTestId("overview-pillars-unmeasured")).toHaveTextContent(
      "— · not measured: no record names a dependency",
    );
    expect(screen.queryByTestId("overview-pillars")).not.toBeInTheDocument();
  });

  it("does not count an edge inside one capability", () => {
    expect(
      pillarsOf([
        { id: "a/x/one", deps: ["a/x/two"] },
        { id: "a/x/two", deps: [] },
      ]),
    ).toEqual({ measured: false });
  });

  it("orders equal weights the same whatever the input order", () => {
    const fs = [
      { id: "a/x/one", deps: ["b/y/r", "c/z/r"] },
      { id: "b/y/r", deps: [] },
      { id: "c/z/r", deps: [] },
    ];
    const one = pillarsOf(fs);
    expect(pillarsOf([...fs].reverse())).toEqual(one);
    expect(one.measured && one.pillars.map((x) => x.id)).toEqual(["b/y", "c/z"]);
  });

  it("leaves out what carries too little, and names what a spread-out graph leans on", () => {
    const heavy = Array.from({ length: 10 }, (_, i) => ({ id: `s/s${i}/r`, deps: ["core/c/r"] }));
    const p = pillarsOf([
      ...heavy,
      { id: "x/x/r", deps: ["light/l/r"] },
      { id: "core/c/r", deps: [] },
    ]);
    // The floor is a tenth of eleven edges, rounded up: two. light/l carries one.
    expect(p).toEqual({
      measured: true,
      edges: 11,
      pillars: [{ id: "core/c", incoming: 10, records: 1 }],
      leaning: [],
    });
    const spread = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}/c/r`,
      deps: [`d${(i + 1) % 12}/c/r`],
    }));
    // Twelve edges, each capability drawn on once: the floor is two, nothing reaches it.
    expect(pillarsOf(spread)).toEqual({
      measured: true,
      edges: 12,
      pillars: [],
      leaning: ["d0/c", "d1/c", "d10/c"].map((id) => ({ id, incoming: 1, records: 1 })),
    });
  });
});

describe("the reviewer's bench", () => {
  /** TaskFlow as richModel builds it, plus a record that promises nothing. */
  function withEmptyRecord(): AtlasModel {
    const { records, index } = richCorpus();
    const path = "docs/facets/features/extra/empty/nothing.yaml";
    records[path] = `schema_version: "0.1"
id: extra/empty/nothing
lifecycle: active
intent:
  summary: |
    A record that promises nothing.
lineage:
  owner:
    team: extra
`;
    return loadCorpus({ facetrc: FACETRC, index: index + `  - ${path}\n`, records, scan: SCAN });
  }

  const bench = () => screen.getByTestId("bench-tree");
  const categories = () => within(bench()).getAllByTestId("bench-category");

  it("counts the five sizes a reviewer looks for", async () => {
    const model = richModel();
    const v = derive(model);
    // Precondition: every size is above nought somewhere in the fixture.
    expect(v.TOT.unbacked).toBeGreaterThan(0);
    expect(v.TOT.devs).toBe(1);
    await asRole(/Test & review/, model);
    const counts = screen.getByTestId("bench-counts");
    expect(counts).toHaveTextContent(`${v.TOT.open}Promises without a test link`);
    expect(counts).toHaveTextContent(
      `${v.M.filter((f) => f.proven === 0).length}Records without any test`,
    );
    expect(counts).toHaveTextContent(
      `${v.M.filter((f) => !f.hasKnow).length}Features without documentation`,
    );
    expect(counts).toHaveTextContent(`${v.TOT.unbacked}Deliberately unbacked`);
    expect(counts).toHaveTextContent("1Declared deviations");
  });

  it("takes categories and features away with the filter and carries the denominator", async () => {
    const model = richModel();
    const v = derive(model);
    const recurring = v.cats.find(([c]) => c === "tasks/recurring")![1];
    const scenarios = recurring.reduce((n, f) => n + f.scen.length, 0);
    await asRole(/Test & review/, model);
    const unfiltered = categories().length;
    expect(within(categories()[0]).getByTestId("bench-category-count")).toHaveTextContent(
      /^1 feature · \d+ scenarios · \d+ open$/,
    );
    await userEvent.click(
      within(screen.getByRole("group", { name: "Evidence" })).getByRole("button", {
        name: "Deviations",
      }),
    );
    expect(categories()).toHaveLength(1);
    expect(categories().length).toBeLessThan(unfiltered);
    expect(within(categories()[0]).getByTestId("bench-category-count")).toHaveTextContent(
      `1 of 1 features · 1 of ${scenarios} scenarios`,
    );
  });

  it("keeps a declared deviation out of the linked tests and shows it under its own selection", async () => {
    const model = richModel();
    const repeat = derive(model).M.find((f) => f.id === REPEAT_ID)!;
    const dev = repeat.scen.find((x) => x.id === "next-instance-on-complete")!;
    // Precondition: a test names the deviation, and it is the record's only named one.
    expect(dev.state).toBe("dev");
    expect(dev.tests.length).toBeGreaterThan(0);
    expect(repeat.scen.filter((x) => x.tests.length)).toEqual([dev]);
    await asRole(/Test & review/, model);
    const evidence = screen.getByRole("group", { name: "Evidence" });
    await userEvent.click(within(evidence).getByRole("button", { name: "With a test" }));
    // Its test does not make it a linked promise: the category has nothing to show.
    expect(categories().some((c) => c.textContent?.includes("tasks/recurring"))).toBe(false);
    await userEvent.click(within(evidence).getByRole("button", { name: "Deviations" }));
    // The selection's first category stands open; its feature unfolds.
    const only = within(bench()).getByTestId("bench-feature");
    await userEvent.click(within(only).getAllByRole("button")[0]);
    const devs = within(bench()).getAllByTestId("bench-promise");
    expect(devs).toHaveLength(1);
    expect(devs[0]).toHaveTextContent("next-instance-on-complete");
    expect(devs[0]).toHaveTextContent("Deviation");
    expect(within(devs[0]).getByTestId("bench-measure-deviation")).toHaveTextContent("declared");
    expect(within(devs[0]).getByTestId("bench-measure-tests")).toHaveTextContent(
      `Tests ${dev.tests.length}`,
    );
  });

  it("measures the readership against the whole corpus and blames it for an empty tree", async () => {
    const model = richModel();
    const all = derive(model).M.flatMap((f) => f.scen);
    // Precondition: TaskFlow classifies no scenario.
    expect(all.every((s) => s.audience === null)).toBe(true);
    await asRole(/Test & review/, model);
    expect(screen.getByTestId("bench-unclassified")).toHaveTextContent(
      `${all.length} of ${all.length} scenarios without a readership`,
    );
    await userEvent.click(
      within(screen.getByRole("group", { name: "Readership" })).getByRole("button", {
        name: "Product",
      }),
    );
    expect(screen.queryByTestId("bench-tree")).not.toBeInTheDocument();
    expect(screen.getByTestId("bench-empty")).toHaveTextContent(
      "No scenario is assigned to this readership.",
    );
  });

  it("gives every promise its five measures and opens it at its own depth", async () => {
    const model = taskflowModel();
    const v = derive(model);
    const f = v.cats[0][1][0];
    const s = f.scen[0];
    // Precondition: TaskFlow never writes @facet-proves:, and this promise has a test.
    expect(s.raw.anchorsAdopted).toBe(false);
    expect(s.raw.implementedBy).toHaveLength(0);
    expect(s.tests.length).toBeGreaterThan(0);
    await asRole(/Test & review/, model);
    const feature = within(categories()[0]).getByTestId("bench-feature");
    await userEvent.click(within(feature).getAllByRole("button")[0]);
    const row = within(feature).getAllByTestId("bench-promise")[0];
    expect(within(row).getByTestId("bench-measure-tests")).toHaveTextContent(
      `Tests ${s.tests.length}`,
    );
    expect(within(row).getByTestId("bench-measure-evidence")).toHaveTextContent("Evidence linked");
    expect(within(row).getByTestId("bench-measure-anchor")).toHaveTextContent(
      "Anchor not declared",
    );
    expect(within(row).getByTestId("bench-measure-audience")).toHaveTextContent("Readership —");
    expect(within(row).getByTestId("bench-measure-deviation")).toHaveTextContent("Deviation —");
    expect(row).not.toHaveTextContent(/Drift|drift/i);
    await userEvent.click(row);
    expect(where()).toBe(`/record/${f.id}/-/${s.id}`);
  });

  it("says a record without a promise holds none, with no degree of proof and two noughts", async () => {
    const model = withEmptyRecord();
    const f = derive(model).M.find((x) => x.id === "extra/empty/nothing")!;
    // Precondition: the record is there, in a category of its own, and promises nothing.
    expect(derive(model).cats.map(([c]) => c)).toContain("extra/empty");
    expect(f.claims).toBe(0);
    expect(f.scen).toHaveLength(0);
    await asRole(/Test & review/, model);
    const find = () => categories().find((c) => c.textContent?.includes("extra/empty"));
    if (!find())
      await userEvent.click(
        within(bench().nextElementSibling as HTMLElement).getByRole("button", { name: "Page 2" }),
      );
    const cat = find()!;
    await userEvent.click(within(cat).getAllByRole("button")[0]);
    const feature = within(cat).getByTestId("bench-feature");
    expect(within(feature).getByTestId("bench-feature-state")).toHaveTextContent(/^no promise/);
    expect(feature).not.toHaveTextContent(/no test|%|\/0/);
    await userEvent.click(within(feature).getAllByRole("button")[0]);
    expect(within(feature).getByTestId("bench-no-scenario")).toHaveTextContent(
      "This record holds no scenario.",
    );
    const gapNone = screen.getByTestId("bench-gap-none");
    // The record stands last in the column, on its second page.
    await userEvent.click(within(gapNone).getByRole("button", { name: "Page 2" }));
    const none = within(gapNone).getAllByRole("listitem");
    expect(none.find((r) => r.textContent?.includes("nothing"))).toHaveTextContent(
      "0 promises · 0 tests",
    );
  });

  it("pages its top level eight categories at a time", async () => {
    const model = taskflowModel();
    // Precondition: more categories than one page holds.
    expect(derive(model).cats).toHaveLength(10);
    await asRole(/Test & review/, model);
    expect(categories()).toHaveLength(8);
    expect(screen.getByText("1–8 of 10")).toBeInTheDocument();
  });

  it("keeps the three kinds of gap apart, and a gap row opens its feature", async () => {
    const model = taskflowModel();
    const v = derive(model);
    await asRole(/Test & review/, model);
    const tests = within(screen.getByTestId("bench-gap-tests")).getAllByRole("listitem");
    expect(tests).toHaveLength(Math.min(6, v.M.filter((f) => f.open > 0).length));
    const none = within(screen.getByTestId("bench-gap-none")).getAllByRole("listitem");
    expect(none).toHaveLength(1);
    expect(none[0]).toHaveTextContent("task-search");
    expect(within(screen.getByTestId("bench-gap-docs")).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(within(none[0]).getByRole("button"));
    expect(where()).toBe("/record/search/fulltext/task-search");
  });
});

describe("what the product does, for a newcomer", () => {
  /** TaskFlow with a taxonomy of its own areas and capabilities (it declares
   * none), `core` classified core and every other one supporting; `null`
   * classifies nothing. */

  function classified(core: string[] | null): AtlasModel {
    const base = taskflowModel();
    const taxonomy: Taxonomy = {
      schemaVersion: "1",
      domains: domainViews(base).map((d) => ({
        name: d.id,
        title: d.title,
        purpose: "",
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

  it("lists only the core capabilities and counts the supporting ones beneath", async () => {
    const domains = domainViews(taskflowModel());
    const d0 = domains.find((d) => d.capabilities.length > 0)!;
    const core = `${d0.id}/${d0.capabilities[0].id}`;
    const model = classified([core]);
    const all = domainViews(model).reduce((n, d) => n + d.capabilities.length, 0);
    // Every record outside the core capability, assumptions included.
    const rest = featureViews(model, derive(model)).filter(
      (f) => `${f.domain}/${f.capability}` !== core,
    ).length;
    // Precondition: more than the one capability exists.
    expect(all).toBeGreaterThan(1);
    await asRole(/New here/, model);
    const cards = screen.getAllByTestId("overview-new-built-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent(d0.title);
    expect(cards[0]).toHaveTextContent(d0.capabilities[0].title);
    expect(screen.getByTestId("overview-new-built-rest")).toHaveTextContent(
      `${all - 1} more capabilities support the product · ${rest} records`,
    );
    await userEvent.click(cards[0]);
    expect(where()).toBe(`/domain/${d0.id}`);
  });

  it("lists every area and says none is classified where nothing is core", async () => {
    const model = classified(null);
    const domains = domainViews(model);
    // Precondition: no capability is classified at all.
    expect(domains.every((d) => d.capabilities.every((c) => c.cls === ""))).toBe(true);
    await asRole(/New here/, model);
    expect(screen.getAllByTestId("overview-new-built-card")).toHaveLength(
      Math.min(6, domains.length),
    );
    expect(screen.getByTestId("overview-new-built-unclassified")).toHaveTextContent(
      "No capability is classified as core.",
    );
    expect(screen.queryByTestId("overview-new-built-rest")).not.toBeInTheDocument();
  });

  it("pages the area cards six at a time and reaches the rest", async () => {
    // TaskFlow plus five areas of one record each, so more areas than one page holds.
    const records: Record<string, string> = { ...RECORDS };
    let index = INDEX;
    for (let k = 1; k <= 5; k++) {
      const path = `docs/facets/features/zone${k}/part/thing.yaml`;
      records[path] = `schema_version: "0.1"
id: zone${k}/part/thing
lifecycle: active
intent:
  summary: |
    Area ${k} of the paging fixture.
`;
      index += `  - ${path}\n`;
    }
    const model = loadCorpus({ facetrc: FACETRC, index, records, scan: SCAN });
    const domains = domainViews(model);
    // Precondition: more areas than the six of one page.
    expect(domains.length).toBeGreaterThan(6);
    await asRole(/New here/, model);
    const built = screen.getByTestId("overview-new-built");
    expect(within(built).getAllByTestId("overview-new-built-card")).toHaveLength(6);
    const pager = built.nextElementSibling as HTMLElement;
    expect(pager).toHaveTextContent(`1–6 of ${domains.length}`);
    await userEvent.click(within(pager).getByRole("button", { name: "Page 2" }));
    const second = within(built).getAllByTestId("overview-new-built-card");
    expect(second).toHaveLength(Math.min(6, domains.length - 6));
    expect(second[0]).toHaveTextContent(domains[6].title);
  });
});
