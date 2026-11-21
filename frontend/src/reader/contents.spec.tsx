import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentStream, AtlasModel } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import { uiT } from "./testing";
import Atlas from "./Atlas";
import { PINNED_KEY } from "./pinned";

const en = uiT("en");

const RECORD = "tasks/create/quick-add";
const FIX_SHA = "32061fd166034ff1bf10125ed354d269c7cd8daf";
const LONG_ANSWER =
  "Nothing else is needed. Creating a task takes one line; the project and due date can be set later.";

/** The taskflow model with one open slot (`not_for` of RECORD), one answer
 * longer than the matrix shows, and one fix commit that names its file. */

function model(): AtlasModel {
  const m = taskflowModel();
  const rec = m.recs.find((r) => r.id === RECORD)!;
  const doc = rec.doc as { knowledge: Record<string, Record<string, unknown>> };
  doc.knowledge.not_for = { ...doc.knowledge.not_for, answer: "" };
  doc.knowledge.prerequisite_knowledge = {
    ...doc.knowledge.prerequisite_knowledge,
    answer: LONG_ANSWER,
  };
  rec.knowledge = rec.knowledge.map((k) =>
    k.key === "not_for"
      ? { ...k, answer: undefined }
      : k.key === "prerequisite_knowledge"
        ? { ...k, answer: LONG_ANSWER }
        : k,
  );
  rec.defects = {
    ...rec.defects,
    fixes: [
      {
        commit: FIX_SHA,
        date: "2026-08-03",
        files: ["src/tasks/quick-add.ts"],
        subject: "fix(tasks): quick add keeps the due date",
        issue: "#50",
        recordedBy: "git-history",
      },
    ],
  };
  const other = m.recs.find((r) => r.id === "sync/queue/offline-queue")!;
  other.defects = {
    ...other.defects,
    fixes: [
      {
        commit: "b2da4e67bf3200000000",
        date: "2026-08-01",
        files: [],
        subject: "fix(sync): the queue survives a restart",
        issue: "",
        recordedBy: "",
      },
    ],
  };
  return m;
}

function fakeStream() {
  const urls: string[] = [];
  const open = (url: string): AgentStream => {
    urls.push(url);
    return { addEventListener: () => undefined, close: () => undefined };
  };
  return { open, urls };
}

/** The question the agent was sent, decoded from the stream's address. */
const askedIn = (url: string) => new URL(url, "http://atlas").searchParams.get("q");

function mount(path: string, props: Partial<Parameters<typeof Atlas>[0]> = {}) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model()} readers={null} {...props} />);
}

