/** The chat after the answer: what a finished answer says it read, copying
 * with its outcome, the glow of an answer nobody looked at, conversations
 * that come back from storage, the sizes, and a host whose reply the contract
 * does not cover. The whole reader is mounted; every case reads what lands —
 * the rendered DOM, the address the question is sent to, the clipboard, or
 * the stored state. */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { agentState, type AgentState, type AgentStream } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import { plugins } from "@/screens";
import i18n from "@/i18n";
import Atlas from "./Atlas";
import { COPY_FEEDBACK_MS, readSessions } from "./chat";
import { newConversation, type Conversation } from "@/ask/conversations";
import type { HostReaders } from "./host";
import { atlasT, uiT } from "./testing";

const model = taskflowModel();
const t = atlasT("en");
const tt = uiT("en");
const STATE_KEY = "facet.atlas.state";
/** A file anchored to exactly one record of the fixture: reading it cites that record. */
const ANCHORED = "packages/core/src/notifications/fanout.ts";
const RECORD = "notifications/delivery/channel-fanout";

const MODELS: AgentState["models"] = [
  { id: "", label: "Default" },
  { id: "haiku", label: "Haiku" },
  { id: "opus", label: "Opus" },
];
/** Signed in, with the tool lists that back "nothing written". */
const READ_ONLY_HOST = {
  auth: { loggedIn: true, available: true, email: "a@b.c" },
  models: MODELS,
  model: "",
  blockedTools: ["Write", "Edit", "NotebookEdit", "Bash"],
  allowedTools: ["Read", "Grep", "Glob"],
} as AgentState;
/** Signed in, without tool lists: an older host. */
const LISTLESS_HOST: AgentState = {
  auth: { loggedIn: true, available: true, email: "a@b.c" },
  models: MODELS,
  model: "",
};

function readersFor(agent: () => Promise<AgentState | null>): HostReaders {
  return {
    repo: async () => {
      throw new Error("no repository in this spec");
    },
    agent,
    tools: async () => {
      throw new Error("no tools in this spec");
    },
    installed: async () => [],
  };
}

/** A fake host stream per question: the case sends the events the host would send. */
function host() {
  const streams: {
    url: string;
    on: Map<string, ((e: MessageEvent) => void)[]>;
    closed: boolean;
  }[] = [];
  const open = (url: string): AgentStream => {
    const s = { url, on: new Map<string, ((e: MessageEvent) => void)[]>(), closed: false };
    streams.push(s);
    return {
      addEventListener: (type, fn) => s.on.set(type, [...(s.on.get(type) ?? []), fn]),
      close: () => {
        s.closed = true;
      },
    };
  };
  const emit = (n: number, type: string, data: object) =>
    act(() => {
      for (const fn of streams[n].on.get(type) ?? [])
        fn(new MessageEvent(type, { data: JSON.stringify(data) }));
    });
  const sent = (n = -1) => new URL(streams.at(n)!.url, "http://host").searchParams;
  return { open, streams, emit, sent };
}

async function mount(
  path: string,
  open?: (url: string) => AgentStream,
  agent: () => Promise<AgentState | null> = async () => READ_ONLY_HOST,
) {
  window.history.replaceState(null, "", path);
  const view = render(<Atlas model={model} readers={readersFor(agent)} openStream={open} />);
  await act(async () => undefined);
  return view;
}

const field = () =>
  screen.getByRole("textbox", { name: tt("ui.screens-plugins.chat-question-atlas") });
const openDock = () =>
  userEvent.click(
    screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) })[0],
  );
const stored = (): Conversation[] =>
  (JSON.parse(window.localStorage.getItem(STATE_KEY) || "{}") as { conversations?: Conversation[] })
    .conversations ?? [];
const store = (conversations: Conversation[]) =>
  window.localStorage.setItem(STATE_KEY, JSON.stringify({ conversations }));

