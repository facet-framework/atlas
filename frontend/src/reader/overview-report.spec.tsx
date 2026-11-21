import { germanLabel } from "@/i18n/testing-labels.spec-support";
/** The leadership report and the ownership portfolio on the real Atlas. The
 * model is TaskFlow parsed from its YAML texts; where a case needs a defect, a
 * fix or a team that TaskFlow lacks, the YAML is changed here and parsed again,
 * and each case first checks that its fixture carries what it is about. */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtlasModel, RepoScan } from "@/model";
import { loadCorpus } from "@/model";
import { FACETRC, INDEX, RECORDS, SCAN, taskflowModel } from "@/model/fixtures";
import i18n from "@/i18n";
import { derive } from "@/derive";
import Atlas from "./Atlas";
import { declaredDefects, newestRecords, teamPortfolios } from "./derive-roles";
import { featureViews, overviewModel } from "./derive-reader";

const REPEAT = "docs/facets/features/tasks/recurring/repeat-rule.yaml";
const REPEAT_ID = "tasks/recurring/repeat-rule";
const LWW = "docs/facets/features/sync/conflict/last-write-wins.yaml";
const LWW_ID = "sync/conflict/last-write-wins";

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

/** A record in its own area with the given scenarios (YAML list items) and team. */
function extraRecord(id: string, scenarios: string, team = "extra"): string {
  return `schema_version: "0.1"
id: ${id}
lifecycle: active
intent:
  summary: |
    Record ${id}.
${scenarios ? `contract:\n  scenarios:\n${scenarios}` : ""}lineage:
  owner:
    team: ${team}
  created_at: "2026-07-01"
`;
}

const scenario = (id: string, extra = "") => `    - id: ${id}
      statement: |
        Given ${id}
        When it runs
        Then ${id} holds
${extra}`;

/** Fixes inserted into a record's defect register, before its lineage. */
const withFixes =
  (...fixes: { date: string; subject: string; commit?: string }[]) =>
  (text: string) =>
    swap(
      text,
      "lineage:\n",
      "defects:\n  fixes:\n" +
        fixes
          .map(
            (f, i) =>
              `    - commit: ${f.commit ?? String(i + 1).repeat(40)}\n` +
              `      date: "${f.date}"\n` +
              "      files: [packages/core/src/repeat/rule.ts]\n" +
              `      subject: ${JSON.stringify(f.subject)}\n` +
              "      recorded_by: manual\n",
          )
          .join("") +
        "lineage:\n",
    );

async function asRole(name: RegExp, m: AtlasModel = taskflowModel()) {
  window.history.replaceState(null, "", "/");
  render(<Atlas model={m} readers={null} />);
  await userEvent.click(screen.getByRole("button", { name: "Developer" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name }));
  expect(screen.getByTestId("overview")).toBeInTheDocument();
}

