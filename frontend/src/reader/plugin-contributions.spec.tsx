/** What a plugin contributes to the chat, the role menu, the settings and the
 * catalogue, as the reader draws it: next to the core's own, never instead
 * of it, gone again when the plugin takes it back, and absent altogether in a
 * reader without plugins (every bundled one switched off, none installed).
 * Each case reads the rendered reader or what the chat sent, never a value a
 * registry returned. */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentStream } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import { contents, frame } from "@/screens";
import Atlas from "./Atlas";
import { numericValue } from "@/contents/catalogue";
import {
  fetchInstalledPlugins,
  fetchPluginCapabilities,
  resolveInstalledPlugins,
  type InstalledPluginListing,
} from "@/plugin/installed";
import type { AtlasApi, PluginEntry } from "@/plugin/api";
import { OFFICIAL_PLUGINS } from "@/plugin/official";
import { STORAGE_KEY } from "@/state";
import { atlasT, uiT } from "./testing";

jest.mock("@/plugin/installed", () => ({
  ...jest.requireActual("@/plugin/installed"),
  fetchInstalledPlugins: jest.fn(),
  fetchPluginCapabilities: jest.fn(),
  resolveInstalledPlugins: jest.fn(),
}));

const model = taskflowModel();
const t = atlasT("en");
const tt = uiT("en");
const realMatchMedia = window.matchMedia;

const listing: InstalledPluginListing = {
  id: "probe",
  name: "Probe",
  version: "0.1.0",
  api: 0,
  entry: "/plugins/probe/plugin.js",
  areas: [],
  slots: [],
  dev: false,
  verification: "ok",
};

/** Loads `entry` as the installed plugin "probe"; none when `entry` is null. */
function install(entry: PluginEntry | null) {
  const listings = entry ? [listing] : [];
  jest.mocked(fetchInstalledPlugins).mockResolvedValue(listings);
  jest.mocked(fetchPluginCapabilities).mockResolvedValue(entry ? { probe: "cap" } : {});
  jest.mocked(resolveInstalledPlugins).mockImplementation(async (items) => ({
    loaded: entry ? items.map((l) => ({ id: l.id, entry })) : [],
    states: items.map((l) => ({ status: "loaded" as const, listing: l })),
  }));
}

/** A reader without plugins: every bundled one switched off, none installed. */
function withoutPlugins() {
  install(null);
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ pluginsOff: OFFICIAL_PLUGINS.map((p) => p.id) }),
  );
}

let urls: string[] = [];
const open = (url: string): AgentStream => {
  urls.push(url);
  return { addEventListener: () => undefined, close: () => undefined };
};
const sent = (i: number) => new URL(urls[i], "http://host").searchParams.get("q");

beforeEach(() => {
  jest.clearAllMocks();
  urls = [];
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as never;
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  window.matchMedia = realMatchMedia;
});

async function mount(path: string) {
  window.history.replaceState(null, "", path);
  const view = render(<Atlas model={model} readers={null} openStream={open} />);
  await act(async () => undefined);
  await act(async () => undefined);
  return view;
}

async function openChat() {
  await userEvent.click(
    screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) })[0],
  );
  return screen.getByRole("textbox", { name: tt("ui.screens-plugins.chat-question-atlas") });
}
const commandList = () =>
  screen.queryByRole("menu", { name: tt("ui.screens-plugins.chat-commands") });

