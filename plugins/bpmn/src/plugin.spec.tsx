/** The processes plugin's entry (`reader/entry.tsx`), driven through `PluginHost`
 * — the way the host loads a plugin. The door into the processes is the
 * host's navigation entry, not a header action of the plugin's own. */

import { render, screen } from "@testing-library/react";
import type { PlacePublic } from "../../../frontend/src/plugin/context";
import { PluginHost, type AtlasApi } from "../../../frontend/src/plugin/host";
import bpmnPlugin from "./reader/entry";
import { inEnglish } from "../../shared/language.spec-support";

inEnglish();

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

function loadPlugin(nav = navSpy()) {
  const host = new PluginHost();
  host.setCapabilities({ bpmn: "bpmn-test-capability" });
  host.load("bpmn", (atlas: AtlasApi) => bpmnPlugin(atlas), nav);
  return { host, nav };
}

describe("The area registration", () => {
  it("opens on the named file, and on the list without one", () => {
    const { host } = loadPlugin();
    const opened = host.areas.open("processes", "order.bpmn");
    expect(opened).toEqual({
      name: "processes",
      state: { path: "order.bpmn" },
    });
    expect(host.areas.open("processes", null)).toEqual({
      name: "processes",
      state: { path: null },
    });
  });
});

describe("The settings page", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("names the directory configuration and offers an optional editor", async () => {
    // The host's own answer to `/api/settings/directory`, the route
    // internal/ui/directory_settings_test.go drives: the effective directory
    // and where in the configuration it was set.
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        file: ".facetrc.yaml",
        line: 12,
        key: "bpmn.directory",
        directory: "diagrams",
      }),
    })) as unknown as typeof fetch;
    const { host } = loadPlugin();
    const page = host.settings.find("bpmn");
    expect(page).not.toBeNull();
    const { container } = render(<>{page!.render({ place: PLACE })}</>);
    expect(screen.getByText("bpmn.directory")).toBeInTheDocument();
    // The effective directory and its source, as the host reported them —
    // not the key name alone. Mutation: drop `<DirectorySettings kind="bpmn" />`
    // from the settings page → red.
    expect(await screen.findByText(".facetrc.yaml:12")).toBeVisible();
    expect(screen.getByText(/directory: diagrams/)).toBeVisible();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/settings/directory",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ kind: "bpmn" }),
      }),
    );
    expect(
      container.querySelectorAll("input, textarea, select, [role='switch']"),
    ).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Change through Atlas" }),
    ).toBeInTheDocument();
  });
});

// Mutation: drop `.trim()` from the command's run → the first case goes red.
describe("The slash command", () => {
  it("opens the area on the trimmed file name", () => {
    const { host, nav } = loadPlugin();
    const found = host.commands.list().find((c) => c.command === "/bpmn");
    expect(found).toBeDefined();
    found!.run("  order  ");
    expect(nav.openArea).toHaveBeenCalledWith("processes", "order");
  });

  it("opens the plain list without an argument", () => {
    const { host, nav } = loadPlugin();
    host.commands
      .list()
      .find((c) => c.command === "/bpmn")!
      .run("   ");
    expect(nav.openArea).toHaveBeenCalledWith("processes", null);
  });
});
