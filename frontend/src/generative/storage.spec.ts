/** The tile text store: write, read, the cap takes hold. */

import {
  capped,
  readGenStorage,
  MAX_GEN_ENTRIES,
  MAX_GEN_TEXT,
  parseGenStorage,
  writeGenStorage,
  type GenEntry,
  type GenStorage,
} from "./storage";

function entry(over: Partial<GenEntry> = {}): GenEntry {
  return { text: "A sentence.", ctxN: 3, ofN: 14, model: "Haiku", at: 1000, hash: "a:5", ...over };
}

/** A store that writes and reads like `localStorage`, without needing the browser. */
function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("parseGenStorage — what does not fit is dropped", () => {
  it("takes over a complete entry", () => {
    const out = parseGenStorage({ core: entry() });
    expect(out.core).toEqual(entry());
  });

  it("drops an entry without text", () => {
    const out = parseGenStorage({ core: { ...entry(), text: "" } });
    expect(out.core).toBeUndefined();
  });

  it("drops an entry without a point in time", () => {
    const out = parseGenStorage({ core: { text: "x", hash: "a" } });
    expect(out.core).toBeUndefined();
  });

  it("drops an entry without a hash", () => {
    const out = parseGenStorage({ core: { text: "x", at: 1 } });
    expect(out.core).toBeUndefined();
  });

  it("shortens a text that is too long instead of dropping it", () => {
    const lang = "x".repeat(MAX_GEN_TEXT + 500);
    const out = parseGenStorage({ core: entry({ text: lang }) });
    expect(out.core?.text.length).toBe(MAX_GEN_TEXT);
  });

  it("reads no error text when none was stored", () => {
    const out = parseGenStorage({ core: entry() });
    expect(out.core?.err).toBeUndefined();
  });

  it("takes over a stored error text", () => {
    const out = parseGenStorage({ core: entry({ err: "Ratenbegrenzung (429)" }) });
    expect(out.core?.err).toBe("Ratenbegrenzung (429)");
  });

  it("returns an empty object when the value is not an object", () => {
    expect(parseGenStorage("kaputt")).toEqual({});
    expect(parseGenStorage(null)).toEqual({});
    expect(parseGenStorage(undefined)).toEqual({});
  });
});

describe("capped — the oldest go first", () => {
  it("leaves a set under the cap untouched", () => {
    const map: GenStorage = { a: entry({ at: 1 }), b: entry({ at: 2 }) };
    expect(capped(map, 5)).toEqual(map);
  });

  it("throws away the oldest entries when the cap takes hold", () => {
    const map: GenStorage = {
      newcomer: entry({ at: 3 }),
      alt: entry({ at: 1 }),
      midpoint: entry({ at: 2 }),
    };
    const cappedValue = capped(map, 2);
    expect(Object.keys(cappedValue).sort()).toEqual(["midpoint", "newcomer"]);
  });

  it("applies the default MAX_GEN_ENTRIES when none is passed", () => {
    const map: GenStorage = {};
    for (let i = 0; i < MAX_GEN_ENTRIES + 10; i++) {
      map[`k${i}`] = entry({ at: i });
    }
    expect(Object.keys(capped(map))).toHaveLength(MAX_GEN_ENTRIES);
  });
});

describe("writeGenStorage / readGenStorage — the way through a real store", () => {
  it("writes and reads back the same value", () => {
    const storage = fakeStorage();
    const map: GenStorage = { core: entry() };
    expect(writeGenStorage(map, storage)).toBe(true);
    expect(readGenStorage(storage)).toEqual(map);
  });

  it("reads an empty object when nothing was ever written", () => {
    expect(readGenStorage(fakeStorage())).toEqual({});
  });

  it("reports false and writes nothing when the store throws", () => {
    const werfend = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage;
    expect(writeGenStorage({ core: entry() }, werfend)).toBe(false);
  });

  it("reads an empty object when the stored value is not JSON", () => {
    const storage = fakeStorage();
    storage.setItem("facet.atlas.generative", "{kaputt");
    expect(readGenStorage(storage)).toEqual({});
  });
});