describe("a plugin's command in the chat", () => {
  const ran: string[] = [];
  const ran2: string[] = [];
  let remove: (() => void) | null = null;
  beforeEach(() => {
    ran.length = 0;
    ran2.length = 0;
    install((atlas) => {
      remove = atlas.commands.register({
        command: "/probe",
        argument: "what",
        purpose: "Run the probe",
        group: "Probe",
        run: (arg) => ran.push(arg),
      });
      atlas.commands.register({
        command: "/probe2",
        purpose: "Run the second probe",
        group: "Probe",
        run: (arg) => ran2.push(arg),
      });
    });
  });

  it("names its argument in the list, and picked from the list runs at once without one", async () => {
    await mount("/");
    const field = await openChat();
    await userEvent.type(field, "/pro");
    const row = within(commandList()!).getByRole("menuitem", { name: /\/probe\b.*Run the probe/ });
    expect(row).toHaveTextContent("what");
    await userEvent.type(field, "{Enter}");
    expect(ran).toEqual([""]);
    expect(field).toHaveValue("");
    expect(urls).toEqual([]);
  });

  it("runs the clicked command, not the highlighted one", async () => {
    await mount("/");
    const field = await openChat();
    await userEvent.type(field, "/probe");
    const rows = within(commandList()!).getAllByRole("menuitem");
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    await userEvent.click(within(commandList()!).getByRole("menuitem", { name: /\/probe2/ }));
    expect(ran2).toEqual([""]);
    expect(ran).toEqual([]);
  });

  it("makes the row under the pointer the one Enter runs", async () => {
    await mount("/");
    const field = await openChat();
    await userEvent.type(field, "/probe");
    const second = within(commandList()!).getByRole("menuitem", { name: /\/probe2/ });
    await userEvent.hover(second);
    expect(second).toHaveAttribute("aria-current", "true");
    await userEvent.type(field, "{Enter}");
    expect(ran2).toEqual([""]);
    expect(ran).toEqual([]);
  });

  it("starts no command from a field that does not begin with a slash, and asks the text as it stands", async () => {
    await mount("/");
    const field = await openChat();
    await userEvent.type(field, "where /probe is");
    expect(commandList()).toBeNull();
    await userEvent.type(field, "{Enter}");
    expect(ran).toEqual([]);
    expect(urls).toHaveLength(1);
    expect(sent(0)).toBe("where /probe is");
  });

  it("still asks an ordinary question and an unknown command as text", async () => {
    await mount("/");
    const field = await openChat();
    await userEvent.type(field, "probe something{Enter}");
    expect(sent(0)).toBe("probe something");
    // A question still running holds the next one back: ask the second in a fresh reader.
    cleanup();
    window.localStorage.clear();
    await mount("/");
    await userEvent.type(await openChat(), "/unknown x{Enter}");
    expect(ran).toEqual([]);
    expect(urls.map((_, i) => sent(i))).toEqual(["probe something", "/unknown x"]);
  });

  it("draws no list for a word no command starts with, and every command for a slash alone", async () => {
    await mount("/");
    const field = await openChat();
    await userEvent.type(field, "/zzz");
    expect(commandList()).toBeNull();
    await userEvent.clear(field);
    await userEvent.type(field, "/");
    const all = within(commandList()!).getAllByRole("menuitem");
    expect(all.some((r) => r.textContent?.startsWith("/probe2"))).toBe(true);
    expect(all.some((r) => r.textContent?.startsWith(t("ui.reader.chat-new")))).toBe(true);
  });

  it("closes the list once the whole name is followed by a space, keeps the text, and runs it with what follows", async () => {
    await mount("/");
    const field = await openChat();
    await userEvent.type(field, "/probe ");
    expect(commandList()).toBeNull();
    expect(field).toHaveValue("/probe ");
    await userEvent.type(field, "x{Enter}");
    expect(ran).toEqual(["x"]);
  });

  it("disappears from the next list once the plugin took it back", async () => {
    await mount("/");
    const field = await openChat();
    await userEvent.type(field, "/pro");
    expect(
      within(commandList()!).getByRole("menuitem", { name: /\/probe\b.*Run the probe/ }),
    ).toBeInTheDocument();
    act(() => remove!());
    await userEvent.clear(field);
    await userEvent.type(field, "/pro");
    expect(within(commandList()!).queryByRole("menuitem", { name: /Run the probe$/ })).toBeNull();
    expect(within(commandList()!).getByRole("menuitem", { name: /\/probe2/ })).toBeInTheDocument();
  });

  it("opens the list with a slash typed outside any field", async () => {
    await mount("/");
    fireEvent.keyDown(document.body, { key: "/" });
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const field = screen.getByRole("textbox", {
      name: tt("ui.screens-plugins.chat-question-atlas"),
    });
    expect(field).toHaveValue("/");
    expect(field).toHaveFocus();
    expect(within(commandList()!).getByRole("menuitem", { name: /\/probe2/ })).toBeInTheDocument();
  });

  it("leaves a slash typed into another field to that field", async () => {
    await mount("/");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const search = within(await screen.findByRole("dialog")).getByRole("combobox");
    await userEvent.type(search, "/");
    expect(search).toHaveValue("/");
    expect(
      screen.queryByRole("textbox", { name: tt("ui.screens-plugins.chat-question-atlas") }),
    ).toBeNull();
  });
});

