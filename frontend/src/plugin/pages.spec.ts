/** A plugin contributes a settings page — and what it may not take. */

import { PluginHost } from "./host";
import { SettingsRegistry } from "./pages";
import { CORE_PAGE_IDS } from "../settings/page-tree";
import type { Nav } from "../nav";

const page = (id: string) => ({
  id,
  group: "Integrations",
  title: id,
  subtitle: "",
  render: () => null,
});

function navSpy(): Nav {
  return {
    go: () => {},
    openSheet: () => {},
    closeSheet: () => {},
    openArea: () => {},
    closeArea: () => {},
    openCatalogue: () => {},
    closeCatalogue: () => {},
    openSet: () => {},
    closeSet: () => {},
    openPalette: () => {},
    ask: () => {},
    slash: () => {},
    setRole: () => {},
  } as unknown as Nav;
}

describe("A page a plugin contributes", () => {
  it("then stands in the list, with the plugin it belongs to", () => {
    const r = new SettingsRegistry();
    expect(r.register("notes", CORE_PAGE_IDS, page("notes-unavailable"))).not.toBeNull();

    expect(r.count).toBe(1);
    expect(r.find("notes-unavailable")?.title).toBe("notes-unavailable");
    // The name comes from the host and not from the body — the same promise as
    // for slots, commands and areas.
    expect(r.ownerOf("notes-unavailable")).toBe("notes");
  });

  it("disappears when the plugin takes it back", () => {
    const r = new SettingsRegistry();
    const remove = r.register("notes", CORE_PAGE_IDS, page("custom"));
    expect(r.has("custom")).toBe(true);

    remove!();

    expect(r.has("custom")).toBe(false);
    expect(r.count).toBe(0);
    expect(r.find("custom")).toBeNull();
  });

  it("cannot take over an id of the core", () => {
    const r = new SettingsRegistry();
    // The case's precondition: "themes" really is one of the core's.
    // Without it, it would check a lock against a name nobody holds.
    expect(CORE_PAGE_IDS.has("themes")).toBe(true);

    expect(r.register("boes", CORE_PAGE_IDS, page("themes"))).toBeNull();
    expect(r.count).toBe(0);
  });

  it("cannot take over another plugin's id", () => {
    const r = new SettingsRegistry();
    r.register("first", CORE_PAGE_IDS, { ...page("shared"), title: "the first" });

    expect(r.register("zweit", CORE_PAGE_IDS, page("shared"))).toBeNull();

    // The first stays. Silently overwriting would make the winner depend on
    // load order, and a reader cannot read load order.
    expect(r.find("shared")?.title).toBe("the first");
    expect(r.ownerOf("shared")).toBe("first");
    expect(r.count).toBe(1);
  });

  it("reports the refusal as a value and not as a throw", () => {
    const r = new SettingsRegistry();
    // A throw would tear down the plugin's entry point — over a name
    // collision. `areas.register` answers with `false` for the same reason,
    // and a plugin author reads an answer.
    expect(() => r.register("boes", CORE_PAGE_IDS, page("themes"))).not.toThrow();
  });
});

describe("The way there leads through atlas.settings", () => {
  it("hands the plugin the registration under its own name", () => {
    const host = new PluginHost();
    host.load(
      "notes",
      (atlas) => {
        atlas.settings.register(page("unavailable"));
      },
      navSpy(),
    );

    expect(host.settings.ownerOf("unavailable")).toBe("notes");
  });

  it("refuses the core's seven through the interface too", () => {
    const host = new PluginHost();
    let reply: unknown = "not run";
    host.load(
      "boes",
      (atlas) => {
        reply = atlas.settings.register(page("plugins"));
      },
      navSpy(),
    );

    expect(reply).toBeNull();
    expect(host.settings.count).toBe(0);
  });

  it("is empty as long as no plugin has registered a page", () => {
    expect(new PluginHost().settings.count).toBe(0);
  });
});
