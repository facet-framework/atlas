/** The plugin host as the reader meets it: one probe plugin, loaded
 * the way an installed plugin is, contributes to every part of the plugin
 * interface, and each case looks where the contribution has to land in the
 * rendered reader — the top bar, the slash list, the settings, the catalogue,
 * the palette, the role choice, the mode picker and the panels — never at a
 * value the host returned. */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentStream } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { derive } from "@/derive";
import { numericValue } from "@/contents/catalogue";
import {
  fetchInstalledPlugins,
  fetchPluginCapabilities,
  resolveInstalledPlugins,
} from "@/plugin/installed";
import type { PluginEntry } from "@/plugin/api";
import { OFFICIAL_PLUGINS } from "@/plugin/official";
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
const RECORD = derive(model).M.find((f) => f.scen.length)!;
const SCENARIO = RECORD.scen[0].id;

/** What the probe's renderers drew, so a case can find it inside its closed shadow root. */
const drawn = new Map<string, HTMLElement>();
const ran: string[] = [];

const listing = {
  id: "probe",
  name: "Probe",
  version: "0.1.0",
  api: 0,
  entry: "/plugins/probe/plugin.js",
  areas: ["probe"],
  slots: [],
  dev: false,
  verification: "ok" as const,
};

const probe: PluginEntry = (atlas) => {
  const { h } = atlas.ui;
  for (const slot of [
    "header.action",
    "surface.section",
    "record.panel",
    "scenario.panel",
  ] as const)
    atlas.slots.mount(slot, (root, place) => {
      const el = document.createElement("button");
      el.textContent = `probe ${slot} ${place.fid ?? ""} ${place.sid ?? ""}`.trim();
      root.appendChild(el);
      drawn.set(`${slot}:${place.fid ?? ""}:${place.sid ?? ""}`, el);
    });
  atlas.areas.register("probe", ({ state }) => h("h1", null, `Probe area ${String(state)}`), {
    initial: (arg) => arg || "front",
    place: (s) => s,
  });
  atlas.commands.register({
    command: "/probe",
    argument: "what",
    purpose: "Run the probe",
    group: "Probe",
    run: (arg) => ran.push(arg),
  });
  atlas.settings.register({
    id: "probe",
    group: "Plugins",
    title: "Probe settings",
    subtitle: "What the probe keeps",
    render: () => h("p", null, "Probe settings body"),
  });
  atlas.tiles.register("probe", {
    group: "Context",
    label: "Probe tile",
    desc: "What the probe counts",
    count: () => numericValue(3),
    items: () => [{ id: "a", t: "alpha", s: "first", raw: "A" }],
    detail: (raw) => h("p", null, `Probe detail ${String(raw)}`),
  });
  atlas.search.register("probe", {
    label: "Probe hits",
    singular: "Probe hit",
    glyph: "*",
    tone: "ink",
    hits: () => [
      {
        title: "Probe hit one",
        sub: "found",
        tag: "",
        open: () => atlas.verbs.openArea("probe", "hit"),
      },
    ],
  });
  atlas.roles.register("probe-role", {
    label: "Probe reader",
    purpose: "Reads what the probe shows",
    render: () => h("p", null, "Probe overview"),
  });
  atlas.chat.mode("probe-mode", { label: "Probe mode", systemPrompt: "PROBE GUIDANCE" });
};

beforeEach(() => {
  jest.clearAllMocks();
  drawn.clear();
  ran.length = 0;
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as never;
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  window.matchMedia = realMatchMedia;
  jest.mocked(fetchInstalledPlugins).mockResolvedValue([listing]);
  jest.mocked(fetchPluginCapabilities).mockResolvedValue({ probe: "capability" });
  jest.mocked(resolveInstalledPlugins).mockResolvedValue({
    loaded: [{ id: "probe", entry: probe }],
    states: [{ status: "loaded", listing }],
  });
});

async function mount(path: string, open?: (url: string) => AgentStream) {
  window.history.replaceState(null, "", path);
  const view = render(<Atlas model={model} readers={null} openStream={open} />);
  // The installed plugin loads after the first paint, once the session's capability is known.
  await act(async () => undefined);
  await act(async () => undefined);
  return view;
}

/** The light-DOM holder the host made for the probe inside `container`. */
function holderIn(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-facet-plugin="probe"]');
}