describe("the chat of a reader without plugins", () => {
  it("offers only its own three commands and only its own mode, chosen", async () => {
    withoutPlugins();
    await mount("/");
    const field = await openChat();
    await userEvent.type(field, "/");
    const items = within(commandList()!).getAllByRole("menuitem");
    const own = ["ui.reader.chat-new", "ui.reader.chat-ask", "ui.reader.chat-model"].map((k) =>
      t(k),
    );
    expect(items).toHaveLength(3);
    items.forEach((item, i) => expect(item.textContent?.startsWith(own[i])).toBe(true));
    const modes = within(
      screen.getByRole("radiogroup", { name: tt("ui.screens-plugins.chat-mode") }),
    ).getAllByRole("radio");
    expect(modes).toHaveLength(1);
    expect(modes[0]).toHaveAccessibleName(tt("ui.reader.chat-ask-name"));
    expect(modes[0]).toBeChecked();
  });
});

describe("a plugin's conversation mode", () => {
  it("cannot take the core mode's id: the plain question stays the reader's own", async () => {
    const answers: unknown[] = [];
    install((atlas) => {
      answers.push(atlas.chat.mode("ask", { label: "Hijack", systemPrompt: "EVIL" }));
      atlas.chat.mode("probe-mode", { label: "Probe mode", systemPrompt: "PROBE GUIDANCE" });
    });
    await mount("/");
    expect(answers).toEqual([null]);
    const field = await openChat();
    const picker = screen.getByRole("radiogroup", { name: tt("ui.screens-plugins.chat-mode") });
    expect(within(picker).queryByRole("radio", { name: "Hijack" })).toBeNull();
    expect(
      within(picker).getByRole("radio", { name: tt("ui.reader.chat-ask-name") }),
    ).toBeChecked();
    expect(within(picker).getByRole("radio", { name: "Probe mode" })).not.toBeChecked();
    await userEvent.type(field, "Hi{Enter}");
    expect(sent(0)).toBe("Hi");
  });

  it("sends its guidance with the question but keeps the question as the reader typed it", async () => {
    install((atlas) =>
      atlas.chat.mode("probe-mode", { label: "Probe mode", systemPrompt: "PROBE GUIDANCE" }),
    );
    await mount("/");
    const field = await openChat();
    await userEvent.click(screen.getByRole("radio", { name: "Probe mode" }));
    await userEvent.type(field, "Hi{Enter}");
    expect(sent(0)).toBe("PROBE GUIDANCE\n\nHi");
    expect(screen.getAllByText("Hi").length).toBeGreaterThan(0);
    expect(screen.queryByText(/PROBE GUIDANCE/)).toBeNull();
  });

  it("disappears from the picker once the plugin took it back, and the core mode is chosen again", async () => {
    let remove: (() => void) | null = null;
    install((atlas) => {
      remove = atlas.chat.mode("probe-mode", { label: "Probe mode", systemPrompt: "P" });
    });
    await mount("/");
    await openChat();
    await userEvent.click(screen.getByRole("radio", { name: "Probe mode" }));
    act(() => remove!());
    expect(screen.queryByRole("radio", { name: "Probe mode" })).toBeNull();
    expect(screen.getByRole("radio", { name: tt("ui.reader.chat-ask-name") })).toBeChecked();
  });
});

