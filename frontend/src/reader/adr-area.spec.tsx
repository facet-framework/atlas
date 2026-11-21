/** The decisions area as the reader mounts it: the plugin's entry, loaded by
 * the host, answered through `/api/plugin/call` with the host's shapes. The
 * directory is a configured one, not the default, so a surface that printed
 * `docs/adr` regardless would show. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";

const DIR = "architecture/decisions";

const FIRST_ITEM = [
  "# ADR 1 — One",
  "",
  "**Status:** accepted",
  "**Date:** 2026-01-01",
  "",
  "---",
  "",
  "## Title",
  "",
  "A sentence.",
  "",
  "- first item",
  "- second item",
  "",
  "| Place | What |",
  "|---|---|",
  "| The CLI | reads |",
  "",
  "```go",
  "// @facet: a/b/c",
  "```",
  "",
  "See [Text](javascript:alert) and [Source](https://example.org/q).",
  "",
  "Also [Empty]( javascript:alert(1)), [Data](data:text/html,x ), [Loud](JavaScript:alert),",
  "[VB](vbscript:msgbox), [Angle](<javascript:alert>) and [Break](",
  "javascript:void).",
  "",
].join("\n");

const head = (n: number, title: string, status: string | null, date: string) =>
  [
    `# ADR ${n} — ${title}`,
    "",
    ...(status ? [`**Status:** ${status}`] : []),
    `**Date:** ${date}`,
    "",
    "---",
    "",
    "Text.",
  ].join("\n");

const BODIES: Record<string, string | { error: string }> = {
  "0001-one.md": FIRST_ITEM,
  "0002-two.md": head(2, "Two", "proposed", "2026-01-02"),
  "0003-three.md": head(3, "Three", "accepted", "2026-01-03"),
  "0004-open.md": head(4, "Open", null, "2026-01-04"),
  "0005-blocked.md": { error: "repo.read: 0005-blocked.md is not inside the granted reads" },
};

const FILES = Object.keys(BODIES).map((path) => {
  const [, number, slug] = /^(\d+)-(.+)\.md$/.exec(path)!;
  return { path, number, slug };
});

const realFetch = global.fetch;
/** What `repo.list` answers; one test empties it. */
let listed = FILES;

function reply(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  listed = FILES;
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
    if (tool === "repo.list") return reply({ result: { dir: DIR, files: listed } });
    const body = BODIES[String(args.path)];
    return reply(typeof body === "string" ? { result: { body } } : body);
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={taskflowModel()} readers={null} />);
}

const where = () => window.location.pathname;

/** The timeline's rows, once the decisions are read. */
async function rows() {
  return screen.findAllByTestId("adr-time-item");
}

function rowTitles(): string[] {
  return screen
    .queryAllByTestId("adr-time-item")
    .map((r) => within(r).getByRole("button").textContent ?? "");
}

function chip(name: string) {
  return screen.getByRole("button", { name: new RegExp(`^${name}\\s*\\d*$`) });
}

