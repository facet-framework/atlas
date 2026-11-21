import { germanLabel } from "@/i18n/testing-labels.spec-support";
import { href, navKey, parse, type Route } from "./route";
import {
  EMPTY,
  HISTORY_KEY,
  HISTORY_LIMIT,
  back,
  canBack,
  canForward,
  current,
  forward,
  jump,
  listing,
  load,
  replaceCurrent,
  save,
  visit,
  type Place,
} from "./history";
import { atlasT } from "./testing";

const place = (path: string, at = 0): Place => ({ path, label: path, kind: "record", at });

describe("places", () => {
  const routes: Route[] = [
    { area: "overview" },
    { area: "product" },
    { area: "records" },
    { area: "domain", domain: "navigation" },
    { area: "capability", domain: "navigation", capability: "atlas" },
    { area: "record", id: "documents/decisions/adr-plugin" },
    { area: "contents" },
    { area: "contents", kind: "drift" },
    { area: "glossary" },
    { area: "glossary", term: "Anchors & Record" },
    { area: "settings" },
    { area: "settings", section: "appearance" },
    { area: "plugin", plugin: "notes", rest: "" },
    { area: "plugin", plugin: "notes", rest: "getting-started/first-steps.md" },
    { area: "ask" },
    { area: "ask", session: "s001" },
  ];

  // One test with a fixed name, not `it.each`: a verification id has to match
  // the name the runner reports, and a `%s` template never does.
  it("reads every place back as the route it was printed from", () => {
    // Precondition: the list covers every area, so a new one cannot be skipped.
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) {
      const path = href(route);
      expect(path.startsWith("/")).toBe(true);
      expect(parse(path)).toEqual(route);
    }
  });

  it("keeps the record id with its slashes and decodes escaped segments", () => {
    expect(href({ area: "record", id: "a/b/c d" })).toBe("/record/a/b/c%20d");
    expect(parse("/record/a/b/c%20d")).toEqual({ area: "record", id: "a/b/c d" });
    expect(parse("/glossary/%E0%A4%A")).toEqual({ area: "glossary", term: "%E0%A4%A" });
  });

  it("names every unknown or incomplete address instead of guessing", () => {
    for (const path of ["/record", "/domain", "/domain/a/b/c", "/p", "/irgendwo"]) {
      expect(parse(path)).toEqual({ area: "unknown", path });
    }
    expect(parse("/unavailable")).toEqual({ area: "unknown", path: "/unavailable" });
    expect(parse("/unknown-area")).toEqual({ area: "unknown", path: "/unknown-area" });
    expect(href({ area: "unknown", path: "/x" })).toBe("/x");
  });

  it("maps each place to its area in the bar", () => {
    expect(navKey({ area: "capability", domain: "a", capability: "b" })).toBe("product");
    expect(navKey({ area: "domain", domain: "a" })).toBe("product");
    expect(navKey({ area: "record", id: "x" })).toBe("records");
    expect(navKey({ area: "plugin", plugin: "adr", rest: "" })).toBe("adr");
    expect(navKey({ area: "glossary" })).toBe("glossary");
  });
});

describe("history", () => {
  it("starts with both chevrons off", () => {
    expect(canBack(EMPTY)).toBe(false);
    expect(canForward(EMPTY)).toBe(false);
    expect(back(EMPTY)).toBe(EMPTY);
    expect(forward(EMPTY)).toBe(EMPTY);
    expect(current(EMPTY)).toBeUndefined();
  });

  it("goes back and forward without losing places", () => {
    let v = [place("/"), place("/product"), place("/record/x")].reduce(visit, EMPTY);
    expect(canBack(v)).toBe(true);
    v = back(back(v));
    expect(current(v)?.path).toBe("/");
    expect(canBack(v)).toBe(false);
    v = forward(v);
    expect(current(v)?.path).toBe("/product");
    expect(canForward(v)).toBe(true);
    expect(v.places).toHaveLength(3);
  });

  it("drops the places ahead when a new place is visited from the middle", () => {
    let v = [place("/a"), place("/b"), place("/c")].reduce(visit, EMPTY);
    v = visit(back(back(v)), place("/d"));
    expect(v.places.map((p) => p.path)).toEqual(["/a", "/d"]);
    expect(canForward(v)).toBe(false);
  });

  it("refreshes the label when the current place is visited again, keeping the first visit time", () => {
    let v = visit(EMPTY, place("/a", 100));
    v = visit(v, { ...place("/a", 900), label: "newcomer" });
    expect(v.places).toEqual([{ path: "/a", label: "newcomer", kind: "record", at: 100 }]);
  });

  it("renames the current place under a new address without adding one or dropping the places ahead", () => {
    let v = [place("/a", 1), place("/b", 2), place("/c", 3)].reduce(visit, EMPTY);
    v = replaceCurrent(back(v), place("/b2", 9));
    expect(v.places.map((p) => p.path)).toEqual(["/a", "/b2", "/c"]);
    expect(v.cursor).toBe(1);
    expect(v.places[1].at).toBe(2);
    expect(replaceCurrent(EMPTY, place("/x"))).toEqual({ places: [place("/x")], cursor: 0 });
  });

  it("keeps at most the limit, dropping the oldest", () => {
    let v = EMPTY;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) v = visit(v, place(`/p${i}`));
    expect(v.places).toHaveLength(HISTORY_LIMIT);
    expect(v.places[0].path).toBe("/p5");
    expect(v.cursor).toBe(HISTORY_LIMIT - 1);
  });

  it("jumps to a picked place and ignores an index outside the list", () => {
    const v = [place("/a"), place("/b")].reduce(visit, EMPTY);
    expect(current(jump(v, 0))?.path).toBe("/a");
    expect(jump(v, 7)).toBe(v);
    expect(jump(v, -1)).toBe(v);
  });

  it("lists newest first with the current place marked and a clock or date", () => {
    const now = new Date(2026, 10, 13, 14, 8).getTime();
    const v = back(
      [place("/a", new Date(2026, 10, 12, 9, 5).getTime()), place("/b", now)].reduce(visit, EMPTY),
    );
    const rows = listing(v, atlasT("en"), now);
    expect(rows.map((r) => [r.label, r.time, r.current])).toEqual([
      ["/b", "14:08", false],
      ["/a", "12.11.", true],
    ]);
    expect(listing(EMPTY, atlasT("en"))).toEqual([]);
  });
});

