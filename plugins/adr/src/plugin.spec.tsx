/** The decisions plugin's entry (`entry.tsx`), driven through `PluginHost` — the
 * way the host loads a plugin, per `entkopplung.spec.ts`'s rule that a
 * plugin-tree spec may not import the core's reader directly. */

import { render, screen, waitFor } from "@testing-library/react";
import type { PlacePublic } from "../../../frontend/src/plugin/context";
import { PluginHost, type AtlasApi } from "../../../frontend/src/plugin/host";
import adrPlugin, { decisionsState } from "./entry";
import { inEnglish } from "../../shared/language.spec-support";

inEnglish();

// Written out rather than narrowed from the core's `initialState`: a
// `PlacePublic` is five public fields, and reaching into the core's state for
// them would be one more core import `entkopplung.spec.ts` has to count.
const PLACE: PlacePublic = {
  depth: 0,
  fid: null,
  sid: null,
  role: "development",
  area: null,
};

function navSpy() {
  return {
    go: jest.fn(),
    open: jest.fn(),
    openScenario: jest.fn(),
    openArea: jest.fn(),
    closeArea: jest.fn(),
    openSheet: jest.fn(),
    openCatalogue: jest.fn(),
    setRole: jest.fn(),
  };
}

function load(nav = navSpy()) {
  const host = new PluginHost();
  host.setCapabilities({ adr: "adr-test-capability" });
  // The first load lists the decisions; an empty answer keeps it quiet.
  host.fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ result: { dir: "docs/adr", files: [] } }),
  })) as unknown as typeof fetch;
  host.load("adr", (atlas: AtlasApi) => adrPlugin(atlas), nav);
  return { host, nav };
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

/** The host's directory endpoint, answering `directory` for the adr kind. */
function directoryEndpoint(directory: string, line = 4) {
  const fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      file: ".facetrc.yaml",
      line,
      key: "adr.directory",
      directory,
    }),
    text: async () => "",
  }));
  global.fetch = fetcher as unknown as typeof fetch;
  return fetcher;
}

describe("The area registration", () => {
  it("claims the name 'decisions'", () => {
    const { host } = load();
    expect(host.areas.has("decisions")).toBe(true);
  });

  it("opens with a path argument on that entry's place", () => {
    const { host } = load();
    const place = host.areas.open("decisions", "docs/adr/0001-one.md");
    expect(place).toEqual({
      name: "decisions",
      state: decisionsState("docs/adr/0001-one.md"),
    });
    expect(decisionsState("docs/adr/0001-one.md").path).toBe(
      "docs/adr/0001-one.md",
    );
  });

  it("opens with no argument on the plain front page", () => {
    const { host } = load();
    const place = host.areas.open("decisions", null);
    expect(place).toEqual({ name: "decisions", state: decisionsState(null) });
    expect(decisionsState(null).path).toBeNull();
  });
});

describe("The settings page", () => {
  it("registers under 'adr' and names the directory it reads", async () => {
    const fetcher = directoryEndpoint("docs/adr");
    const { host } = load();
    const page = host.settings.find("adr");
    expect(page).not.toBeNull();

    render(<>{page!.render({ place: PLACE })}</>);
    // The page asked the host which directory the adr kind reads.
    expect(fetcher).toHaveBeenCalledWith(
      "/api/settings/directory",
      expect.anything(),
    );
    await waitFor(() =>
      expect(screen.getByText(/directory: docs\/adr/)).toBeInTheDocument(),
    );
    expect(
      document.querySelectorAll("input, textarea, select, [role=switch]"),
    ).toHaveLength(0);
    // Changing the directory is an explicit, optional action: a button, not
    // a field that is already open.
    expect(
      screen.getByRole("button", { name: "Change through Atlas" }),
    ).toBeInTheDocument();
  });
});

describe("The slash command", () => {
  it("opens the area with the trimmed argument", () => {
    const { host, nav } = load();
    const found = host.commands.list().find((c) => c.command === "/adr");
    expect(found).toBeDefined();

    found!.run("  0001-one  ");
    expect(nav.openArea).toHaveBeenCalledWith("decisions", "0001-one");
  });

  it("opens with null when the argument is empty", () => {
    const { host, nav } = load();
    const found = host.commands.list().find((c) => c.command === "/adr");

    found!.run("   ");
    expect(nav.openArea).toHaveBeenCalledWith("decisions", null);
  });
});

describe("The configured directory in settings", () => {
  it("shows the effective ADR directory supplied by the host", async () => {
    directoryEndpoint("architecture/decisions");
    const { host } = load();
    render(<>{host.settings.find("adr")!.render({ place: PLACE })}</>);
    await waitFor(() =>
      expect(
        screen.getByText(/directory: architecture\/decisions/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/\.facetrc\.yaml:4/)).toBeInTheDocument();
  });
});
