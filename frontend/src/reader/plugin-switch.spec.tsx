/** Switching a plugin off, as the reader meets it : the plugins page
 * names every plugin with its state, a switch stores the choice in browser state,
 * and a switched-off plugin is never loaded — its commands, doors, pages and
 * the places it was seen in go with it. Each case reads the rendered reader
 * and the browser storage, never a value the host returned. */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import {
  fetchInstalledPlugins,
  fetchPluginCapabilities,
  resolveInstalledPlugins,
  type InstalledPluginListing,
} from "@/plugin/installed";
import type { PluginEntry } from "@/plugin/api";
import { OFFICIAL_PLUGINS } from "@/plugin/official";
import { SEEN_KEY } from "@/plugin/seen";
import { STORAGE_KEY } from "@/state";
import type { HostReaders } from "./host";
import { atlasT, uiT } from "./testing";
import { reloadDocument } from "./reload";

jest.mock("./reload", () => ({ reloadDocument: jest.fn() }));

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

let entryRuns = 0;

const listing: InstalledPluginListing = {
  id: "probe",
  name: "Probe",
  version: "0.1.0",
  api: 0,
  entry: "/plugins/probe/plugin.js",
  areas: ["probe"],
  slots: ["header.action"],
  dev: false,
  where: "~/plugins/probe",
  verification: "ok",
};

const probe: PluginEntry = (atlas) => {
  entryRuns++;
  atlas.slots.mount("header.action", (root) => {
    const el = document.createElement("button");
    el.textContent = "probe door";
    root.appendChild(el);
  });
  atlas.commands.register({
    command: "/probe",
    purpose: "Run the probe",
    group: "Probe",
    run: () => undefined,
  });
  atlas.settings.register({
    id: "probe",
    group: "Plugins",
    title: "Probe settings",
    subtitle: "What the probe keeps",
    render: () => atlas.ui.h("p", null, "Probe settings body"),
  });
};

/** The installed listing `/api/plugins` answers, each verified one loading `entries[id]`. */
function install(listings: InstalledPluginListing[], entries: Record<string, PluginEntry>) {
  jest.mocked(fetchInstalledPlugins).mockResolvedValue(listings);
  jest
    .mocked(fetchPluginCapabilities)
    .mockResolvedValue(Object.fromEntries(listings.map((l) => [l.id, `cap-${l.id}`])));
  jest.mocked(resolveInstalledPlugins).mockImplementation(async (items) => ({
    loaded: items.filter((l) => entries[l.id]).map((l) => ({ id: l.id, entry: entries[l.id] })),
    states: items.map((l) => ({ status: "loaded" as const, listing: l })),
  }));
}

const readers: HostReaders = {
  repo: () => new Promise(() => undefined),
  agent: async () => null,
  tools: () => new Promise(() => undefined),
  installed: () => fetchInstalledPlugins(),
};

function storeOff(ids: string[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ pluginsOff: ids }));
}

function storedOff(): unknown {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").pluginsOff;
}

beforeEach(() => {
  jest.clearAllMocks();
  entryRuns = 0;
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as never;
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  window.matchMedia = realMatchMedia;
  install([listing], { probe });
});

async function mount(path: string) {
  window.history.replaceState(null, "", path);
  const view = render(<Atlas model={model} readers={readers} />);
  // The installed plugins load after the first paint, once the session's capability is known.
  await act(async () => undefined);
  await act(async () => undefined);
  return view;
}

const PLUGIN_COMMANDS = ["/adr", "/bpmn", "/probe"];

it("omits related decisions while the decisions plugin is switched off", async () => {
  expect(model.decisionTargets.length).toBeGreaterThan(0);
  storeOff(["adr"]);
  await mount("/");
  await userEvent.click(screen.getByRole("button", { name: "Developer" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /Leadership/ }));
  expect(screen.queryByText("Related decisions")).not.toBeInTheDocument();
});

/** The plugin commands the chat's slash list offers, in their order. */
async function slashCommands(): Promise<string[]> {
  await userEvent.click(
    screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) })[0],
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: tt("ui.screens-plugins.chat-question-atlas") }),
    "/",
  );
  const list = screen.getByRole("menu", { name: tt("ui.screens-plugins.chat-commands") });
  return within(list)
    .getAllByRole("menuitem")
    .map((item) => PLUGIN_COMMANDS.find((c) => item.textContent?.startsWith(c)))
    .filter((c): c is string => !!c);
}

const nav = () => screen.getByRole("navigation", { name: tt("shell.nav.label") });
const label = (id: string) => tt(OFFICIAL_PLUGINS.find((p) => p.id === id)!.nav!.label);

