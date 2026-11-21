import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadCorpus } from "@/model";
import { FACETRC, INDEX, RECORDS, SCAN } from "@/model/fixtures";
import Atlas from "./Atlas";

const DIR = "docs/adr";

/** The decision directory the host answers from: file name to Markdown body. */
const DECISIONS: Record<string, string> = Object.fromEntries(
  [
    ["0001-offline-first-storage.md", "0001", "Tasks are stored on the device first", "2026-01-12"],
    ["0002-sync-conflicts.md", "0002", "The newest edit wins a sync conflict", "2026-02-03"],
    ["0005-task-sync-process.md", "0005", "Task sync is drawn as a process", "2026-03-20"],
    ["0007-notification-channels.md", "0007", "One notification, one channel", "2026-04-08"],
    [
      "0007-public-api-tokens.md",
      "0007",
      "Public API tokens belong to one workspace",
      "2026-04-09",
    ],
    [
      "0009-quiet-hours-on-the-server.md",
      "0009",
      "Quiet hours are enforced on the server",
      "2026-05-15",
    ],
  ].map(([name, number, title, date]) => [
    name,
    `# ADR ${number} — ${title}\n\n**Status:** accepted\n**Date:** ${date}\n\n## 1. Decision\n\n${title}.\n`,
  ]),
);
const NAMES = Object.keys(DECISIONS).sort();
const FILES = NAMES.map((name) => {
  const [, number = "", slug = name] = /^(\d+)-(.+)\.md$/.exec(name) ?? [];
  return { path: name, number, slug };
});

/** A decision's title as its file's first heading writes it, without the "ADR n —" part. */
function titleOf(name: string): string {
  const head = /^#\s+(.+)$/m.exec(DECISIONS[name])?.[1] ?? "";
  return head.replace(/^ADR\s+\d+\s+—\s+/, "");
}

/** TaskFlow, its records citing the example decisions in each form a record may
 * use: a repository path, a file name and a name with a number. */

const CITED: Record<string, string> = {
  "ADR-004": "docs/adr/0007-notification-channels.md",
  "ADR-007": "docs/adr/0007-public-api-tokens.md",
  "ADR-011": "0001-offline-first-storage.md",
  "ADR-012": "ADR-0002",
  "ADR-016": "docs/adr/0009-quiet-hours-on-the-server.md",
  // A note a record cites as a decision, outside the decision directory.
  "ADR-019": "docs/notes/pitch.md",
  "ADR-023": "docs/adr/0005-task-sync-process.md",
};

function citingModel() {
  const records = Object.fromEntries(
    Object.entries(RECORDS).map(([p, text]) => [
      p,
      text.replace(/^( +- )(ADR-\d+)$/gm, (line, lead: string, name: string) =>
        CITED[name] ? `${lead}${CITED[name]}` : line,
      ),
    ]),
  );
  const model = loadCorpus({ facetrc: FACETRC, index: INDEX, records, scan: SCAN });
  // Precondition: every replacement reached the model.
  expect(model.decisionTargets.map((t) => t.target).sort()).toEqual(Object.values(CITED).sort());
  return model;
}

const realFetch = global.fetch;

function reply(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/plugin/session") return reply({ capabilities: { adr: "cap-adr" } });
    if (url !== "/api/plugin/call") return reply({});
    const { tool, args } = JSON.parse(String(init?.body)) as {
      tool: string;
      args: { path?: string };
    };
    if (tool === "repo.list") return reply({ result: { dir: DIR, files: FILES } });
    return reply({ result: { body: DECISIONS[String(args.path)] } });
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={citingModel()} readers={null} />);
}

const MISSING = /This place does not exist here/;

async function opened(name: string) {
  const heading = await screen.findByRole("heading", { level: 1, name: new RegExp(titleOf(name)) });
  expect(heading).toBeInTheDocument();
  expect(screen.queryByText(MISSING)).not.toBeInTheDocument();
  expect(window.location.pathname).toBe(`/p/adr/${DIR}/${name}`);
}

