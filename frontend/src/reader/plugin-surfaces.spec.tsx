/** Where a plugin's slots, verbs and host events land in the reader: a slot
 * only where its role and surface are, nothing where no plugin asked for one,
 * one holder per plugin however often the reader redraws, a late door beside
 * a live one without disturbing it, and the notes's own tile drawn from what
 * the host measured. Each case reads the rendered reader, the address or what
 * the plugin was handed, never a value the host returned. */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { derive } from "@/derive";
import {
  fetchInstalledPlugins,
  fetchPluginCapabilities,
  resolveInstalledPlugins,
  type InstalledPluginListing,
} from "@/plugin/installed";
import type { AtlasApi, PlacePublic, PluginEntry } from "@/plugin/api";
import { HISTORY_KEY, type History } from "./history";
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

function install(entries: Record<string, PluginEntry>) {
  const listings: InstalledPluginListing[] = Object.keys(entries).map((id) => ({
    id,
    name: id,
    version: "0.1.0",
    api: 0,
    entry: `/plugins/${id}/plugin.js`,
    areas: [id],
    slots: [],
    dev: false,
    verification: "ok",
  }));
  jest.mocked(fetchInstalledPlugins).mockResolvedValue(listings);
  jest
    .mocked(fetchPluginCapabilities)
    .mockResolvedValue(Object.fromEntries(listings.map((l) => [l.id, `cap-${l.id}`])));
  jest.mocked(resolveInstalledPlugins).mockImplementation(async (items) => ({
    loaded: items.map((l) => ({ id: l.id, entry: entries[l.id] })),
    states: items.map((l) => ({ status: "loaded" as const, listing: l })),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as never;
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  window.matchMedia = realMatchMedia;
  install({});
});

async function mount(path: string) {
  window.history.replaceState(null, "", path);
  const view = render(<Atlas model={model} readers={null} />);
  await act(async () => undefined);
  await act(async () => undefined);
  return view;
}

/** The buttons the probes drew, by their text: a closed shadow root keeps them from queries. */
const drawnButtons = new Map<string, HTMLElement>();
beforeEach(() => drawnButtons.clear());

const SLOT_IDS = ["header.action", "surface.section", "record.panel", "scenario.panel"];

/** A button the plugin draws into `slot`, running `onClick`. */
function door(
  atlas: AtlasApi,
  slot: Parameters<AtlasApi["slots"]["mount"]>[0],
  text: string,
  onClick: () => void,
  role?: string,
) {
  atlas.slots.mount(
    slot,
    (root) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.addEventListener("click", onClick);
      root.appendChild(b);
      drawnButtons.set(text, b);
    },
    role ? { role } : undefined,
  );
}

describe("a reader no plugin drew a slot into", () => {
  it("draws no slot holder on the overview, the record or the scenario, and none in the top bar", async () => {
    for (const path of ["/", `/record/${RECORD.id}`, `/record/${RECORD.id}/-/${SCENARIO}`]) {
      const view = await mount(path);
      for (const slot of SLOT_IDS) expect(screen.queryByTestId(`plugin-slot-${slot}`)).toBeNull();
      expect(document.querySelector("[data-facet-plugin]")).toBeNull();
      view.unmount();
    }
  });
});

describe("a plugin's slot", () => {
  it("bound to a role stands only while that role is read", async () => {
    install({
      probe: (atlas) => door(atlas, "surface.section", "lead only", () => undefined, "leadership"),
    });
    await mount("/");
    expect(screen.queryByTestId("plugin-slot-surface.section")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: tt("shell.role.dev.name") }));
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: new RegExp(tt("shell.role.leadership.name")) }),
    );
    expect(
      screen
        .getByTestId("plugin-slot-surface.section")
        .querySelector('[data-facet-plugin="probe"]'),
    ).not.toBeNull();
  });

  it("goes with the surface it stood on: the record's panel is taken away when the reader leaves", async () => {
    let drawn: HTMLElement | null = null;
    install({
      probe: (atlas) =>
        atlas.slots.mount("record.panel", (root) => {
          drawn = document.createElement("p");
          root.appendChild(drawn);
        }),
    });
    await mount(`/record/${RECORD.id}`);
    expect(drawn!.isConnected).toBe(true);
    await userEvent.click(
      within(screen.getByRole("navigation", { name: tt("shell.nav.label") })).getAllByRole(
        "button",
      )[0],
    );
    expect(window.location.pathname).toBe("/");
    expect(drawn!.isConnected).toBe(false);
    expect(screen.queryByTestId("plugin-slot-record.panel")).toBeNull();
  });

  it("is handed only the public place: depth, record, scenario, role and the area's name", async () => {
    const places: PlacePublic[] = [];
    install({
      probe: (atlas) => {
        atlas.slots.mount("scenario.panel", (_root, place) => void places.push(place));
        atlas.slots.mount("header.action", (_root, place) => void places.push(place));
        atlas.areas.register("probe", () => atlas.ui.h("h1", null, "Probe area"), {
          initial: () => ({ secret: "state" }),
        });
      },
    });
    const view = await mount(`/record/${RECORD.id}/-/${SCENARIO}`);
    const scenario = places.find((p) => p.sid);
    expect(Object.keys(scenario!).sort()).toEqual(["area", "depth", "fid", "role", "sid"]);
    expect(scenario).toMatchObject({
      fid: RECORD.id,
      sid: SCENARIO,
      role: "dev",
      area: null,
    });
    view.unmount();
    places.length = 0;
    await mount("/p/probe");
    const inArea = places.find((p) => p.area !== null);
    expect(inArea!.area).toBe("probe");
  });

  it("stands once per plugin however often the reader redraws", async () => {
    let entries = 0;
    install({
      probe: (atlas) => {
        entries++;
        door(atlas, "header.action", "probe door", () => undefined);
      },
    });
    await mount("/");
    await userEvent.click(
      screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) })[0],
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: tt("ui.screens-plugins.chat-question-atlas") }),
      "redraw",
    );
    expect(entries).toBe(1);
    expect(
      screen.getByTestId("top-actions").querySelectorAll('[data-facet-plugin="probe"]'),
    ).toHaveLength(1);
  });

  it("drawn late beside a live door leaves that door as it was, with what the reader typed into it", async () => {
    let field: HTMLInputElement | null = null;
    let later: AtlasApi | null = null;
    install({
      probe: (atlas) => {
        later = atlas;
        atlas.slots.mount("header.action", (root) => {
          field = document.createElement("input");
          field.setAttribute("aria-label", "probe field");
          root.appendChild(field);
        });
      },
    });
    await mount("/");
    const holder = screen.getByTestId("top-actions").querySelector('[data-facet-plugin="probe"]');
    field!.value = "draft";
    field!.focus();
    act(() => door(later!, "header.action", "late door", () => undefined));
    const holders = screen
      .getByTestId("top-actions")
      .querySelectorAll('[data-facet-plugin="probe"]');
    expect(holders).toHaveLength(2);
    expect(holders[0]).toBe(holder);
    expect(field!.isConnected).toBe(true);
    expect(field!.value).toBe("draft");
    expect((field!.getRootNode() as ShadowRoot).activeElement).toBe(field);
  });
});