/** One answered question: two Reads of one file (one with a range), one of another, and a search. */
async function answerWithReads(h: ReturnType<typeof host>, n = 0) {
  await h.emit(n, "read", { tool: "Read", target: "README.md", lines: "1-20" });
  await h.emit(n, "read", { tool: "Read", target: ANCHORED });
  await h.emit(n, "read", { tool: "Read", target: ANCHORED });
  await h.emit(n, "read", { tool: "Grep", target: "inline edit" });
  await h.emit(n, "text", { text: "It is in **fanout.ts**, line 1-99." });
  await h.emit(n, "done", { session: "s-1" });
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

/** A faithful box ------------------------------------------------------------------ */

const CLIENT = 300;
const TURN = 100;
/** A turn whose answer is still being written is shorter: it has not grown yet. */
const RUNNING = 50;

function faithfulBox() {
  let top = 0;
  const box = () => screen.getByTestId("chat-scroll");
  const isBox = (el: Element) => el.getAttribute("data-testid") === "chat-scroll";
  const room = () =>
    parseFloat(
      box().querySelector<HTMLElement>('[data-testid="chat-room"]')?.style.height ?? "0",
    ) || 0;
  const articles = () => [...box().querySelectorAll("article")];
  const heightOf = (a: Element) => (a.querySelector('[data-state="streaming"]') ? RUNNING : TURN);
  const topOf = (i: number) =>
    articles()
      .slice(0, i)
      .reduce((sum, a) => sum + heightOf(a), 0);
  const scrollHeight = () => Math.max(CLIENT, topOf(articles().length) + room());
  const spies = [
    jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return isBox(this) ? CLIENT : 0;
    }),
    jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return isBox(this) ? scrollHeight() : 0;
    }),
    jest.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
      return isBox(this) ? top : 0;
    }),
    jest.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
      this: Element,
      v: number,
    ) {
      if (isBox(this)) top = Math.max(0, Math.min(v, scrollHeight() - CLIENT));
    }),
    jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const i = this.tagName === "ARTICLE" ? articles().indexOf(this as HTMLElement) : -1;
      const y = i >= 0 ? topOf(i) - top : 0;
      const height = i >= 0 ? heightOf(this) : isBox(this) ? CLIENT : 0;
      return {
        top: y,
        height,
        bottom: y + height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y,
      } as DOMRect;
    }),
  ];
  return {
    get top() {
      return top;
    },
    /** The reader scrolls: the position moves and the browser fires its event. */
    readerScrolls(to: number) {
      top = Math.max(0, Math.min(to, scrollHeight() - CLIENT));
      fireEvent.scroll(box());
    },
    /** Something other than the reader moves the box, without an event. */
    shift(to: number) {
      top = to;
    },
    maxTop: () => scrollHeight() - CLIENT,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

describe("the pin's arithmetic", () => {
  const { pinnedTop, standsAtTheBottom, tailroom } = plugins;

  it("never asks for more than the box can scroll, nor for less than nothing", () => {
    expect(pinnedTop({ scrollHeight: 500, clientHeight: 300 }, 120)).toBe(120);
    expect(pinnedTop({ scrollHeight: 500, clientHeight: 300 }, 900)).toBe(200);
    expect(pinnedTop({ scrollHeight: 500, clientHeight: 300 }, -40)).toBe(0);
  });

  it("gives a short last turn the room it is missing, and none to a turn that fills the box", () => {
    expect(tailroom({ clientHeight: 300 }, 120)).toBe(180);
    expect(tailroom({ clientHeight: 300 }, 420)).toBe(0);
  });

  it("counts 23 px above the bottom as the bottom and 24 px as gone up to read", () => {
    expect(standsAtTheBottom({ scrollHeight: 500, clientHeight: 300, scrollTop: 177 })).toBe(true);
    expect(standsAtTheBottom({ scrollHeight: 500, clientHeight: 300, scrollTop: 176 })).toBe(false);
    expect(standsAtTheBottom({ scrollHeight: 300, clientHeight: 300, scrollTop: 0 })).toBe(true);
  });
});

describe("the conversation box while an answer grows", () => {
  const answered = (q: string) => ({
    q,
    steps: [],
    answer: "Short.",
    cites: [],
    running: false,
    note: "",
    finished: true,
  });
  let geo: ReturnType<typeof faithfulBox>;
  beforeEach(() => {
    store([{ ...newConversation(1), name: "History", turns: [answered("One"), answered("Two")] }]);
    geo = faithfulBox();
  });
  afterEach(() => geo.restore());

  it("pins the new question to the top once the room below it is drawn, and on every step until the reader scrolls", async () => {
    const h = host();
    await mount("/ask", h.open);
    // The restored conversation stands with its last question at the top.
    expect(geo.top).toBe(TURN);
    await userEvent.type(field(), "Three{Enter}");
    // The new turn is shorter than the last: with the room drawn for that one
    // the box stays 50 px short and the pin is clamped at 150. Only a pin
    // that aims after the larger room is drawn reaches the question.
    expect(screen.getByTestId("chat-room")).toHaveStyle({ height: `${CLIENT - RUNNING}px` });
    expect(geo.top).toBe(2 * TURN);
    geo.shift(30);
    await h.emit(0, "read", { tool: "Read", target: "README.md" });
    expect(geo.top).toBe(2 * TURN);
    geo.readerScrolls(50);
    await h.emit(0, "text", { text: "A sentence." });
    await h.emit(0, "done", { session: "s" });
    expect(geo.top).toBe(50);
  });

  it("does not take the pin's own scroll event for the reader", async () => {
    const h = host();
    await mount("/ask", h.open);
    await userEvent.type(field(), "Three{Enter}");
    expect(geo.top).toBe(200);
    // The browser reports the pin's assignment as a scroll at exactly that position.
    fireEvent.scroll(screen.getByTestId("chat-scroll"));
    geo.shift(10);
    await h.emit(0, "read", { tool: "Read", target: "README.md" });
    expect(geo.top).toBe(200);
  });

  it("pins the next question again after the reader had scrolled", async () => {
    const h = host();
    await mount("/ask", h.open);
    await userEvent.type(field(), "Three{Enter}");
    geo.readerScrolls(0);
    await h.emit(0, "done", { session: "s" });
    expect(geo.top).toBe(0);
    await userEvent.type(field(), "Four{Enter}");
    expect(geo.top).toBe(3 * TURN);
  });

  it("follows the bottom once the reader switches it on in the settings, pausing 24 px above it", async () => {
    store([
      {
        ...newConversation(1),
        name: "History",
        turns: ["One", "Two", "Three", "Four"].map(answered),
      },
    ]);
    const h = host();
    await mount("/settings/ai", h.open);
    const follow = within(screen.getByTestId("chat-follow")).getByRole("switch", {
      name: t("ui.reader-pages.settings-scroll-along-while-answering"),
    });
    expect(follow).toHaveAttribute("aria-checked", "false");
    await userEvent.click(follow);
    expect(follow).toHaveAttribute("aria-checked", "true");
    await openDock();
    await userEvent.type(field(), "Five{Enter}");
    expect(screen.getByTestId("chat-room")).toHaveStyle({ height: "0px" });
    expect(geo.top).toBe(4 * TURN + RUNNING - CLIENT);
    geo.readerScrolls(geo.maxTop() - 24);
    await h.emit(0, "read", { tool: "Read", target: "README.md" });
    expect(geo.top).toBe(geo.maxTop() - 24);
    geo.readerScrolls(geo.maxTop() - 23);
    await h.emit(0, "read", { tool: "Read", target: "go.mod" });
    expect(geo.top).toBe(geo.maxTop());
  });
});

describe("what a finished answer read", () => {
  it("counts distinct files, lists each with its range only where read, and says nothing was written when the host's lists back it", async () => {
    const h = host();
    await mount("/", h.open);
    await openDock();
    await userEvent.type(field(), "Where is inline editing?{Enter}");
    await answerWithReads(h);
    const footer = screen.getByTestId("answer-read");
    // A search is not a file, and the same file read twice is one file.
    expect(footer).toHaveTextContent("2 files read · nothing written");
    const read = within(footer).getByRole("list", { name: tt("ui.screens-plugins.chat-read") });
    expect(
      within(read)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["README.md:1-20", ANCHORED]);
    // The range the answer's prose names appears nowhere in the footer.
    expect(footer).not.toHaveTextContent("1-99");
  });

  it("makes no statement about writing when the host sent no tool lists", async () => {
    const h = host();
    await mount("/", h.open, async () => LISTLESS_HOST);
    await openDock();
    await userEvent.type(field(), "Question{Enter}");
    await answerWithReads(h);
    expect(screen.getByTestId("answer-read")).toHaveTextContent("2 files read");
    expect(screen.getByTestId("answer-read")).not.toHaveTextContent("written");
  });

  it.each([
    [
      "a run that only searched",
      async (h: ReturnType<typeof host>) => {
        await h.emit(0, "read", { tool: "Grep", target: "edit" });
        await h.emit(0, "text", { text: "Nothing." });
        await h.emit(0, "done", { session: "s" });
      },
    ],
    [
      "a run that finished without reading",
      async (h: ReturnType<typeof host>) => {
        await h.emit(0, "text", { text: "Without reading." });
        await h.emit(0, "done", { session: "s" });
      },
    ],
    [
      "a signed-out run",
      async (h: ReturnType<typeof host>) => {
        await h.emit(0, "read", { tool: "Read", target: "README.md" });
        await h.emit(0, "signin", { text: "Not signed in.", hint: "claude login" });
      },
    ],
    [
      "a failed run, even after reading",
      async (h: ReturnType<typeof host>) => {
        await h.emit(0, "read", { tool: "Read", target: "README.md" });
        await h.emit(0, "failed", { text: "turn limit" });
      },
    ],
    [
      "a turn aborted by the next question",
      async (h: ReturnType<typeof host>) => {
        await h.emit(0, "read", { tool: "Read", target: "README.md" });
        await userEvent.click(
          screen.getByRole("button", { name: tt("ui.screens-plugins.chat-stop") }),
        );
      },
    ],
  ])("shows no footer for %s", async (_, run) => {
    const h = host();
    await mount("/", h.open);
    await openDock();
    await userEvent.type(field(), "Question{Enter}");
    await run(h);
    expect(screen.queryByTestId("answer-read")).not.toBeInTheDocument();
    expect(screen.queryByText(/Files? read/)).not.toBeInTheDocument();
  });

  it("keeps the footer, its range and its claim through a reload under a host that cannot back it today", async () => {
    const h = host();
    const view = await mount("/ask", h.open);
    await userEvent.type(field(), "Question{Enter}");
    await answerWithReads(h);
    view.unmount();
    await mount("/ask", undefined, async () => LISTLESS_HOST);
    const footer = screen.getByTestId("answer-read");
    expect(footer).toHaveTextContent("nothing written");
    expect(footer).toHaveTextContent("README.md:1-20");
    // The question, the answer and the jump target came back with it.
    expect(screen.getByRole("article", { name: "Question" })).toHaveTextContent("fanout.ts");
    expect(screen.getAllByRole("button", { name: new RegExp(RECORD) }).length).toBeGreaterThan(0);
  });
});

describe("the answer's citations, the model and the sizes", () => {
  it("opens the record a citation names", async () => {
    const h = host();
    await mount("/", h.open);
    await openDock();
    await userEvent.type(field(), "Question{Enter}");
    await answerWithReads(h);
    const sources = screen.getByLabelText(tt("ui.screens-plugins.chat-sources"), {
      selector: "div",
    });
    await userEvent.click(within(sources).getByRole("button", { name: new RegExp(RECORD) }));
    expect(decodeURIComponent(window.location.pathname)).toBe(`/record/${RECORD}`);
  });

  it("sends the model chosen last with the next question", async () => {
    const h = host();
    await mount("/", h.open);
    await openDock();
    const pick = async (name: string) => {
      await userEvent.click(screen.getByRole("button", { name: /^Model / }));
      await userEvent.click(
        within(screen.getByRole("menu", { name: tt("ui.screens-plugins.chat-models") })).getByRole(
          "menuitem",
          {
            name,
          },
        ),
      );
    };
    await pick("Haiku");
    await userEvent.type(field(), "First{Enter}");
    expect(h.sent().get("model")).toBe("haiku");
    await h.emit(0, "done", { session: "s" });
    await pick("Opus");
    await userEvent.type(field(), "Second{Enter}");
    expect(h.streams).toHaveLength(2);
    expect(h.sent().get("model")).toBe("opus");
  });

  it("moves between pill, dock and full view through their buttons", async () => {
    await mount("/");
    await openDock();
    const dock = () =>
      screen.getByRole("complementary", { name: tt("ui.screens-plugins.chat-ask-atlas") });
    expect(dock()).toBeInTheDocument();
    await userEvent.click(
      within(dock()).getByRole("button", { name: tt("ui.screens-plugins.chat-full-screen") }),
    );
    const full = screen.getByRole("region", { name: tt("ui.screens-plugins.chat-ask-atlas") });
    expect(
      within(full).getByRole("navigation", { name: tt("ui.screens-plugins.chat-sessions") }),
    ).toBeVisible();
    await userEvent.click(
      within(full).getByRole("button", { name: tt("ui.screens-plugins.chat-dock") }),
    );
    expect(dock()).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: tt("ui.screens-plugins.chat-sessions") }),
    ).toBeNull();
    await userEvent.click(
      within(dock()).getByRole("button", { name: tt("ui.screens-plugins.chat-close") }),
    );
    expect(
      screen.queryByRole("complementary", { name: tt("ui.screens-plugins.chat-ask-atlas") }),
    ).toBeNull();
    expect(
      screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) }).length,
    ).toBeGreaterThan(0);
  });
});

