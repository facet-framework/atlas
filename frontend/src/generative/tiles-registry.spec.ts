/** The registry mechanics themselves, isolated from the seven role sets: an
 * unregistered role yields an empty list instead of invented tiles, and a
 * second registration replaces the first. */

import { buildModel, type RawRecord } from "@/model";
import { derive } from "../derive";
import {
  _resetGenSetsForTests,
  genLabelFor,
  genRegisteredRoles,
  genTilesFor,
  registerGenSet,
} from "./tiles";

const RAWS: RawRecord[] = [
  {
    path: "docs/facets/a/b/c.yaml",
    raw: "",
    doc: {
      id: "a/b/c",
      lifecycle: "active",
      intent: { summary: "x" },
      lineage: { owner: { team: "t" } },
    },
  },
];
const v = derive(
  buildModel(
    { name: "registry" },
    RAWS.map((r) => r.path),
    RAWS,
  ),
);
const nav = { open: jest.fn() };

afterEach(() => {
  _resetGenSetsForTests();
});

describe("a role without a registered set", () => {
  it("yields an empty list instead of invented tiles", () => {
    expect(genTilesFor("owner", v, nav)).toEqual([]);
  });

  it("falls back to 'Context' for the label", () => {
    expect(genLabelFor("owner")).toBe("Context");
  });

  it("is not in genRegisteredRoles", () => {
    registerGenSet("newcomer", () => []);
    expect(genRegisteredRoles()).toEqual(["newcomer"]);
  });
});

describe("a second registration replaces the first", () => {
  it("uses the function registered last", () => {
    registerGenSet("newcomer", () => [
      { id: "first", kind: "measured", title: "First", basis: "x", body: null },
    ]);
    registerGenSet("newcomer", () => [
      { id: "second", kind: "measured", title: "Second", basis: "y", body: null },
    ]);
    const tiles = genTilesFor("newcomer", v, nav);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].id).toBe("second");
  });
});
