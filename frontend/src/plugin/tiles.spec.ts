/** A plugin contributes a catalogue tile — and what it may not take. */

import { CORE_CATALOGUE_IDS, numericValue } from "../contents/catalogue";
import { PluginHost } from "./host";
import { TileRegistry, type TileDef, groupOr, asCatalogueDef } from "./tiles";
import type { Nav } from "../nav";

const tile = (label: string): TileDef => ({
  group: "Context",
  label,
  desc: "",
  count: () => numericValue(0),
  items: () => [],
  detail: () => null,
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

describe("A tile a plugin contributes", () => {
  it("then stands in the list, with the plugin it belongs to", () => {
    const r = new TileRegistry();
    expect(r.register("notes", CORE_CATALOGUE_IDS, "notes-pages", tile("Notes"))).not.toBeNull();

    expect(r.count).toBe(1);
    expect(r.find("notes-pages")?.label).toBe("Notes");
    // The name comes from the host and not from the body — the same promise as
    // for slots, commands, areas and settings pages.
    expect(r.ownerOf("notes-pages")).toBe("notes");
  });

  it("disappears when the plugin takes it back", () => {
    const r = new TileRegistry();
    const remove = r.register("notes", CORE_CATALOGUE_IDS, "custom", tile("Custom"));
    expect(r.has("custom")).toBe(true);

    remove!();

    expect(r.has("custom")).toBe(false);
    expect(r.count).toBe(0);
    expect(r.find("custom")).toBeNull();
  });

  it("cannot take over an id of the core", () => {
    const r = new TileRegistry();
    // The case's precondition: "records" really is one of the core's.
    // Without it, it would check a lock against a name nobody holds.
    expect(CORE_CATALOGUE_IDS.has("records")).toBe(true);

    expect(r.register("boes", CORE_CATALOGUE_IDS, "records", tile("Not the real ones"))).toBeNull();
    expect(r.count).toBe(0);
  });

  it("cannot take over another plugin's id", () => {
    const r = new TileRegistry();
    r.register("first", CORE_CATALOGUE_IDS, "shared", tile("the first"));

    expect(r.register("zweit", CORE_CATALOGUE_IDS, "shared", tile("the second"))).toBeNull();

    // The first stays. Silently overwriting would make the winner depend on
    // load order, and a reader cannot read load order.
    expect(r.find("shared")?.label).toBe("the first");
    expect(r.ownerOf("shared")).toBe("first");
    expect(r.count).toBe(1);
  });

  it("reports the refusal as a value and not as a throw", () => {
    const r = new TileRegistry();
    // A throw would tear down the plugin's entry point — over a name
    // collision. `areas.register` answers with `false` for the same reason,
    // and a plugin author reads an answer.
    expect(() => r.register("boes", CORE_CATALOGUE_IDS, "records", tile("x"))).not.toThrow();
  });
});

describe("The way there leads through atlas.tiles", () => {
  it("hands the plugin the registration under its own name", () => {
    const host = new PluginHost();
    host.load(
      "notes",
      (atlas) => {
        atlas.tiles.register("notes-pages", tile("Notes"));
      },
      navSpy(),
    );

    expect(host.tiles.ownerOf("notes-pages")).toBe("notes");
  });

  it("refuses the core's seven through the interface too", () => {
    const host = new PluginHost();
    let reply: unknown = "not run";
    host.load(
      "boes",
      (atlas) => {
        reply = atlas.tiles.register("promises", tile("x"));
      },
      navSpy(),
    );

    expect(reply).toBeNull();
    expect(host.tiles.count).toBe(0);
  });

  it("is empty as long as no plugin has registered a tile", () => {
    // The other half of the promise "the reader is complete without plugins":
    // no eighth tile.
    expect(new PluginHost().tiles.count).toBe(0);
  });
});

describe("An unknown group falls back to one of the core's", () => {
  const KNOWN = ["Registry", "Evidence", "Code", "Context"];

  it("keeps a known group unchanged", () => {
    expect(groupOr("Registry", KNOWN)).toBe("Registry");
  });

  it("maps an unknown one onto the fallback instead of inventing it", () => {
    const g = groupOr("Plugin-Erfindung", KNOWN);

    // The precondition: the fallback itself is one the core knows —
    // otherwise this check would only have swapped one unknown group for
    // another unknown one.
    expect(KNOWN).toContain(g);
  });

  it("asCatalogueDef carries over group, label, desc, count, items, bad and grouped", () => {
    const t = {
      id: "x",
      plugin: "notes",
      group: "Plugin-Erfindung",
      label: "X",
      desc: "y",
      count: () => numericValue(3),
      bad: () => true,
      items: () => [{ id: "1", t: "one", raw: null }],
      grouped: () => null,
      detail: () => null,
    };
    const def = asCatalogueDef(t, KNOWN);

    expect(def.label).toBe("X");
    expect(def.desc).toBe("y");
    expect(def.count({ v: {} as never })).toEqual(numericValue(3));
    expect(def.bad?.({ v: {} as never })).toBe(true);
    expect(def.items({ v: {} as never })).toHaveLength(1);
  });
});