describe("the plugin host", () => {
  it("loads the bundled plugins' entries and lists them in the navigation", async () => {
    await mount("/");
    const nav = screen.getByRole("navigation", { name: tt("shell.nav.label") });
    for (const p of OFFICIAL_PLUGINS)
      expect(
        within(nav).getByRole("button", { name: new RegExp(tt(p.nav!.label)) }),
      ).toBeInTheDocument();
    expect(fetchPluginCapabilities).toHaveBeenCalledWith(
      [...OFFICIAL_PLUGINS.map((p) => p.id), "probe"],
      global.fetch,
    );
  });

  it("draws a plugin's header action inside the top bar", async () => {
    await mount("/");
    const actions = screen.getByTestId("top-actions");
    expect(actions.closest(".t-shell__head")).not.toBeNull();
    const holder = holderIn(actions);
    expect(holder).not.toBeNull();
    // What the plugin drew sits in that holder's shadow root.
    expect((drawn.get("header.action::")?.getRootNode() as ShadowRoot).host).toBe(holder);
  });

  it("moves the header action into the More sheet on a phone", async () => {
    window.matchMedia = ((query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    await mount("/");
    expect(screen.queryByTestId("top-actions")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: tt("shell.tab.more") }));
    expect(holderIn(screen.getByTestId("more-actions"))).not.toBeNull();
  });

  it("lists a plugin's command in the chat's slash list and runs it with an argument", async () => {
    const urls: string[] = [];
    await mount("/", (url) => {
      urls.push(url);
      return { addEventListener: () => undefined, close: () => undefined };
    });
    await userEvent.click(
      screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) })[0],
    );
    const field = screen.getByRole("textbox", {
      name: tt("ui.screens-plugins.chat-question-atlas"),
    });
    await userEvent.type(field, "/pro");
    const list = screen.getByRole("menu", { name: tt("ui.screens-plugins.chat-commands") });
    expect(within(list).getByRole("menuitem", { name: /\/probe/ })).toHaveTextContent(
      "Run the probe",
    );
    await userEvent.clear(field);
    await userEvent.type(field, "/probe something{Enter}");
    expect(ran).toEqual(["something"]);
    expect(urls).toEqual([]);
  });

  it("lists a plugin's settings page in the group Plugins and opens it at its address", async () => {
    await mount("/settings");
    const group = screen.getByTestId("settings-plugin-sections");
    // The bundled plugins' pages stand there too.
    expect(within(group).getByRole("button", { name: /Decisions/ })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: /Probe settings/ }));
    expect(window.location.pathname).toBe("/settings/plugin-probe");
    expect(screen.getByTestId("settings-plugin-probe")).toHaveTextContent("Probe settings body");
  });

  it("draws a plugin's tile in the catalogue and opens its list and detail", async () => {
    await mount("/contents");
    const tile = within(screen.getByTestId("hub-group-Plugins")).getByTestId("kind-probe");
    expect(tile).toHaveTextContent("Probe tile");
    expect(tile).toHaveTextContent("3");
    await userEvent.click(within(tile).getByRole("button", { name: /Probe tile/ }));
    expect(window.location.pathname).toBe("/contents/probe");
    await userEvent.click(screen.getByRole("button", { name: /alpha/ }));
    expect(screen.getByTestId("plugin-tile-detail")).toHaveTextContent("Probe detail A");
  });

  it("feeds a plugin's search source into the palette and runs the picked hit", async () => {
    await mount("/");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("combobox"), "Probe hit");
    expect(within(dialog).getByText("Probe hits")).toBeInTheDocument();
    // The query is highlighted inside the title, so the row is found by its whole text.
    await userEvent.click(within(dialog).getByRole("option", { name: /Probe hit one/ }));
    expect(window.location.pathname).toBe("/p/probe/hit");
    expect(await screen.findByRole("heading", { name: "Probe area hit" })).toBeInTheDocument();
  });

  it("draws a plugin's hits under its heading with its own mark, and runs one after the palette closed", async () => {
    await mount("/");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("combobox"), "Probe hit");
    const row = within(dialog).getByRole("option", { name: /Probe hit one/ });
    const mark = within(row).getByTestId("palette-kind-mark");
    expect(mark).toHaveTextContent("*");
    expect(mark).toHaveAttribute("title", "Probe hit");
    expect(row).toHaveAccessibleDescription("Probe hit");
    await userEvent.click(row);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Probe area hit" })).toBeInTheDocument();
  });

  it("offers a plugin's role and draws its overview", async () => {
    await mount("/");
    await userEvent.click(screen.getByRole("button", { name: tt("shell.role.dev.name") }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Probe reader/ }));
    expect(screen.getByTestId("plugin-role-overview")).toHaveTextContent("Probe overview");
  });

  it("offers a plugin's mode and folds its guidance into the question", async () => {
    const urls: string[] = [];
    await mount("/", (url) => {
      urls.push(url);
      return { addEventListener: () => undefined, close: () => undefined };
    });
    await userEvent.click(
      screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) })[0],
    );
    await userEvent.click(screen.getByRole("radio", { name: "Probe mode" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: tt("ui.screens-plugins.chat-question-atlas") }),
      "Hi{Enter}",
    );
    const sent = new URL(urls[0], "http://host").searchParams;
    expect(sent.get("q")).toBe("PROBE GUIDANCE\n\nHi");
    expect(sent.has("mode")).toBe(false);
  });

  it("draws the panels on the overview, the record and the scenario, and nowhere else", async () => {
    const view = await mount("/");
    expect(holderIn(screen.getByTestId("plugin-slot-surface.section"))).not.toBeNull();
    expect(screen.queryByTestId("plugin-slot-record.panel")).not.toBeInTheDocument();
    view.unmount();
    const record = await mount(`/record/${RECORD.id}`);
    expect(holderIn(screen.getByTestId("plugin-slot-record.panel"))).not.toBeNull();
    expect(drawn.get(`record.panel:${RECORD.id}:`)).toBeDefined();
    expect(screen.queryByTestId("plugin-slot-scenario.panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plugin-slot-surface.section")).not.toBeInTheDocument();
    record.unmount();
    await mount(`/record/${RECORD.id}/-/${SCENARIO}`);
    expect(holderIn(screen.getByTestId("plugin-slot-scenario.panel"))).not.toBeNull();
    expect(drawn.get(`scenario.panel:${RECORD.id}:${SCENARIO}`)).toBeDefined();
  });
});

