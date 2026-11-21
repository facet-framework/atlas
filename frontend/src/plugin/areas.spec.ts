import { initialState } from "../state";
import { AreaRegistry } from "./areas";
import { narrowPlace } from "./context";

const place = () => narrowPlace(initialState);

describe("An area belongs to a plugin, not to the core", () => {
  it("opens a registered area with the state it gives itself", () => {
    const reg = new AreaRegistry();
    reg.register("notes", "notes", () => null, {
      initial: (arg) => ({ page: arg, q: "", catalogue: "all" }),
    });

    expect(reg.open("notes", "notes:onboarding/start")).toEqual({
      name: "notes",
      state: { page: "notes:onboarding/start", q: "", catalogue: "all" },
    });
  });

  it("does not open an unknown area", () => {
    const reg = new AreaRegistry();

    expect(reg.open("invented", null)).toBeNull();
    expect(reg.has("invented")).toBe(false);
  });

  it("does not let a second claim on the same name through", () => {
    const reg = new AreaRegistry();

    expect(reg.register("notes", "notes", () => null)).toBe(true);
    expect(reg.register("concepts", "notes", () => null)).toBe(false);

    // Silently letting the second win would make which plugin draws depend on
    // load order, and load order is not something a reader can reason about.
    expect(reg.ownerOf("notes")).toBe("notes");
    expect(reg.count).toBe(1);
  });

  it("hands the area its own state and the public place", () => {
    const reg = new AreaRegistry();
    let seen: { state: unknown; place: unknown } | null = null;
    reg.register("notes", "notes", ({ state, place }) => {
      seen = { state, place };
      return null;
    });

    const inspected = jest.fn();
    const state = new Proxy(
      { page: "notes:x" },
      {
        get(target, key, receiver) {
          inspected(key);
          return Reflect.get(target, key, receiver);
        },
        ownKeys(target) {
          inspected("ownKeys");
          return Reflect.ownKeys(target);
        },
      },
    );
    reg.render({ name: "notes", state }, { setState: () => {}, place: place() });
    expect(seen!.state).toBe(state);
    expect(inspected).not.toHaveBeenCalled();
    expect(Object.keys(seen!.place as object).sort()).toEqual([
      "area",
      "depth",
      "fid",
      "role",
      "sid",
    ]);
  });

  it("draws nothing when the area's owner is missing", () => {
    const reg = new AreaRegistry();

    // A name in the state whose plugin is unavailable — uninstalled between two
    // renders, or a state restored from a reader that had it. Drawing an
    // empty surface would look like a broken plugin; drawing nothing is the
    // honest answer.
    expect(
      reg.render({ name: "weg", state: null }, { setState: () => {}, place: place() }),
    ).toBeNull();
  });

  it("ladders out with the area's own Esc ladder, not with one of the core's", () => {
    const reg = new AreaRegistry();
    // The notes' ladder: page → front page → closed.
    reg.register("notes", "notes", () => null, {
      escape: (state) => {
        const s = state as { page: string | null };
        return s.page ? { ...s, page: null } : null;
      },
    });

    const onSide = { name: "notes", state: { page: "notes:x" } };
    const frontPage = reg.escape(onSide);

    expect(frontPage).toEqual({ name: "notes", state: { page: null } });
    expect(reg.escape(frontPage!)).toBeNull();
  });

  it("closes an area without a ladder on the first Esc", () => {
    const reg = new AreaRegistry();
    reg.register("concepts", "concepts", () => null);

    expect(reg.escape({ name: "concepts", state: { irgendwas: 1 } })).toBeNull();
  });

  it("closes an area whose owner is missing instead of leaving it standing", () => {
    const reg = new AreaRegistry();

    expect(reg.escape({ name: "weg", state: { page: "x" } })).toBeNull();
  });
});
