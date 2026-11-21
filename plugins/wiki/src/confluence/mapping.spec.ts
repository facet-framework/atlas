/**
 * The mapping algebra — what a selection may do and what a mapping is.
 *
 * What is checked here is the rule, not the surface: a mapping comes from
 * dragging, it carries the same number on **both** sides, and a row that is
 * already mapped or already connected cannot be chosen again. These are the
 * sentences the surface later hangs on; if they lived in a component, they
 * could only be checked through a click.
 */

import {
  select,
  release,
  numberOf,
  selectable,
  mapSelection,
  type Selection,
  type Connection,
  type Mapping,
} from "./mapping";
import { inEnglish } from "../../../shared/language.spec-support";

inEnglish();

const WITHOUT: Connection[] = [];

describe("Selection", () => {
  it("takes several areas on the left into one package", () => {
    let sel: Selection = null;
    sel = select(sel, "wiki", "anleitungen", [], WITHOUT);
    sel = select(sel, "wiki", "onboarding", [], WITHOUT);
    expect(sel).toEqual({ side: "wiki", ids: ["anleitungen", "onboarding"] });
    sel = select(sel, "wiki", "anleitungen", [], WITHOUT);
    expect(sel).toEqual({ side: "wiki", ids: ["onboarding"] });
  });

  it("holds exactly one row on the right — one target stays one", () => {
    let sel: Selection = null;
    sel = select(sel, "conf", "ENG/48100", [], WITHOUT);
    sel = select(sel, "conf", "ENG/48300", [], WITHOUT);
    expect(sel).toEqual({ side: "conf", ids: ["ENG/48300"] });
  });

  it("drops the other side's selection instead of holding both", () => {
    const sel = select(
      { side: "wiki", ids: ["anleitungen"] },
      "conf",
      "ENG",
      [],
      WITHOUT,
    );
    expect(sel).toEqual({ side: "conf", ids: ["ENG"] });
  });

  it("takes back a second choice of the same row", () => {
    let sel: Selection = select(null, "wiki", "anleitungen", [], WITHOUT);
    sel = select(sel, "wiki", "anleitungen", [], WITHOUT);
    expect(sel).toBeNull();
  });

  it("does not let a mapped row be chosen again", () => {
    const maps: Mapping[] = [
      {
        n: 1,
        side: "wiki",
        ids: ["anleitungen"],
        target: { kind: "onto", id: "ENG/48100" },
      },
    ];
    expect(selectable("wiki", "anleitungen", maps, WITHOUT)).toBe(false);
    expect(select(null, "wiki", "anleitungen", maps, WITHOUT)).toBeNull();
  });

  it("does not let the other side's target row be chosen again either", () => {
    const maps: Mapping[] = [
      {
        n: 1,
        side: "wiki",
        ids: ["anleitungen"],
        target: { kind: "onto", id: "ENG/48100" },
      },
    ];
    expect(selectable("conf", "ENG/48100", maps, WITHOUT)).toBe(false);
  });

  it("does not let an area with an existing connection be chosen — one area, one connection", () => {
    const conns: Connection[] = [
      {
        area: "anleitungen",
        target: "ENG",
        kind: "origin",
        evidence: "anleitungen/index.md",
      },
    ];
    expect(selectable("wiki", "anleitungen", [], conns)).toBe(false);
    expect(selectable("wiki", "onboarding", [], conns)).toBe(true);
  });
});

describe("Mapping", () => {
  it("drops onto a row: onto this page and below", () => {
    const maps = mapSelection(
      [],
      { side: "wiki", ids: ["anleitungen"] },
      { kind: "onto", id: "ENG/48100" },
    );
    expect(maps).toEqual([
      {
        n: 1,
        side: "wiki",
        ids: ["anleitungen"],
        target: { kind: "onto", id: "ENG/48100" },
      },
    ]);
  });

  it("drops into a gap: create new in this place", () => {
    const maps = mapSelection(
      [],
      { side: "wiki", ids: ["onboarding"] },
      {
        kind: "new",
        parent: "ENG",
        after: "ENG/48100",
      },
    );
    expect(maps[0].target).toEqual({
      kind: "new",
      parent: "ENG",
      after: "ENG/48100",
    });
  });

  it("keeps counting — every mapping gets its own number", () => {
    let maps = mapSelection(
      [],
      { side: "wiki", ids: ["a"] },
      { kind: "onto", id: "ENG/1" },
    );
    maps = mapSelection(
      maps,
      { side: "wiki", ids: ["b"] },
      { kind: "onto", id: "ENG/2" },
    );
    expect(maps.map((m) => m.n)).toEqual([1, 2]);
  });

  it("renumbers after releasing so no gap is left", () => {
    let maps = mapSelection(
      [],
      { side: "wiki", ids: ["a"] },
      { kind: "onto", id: "ENG/1" },
    );
    maps = mapSelection(
      maps,
      { side: "wiki", ids: ["b"] },
      { kind: "onto", id: "ENG/2" },
    );
    maps = mapSelection(
      maps,
      { side: "wiki", ids: ["c"] },
      { kind: "onto", id: "ENG/3" },
    );
    const rest = release(maps, 2);
    expect(rest.map((m) => [m.n, m.ids[0]])).toEqual([
      [1, "a"],
      [2, "c"],
    ]);
  });

  it("refuses a drop on the side that was dragged from", () => {
    const maps = mapSelection(
      [],
      { side: "wiki", ids: ["a"] },
      { kind: "onto", id: "onboarding" },
      "wiki",
    );
    expect(maps).toEqual([]);
  });

  it("refuses a drop on an already mapped row", () => {
    const firstItem = mapSelection(
      [],
      { side: "wiki", ids: ["a"] },
      { kind: "onto", id: "ENG/1" },
    );
    const secondItem = mapSelection(
      firstItem,
      { side: "wiki", ids: ["b"] },
      { kind: "onto", id: "ENG/1" },
    );
    expect(secondItem).toEqual(firstItem);
    expect(
      mapSelection(
        firstItem,
        { side: "conf", ids: ["ENG/2"] },
        { kind: "onto", id: "a" },
        "wiki",
      ),
    ).toEqual(firstItem);
  });

  it("carries the same number on both sides", () => {
    const maps = mapSelection(
      [],
      { side: "wiki", ids: ["anleitungen"] },
      { kind: "onto", id: "ENG/48100" },
    );
    expect(numberOf("wiki", "anleitungen", maps)).toBe(1);
    expect(numberOf("conf", "ENG/48100", maps)).toBe(1);
  });

  it("gives no number for a row without a mapping", () => {
    expect(numberOf("wiki", "onboarding", [])).toBeNull();
  });
});
