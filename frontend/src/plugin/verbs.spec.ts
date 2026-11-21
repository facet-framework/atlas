import { narrowVerbs, VERB_NAMES, WITHHELD_VERBS } from "./verbs";
import type { Nav } from "../nav";

function fakeNav() {
  return {
    go: jest.fn(),
    open: jest.fn(),
    openScenario: jest.fn(),
    openArea: jest.fn(),
    closeArea: jest.fn(),
    openCatalogue: jest.fn(),
    setRole: jest.fn(),
    // Verbs the core has and a plugin must not reach. Present on the fixture
    // on purpose: a nav object without them would make the absence case green
    // for the wrong reason.

    openSheet: jest.fn(),
    closeSheet: jest.fn(),
    openSet: jest.fn(),
    closeSet: jest.fn(),
    closeCatalogue: jest.fn(),
    openPalette: jest.fn(),
    ask: jest.fn(),
  } satisfies Nav;
}

describe("What a plugin may do to the core", () => {
  it("passes exactly the named verbs through", () => {
    const verbs = narrowVerbs(fakeNav()) as Record<string, unknown>;

    expect(Object.keys(verbs).sort()).toEqual([...VERB_NAMES].sort());
  });

  it("does not pass the withheld verbs through", () => {
    const nav = fakeNav();
    // Precondition: the core really has them.
    expect(typeof nav.openSheet).toBe("function");

    const verbs = narrowVerbs(nav) as Record<string, unknown>;

    for (const name of Object.keys(WITHHELD_VERBS)) {
      expect(verbs[name]).toBeUndefined();
    }
  });

  it("pins which verbs are withheld — the list is the content", () => {
    expect(Object.keys(WITHHELD_VERBS).sort()).toEqual(["closeSheet", "openSet", "openSheet"]);
  });

  it("withholds only verbs the core really has", () => {
    // Otherwise the list would withhold something that does not exist — and
    // read like a boundary without being one.
    const nav = fakeNav() as unknown as Record<string, unknown>;
    for (const name of Object.keys(WITHHELD_VERBS)) {
      expect(typeof nav[name]).toBe("function");
    }
  });

  it("opens an area by its name", () => {
    const nav = fakeNav();
    narrowVerbs(nav).openArea("notes", "onboarding/start");

    expect(nav.openArea).toHaveBeenCalledWith("notes", "onboarding/start");
  });

  it("passes an area without an argument on with null", () => {
    const nav = fakeNav();
    narrowVerbs(nav).openArea("concepts");

    expect(nav.openArea).toHaveBeenCalledWith("concepts", null);
  });

  it("closes the area", () => {
    const nav = fakeNav();
    narrowVerbs(nav).closeArea();

    expect(nav.closeArea).toHaveBeenCalled();
  });

  it("looks up a term without handing over the general door", () => {
    const nav = fakeNav();
    const verbs = narrowVerbs(nav) as Record<string, unknown>;

    // The precondition: the general door exists on the core and is NOT handed
    // over. Without this line the case below would be green for a nav object
    // that simply has no sheet.
    expect(typeof nav.openSheet).toBe("function");
    expect(verbs.openSheet).toBeUndefined();

    narrowVerbs(nav).openTerm("Drift");

    // The kind is fixed by the host, not chosen by the caller. Let the plugin
    // pass the kind and `openTerm("conversation")` would open the companion —
    // the reader's own conversation, which is why openSheet is withheld.
    expect(nav.openSheet).toHaveBeenCalledWith("term", "Drift");
  });

  it("passes a feature on without handing over the promise", () => {
    const nav = fakeNav();
    narrowVerbs(nav).go(2, "backend/server/local/registry-reader");

    // In the core, go takes a third argument (sid). A plugin does not get it,
    // and the call must not set it behind its back either.
    expect(nav.go).toHaveBeenCalledWith(2, "backend/server/local/registry-reader");
  });
});
