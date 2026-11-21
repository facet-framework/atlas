/** The working roles' Overviews on the real Atlas: the developer's
 * workbench, the agent's tools and excerpt, and the author's field matrix.
 * The model is TaskFlow parsed from its YAML texts, or a small corpus written
 * here where a case needs exact knowledge slots; each case first checks that
 * its fixture carries what it is about. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtlasModel, RepoScan } from "@/model";
import { loadCorpus } from "@/model";
import { FACETRC, INDEX, RECORDS, SCAN, taskflowModel } from "@/model/fixtures";
import { derive } from "@/derive";
import Atlas from "./Atlas";
import { featureViews } from "./derive-reader";
import type { HostReaders } from "./host";

const LWW = "docs/facets/features/sync/conflict/last-write-wins.yaml";
const LWW_ID = "sync/conflict/last-write-wins";

function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`fixture text not found: ${from.slice(0, 40)}`);
  return text.replace(from, to);
}

function withScan(scan: Partial<RepoScan>, records = RECORDS, index = INDEX): AtlasModel {
  return loadCorpus({ facetrc: FACETRC, index, records, scan: { ...SCAN, ...scan } });
}

/** A corpus of only the given records, under the TaskFlow `.facetrc`. */
function corpus(records: Record<string, string>, scan: Partial<RepoScan> = {}): AtlasModel {
  const index = `records:\n${Object.keys(records)
    .map((p) => `  - ${p}\n`)
    .join("")}`;
  return loadCorpus({ facetrc: FACETRC, index, records, scan: { ...SCAN, drift: [], ...scan } });
}

const ANSWERS = `knowledge:
  prerequisite_knowledge:
    question: Q1
    answer: A1
  not_for:
    question: Q2
    answer: A2
  discoverability:
    question: Q3
    answer: A3
  common_pitfalls:
    question: Q4
    answer: A4
  success_signal:
    question: Q5
    answer: A5
`;

/** A record with every field filled unless a part is given empty. */
function record(
  id: string,
  { summary = "Does a thing.", scenario = true, team = "core" as string | null } = {},
): string {
  return `schema_version: "0.1"
id: ${id}
lifecycle: active
intent:
  summary: "${summary}"
${
  scenario
    ? `contract:
  scenarios:
    - id: works
      statement: |
        Given a thing
        When it is used
        Then it works
`
    : ""
}${ANSWERS}${team ? `lineage:\n  owner:\n    team: ${team}\n` : ""}`;
}

async function asRole(name: RegExp, model: AtlasModel = taskflowModel(), readers?: HostReaders) {
  window.history.replaceState(null, "", "/");
  render(<Atlas model={model} readers={readers ?? null} />);
  await userEvent.click(screen.getByRole("button", { name: "Developer" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name }));
  expect(screen.getByTestId("overview")).toBeInTheDocument();
}