describe("copying", () => {
  function clipboard(write: (text: string) => Promise<void>) {
    const writeText = jest.fn(write);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  }

  async function answered() {
    const h = host();
    await mount("/", h.open);
    await openDock();
    await userEvent.type(field(), "Where   is  it?{Enter}");
    await answerWithReads(h);
  }

  it("copies the question exactly as typed", async () => {
    const writeText = clipboard(async () => undefined);
    await answered();
    await userEvent.click(
      screen.getByRole("button", { name: tt("ui.screens-plugins.chat-copy-question") }),
    );
    expect(writeText).toHaveBeenCalledWith("Where   is  it?");
  });

  it("copies the answer as Markdown: the question as a quote, the answer, the jump targets as a list", async () => {
    const writeText = clipboard(async () => undefined);
    await answered();
    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(writeText).toHaveBeenCalledWith(
      `> Where   is  it?\n\nIt is in **fanout.ts**, line 1-99.\n\n**Jump targets**\n- ${RECORD}`,
    );
  });

  it("confirms a copy the clipboard took and takes the confirmation back", async () => {
    clipboard(async () => undefined);
    await answered();
    // The confirmation's own timer is taken from the page, so the case can
    // name its interval and run it out without waiting for it.
    const timers = jest.spyOn(window, "setTimeout");
    try {
      await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
      expect(
        screen.getByRole("button", { name: tt("ui.screens-plugins.chat-copied") }),
      ).toHaveAttribute("data-copy", "done");
      const back = timers.mock.calls.filter(([, ms]) => ms === COPY_FEEDBACK_MS);
      expect(back).toHaveLength(1);
      act(() => (back[0][0] as () => void)());
      expect(
        screen.queryByRole("button", { name: tt("ui.screens-plugins.chat-copied") }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Markdown" })).toBeInTheDocument();
    } finally {
      timers.mockRestore();
    }
  });

  it("says so when the clipboard refuses, instead of claiming it copied", async () => {
    clipboard(async () => {
      throw new Error("denied");
    });
    await answered();
    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(
      screen.getByRole("button", { name: tt("ui.screens-plugins.chat-not-copied") }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: tt("ui.screens-plugins.chat-copied") }),
    ).not.toBeInTheDocument();
  });
});

describe("the glow of an answer nobody looked at", () => {
  const sessionButton = (title: string) =>
    within(
      screen.getByRole("navigation", { name: tt("ui.screens-plugins.chat-sessions") }),
    ).getByRole("button", {
      name: new RegExp(`^${title}`),
    });

  it("marks the conversation whose answer finished while another was open, until the reader looks at it", async () => {
    const h = host();
    await mount("/ask", h.open);
    await userEvent.type(field(), "First{Enter}");
    await userEvent.click(
      screen.getByRole("button", { name: tt("ui.screens-plugins.chat-new-conversation") }),
    );
    await h.emit(0, "text", { text: "Done." });
    await h.emit(0, "done", { session: "s" });
    expect(sessionButton("First")).toHaveAccessibleDescription(
      tt("ui.screens-plugins.chat-new-answer"),
    );
    expect(screen.getAllByTestId("chat-glow")).toHaveLength(1);
    expect(stored().find((g) => g.name === "First")?.unread).toBe(true);
    await userEvent.click(sessionButton("First"));
    expect(screen.queryByTestId("chat-glow")).not.toBeInTheDocument();
    expect(stored().find((g) => g.name === "First")?.unread).toBe(false);
  });

  it("leaves no glow on the conversation the reader is looking at", async () => {
    const h = host();
    await mount("/ask", h.open);
    await userEvent.type(field(), "First{Enter}");
    await h.emit(0, "done", { session: "s" });
    expect(screen.queryByTestId("chat-glow")).not.toBeInTheDocument();
  });

  it("keeps a restored glow while the chat is the pill, across a reload, and clears it once the chat opens", async () => {
    store([{ ...newConversation(1), name: "Read?", unread: true }]);
    const view = await mount("/");
    const pill = () =>
      screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) })[0];
    expect(pill()).toHaveAccessibleDescription(tt("ui.screens-plugins.chat-new-answer"));
    view.unmount();
    expect(readSessions()[0].unread).toBe(true);
    await mount("/");
    expect(pill()).toHaveAccessibleDescription(tt("ui.screens-plugins.chat-new-answer"));
    await openDock();
    expect(screen.queryByTestId("chat-glow")).not.toBeInTheDocument();
    expect(stored()[0].unread).toBe(false);
  });

  it("marks the dock's full-view button while another conversation is unread", async () => {
    store([
      { ...newConversation(1), name: "Alt", unread: true },
      { ...newConversation(2), name: "Current" },
    ]);
    await mount("/");
    await openDock();
    expect(
      screen.getByRole("button", { name: tt("ui.screens-plugins.chat-full-screen") }),
    ).toHaveAccessibleDescription(tt("ui.screens-plugins.chat-new-answer"));
  });
});