/** Loads `entries` as installed plugins, each listed and verified. */
function install(entries: Record<string, PluginEntry>) {
  const listings = Object.keys(entries).map((id) => ({
    ...listing,
    id,
    entry: `/plugins/${id}/plugin.js`,
    areas: [id],
  }));
  jest.mocked(fetchInstalledPlugins).mockResolvedValue(listings);
  jest
    .mocked(fetchPluginCapabilities)
    .mockResolvedValue(Object.fromEntries(listings.map((l) => [l.id, "capability"])));
  jest.mocked(resolveInstalledPlugins).mockImplementation(async (items) => ({
    loaded: items.map((l) => ({ id: l.id, entry: entries[l.id] })),
    states: items.map((l) => ({ status: "loaded" as const, listing: l })),
  }));
}

describe("a plugin that throws loses only its own contribution", () => {
  it("names an installed entry that throws at its place, and still loads the next plugin", async () => {
    install({
      boom: () => {
        throw new Error("entry exploded");
      },
      probe,
    });
    await mount("/p/boom");
    expect(screen.getByRole("alert")).toHaveTextContent("Plugin failed to load: entry exploded");
    // The plugin after it was loaded: its header action stands in the top bar.
    expect(holderIn(screen.getByTestId("top-actions"))).not.toBeNull();
  });

  it("keeps the catalogue when a tile's count throws, and reads that tile as unmeasured", async () => {
    install({
      probe: (atlas) => {
        atlas.tiles.register("probe", {
          group: "Context",
          label: "Probe tile",
          desc: "What the probe counts",
          count: () => {
            throw new Error("count exploded");
          },
          items: () => {
            throw new Error("items exploded");
          },
          detail: () => null,
        });
      },
    });
    await mount("/contents");
    const tile = within(screen.getByTestId("hub-group-Plugins")).getByTestId("kind-probe");
    expect(tile).toHaveTextContent("Probe tile");
    expect(tile).not.toHaveTextContent(/\d/);
    // The core's own groups are still drawn beside it.
    expect(screen.getAllByTestId(/^hub-group-/).length).toBeGreaterThan(1);
    await userEvent.click(within(tile).getByRole("button", { name: /Probe tile/ }));
    expect(screen.getByTestId("plugin-tile-probe")).toHaveTextContent("Probe tile");
  });

  it("keeps the palette working when a hit has no sub and another source throws", async () => {
    install({
      probe: (atlas) => {
        atlas.search.register("broken", {
          label: "Broken hits",
          singular: "Broken hit",
          glyph: "*",
          tone: "ink",
          hits: () => {
            throw new Error("hits exploded");
          },
        });
        atlas.search.register("probe", {
          label: "Probe hits",
          singular: "Probe hit",
          glyph: "*",
          tone: "ink",
          hits: () =>
            [
              { title: "Probe hit bare", tag: "", open: () => atlas.verbs.openArea("probe", "x") },
            ] as never,
        });
        atlas.areas.register(
          "probe",
          ({ state }) => atlas.ui.h("h1", null, `Probe area ${String(state)}`),
          {
            initial: (arg) => arg || "front",
            place: (s) => s,
          },
        );
      },
    });
    await mount("/");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("combobox"), "Probe");
    expect(within(dialog).queryByText("Broken hits")).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("option", { name: /Probe hit bare/ }));
    expect(await screen.findByRole("heading", { name: "Probe area x" })).toBeInTheDocument();
  });

  it("draws the rest of a slot when one plugin's renderer throws", async () => {
    install({
      boom: (atlas) =>
        atlas.slots.mount("header.action", () => {
          throw new Error("slot exploded");
        }),
      probe,
    });
    await mount("/");
    const actions = screen.getByTestId("top-actions");
    expect(actions.querySelector('[data-facet-plugin="boom"]')).toHaveAttribute(
      "data-facet-failed",
      "slot exploded",
    );
    expect(holderIn(actions)).not.toBeNull();
  });

  it("states a role overview that throws where the overview stands", async () => {
    install({
      probe: (atlas) =>
        atlas.roles.register("probe-role", {
          label: "Probe reader",
          purpose: "Reads what the probe shows",
          render: () => {
            throw new Error("role exploded");
          },
        }),
    });
    await mount("/");
    await userEvent.click(screen.getByRole("button", { name: tt("shell.role.dev.name") }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Probe reader/ }));
    expect(screen.getByTestId("plugin-role-overview")).toHaveTextContent("role exploded");
    // The shell around it is still the reader's.
    expect(screen.getByRole("navigation", { name: tt("shell.nav.label") })).toBeInTheDocument();
  });
});

