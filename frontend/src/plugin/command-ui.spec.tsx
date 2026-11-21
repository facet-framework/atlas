import { PluginHost } from "./host";
import type { Nav } from "../nav";

const nav = {
  go: jest.fn(),
  open: jest.fn(),
  openScenario: jest.fn(),
  openSheet: jest.fn(),
  closeSheet: jest.fn(),
  openArea: jest.fn(),
  closeArea: jest.fn(),
  openCatalogue: jest.fn(),
  closeCatalogue: jest.fn(),
  openSet: jest.fn(),
  closeSet: jest.fn(),
  openPalette: jest.fn(),
  ask: jest.fn(),
  setRole: jest.fn(),
} as unknown as Nav;

const command = {
  command: "/adr",
  argument: "Number",
  purpose: "Open a decision",
  group: "Decisions",
  run: jest.fn(),
};

describe("a plugin's own command", () => {
  it("reaches the register a reader types into", () => {
    const host = new PluginHost();
    host.load("decisions", (atlas) => atlas.commands.register(command), nav);

    expect(host.commands.list().map((c) => c.command)).toEqual(["/adr"]);
  });

  it("carries the plugin that brought it, taken from the host", () => {
    // The id comes from the manifest the host verified, never from the
    // module: a plugin that could name itself could file its command under
    // another's name, and a reader clearing that plugin would keep this one.
    const host = new PluginHost();
    host.load("decisions", (atlas) => atlas.commands.register(command), nav);

    expect(host.commands.list().map((c) => c.plugin)).toEqual(["decisions"]);
  });

  it("goes when the plugin takes it back", () => {
    const host = new PluginHost();
    let unsubscribe: (() => void) | null = null;
    host.load("decisions", (atlas) => void (unsubscribe = atlas.commands.register(command)), nav);
    expect(host.commands.list()).toHaveLength(1);

    unsubscribe!();
    expect(host.commands.list()).toHaveLength(0);
  });

  it("is absent from a host that never loaded the plugin", () => {
    // "The plugin is off" and "its command is absent" are the same fact here,
    // not two that have to agree: switching one off builds a fresh host, and
    // a register nobody wrote into is empty.
    const host = new PluginHost();
    expect(host.commands.list()).toEqual([]);
  });

  it("stands beside the core's own, on the same terms", () => {
    const host = new PluginHost();
    host.commands.register("atlas", { ...command, command: "/record" });
    host.load("decisions", (atlas) => atlas.commands.register(command), nav);

    expect(host.commands.list().map((c) => [c.plugin, c.command])).toEqual([
      ["atlas", "/record"],
      ["decisions", "/adr"],
    ]);
  });
});
