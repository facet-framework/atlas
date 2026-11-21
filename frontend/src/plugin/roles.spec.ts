/** A plugin contributes a role — and what it may not take. */

import { PluginHost } from "./host";
import { RoleRegistry, type PluginRole } from "./roles";
import { CORE_ROLE_IDS } from "../roles";
import type { Nav } from "../nav";

const role = (label: string): PluginRole => ({
  label,
  purpose: `What ${label} shows.`,
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

describe("A role a plugin contributes", () => {
  it("then stands in the list, with the plugin it belongs to", () => {
    const r = new RoleRegistry();
    expect(r.register("concepts", CORE_ROLE_IDS, "pm", role("Product"))).not.toBeNull();

    expect(r.count).toBe(1);
    expect(r.find("pm")?.label).toBe("Product");
    // The name comes from the host and not from the body — the same promise as
    // for slots, commands, areas, settings pages and tiles.
    expect(r.ownerOf("pm")).toBe("concepts");
  });

  it("disappears when the plugin takes it back", () => {
    const r = new RoleRegistry();
    const remove = r.register("concepts", CORE_ROLE_IDS, "custom", role("Custom"));
    expect(r.has("custom")).toBe(true);

    remove!();

    expect(r.has("custom")).toBe(false);
    expect(r.count).toBe(0);
    expect(r.find("custom")).toBeNull();
  });

  it("cannot take over an id of the core", () => {
    const r = new RoleRegistry();
    // The case's precondition: "dev" really is an id of the core.
    // Without it, it would check a lock against a name nobody holds.
    expect(CORE_ROLE_IDS.has("dev")).toBe(true);

    expect(r.register("boes", CORE_ROLE_IDS, "dev", role("Not the real one"))).toBeNull();
    expect(r.count).toBe(0);
  });

  it("cannot take over another plugin's id", () => {
    const r = new RoleRegistry();
    r.register("first", CORE_ROLE_IDS, "shared", role("the first"));

    expect(r.register("zweit", CORE_ROLE_IDS, "shared", role("the second"))).toBeNull();

    // The first stays. Silently overwriting would make the winner depend on
    // load order, and a reader cannot read load order.
    expect(r.find("shared")?.label).toBe("the first");
    expect(r.ownerOf("shared")).toBe("first");
    expect(r.count).toBe(1);
  });

  it("reports the refusal as a value and not as a throw", () => {
    const r = new RoleRegistry();
    // A throw would tear down the plugin's entry point — over a name
    // collision. `areas.register` answers with `false` for the same reason,
    // and a plugin author reads an answer.
    expect(() => r.register("boes", CORE_ROLE_IDS, "dev", role("x"))).not.toThrow();
  });
});

describe("The way there leads through atlas.roles", () => {
  it("hands the plugin the registration under its own name", () => {
    const host = new PluginHost();
    host.load(
      "concepts",
      (atlas) => {
        atlas.roles.register("pm", role("Product"));
      },
      navSpy(),
    );

    expect(host.roles.ownerOf("pm")).toBe("concepts");
  });

  it("refuses the core's seven through the interface too", () => {
    const host = new PluginHost();
    let reply: unknown = "not run";
    host.load(
      "boes",
      (atlas) => {
        reply = atlas.roles.register("leadership", role("x"));
      },
      navSpy(),
    );

    expect(reply).toBeNull();
    expect(host.roles.count).toBe(0);
  });

  it("is empty as long as no plugin has registered a role", () => {
    // The other half of the promise "the reader is complete without plugins":
    // no eighth role.
    expect(new PluginHost().roles.count).toBe(0);
  });
});
