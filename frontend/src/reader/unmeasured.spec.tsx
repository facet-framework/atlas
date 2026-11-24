/** What the reader does not carry reaches the Atlas pages as "not measured",
 * never as a 0, an empty list or a default that looks chosen. Every case
 * renders the app and reads the "—" or the "not read" wording the page
 * draws for it. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FACETRC, INDEX, RECORDS, SCAN, taskflowModel } from "@/model/fixtures";
import { loadCorpus } from "@/model";
import Atlas from "./Atlas";
import { uiT } from "./testing";

const model = taskflowModel();
const tt = uiT("en");

function mount(path: string, props: Partial<Parameters<typeof Atlas>[0]> = {}) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} {...props} />);
}

/** The same project, but the scan reported neither totals nor file lists. */
function unscanned() {
  return {
    ...model,
    // The host reports its line total as `totalLoc`; an unscanned run carries none.
    scan: {
      ...model.scan,
      files: undefined,
      loc: undefined,
      totalLoc: undefined,
      unanchoredFiles: undefined,
    },
  } as typeof model;
}

function withoutKnowledge() {
  const records = Object.fromEntries(
    Object.entries(RECORDS).map(([path, raw]) => [
      path,
      raw.replace(/^knowledge:\n[\s\S]*?(?=^lineage:|^defects:)/m, ""),
    ]),
  );
  return loadCorpus({ facetrc: FACETRC, index: INDEX, records, scan: SCAN });
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe("figures the reader does not carry", () => {
  it("shows undeclared Knowledge as unmeasured on the author, Records and Contents surfaces", async () => {
    const noKnowledge = withoutKnowledge();
    expect(noKnowledge.features.every((record) => !record.present.knowledge)).toBe(true);
    mount("/", { model: noKnowledge });
    await userEvent.click(screen.getByRole("button", { name: "Developer" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Record author/ }));
    expect(screen.getByText("Knowledge not measured.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Records/ }));
    expect(screen.getByText("Knowledge open").parentElement).toHaveTextContent("—");
    await userEvent.click(screen.getByRole("button", { name: /Contents/ }));
    expect(screen.getByText("Knowledge").closest("button")).toHaveTextContent("not measured");
  });

  it("keeps the fixture honest: the scan lists its files, and the stripped copy lists none", () => {
    expect(model.scan.unanchoredFiles?.length).toBeGreaterThan(0);
    expect(unscanned().scan.files).toBeUndefined();
    expect(unscanned().scan.unanchoredFiles).toBeUndefined();
    expect(unscanned().scan.loc).toBeUndefined();
  });

  it("shows unscanned lines of code on the Overview as — and the commit history as not read", () => {
    mount("/", { model: unscanned() });
    expect(screen.getByTestId("overview-loc")).toHaveTextContent("—");
    expect(screen.getByTestId("overview-loc")).toHaveAttribute(
      "title",
      tt("ui.screens-frame.overviewpage-not-measured"),
    );
    expect(screen.getAllByTestId("commits-unmeasured")[0]).toHaveTextContent(
      `— · ${tt("ui.screens-frame.overviewpage-not-measured")}`,
    );
    expect(screen.queryByTestId("commits-none")).not.toBeInTheDocument();
    // The file-total KPI: its label carries "—" as the total, and its value is
    // the "—" mark titled with the not-measured wording.
    const kpiLabel = screen.getByText(
      new RegExp(
        `^${escapeRegExp(tt("ui.screens-frame.overviewpage-files-anchored-anchored-files", { anchored: "#", files: "—" })).replace("#", "\\d+")}$`,
      ),
    );
    const kpiValue = within(kpiLabel.parentElement!).getByTestId("metric-value");
    expect(
      within(kpiValue).getByText(tt("ui.screens-frame.overviewpage-not-measured")),
    ).toBeInTheDocument();
    expect(within(kpiValue).getByText("—")).toBeInTheDocument();
  });

  it("keeps a measured line count on the Overview", () => {
    mount("/", { model: { ...model, scan: { ...model.scan, loc: 0 } } as typeof model });
    expect(screen.getByTestId("overview-loc")).toHaveTextContent(
      new RegExp(
        `^${escapeRegExp(tt("ui.screens-frame.overviewpage-count-lines", { count: 0 }))}$`,
      ),
    );
    expect(screen.getByTestId("overview-loc")).not.toHaveAttribute("title");
  });

  it("says a domain's commit history was not read", () => {
    mount("/domain/tasks");
    expect(screen.getByTestId("commits-unmeasured")).toHaveTextContent(
      tt("ui.screens-frame.overviewpage-not-measured"),
    );
  });

  it("says a record's commit history was not read instead of counting zero commits", () => {
    mount("/record/tasks/create/quick-add");
    expect(screen.getByTestId("record-history-unmeasured")).toHaveTextContent(
      `— · ${tt("ui.screens-records.recorddetailspage-history-not-read-not-measured")}`,
    );
  });

  it("shows unreported scan figures on the files page as —", () => {
    mount("/contents/files", { model: unscanned() });
    const total = screen.getByTestId("files-total-unmeasured");
    expect(total).toHaveTextContent(/^—$/);
    expect(total).toHaveAttribute("title", tt("ui.screens-contents.code-not-measured"));
    expect(
      screen.getByText(
        tt("ui.screens-contents.code-count-files-without-anchor-loc-lines", {
          count: "—",
          loc: "—",
        }),
      ),
    ).toBeInTheDocument();
  });

  it("marks every rule as not checked instead of kept", () => {
    expect(model.policies.length).toBeGreaterThan(0);
    mount("/contents/rules");
    const marks = screen.getAllByTestId("rule-violations-unmeasured");
    expect(marks).toHaveLength(model.policies.length);
    expect(marks[0]).toHaveTextContent("—");
  });

  it("shows a deviation's date as — because the record carries none", () => {
    const [first, ...rest] = model.allScn;
    const deviated = {
      ...model,
      allScn: [
        { ...first, deviation: { reason: "Agreed with product", confirmedBy: "lead" } },
        ...rest,
      ],
    } as typeof model;
    mount("/contents/deviations", { model: deviated });
    expect(screen.getAllByTestId("deviation-since-unmeasured")[0]).toHaveTextContent("—");
  });
});

describe("plugin pages", () => {
  it("names a decision's authors as unknown, not as nobody", async () => {
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      let reply: unknown = {};
      if (url === "/api/plugin/session") reply = { capabilities: { adr: "cap-adr" } };
      else if (body.tool === "repo.list")
        reply = {
          result: {
            dir: "docs/adr",
            files: [{ path: "docs/adr/0001-x.md", number: "0001", slug: "x" }],
          },
        };
      else if (body.tool === "repo.read")
        reply = { result: { body: "# 0001 X\n\n- Status: accepted\n- Date: 2026-01-01\n" } };
      // jsdom has no Response; this is the part of one the callers read.
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(reply),
      } as Response);
    }) as typeof fetch;
    mount("/p/adr");
    const unknown = await screen.findAllByTestId("adr-authors-unknown");
    expect(unknown[0]).toHaveTextContent("—");
    expect(screen.queryByTestId("adr-authors-none")).not.toBeInTheDocument();
  });

  it("leaves a session's unknown time and continuation out of its line", async () => {
    window.localStorage.setItem(
      "facet.atlas.state",
      JSON.stringify({
        conversations: [{ id: 1, name: "Alpha", turns: [], busy: false, agent: null }],
      }),
    );
    mount("/ask");
    const nav = await screen.findByRole("navigation", {
      name: tt("ui.screens-plugins.chat-sessions"),
    });
    // Before, the line read "0 rounds · open": a continuation nobody had asked the host about.
    const line = within(nav).getByRole("button", { name: /^Alpha/ });
    expect(line).toHaveTextContent(/^Alpha0 rounds$/);
  });
});
