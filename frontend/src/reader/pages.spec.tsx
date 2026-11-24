import { de as uiDe } from "@facet-tools/ui";
import { germanLabel } from "@/i18n/testing-labels.spec-support";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentStream } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import i18n from "@/i18n";
import Atlas from "./Atlas";

const model = taskflowModel();

function at(path: string) {
  window.history.replaceState(null, "", path);
}

function mount(path: string, props: Partial<Parameters<typeof Atlas>[0]> = {}) {
  at(path);
  return render(<Atlas model={model} readers={null} {...props} />);
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

const where = () => window.location.pathname;

describe("frame places", () => {
  it("shows the Overview for the chosen role and opens the product from the nav", async () => {
    mount("/");
    expect(screen.getByTestId("overview")).toHaveAttribute("data-role", "dev");
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Areas" })).getByRole("button", {
        name: "Product",
      }),
    );
    expect(where()).toBe("/product");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      `${model.features.length} features + ${model.assumptions.length} assumptions`,
    );
  });

  it("switches the Overview to another of the seven roles", async () => {
    mount("/");
    await userEvent.click(screen.getByRole("button", { name: "Developer" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Leadership/ }));
    expect(screen.getByTestId("overview")).toHaveAttribute("data-role", "leadership");
  });

  it("opens a capability from a domain overview", async () => {
    mount("/domain/tasks");
    expect(screen.getAllByText("tasks").length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByText("create")[0]);
    expect(where()).toBe("/domain/tasks/create");
    await userEvent.click(screen.getAllByText("quick-add")[0]);
    expect(where()).toBe("/record/tasks/create/quick-add");
  });

  it("shows the not-found page with the nearest records", async () => {
    mount("/nowhere");
    expect(screen.getByText("This place does not exist here.")).toBeInTheDocument();
    mount("/domain/nowhere/absent");
    expect(screen.getAllByText("This place does not exist here.").length).toBeGreaterThan(0);
  });
});

describe("records and record", () => {
  it("filters the collection through a facet held in the container", async () => {
    mount("/records");
    await userEvent.click(screen.getByRole("button", { name: /^planned\s*1$/ }));
    expect(screen.getAllByText("task-search").length).toBeGreaterThan(0);
    expect(screen.queryByText("quick-add")).not.toBeInTheDocument();
    // Leave and come back: the filter is still set.
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Areas" })).getByRole("button", {
        name: "Overview",
      }),
    );
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Areas" })).getByRole("button", {
        name: "Records",
      }),
    );
    expect(screen.queryByText("quick-add")).not.toBeInTheDocument();
  });

  it("walks the record's breadcrumbs back to the domain", async () => {
    mount("/record/tasks/create/quick-add");
    expect(screen.getByRole("heading", { name: "quick-add" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "tasks" }));
    expect(where()).toBe("/domain/tasks");
  });

  it("offers the record's siblings from the path", async () => {
    mount("/record/tasks/create/quick-add");
    const carets = screen.getAllByRole("button", { name: "Show siblings" });
    await userEvent.click(carets[1]);
    await userEvent.click(screen.getByRole("menuitem", { name: /^recurring/ }));
    expect(where()).toBe("/domain/tasks/recurring");
  });

  it("names a missing record and its nearest neighbours", () => {
    mount("/record/tasks/create/quick-ad");
    expect(screen.getAllByText(/tasks\/create\/quick-add/).length).toBeGreaterThan(0);
  });
});

describe("contents", () => {
  it("opens a kind page from the hub", async () => {
    mount("/contents");
    expect(screen.getByTestId("contents-hub")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: /Promises/ })[0]);
    expect(where()).toBe("/contents/promises");
    expect(screen.getByTestId("promises-page")).toBeInTheDocument();
  });

  it.each([
    "knowledge",
    "operations",
    "provenance",
    "taxonomy",
    "calibration",
    "tests",
    "deviations",
    "drift",
    "fixed",
    "anchor",
    "files",
    "rules",
  ])("renders the %s page from the model", (kind) => {
    mount(`/contents/${kind}`);
    expect(within(screen.getByRole("main")).getAllByRole("heading").length).toBeGreaterThan(0);
    expect(screen.queryByText("This place does not exist here.")).not.toBeInTheDocument();
  });

  it("treats an unknown kind as a missing place", () => {
    mount("/contents/nothing");
    expect(screen.getByText("This place does not exist here.")).toBeInTheDocument();
  });

  it("says the project declares no glossary instead of an empty one", () => {
    mount("/glossary");
    expect(screen.getAllByText("No glossary declared").length).toBeGreaterThan(0);
    expect(screen.queryByText(/The glossary is empty/)).toBeNull();
  });
});

