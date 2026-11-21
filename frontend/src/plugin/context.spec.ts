import { initialState } from "../state";
import { narrowPlace, PLACE_FIELDS } from "./context";

/** The fields AtlasState carries that a plugin must never see. Written out
 * rather than derived, so adding one to the core does not silently grow this
 * list — and so a reader of this file can see what is at stake without
 * opening state.ts. */

const MUST_NOT_LEAK = [
  // The reader's conversation history with the companion. The single strongest
  // reason this context is a positive list: questions a person asked about
  // their own codebase, kept so the surface can show them again.
  "conversations",
  // Persisted choices that are the reader's, not the plugin's business.
  "theme",
  "storageResult",
];

describe("What a plugin sees of the reader's place", () => {
  it("passes through exactly the five fields it may see", () => {
    const place = narrowPlace({ ...initialState, role: "development" });

    expect(PLACE_FIELDS).toEqual(["depth", "fid", "sid", "role", "area"]);
    expect(Object.keys(place).sort()).toEqual(["area", "depth", "fid", "role", "sid"]);
  });

  it("does not pass through the conversation history", () => {
    // The fixture asserts its own premise. A state without conversations would
    // make this case green for the wrong reason — it would prove that nothing
    // leaks from an object that had nothing to leak.
    const state = {
      ...initialState,
      role: "development",
      conversations: [{ id: "g1", question: "Where is the reader?", reply: "here" }],
    };
    expect(state.conversations.length).toBeGreaterThan(0);

    const place = narrowPlace(state) as Record<string, unknown>;

    for (const field of MUST_NOT_LEAK) {
      expect(place[field]).toBeUndefined();
    }
  });

  it("does not carry along a field the core gains later", () => {
    // A field nobody has decided about yet. narrowPlace copies from a list, so
    // it cannot carry this — a spread would.
    const state = {
      ...initialState,
      role: "development",
      newField: "that nobody checked",
    };

    const place = narrowPlace(state) as Record<string, unknown>;

    expect(place.newField).toBeUndefined();
    expect(Object.keys(place)).toHaveLength(5);
  });

  it("carries the place a surface needs", () => {
    const place = narrowPlace({
      ...initialState,
      depth: 2,
      fid: "backend/server/local/registry-reader",
      sid: "visible-scenario",
      role: "product",
    });

    expect(place.depth).toBe(2);
    expect(place.fid).toBe("backend/server/local/registry-reader");
    expect(place.sid).toBe("visible-scenario");
    expect(place.role).toBe("product");
  });

  it("carries the open area's name and nothing of its state", () => {
    const place = narrowPlace({
      ...initialState,
      role: "development",
      area: { name: "notes", state: { page: "geheim", secret: "not for a plugin" } },
    }) as Record<string, unknown>;

    expect(place.area).toBe("notes");
    // The precondition and the promise in one assertion: the source state did
    // carry more than a name, and none of it travelled.
    expect(JSON.stringify(place)).not.toContain("geheim");
  });

  it("carries null when no area is open", () => {
    const place = narrowPlace({ ...initialState, role: "development", area: null });
    expect(place.area).toBeNull();
  });
});