/** A plugin's row on the plugins page, found by the button carrying its name. */
function rowOf(name: string): HTMLElement {
  const list = screen.getByRole("list", { name: "Plugins" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((li) => within(li).queryByRole("button", { name }));
  if (!row) throw new Error(`no plugin row named ${name}`);
  return row;
}

describe("a plugin the reader switched off", () => {
  it("is never loaded: its entry does not run, its module is not imported, its commands and doors are absent", async () => {
    // Precondition: on, the probe runs and its command and door are there.
    const on = await mount("/");
    expect(entryRuns).toBe(1);
    expect(
      screen.getByTestId("top-actions").querySelector('[data-facet-plugin="probe"]'),
    ).not.toBeNull();
    expect(await slashCommands()).toContain("/probe");
    on.unmount();

    entryRuns = 0;
    jest.mocked(resolveInstalledPlugins).mockClear();
    storeOff(["probe", "adr"]);
    await mount("/");
    expect(entryRuns).toBe(0);
    for (const [items] of jest.mocked(resolveInstalledPlugins).mock.calls)
      expect(items.map((l) => l.id)).not.toContain("probe");
    const commands = await slashCommands();
    expect(commands).not.toContain("/probe");
    expect(commands).not.toContain("/adr");
    expect(within(nav()).queryByRole("button", { name: new RegExp(label("adr")) })).toBeNull();
    expect(
      within(nav()).getByRole("button", { name: new RegExp(label("bpmn")) }),
    ).toBeInTheDocument();
  });

  it("takes its door out of the top bar and leaves no empty holder behind", async () => {
    const on = await mount("/");
    expect(screen.getByTestId("plugin-slot-header.action")).toBeInTheDocument();
    on.unmount();
    storeOff(["probe"]);
    await mount("/");
    // No plugin draws a door, so the bar carries no actions group and no holder.
    expect(document.querySelector("[data-facet-plugin]")).toBeNull();
    expect(screen.queryByTestId("plugin-slot-header.action")).not.toBeInTheDocument();
  });

  it("keeps the catalogue's order for the plugins that still run, whatever order the choice was stored in", async () => {
    storeOff(["gone", "adr"]);
    await mount("/");
    expect(await slashCommands()).toEqual(["/bpmn", "/probe"]);
  });

  it("ignores a remembered id that names no plugin, and every plugin still runs", async () => {
    storeOff(["gone"]);
    await mount("/");
    expect(entryRuns).toBe(1);
    expect(await slashCommands()).toEqual(PLUGIN_COMMANDS);
  });
});

describe("the plugins page", () => {
  it("names every bundled plugin with a switch that shows it on, and a switch off is stored and acts", async () => {
    await mount("/settings/plugins");
    for (const p of OFFICIAL_PLUGINS)
      expect(
        within(rowOf(label(p.id))).getByRole("switch", {
          name: tt("ui.screens-contents.settings-switch-name", { name: label(p.id) }),
        }),
      ).toBeChecked();
    await userEvent.click(
      within(rowOf(label("bpmn"))).getByRole("switch", {
        name: tt("ui.screens-contents.settings-switch-name", { name: label("bpmn") }),
      }),
    );
    expect(storedOff()).toEqual(["bpmn"]);
    expect(within(rowOf(label("bpmn"))).getByRole("switch")).not.toBeChecked();
    expect(within(nav()).queryByRole("button", { name: new RegExp(label("bpmn")) })).toBeNull();
    // Back on: the id leaves the stored set and the bpmn is there again.
    await userEvent.click(within(rowOf(label("bpmn"))).getByRole("switch"));
    expect(storedOff()).toEqual([]);
    expect(
      within(nav()).getByRole("button", { name: new RegExp(label("bpmn")) }),
    ).toBeInTheDocument();
  });

  it("keeps a switched-off plugin off after the reader is opened again", async () => {
    const first = await mount("/settings/plugins");
    await userEvent.click(within(rowOf(label("adr"))).getByRole("switch"));
    first.unmount();
    await mount("/settings/plugins");
    expect(within(rowOf(label("adr"))).getByRole("switch")).not.toBeChecked();
    expect(within(nav()).queryByRole("button", { name: new RegExp(label("adr")) })).toBeNull();
  });

  it("gives a loaded installed plugin the same switch, storing its id, and none to one that never loaded", async () => {
    const mismatch = {
      ...listing,
      id: "bent",
      name: "Bent",
      verification: "checksum-mismatch" as const,
    };
    install([listing, mismatch], { probe });
    await mount("/settings/plugins");
    const sw = within(rowOf("Probe")).getByRole("switch", {
      name: tt("ui.screens-contents.settings-switch-name", { name: "Probe" }),
    });
    expect(sw).toBeChecked();
    expect(within(rowOf("Bent")).queryByRole("switch")).not.toBeInTheDocument();
    await userEvent.click(sw);
    expect(storedOff()).toEqual(["probe"]);
    expect(document.querySelector('[data-facet-plugin="probe"]')).toBeNull();
  });

  it("names the command that removes an installed plugin, with its own id, and none on a bundled row", async () => {
    await mount("/settings/plugins");
    expect(within(rowOf("Probe")).getByTestId("plugin-remove-probe")).toHaveTextContent(
      "facet plugin remove probe",
    );
    for (const p of OFFICIAL_PLUGINS)
      expect(within(rowOf(label(p.id))).queryByText(/facet plugin remove/)).not.toBeInTheDocument();
  });

  it("shows installed plugins after the catalogue with version and origin, and marks a dev install without a failure line", async () => {
    const dev = {
      ...listing,
      id: "draft",
      name: "Draft",
      version: "0.0.1",
      dev: true,
      where: "~/src/draft",
    };
    install([listing, dev], { probe, draft: () => undefined });
    await mount("/settings/plugins");
    const rows = within(screen.getByRole("list", { name: "Plugins" })).getAllByRole("listitem");
    expect(rows).toHaveLength(OFFICIAL_PLUGINS.length + 2);
    expect(rows[OFFICIAL_PLUGINS.length]).toBe(rowOf("Probe"));
    expect(rowOf("Probe")).toHaveTextContent("probe · 0.1.0");
    expect(rowOf("Probe")).toHaveTextContent("~/plugins/probe");
    expect(rowOf("Probe")).toHaveTextContent(tt("ui.screens-contents.settings-installed"));
    expect(rowOf("Draft")).toHaveTextContent("draft · 0.0.1");
    expect(rowOf("Draft")).toHaveTextContent("~/src/draft");
    expect(rowOf("Draft")).toHaveTextContent(tt("ui.screens-contents.settings-development"));
    expect(within(rowOf("Draft")).queryByTestId("plugin-reason-draft")).not.toBeInTheDocument();
    expect(rowOf("Probe")).not.toHaveTextContent(tt("ui.screens-contents.settings-development"));
  });

  it("names why each refused plugin did not load on its own row, and the loaded rows still stand", async () => {
    const api = { ...listing, id: "old", name: "Old", verification: "api-unsupported" as const };
    const bent = {
      ...listing,
      id: "bent",
      name: "Bent",
      verification: "checksum-mismatch" as const,
    };
    const clash = { ...listing, id: "bpmn", name: "BPMN copy" };
    install([api, bent, clash, listing], { probe });
    await mount("/settings/plugins");
    expect(within(rowOf("Old")).getByTestId("plugin-reason-old")).toHaveTextContent(
      "api-unsupported",
    );
    expect(within(rowOf("Bent")).getByTestId("plugin-reason-bent")).toHaveTextContent(
      "checksum-mismatch",
    );
    expect(within(rowOf("BPMN copy")).getByTestId("plugin-reason-bpmn")).toHaveTextContent(
      "bundled-id-collision",
    );
    expect(within(rowOf("Probe")).queryByTestId("plugin-reason-probe")).not.toBeInTheDocument();
    expect(within(rowOf("Probe")).getByRole("switch")).toBeChecked();
    for (const p of OFFICIAL_PLUGINS) expect(rowOf(label(p.id))).toBeInTheDocument();
  });

  it("is found by what a reader would type rather than its title", async () => {
    await mount("/settings");
    const search = screen.getByRole("searchbox", {
      name: tt("ui.screens-contents.settings-search-settings"),
    });
    const settingsNav = screen.getByRole("navigation", {
      name: tt("ui.screens-contents.settings-settings"),
    });
    // The plugins section's entry, named with its subtitle.
    const plugins = () =>
      within(settingsNav).queryByRole("button", {
        name: new RegExp(tt("ui.screens-contents.settings-installed-checksum-grants")),
      });
    for (const word of ["bpmn", "extension", "switch", "Probe"]) {
      await userEvent.clear(search);
      await userEvent.type(search, word);
      expect(plugins()).not.toBeNull();
    }
    await userEvent.clear(search);
    await userEvent.type(search, "zzqx");
    expect(screen.getByTestId("settings-no-results")).toBeInTheDocument();
    expect(plugins()).toBeNull();
  });
});

describe("a plugin switched off after it ran", () => {
  const OFF_FROM_NEXT_LOAD = t("ui.reader-pages.settings-off-next-load");

  it("says off from the next load on its own row, bundled and installed alike, and nowhere else", async () => {
    await mount("/settings/plugins");
    // Precondition: both ran in this document, and no row carries the state yet.
    expect(entryRuns).toBe(1);
    expect(screen.queryByTestId("plugin-reason-bpmn")).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^plugin-reload-/)).not.toBeInTheDocument();
    await userEvent.click(within(rowOf(label("bpmn"))).getByRole("switch"));
    await userEvent.click(within(rowOf("Probe")).getByRole("switch"));
    expect(within(rowOf(label("bpmn"))).getByTestId("plugin-reason-bpmn")).toHaveTextContent(
      OFF_FROM_NEXT_LOAD,
    );
    expect(within(rowOf("Probe")).getByTestId("plugin-reason-probe")).toHaveTextContent(
      OFF_FROM_NEXT_LOAD,
    );
    expect(within(rowOf(label("adr"))).queryByText(OFF_FROM_NEXT_LOAD)).not.toBeInTheDocument();
    // Back on: the plugin draws again, and the row drops the state.
    await userEvent.click(within(rowOf(label("bpmn"))).getByRole("switch"));
    expect(within(rowOf(label("bpmn"))).queryByText(OFF_FROM_NEXT_LOAD)).not.toBeInTheDocument();
  });

  it("offers a reload that loads the document again", async () => {
    await mount("/settings/plugins");
    await userEvent.click(within(rowOf(label("adr"))).getByRole("switch"));
    // The action stands on the row of the plugin that was switched off, and only there.
    expect(
      within(rowOf(label("bpmn"))).queryByTestId("plugin-reload-bpmn"),
    ).not.toBeInTheDocument();
    const reload = within(within(rowOf(label("adr"))).getByTestId("plugin-reload-adr")).getByRole(
      "button",
      {
        name: t("ui.screens-contents.settings-reload-now"),
      },
    );
    expect(reloadDocument).not.toHaveBeenCalled();
    await userEvent.click(reload);
    expect(reloadDocument).toHaveBeenCalledTimes(1);
  });

  it("is plainly off, with no reload offered, when it was off from the start", async () => {
    storeOff(["bpmn", "probe"]);
    await mount("/settings/plugins");
    // Precondition: the rows are there and switched off.
    expect(within(rowOf(label("bpmn"))).getByRole("switch")).not.toBeChecked();
    expect(within(rowOf("Probe")).getByRole("switch")).not.toBeChecked();
    expect(screen.queryByText(OFF_FROM_NEXT_LOAD)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^plugin-reload-/)).not.toBeInTheDocument();
  });
});