describe("settings", () => {
  it("drives the container's palette from the appearance section", async () => {
    mount("/settings");
    await userEvent.click(screen.getByRole("radio", { name: "Paper · dark" }));
    const app = screen.getByRole("main").closest("[data-t-theme]") as HTMLElement;
    expect(app.dataset.tTheme).toBe("paper");
    expect(app.dataset.tMode).toBe("dark");
    expect(JSON.parse(window.localStorage.getItem("facet.atlas.theme")!)).toEqual({
      theme: "paper",
      mode: "dark",
    });
  });

  it("turns focus mode on under appearance, applies it to the shell and keeps it", async () => {
    const { unmount } = mount("/settings");
    const shell = () => screen.getByTestId("app-shell");
    expect(shell()).not.toHaveAttribute("data-focus");
    const focus = screen.getByRole("switch", { name: "Focus mode" });
    await userEvent.click(focus);
    expect(focus).toHaveAttribute("aria-checked", "true");
    expect(shell()).toHaveAttribute("data-focus", "on");
    expect(window.localStorage.getItem("facet.atlas.focus")).toBe("on");
    unmount();
    const again = mount("/product");
    expect(shell()).toHaveAttribute("data-focus", "on");
    again.unmount();
    mount("/settings");
    await userEvent.click(screen.getByRole("switch", { name: "Focus mode" }));
    expect(shell()).not.toHaveAttribute("data-focus");
    expect(window.localStorage.getItem("facet.atlas.focus")).toBeNull();
  });

  it("names what each stored key holds and clears all of it on request", async () => {
    window.localStorage.setItem(
      "facet.atlas.state",
      JSON.stringify({ role: "dev", conversations: [{ id: 1 }, { id: 2 }] }),
    );
    window.localStorage.setItem(
      "facet.atlas.theme",
      JSON.stringify({ theme: "facet", mode: "light" }),
    );
    window.localStorage.setItem("facet.unknown", "x");
    mount("/settings/history");
    const rows = screen.getAllByTestId("storage-item");
    const row = (label: string) => rows.find((r) => r.textContent?.includes(label)) as HTMLElement;
    const history = row("History of places");
    expect(within(history).getByTestId("storage-item-contents")).toHaveTextContent("1 place");
    expect(history).toHaveTextContent("facet.atlas.history");
    const chats = row("Chat sessions and settings");
    expect(within(chats).getByTestId("storage-item-contents")).toHaveTextContent("2 chat sessions");
    expect(
      within(chats).getByRole("button", {
        name: "Clear Chat sessions and settings (2 chat sessions)",
      }),
    ).toBeInTheDocument();
    // The stored palette is named by what it holds and shows its value.
    const palette = row("Palette and mode");
    expect(within(palette).getByTestId("storage-item-contents")).toHaveTextContent(
      /^facet · light$/,
    );
    expect(palette).toHaveTextContent("facet.atlas.theme");
    // A key nobody named keeps its own name, and its contents are only the
    // generic entry count, not a description invented for it.
    const unknown = row("facet.unknown");
    expect(within(unknown).getByTestId("storage-item-contents")).toHaveTextContent(/^1 entry$/);
    // Each clear button names the key it clears with its contents.
    for (const name of [
      "Clear History of places (1 place)",
      "Clear Chat sessions and settings (2 chat sessions)",
      "Clear Palette and mode (facet · light)",
      /^Clear facet\.unknown \(1 entry\)$/,
    ])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    for (const r of rows) {
      const contents = within(r).getByTestId("storage-item-contents").textContent ?? "";
      const escaped = contents.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(within(r).getByRole("button", { name: /^Clear .+ \(/ })).toHaveAccessibleName(
        expect.stringMatching(new RegExp(`^Clear .+ \\(${escaped}\\)$`)),
      );
    }
    // The four stored keys are exactly the listed rows.
    const listed = [
      "facet.atlas.state",
      "facet.atlas.theme",
      "facet.unknown",
      "facet.atlas.history",
    ];
    expect(rows).toHaveLength(listed.length);
    for (const key of listed) expect(row(key)).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(`^Clear all ${rows.length}`) }),
    );
    expect(window.localStorage.getItem("facet.atlas.state")).toBeNull();
    // Every other listed key is absent as well.
    for (const key of listed.filter((k) => k !== "facet.atlas.history"))
      expect(window.localStorage.getItem(key)).toBeNull();
    // The history keeps the place the reader is on, nothing before it.
    expect(JSON.parse(window.localStorage.getItem("facet.atlas.history")!).places).toHaveLength(1);
  });

  it("measures the history it keeps and says when the companion did not answer", async () => {
    mount("/settings/history");
    expect(screen.getAllByText(/facet\.atlas\.history/).length).toBeGreaterThan(0);
    mount("/settings/ai");
    expect(screen.getByText("Atlas AI is not responding")).toBeInTheDocument();
  });

  it("switches a role's generative section in the stored reader state, and leaves the rest alone", async () => {
    window.localStorage.setItem(
      "facet.atlas.state",
      JSON.stringify({ role: "dev", generativeOn: ["leadership"], conversations: [] }),
    );
    mount("/settings/genui");
    const roles = screen.getByTestId("genui-roles");
    const lead = within(roles).getByRole("switch", { name: "Leadership" });
    const dev = within(roles).getByRole("switch", { name: "Developer" });
    expect(within(roles).getAllByRole("switch")).toHaveLength(7);
    expect(lead).toHaveAttribute("aria-checked", "true");
    expect(dev).toHaveAttribute("aria-checked", "false");
    await userEvent.click(dev);
    await userEvent.click(lead);
    expect(dev).toHaveAttribute("aria-checked", "true");
    expect(lead).toHaveAttribute("aria-checked", "false");
    const stored = JSON.parse(window.localStorage.getItem("facet.atlas.state")!);
    expect(stored.generativeOn).toEqual(["dev"]);
    expect(stored.role).toBe("dev");
    expect(stored.conversations).toEqual([]);
    expect(screen.queryByText("Not connected in Atlas yet")).not.toBeInTheDocument();
  });

  it("keeps a role switch off and says why when the stored state is not readable", async () => {
    window.localStorage.setItem("facet.atlas.state", "[1");
    mount("/settings/genui");
    const dev = within(screen.getByTestId("genui-roles")).getByRole("switch", {
      name: "Developer",
    });
    expect(dev).toHaveAttribute("aria-checked", "false");
    await userEvent.click(dev);
    expect(dev).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not saved: the stored Atlas state (facet.atlas.state) is not readable",
    );
    expect(window.localStorage.getItem("facet.atlas.state")).toBe("[1");
  });

  it("keeps a role switch off and says why when the stored state is JSON but not an object", async () => {
    // An array, null, a number and a string: each parses, none is the stored reader state.
    for (const text of ['["dev"]', "null", "42", '"dev"']) {
      window.localStorage.setItem("facet.atlas.state", text);
      const view = mount("/settings/genui");
      const dev = within(screen.getByTestId("genui-roles")).getByRole("switch", {
        name: "Developer",
      });
      expect(dev).toHaveAttribute("aria-checked", "false");
      await userEvent.click(dev);
      expect(dev).toHaveAttribute("aria-checked", "false");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Not saved: the stored Atlas state (facet.atlas.state) is not readable",
      );
      expect(window.localStorage.getItem("facet.atlas.state")).toBe(text);
      view.unmount();
    }
  });

  it("switches the whole surface to German and back from the language section", async () => {
    mount("/settings/language");
    const nav = () =>
      screen.getByRole("navigation", { name: new RegExp(`^(Areas|${germanLabel("Areas")})$`) });
    expect(within(nav()).getByRole("button", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Language" })).toBeInTheDocument();
    // The place list words the visited place in the language of the moment: it
    // has to change with each switch, so it cannot be the words stored at the visit.
    const placeList = async (button: string, item: RegExp) => {
      await userEvent.click(screen.getByRole("button", { name: button }));
      expect(screen.getByRole("menuitem", { name: item })).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("menuitem", { name: item })).not.toBeInTheDocument();
    };
    try {
      await placeList("History", /^Settings/);
      // The interface language is a Atlas segment of radios, never a native drop-down.
      const segment = screen.getByRole("radiogroup", { name: "Interface language" });
      expect(within(segment).getAllByRole("radio").length).toBeGreaterThanOrEqual(2);
      const main = screen.getByRole("main");
      expect(within(main).queryAllByRole("combobox")).toHaveLength(0);
      expect(within(main).queryAllByRole("listbox")).toHaveLength(0);
      expect(main.getElementsByTagName("select")).toHaveLength(0);
      await userEvent.click(
        within(screen.getByRole("radiogroup", { name: "Interface language" })).getByRole("radio", {
          name: "German",
        }),
      );
      expect(i18n.language).toBe("de");
      // A shell label (Atlas), a page label (Atlas) and a word the reader itself produces.
      expect(screen.getByRole("navigation", { name: germanLabel("Areas") })).toBeInTheDocument();
      expect(
        within(nav()).getByRole("button", { name: germanLabel("Product") }),
      ).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: germanLabel("Language") })).toBeInTheDocument();
      await placeList(uiDe["primitives.history.label"], new RegExp(`^${germanLabel("Settings")}`));
      await userEvent.click(
        within(
          screen.getByRole("radiogroup", { name: germanLabel("Interface language") }),
        ).getByRole("radio", {
          name: "English",
        }),
      );
      expect(within(nav()).getByRole("button", { name: "Product" })).toBeInTheDocument();
      // English brings the navigation and the page heading back as well.
      expect(i18n.language).toBe("en");
      expect(screen.getByRole("navigation", { name: "Areas" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Language" })).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: germanLabel("Language") }),
      ).not.toBeInTheDocument();
      await placeList("History", /^Settings/);
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("keeps the Git provider card's detected values inside the card's inner spacing", async () => {
    mount("/settings/git-provider", {
      readers: {
        repo: () =>
          Promise.resolve({
            repository: true,
            dirty: false,

            branch: "main",
            remote: "https://github.com/o/r.git",
            forge: "github",
          }),
        agent: () => Promise.resolve(null),
        tools: () => new Promise(() => undefined),
        installed: () => Promise.resolve([]),
      },
    });
    const list = (await screen.findByText("https://github.com/o/r.git")).closest(
      "dl",
    ) as HTMLElement;
    // The detected values are a key-value list directly in a settings card …
    expect(list).toHaveClass("t-c-kv");
    expect(list.parentElement).toHaveClass("t-c-setgroup");
    // … and the stylesheet Atlas ships gives exactly that pairing the rows' 16px.
    const css = readFileSync(resolve(__dirname, "../screens/styles/contents.css"), "utf8");
    const rule = /\n\.t-c-setgroup > \.t-c-kv \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/padding:\s*\d+px 16px/);
    expect(/\n\.t-c-setrow \{([^}]*)\}/.exec(css)?.[1]).toMatch(/padding:\s*12px 16px/);
  });

  it("opens a section from the list", async () => {
    mount("/settings");
    await userEvent.click(screen.getByRole("button", { name: /Git provider/ }));
    expect(where()).toBe("/settings/git-provider");
  });
});