const where = () => window.location.pathname;

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("the developer's workbench", () => {
  it("names a drifted file with its record, and opens that record from the row", async () => {
    const drift = SCAN.drift!;
    expect(drift.length).toBeGreaterThan(0);
    await asRole(/Developer/);
    const row = within(screen.getByTestId("drift-list")).getAllByRole("listitem")[0];
    expect(row).toHaveTextContent(drift[0].path);
    await userEvent.click(within(row).getByRole("button", { name: drift[0].id }));
    expect(where()).toBe(`/record/${drift[0].id}`);
  });

  it("writes a dash where the scan supplied no stamp, after every dated file", async () => {
    const model = withScan({
      drift: [
        { id: LWW_ID, path: "crates/sync/src/undated.rs", changedAt: "" },
        { id: LWW_ID, path: "crates/sync/src/conflict.rs", changedAt: "2026-07-26T14:02:00Z" },
      ],
    });
    await asRole(/Developer/, model);
    const rows = within(screen.getByTestId("drift-list")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("crates/sync/src/conflict.rs");
    expect(rows[0]).toHaveTextContent("2026-07-26");
    expect(rows[1]).toHaveTextContent("crates/sync/src/undated.rs");
    expect(rows[1]).toHaveTextContent("—");
    // The finding names the newest real day, never the dash.
    expect(screen.getByTestId("overview")).toHaveTextContent("2026-07-26");
  });

  it("cuts a stamp to its own day without converting it, and passes a non-stamp through", async () => {
    const model = withScan({
      drift: [
        { id: LWW_ID, path: "crates/sync/src/conflict.rs", changedAt: "2026-07-20T23:30:00-05:00" },
      ],
      driftBaseline: {
        kind: "accepted",
        commit: "abcdef1234567890",
        outcome: "accepted",
        acceptedAt: "yesterday",
      },
    } as Partial<RepoScan>);
    await asRole(/Developer/, model);
    const row = within(screen.getByTestId("drift-list")).getAllByRole("listitem")[0];
    expect(row).toHaveTextContent("2026-07-20");
    expect(row).not.toHaveTextContent("2026-07-21");
    expect(row).not.toHaveTextContent(/ago/);
    expect(screen.getByTestId("overview-dev-baseline")).toHaveTextContent(
      "Compared with the last reviewed state abcdef123456 · accepted · yesterday",
    );
  });

  it("lists only the unnamed promises of the drifted records, never a proven or unbacked one", async () => {
    let text = RECORDS[LWW];
    text = swap(
      text,
      "      proves: [newest-write-wins, equal-timestamp-tiebreak]",
      "      proves: [newest-write-wins]",
    );
    text = swap(
      text,
      "        Then the device ID decides deterministically\n",
      "        Then the device ID decides deterministically\n" +
        "      backing:\n        state: unbacked\n        reason: No second clock in the test.\n",
    );
    const model = withScan({}, { ...RECORDS, [LWW]: text });
    const v = derive(model);
    // Preconditions: the drifted record holds one proven, one unbacked and one
    // unnamed promise, and an untouched record holds an unnamed one too.
    expect(v.byId[LWW_ID].scen.map((s) => s.state).sort()).toEqual(["no", "ok", "un"]);
    expect(v.M.some((f) => f.id !== LWW_ID && f.scen.some((s) => s.state === "no"))).toBe(true);
    await asRole(/Developer/, model);
    const rows = within(
      screen.getByRole("list", { name: "Promises without a test in drifted records" }),
    ).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(`${LWW_ID} · version-retention`);
  });

  it("names the three commands that make the same comparison on the command line", async () => {
    await asRole(/Developer/);
    const commands = screen.getByTestId("overview-dev-commands");
    expect(
      within(commands)
        .getAllByRole("term")
        .map((t) => t.textContent),
    ).toEqual(["facet drift", "facet lint", "git commit"]);
    expect(commands).toHaveTextContent("the same comparison");
  });

  it("says each list is quiet in words when nothing drifted and no anchor is orphaned", async () => {
    const model = withScan({
      drift: [],
      orphanAnchors: [],
      driftBaseline: { kind: "head", commit: "abc1234" },
    } as Partial<RepoScan>);
    await asRole(/Developer/, model);
    expect(screen.getByText("No drift")).toBeInTheDocument();
    expect(screen.getByText("Every anchored file matches its record.")).toBeInTheDocument();
    expect(screen.getByText("Every promise of these records has a test.")).toBeInTheDocument();
    expect(screen.getByTestId("coverage-orphans")).toHaveTextContent(
      "No anchor points at a missing record.",
    );
    expect(screen.queryByTestId("drift-list")).toBeNull();
  });

  it("names each source repository with its own baseline, the accepted one with commit, outcome and date", async () => {
    const model = withScan({
      driftRepositories: [
        { path: "app", baseline: { kind: "head", commit: "1111111aaaa" } },
        {
          path: "lib",
          baseline: {
            kind: "accepted",
            commit: "abcdef1234567890",
            outcome: "accepted",
            acceptedAt: "2026-07-20T09:30:00Z",
          },
        },
      ],
    } as Partial<RepoScan>);
    await asRole(/Developer/, model);
    const b = screen.getByTestId("overview-dev-baseline");
    expect(b).toHaveTextContent("app · Compared with HEAD (1111111aaaa)");
    expect(b).toHaveTextContent(
      "lib · Compared with the last reviewed state abcdef123456 · accepted · 2026-07-20 09:30",
    );
  });

  it("names a failed source repository and never reads calm beside it", async () => {
    const model = withScan({
      drift: [],
      driftRepositories: [
        { path: "app", baseline: { kind: "head", commit: "1111111" } },
        { path: "lib", baseline: { status: "unavailable" } },
      ],
    } as Partial<RepoScan>);
    await asRole(/Developer/, model);
    expect(screen.getByTestId("overview-dev-baseline")).toHaveTextContent(
      "lib · Drift could not be determined",
    );
    expect(screen.getByTestId("overview-dev-drift-unmeasured")).toHaveTextContent(
      "— · not measured",
    );
    expect(screen.getByTestId("overview")).not.toHaveTextContent("No drift");
  });

  it("pages ten drifted files, six lost references and six orphan anchors and reaches the rest", async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => i + 1);
    const model = withScan({
      drift: twelve.map((i) => ({
        id: LWW_ID,
        path: `crates/sync/src/f${i}.rs`,
        changedAt: `2026-07-${String(i).padStart(2, "0")}T10:00:00Z`,
      })),
      referenceChanges: twelve.map((i) => ({
        kind: "deleted",
        id: LWW_ID,
        path: `crates/sync/src/gone${i}.rs`,
        evidence: "baseline",
        surviving: 1,
      })),
      orphanAnchors: twelve.map((i) => ({
        path: `apps/web/src/o${i}.tsx`,
        line: i,
        id: `ghost/x/r${i}`,
      })),
    } as Partial<RepoScan>);
    await asRole(/Developer/, model);
    const drift = screen.getByRole("region", { name: "Drift" });
    const lost = screen.getByRole("region", { name: "Comparison" });
    const orphans = screen.getByTestId("coverage-orphans");
    const count = (el: HTMLElement, list: string) =>
      within(within(el).getByRole("list", { name: list })).getAllByRole("listitem").length;
    expect(count(drift, "Files with drift")).toBe(10);
    expect(count(lost, "Lost references")).toBe(6);
    expect(count(orphans, "Anchors without a record")).toBe(6);
    await userEvent.click(within(drift).getByRole("button", { name: "Page 2" }));
    await userEvent.click(within(lost).getByRole("button", { name: "Page 2" }));
    await userEvent.click(within(orphans).getByRole("button", { name: "Page 2" }));
    expect(count(drift, "Files with drift")).toBe(2);
    expect(count(lost, "Lost references")).toBe(6);
    expect(count(orphans, "Anchors without a record")).toBe(6);
  });
});

