/** The chat as the reader drives it: the whole surface is mounted with a
 * signed-in host, and every case reads what lands — the rendered DOM, or the
 * address the question is sent to (what the host receives). */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentState, AgentStream } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import i18n from "@/i18n";
import Atlas from "./Atlas";
import { readSessions, writeSessions } from "./chat";
import { MAX_CONVERSATIONS, newConversation } from "@/ask/conversations";
import type { HostReaders } from "./host";
import { atlasT, uiT } from "./testing";

const model = taskflowModel();
const t = atlasT("en");
const tt = uiT("en");
const realMatchMedia = window.matchMedia;

const SIGNED_IN: AgentState = {
  auth: { loggedIn: true, available: true, email: "a@b.c" },
  models: [
    { id: "", label: "Default" },
    { id: "haiku", label: "Haiku" },
    { id: "opus", label: "Opus" },
  ],
  model: "",
};

const readers: HostReaders = {
  repo: async () => {
    throw new Error("no repository in this spec");
  },
  agent: async () => SIGNED_IN,
  tools: async () => {
    throw new Error("no tools in this spec");
  },
  installed: async () => [],
};

function stream() {
  const urls: string[] = [];
  const open = (url: string): AgentStream => {
    urls.push(url);
    return { addEventListener: () => undefined, close: () => undefined };
  };
  /** The parameters of the n-th question, as the host reads them. */
  const sent = (n = -1) => new URL(urls.at(n)!, "http://host").searchParams;
  return { open, urls, sent };
}

async function mount(path: string, open?: (url: string) => AgentStream) {
  window.history.replaceState(null, "", path);
  const view = render(<Atlas model={model} readers={readers} openStream={open} />);
  // The host's state arrives after the first paint.
  await act(async () => undefined);
  return view;
}

const field = () =>
  screen.getByRole("textbox", { name: tt("ui.screens-plugins.chat-question-atlas") });
/** Ends the running answer, so Enter sends again. */
const stopAnswer = () =>
  userEvent.click(screen.getByRole("button", { name: tt("ui.screens-plugins.chat-stop") }));
const openDock = () =>
  userEvent.click(
    screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) })[0],
  );

it("shows the host's install hint when the companion binary is missing", async () => {
  const unavailable: AgentState = {
    auth: {
      loggedIn: false,
      available: false,
      reason: "/nonexistent/claude is not on PATH",
      hint: "Install Claude Code, then the companion can read the code: https://claude.com/claude-code",
    },
    models: [],
    model: "",
  };
  const missingReaders: HostReaders = { ...readers, agent: async () => unavailable };
  window.history.replaceState(null, "", "/");
  render(<Atlas model={model} readers={missingReaders} />);
  await openDock();
  expect(
    await screen.findByText(/Install Claude Code, then the companion can read the code/),
  ).toBeInTheDocument();
});

function phone() {
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

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

afterEach(async () => {
  window.matchMedia = realMatchMedia;
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("chat keyboard", () => {
  it.each([
    ["desktop", false],
    ["phone", true],
  ])(
    "stops a running answer with an icon button inside the composer bar (%s)",
    async (_, onPhone) => {
      if (onPhone) phone();
      const s = stream();
      await mount("/", s.open);
      await openDock();
      await userEvent.type(field(), "What is this?");
      await userEvent.click(
        screen.getByRole("button", { name: tt("ui.screens-plugins.chat-send-composer") }),
      );
      expect(s.urls).toHaveLength(1);
      const stop = screen.getByRole("button", { name: tt("ui.screens-plugins.chat-stop") });
      // An icon: the name is its label, no word stands in the bar to overflow it.
      expect(stop).toHaveTextContent("");
      expect(stop.parentElement).toBe(
        screen.getByRole("radiogroup", { name: tt("ui.screens-plugins.chat-mode") }).parentElement,
      );
      await userEvent.click(stop);
      expect(
        screen.queryByRole("button", { name: tt("ui.screens-plugins.chat-stop") }),
      ).not.toBeInTheDocument();
    },
  );

  it("sends on Enter at desktop width and keeps Shift+Enter for a new line", async () => {
    const s = stream();
    await mount("/", s.open);
    await openDock();
    await userEvent.type(field(), "First line{Shift>}{Enter}{/Shift}second");
    expect(field()).toHaveValue("First line\nsecond");
    expect(s.urls).toHaveLength(0);
    await userEvent.type(field(), "{Enter}");
    expect(s.sent().get("q")).toBe("First line\nsecond");
    expect(field()).toHaveValue("");
  });

  it("keeps Enter as the line break at phone width", async () => {
    phone();
    const s = stream();
    await mount("/", s.open);
    await openDock();
    await userEvent.type(field(), "one{Enter}two");
    expect(field()).toHaveValue("one\ntwo");
    expect(s.urls).toHaveLength(0);
  });
});

describe("chat context", () => {
  it("sends the record the chip shows, and nothing once the chip is removed", async () => {
    const id = model.features[0].id;
    const s = stream();
    await mount(`/record/${id}`, s.open);
    await openDock();
    const chips = screen.getByLabelText(tt("ui.screens-plugins.chat-context"));
    expect(chips).toHaveTextContent(id);
    await userEvent.type(field(), "What do I see?{Enter}");
    expect(s.sent().getAll("context")).toEqual([`record:${id}`]);
    await stopAnswer();

    await userEvent.click(
      within(chips).getByRole("button", { name: tt("primitives.chip.remove") }),
    );
    expect(screen.queryByLabelText(tt("ui.screens-plugins.chat-context"))).not.toBeInTheDocument();
    await userEvent.type(field(), "What next?{Enter}");
    expect(s.urls).toHaveLength(2);
    expect(s.sent().has("context")).toBe(false);
  });

  it("names the calibration page and offers its own starters there", async () => {
    const s = stream();
    await mount("/contents/calibration", s.open);
    await openDock();
    expect(screen.getByLabelText(tt("ui.screens-plugins.chat-context"))).toHaveTextContent(
      tt("ui.reader.chat-calibration"),
    );
    for (const q of [
      "ui.reader.chat-what-am-i-looking-here",
      "ui.reader.chat-what-band",
      "ui.reader.chat-what-outlier",
    ])
      expect(screen.getByRole("button", { name: t(q) })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("ui.reader.chat-how-product-built") }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("ui.reader.chat-what-band") }));
    expect(s.sent().get("q")).toBe(t("ui.reader.chat-what-band"));
    expect(s.sent().getAll("context")).toEqual(["page:contents/calibration"]);
  });

  it("offers the general starters where a page has none of its own", async () => {
    await mount("/ask");
    for (const q of [
      "ui.reader.chat-which-promises-does-no-test-carry",
      "ui.reader.chat-where-has-code-moved-away-its",
      "ui.reader.chat-how-product-built",
    ])
      expect(screen.getByRole("button", { name: t(q) })).toBeInTheDocument();
    expect(screen.queryByLabelText(tt("ui.screens-plugins.chat-context"))).not.toBeInTheDocument();
  });
});