describe("history storage", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      data,
    };
  };

  it("round-trips a history through storage", () => {
    const s = memory();
    const v = back([place("/a", 1), place("/b", 2)].reduce(visit, EMPTY));
    expect(save(s, v)).toBe(true);
    expect(load(s)).toEqual(v);
    expect(save(s, EMPTY)).toBe(true);
    expect(s.data.has(HISTORY_KEY)).toBe(false);
  });

  it("reads anything broken as an empty history", () => {
    const s = memory();
    expect(load(undefined)).toBe(EMPTY);
    expect(load(s)).toBe(EMPTY);
    s.data.set(HISTORY_KEY, "{broken");
    expect(load(s)).toBe(EMPTY);
    s.data.set(HISTORY_KEY, JSON.stringify({ places: "no" }));
    expect(load(s)).toBe(EMPTY);
    s.data.set(
      HISTORY_KEY,
      JSON.stringify({ places: [{ path: "/a" }, place("/b", 3)], cursor: 99 }),
    );
    expect(load(s)).toEqual({ places: [place("/b", 3)], cursor: 0 });
    s.data.set(HISTORY_KEY, JSON.stringify({ places: [place("/b", 3), null] }));
    expect(load(s).cursor).toBe(0);
  });

  it("words the fixed names when the list is drawn, not when the place was visited", () => {
    const named: Place = {
      path: "/",
      label: "Overview",
      name: { id: "overview" },
      kind: "overviewPage",
      at: 1,
    };
    const v = visit(EMPTY, named);
    expect(listing(v, atlasT("en"), 1)[0].label).toBe("Overview");
    expect(listing(v, atlasT("de"), 1)[0].label).toBe(germanLabel("Overview"));
    // A data-derived place keeps its supplied label.
    expect(
      listing(visit(EMPTY, { ...named, name: undefined, label: "Overview" }), atlasT("en"), 1)[0]
        .label,
    ).toBe("Overview");
  });

  it("falls back to the stored words for a name it does not know, and drops a malformed name", () => {
    const s = memory();
    const unknown = {
      path: "/x",
      label: "Somewhere new",
      name: { id: "later" },
      kind: "area",
      at: 1,
    };
    const malformed = [
      { path: "/m1", label: "m1", name: "overview", kind: "area", at: 2 },
      { path: "/m2", label: "m2", name: { id: 7 }, kind: "area", at: 3 },
      { path: "/m3", label: "m3", name: { id: "area", arg: 5 }, kind: "area", at: 4 },
      { path: "/m4", label: "m4", name: null, kind: "area", at: 5 },
    ];
    s.data.set(HISTORY_KEY, JSON.stringify({ places: [unknown, ...malformed] }));
    const v = load(s);
    expect(v.places.map((p) => p.path)).toEqual(["/x"]);
    expect(listing(v, atlasT("en"), 1)[0].label).toBe("Somewhere new");
    expect(listing(v, atlasT("de"), 1)[0].label).toBe("Somewhere new");
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => undefined,
    };
    expect(load(broken)).toBe(EMPTY);
    expect(save(broken, visit(EMPTY, place("/a")))).toBe(false);
    expect(save(undefined, EMPTY)).toBe(false);
  });
});