const navNames = () =>
  within(screen.getByRole("navigation", { name: "Areas" }))
    .getAllByRole("button")
    .map((b) => b.textContent);

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("contents", () => {
  it("opens a matrix answer as a card with the whole answer and the slot's question", async () => {
    mount("/contents/knowledge");
    const cell = screen.getByRole("button", {
      name: `quick-add: ${en("ui.screens-records.model-prerequisite")}, show the answer`,
    });
    // Precondition: the cell itself shows less than the whole answer.
    expect(cell).not.toHaveTextContent(LONG_ANSWER);
    await userEvent.click(cell);
    const card = screen.getByRole("dialog");
    expect(card).toHaveTextContent(LONG_ANSWER);
    expect(card).toHaveTextContent(en("ui.screens-records.model-what-do-you-need-know-have"));
    expect(card).toHaveTextContent(RECORD);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cell).toHaveFocus();
    await userEvent.click(cell);
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("grows the card in with motion that reduced motion turns off", async () => {
    // jsdom runs no animation: the rendered card is tied to the rules of the
    // stylesheet the reader ships (the contents pages' own stylesheet).
    const css = readFileSync(join(__dirname, "..", "screens", "styles", "contents.css"), "utf8");
    mount("/contents/knowledge");
    await userEvent.click(
      screen.getByRole("button", {
        name: `quick-add: ${en("ui.screens-records.model-prerequisite")}, show the answer`,
      }),
    );
    expect(screen.getByRole("dialog")).toHaveClass("t-c-dcard");
    expect(/\n\.t-c-dcard \{([^}]*)\}/.exec(css)?.[1]).toMatch(/animation: t-c-dcard-in /);
    const reduced = [
      ...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g),
    ].find((m) => m[1].includes(".t-c-dcard"));
    expect(reduced?.[1]).toMatch(/\.t-c-dcard,\s*\.t-c-dcard-scrim \{\s*animation: none;/);
  });

  it("answers an open knowledge slot by asking Atlas AI with the question and the record", async () => {
    const s = fakeStream();
    mount("/contents/knowledge", { openStream: s.open });
    await userEvent.click(screen.getByRole("radio", { name: /Open questions/ }));
    await userEvent.click(screen.getByRole("tab", { name: /Not for/ }));
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(s.urls).toHaveLength(1);
    expect(askedIn(s.urls[0])).toBe(
      `Propose an answer to “${en("ui.screens-records.model-when-wrong-tool")}” (${en("ui.screens-records.model-not")}) for the record ${RECORD}.`,
    );
    expect(window.location.pathname).toBe("/contents/knowledge");
  });

  it("proposes an answer from the record page through Atlas AI as well", async () => {
    const s = fakeStream();
    mount(`/record/${RECORD}`, { openStream: s.open });
    await userEvent.click(
      within(screen.getByTestId("slot-not_for")).getByRole("button", {
        name: "Propose an answer",
      }),
    );
    expect(askedIn(s.urls[0])).toContain(`for the record ${RECORD}.`);
    expect(askedIn(s.urls[0])).toContain(en("ui.screens-records.model-when-wrong-tool"));
  });

  it("states under the calibration finding what a band and a median are", () => {
    mount("/contents/calibration");
    const page = screen.getByTestId("calibration-page");
    const finding = within(page).getByRole("heading", { level: 1 });
    expect(finding).toHaveTextContent(/medians? lie? within the band/);
    expect(finding.nextElementSibling).toHaveTextContent(
      en("ui.screens-contents.structure-band-typical-range-facet-gives-measure"),
    );
    expect(en("ui.screens-contents.structure-band-typical-range-facet-gives-measure")).toBe(
      "A band is the typical range FACET gives for a measure; the median is the middle value this registry has for it.",
    );
  });

  it("pins kinds into the menu after the glossary, in pin order, and keeps them on reload", async () => {
    const first = mount("/contents");
    await userEvent.click(screen.getByTestId("pin-fixed"));
    await userEvent.click(screen.getByTestId("pin-knowledge"));
    const fixed = en("ui.reader.chat-fixed");
    const knowledge = en("ui.reader.chat-knowledge");
    const glossary = navNames().indexOf("Glossary");
    expect(navNames().slice(glossary, glossary + 3)).toEqual(["Glossary", fixed, knowledge]);
    expect(JSON.parse(window.localStorage.getItem(PINNED_KEY)!)).toEqual(["fixed", "knowledge"]);
    first.unmount();

    mount("/contents");
    expect(screen.getByTestId("pin-knowledge")).toHaveAttribute("aria-pressed", "true");
    const nav = within(screen.getByRole("navigation", { name: "Areas" }));
    await userEvent.click(nav.getByRole("button", { name: knowledge }));
    expect(window.location.pathname).toBe("/contents/knowledge");
    expect(nav.getByRole("button", { name: knowledge })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("button", { name: "Contents" })).not.toHaveAttribute("aria-current");

    await userEvent.click(nav.getByRole("button", { name: "Contents" }));
    await userEvent.click(screen.getByTestId("pin-fixed"));
    expect(navNames()).not.toContain(fixed);
    expect(JSON.parse(window.localStorage.getItem(PINNED_KEY)!)).toEqual(["knowledge"]);
  });

  it("lists a fix by its short hash and opens its details with the files the host reported", async () => {
    const copied = jest.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t: string) => Promise.resolve(copied(t)) },
      configurable: true,
    });
    mount("/contents/fixed");
    const row = screen.getByTestId(`fix-${FIX_SHA}`);
    expect(within(row).getByText("32061fd")).toHaveAttribute("title", FIX_SHA);
    await userEvent.click(within(row).getByRole("button", { name: "Copy full hash" }));
    await act(async () => undefined);
    expect(copied).toHaveBeenCalledWith(FIX_SHA);
    await userEvent.click(
      within(row).getByRole("button", { name: /quick add keeps the due date/ }),
    );
    const card = screen.getByRole("dialog");
    expect(card).toHaveTextContent("src/tasks/quick-add.ts");
    expect(card).toHaveTextContent(FIX_SHA);
    expect(card).toHaveTextContent("git-history");
    await userEvent.click(within(card).getByRole("button", { name: RECORD }));
    expect(window.location.pathname).toBe(`/record/${RECORD}`);

    // A fix whose files, ticket and recorder the host did not report says so.
    await act(async () => {
      window.history.replaceState(null, "", "/contents/fixed");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    const bare = screen.getByTestId("fix-b2da4e67bf3200000000");
    await userEvent.click(
      within(bare).getByRole("button", { name: /the queue survives a restart/ }),
    );
    const facts = screen.getByRole("dialog");
    for (const label of ["Files", "Ticket", "Recorded by"])
      expect(within(facts).getByText(label).nextElementSibling).toHaveTextContent("— not measured");
  });
});

