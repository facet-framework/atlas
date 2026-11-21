/** A plugin's theme in the reader: offered on Settings › Appearance as
 * two cards beside FACET and Paper, put on the root and kept when chosen,
 * drawn as FACET while its plugin is off or gone, and refused with its reason
 * on the plugins page when it uses an unknown token. Each case reads
 * the rendered reader, the root's attributes or the stored choice. */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { STORAGE_KEY } from "@/state";
import { THEME_KEY } from "./useAtlas";
import type { HostReaders } from "./host";
import { uiT } from "./testing";

jest.mock("@/plugin/installed", () => ({
  ...jest.requireActual("@/plugin/installed"),
  fetchInstalledPlugins: jest.fn(),
  fetchPluginCapabilities: jest.fn(),
  resolveInstalledPlugins: jest.fn(),
}));

const model = taskflowModel();
const tt = uiT("en");
const root = document.documentElement;

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

const OCEAN: PluginEntry = (atlas) => {
  atlas.theme.contribute("ocean", {
    label: "Ocean",
    light: { "--t-ground": "#e6f4f1" },
    dark: { "--t-ground": "#06222a" },
  });
};

/** Loads `entry` as the installed plugin "probe"; none when `entry` is null. */
function install(entry: PluginEntry | null) {
  jest.mocked(fetchInstalledPlugins).mockResolvedValue(entry ? [listing] : []);
  jest.mocked(fetchPluginCapabilities).mockResolvedValue(entry ? { probe: "cap" } : {});
  jest.mocked(resolveInstalledPlugins).mockImplementation(async (items) => ({
    loaded: entry ? items.map((l) => ({ id: l.id, entry })) : [],
    states: items.map((l) => ({ status: "loaded" as const, listing: l })),
  }));
}

const proto = CSSStyleSheet.prototype as unknown as Record<string, unknown>;
/** The document can adopt a constructed sheet, as Chromium's can. */
function adoptable() {
  proto.replaceSync = function () {};
  let sheets: CSSStyleSheet[] = [];
  Object.defineProperty(document, "adoptedStyleSheets", {
    configurable: true,
    get: () => sheets,
    set: (next: CSSStyleSheet[]) => (sheets = next),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as never;
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  root.removeAttribute("data-t-theme");
  root.removeAttribute("data-t-mode");
});

afterEach(() => {
  cleanup();
  delete proto.replaceSync;
  delete (document as unknown as Record<string, unknown>).adoptedStyleSheets;
});

/** The host answers the installed listing, so the plugins page lists the probe. */
const readers: HostReaders = {
  repo: () => new Promise(() => undefined),
  agent: async () => null,
  tools: () => new Promise(() => undefined),
  installed: () => fetchInstalledPlugins(),
};

async function mount(path: string) {
  window.history.replaceState(null, "", path);
  render(<Atlas model={model} readers={readers} />);
  await act(async () => undefined);
  await act(async () => undefined);
}

describe("a plugin's theme in the appearance settings", () => {
  it("is offered in both versions after FACET and Paper, and choosing one draws and keeps it", async () => {
    adoptable();
    install(OCEAN);
    await mount("/settings/appearance");

    const cards = screen.getByTestId("theme-palettes").querySelectorAll("[role=radio]");
    expect([...cards].map((c) => c.getAttribute("data-testid"))).toEqual([
      "theme-card-facet-dark",
      "theme-card-facet-light",
      "theme-card-paper-dark",
      "theme-card-paper-light",
      "theme-card-probe:ocean-dark",
      "theme-card-probe:ocean-light",
    ]);
    const light = screen.getByTestId("theme-card-probe:ocean-light");
    expect(light).toHaveTextContent(`Ocean · ${tt("ui.screens-contents.settings-light")}`);
    // The card's preview carries the plugin's palette value, which the adopted sheet answers.
    expect(light.querySelector("[data-t-theme]")).toHaveAttribute("data-t-theme", "probe:ocean");

    fireEvent.click(light);
    expect(light).toHaveAttribute("aria-checked", "true");
    expect(root).toHaveAttribute("data-t-theme", "probe:ocean");
    expect(root).toHaveAttribute("data-t-mode", "light");
    expect(JSON.parse(window.localStorage.getItem(THEME_KEY) ?? "null")).toEqual({
      theme: "probe:ocean",
      mode: "light",
    });
  });

  it("comes back from storage on the next load once its plugin contributed it", async () => {
    adoptable();
    install(OCEAN);
    window.localStorage.setItem(THEME_KEY, JSON.stringify({ theme: "probe:ocean", mode: "dark" }));
    await mount("/settings/appearance");

    expect(root).toHaveAttribute("data-t-theme", "probe:ocean");
    expect(root).toHaveAttribute("data-t-mode", "dark");
    expect(screen.getByTestId("theme-card-probe:ocean-dark")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("is drawn as FACET while its plugin is switched off, and the choice stays stored", async () => {
    adoptable();
    install(OCEAN);
    window.localStorage.setItem(THEME_KEY, JSON.stringify({ theme: "probe:ocean", mode: "light" }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ pluginsOff: ["probe"] }));
    await mount("/settings/appearance");

    // Precondition: the plugin really is installed, only switched off.
    expect(jest.mocked(fetchInstalledPlugins)).toHaveBeenCalled();
    expect(root).toHaveAttribute("data-t-theme", "facet");
    expect(root).toHaveAttribute("data-t-mode", "light");
    expect(screen.queryByTestId("theme-card-probe:ocean-light")).not.toBeInTheDocument();
    expect(screen.getByTestId("theme-card-facet-light")).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse(window.localStorage.getItem(THEME_KEY) ?? "null").theme).toBe("probe:ocean");
  });

  it("is drawn as FACET when no plugin brings it any more", async () => {
    install(null);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pluginsOff: OFFICIAL_PLUGINS.map((p) => p.id) }),
    );
    window.localStorage.setItem(THEME_KEY, JSON.stringify({ theme: "gone:ocean", mode: "dark" }));
    await mount("/settings/appearance");

    expect(root).toHaveAttribute("data-t-theme", "facet");
    expect(root).toHaveAttribute("data-t-mode", "dark");
    expect(screen.getByTestId("theme-card-facet-dark")).toHaveAttribute("aria-checked", "true");
  });
});

describe("a plugin's theme with an unknown token", () => {
  it("is refused, and the plugins page says why beside the plugin", async () => {
    adoptable();
    install((atlas) => {
      atlas.theme.contribute("invalid", {
        light: { bg: "#ffffff" },
        dark: { bg: "#000000" },
      } as never);
    });
    await mount("/settings/plugins");

    const line = screen.getByTestId("plugin-theme-refused-probe");
    expect(line).toHaveTextContent(
      tt("ui.screens-contents.settings-theme-name-refused-reason", {
        name: "invalid",
        reason: "bg is not a token this host defines",
      }),
    );
  });
});