describe("chat commands, mode and model", () => {
  it("opens the command list on a slash, filters it, and runs the chosen command", async () => {
    const s = stream();
    await mount("/", s.open);
    await openDock();
    await userEvent.type(field(), "/");
    const list = screen.getByRole("menu", { name: tt("ui.screens-plugins.chat-commands") });
    // The chat's own three, then the bundled plugins' commands from the host:
    // each entry's text starts with its command, in exactly this order.
    const commands = [
      t("ui.reader.chat-new"),
      t("ui.reader.chat-ask"),
      t("ui.reader.chat-model"),
      "/adr",
      "/bpmn",
      "/wiki",
    ];
    const items = within(list).getAllByRole("menuitem");
    expect(items).toHaveLength(commands.length);
    items.forEach((item, i) => expect(item.textContent?.startsWith(commands[i])).toBe(true));
    await userEvent.type(field(), "bpm");
    expect(within(list).getAllByRole("menuitem")).toHaveLength(1);
    await userEvent.type(field(), "{Escape}");
    expect(
      screen.queryByRole("menu", { name: tt("ui.screens-plugins.chat-commands") }),
    ).not.toBeInTheDocument();
    expect(field()).toHaveValue("/bpm");
    await userEvent.clear(field());
    await userEvent.type(field(), "/{ArrowDown}");
    expect(
      within(screen.getByRole("menu", { name: tt("ui.screens-plugins.chat-commands") })).getByRole(
        "menuitem",
        {
          current: true,
        },
      ),
    ).toHaveTextContent(t("ui.reader.chat-ask"));
    await userEvent.type(field(), "{Enter}");
    expect(field()).toHaveValue("");
    expect(screen.getByRole("radio", { name: tt("ui.reader.chat-ask-name") })).toBeChecked();
    expect(s.urls).toHaveLength(0);
  });

  it("opens the model menu, sends the picked model, and closes on Esc", async () => {
    const s = stream();
    await mount("/", s.open);
    await openDock();
    const picker = () => screen.getByRole("button", { name: /^Model / });
    expect(picker()).toHaveAccessibleName(
      tt("ui.screens-plugins.chat-model-model", { model: "Default" }),
    );
    await userEvent.click(picker());
    await userEvent.click(
      within(screen.getByRole("menu", { name: tt("ui.screens-plugins.chat-models") })).getByRole(
        "menuitem",
        {
          name: "Haiku",
        },
      ),
    );
    expect(
      screen.queryByRole("menu", { name: tt("ui.screens-plugins.chat-models") }),
    ).not.toBeInTheDocument();
    expect(picker()).toHaveAccessibleName(
      tt("ui.screens-plugins.chat-model-model", { model: "Haiku" }),
    );
    await userEvent.type(field(), "Question{Enter}");
    expect(s.sent().get("model")).toBe("haiku");
    await userEvent.click(picker());
    expect(
      screen.getByRole("menu", { name: tt("ui.screens-plugins.chat-models") }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("menu", { name: tt("ui.screens-plugins.chat-models") }),
    ).not.toBeInTheDocument();
  });
});

describe("the model picker as a menu button", () => {
  const picker = () => screen.getByRole("button", { name: /^Model / });
  const menu = () => screen.queryByRole("menu", { name: tt("ui.screens-plugins.chat-models") });
  const item = (name: string) =>
    within(screen.getByRole("menu", { name: tt("ui.screens-plugins.chat-models") })).getByRole(
      "menuitem",
      {
        name,
      },
    );

  it("names the chosen model and stands closed until pressed, then opens and says so", async () => {
    await mount("/", stream().open);
    await openDock();
    expect(picker()).toHaveAccessibleName(
      tt("ui.screens-plugins.chat-model-model", { model: "Default" }),
    );
    expect(picker()).toHaveAttribute("aria-haspopup", "menu");
    expect(picker()).toHaveAttribute("aria-expanded", "false");
    expect(menu()).toBeNull();
    await userEvent.click(picker());
    expect(menu()).toBeInTheDocument();
    expect(picker()).toHaveAttribute("aria-expanded", "true");
  });

  it("marks the model that holds now with aria-current and a check, and no other", async () => {
    await mount("/", stream().open);
    await openDock();
    await userEvent.click(picker());
    expect(item("Default")).toHaveAttribute("aria-current", "true");
    expect(item("Default").querySelector("svg")).not.toBeNull();
    for (const other of ["Haiku", "Opus"]) {
      expect(item(other)).not.toHaveAttribute("aria-current");
      expect(item(other).querySelector("svg")).toBeNull();
    }
  });

  it("opens from an arrow on the focused picker, down on the first model, up on the last", async () => {
    await mount("/", stream().open);
    await openDock();
    picker().focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(menu()).toBeInTheDocument();
    expect(item("Default")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menu()).toBeNull();
    await userEvent.keyboard("{ArrowUp}");
    expect(item("Opus")).toHaveFocus();
  });

  it("walks the models with the arrows and wraps at both ends", async () => {
    await mount("/", stream().open);
    await openDock();
    picker().focus();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{ArrowUp}");
    expect(item("Opus")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(item("Default")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(item("Opus")).toHaveFocus();
  });

  it("closes on Escape and gives the picker the focus back", async () => {
    await mount("/", stream().open);
    await openDock();
    picker().focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(item("Haiku")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(menu()).toBeNull();
    expect(picker()).toHaveFocus();
  });

  it("opens on Enter and takes the focused model on Enter; the next question carries it", async () => {
    const s = stream();
    await mount("/", s.open);
    await openDock();
    picker().focus();
    await userEvent.keyboard("{Enter}");
    expect(item("Default")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(menu()).toBeNull();
    expect(picker()).toHaveAccessibleName(
      tt("ui.screens-plugins.chat-model-model", { model: "Haiku" }),
    );
    expect(picker()).toHaveFocus();
    await userEvent.type(field(), "Question{Enter}");
    expect(s.sent().get("model")).toBe("haiku");
  });

  it("closes on a press elsewhere and stays open on a press inside the menu", async () => {
    await mount("/", stream().open);
    await openDock();
    await userEvent.click(picker());
    fireEvent.pointerDown(screen.getByRole("menu", { name: tt("ui.screens-plugins.chat-models") }));
    expect(menu()).toBeInTheDocument();
    fireEvent.pointerDown(field());
    expect(menu()).toBeNull();
    expect(picker()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("chat pinning", () => {
  it("pins a conversation into the pinned group and keeps it there after a reload", async () => {
    const s = stream();
    const view = await mount("/ask", s.open);
    await userEvent.type(field(), "Remember this{Enter}");
    const title = "Remember this";
    await userEvent.click(
      screen.getByRole("button", {
        name: tt("ui.screens-plugins.chat-actions-title", { title }),
      }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: tt("ui.screens-plugins.chat-pin") }),
    );
    const sessions = () =>
      screen.getByRole("navigation", { name: tt("ui.screens-plugins.chat-sessions") });
    expect(sessions()).toHaveTextContent(`${tt("ui.screens-plugins.chat-pinned")} · 1`);

    view.unmount();
    await mount("/ask");
    expect(sessions()).toHaveTextContent(`${tt("ui.screens-plugins.chat-pinned")} · 1`);
    await userEvent.click(
      screen.getByRole("button", {
        name: tt("ui.screens-plugins.chat-actions-title", { title }),
      }),
    );
    expect(
      screen.getByRole("menuitem", { name: tt("ui.screens-plugins.chat-unpin") }),
    ).toBeInTheDocument();
  });

  it("drops unpinned conversations first when the stored ones reach their cap", () => {
    const all = Array.from({ length: MAX_CONVERSATIONS + 2 }, (_, i) => ({
      ...newConversation(i + 1),
      name: `Conversation ${i + 1}`,
      ...(i === 0 ? { pinned: true } : {}),
    }));
    expect(writeSessions(all)).toBe(true);
    const stored = JSON.parse(window.localStorage.getItem("facet.atlas.state")!).conversations as {
      id: number;
      pinned?: boolean;
    }[];
    expect(stored.map((g) => g.id)).toEqual([1, ...all.slice(3).map((g) => g.id)]);
    expect(readSessions()[0]).toMatchObject({ id: 1, pinned: true });
  });
});