describe("conversations from storage", () => {
  const turn = (over: object) => ({
    q: "Half?",
    steps: [{ kind: "Read", target: "README.md" }],
    answer: "The half",
    cites: [],
    running: true,
    note: "",
    ...over,
  });

  it("draws an answer cut off with the page as interrupted, not running, and asks it again on Continue", async () => {
    store([{ ...newConversation(1), name: "Half", busy: true, turns: [turn({})] }]);
    const h = host();
    await mount("/ask", h.open);
    const article = screen.getByRole("article", { name: "Half?" });
    expect(article).toHaveTextContent("The half");
    expect(within(article).getByRole("status")).toHaveTextContent(
      tt("ui.screens-plugins.chat-interrupted-not-finished"),
    );
    expect(screen.queryByTestId("answer-live")).not.toBeInTheDocument();
    expect(screen.queryByTestId("answer-read")).not.toBeInTheDocument();
    expect(within(article).queryByLabelText(tt("ui.screens-plugins.chat-sources"))).toBeNull();
    expect(
      screen.queryByRole("button", { name: tt("ui.screens-plugins.chat-stop") }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(article).getByRole("button", { name: tt("ui.screens-plugins.chat-continue") }),
    );
    expect(h.sent().get("q")).toBe("Half?");
  });

  const CONTINUATIONS = [
    "ui.screens-plugins.chat-open",
    "ui.screens-plugins.chat-continued",
    "ui.screens-plugins.chat-started-anew",
  ] as const;

  /** A restored conversation named "Alt" that carries the host session s-1. */
  async function restored() {
    store([
      {
        ...newConversation(1),
        name: "Alt",
        agent: "s-1",
        turns: [turn({ running: false, finished: true })],
      },
    ]);
    const h = host();
    await mount("/ask", h.open);
    const nav = () =>
      screen.getByRole("navigation", { name: tt("ui.screens-plugins.chat-sessions") });
    const session = () => within(nav()).getByRole("button", { name: /^Alt/ });
    return { h, session };
  }

  it("names a restored conversation's continuation by what was measured: nothing was asked since", async () => {
    const { session } = await restored();
    // Restored with a host session id: nothing was asked at the host yet.
    expect(session()).toHaveTextContent(tt("ui.screens-plugins.chat-open"));
    for (const other of CONTINUATIONS.filter((k) => k !== "ui.screens-plugins.chat-open"))
      expect(session()).not.toHaveTextContent(tt(other));
  });

  it.each([
    ["the host answered with the same session", "s-1", "ui.screens-plugins.chat-continued"],
    ["the host answered with a different session", "s-2", "ui.screens-plugins.chat-started-anew"],
  ] as const)(
    "names a restored conversation's continuation by what was measured: %s",
    async (_, answered, key) => {
      const { h, session } = await restored();
      expect(session()).toHaveTextContent(tt("ui.screens-plugins.chat-open"));
      await userEvent.type(field(), "Next?{Enter}");
      // The question asks the host to continue the stored session.
      expect(h.sent().get("session")).toBe("s-1");
      await h.emit(0, "text", { text: "Yes." });
      await h.emit(0, "done", { session: answered });
      expect(session()).toHaveTextContent(tt(key));
      for (const other of CONTINUATIONS.filter((k) => k !== key))
        expect(session()).not.toHaveTextContent(tt(other));
    },
  );

  it.each([
    [1, 2],
    [3, 4],
  ])("keeps a new conversation apart from restored ones with ids %i and %i", async (a, b) => {
    store([
      { ...newConversation(a), name: "A" },
      { ...newConversation(b), name: "B" },
    ]);
    const h = host();
    await mount("/ask", h.open);
    const nav = () =>
      screen.getByRole("navigation", { name: tt("ui.screens-plugins.chat-sessions") });
    await userEvent.click(
      within(nav()).getByRole("button", { name: tt("ui.screens-plugins.chat-new-conversation") }),
    );
    await userEvent.type(field(), "Q{Enter}");
    await h.emit(0, "text", { text: "Answer" });
    await h.emit(0, "done", { session: "s" });
    expect(screen.getByRole("article", { name: "Q" })).toHaveTextContent("Answer");
    for (const name of [/^A(?!ctions)/, /^B/]) {
      await userEvent.click(within(nav()).getByRole("button", { name }));
      expect(screen.queryByRole("article")).toBeNull();
    }
    await userEvent.click(within(nav()).getByRole("button", { name: /^Q/ }));
    expect(screen.getByRole("article", { name: "Q" })).toHaveTextContent("Answer");
    const ids = stored().map((g) => g.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("closes an earlier conversation and keeps the active one", async () => {
    store([
      { ...newConversation(1), name: "Earlier" },
      { ...newConversation(2), name: "Active" },
    ]);
    await mount("/ask");
    const nav = () =>
      screen.getByRole("navigation", { name: tt("ui.screens-plugins.chat-sessions") });
    await userEvent.click(
      within(nav()).getByRole("button", {
        name: tt("ui.screens-plugins.chat-actions-title", { title: "Earlier" }),
      }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: tt("ui.screens-plugins.chat-delete") }),
    );
    expect(within(nav()).queryByRole("button", { name: /^Earlier/ })).toBeNull();
    const active = within(nav()).getByRole("button", { name: /^Active/ });
    expect(active.closest("[aria-current]")).toHaveAttribute("aria-current", "true");
    expect(stored().map((g) => g.name)).toEqual(["Active"]);
  });

  it("reports conversations the browser refused to store, drops the stale ones and keeps the rest", async () => {
    window.localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        role: "leadership",
        conversations: [{ ...newConversation(1), name: "Alt" }],
      }),
    );
    const real = Storage.prototype.setItem;
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STATE_KEY && value.includes('"conversations"'))
        throw new DOMException("full", "QuotaExceededError");
      return real.call(this, key, value);
    });
    try {
      const h = host();
      await mount("/ask", h.open);
      expect(screen.queryByTestId("chat-notice")).not.toBeInTheDocument();
      await userEvent.type(field(), "New{Enter}");
      expect(screen.getByTestId("chat-notice")).toHaveTextContent(
        t("ui.reader.chat-conversations-not-stored-browser-storage-refused"),
      );
      // A reload would otherwise bring back the old set as if it were current;
      // the reader's role, stored beside them, stays.
      expect(JSON.parse(window.localStorage.getItem(STATE_KEY)!)).toEqual({ role: "leadership" });
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("the panel's language and the host's words", () => {
  const en = uiT("en");
  const enT = atlasT("en");
  const de = uiT("de");
  const deT = atlasT("de");
  const switchTo = (lng: string) =>
    act(async () => {
      await i18n.changeLanguage(lng);
    });

  it("words the live activity and the read footer in English and keeps a German answer verbatim", async () => {
    await switchTo("en");
    const h = host();
    await mount("/ask", h.open);
    await userEvent.type(
      screen.getByRole("textbox", { name: en("ui.screens-plugins.chat-question-atlas") }),
      "Q{Enter}",
    );
    await h.emit(0, "read", { tool: "Read", target: "README.md" });
    const live = screen.getByTestId("answer-live");
    expect(live).toHaveTextContent(en("ui.screens-plugins.chat-atlas-answering"));
    expect(live).not.toHaveTextContent(de("ui.screens-plugins.chat-atlas-answering"));
    // The tool and its target are the host's own words.
    expect(live).toHaveTextContent("Read README.md");
    await h.emit(0, "text", { text: "It is in the file." });
    await h.emit(0, "done", { session: "s" });
    expect(screen.getByRole("article", { name: "Q" })).toHaveTextContent("It is in the file.");
    expect(screen.getByTestId("answer-read")).toHaveTextContent(
      `${en("ui.screens-plugins.chat-count-files-read-one", { count: 1 })} · ${en("ui.screens-plugins.chat-nothing-written")}`,
    );
  });

  it("moves the empty conversation's title and its starters with the language and back", async () => {
    await mount("/ask");
    const nav = () =>
      screen.getByRole("navigation", { name: tt("ui.screens-plugins.chat-sessions") });
    const starter = (s: string) => screen.queryByRole("button", { name: s });
    const enTitle = enT("ui.reader.chat-new-conversation");
    const enStarter = enT("ui.reader.chat-how-product-built");
    expect(within(nav()).getByRole("button", { name: new RegExp(`^${enTitle}.+`) })).toBeTruthy();
    expect(starter(enStarter)).toBeInTheDocument();

    await switchTo("de");
    const deNav = screen.getByRole("navigation", { name: de("ui.screens-plugins.chat-sessions") });
    const deTitle = deT("ui.reader.chat-new-conversation");
    expect(within(deNav).getByRole("button", { name: new RegExp(`^${deTitle}.+`) })).toBeTruthy();
    expect(within(deNav).queryByRole("button", { name: new RegExp(`^${enTitle}.+`) })).toBeNull();
    expect(starter(deT("ui.reader.chat-how-product-built"))).toBeInTheDocument();
    expect(starter(enStarter)).toBeNull();

    await switchTo("en");
    expect(within(nav()).getByRole("button", { name: new RegExp(`^${enTitle}.+`) })).toBeTruthy();
    expect(starter(enStarter)).toBeInTheDocument();
  });
});

describe("a host reply the contract does not cover", () => {
  const replying = (body: unknown) => () =>
    agentState((async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch);

  it.each([
    ["models without a sign-in", { models: MODELS, model: "" }],
    ["an error object sent with 200", { error: "not found" }],
  ])("keeps the reader standing and claims no sign-in for %s", async (_, body) => {
    const h = host();
    await mount("/", h.open, replying(body));
    // The whole reader is still there: the top bar's navigation and the chat.
    expect(screen.getAllByRole("navigation").length).toBeGreaterThan(0);
    await openDock();
    expect(field()).toBeInTheDocument();
    expect(screen.queryByText(tt("ui.screens-plugins.chat-check-again"))).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menu", { name: tt("ui.screens-plugins.chat-models") }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Model / })).toHaveAccessibleName(
      tt("ui.screens-plugins.chat-model-model", { model: "—" }),
    );
    await userEvent.type(field(), "Trotzdem{Enter}");
    expect(h.sent().get("q")).toBe("Trotzdem");
  });
});