const where = () => window.location.pathname;
const areaRows = () => within(screen.getByRole("group", { name: "Areas" })).getAllByRole("button");

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("the leadership report's words and areas", () => {
  it("calls a named test an association, never a check or a proof, in German and English", async () => {
    await asRole(/Leadership/);
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      const grid = screen.getByTestId("overview-grid");
      expect(grid.textContent).not.toMatch(/checked|proven|Evidence|executed|passed/);
      expect(
        within(screen.getByTestId("overview-kpis")).getByText(
          germanLabel("Promises with a test named"),
        ),
      ).toBeInTheDocument();
      expect(grid).toHaveTextContent(
        germanLabel("{{count}} promises are not named by any test yet.")
          .replace("{{count}}", "")
          .trim(),
      );
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      const en = screen.getByTestId("overview-grid");
      expect(en.textContent).not.toMatch(/checked|proven|proof|executed|\brun\b|passed/i);
      expect(
        within(screen.getByTestId("overview-kpis")).getByText("Promises with a test named"),
      ).toBeInTheDocument();
      expect(en).toHaveTextContent(/(is|are) not named by any test yet/);
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("says the calm in words: no code ahead of its description, no rework, each area calm", async () => {
    const m = model({}, {}, { drift: [] });
    // Precondition: the week is measured, so its sentence can be calm rather than unmeasured.
    expect(featureViews(m, derive(m)).some((f) => f.createdAt)).toBe(true);
    await asRole(/Leadership/, m);
    expect(screen.getByTestId("overview-leadership-week")).toHaveTextContent(
      "No code changed ahead of its description.",
    );
    const rework = screen.getByText(/^Areas with rework/).parentElement!;
    expect(rework.textContent).toMatch(/^0Areas with rework/);
    for (const row of areaRows()) expect(row).toHaveTextContent("calm");
  });

  it("draws a dash, not a share, for an area that promises nothing, and puts it last", async () => {
    const m = model(
      {},
      { "docs/facets/features/zzz/empty/r.yaml": extraRecord("zzz/empty/r", "") },
    );
    await asRole(/Leadership/, m);
    const rows = areaRows();
    const empty = rows.find((r) => within(r).queryByRole("img", { name: "zzz: —" }))!;
    expect(empty).toBeDefined();
    expect(empty).toHaveTextContent("1 feature · 0 promises open");
    expect(empty).not.toHaveTextContent(/0\s?%/);
    // Every area after it promises nothing either: an empty area never stands above a measured one.
    for (const later of rows.slice(rows.indexOf(empty)))
      expect(within(later).getByRole("img").getAttribute("aria-label")).toMatch(/: —$/);
  });

  it("orders the areas by the share of promises with a test named, lowest first", async () => {
    const m = taskflowModel();
    const domains = overviewModel(m, derive(m)).domains;
    const share = (d: (typeof domains)[number]) => (d.scenarios ? d.proven / d.scenarios : 2);
    const expected = [...domains].sort((a, b) => share(a) - share(b)).map((d) => d.title);
    // Precondition: the shares differ, so an order can be wrong.
    expect(new Set(domains.map(share)).size).toBeGreaterThan(1);
    await asRole(/Leadership/, m);
    const label = (r: HTMLElement) => within(r).getByRole("img").getAttribute("aria-label")!;
    expect(areaRows().map((r) => label(r).replace(/: .*$/, ""))).toEqual(expected);
    await userEvent.click(areaRows()[0]);
    const first = [...domains].sort((a, b) => share(a) - share(b))[0];
    expect(where()).toBe(`/domain/${first.id}`);
  });

  it("keeps declared defects out of the share and counts them in their own section", async () => {
    const m = model({
      [REPEAT]: (t) =>
        swap(
          t,
          "        Then exactly one new instance is created with the next Monday as its due date\n",
          "        Then exactly one new instance is created with the next Monday as its due date\n" +
            "      deviation:\n        reason: Two instances are created at the end of the month.\n        confirmed_by: lena\n",
        ),
    });
    const M = derive(m).M;
    const claims = M.reduce((n, f) => n + f.claims, 0);
    const proven = M.reduce((n, f) => n + f.proven, 0);
    // Precondition: the defect is a scenario but no claim.
    expect(M.reduce((n, f) => n + f.scen.length, 0)).toBe(claims + 1);
    await asRole(/Leadership/, m);
    expect(
      within(screen.getByTestId("overview-kpis")).getByText(
        `${Math.round((proven / claims) * 100)}%`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Known defects in the product" })).toHaveTextContent(
      "1 entry",
    );
  });

  it("pages the declared defects five at a time", async () => {
    const extra: Record<string, string> = {};
    for (let i = 1; i <= 6; i++)
      extra[`docs/facets/features/defects/d${i}/r.yaml`] = extraRecord(
        `defects/d${i}/r`,
        [1, 2]
          .map((n) =>
            scenario(`broken-${n}`, `      deviation:\n        reason: Error ${i}.${n}.\n`),
          )
          .join(""),
      );
    const m = model({}, extra);
    expect(declaredDefects(derive(m).M)).toHaveLength(12);
    await asRole(/Leadership/, m);
    const region = screen.getByRole("region", { name: "Known defects in the product" });
    expect(region).toHaveTextContent("12 entries");
    const items = () =>
      within(
        within(region).getByRole("list", { name: "Known defects in the product" }),
      ).getAllByRole("listitem");
    expect(items()).toHaveLength(5);
    await userEvent.click(within(region).getByRole("button", { name: "Page 3" }));
    expect(items()).toHaveLength(2);
  });

  it("says about a defect only what the record says: a ticket where named, nothing where nothing", async () => {
    const m = model({
      [REPEAT]: (t) =>
        swap(
          swap(
            t,
            "        Then exactly one new instance is created with the next Monday as its due date\n",
            "        Then exactly one new instance is created with the next Monday as its due date\n" +
              '      deviation:\n        reason: Two instances are created at the end of the month.\n        confirmed_by: lena\n        tracked_as: "#12"\n',
          ),
          "        Then it keeps the local time of day, not the UTC offset\n",
          "        Then it keeps the local time of day, not the UTC offset\n      deviation: {}\n",
        ),
    });
    const defects = declaredDefects(derive(m).M);
    // Precondition: both are read as defects, the second one without any detail.
    expect(defects).toHaveLength(2);
    await asRole(/Leadership/, m);
    const rows = within(
      screen.getByRole("list", { name: "Known defects in the product" }),
    ).getAllByRole("listitem");
    const full = rows.find((r) => r.textContent!.includes("Two instances"))!;
    const bare = rows.find((r) => r !== full)!;
    expect(full).toHaveTextContent(
      "Two instances are created at the end of the month. Confirmed by lena. Tracked as #12.",
    );
    expect(bare).toHaveTextContent("No further details.");
    expect(bare).not.toHaveTextContent(/Confirmed|Tracked|—/);
  });

  it("lists new features newest first by creation date, never by change, and pages them", async () => {
    const extra: Record<string, string> = {};
    for (let i = 1; i <= 4; i++)
      extra[`docs/facets/features/young/y${i}/r.yaml`] = extraRecord(`young/y${i}/r`, "").replace(
        '"2026-07-01"',
        `"2026-07-1${i}"`,
      );
    const m = model({}, extra);
    const newest = newestRecords(featureViews(m, derive(m)));
    expect(newest.length).toBeGreaterThan(5);
    await asRole(/Leadership/, m);
    const list = screen.getByRole("list", { name: "Newly created" });
    const dates = within(list)
      .getAllByRole("listitem")
      .map((r) => r.textContent!.match(/\d{4}-\d{2}-\d{2}/)![0]);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(list).not.toHaveTextContent(/this week|changed/);
    const region = screen.getByRole("region", { name: "Newly created" });
    await userEvent.click(within(region).getByRole("button", { name: "Page 2" }));
    expect(
      within(screen.getByRole("list", { name: "Newly created" })).getAllByRole("listitem")[0],
    ).toHaveTextContent(`created on ${newest[5].created}`);
  });
});

describe("the ownership portfolio", () => {
  it("sums itself in one sentence: features, teams, waiting for their record, announced", async () => {
    const m = taskflowModel();
    const v = derive(m);
    const teams = teamPortfolios(v.M).filter((t) => t.team).length;
    const planned = v.M.filter((f) => f.life === "planned").length;
    const drifted = v.M.filter((f) => f.driftN > 0).length;
    // Preconditions: one record waits for its record, at least one is only announced.
    expect(drifted).toBe(1);
    expect(planned).toBeGreaterThan(0);
    await asRole(/Ownership/, m);
    expect(screen.getByTestId("overview-owner-portfolio-sum")).toHaveTextContent(
      `${v.M.length} features · ${teams} teams · 1 waits for its record · ${planned} announced without code`,
    );
  });

  it("puts in each team's group only its own features, with its own counts", async () => {
    const m = taskflowModel();
    const v = derive(m);
    await asRole(/Ownership/, m);
    const groups = within(screen.getByTestId("overview-owner-portfolio")).getAllByTestId(
      "overview-owner-team",
    );
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) {
      const name = g.getAttribute("aria-label")!;
      const team = name === "No team" ? "" : name;
      const ids = within(within(g).getByRole("list"))
        .getAllByRole("listitem")
        .map((li) => within(li).getAllByText(/\//)[0].textContent!);
      const own = v.M.filter((f) => (f.team || "") === team);
      for (const id of ids) expect(v.byId[id].team || "").toBe(team);
      const claims = own.reduce((n, f) => n + f.claims, 0);
      const proven = own.reduce((n, f) => n + f.proven, 0);
      expect(g).toHaveTextContent(
        `${own.length} ${own.length === 1 ? "feature" : "features"} · ${proven} of ${claims} promises`,
      );
    }
  });

  it("names how many records of a team ask an open question, by the lint's rule", async () => {
    const knowledge = (body: string) =>
      `knowledge:\n  not_for:\n    question: What is it not for?\n${body}`;
    const rec = (id: string, k: string) =>
      extraRecord(id, scenario("works")).replace("lineage:", `${k}lineage:`);
    const m = model(
      {},
      {
        "docs/facets/features/ask/a/r.yaml": rec("ask/a/r", knowledge('    answer: ""\n')),
        "docs/facets/features/ask/b/r.yaml": rec(
          "ask/b/r",
          knowledge('    answer: ""\n    derive_from: [anchors]\n'),
        ),
        "docs/facets/features/ask/c/r.yaml": rec("ask/c/r", knowledge("    answer: Nothing.\n")),
      },
    );
    await asRole(/Ownership/, m);
    const group = within(screen.getByTestId("overview-owner-portfolio"))
      .getAllByTestId("overview-owner-team")
      .find((g) => g.getAttribute("aria-label") === "extra")!;
    // a: unanswered; b: derived, closed by the lint's rule; c: answered.
    expect(group).toHaveTextContent("1 with open questions");
    const row = within(group)
      .getAllByRole("listitem")
      .find((li) => li.textContent!.startsWith("ask/a/r"))!;
    expect(row).toHaveTextContent("1 open question");
    const derived = within(group)
      .getAllByRole("listitem")
      .find((li) => li.textContent!.startsWith("ask/b/r"))!;
    expect(derived).not.toHaveTextContent("open question");
    await userEvent.click(within(row).getByRole("button"));
    expect(where()).toBe("/record/ask/a/r");
  });

  it("marks a drifted feature with its count and leaves a calm one without a mark", async () => {
    const m = taskflowModel();
    const all = teamPortfolios(derive(m).M).flatMap((t) => t.features);
    const calm = all.find((f) => f.drift === 0 && f.id.startsWith("sync/"))!;
    expect(calm).toBeDefined();
    await asRole(/Ownership/, m);
    const row = (id: string) =>
      screen.getAllByRole("listitem").find((li) => li.textContent!.startsWith(id))!;
    expect(row(LWW_ID)).toHaveTextContent("drift 1");
    expect(row(calm.id)).not.toHaveTextContent(/drift/i);
  });

  it("gives a tile that fits on one page no pager", async () => {
    const extra: Record<string, string> = {};
    for (let i = 1; i <= 7; i++)
      extra[`docs/facets/features/extra/bare/r${i}.yaml`] = extraRecord(`extra/bare/r${i}`, "");
    const m = model({}, extra);
    await asRole(/Ownership/, m);
    const groups = within(screen.getByTestId("overview-owner-portfolio")).getAllByTestId(
      "overview-owner-team",
    );
    const big = groups.find((g) => g.getAttribute("aria-label") === "extra")!;
    const small = groups.find(
      (g) => within(within(g).getByRole("list")).getAllByRole("listitem").length < 6,
    )!;
    expect(within(big).getByRole("button", { name: "Page 2" })).toBeInTheDocument();
    expect(small).toBeDefined();
    expect(within(small).queryByRole("button", { name: "Page 2" })).toBeNull();
  });

  it("measures the reach bars against this corpus' largest reach and lists nothing nobody depends on", async () => {
    const m = taskflowModel();
    const v = derive(m);
    const max = Math.max(...v.M.map((f) => f.usedBy.length));
    const nobody = v.M.find((f) => f.usedBy.length === 0)!;
    expect(max).toBeGreaterThan(1);
    expect(nobody).toBeDefined();
    await asRole(/Ownership/, m);
    const rows = within(screen.getByRole("list", { name: "Reach" })).getAllByRole("listitem");
    for (const row of rows) {
      const id = v.M.find((f) => row.textContent!.startsWith(f.id))!;
      expect(within(row).getByRole("meter")).toHaveAttribute(
        "aria-valuenow",
        String(Math.round((id.usedBy.length / max) * 100)),
      );
    }
    expect(within(rows[0]).getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
    expect(rows.some((r) => r.textContent!.startsWith(nobody.id))).toBe(false);
  });
});

describe("the ownership history of fixes", () => {
  const fixList = () => screen.getByRole("list", { name: "History of fixes" });

  it("carries the subject without its fix prefix and its date, and opens the feature", async () => {
    const m = model({
      [REPEAT]: withFixes({
        date: "2026-07-20",
        subject: "fix: the repeat rule keeps the local time",
      }),
    });
    await asRole(/Ownership/, m);
    const row = within(fixList()).getAllByRole("listitem")[0];
    expect(row).toHaveTextContent("the repeat rule keeps the local time");
    expect(row).not.toHaveTextContent("fix:");
    expect(row).toHaveTextContent(`2026-07-20 · ${REPEAT_ID}`);
    await userEvent.click(within(row).getByRole("button"));
    expect(where()).toBe(`/record/${REPEAT_ID}`);
  });

  it("says a commit without a subject has none, and puts neither its id, file nor date there", async () => {
    const m = model({
      [REPEAT]: withFixes(
        { date: "2026-07-20", subject: "fix(core):", commit: "c".repeat(40) },
        { date: "2026-07-19", subject: "", commit: "d".repeat(40) },
      ),
    });
    expect(derive(m).allFixes).toHaveLength(2);
    await asRole(/Ownership/, m);
    const titles = within(fixList()).getAllByText("no subject");
    expect(titles).toHaveLength(2);
    for (const title of titles)
      expect(title.textContent).not.toMatch(/ccccccc|ddddddd|rule\.ts|2026-07/);
  });

  it("cuts a long subject to its first line at a word, with an ellipsis, and keeps it whole in the title", async () => {
    const long =
      "fix: the repeat rule keeps the local time across every daylight saving switch even when the device sleeps through it\n\nThe body explains more.";
    const m = model({ [REPEAT]: withFixes({ date: "2026-07-20", subject: long }) });
    await asRole(/Ownership/, m);
    const title = within(fixList()).getAllByRole("listitem")[0].querySelector("[title]")!;
    expect(title.getAttribute("title")).toBe(long);
    const text = title.textContent!;
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toMatch(/body|fix:/);
    const kept = text.slice(0, -1);
    const rest = long.replace(/^fix: /, "").slice(kept.length);
    // The cut falls on a word boundary: what was dropped starts with a space.
    expect(rest.startsWith(" ")).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(96);
  });

  it("orders fixes newest first, whatever order the records name them in", async () => {
    const m = model({
      [REPEAT]: withFixes(
        { date: "2026-07-01", subject: "fix: first" },
        { date: "2026-07-20", subject: "fix: second" },
      ),
      [LWW]: withFixes({ date: "2026-07-10", subject: "fix: third" }),
    });
    await asRole(/Ownership/, m);
    const dates = within(fixList())
      .getAllByRole("listitem")
      .map((r) => r.textContent!.match(/\d{4}-\d{2}-\d{2}/)![0]);
    expect(dates).toEqual(["2026-07-20", "2026-07-10", "2026-07-01"]);
  });
});