describe("the decisions front page", () => {
  it("shows one row per listed file, the unreadable one included", async () => {
    mount("/p/adr");
    expect(await rows()).toHaveLength(FILES.length);
    expect(rowTitles().some((t) => t.includes("0005"))).toBe(true);
  });

  it("counts each known status and keeps the entry without a status line apart from them", async () => {
    mount("/p/adr");
    await rows();
    expect(chip("accepted")).toHaveTextContent("2");
    expect(chip("proposed")).toHaveTextContent("1");
    expect(chip("superseded")).toHaveTextContent("0");
    // The entry without a status line is counted under none of the four; its row says unknown.
    const open = screen
      .getAllByTestId("adr-time-item")
      .find((r) => r.textContent?.includes("Open"))!;
    expect(open).toHaveAttribute("data-status", "unknown");
    expect(within(open).getByText("unknown")).toBeInTheDocument();
  });

  it("names the configured directory, not the default", async () => {
    mount("/p/adr");
    await rows();
    expect(screen.getAllByText(DIR).length).toBeGreaterThan(0);
    expect(screen.queryByText("docs/adr")).not.toBeInTheDocument();
  });

  it("names the configured directory in the empty state of a directory without decisions", async () => {
    listed = [];
    mount("/p/adr");
    await screen.findByText("No decision yet");
    // The empty state's own sentence, not the page head beside it.
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "P" &&
          el.textContent === `There is no Markdown file with an ADR header in ${DIR}.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("adr-time-item")).toHaveLength(0);
  });

  it("opens a row at its file's repository path, not at its title or number", async () => {
    mount("/p/adr");
    const secondRow = (await rows()).find((r) => r.textContent?.includes("Two"))!;
    await userEvent.click(within(secondRow).getByRole("button"));
    expect(where()).toBe(`/p/adr/${DIR}/0002-two.md`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "ADR 2 — Two" }),
    ).toBeInTheDocument();
  });

  it("narrows the list to what the search text finds", async () => {
    mount("/p/adr");
    await rows();
    await userEvent.type(screen.getByRole("searchbox"), "two");
    expect(rowTitles()).toEqual([expect.stringContaining("Two")]);
  });

  it("narrows the list to the status chip chosen and marks the chip", async () => {
    mount("/p/adr");
    await rows();
    await userEvent.click(chip("proposed"));
    expect(chip("proposed")).toHaveAttribute("aria-pressed", "true");
    expect(rowTitles()).toEqual([expect.stringContaining("Two")]);
  });

  it("names an empty selection and draws no row", async () => {
    mount("/p/adr");
    await rows();
    await userEvent.type(screen.getByRole("searchbox"), "nothing dergleichen");
    expect(screen.queryAllByTestId("adr-time-item")).toHaveLength(0);
    expect(screen.getByText(/nothing dergleichen/)).toBeInTheDocument();
  });

  it("brings every entry back when the filters are reset", async () => {
    mount("/p/adr");
    await rows();
    await userEvent.type(screen.getByRole("searchbox"), "two");
    await userEvent.click(chip("proposed"));
    expect(rowTitles()).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(chip("proposed")).toHaveAttribute("aria-pressed", "false");
    expect(rowTitles()).toHaveLength(FILES.length);
  });
});

describe("one decision", () => {
  it("opens the entry for the addresses 1, 0001, one and 0001-one alike", async () => {
    for (const address of ["1", "0001", "one", "0001-one"]) {
      const { unmount } = mount(`/p/adr/${address}`);
      expect(
        await screen.findByRole("heading", { level: 1, name: "ADR 1 — One" }),
      ).toBeInTheDocument();
      // Every name of the decision settles on its one address.
      expect(where()).toBe(`/p/adr/${DIR}/0001-one.md`);
      unmount();
    }
  });

  it("names an address that matches no decision as missing and opens none", async () => {
    mount("/p/adr/none-solche");
    expect(await screen.findByText(/This place does not exist here/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: /One|Two|Three/ })).toBeNull();
  });

  it("draws headings, paragraphs, lists, a table and fenced code from the text", async () => {
    mount(`/p/adr/${DIR}/0001-one.md`);
    const article = await screen.findByRole("article", { name: "ADR 1 — One" });
    expect(within(article).getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(within(article).getByText("A sentence.").tagName).toBe("P");
    const items = within(article)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual(expect.arrayContaining(["first item", "second item"]));
    const table = within(article).getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Place" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "What" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "The CLI" })).toBeInTheDocument();
    const code = within(article).getByText("// @facet: a/b/c");
    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("keeps a link with an unsafe scheme as text and its target as code, not as a link", async () => {
    mount(`/p/adr/${DIR}/0001-one.md`);
    const article = await screen.findByRole("article", { name: "ADR 1 — One" });
    // Precondition: a safe link in the same paragraph stays a link.
    expect(within(article).getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      "https://example.org/q",
    );
    expect(within(article).queryByRole("link", { name: "Text" })).toBeNull();
    expect(article.querySelector('[href^="javascript"]')).toBeNull();
    const target = within(article).getByText("javascript:alert");
    expect(target.tagName).toBe("CODE");
    expect(target.parentElement).toHaveTextContent(/See Text javascript:alert and Source/);
  });

  it("leaves no unsafe href for targets with spaces, upper-case schemes, data:, vbscript: or the angle form", async () => {
    mount(`/p/adr/${DIR}/0001-one.md`);
    const article = await screen.findByRole("article", { name: "ADR 1 — One" });
    // Precondition: the paragraph holding the variants is drawn.
    expect(within(article).getByText(/^Also Empty/)).toBeInTheDocument();
    for (const name of ["Empty", "Data", "Loud", "VB", "Pointed", "Line-break"])
      expect(within(article).queryByRole("link", { name })).toBeNull();
    const hrefs = Array.from(article.querySelectorAll("[href]")).map((a) => a.getAttribute("href"));
    // The table of contents' own anchor and the one safe link are all that remain.
    expect(hrefs).toEqual(["#title", "https://example.org/q"]);
  });

  it("shows the number as text and leads back to the front page through its one back button", async () => {
    mount(`/p/adr/${DIR}/0002-two.md`);
    const article = await screen.findByRole("article", { name: "ADR 2 — Two" });
    const number = within(article).getAllByText("0002")[0];
    expect(number.closest("button")).toBeNull();
    await userEvent.click(within(article).getByRole("button", { name: "Decisions" }));
    expect(where()).toBe("/p/adr");
    expect(await rows()).toHaveLength(FILES.length);
  });

  it("opens a file the host refused onto the host's reason, and the others stay readable", async () => {
    mount("/p/adr");
    const locked = (await rows()).find((r) => r.textContent?.includes("0005"))!;
    await userEvent.click(within(locked).getByRole("button"));
    const page = await screen.findByTestId("adr-unreadable");
    expect(page).toHaveTextContent("0005-blocked.md");
    expect(page).toHaveTextContent("is not inside the granted reads");
    expect(screen.queryByRole("article")).toBeNull();
    await userEvent.click(within(page).getByRole("button", { name: "Decisions" }));
    expect(await rows()).toHaveLength(FILES.length);
  });
});