describe("a plugin's verbs", () => {
  it("open a record and close an area at their addresses", async () => {
    install({
      probe: (atlas) => {
        door(atlas, "header.action", "to record", () => atlas.verbs.open(RECORD.id));
        atlas.areas.register("probe", () =>
          atlas.ui.h("button", { onClick: () => atlas.verbs.closeArea() }, "close probe"),
        );
      },
    });
    await mount("/p/probe");
    await userEvent.click(screen.getByRole("button", { name: "close probe" }));
    expect(window.location.pathname).toBe("/");
    // The door sits in its holder's closed shadow root; the probe kept the button it drew.
    const button = drawnButtons.get("to record")!;
    expect(
      (button.getRootNode() as ShadowRoot).host.closest('[data-testid="top-actions"]'),
    ).not.toBeNull();
    fireEvent.click(button);
    expect(window.location.pathname).toBe(`/record/${RECORD.id}`);
  });
});

describe("the host's announcement", () => {
  it("tells a listening plugin which records the corpus holds, again when the corpus moves", async () => {
    const heard: unknown[] = [];
    install({ probe: (atlas) => void atlas.bus.on("facets.changed", (ids) => heard.push(ids)) });
    const view = await mount("/");
    // The installed plugin loads after the first paint; a new corpus is announced to it.
    const next = { ...model, features: model.features.slice(1) };
    view.rerender(<Atlas model={next} readers={null} />);
    await act(async () => undefined);
    const last = heard[heard.length - 1] as string[];
    expect(last).toEqual(derive(next).M.map((m) => m.id));
    expect(last).not.toContain(model.features[0].id);
  });
});

describe("a slot a plugin marks as new", () => {
  it("lights up on a granted call and goes out when cleared; a refused call moves nothing", async () => {
    let api: AtlasApi | null = null;
    install({
      probe: (atlas) => {
        api = atlas;
        door(atlas, "header.action", "probe door", () => undefined);
      },
    });
    window.localStorage.setItem("facet.atlas.plugin-seen", JSON.stringify(["probe:header.action"]));
    let answer: object = { result: {} };
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => answer,
    })) as never;
    await mount("/");
    const glow = () => screen.queryByTestId("slot-glow-probe:header.action");
    expect(glow()).toBeNull();
    await act(async () => void (await api!.slots.notify("header.action", true)));
    expect(glow()).not.toBeNull();
    await act(async () => void (await api!.slots.notify("header.action", false)));
    expect(glow()).toBeNull();
    answer = { denied: "not granted" };
    await act(async () =>
      expect(await api!.slots.notify("header.action", true)).toEqual({
        ok: false,
        denied: "not granted",
      }),
    );
    expect(glow()).toBeNull();
  });
});

describe("an area that declared no place", () => {
  it("keeps its address and adds no step when its state moves", async () => {
    install({
      probe: (atlas) =>
        atlas.areas.register(
          "probe",
          ({ state, setState }) =>
            atlas.ui.h(
              "button",
              { onClick: () => setState(`${String(state)}+`) },
              `state ${String(state)}`,
            ),
          { initial: () => "a" },
        ),
    });
    await mount("/p/probe");
    const stored = () =>
      (JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "{}") as History).places?.map(
        (p) => p.path,
      ) ?? [];
    const before = stored();
    await userEvent.click(screen.getByRole("button", { name: "state a" }));
    expect(screen.getByRole("button", { name: "state a+" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/p/probe");
    expect(stored()).toEqual(before);
  });
});