describe("the dot on a settings page nobody opened", () => {
  it("stands on the gear and on the page's entry until the page is opened", async () => {
    await mount("/settings");
    const gear = () => screen.queryByTestId("settings-fresh");
    expect(gear()).toHaveAccessibleName(tt("shell.top.settingsNew"));
    const group = screen.getByTestId("settings-plugin-sections");
    const entry = within(group).getByRole("button", { name: /Probe settings/ });
    expect(
      within(entry).getByRole("img", {
        name: tt("ui.screens-contents.settings-new-settings-page"),
      }),
    ).toBeInTheDocument();
    await userEvent.click(entry);
    expect(screen.queryByTestId("settings-fresh-plugin-probe")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(SEEN_KEY)!)).toContain("probe:settings.probe");
    // The bundled plugins' pages are still unopened, so the gear keeps its dot.
    expect(gear()).not.toBeNull();
    for (const b of within(screen.getByTestId("settings-plugin-sections")).getAllByRole("button"))
      if (within(b).queryByRole("img")) await userEvent.click(b);
    expect(gear()).toBeNull();
  });

  it("comes back for a plugin that was switched off and on again", async () => {
    window.localStorage.setItem(
      SEEN_KEY,
      JSON.stringify(["adr:settings.adr", "probe:header.action", "bpmn:settings.bpmn"]),
    );
    storeOff(["adr"]);
    await mount("/");
    const seen = JSON.parse(window.localStorage.getItem(SEEN_KEY)!);
    expect(seen).not.toContain("adr:settings.adr");
    expect(seen).toEqual(expect.arrayContaining(["probe:header.action", "bpmn:settings.bpmn"]));
  });
});

describe("the glow beside a plugin's door", () => {
  it("stands beside a door nobody has used, and goes out and is remembered once it is used", async () => {
    await mount("/");
    const actions = screen.getByTestId("top-actions");
    expect(within(actions).getByTestId("slot-glow-probe:header.action")).toBeInTheDocument();
    fireEvent.click(actions.querySelector('[data-facet-plugin="probe"]')!);
    expect(within(actions).queryByTestId("slot-glow-probe:header.action")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SEEN_KEY)!)).toContain("probe:header.action");
  });
});