describe("a plugin's role", () => {
  const coreNames = frame.OVERVIEW_ROLE_KEYS.map((k) => tt(`shell.role.${k}.name` as never));
  const openMenu = async (current: string) =>
    userEvent.click(screen.getByRole("button", { name: current }));

  it("stands after the core's seven with its purpose, and cannot take a core role's id", async () => {
    const answers: unknown[] = [];
    install((atlas) => {
      answers.push(
        atlas.roles.register("dev", { label: "Fake dev", purpose: "x", render: () => null }),
      );
      atlas.roles.register("probe-role", {
        label: "Probe reader",
        purpose: "Reads what the probe shows",
        render: () => null,
      });
    });
    await mount("/");
    expect(answers).toEqual([null]);
    await openMenu(tt("shell.role.dev.name"));
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(coreNames.length + 1);
    coreNames.forEach((name, i) => expect(items[i]).toHaveTextContent(name));
    expect(items[coreNames.length]).toHaveTextContent("Probe reader");
    expect(items[coreNames.length]).toHaveTextContent("Reads what the probe shows");
    expect(screen.queryByRole("menuitemradio", { name: /Fake dev/ })).toBeNull();
  });

  it("is marked as the one being read once chosen, and only it", async () => {
    install((atlas) =>
      atlas.roles.register("probe-role", {
        label: "Probe reader",
        purpose: "p",
        render: () => null,
      }),
    );
    await mount("/");
    await openMenu(tt("shell.role.dev.name"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Probe reader/ }));
    await openMenu("Probe reader");
    const checked = screen
      .getAllByRole("menuitemradio")
      .filter((i) => i.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent("Probe reader");
  });

  it("disappears from the menu once the plugin took it back, and the reader falls back to a core role", async () => {
    let remove: (() => void) | null = null;
    install((atlas) => {
      remove = atlas.roles.register("probe-role", {
        label: "Probe reader",
        purpose: "p",
        render: () => atlas.ui.h("p", null, "Probe overview"),
      });
    });
    await mount("/");
    await openMenu(tt("shell.role.dev.name"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Probe reader/ }));
    expect(screen.getByTestId("plugin-role-overview")).toHaveTextContent("Probe overview");
    act(() => remove!());
    expect(screen.queryByTestId("plugin-role-overview")).toBeNull();
    await openMenu(tt("shell.role.dev.name"));
    expect(screen.queryByRole("menuitemradio", { name: /Probe reader/ })).toBeNull();
  });
});