describe("plugins", () => {
  it("mounts the processes place and says why when the host gives no session", async () => {
    mount("/p/bpmn");
    const note = await screen.findByTestId("process-note");
    expect(within(note).getByRole("alert")).toBeInTheDocument();
    // The failed state keeps the page head every plugin place has.
    expect(within(note).getByRole("heading", { level: 1, name: "Processes" })).toBeInTheDocument();
  });

  describe("write actions", () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    /** The host's answers by path; calls are recorded so a test can read what was sent. */
    function host(answers: Record<string, (body: unknown) => unknown>) {
      const calls: { url: string; body: unknown }[] = [];
      global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, body });
        const answer = answers[url];
        if (!answer) return new Promise<Response>(() => undefined);
        // jsdom has no Response; this is the part of one the callers read.
        const reply = answer(body);
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(reply),
        } as Response);
      }) as typeof fetch;
      return calls;
    }

    it("does not show an unavailable decision creation control", async () => {
      const calls = host({});
      mount("/p/adr");
      await screen.findByRole("heading", { name: "Decisions" });
      expect(screen.queryByRole("button", { name: "New decision" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Directory" }));
      const panel = screen.getByTestId("adr-settings");
      expect(within(panel).getByText(/Configuration/)).toBeInTheDocument();
      expect(calls.find((c) => c.url === "/api/settings/directory")?.body).toEqual({ kind: "adr" });
      await userEvent.click(within(panel).getByRole("button", { name: "Back to the decisions" }));
      expect(screen.queryByTestId("adr-settings")).not.toBeInTheDocument();
    });
  });

  it("names an unknown plugin as a missing place", async () => {
    mount("/p/unknown");
    expect(await screen.findByText("This place does not exist here.")).toBeInTheDocument();
  });
});