describe("decision links", () => {
  it("the fixture holds six decisions, two of them numbered 0007", () => {
    expect(NAMES).toHaveLength(6);
    expect(FILES.filter((f) => f.number === "0007")).toHaveLength(2);
  });

  it("opens every decision the Leadership overview names, whichever form the record cites it in", async () => {
    // One reader: each round goes back to the overview with the shell's back button.
    window.localStorage.clear();
    mount("/");
    await userEvent.click(screen.getByRole("button", { name: "Developer" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Leadership/ }));
    const links = () =>
      within(screen.getByText("Related decisions").parentElement as HTMLElement).getAllByRole(
        "button",
      );
    const names = links().map((l) => l.textContent ?? "");
    // Parsed headers replace the several citation forms with one title/status/date shape.
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names.every((n) => n.includes("accepted") && /2026-\d{2}-\d{2}/.test(n))).toBe(true);
    expect(names.some((n) => n.includes(".md"))).toBe(false);
    for (let i = 0; i < names.length; i++) {
      const title = names[i].split("accepted")[0].trim();
      await userEvent.click(links()[i]);
      const file = NAMES.find((name) => titleOf(name) === title)!;
      await opened(file);
      await userEvent.click(screen.getByRole("button", { name: "Back" }));
      await screen.findByText("Related decisions");
    }
  });

  it.each([
    ["the file name", "0002-sync-conflicts.md"],
    ["the repository path", "docs/adr/0002-sync-conflicts.md"],
    ["a name with the number", "ADR-0002"],
    ["the number", "2"],
    ["the slug", "sync-conflicts"],
  ])("opens a decision by %s and shows its one address", async (_form, address) => {
    const entries = window.history.length;
    mount(`/p/adr/${address}`);
    await opened("0002-sync-conflicts.md");
    // The address is rewritten in place: no second entry to go back through.
    expect(window.history.length).toBe(entries);
    expect(
      screen.getByRole("button", { name: /sync\/conflict\/last-write-wins/ }),
    ).toBeInTheDocument();
  });

  it("opens neither of two decisions that share the number, and lists both to choose from", async () => {
    mount("/p/adr/ADR-0007");
    const choice = await screen.findByTestId("adr-ambiguous");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    const options = within(choice).getAllByRole("button");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining(`${DIR}/0007-notification-channels.md`),
      expect.stringContaining(`${DIR}/0007-public-api-tokens.md`),
    ]);
    await userEvent.click(options[1]);
    await opened("0007-public-api-tokens.md");
  });

  it("opens the second of two decisions that share a number from the list by its file", async () => {
    mount("/p/adr");
    const items = await screen.findAllByTestId("adr-time-item");
    // Precondition: both decisions numbered 0007 are on the timeline, one item each.
    const sevens = items.filter((item) => /\b0007\b/.test(item.textContent ?? ""));
    expect(sevens).toHaveLength(2);
    const second = sevens.find((item) =>
      item.textContent?.includes(titleOf("0007-public-api-tokens.md")),
    )!;
    await userEvent.click(within(second).getByRole("button"));
    await opened("0007-public-api-tokens.md");
  });

  it("does not open a decision from a path outside the decision directory", async () => {
    mount("/p/adr/docs/notes/pitch.md");
    const outside = await screen.findByTestId("adr-outside");
    expect(outside).toHaveTextContent(
      "“docs/notes/pitch.md” is not in the decision directory docs/adr",
    );
    expect(screen.queryByText(MISSING)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/p/adr/docs/notes/pitch.md");
    // The record that cites it is one press away.
    await userEvent.click(
      within(outside).getByRole("button", { name: /tasks\/create\/quick-add/ }),
    );
    expect(window.location.pathname).toBe("/record/tasks/create/quick-add");
  });

  it("shows the missing place for a file the decision directory does not hold", async () => {
    mount("/p/adr/docs/adr/9999-none.md");
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    await act(async () => {});
    expect(window.location.pathname).toBe("/p/adr/docs/adr/9999-none.md");
  });
});