describe("a plugin's settings page", () => {
  const settingsNav = () =>
    screen.getByRole("navigation", { name: tt("ui.screens-contents.settings-settings") });

  it("stands in the one Plugins group beside every core section, whatever group it named", async () => {
    install((atlas) =>
      atlas.settings.register({
        id: "probe",
        group: "Context",
        title: "Probe settings",
        subtitle: "What the probe keeps",
        render: () => atlas.ui.h("p", null, "Probe settings body"),
      }),
    );
    await mount("/settings");
    for (const s of contents.SETTINGS_SECTIONS)
      expect(
        within(settingsNav()).getByRole("button", {
          name: new RegExp(contents.sectionLabel(s, tt)!),
        }),
      ).toBeInTheDocument();
    const group = screen.getByTestId("settings-plugin-sections");
    await userEvent.click(within(group).getByRole("button", { name: /Probe settings/ }));
    expect(window.location.pathname).toBe("/settings/plugin-probe");
  });

  it("is found by its keywords and not by a word it does not carry", async () => {
    install((atlas) =>
      atlas.settings.register({
        id: "probe",
        group: "Plugins",
        title: "Probe settings",
        subtitle: "x",
        keywords: "zebra",
        render: () => null,
      }),
    );
    await mount("/settings");
    const search = screen.getByRole("searchbox", {
      name: tt("ui.screens-contents.settings-search-settings"),
    });
    await userEvent.type(search, "zebra");
    expect(
      within(screen.getByTestId("settings-plugin-sections")).getByRole("button", {
        name: /Probe settings/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("settings-no-results")).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, "qqqq");
    expect(screen.queryByRole("button", { name: /Probe settings/ })).toBeNull();
  });

  it("disappears from the list once the plugin took it back", async () => {
    let remove: (() => void) | null = null;
    install((atlas) => {
      remove = atlas.settings.register({
        id: "probe",
        group: "Plugins",
        title: "Probe settings",
        subtitle: "x",
        render: () => null,
      });
    });
    await mount("/settings");
    expect(screen.getByRole("button", { name: /Probe settings/ })).toBeInTheDocument();
    act(() => remove!());
    expect(screen.queryByRole("button", { name: /Probe settings/ })).toBeNull();
  });

  it("falls back to the first section at an address no page owns", async () => {
    install(null);
    await mount("/settings/plugin-weg");
    expect(
      within(settingsNav()).getByRole("button", {
        name: new RegExp(contents.sectionLabel(contents.SETTINGS_SECTIONS[0], tt)!),
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("settings-plugin-weg")).toBeNull();
  });

  it("leaves a reader without plugins every core section and no Plugins group", async () => {
    withoutPlugins();
    await mount("/settings");
    for (const s of contents.SETTINGS_SECTIONS)
      expect(
        within(settingsNav()).getByRole("button", {
          name: new RegExp(contents.sectionLabel(s, tt)!),
        }),
      ).toBeInTheDocument();
    expect(screen.queryByTestId("settings-plugin-sections")).toBeNull();
  });
});

describe("a plugin's tile in the catalogue", () => {
  const tile = (atlas: AtlasApi, id: string, group: string) =>
    atlas.tiles.register(id, {
      group,
      label: `Tile ${id}`,
      desc: `What ${id} counts`,
      count: () => numericValue(3),
      items: () => [],
      detail: () => null,
    });
  const coreKinds = async () => {
    const groups = screen
      .getAllByTestId(/^hub-group-/)
      .filter((g) => g.dataset.testid !== "hub-group-Plugins");
    return groups.flatMap((g) =>
      within(g)
        .queryAllByTestId(/^kind-/)
        .map((k) => `${g.dataset.testid}/${k.dataset.testid}`),
    );
  };

  it("stands in the Plugins group with its sentence and counter, whatever group it named, and the core's tiles all stay", async () => {
    withoutPlugins();
    const bare = await mount("/contents");
    const core = await coreKinds();
    expect(core.length).toBeGreaterThan(0);
    expect(screen.queryByTestId("hub-group-Plugins")).toBeNull();
    bare.unmount();
    window.localStorage.clear();
    // A fresh document session: the first one was claimed for a reader without plugins.
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    })) as never;
    install((atlas) => {
      tile(atlas, "known", "Context");
      tile(atlas, "odd", "Invented");
    });
    await mount("/contents");
    expect(await coreKinds()).toEqual(core);
    const plugins = screen.getByTestId("hub-group-Plugins");
    for (const id of ["known", "odd"]) {
      const kind = within(plugins).getByTestId(`kind-${id}`);
      expect(kind).toHaveTextContent(`Tile ${id}`);
      expect(kind).toHaveTextContent(`What ${id} counts`);
      expect(kind).toHaveTextContent("3");
    }
  });

  it("disappears from the catalogue once the plugin took it back; the core tiles stay", async () => {
    let remove: (() => void) | null = null;
    install((atlas) => {
      remove = tile(atlas, "probe", "Context");
    });
    await mount("/contents");
    expect(screen.getByTestId("kind-probe")).toBeInTheDocument();
    act(() => remove!());
    expect(screen.queryByTestId("kind-probe")).toBeNull();
    expect(screen.getByTestId("kind-wiki")).toBeInTheDocument();
    expect(screen.getByTestId("kind-promises")).toBeInTheDocument();
  });
});