describe("palette", () => {
  it("opens with Ctrl K and jumps to a record", async () => {
    mount("/");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = within(screen.getByRole("dialog")).getByRole("combobox");
    await userEvent.type(input, "quick-add");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(where()).toBe("/record/tasks/create/quick-add");
  });
});

describe("chat", () => {
  function fakeStream() {
    const listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
    const urls: string[] = [];
    const open = (url: string): AgentStream => {
      urls.push(url);
      return {
        addEventListener: (type, l) => {
          (listeners[type] ??= []).push(l);
        },
        close: () => undefined,
      };
    };
    const emit = (type: string, data: unknown) =>
      act(() => listeners[type]?.forEach((l) => l({ data: JSON.stringify(data) } as MessageEvent)));
    return { open, emit, urls };
  }

  it("streams an answer into the dock and stores it in the stored reader state", async () => {
    const s = fakeStream();
    mount("/", { openStream: s.open });
    await userEvent.click(screen.getByRole("button", { name: /Ask Atlas/ }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Question to Atlas" }),
      "What is still open?",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(s.urls[0]).toMatch(/^\/api\/companion\?q=/);
    s.emit("text", { text: "Three Promises." });
    s.emit("done", { session: "abc", cost: 0 });
    expect(screen.getAllByText("Three Promises.").length).toBeGreaterThan(0);
    const stored = JSON.parse(window.localStorage.getItem("facet.atlas.state")!);
    expect(stored.conversations.at(-1).turns.at(-1)).toMatchObject({
      q: "What is still open?",
      answer: "Three Promises.",
      running: false,
    });
    expect(stored.conversations.at(-1).agent).toBe("abc");
  });

  it("words the dock and the answer footer in English with singular and plural forms", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    try {
      const feet = () => screen.getAllByText(/\d+ sources?/).map((n) => n.textContent ?? "");
      const run = async (targets: string[]) => {
        const s = fakeStream();
        const view = mount("/", { openStream: s.open });
        await userEvent.click(screen.getByRole("button", { name: /Ask Atlas/ }));
        await userEvent.type(screen.getByRole("textbox", { name: "Question to Atlas" }), "Open?");
        await userEvent.click(screen.getByRole("button", { name: /^send/i }));
        for (const target of targets) s.emit("read", { tool: "Read", target });
        s.emit("text", { text: "Answer." });
        s.emit("done", { session: "abc", cost: 0 });
        const text = feet();
        view.unmount();
        window.localStorage.clear();
        return text;
      };
      const [one, two] = model.features.map((f) => f.id);
      expect(await run([one])).toEqual([expect.stringMatching(/\b1 source(?!s)/)]);
      expect(await run([one, two])).toEqual([expect.stringMatching(/\b2 sources/)]);
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("opens full size at its own address", () => {
    mount("/ask");
    expect(screen.getByRole("button", { name: "New conversation" })).toBeInTheDocument();
  });
});