describe("the agent's tools and excerpt", () => {
  const readers = (tools: HostReaders["tools"]): HostReaders => ({
    repo: () => Promise.reject(new Error("no repo")),
    agent: () => Promise.resolve(null),
    tools,
    installed: () => Promise.resolve([]),
  });

  it("lists exactly the server's own tool names and says the retrieval tool needs an index", async () => {
    await asRole(
      /Agent/,
      taskflowModel(),
      readers(() => Promise.resolve({ available: true, tools: ["feature_find", "rag_query"] })),
    );
    const list = await screen.findByRole("list", { name: "Tools" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("feature_find");
    expect(rows[1]).toHaveTextContent("rag_query");
    expect(rows[1]).toHaveTextContent("needs an index from facet rag index");
    expect(rows[0]).not.toHaveTextContent(/index/i);
  });

  it("names the server's reason instead of an empty list when it cannot list its tools", async () => {
    await asRole(
      /Agent/,
      taskflowModel(),
      readers(() => Promise.resolve({ available: false, reason: "facet mcp exited", tools: [] })),
    );
    expect(await screen.findByTestId("overview-agent-tools-unavailable")).toHaveTextContent(
      "not available: facet mcp exited",
    );
    expect(screen.queryByRole("list", { name: "Tools" })).toBeNull();
  });

  it("names a refused request by its own reason", async () => {
    await asRole(
      /Agent/,
      taskflowModel(),
      readers(() => Promise.reject(new Error("503 mcp unavailable"))),
    );
    await waitFor(() =>
      expect(screen.getByTestId("overview-agent-tools-unavailable")).toHaveTextContent(
        "503 mcp unavailable",
      ),
    );
  });

  it("says the tools were not measured when the host was not asked", async () => {
    await asRole(/Agent/);
    expect(screen.getByTestId("overview-agent-tools-unmeasured")).toHaveTextContent(
      "— · not measured",
    );
    expect(screen.queryByRole("list", { name: "Tools" })).toBeNull();
  });

  it("counts open knowledge by the lint's rule: active records only, derived and confirmed exemptions closed", async () => {
    const slot = (name: string, body: string) => `  ${name}:\n    question: Q\n${body}`;
    const one = `schema_version: "0.1"
id: k/one/r
lifecycle: active
intent:
  summary: "One."
knowledge:
${slot("prerequisite_knowledge", "    answer: Known.\n")}${slot(
      "not_for",
      '    answer: ""\n    derive_from: [anchors]\n',
    )}${slot(
      "discoverability",
      '    answer: ""\n    not_applicable:\n      reason: No surface.\n      confirmed_by: lena\n',
    )}${slot(
      "common_pitfalls",
      '    answer: ""\n    not_applicable:\n      reason: Nobody confirmed.\n',
    )}${slot("success_signal", '    answer: ""\n')}`;
    const variant = `schema_version: "0.1"
id: k/two/r
variants:
  web:
    lifecycle: active
intent:
  summary: "Two."
knowledge:
${slot("success_signal", '    answer: ""\n')}`;
    const planned = `schema_version: "0.1"
id: k/three/r
lifecycle: planned
intent:
  summary: "Three."
knowledge:
${slot("success_signal", '    answer: ""\n')}${slot("not_for", '    answer: ""\n')}`;
    const model = corpus({
      "docs/facets/features/k/one/r.yaml": one,
      "docs/facets/features/k/two/r.yaml": variant,
      "docs/facets/features/k/three/r.yaml": planned,
    });
    // Precondition: all three records were read.
    expect(
      derive(model)
        .M.map((f) => f.id)
        .sort(),
    ).toEqual(["k/one/r", "k/three/r", "k/two/r"]);
    await asRole(/Agent/, model);
    const excerpt = JSON.parse(screen.getByTestId("overview-agent-excerpt").textContent!);
    // One: the exemption without a confirmer and the unanswered slot. Two: its
    // variant is active. Three: planned, nobody's work yet.
    expect(excerpt.knowledge.open).toBe(3);
  });
});

describe("the author's field matrix", () => {
  /** TaskFlow with repeat-rule's prerequisite answer emptied and its owner removed. */
  function authorModel(): AtlasModel {
    const path = "docs/facets/features/tasks/recurring/repeat-rule.yaml";
    let text = RECORDS[path];
    text = swap(
      text,
      "    answer: The difference between due date and repetition — the two are shown separately.",
      '    answer: ""',
    );
    return withScan({}, { ...RECORDS, [path]: text });
  }

  const rowOf = (id: string) =>
    within(screen.getByTestId("author-knowledge"))
      .getAllByRole("row")
      .find((r) => within(r).queryByRole("button", { name: id }))!;

  it("marks each cell filled or open and nothing else", async () => {
    await asRole(/Record author/, authorModel());
    const row = rowOf("tasks/recurring/repeat-rule");
    expect(within(row).getByLabelText("Prerequisite open")).toBeInTheDocument();
    for (const slot of ["Not for", "How you notice it", "Intent", "Scenarios", "Owner"])
      expect(within(row).getByLabelText(`${slot} filled`)).toBeInTheDocument();
    expect(screen.getByTestId("author-knowledge").textContent).not.toMatch(/%/);
  });

  it("measures intent, scenarios and owner on the record's own fields", async () => {
    const model = corpus({
      "docs/facets/features/m/a/r.yaml": record("m/a/r", { scenario: false }),
      "docs/facets/features/m/b/r.yaml": record("m/b/r", { team: null }),
      "docs/facets/features/m/c/r.yaml": record("m/c/r", { summary: "" }),
    });
    await asRole(/Record author/, model);
    const expectations: [string, string][] = [
      ["m/a/r", "Scenarios"],
      ["m/b/r", "Owner"],
      ["m/c/r", "Intent"],
    ];
    for (const [id, open] of expectations) {
      const row = rowOf(id);
      for (const field of ["Intent", "Scenarios", "Owner"])
        expect(
          within(row).getByLabelText(`${field} ${field === open ? "open" : "filled"}`),
        ).toBeInTheDocument();
      expect(within(row).getAllByRole("cell").at(-1)).toHaveTextContent("1");
    }
  });

  it("opens a record from its row", async () => {
    await asRole(/Record author/, authorModel());
    const first = within(screen.getByTestId("author-knowledge")).getAllByRole("row")[1];
    const id = within(first).getAllByRole("button")[0].textContent!;
    await userEvent.click(within(first).getByRole("button", { name: id }));
    expect(where()).toBe(`/record/${id}`);
  });

  it("counts measured active records and their empty knowledge slots in the opening sentence", async () => {
    const model = authorModel();
    const features = featureViews(model, derive(model)).filter((f) => f.lifecycle === "active");
    const measured = features.filter((f) => f.knowledgeMeasured);
    const slots = measured.reduce((a, f) => a + f.knowledgeOpen, 0);
    expect(slots).toBeGreaterThan(0);
    await asRole(/Record author/, model);
    expect(
      within(screen.getByTestId("overview")).getByText(
        `${measured.length} of ${features.length} active records measured · ${slots} open slot`,
      ),
    ).toBeInTheDocument();
  });

  it("says so twice where nothing is left, and draws no matrix and no template", async () => {
    const model = corpus({ "docs/facets/features/m/full/r.yaml": record("m/full/r") });
    expect(featureViews(model, derive(model))).toHaveLength(1);
    await asRole(/Record author/, model);
    expect(
      screen.getByText("Every active record has its knowledge filled in."),
    ).toBeInTheDocument();
    expect(screen.getByText("All slots filled")).toBeInTheDocument();
    expect(screen.queryByTestId("author-knowledge")).toBeNull();
    expect(screen.queryByTestId("overview-author-template")).toBeNull();
  });

  it("names every record with empty fields by its id and how many of its fields are missing", async () => {
    const model = corpus({
      "docs/facets/features/m/a/r.yaml": record("m/a/r", { scenario: false, team: null }),
      "docs/facets/features/m/b/r.yaml": record("m/b/r", { team: null }),
      "docs/facets/features/m/c/r.yaml": record("m/c/r"),
    });
    await asRole(/Record author/, model);
    const rows = within(screen.getByTestId("author-knowledge")).getAllByRole("row").slice(1);
    expect(
      rows.map((r) => {
        const cells = within(r).getAllByRole("cell");
        return [cells[0].textContent, cells.at(-1)!.textContent];
      }),
    ).toEqual([
      ["m/a/r", "2"],
      ["m/b/r", "1"],
      ["m/c/r", "0"],
    ]);
  });
});
