import { narrowPlace, PLACE_FIELDS } from "./context";
import { initialState } from "../state";
import { SlotRegistry } from "./slots";

const place = (role = "development") => narrowPlace({ ...initialState, role });

describe("What the host hands a plugin's surface", () => {
  it("gives a closed root that cannot be read from the outside", () => {
    const reg = new SlotRegistry();
    reg.register("notes", "surface.section", (root) => {
      root.innerHTML = "<p>written by the plugin</p>";
    });

    const host = document.createElement("div");
    const mounts = reg.mount(host, "surface.section", place());

    // The precondition of this case: something was actually mounted, and the
    // plugin wrote into it. Without both, the case would test the
    // unreadability of nothing.
    expect(mounts).toHaveLength(1);
    expect(mounts[0].root.innerHTML).toContain("written by the plugin");

    // The promise: the tree is not reachable from outside. An open ShadowRoot
    // would give the node back here, and then the boundary would be an
    // agreement rather than a mechanism.
    const holder = host.firstElementChild!;
    expect(holder.shadowRoot).toBeNull();
    expect(host.innerHTML).not.toContain("written by the plugin");
  });

  it("gives two plugins in the same slot separate roots", () => {
    const reg = new SlotRegistry();
    reg.register("notes", "surface.section", (root) => {
      root.innerHTML = "<p>notes</p>";
    });
    reg.register("concepts", "surface.section", (root) => {
      root.innerHTML = "<p>concepts</p>";
    });

    const host = document.createElement("div");
    const mounts = reg.mount(host, "surface.section", place());

    expect(mounts).toHaveLength(2);
    expect(mounts[0].root).not.toBe(mounts[1].root);
    // Neither sees the other's markup.
    expect(mounts[0].root.innerHTML).not.toContain("concepts");
    expect(mounts[1].root.innerHTML).not.toContain("notes");
  });

  it("draws the next plugin in a slot when one plugin's renderer throws", () => {
    const reg = new SlotRegistry();
    reg.register("boom", "surface.section", () => {
      throw new Error("renderer exploded");
    });
    reg.register("concepts", "surface.section", (root) => {
      root.innerHTML = "<p>concepts</p>";
    });

    const host = document.createElement("div");
    const mounts = reg.mount(host, "surface.section", place());

    expect(mounts).toHaveLength(2);
    expect(mounts[1].root.innerHTML).toContain("concepts");
    // The failed one keeps its holder, marked with what it threw.
    expect(host.querySelector('[data-facet-plugin="boom"]')).toHaveAttribute(
      "data-facet-failed",
      "renderer exploded",
    );
  });

  it("mounts only where the role matches", () => {
    const reg = new SlotRegistry();
    reg.register("concepts", "surface.section", () => {}, "product");

    const host = document.createElement("div");
    expect(reg.mount(host, "surface.section", place("development"))).toHaveLength(0);
    expect(reg.mount(host, "surface.section", place("product"))).toHaveLength(1);
  });

  it("takes a surface back", () => {
    const reg = new SlotRegistry();
    reg.register("notes", "surface.section", (root) => {
      root.innerHTML = "<p>notes</p>";
    });

    const host = document.createElement("div");
    reg.mount(host, "surface.section", place());
    expect(reg.liveCount).toBe(1);

    reg.unmount(host);

    expect(reg.liveCount).toBe(0);
    expect(host.children).toHaveLength(0);
  });

  it("names the plugin the host knows, not the one the plugin says", () => {
    const reg = new SlotRegistry();
    reg.register("notes", "record.panel", () => {});

    const host = document.createElement("div");
    const mounts = reg.mount(host, "record.panel", place());

    expect(mounts[0].plugin).toBe("notes");
    expect((host.firstElementChild as HTMLElement).dataset.facetPlugin).toBe("notes");
  });

  it("hands the plugin the place it may see", () => {
    const reg = new SlotRegistry();
    let seen: unknown = null;
    reg.register("notes", "surface.section", (_root, place) => {
      seen = place;
    });

    reg.mount(document.createElement("div"), "surface.section", place("product"));

    expect(Object.keys(seen as object).sort()).toEqual([...PLACE_FIELDS].sort());
  });
});