describe("what an installed plugin cannot take from the reader", () => {
  it("does not load an installed plugin that carries a bundled id; the bundled one stays", async () => {
    let installedRan = false;
    install({
      adr: () => {
        installedRan = true;
      },
    });
    await mount("/");
    expect(installedRan).toBe(false);
    // The installed listing was never handed to the loader.
    expect(resolveInstalledPlugins).not.toHaveBeenCalled();
    const nav = screen.getByRole("navigation", { name: tt("shell.nav.label") });
    expect(within(nav).getByRole("button", { name: /Decisions/ })).toBeInTheDocument();
  });

  it("keeps a chat command's name: a plugin command with the same name is left out", async () => {
    const own = t("ui.reader.chat-new");
    let pluginRan = false;
    install({
      probe: (atlas) =>
        atlas.commands.register({
          command: own,
          purpose: "Probe takes the name",
          group: "Probe",
          run: () => {
            pluginRan = true;
          },
        }),
    });
    await mount("/");
    await userEvent.click(
      screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) })[0],
    );
    const field = screen.getByRole("textbox", {
      name: tt("ui.screens-plugins.chat-question-atlas"),
    });
    await userEvent.type(field, own);
    const list = screen.getByRole("menu", { name: tt("ui.screens-plugins.chat-commands") });
    expect(within(list).getAllByRole("menuitem", { name: new RegExp(own) })).toHaveLength(1);
    expect(within(list).queryByText("Probe takes the name")).not.toBeInTheDocument();
    await userEvent.type(field, "{Enter}");
    expect(pluginRan).toBe(false);
  });
});