describe("contents on a phone", () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it("lists pinned kinds in the More sheet after the glossary, in pin order", async () => {
    window.localStorage.setItem(PINNED_KEY, JSON.stringify(["fixed", "knowledge"]));
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
    mount("/");
    await userEvent.click(screen.getByRole("button", { name: en("shell.tab.more") }));
    const sheet = screen.getByRole("dialog", { name: en("shell.more.title") });
    const names = within(sheet)
      .getAllByRole("button")
      .map((b) => b.textContent);
    const glossary = names.indexOf("Glossary");
    expect(glossary).toBeGreaterThan(-1);
    expect(names.slice(glossary, glossary + 3)).toEqual([
      "Glossary",
      en("ui.reader.chat-fixed"),
      en("ui.reader.chat-knowledge"),
    ]);
    await userEvent.click(
      within(sheet).getByRole("button", { name: en("ui.reader.chat-knowledge") }),
    );
    expect(window.location.pathname).toBe("/contents/knowledge");
  });
});

describe("author overview", () => {
  async function asAuthor() {
    mount("/");
    await userEvent.click(screen.getByRole("button", { name: en("shell.role.dev.name") }));
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: new RegExp(en("shell.role.author.name")) }),
    );
    return screen.getByRole("table", {
      name: en("ui.screens-frame.overviewpage-record-fields-filled-missing"),
    });
  }

  it("heads every field column, the knowledge slots by their whole name", async () => {
    const table = await asAuthor();
    expect(within(table).getByRole("cell", { name: RECORD })).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual([
      "Record",
      en("ui.screens-frame.overviewpage-intent"),
      en("ui.screens-frame.overviewpage-scenarios"),
      en("ui.screens-frame.overviewpage-owner"),
      en("ui.screens-frame.overviewpage-prerequisite"),
      en("ui.screens-frame.overviewpage-not"),
      en("ui.screens-frame.overviewpage-where-find"),
      en("ui.screens-frame.overviewpage-pitfalls"),
      en("ui.screens-frame.overviewpage-how-you-notice"),
      en("ui.screens-frame.overviewpage-missing"),
    ]);
  });

  it("moves next steps below the table until the table fits beside them", async () => {
    // jsdom lays nothing out: the grid's width and the table's natural width
    // are given here, and the page decides from them as a browser does.
    let gridWidth = 1300;
    const rect = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const w = this.style.width === "max-content" ? 1000 : 0;
        return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0 } as DOMRect;
      });
    const client = jest
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(() => gridWidth);
    const observers: (() => void)[] = [];
    const saved = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    try {
      const table = await asAuthor();
      const grid = table.closest("[data-testid=overview] > div + div")!;
      const steps = screen.getByRole("complementary", { name: "Next steps" });
      expect(grid.contains(steps)).toBe(true);
      expect(grid).toHaveAttribute("data-stack", "true");
      gridWidth = 1500;
      act(() => observers.forEach((cb) => cb()));
      expect(grid).not.toHaveAttribute("data-stack");
    } finally {
      globalThis.ResizeObserver = saved;
      rect.mockRestore();
      client.mockRestore();
    }
  });
});
